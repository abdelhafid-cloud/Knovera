from pipeline.app.logging_config import get_doc_logger

logger = get_doc_logger(__name__)


def chunk_pages(pages: list[dict], chunk_size: int = 800, overlap: int = 120) -> list[dict]:
    chunks: list[dict] = []
    index = 0
    for page in pages:
        text = (page.get("content") or "").strip()
        if not text:
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
    logger.info(
        "[PIPELINE:CHUNK] in_pages=%s | out_chunks=%s | size=%s | overlap=%s",
        len(pages),
        len(chunks),
        chunk_size,
        overlap,
    )
    return chunks
