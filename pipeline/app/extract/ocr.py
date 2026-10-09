"""Mistral OCR (API cloud) — remplace PaddleOCR-VL local."""

from __future__ import annotations

import base64
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

from pipeline.app.config import settings
from pipeline.app.console import console
from pipeline.app.logging_config import get_doc_logger, ms_since

logger = get_doc_logger(__name__)

_MISTRAL_OCR_URL = "https://api.mistral.ai/v1/ocr"

_MIME_BY_SUFFIX = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".pdf": "application/pdf",
}


def ocr_available() -> bool:
    if not settings.OCR_ENABLED:
        return False
    if not (settings.MISTRAL_API_KEY or "").strip():
        logger.error("[PIPELINE:OCR] MISTRAL_API_KEY manquante — OCR désactivé")
        return False
    return True


def warm_up() -> None:
    """Pas de modèle local à charger — vérifie juste la clé API."""
    if not ocr_available():
        raise RuntimeError("Mistral OCR indisponible (OCR_ENABLED / MISTRAL_API_KEY)")
    console.ocr(
        "Mistral OCR prêt (API)",
        engine=settings.OCR_ENGINE,
        model=settings.MISTRAL_OCR_MODEL,
    )
    logger.info(
        "[PIPELINE:OCR] Mistral prêt | model=%s",
        settings.MISTRAL_OCR_MODEL,
    )


def _pages_markdown(payload: dict) -> list[tuple[int, str]]:
    """Retourne [(page_1_indexed, markdown), ...]."""
    out: list[tuple[int, str]] = []
    for page in payload.get("pages") or []:
        md = (page.get("markdown") or "").strip()
        # API: index 0-based
        idx = int(page.get("index", len(out)))
        out.append((idx + 1, md))
    return out


def _call_mistral(document: dict, *, pages_0: list[int] | None = None) -> dict:
    body: dict = {
        "model": settings.MISTRAL_OCR_MODEL,
        "document": document,
    }
    if pages_0 is not None:
        body["pages"] = pages_0

    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        _MISTRAL_OCR_URL,
        data=data,
        headers={
            "Authorization": f"Bearer {settings.MISTRAL_API_KEY.strip()}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    timeout = settings.OCR_PAGE_TIMEOUT_SEC
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")[:500]
        raise RuntimeError(f"Mistral OCR HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Mistral OCR réseau: {exc.reason}") from exc


def ocr_pdf_pages(pdf_bytes: bytes, page_numbers: list[int]) -> dict[int, str]:
    """
    OCR sélectif sur un PDF (pages 1-indexed côté app).
    Un seul appel API Mistral avec pages 0-indexed.
    """
    if not settings.OCR_ENABLED or not page_numbers:
        return {}
    if not ocr_available():
        return {}

    pages_0 = sorted({max(0, p - 1) for p in page_numbers})
    b64 = base64.b64encode(pdf_bytes).decode("ascii")
    console.ocr(
        f"appel Mistral OCR PDF ({len(pages_0)} page(s))",
        pages=[p + 1 for p in pages_0],
        model=settings.MISTRAL_OCR_MODEL,
    )
    t0 = time.perf_counter()
    try:
        payload = _call_mistral(
            {
                "type": "document_url",
                "document_url": f"data:application/pdf;base64,{b64}",
            },
            pages_0=pages_0,
        )
    except Exception:
        console.fail("Mistral OCR PDF échoué")
        logger.exception("[PIPELINE:OCR] pdf batch échoué")
        return {}

    result: dict[int, str] = {}
    for page_no, md in _pages_markdown(payload):
        if md and page_no in page_numbers:
            result[page_no] = md
    console.ocr(
        "Mistral OCR PDF terminé",
        pages_ok=len(result),
        took_ms=ms_since(t0),
    )
    return result


def ocr_image_bytes(
    data: bytes, suffix: str = ".png", *, page_label: str | None = None
) -> str:
    if not settings.OCR_ENABLED:
        return ""
    if not ocr_available():
        return ""

    suffix = (suffix or ".png").lower()
    if not suffix.startswith("."):
        suffix = f".{suffix}"
    mime = _MIME_BY_SUFFIX.get(suffix, "image/png")
    label = page_label or f"image{suffix}"
    b64 = base64.b64encode(data).decode("ascii")

    console.ocr(f"appel Mistral OCR… {label}")
    t0 = time.perf_counter()
    try:
        payload = _call_mistral(
            {
                "type": "image_url",
                "image_url": f"data:{mime};base64,{b64}",
            }
        )
    except Exception:
        console.fail(f"Mistral OCR échoué — {label}")
        logger.exception("[PIPELINE:OCR] image échoué | page=%s", label)
        return ""

    parts = [md for _, md in _pages_markdown(payload) if md]
    text = "\n\n".join(parts).strip()
    console.ocr(f"terminé {label}", chars=len(text), took_ms=ms_since(t0))
    return text


def ocr_file(path: str | Path, *, page_label: str | None = None) -> str:
    path = Path(path)
    return ocr_image_bytes(
        path.read_bytes(),
        suffix=path.suffix or ".png",
        page_label=page_label or path.name,
    )
