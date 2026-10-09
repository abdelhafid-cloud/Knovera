"""Logs structurés pipeline — pastilles colorées + résumé OCR."""

from __future__ import annotations

import logging
import os
import sys
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

# Active les couleurs ANSI sous Windows (Terminal / PowerShell moderne)
if sys.platform == "win32":
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(-11)
        mode = ctypes.c_uint32()
        if kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            kernel32.SetConsoleMode(handle, mode.value | 0x0004)
    except Exception:
        pass

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
BLUE = "\033[34m"
MAGENTA = "\033[35m"
CYAN = "\033[36m"
WHITE = "\033[37m"

_USE_COLOR = os.getenv("PIPELINE_LOG_COLOR", "true").strip().lower() not in (
    "0",
    "false",
    "no",
)


def _c(color: str, text: str) -> str:
    if not _USE_COLOR:
        return text
    return f"{color}{text}{RESET}"


def ball(kind: str = "info") -> str:
    """Pastille emoji colorée."""
    mapping = {
        "ok": "🟢",
        "info": "🔵",
        "step": "🔵",
        "warn": "🟡",
        "fail": "🔴",
        "ocr": "🟣",
        "native": "🟢",
        "skip": "🌑︎",
        "orange": "🟠",
        "brown": "🟤",
    }
    return mapping.get(kind, "🔵")


@dataclass
class ExtractStats:
    file_type: str = ""
    strategy: str = ""
    native_pages: int = 0
    ocr_pages: int = 0
    ocr_images: int = 0
    ocr_used: bool = False
    details: list[str] = field(default_factory=list)


_extract_stats: ContextVar[ExtractStats | None] = ContextVar("extract_stats", default=None)


def reset_extract_stats() -> ExtractStats:
    stats = ExtractStats()
    _extract_stats.set(stats)
    return stats


def get_extract_stats() -> ExtractStats:
    stats = _extract_stats.get()
    if stats is None:
        stats = reset_extract_stats()
    return stats


class PipelineConsole:
    """API de log structurée pour le worker."""

    def __init__(self, logger: logging.Logger | logging.LoggerAdapter | None = None):
        self.log = logger or logging.getLogger("pipeline")

    def banner(self, title: str) -> None:
        line = "=" * 56
        self.log.info(_c(CYAN, line))
        self.log.info("%s %s", ball("step"), _c(BOLD + CYAN, title))
        self.log.info(_c(CYAN, line))

    def step(self, n: int, total: int, title: str, **fields: Any) -> None:
        extra = " | ".join(f"{k}={v}" for k, v in fields.items() if v is not None)
        msg = f"{ball('step')} [{n}/{total}] {title}"
        if extra:
            msg = f"{msg}  {_c(DIM, extra)}"
        self.log.info(msg)

    def ok(self, message: str, **fields: Any) -> None:
        extra = " | ".join(f"{k}={v}" for k, v in fields.items() if v is not None)
        msg = f"{ball('ok')} {_c(GREEN, message)}"
        if extra:
            msg = f"{msg}  {_c(DIM, extra)}"
        self.log.info(msg)

    def info(self, message: str, **fields: Any) -> None:
        extra = " | ".join(f"{k}={v}" for k, v in fields.items() if v is not None)
        msg = f"{ball('info')} {message}"
        if extra:
            msg = f"{msg}  {_c(DIM, extra)}"
        self.log.info(msg)

    def warn(self, message: str, **fields: Any) -> None:
        extra = " | ".join(f"{k}={v}" for k, v in fields.items() if v is not None)
        msg = f"{ball('warn')} {_c(YELLOW, message)}"
        if extra:
            msg = f"{msg}  {_c(DIM, extra)}"
        self.log.warning(msg)

    def fail(self, message: str, **fields: Any) -> None:
        extra = " | ".join(f"{k}={v}" for k, v in fields.items() if v is not None)
        msg = f"{ball('fail')} {_c(RED, message)}"
        if extra:
            msg = f"{msg}  {_c(DIM, extra)}"
        self.log.error(msg)

    def native(self, message: str, **fields: Any) -> None:
        extra = " | ".join(f"{k}={v}" for k, v in fields.items() if v is not None)
        msg = f"{ball('native')} NATIF  {message}"
        if extra:
            msg = f"{msg}  {_c(DIM, extra)}"
        self.log.info(msg)

    def ocr(self, message: str, **fields: Any) -> None:
        extra = " | ".join(f"{k}={v}" for k, v in fields.items() if v is not None)
        msg = f"{ball('ocr')} OCR  {message}"
        if extra:
            msg = f"{msg}  {_c(DIM, extra)}"
        self.log.info(msg)

    def route(self, file_type: str, strategy: str) -> None:
        self.log.info(
            "%s ROUTE  type=%s  strategy=%s",
            ball("step"),
            _c(CYAN, file_type),
            strategy,
        )

    def ocr_summary(self, stats: ExtractStats | None = None) -> None:
        stats = stats or get_extract_stats()
        used = stats.ocr_used or stats.ocr_pages > 0 or stats.ocr_images > 0
        if used:
            self.log.info(
                "%s OCR UTILISÉ = OUI  pages_ocr=%s | images_ocr=%s | pages_natif=%s",
                ball("ocr"),
                stats.ocr_pages,
                stats.ocr_images,
                stats.native_pages,
            )
        else:
            self.log.info(
                "%s OCR UTILISÉ = NON  pages_natif=%s | (aucun appel PaddleOCR-VL)",
                ball("native"),
                stats.native_pages,
            )
        if stats.details:
            for d in stats.details:
                self.log.info("%s %s", ball("skip"), _c(DIM, d))

    def done(self, message: str, **fields: Any) -> None:
        extra = " | ".join(f"{k}={v}" for k, v in fields.items() if v is not None)
        line = "=" * 56
        self.log.info(_c(GREEN, line))
        msg = f"{ball('ok')} {_c(BOLD + GREEN, message)}"
        if extra:
            msg = f"{msg}  {_c(DIM, extra)}"
        self.log.info(msg)
        self.log.info(_c(GREEN, line))


console = PipelineConsole()
