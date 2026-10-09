"""Logging pipeline."""

from __future__ import annotations

import logging
import logging.config
import os
import time
from contextvars import ContextVar
from typing import Any

_doc_id: ContextVar[str] = ContextVar("doc_id", default="-")
_doc_name: ContextVar[str] = ContextVar("doc_name", default="-")


def set_doc_context(document_id: str, document_name: str) -> tuple[Any, Any]:
    return _doc_id.set(str(document_id)), _doc_name.set(document_name or "?")


def reset_doc_context(tokens: tuple[Any, Any]) -> None:
    _doc_id.reset(tokens[0])
    _doc_name.reset(tokens[1])


class DocLoggerAdapter(logging.LoggerAdapter):
    def process(self, msg: str, kwargs: dict) -> tuple[str, dict]:
        # Les messages structurés (pastilles) restent lisibles ; doc en suffixe dim
        doc = _doc_name.get()
        did = _doc_id.get()
        if doc and doc != "-" and " | doc=" not in msg:
            msg = f"{msg}  · {doc}"
        return msg, kwargs


def get_doc_logger(name: str) -> DocLoggerAdapter:
    return DocLoggerAdapter(logging.getLogger(name), {})


def configure_logging(force: bool = False) -> None:
    level_name = (os.getenv("LOG_LEVEL") or "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    class _ColorLevelFormatter(logging.Formatter):
        COLORS = {
            logging.DEBUG: "\033[2m",
            logging.INFO: "\033[36m",
            logging.WARNING: "\033[33m",
            logging.ERROR: "\033[31m",
            logging.CRITICAL: "\033[1;31m",
        }

        def format(self, record: logging.LogRecord) -> str:
            use_color = os.getenv("PIPELINE_LOG_COLOR", "true").strip().lower() not in (
                "0",
                "false",
                "no",
            )
            # Ne pas recolorer les messages déjà structurés (pastilles)
            msg = super().format(record)
            if not use_color or "\033[" in record.getMessage():
                return msg
            color = self.COLORS.get(record.levelno, "")
            if color:
                return f"{color}{msg}\033[0m"
            return msg

    root = logging.getLogger()
    if force or not root.handlers:
        root.handlers.clear()
        handler = logging.StreamHandler()
        handler.setLevel(level)
        handler.setFormatter(
            _ColorLevelFormatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
        )
        root.addHandler(handler)
        root.setLevel(level)
    elif force:
        root.setLevel(level)


def ms_since(t0: float) -> float:
    return round((time.perf_counter() - t0) * 1000, 1)


def truncate(text: str | None, limit: int = 200) -> str:
    if not text:
        return ""
    text = text.replace("\n", " ").strip()
    return text if len(text) <= limit else text[:limit] + "…"
