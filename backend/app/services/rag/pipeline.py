import logging
import time
from datetime import datetime, timezone
from uuid import UUID

from flask import current_app

from app.extensions import db
from app.logging_config import (
    get_doc_logger,
    ms_since,
    reset_doc_context,
    set_doc_context,
    truncate,
)
from app.models import Document, DocumentChunk
from app.services.documents.service import download_document_bytes
from app.services.pipeline_events import publish_pipeline_event
from app.services.rag.chunking import chunk_pages
from app.services.rag.embeddings import get_embedding_provider
from app.services.rag.parsers import extract_text
from app.services.rag.vectorstore import QdrantVectorStore, new_point_id

logger = get_doc_logger(__name__)
_raw = logging.getLogger(__name__)


def process_document(document_id: str):
    doc = db.session.get(Document, UUID(document_id))
    if not doc or doc.status == "deleted":
        _raw.warning(
            "[PIPELINE:SKIP] Document introuvable ou supprimé | id=%s", document_id
        )
        return

    redis_url = current_app.config["REDIS_URL"]
    doc_label = doc.name
    tokens = set_doc_context(str(doc.id), doc_label)
    timings: dict[str, float] = {}
    t_total = time.perf_counter()

    try:
        logger.info(
            "[PIPELINE:START] DOC ACTIF | mime=%s | size_bytes=%s | kb=%s | storage_key=%s",
            doc.mime_type,
            doc.size_bytes,
            doc.knowledge_base_id,
            doc.storage_key,
        )

        doc.status = "processing"
        doc.error_message = None
        db.session.commit()
        publish_pipeline_event(
            redis_url,
            "processing",
            {
                "document_id": str(doc.id),
                "document_name": doc_label,
                "status": "processing",
            },
        )

        try:
            # --- 1 DOWNLOAD ---
            t0 = time.perf_counter()
            logger.info("[PIPELINE:DOWNLOAD] Téléchargement MinIO…")
            raw = download_document_bytes(doc)
            timings["download"] = ms_since(t0)
            logger.info(
                "[PIPELINE:DOWNLOAD] OK | bytes=%s | took=%sms",
                len(raw),
                timings["download"],
            )

            # --- 2 EXTRACT ---
            t0 = time.perf_counter()
            logger.info(
                "[PIPELINE:EXTRACT] Extraction texte… | mime=%s",
                doc.mime_type,
            )
            pages = extract_text(raw, doc.mime_type, doc.name)
            doc.page_count = len([p for p in pages if p.get("page_number")])
            total_chars = sum(len((p.get("content") or "")) for p in pages)
            empty_pages = sum(1 for p in pages if not (p.get("content") or "").strip())
            timings["extract"] = ms_since(t0)
            logger.info(
                "[PIPELINE:EXTRACT] OK | pages=%s | page_count=%s | chars=%s | empty=%s | took=%sms",
                len(pages),
                doc.page_count,
                total_chars,
                empty_pages,
                timings["extract"],
            )
            if empty_pages:
                logger.warning(
                    "[PIPELINE:EXTRACT] pages vides=%s | took=%sms",
                    empty_pages,
                    timings["extract"],
                )
            for p in pages:
                logger.debug(
                    "[PIPELINE:EXTRACT] page=%s | chars=%s | preview=%r",
                    p.get("page_number") or p.get("section_title"),
                    len(p.get("content") or ""),
                    truncate(p.get("content")),
                )

            # --- 3 CHUNK ---
            t0 = time.perf_counter()
            chunk_size, overlap = 800, 120
            logger.info(
                "[PIPELINE:CHUNK] Chunking… | strategy=char_overlap | chunk_size=%s | overlap=%s",
                chunk_size,
                overlap,
            )
            chunks_data = chunk_pages(pages, chunk_size=chunk_size, overlap=overlap)
            avg_len = (
                round(sum(len(c["content"]) for c in chunks_data) / len(chunks_data), 1)
                if chunks_data
                else 0
            )
            timings["chunk"] = ms_since(t0)
            logger.info(
                "[PIPELINE:CHUNK] OK | chunks=%s | avg_chars=%s | took=%sms",
                len(chunks_data),
                avg_len,
                timings["chunk"],
            )
            for c in chunks_data:
                logger.debug(
                    "[PIPELINE:CHUNK] idx=%s | page=%s | chars=%s | preview=%r",
                    c.get("chunk_index"),
                    c.get("page_number"),
                    len(c.get("content") or ""),
                    truncate(c.get("content")),
                )

            # --- 4 PURGE ---
            t0 = time.perf_counter()
            logger.info("[PIPELINE:PURGE] Suppression anciens vecteurs / chunks DB…")
            store = QdrantVectorStore()
            store.delete_by_document(str(doc.organization_id), str(doc.id))
            deleted = (
                db.session.query(DocumentChunk).filter_by(document_id=doc.id).delete()
            )
            db.session.flush()
            timings["purge"] = ms_since(t0)
            logger.info(
                "[PIPELINE:PURGE] OK | db_chunks_deleted=%s | collection=%s | took=%sms",
                deleted,
                store.collection,
                timings["purge"],
            )

            if not chunks_data:
                doc.status = "failed"
                doc.error_message = "Aucun texte extractible"
                db.session.commit()
                logger.error(
                    "[PIPELINE:FAIL] Aucun texte extractible | took=%sms",
                    ms_since(t_total),
                )
                publish_pipeline_event(
                    redis_url,
                    "failed",
                    {
                        "document_id": str(doc.id),
                        "document_name": doc_label,
                        "status": "failed",
                        "error": doc.error_message,
                    },
                )
                return

            # --- 5 EMBED ---
            t0 = time.perf_counter()
            embedder = get_embedding_provider()
            texts = [c["content"] for c in chunks_data]
            batch_size = 32
            n_batches = (len(texts) + batch_size - 1) // batch_size
            logger.info(
                "[PIPELINE:EMBED] Embeddings… | model=%s | dim=%s | texts=%s | batch_size=%s | batches=%s",
                getattr(embedder, "model", "?"),
                embedder.dimension,
                len(texts),
                batch_size,
                n_batches,
            )
            vectors = []
            for i in range(0, len(texts), batch_size):
                batch = texts[i : i + batch_size]
                tb = time.perf_counter()
                vectors.extend(embedder.embed_documents(batch))
                logger.info(
                    "[PIPELINE:EMBED] batch %s–%s / %s | took=%sms",
                    i + 1,
                    min(i + batch_size, len(texts)),
                    len(texts),
                    ms_since(tb),
                )
            timings["embed"] = ms_since(t0)
            logger.info(
                "[PIPELINE:EMBED] OK | vectors=%s | took=%sms",
                len(vectors),
                timings["embed"],
            )

            # --- 6 PERSIST ---
            t0 = time.perf_counter()
            logger.info(
                "[PIPELINE:PERSIST] Postgres + Qdrant… | collection=%s",
                store.collection,
            )
            points = []
            for chunk_meta, vector in zip(chunks_data, vectors):
                point_id = new_point_id()
                chunk = DocumentChunk(
                    document_id=doc.id,
                    organization_id=doc.organization_id,
                    knowledge_base_id=doc.knowledge_base_id,
                    chunk_index=chunk_meta["chunk_index"],
                    content=chunk_meta["content"],
                    token_count=chunk_meta.get("token_count"),
                    page_number=chunk_meta.get("page_number"),
                    section_title=chunk_meta.get("section_title"),
                    meta={},
                    qdrant_point_id=point_id,
                )
                db.session.add(chunk)
                db.session.flush()
                points.append(
                    {
                        "id": point_id,
                        "vector": vector,
                        "payload": {
                            "organization_id": str(doc.organization_id),
                            "knowledge_base_id": str(doc.knowledge_base_id)
                            if doc.knowledge_base_id
                            else "",
                            "document_id": str(doc.id),
                            "chunk_id": str(chunk.id),
                            "document_name": doc.name,
                            "page_number": chunk.page_number,
                            "section_title": chunk.section_title,
                            "content": chunk.content[:2000],
                            "document_status": "indexed",
                        },
                    }
                )
                logger.debug(
                    "[PIPELINE:PERSIST] chunk_id=%s | point_id=%s | idx=%s | page=%s",
                    chunk.id,
                    point_id,
                    chunk.chunk_index,
                    chunk.page_number,
                )

            store.upsert_chunks(points)
            doc.status = "indexed"
            doc.indexed_at = datetime.now(timezone.utc)
            db.session.commit()
            timings["persist"] = ms_since(t0)
            logger.info(
                "[PIPELINE:PERSIST] OK | status=indexed | vectors_upserted=%s | collection=%s | took=%sms",
                len(points),
                store.collection,
                timings["persist"],
            )

            publish_pipeline_event(
                redis_url,
                "indexed",
                {
                    "document_id": str(doc.id),
                    "document_name": doc_label,
                    "status": "indexed",
                    "chunks": len(points),
                },
            )

            detail = " ".join(f"{k}={v}ms" for k, v in timings.items())
            logger.info(
                "[PIPELINE:DONE] SUCCÈS | status=indexed | chunks=%s | total=%sms | %s",
                len(points),
                ms_since(t_total),
                detail,
            )
        except Exception as exc:
            logger.exception(
                "[PIPELINE:FAIL] ÉCHEC | error=%s | took=%sms",
                str(exc)[:300],
                ms_since(t_total),
            )
            doc.status = "failed"
            doc.error_message = str(exc)[:1000]
            db.session.commit()
            publish_pipeline_event(
                redis_url,
                "failed",
                {
                    "document_id": str(doc.id),
                    "document_name": doc_label,
                    "status": "failed",
                    "error": doc.error_message,
                },
            )
    finally:
        reset_doc_context(tokens)
