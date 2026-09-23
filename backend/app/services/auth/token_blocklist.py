"""JWT access-token blocklist (jti) backed by Redis when available."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from flask import current_app
from redis import Redis

logger = logging.getLogger(__name__)

_KEY_PREFIX = "jwt:blocklist:"


def _redis() -> Redis | None:
    try:
        url = current_app.config.get("REDIS_URL") or "redis://localhost:6379/0"
        client = Redis.from_url(url, decode_responses=True, socket_connect_timeout=1)
        client.ping()
        return client
    except Exception:
        logger.warning("[AUTH] Redis indisponible — blocklist JWT désactivée pour cette opération")
        return None


def revoke_access_jti(jti: str | None, expires_at: datetime | int | float | None) -> None:
    """Place un access token (jti) en blocklist jusqu'à son exp."""
    if not jti:
        return
    client = _redis()
    if not client:
        return
    ttl = 900  # fallback 15 min
    try:
        if isinstance(expires_at, (int, float)):
            ttl = max(1, int(expires_at - datetime.now(timezone.utc).timestamp()))
        elif isinstance(expires_at, datetime):
            exp = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
            ttl = max(1, int((exp - datetime.now(timezone.utc)).total_seconds()))
    except Exception:
        ttl = 900
    try:
        client.setex(f"{_KEY_PREFIX}{jti}", ttl, "1")
    except Exception:
        logger.exception("[AUTH] Échec écriture blocklist jti=%s", jti)


def is_jti_revoked(jti: str | None) -> bool:
    if not jti:
        return False
    client = _redis()
    if not client:
        return False
    try:
        return bool(client.exists(f"{_KEY_PREFIX}{jti}"))
    except Exception:
        logger.exception("[AUTH] Échec lecture blocklist")
        return False
