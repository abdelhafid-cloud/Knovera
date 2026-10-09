"""Redis pub/sub — notifie le backend."""

from __future__ import annotations

import json
import logging
from typing import Any

from redis import Redis

from pipeline.app.config import settings

logger = logging.getLogger(__name__)

CHANNEL = "rag:pipeline:events"


def publish_pipeline_event(event: str, payload: dict[str, Any]) -> None:
    body = {"event": event, **payload}
    try:
        Redis.from_url(settings.REDIS_URL, decode_responses=True).publish(
            CHANNEL, json.dumps(body, ensure_ascii=False)
        )
        logger.info(
            "[PIPELINE:REDIS] publish | event=%s | document_id=%s | status=%s",
            event,
            payload.get("document_id"),
            payload.get("status"),
        )
    except Exception:
        logger.exception("[PIPELINE:REDIS] Échec publication | event=%s", event)
