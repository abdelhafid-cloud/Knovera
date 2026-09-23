import logging
import os
import time
from uuid import UUID

from flask import current_app
from redis import Redis
from rq import Queue

from app.logging_config import get_doc_logger, ms_since, set_doc_context

logger = get_doc_logger(__name__)
_raw = logging.getLogger(__name__)


def get_queue() -> Queue:
    redis_conn = Redis.from_url(current_app.config["REDIS_URL"])
    return Queue("documents", connection=redis_conn)


def enqueue_document_processing(document_id: str, *, document_name: str | None = None):
    """
    Envoie le job au worker pipeline (terminal séparé).
    Pas de traitement sync dans Flask — les logs pipeline restent isolés.
    """
    label = document_name or document_id
    sync_fallback = os.getenv("PIPELINE_SYNC_FALLBACK", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    t0 = time.perf_counter()

    try:
        q = get_queue()
        job = q.enqueue(
            "app.workers.document_processor.run_process_document",
            document_id,
            job_timeout=600,
            meta={"document_name": label},
        )
        _raw.info(
            "[BACKEND:ENQUEUE] Job envoyé | doc=%s | id=%s | job_id=%s | queue=documents | redis=%s | took=%sms",
            label,
            document_id,
            job.id,
            current_app.config.get("REDIS_URL"),
            ms_since(t0),
        )
        _raw.info(
            "[BACKEND:ENQUEUE] Attente worker pipeline (terminal: python run_pipeline.py)",
        )
        return job.id
    except Exception as exc:
        _raw.error(
            "[BACKEND:ENQUEUE] Échec | doc=%s | id=%s | error=%s | took=%sms",
            label,
            document_id,
            exc,
            ms_since(t0),
        )
        if not sync_fallback:
            raise RuntimeError(
                "Impossible d'envoyer le document au pipeline (Redis / worker). "
                "Démarrez Redis et le terminal pipeline: python run_pipeline.py"
            ) from exc

        _raw.warning(
            "[BACKEND:ENQUEUE] PIPELINE_SYNC_FALLBACK=1 — traitement DANS le backend",
        )
        from app.services.rag.pipeline import process_document

        process_document(document_id)
        return None


def run_process_document(document_id: str):
    """Entrypoint RQ — s'exécute uniquement dans le processus pipeline."""
    os.environ.setdefault("RAG_PROCESS", "pipeline")
    from app import create_app
    from app.extensions import db
    from app.models import Document
    from app.services.rag.pipeline import process_document

    t0 = time.perf_counter()
    app = create_app()
    with app.app_context():
        document = db.session.get(Document, UUID(document_id))
        name = document.name if document else "?"
        set_doc_context(document_id, name)
        logger.info(
            "[PIPELINE:JOB] ▶ Job reçu | status=%s | mime=%s | size=%s",
            getattr(document, "status", "?"),
            getattr(document, "mime_type", "?"),
            getattr(document, "size_bytes", "?"),
        )
        process_document(document_id)
        logger.info(
            "[PIPELINE:JOB] ■ Job terminé | took=%sms",
            ms_since(t0),
        )
