from app.logging_config import get_doc_logger

logger = get_doc_logger(__name__)


def chunk_pages(pages: list[dict], chunk_size: int = 800, overlap: int = 120) -> list[dict]:
    """Simple character-based chunking with overlap."""
    chunks = []
    index = 0
    skipped_empty = 0
    for page in pages:
        text = (page.get("content") or "").strip()
        if not text:
            skipped_empty += 1
            continue
        start = 0
        while start < len(text):
            end = min(start + chunk_size, len(text))
            piece = text[start:end].strip()
            if piece:
                chunks.append(
                    {
                        "chunk_index": index,
                        "content": piece,
                        "page_number": page.get("page_number"),
                        "section_title": page.get("section_title"),
                        "token_count": max(1, len(piece) // 4),
                    }
                )
                index += 1
            if end >= len(text):
                break
            start = max(end - overlap, start + 1)
    if skipped_empty:
        logger.warning(
            "[PIPELINE:CHUNK] pages vides ignorées=%s",
            skipped_empty,
        )
    logger.info(
        "[PIPELINE:CHUNK] strategy=char_overlap | chunk_size=%s | overlap=%s | in_pages=%s | out_chunks=%s",
        chunk_size,
        overlap,
        len(pages),
        len(chunks),
    )
    return chunks
