"""Rendu PDF + images embarquées DOCX/XLSX."""

from __future__ import annotations

from io import BytesIO
from zipfile import ZipFile

from pipeline.app.config import settings
from pipeline.app.logging_config import get_doc_logger

logger = get_doc_logger(__name__)

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp", ".gif"}


def render_pdf_page(data: bytes, page_number: int, dpi: int | None = None) -> bytes:
    """Rend une seule page PDF (1-indexed) en PNG bytes."""
    import pypdfium2 as pdfium

    dpi = dpi or settings.OCR_PDF_DPI
    scale = dpi / 72.0
    pdf = pdfium.PdfDocument(data)
    idx = page_number - 1
    if idx < 0 or idx >= len(pdf):
        pdf.close()
        raise ValueError(f"page {page_number} hors limites")
    page = pdf[idx]
    pil = page.render(scale=scale).to_pil()
    buf = BytesIO()
    pil.save(buf, format="PNG")
    page.close()
    pdf.close()
    return buf.getvalue()


def render_pdf_pages(data: bytes, dpi: int | None = None) -> list[tuple[int, bytes]]:
    import pypdfium2 as pdfium

    dpi = dpi or settings.OCR_PDF_DPI
    scale = dpi / 72.0
    pdf = pdfium.PdfDocument(data)
    out: list[tuple[int, bytes]] = []
    for i in range(len(pdf)):
        page = pdf[i]
        pil = page.render(scale=scale).to_pil()
        buf = BytesIO()
        pil.save(buf, format="PNG")
        out.append((i + 1, buf.getvalue()))
        page.close()
    pdf.close()
    logger.info("[PIPELINE:EXTRACT] pdf→images | pages=%s | dpi=%s", len(out), dpi)
    return out


def extract_zip_images(data: bytes, prefix: str) -> list[tuple[str, bytes]]:
    images: list[tuple[str, bytes]] = []
    try:
        with ZipFile(BytesIO(data)) as zf:
            for name in zf.namelist():
                lower = name.lower()
                if not lower.startswith(prefix.lower()):
                    continue
                ext = "." + lower.rsplit(".", 1)[-1] if "." in lower else ""
                if ext in IMAGE_EXTS:
                    images.append((name, zf.read(name)))
    except Exception:
        logger.exception("[PIPELINE:EXTRACT] zip images | prefix=%s", prefix)
    return images


def extract_docx_images(data: bytes) -> list[tuple[str, bytes]]:
    return extract_zip_images(data, "word/media/")


def extract_xlsx_images(data: bytes) -> list[tuple[str, bytes]]:
    return extract_zip_images(data, "xl/media/")
