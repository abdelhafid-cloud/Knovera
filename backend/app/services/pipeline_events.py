"""Redis pub/sub: le pipeline notifie le backend quand un document est indexé."""

from __future__ import annotations

import json
import logging
import threading
from typing import Any

from flask import Flask
from redis import Redis

logger = logging.getLogger(__name__)

CHANNEL = "rag:pipeline:events"
_listener_started = False


def _redis(url: str) -> Redis:
    return Redis.from_url(url, decode_responses=True)


def publish_pipeline_event(redis_url: str, event: str, payload: dict[str, Any]) -> None:
    """Publié depuis le processus pipeline (worker)."""
    body = {"event": event, **payload}
    try:
        client = _redis(redis_url)
        client.publish(CHANNEL, json.dumps(body, ensure_ascii=False))
        logger.info(
            "[PIPELINE:REDIS] publish | channel=%s | event=%s | document_id=%s | status=%s | chunks=%s",
            CHANNEL,
            event,
            payload.get("document_id"),
            payload.get("status"),
            payload.get("chunks"),
        )
    except Exception:
        logger.exception(
            "[PIPELINE:REDIS] Échec publication | channel=%s | event=%s | document_id=%s",
            CHANNEL,
            event,
            payload.get("document_id"),
        )


def start_pipeline_callback_listener(app: Flask) -> None:
    """Thread daemon côté API Flask : affiche le callback d'indexation dans le terminal backend."""
    global _listener_started
    if _listener_started:
        return
    if app.config.get("TESTING"):
        return

    redis_url = app.config.get("REDIS_URL") or "redis://localhost:6379/0"
    _listener_started = True

    def _loop():
        try:
            client = _redis(redis_url)
            pubsub = client.pubsub(ignore_subscribe_messages=True)
            pubsub.subscribe(CHANNEL)
            app.logger.info(
                "[BACKEND] Écoute callback pipeline sur Redis channel=%s", CHANNEL
            )
            for message in pubsub.listen():
                if message is None or message.get("type") != "message":
                    continue
                raw = message.get("data")
                try:
                    data = json.loads(raw) if isinstance(raw, str) else {}
                except json.JSONDecodeError:
                    app.logger.warning("[BACKEND←PIPELINE] message invalide: %s", raw)
                    continue
                event = data.get("event")
                doc_id = data.get("document_id")
                name = data.get("document_name") or "?"
                status = data.get("status")
                chunks = data.get("chunks")
                error = data.get("error")
                if event == "indexed":
                    app.logger.info(
                        "[BACKEND←PIPELINE] CALLBACK OK | doc=%s | id=%s | status=%s | chunks=%s | ACTIF & INDEXÉ",
                        name,
                        doc_id,
                        status,
                        chunks,
                    )
                elif event == "failed":
                    app.logger.error(
                        "[BACKEND←PIPELINE] CALLBACK ÉCHEC | doc=%s | id=%s | error=%s",
                        name,
                        doc_id,
                        error,
                    )
                elif event == "processing":
                    app.logger.info(
                        "[BACKEND←PIPELINE] en cours | doc=%s | id=%s",
                        name,
                        doc_id,
                    )
                else:
                    app.logger.info("[BACKEND←PIPELINE] %s | %s", event, data)
        except Exception:
            app.logger.exception(
                "[BACKEND] Listener callback pipeline arrêté (Redis indisponible ?)"
            )

    thread = threading.Thread(
        target=_loop, name="pipeline-callback-listener", daemon=True
    )
    thread.start()
