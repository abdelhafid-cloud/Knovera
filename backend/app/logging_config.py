"""Logging centralisé (backend + pipeline)."""

from __future__ import annotations

import logging
import logging.config
import os
from contextvars import ContextVar
from typing import Any

_doc_id: ContextVar[str] = ContextVar("doc_id", default="-")
_doc_name: ContextVar[str] = ContextVar("doc_name", default="-")


def set_doc_context(document_id: str, document_name: str) -> tuple[Any, Any]:
    """Fixe doc_id / filename pour tous les logs du traitement en cours."""
    t1 = _doc_id.set(str(document_id))
    t2 = _doc_name.set(document_name or "?")
    return t1, t2


def reset_doc_context(tokens: tuple[Any, Any]) -> None:
    _doc_id.reset(tokens[0])
    _doc_name.reset(tokens[1])


def doc_extra() -> dict[str, str]:
    return {"doc_id": _doc_id.get(), "doc_name": _doc_name.get()}


class DocContextFilter(logging.Filter):
    """Injecte doc= et id= dans le record si absents."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "doc_id"):
            record.doc_id = _doc_id.get()
        if not hasattr(record, "doc_name"):
            record.doc_name = _doc_name.get()
        return True


class DocLoggerAdapter(logging.LoggerAdapter):
    """Préfixe systématique | doc=<name> | id=<id> |"""

    def process(self, msg: str, kwargs: dict) -> tuple[str, dict]:
        extra = dict(self.extra or {})
        extra.update(kwargs.get("extra") or {})
        doc = extra.get("doc_name") or _doc_name.get()
        did = extra.get("doc_id") or _doc_id.get()
        if "| doc=" not in msg and "doc=" not in msg.split("|")[0]:
            # n'ajoute que si le message n'a pas déjà doc=
            if " | doc=" not in msg:
                msg = f"{msg} | doc={doc} | id={did}"
        kwargs["extra"] = extra
        return msg, kwargs


def get_doc_logger(name: str) -> DocLoggerAdapter:
    return DocLoggerAdapter(logging.getLogger(name), {})


def configure_logging(force: bool = False) -> None:
    level_name = (os.getenv("LOG_LEVEL") or "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "filters": {
                "doc_context": {
                    "()": "app.logging_config.DocContextFilter",
                }
            },
            "formatters": {
                "standard": {
                    "format": "%(asctime)s %(levelname)s [%(name)s] %(message)s",
                }
            },
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "level": level,
                    "formatter": "standard",
                    "filters": ["doc_context"],
                    "stream": "ext://sys.stderr",
                }
            },
            "root": {
                "level": level,
                "handlers": ["console"],
            },
        }
    )
    if force:
        # réappliquer le niveau root (réimport / worker)
        logging.getLogger().setLevel(level)


def ms_since(t0: float) -> float:
    import time

    return round((time.perf_counter() - t0) * 1000, 1)


def truncate(text: str | None, limit: int = 200) -> str:
    if not text:
        return ""
    text = text.replace("\n", " ").strip()
    if len(text) <= limit:
        return text
    return text[:limit] + "…"
