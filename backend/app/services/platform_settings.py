"""Paramètres globaux Knovera (singleton platform_config)."""

from __future__ import annotations

from copy import deepcopy

from app.extensions import db
from app.models import PlatformConfig

DEFAULTS: dict = {
    "branding": {
        "platform_name": "Knovera",
        "tagline": "Plateforme RAG multi-organisations",
        "support_email": "",
    },
    "default_quotas": {
        "max_members": 50,
        "max_documents": 500,
        "max_assistants": 20,
        "max_knowledge_bases": 20,
        "max_storage_gb": 5,
    },
    "default_rag": {
        "chunk_size": 800,
        "overlap": 120,
        "top_k": 5,
        "min_score": 0.25,
        "hybrid_search": True,
        "rerank": True,
    },
    "default_llm": {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "temperature": 0.2,
    },
    "features": {
        "allow_org_invitations": True,
        "allow_member_chat": True,
    },
}


def _deep_merge(base: dict, overlay: dict) -> dict:
    out = deepcopy(base)
    for key, value in (overlay or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def get_platform_settings() -> dict:
    row = db.session.get(PlatformConfig, 1)
    raw = (row.data if row else None) or {}
    return _deep_merge(DEFAULTS, raw)


def update_platform_settings(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Payload invalide")

    current = get_platform_settings()
    # Only merge known top-level sections
    for section in DEFAULTS:
        if section in payload and isinstance(payload[section], dict):
            current[section] = _deep_merge(current[section], payload[section])

    # Normalize numeric fields
    quotas = current["default_quotas"]
    for key in ("max_members", "max_documents", "max_assistants", "max_knowledge_bases", "max_storage_gb"):
        try:
            quotas[key] = max(0, int(quotas.get(key, 0)))
        except (TypeError, ValueError):
            quotas[key] = DEFAULTS["default_quotas"][key]

    rag = current["default_rag"]
    for key in ("chunk_size", "overlap", "top_k"):
        try:
            rag[key] = max(0, int(rag.get(key, 0)))
        except (TypeError, ValueError):
            rag[key] = DEFAULTS["default_rag"][key]
    try:
        rag["min_score"] = float(rag.get("min_score", 0.25))
    except (TypeError, ValueError):
        rag["min_score"] = 0.25
    rag["hybrid_search"] = bool(rag.get("hybrid_search", True))
    rag["rerank"] = bool(rag.get("rerank", True))

    llm = current["default_llm"]
    provider = str(llm.get("provider") or "openai").strip().lower()
    if provider not in ("openai", "anthropic", "openrouter"):
        provider = "openai"
    llm["provider"] = provider
    llm["model"] = str(llm.get("model") or "gpt-4o-mini").strip() or "gpt-4o-mini"
    try:
        llm["temperature"] = float(llm.get("temperature", 0.2))
    except (TypeError, ValueError):
        llm["temperature"] = 0.2

    branding = current["branding"]
    branding["platform_name"] = (branding.get("platform_name") or "Knovera").strip() or "Knovera"
    branding["tagline"] = (branding.get("tagline") or "").strip()
    branding["support_email"] = (branding.get("support_email") or "").strip()

    features = current["features"]
    features["allow_org_invitations"] = bool(features.get("allow_org_invitations", True))
    features["allow_member_chat"] = bool(features.get("allow_member_chat", True))

    row = db.session.get(PlatformConfig, 1)
    if not row:
        row = PlatformConfig(id=1, data=current)
        db.session.add(row)
    else:
        row.data = current
    db.session.commit()
    return get_platform_settings()


def default_org_quotas() -> dict:
    """Quotas prêts pour Organization.settings['quotas'] (bytes)."""
    q = get_platform_settings()["default_quotas"]
    gb = int(q.get("max_storage_gb") or 5)
    return {
        "max_members": int(q.get("max_members") or 50),
        "max_documents": int(q.get("max_documents") or 500),
        "max_assistants": int(q.get("max_assistants") or 20),
        "max_knowledge_bases": int(q.get("max_knowledge_bases") or 20),
        "max_storage_bytes": max(0, gb) * 1024 * 1024 * 1024,
    }


def default_rag_settings() -> dict:
    return dict(get_platform_settings()["default_rag"])


def default_llm_settings() -> dict:
    return dict(get_platform_settings()["default_llm"])
