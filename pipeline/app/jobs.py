"""Jobs RQ."""

from __future__ import annotations

import time
from uuid import UUID

from pipeline.app.config import settings
from pipeline.app.db import get_session
from pipeline.app.logging_config import get_doc_logger, ms_since, set_doc_context
from pipeline.app.models import Document
from pipeline.app.process import process_document

logger = get_doc_logger(__name__)


def run_process_document(document_id: str) -> None:
    """Entrypoint RQ — chemin: pipeline.app.jobs.run_process_document"""
    t0 = time.perf_counter()
    session = get_session()
    try:
        document = session.get(Document, UUID(document_id))
        name = document.name if document else "?"
        set_doc_context(document_id, name)
        logger.info(
            "[PIPELINE:JOB] ▶ reçu | status=%s | mime=%s | OCR_ENABLED=%s | engine=%s",
            getattr(document, "status", "?"),
            getattr(document, "mime_type", "?"),
            settings.OCR_ENABLED,
            settings.OCR_ENGINE,
        )
        if not settings.OCR_ENABLED:
            logger.warning(
                "[PIPELINE:JOB] OCR désactivé (OCR_ENABLED=false) — "
                "PDF scannés / images ne seront pas lus via PaddleOCR-VL"
            )
    finally:
        session.close()

    process_document(document_id)
    logger.info("[PIPELINE:JOB] ■ terminé | took=%sms", ms_since(t0))
