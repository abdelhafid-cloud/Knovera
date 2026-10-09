"""Orchestration indexation d'un document."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from uuid import UUID

from pipeline.app.chunking import chunk_pages
from pipeline.app.config import settings
from pipeline.app.console import console, get_extract_stats
from pipeline.app.db import get_session
from pipeline.app.embeddings import get_embedding_provider
from pipeline.app.events import publish_pipeline_event
from pipeline.app.extract import extract_document
from pipeline.app.logging_config import ms_since, reset_doc_context, set_doc_context
from pipeline.app.models import Document, DocumentChunk, KnowledgeBase, Organization
from pipeline.app.storage import download_bytes
from pipeline.app.vectorstore import QdrantVectorStore, new_point_id


def _resolve_doc_bucket(session, doc: Document) -> str:
    if doc.storage_bucket:
        return doc.storage_bucket
    org = session.get(Organization, doc.organization_id)
    if org and org.minio_bucket:
        return org.minio_bucket
    return settings.MINIO_BUCKET


def _resolve_qdrant_collection(session, doc: Document) -> str | None:
    if not doc.knowledge_base_id:
        return None
    kb = session.get(KnowledgeBase, doc.knowledge_base_id)
    return kb.qdrant_collection if kb else None

_raw = logging.getLogger(__name__)
STEPS = 6


def process_document(document_id: str) -> None:
    session = get_session()
    tokens = None
    try:
        doc = session.get(Document, UUID(document_id))
        if not doc or doc.status == "deleted":
            _raw.warning("[PIPELINE:SKIP] introuvable/supprimé | id=%s", document_id)
            return

        doc_label = doc.name
        tokens = set_doc_context(str(doc.id), doc_label)
        timings: dict[str, float] = {}
        t_total = time.perf_counter()

        console.banner(f"INDEXATION — {doc_label}")
        console.info(
            "document",
            id=str(doc.id),
            mime=doc.mime_type,
            size=doc.size_bytes,
            ocr_enabled=settings.OCR_ENABLED,
            engine=settings.OCR_ENGINE,
        )
        if not settings.OCR_ENABLED:
            console.warn("OCR_ENABLED=false — scans/images sans texte natif non indexés")

        doc.status = "processing"
        doc.error_message = None
        session.commit()
        org_id = str(doc.organization_id)

        def _emit(event: str, *, step: str | None = None, **extra):
            payload = {
                "document_id": str(doc.id),
                "document_name": doc_label,
                "organization_id": org_id,
                "status": doc.status,
                **extra,
            }
            if step:
                payload["pipeline_step"] = step
            publish_pipeline_event(event, payload)

        _emit("processing", step="queued")

        try:
            # 1 DOWNLOAD
            console.step(1, STEPS, "Téléchargement MinIO")
            _emit("processing", step="download")
            t0 = time.perf_counter()
            bucket = _resolve_doc_bucket(session, doc)
            collection = _resolve_qdrant_collection(session, doc)
            console.info("stockage", bucket=bucket, qdrant_collection=collection or settings.QDRANT_COLLECTION)
            raw = download_bytes(doc.storage_key, bucket=bucket)
            timings["download"] = ms_since(t0)
            console.ok("Download OK", bytes=len(raw), took_ms=timings["download"])

            # 2 EXTRACT
            console.step(2, STEPS, "Extraction texte / OCR")
            _emit("processing", step="ocr")
            t0 = time.perf_counter()
            pages = extract_document(raw, doc.mime_type, doc.name)
            doc.page_count = len([p for p in pages if p.get("page_number")])
            timings["extract"] = ms_since(t0)
            console.ocr_summary(get_extract_stats())
            console.ok(
                "Extract OK",
                pages=len(pages),
                chars=sum(len(p.get("content") or "") for p in pages),
                took_ms=timings["extract"],
            )

            # 3 CHUNK — utilise rag_settings de la KB si présents
            console.step(3, STEPS, "Chunking")
            _emit("processing", step="chunk")
            t0 = time.perf_counter()
            chunk_size = settings.CHUNK_SIZE
            overlap = settings.CHUNK_OVERLAP
            if doc.knowledge_base_id:
                kb_row = session.get(KnowledgeBase, doc.knowledge_base_id)
                rag = (kb_row.rag_settings or {}) if kb_row else {}
                try:
                    if rag.get("chunk_size"):
                        chunk_size = int(rag["chunk_size"])
                    if rag.get("overlap") is not None:
                        overlap = int(rag["overlap"])
                except (TypeError, ValueError):
                    pass
            chunks_data = chunk_pages(
                pages,
                chunk_size=chunk_size,
                overlap=overlap,
            )
            timings["chunk"] = ms_since(t0)
            console.ok(
                "Chunk OK",
                chunks=len(chunks_data),
                size=chunk_size,
                overlap=overlap,
                took_ms=timings["chunk"],
            )

            # 4 PURGE
            console.step(4, STEPS, "Purge anciens vecteurs / chunks")
            _emit("processing", step="purge")
            store = QdrantVectorStore(collection_name=collection)
            store.delete_by_document(str(doc.organization_id), str(doc.id))
            deleted = session.query(DocumentChunk).filter_by(document_id=doc.id).delete()
            session.flush()
            console.ok("Purge OK", chunks_deleted=deleted)

            if not chunks_data:
                doc.status = "failed"
                doc.error_message = "Aucun texte extractible"
                session.commit()
                console.fail("Aucun texte extractible")
                _emit("failed", step="chunk", error=doc.error_message, status="failed")
                return

            # 5 EMBED
            console.step(5, STEPS, "Embeddings Cohere")
            _emit("processing", step="embed")
            t0 = time.perf_counter()
            embedder = get_embedding_provider()
            texts = [c["content"] for c in chunks_data]
            batch_size = 32
            n_batches = (len(texts) + batch_size - 1) // batch_size
            console.info(
                "embed",
                model=embedder.model,
                dim=embedder.dimension,
                texts=len(texts),
                batches=n_batches,
            )
            vectors: list[list[float]] = []
            for i in range(0, len(texts), batch_size):
                tb = time.perf_counter()
                batch = texts[i : i + batch_size]
                vectors.extend(embedder.embed_documents(batch))
                console.ok(
                    f"batch {i + 1}–{min(i + batch_size, len(texts))} / {len(texts)}",
                    took_ms=ms_since(tb),
                )
            timings["embed"] = ms_since(t0)
            console.ok("Embed OK", vectors=len(vectors), took_ms=timings["embed"])

            # 6 PERSIST
            console.step(6, STEPS, "Persist Postgres + Qdrant")
            _emit("processing", step="index")
            t0 = time.perf_counter()
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
                session.add(chunk)
                session.flush()
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
            store.upsert_chunks(points)
            doc.status = "indexed"
            doc.indexed_at = datetime.now(timezone.utc)
            session.commit()
            timings["persist"] = ms_since(t0)
            console.ok("Persist OK", points=len(points), took_ms=timings["persist"])

            _emit("indexed", step="done", status="indexed", chunks=len(points))

            stats = get_extract_stats()
            console.done(
                "INDEXÉ AVEC SUCCÈS",
                chunks=len(points),
                total_ms=ms_since(t_total),
                ocr="OUI" if stats.ocr_used else "NON",
                **{k: f"{v}ms" for k, v in timings.items()},
            )
        except Exception as exc:
            console.fail(f"ÉCHEC — {str(exc)[:200]}")
            _raw.exception("[PIPELINE:FAIL] %s", str(exc)[:300])
            try:
                session.rollback()
                doc = session.get(Document, UUID(document_id))
                if doc:
                    doc.status = "failed"
                    doc.error_message = str(exc)[:1000]
                    session.commit()
            except Exception:
                _raw.exception("[PIPELINE:FAIL] Impossible de marquer failed en DB")
                session.rollback()
            publish_pipeline_event(
                "failed",
                {
                    "document_id": str(doc.id) if doc else document_id,
                    "document_name": doc_label,
                    "organization_id": str(doc.organization_id) if doc else None,
                    "status": "failed",
                    "pipeline_step": "failed",
                    "error": str(exc)[:1000],
                },
            )
    finally:
        if tokens is not None:
            reset_doc_context(tokens)
        session.close()
