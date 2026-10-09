"""Parsers PDF / DOCX / XLSX / TXT / images (+ OCR si besoin)."""

from __future__ import annotations

from io import BytesIO

from pipeline.app.config import settings
from pipeline.app.console import console, get_extract_stats, reset_extract_stats
from pipeline.app.extract import images as img_helpers
from pipeline.app.extract import ocr as ocr_mod
from pipeline.app.logging_config import get_doc_logger, truncate

logger = get_doc_logger(__name__)


def extract_document(data: bytes, mime_type: str, filename: str = "") -> list[dict]:
    stats = reset_extract_stats()
    name = (filename or "").lower()
    mime = (mime_type or "").lower()

    if mime == "application/pdf" or name.endswith(".pdf"):
        stats.file_type = "pdf"
        stats.strategy = "natif + OCR (pages vides OU complexes: schémas/logos/images)"
        console.route("pdf", stats.strategy)
        return _extract_pdf(data)
    if "wordprocessingml" in mime or name.endswith(".docx"):
        stats.file_type = "docx"
        stats.strategy = "texte natif + OCR images embarquées"
        console.route("docx", stats.strategy)
        return _extract_docx(data)
    if "spreadsheetml" in mime or name.endswith(".xlsx"):
        stats.file_type = "xlsx"
        stats.strategy = "cellules natives + OCR images embarquées"
        console.route("xlsx", stats.strategy)
        return _extract_xlsx(data)
    if mime.startswith("text/") or name.endswith(".txt"):
        stats.file_type = "txt"
        stats.strategy = "natif"
        console.route("txt", stats.strategy)
        text = data.decode("utf-8", errors="ignore")
        stats.native_pages = 1
        console.native("fichier texte", chars=len(text))
        return [{"content": text, "page_number": 1, "section_title": None}]
    if mime.startswith("image/") or any(
        name.endswith(ext)
        for ext in (".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp")
    ):
        stats.file_type = "image"
        stats.strategy = "OCR seul"
        console.route("image", stats.strategy)
        return _extract_image(data, name)
    raise ValueError(f"Type de fichier non supporté: {mime_type or filename}")


def _needs_ocr(text: str) -> bool:
    """Page quasi vide / scannée."""
    return len((text or "").strip()) < settings.OCR_MIN_CHARS_PER_PAGE


def _count_page_images(page) -> int:
    """Compte les images embarquées (schémas, logos, captures)."""
    try:
        resources = page.get("/Resources")
        if resources is None:
            return 0
        resources = resources.get_object() if hasattr(resources, "get_object") else resources
        xobject = resources.get("/XObject") if resources else None
        if xobject is None:
            return 0
        xobject = xobject.get_object() if hasattr(xobject, "get_object") else xobject
        count = 0
        for key in xobject:
            obj = xobject[key]
            obj = obj.get_object() if hasattr(obj, "get_object") else obj
            if obj.get("/Subtype") == "/Image":
                count += 1
            # Forms peuvent contenir d'autres images
            elif obj.get("/Subtype") == "/Form":
                count += 1
        return count
    except Exception:
        return 0


def _is_complex_page(page, text: str) -> tuple[bool, str]:
    """
    Page complexe = contenu visuel important (schémas),
    sans forcer l'OCR si le texte natif est déjà abondant.
    """
    if not settings.OCR_ON_COMPLEX:
        return False, ""

    n_images = _count_page_images(page)
    chars = len((text or "").strip())

    # Beaucoup d'images → OCR même si texte présent (schémas denses)
    if n_images >= settings.OCR_COMPLEX_FORCE_IMAGES:
        return True, f"images_force={n_images}"

    # Texte déjà riche → pas d'OCR (évite de bloquer 16 pages VL)
    if chars >= settings.OCR_COMPLEX_MAX_NATIVE_CHARS:
        return False, ""

    if n_images >= settings.OCR_COMPLEX_MIN_IMAGES:
        return True, f"images_embarquees={n_images}|chars={chars}"

    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    if len(lines) >= 8:
        avg = sum(len(ln) for ln in lines) / len(lines)
        if avg < 28 and chars < settings.OCR_COMPLEX_MAX_NATIVE_CHARS:
            return True, f"texte_fragmente lines={len(lines)} avg_len={avg:.0f}"

    return False, ""


def _merge_native_ocr(native: str, ocr_text: str) -> str:
    """Garde le texte natif et ajoute l'OCR (schémas / logos lus en image)."""
    native = (native or "").strip()
    ocr_text = (ocr_text or "").strip()
    if not ocr_text:
        return native
    if not native:
        return ocr_text
    # Évite de doubler si OCR ≈ natif
    if ocr_text == native or (len(ocr_text) < len(native) * 1.1 and native in ocr_text):
        return native if len(native) >= len(ocr_text) else ocr_text
    return f"{native}\n\n--- OCR (schémas / visuels) ---\n{ocr_text}"


def _extract_pdf(data: bytes) -> list[dict]:
    from pypdf import PdfReader

    stats = get_extract_stats()
    reader = PdfReader(BytesIO(data))
    native: dict[int, str] = {}
    empty_pages: list[int] = []
    complex_pages: list[int] = []
    complex_reasons: dict[int, str] = {}

    for i, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        native[i] = text
        if _needs_ocr(text):
            empty_pages.append(i)
            console.warn(
                f"page {i} scannée / quasi vide → OCR",
                chars_natifs=len(text),
            )
            continue

        stats.native_pages += 1
        is_complex, reason = _is_complex_page(page, text)
        if is_complex:
            complex_pages.append(i)
            complex_reasons[i] = reason
            console.ocr(
                f"page {i} COMPLEXE → OCR (en plus du natif)",
                chars_natifs=len(text),
                reason=reason,
            )
        else:
            console.native(f"page {i} texte simple", chars=len(text))

    ocr_targets = sorted(set(empty_pages) | set(complex_pages))
    if len(ocr_targets) > settings.OCR_MAX_PAGES:
        skipped = ocr_targets[settings.OCR_MAX_PAGES :]
        ocr_targets = ocr_targets[: settings.OCR_MAX_PAGES]
        console.warn(
            f"OCR limité à {settings.OCR_MAX_PAGES} pages (évite blocage CPU)",
            ignorees=skipped,
        )
        stats.details.append(f"OCR_MAX_PAGES={settings.OCR_MAX_PAGES}, ignorées={skipped}")

    ocr_pages: dict[int, str] = {}

    if ocr_targets:
        if not settings.OCR_ENABLED:
            console.warn(
                f"OCR_ENABLED=false — {len(ocr_targets)} page(s) OCR ignorées",
                pages=ocr_targets,
            )
            stats.details.append(f"OCR off: pages {ocr_targets}")
        elif not ocr_mod.ocr_available():
            console.warn(
                f"Mistral OCR indisponible — {len(ocr_targets)} page(s) ignorées",
                pages=ocr_targets,
            )
            stats.details.append(f"OCR indisponible: pages {ocr_targets}")
        else:
            console.ocr(
                f"OCR Mistral sur {len(ocr_targets)} page(s)",
                vides=empty_pages,
                complexes=complex_pages,
                cibles=ocr_targets,
            )
            try:
                ocr_mod.warm_up()
            except Exception:
                console.fail("Mistral OCR indisponible — suite en natif seul")
                stats.details.append("warm_up OCR échoué")
            else:
                try:
                    batch = ocr_mod.ocr_pdf_pages(data, ocr_targets)
                except Exception:
                    console.warn("OCR PDF batch échoué — fallback page par page")
                    logger.exception("[PIPELINE:OCR] batch pdf")
                    batch = {}

                if not batch:
                    # Fallback: rendu PNG + OCR image (si batch PDF échoue)
                    for idx, page_no in enumerate(ocr_targets, start=1):
                        why = (
                            "vide"
                            if page_no in empty_pages
                            else f"complexe:{complex_reasons.get(page_no, '')}"
                        )
                        console.ocr(
                            f"page {page_no} ({idx}/{len(ocr_targets)}) — fallback image",
                            motif=why,
                        )
                        try:
                            png = img_helpers.render_pdf_page(data, page_no)
                            text = ocr_mod.ocr_image_bytes(
                                png, page_label=f"page {page_no}"
                            )
                            if text:
                                batch[page_no] = text
                        except Exception:
                            console.warn(f"page {page_no} OCR échoué — on continue")
                            logger.exception("[PIPELINE:OCR] page=%s", page_no)

                for page_no, text in batch.items():
                    ocr_pages[page_no] = text
                    stats.ocr_pages += 1
                    stats.ocr_used = True
                    console.ocr(
                        f"page {page_no} OK",
                        chars=len(text),
                        preview=truncate(text, 80),
                    )
                missing = [p for p in ocr_targets if p not in ocr_pages]
                if missing:
                    console.warn("pages OCR sans texte", pages=missing)
    else:
        console.info("Aucune page vide ni complexe — OCR non nécessaire")

    pages: list[dict] = []
    for i in sorted(set(native) | set(ocr_pages)):
        nat = native.get(i, "")
        ocr_text = ocr_pages.get(i, "")
        if i in empty_pages and ocr_text:
            content = ocr_text
        elif i in complex_pages and ocr_text:
            content = _merge_native_ocr(nat, ocr_text)
        else:
            content = nat or ocr_text
        pages.append({"content": content, "page_number": i, "section_title": None})

    console.info(
        "PDF résumé",
        pages=len(pages),
        natif=stats.native_pages,
        ocr_vides=len(empty_pages),
        ocr_complexes=len(complex_pages),
        ocr_ok=stats.ocr_pages,
    )
    return pages or [{"content": "", "page_number": 1, "section_title": None}]


def _ocr_embedded(parts: list[dict], images: list[tuple[str, bytes]], *, source: str) -> None:
    stats = get_extract_stats()
    if not images:
        console.info(f"{source}: aucune image embarquée")
        return
    console.info(f"{source}: {len(images)} image(s) embarquée(s)")
    if not settings.OCR_ENABLED:
        console.warn(f"OCR_ENABLED=false — images {source} ignorées", count=len(images))
        stats.details.append(f"OCR off: {len(images)} images {source}")
        return
    if not ocr_mod.ocr_available():
        console.warn(f"OCR indisponible — images {source} ignorées", count=len(images))
        stats.details.append(f"OCR indisponible: {len(images)} images {source}")
        return

    for idx, (name, blob) in enumerate(images, start=1):
        try:
            suffix = "." + name.rsplit(".", 1)[-1].lower()
            text = ocr_mod.ocr_image_bytes(blob, suffix=suffix)
            chars = len(text or "")
            if text:
                stats.ocr_images += 1
                stats.ocr_used = True
                console.ocr(
                    f"{source} image {idx}/{len(images)}",
                    name=name,
                    chars=chars,
                    preview=truncate(text, 80),
                )
                parts.append(
                    {
                        "content": text,
                        "page_number": None,
                        "section_title": f"image:{name}",
                    }
                )
            else:
                console.warn(f"{source} image OCR vide", name=name)
        except Exception:
            console.fail(f"{source} OCR image échoué", name=name)
            raise


def _extract_docx(data: bytes) -> list[dict]:
    from docx import Document as DocxDocument

    stats = get_extract_stats()
    doc = DocxDocument(BytesIO(data))
    paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    text = "\n\n".join(paragraphs)
    parts: list[dict] = []
    if text.strip():
        stats.native_pages = 1
        console.native("DOCX texte", paragraphs=len(paragraphs), chars=len(text))
        parts.append({"content": text, "page_number": 1, "section_title": None})
    else:
        console.warn("DOCX sans texte natif")

    before = len(parts)
    _ocr_embedded(parts, img_helpers.extract_docx_images(data), source="docx")
    console.info(
        "DOCX résumé",
        blocs_natifs=1 if text.strip() else 0,
        blocs_ocr=len(parts) - before,
    )
    return parts or [{"content": "", "page_number": 1, "section_title": None}]


def _extract_xlsx(data: bytes) -> list[dict]:
    from openpyxl import load_workbook

    stats = get_extract_stats()
    wb = load_workbook(BytesIO(data), read_only=True, data_only=True)
    chunks: list[dict] = []
    for sheet in wb.worksheets:
        rows = []
        for row in sheet.iter_rows(values_only=True):
            line = " | ".join("" if c is None else str(c) for c in row).strip(" |")
            if line:
                rows.append(line)
        if rows:
            content = "\n".join(rows)
            stats.native_pages += 1
            console.native(f"feuille « {sheet.title} »", rows=len(rows), chars=len(content))
            chunks.append(
                {
                    "content": content,
                    "page_number": None,
                    "section_title": sheet.title,
                }
            )

    native_count = len(chunks)
    _ocr_embedded(chunks, img_helpers.extract_xlsx_images(data), source="xlsx")
    console.info(
        "XLSX résumé",
        feuilles_natives=native_count,
        blocs_ocr=len(chunks) - native_count,
    )
    return chunks or [{"content": "", "page_number": None, "section_title": None}]


def _extract_image(data: bytes, filename: str) -> list[dict]:
    stats = get_extract_stats()
    if not settings.OCR_ENABLED:
        console.fail("OCR_ENABLED=false — image refusée", file=filename)
        raise ValueError("OCR désactivé — impossible d'indexer une image")
    if not ocr_mod.ocr_available():
        console.fail("PaddleOCR-VL indisponible — image refusée", file=filename)
        raise RuntimeError("PaddleOCR-VL indisponible — impossible d'indexer une image")

    suffix = ".png"
    for ext in (".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"):
        if filename.endswith(ext):
            suffix = ext
            break
    text = ocr_mod.ocr_image_bytes(data, suffix=suffix) or ""
    stats.ocr_used = True
    stats.ocr_images = 1
    console.ocr("image seule", file=filename, chars=len(text), preview=truncate(text, 80))
    return [{"content": text, "page_number": 1, "section_title": None}]
