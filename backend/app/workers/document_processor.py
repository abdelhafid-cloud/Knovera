import logging
import os
import time

from flask import current_app
from redis import Redis
from rq import Queue

logger = logging.getLogger(__name__)

# Job exécuté par le worker du dossier pipeline/ (python -m pipeline.run)
PIPELINE_JOB = "pipeline.app.jobs.run_process_document"


def get_queue() -> Queue:
    redis_conn = Redis.from_url(current_app.config["REDIS_URL"])
    # File dédiée au worker pipeline/ (évite les anciens workers "documents")
    queue_name = os.getenv("RQ_QUEUE", "pipeline")
    return Queue(queue_name, connection=redis_conn)


def enqueue_document_processing(document_id: str, *, document_name: str | None = None):
    """
    Envoie le job au worker pipeline (dossier pipeline/, terminal séparé).
    Pas de traitement sync dans Flask.
    """
    label = document_name or document_id
    t0 = time.perf_counter()

    try:
        q = get_queue()
        job = q.enqueue(
            PIPELINE_JOB,
            document_id,
            job_timeout=3600,
            meta={"document_name": label},
        )
        took_ms = round((time.perf_counter() - t0) * 1000, 1)
        logger.info(
            "[BACKEND:ENQUEUE] Job envoyé | doc=%s | id=%s | job_id=%s | target=%s | queue=%s | took=%sms",
            label,
            document_id,
            job.id,
            PIPELINE_JOB,
            q.name,
            took_ms,
        )
        logger.info(
            "[BACKEND:ENQUEUE] Attente worker pipeline (terminal: python -m pipeline.run)",
        )
        return job.id
    except Exception as exc:
        took_ms = round((time.perf_counter() - t0) * 1000, 1)
        logger.error(
            "[BACKEND:ENQUEUE] Échec | doc=%s | id=%s | error=%s | took=%sms",
            label,
            document_id,
            exc,
            took_ms,
        )
        sync_fallback = os.getenv("PIPELINE_SYNC_FALLBACK", "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        if not sync_fallback:
            raise RuntimeError(
                "Impossible d'envoyer le document au pipeline (Redis / worker). "
                "Démarrez Redis et le terminal pipeline: python -m pipeline.run"
            ) from exc

        logger.warning(
            "[BACKEND:ENQUEUE] PIPELINE_SYNC_FALLBACK=1 — "
            "traitement sync via pipeline.app.process.process_document"
        )
        from pipeline.app.process import process_document

        process_document(document_id)
        return None
