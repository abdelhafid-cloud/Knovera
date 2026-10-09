"""Catalogue providers LLM (OpenAI, Anthropic, OpenRouter) + résolution config."""

from __future__ import annotations

import os
from dataclasses import dataclass

from flask import current_app


@dataclass(frozen=True)
class ProviderModel:
    id: str
    label: str


PROVIDER_CATALOG: dict[str, dict] = {
    "openai": {
        "id": "openai",
        "label": "OpenAI",
        "description": "API OpenAI directe",
        "default_base_url": "https://api.openai.com/v1",
        "models": [
            ProviderModel("gpt-4o", "GPT-4o"),
            ProviderModel("gpt-4o-mini", "GPT-4o mini"),
            ProviderModel("gpt-4.1", "GPT-4.1"),
            ProviderModel("gpt-4.1-mini", "GPT-4.1 mini"),
            ProviderModel("o4-mini", "o4-mini"),
        ],
    },
    "anthropic": {
        "id": "anthropic",
        "label": "Anthropic",
        "description": "API Anthropic directe (Claude)",
        "default_base_url": "https://api.anthropic.com",
        "models": [
            ProviderModel("claude-sonnet-4-5", "Claude Sonnet 4.5"),
            ProviderModel("claude-opus-4-5", "Claude Opus 4.5"),
            ProviderModel("claude-haiku-4-5", "Claude Haiku 4.5"),
            ProviderModel("claude-3-5-sonnet-latest", "Claude 3.5 Sonnet"),
            ProviderModel("claude-3-5-haiku-latest", "Claude 3.5 Haiku"),
        ],
    },
    "openrouter": {
        "id": "openrouter",
        "label": "OpenRouter",
        "description": "Agrégateur multi-modèles (OpenAI, Anthropic, etc.)",
        "default_base_url": "https://openrouter.ai/api/v1",
        "models": [
            ProviderModel("openai/gpt-4o", "OpenAI GPT-4o"),
            ProviderModel("openai/gpt-4o-mini", "OpenAI GPT-4o mini"),
            ProviderModel("anthropic/claude-sonnet-4.5", "Anthropic Claude Sonnet 4.5"),
            ProviderModel("anthropic/claude-3.5-sonnet", "Anthropic Claude 3.5 Sonnet"),
            ProviderModel("google/gemini-2.5-flash", "Google Gemini 2.5 Flash"),
            ProviderModel("meta-llama/llama-3.3-70b-instruct", "Llama 3.3 70B"),
            ProviderModel("mistralai/mistral-large", "Mistral Large"),
        ],
    },
}


def _cfg(name: str, default: str = "") -> str:
    try:
        return (current_app.config.get(name) or os.getenv(name, default) or "").strip()
    except RuntimeError:
        return (os.getenv(name, default) or "").strip()


def resolve_provider_credentials(provider: str) -> dict:
    """Retourne {api_key, base_url, kind} pour un provider."""
    p = (provider or "openai").strip().lower()
    if p == "anthropic":
        key = _cfg("ANTHROPIC_API_KEY")
        return {
            "provider": "anthropic",
            "api_key": key,
            "base_url": _cfg("ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
            "kind": "anthropic",
            "configured": bool(key),
        }
    if p == "openrouter":
        key = _cfg("OPENROUTER_API_KEY")
        return {
            "provider": "openrouter",
            "api_key": key,
            "base_url": _cfg("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
            "kind": "openai_compatible",
            "configured": bool(key),
        }
    # openai (défaut) — fallback LLM_API_KEY historique
    key = _cfg("OPENAI_API_KEY") or _cfg("LLM_API_KEY")
    base = _cfg("OPENAI_BASE_URL") or _cfg("LLM_BASE_URL", "https://api.openai.com/v1")
    return {
        "provider": "openai",
        "api_key": key,
        "base_url": base,
        "kind": "openai_compatible",
        "configured": bool(key),
    }


def list_providers_for_api() -> list[dict]:
    out = []
    for pid, meta in PROVIDER_CATALOG.items():
        creds = resolve_provider_credentials(pid)
        out.append(
            {
                "id": pid,
                "label": meta["label"],
                "description": meta["description"],
                "configured": creds["configured"],
                "models": [{"id": m.id, "label": m.label} for m in meta["models"]],
            }
        )
    return out


def default_model_for(provider: str) -> str:
    meta = PROVIDER_CATALOG.get((provider or "openai").lower()) or PROVIDER_CATALOG["openai"]
    return meta["models"][0].id
