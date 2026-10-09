"""Nommage / provisioning MinIO (bucket org) + Qdrant (collection par KB)."""

from __future__ import annotations

import logging
import re
from uuid import UUID

from flask import current_app
from sqlalchemy import func

from app.extensions import db
from app.models import KnowledgeBase, Organization

logger = logging.getLogger(__name__)


def _slug_token(value: str, *, max_len: int = 40) -> str:
    raw = (value or "").strip().lower()
    raw = re.sub(r"[^a-z0-9]+", "-", raw).strip("-")
    if not raw:
        raw = "org"
    return raw[:max_len].strip("-") or "org"


def default_minio_bucket_for_org(org: Organization) -> str:
    """Nom de bucket S3/MinIO valide (3–63, minuscules)."""
    token = _slug_token(org.slug or org.name, max_len=48)
    # Préfixe court + slug — unique grâce au slug org
    name = f"kb-{token}"
    if len(name) < 3:
        name = f"kb-{str(org.id).replace('-', '')[:12]}"
    return name[:63]


def qdrant_collection_for(org: Organization, vector_db_number: int) -> str:
    """Collection Qdrant par KB : vdb_{n}_{org_slug}."""
    token = _slug_token(org.slug or str(org.id), max_len=48)
    # Qdrant: lettres, chiffres, underscore, tiret
    name = f"vdb_{int(vector_db_number)}_{token}".replace("-", "_")
    return re.sub(r"[^a-zA-Z0-9_]", "_", name)[:255]


def next_vector_db_number(organization_id: UUID) -> int:
    current = (
        db.session.query(func.coalesce(func.max(KnowledgeBase.vector_db_number), 0))
        .filter(KnowledgeBase.organization_id == organization_id)
        .scalar()
    )
    return int(current or 0) + 1


def ensure_minio_bucket(bucket: str) -> str:
    """Crée le bucket MinIO s'il n'existe pas (avatars, logos, fallback global)."""
    name = (bucket or "").strip()
    if not name:
        raise ValueError("Nom de bucket MinIO requis")
    from app.services.documents.service import get_s3_client

    client = get_s3_client()
    existing = {b["Name"] for b in client.list_buckets().get("Buckets", [])}
    if name not in existing:
        client.create_bucket(Bucket=name)
        logger.info("[STORAGE] MinIO bucket créé | bucket=%s", name)
    return name


def ensure_org_minio_bucket(org: Organization, *, create: bool = True) -> str:
    """Garantit org.minio_bucket et crée le bucket MinIO si besoin."""
    bucket = (org.minio_bucket or "").strip()
    if not bucket:
        bucket = default_minio_bucket_for_org(org)
        org.minio_bucket = bucket
        db.session.add(org)
        db.session.flush()

    if create:
        try:
            ensure_minio_bucket(bucket)
        except Exception:
            logger.exception(
                "[STORAGE] Impossible de créer le bucket MinIO | bucket=%s | org=%s",
                bucket,
                org.id,
            )
    return bucket


def resolve_org_bucket(org: Organization | None) -> str:
    if org and (org.minio_bucket or "").strip():
        return org.minio_bucket.strip()
    if org:
        return ensure_org_minio_bucket(org, create=False)
    return current_app.config.get("MINIO_BUCKET") or "rag-documents"


def resolve_document_bucket(doc, org: Organization | None = None) -> str:
    """Bucket effectif pour un document (legacy → config globale)."""
    stored = getattr(doc, "storage_bucket", None)
    if stored:
        return stored
    if org is None and getattr(doc, "organization_id", None):
        org = db.session.get(Organization, doc.organization_id)
    return resolve_org_bucket(org)


def ensure_qdrant_collection(collection_name: str) -> None:
    from app.services.rag.vectorstore import QdrantVectorStore

    store = QdrantVectorStore(collection_name=collection_name)
    store.ensure_collection()


def provisioning_preview(org: Organization) -> dict:
    n = next_vector_db_number(org.id)
    bucket = resolve_org_bucket(org)
    collection = qdrant_collection_for(org, n)
    return {
        "next_vector_db_number": n,
        "vector_db_label": f"Collection #{n}",
        "qdrant_collection": collection,
        "minio_bucket": bucket,
        "organization_id": str(org.id),
        "organization_name": org.name,
        "organization_slug": org.slug,
    }


def provision_knowledge_base(
    org: Organization,
    *,
    name: str,
    description: str | None,
    created_by,
    rag_settings: dict | None = None,
) -> KnowledgeBase:
    ensure_org_minio_bucket(org, create=True)
    n = next_vector_db_number(org.id)
    collection = qdrant_collection_for(org, n)
    if rag_settings is None:
        try:
            from app.services.platform_settings import default_rag_settings

            rag_settings = default_rag_settings()
        except Exception:
            rag_settings = {"chunk_size": 800, "overlap": 120, "top_k": 5}
    kb = KnowledgeBase(
        organization_id=org.id,
        name=name,
        description=description,
        rag_settings=rag_settings,
        created_by=created_by,
        vector_db_number=n,
        qdrant_collection=collection,
    )
    db.session.add(kb)
    db.session.flush()
    try:
        ensure_qdrant_collection(collection)
    except Exception:
        logger.exception(
            "[STORAGE] Création collection Qdrant différée | collection=%s | kb=%s",
            collection,
            kb.id,
        )
    return kb


def backfill_org_and_kb_storage() -> None:
    """Assigne bucket / vector_db / collection aux entités existantes."""
    orgs = db.session.query(Organization).all()
    for org in orgs:
        if not (org.minio_bucket or "").strip():
            org.minio_bucket = default_minio_bucket_for_org(org)
            try:
                ensure_org_minio_bucket(org, create=True)
            except Exception:
                logger.exception("backfill bucket org=%s", org.id)

        kbs = (
            db.session.query(KnowledgeBase)
            .filter_by(organization_id=org.id)
            .order_by(KnowledgeBase.created_at.asc())
            .all()
        )
        n = 0
        for kb in kbs:
            if not kb.vector_db_number:
                n += 1
                kb.vector_db_number = n
            else:
                n = max(n, int(kb.vector_db_number))
            if not (kb.qdrant_collection or "").strip():
                kb.qdrant_collection = qdrant_collection_for(org, int(kb.vector_db_number))
    db.session.commit()
