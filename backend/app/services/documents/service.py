import hashlib
import io
import logging
from uuid import UUID, uuid4

import boto3
from botocore.client import Config
from flask import current_app
from werkzeug.utils import secure_filename

from app.extensions import db
from app.models import Document, DocumentChunk, KnowledgeBase

logger = logging.getLogger(__name__)

MIME_MAP = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=f"{'https' if current_app.config['MINIO_SECURE'] else 'http'}://{current_app.config['MINIO_ENDPOINT']}",
        aws_access_key_id=current_app.config["MINIO_ACCESS_KEY"],
        aws_secret_access_key=current_app.config["MINIO_SECRET_KEY"],
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )


def document_to_dict(doc: Document, *, include_storage: bool = False, include_minio_url: bool = False):
    data = {
        "id": str(doc.id),
        "organization_id": str(doc.organization_id),
        "knowledge_base_id": str(doc.knowledge_base_id) if doc.knowledge_base_id else None,
        "uploaded_by": str(doc.uploaded_by) if doc.uploaded_by else None,
        "name": doc.name,
        "mime_type": doc.mime_type,
        "size_bytes": doc.size_bytes,
        "status": doc.status,
        "error_message": doc.error_message,
        "page_count": doc.page_count,
        "cloud_url": doc.cloud_url,
        "source_url": doc.source_url,
        "indexed_at": doc.indexed_at.isoformat() if doc.indexed_at else None,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
    }
    if include_storage or include_minio_url:
        bucket = current_app.config["MINIO_BUCKET"]
        key = doc.storage_key or ""
        data["bucket"] = bucket
        data["storage_key"] = key
        data["file_name"] = key.rsplit("/", 1)[-1] if key else None
        scheme = "https" if current_app.config["MINIO_SECURE"] else "http"
        endpoint = current_app.config["MINIO_ENDPOINT"]
        data["minio_object_path"] = f"{bucket}/{key}" if key else None
        data["minio_console_hint"] = f"{scheme}://{endpoint}/{bucket}/{key}" if key else None
    if include_minio_url:
        data["minio_url"] = generate_presigned_url(doc)
    return data


def generate_presigned_url(doc: Document, expires_in: int = 3600) -> str | None:
    if not doc.storage_key:
        return None
    client = get_s3_client()
    return client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": current_app.config["MINIO_BUCKET"],
            "Key": doc.storage_key,
            "ResponseContentDisposition": f'inline; filename="{doc.name}"',
            "ResponseContentType": doc.mime_type or "application/octet-stream",
        },
        ExpiresIn=expires_in,
    )


def kb_to_dict(kb: KnowledgeBase):
    return {
        "id": str(kb.id),
        "organization_id": str(kb.organization_id),
        "name": kb.name,
        "description": kb.description,
        "rag_settings": kb.rag_settings or {},
        "created_by": str(kb.created_by) if kb.created_by else None,
        "created_at": kb.created_at.isoformat() if kb.created_at else None,
        "updated_at": kb.updated_at.isoformat() if kb.updated_at else None,
        "document_count": len(kb.documents) if kb.documents is not None else None,
    }


def validate_upload(filename: str, size: int):
    if not filename or "." not in filename:
        return False, "Nom de fichier invalide"
    ext = filename.rsplit(".", 1)[-1].lower()
    allowed = current_app.config["ALLOWED_EXTENSIONS"]
    if ext not in allowed:
        return False, f"Extension non autorisée. Autorisées: {', '.join(sorted(allowed))}"
    max_bytes = current_app.config["MAX_UPLOAD_SIZE_MB"] * 1024 * 1024
    if size > max_bytes:
        return False, f"Fichier trop volumineux (max {current_app.config['MAX_UPLOAD_SIZE_MB']} Mo)"
    return True, ext


def upload_document(
    organization_id: UUID,
    knowledge_base_id: UUID | None,
    user_id: UUID,
    file_storage,
    *,
    display_name: str | None = None,
    cloud_url: str | None = None,
    source_url: str | None = None,
):
    from app.models import Organization
    from app.services.organizations import quotas as quota_service

    filename = secure_filename(file_storage.filename or "document")
    data = file_storage.read()
    ok, ext_or_err = validate_upload(filename, len(data))
    if not ok:
        return None, ext_or_err
    ext = ext_or_err

    org = db.session.get(Organization, organization_id)
    if not org or org.status == "deleted":
        return None, "Organisation introuvable"
    if org.status == "suspended":
        return None, "Organisation suspendue"

    ok_docs, err_docs = quota_service.check_quota(org, "documents", 1)
    if not ok_docs:
        return None, err_docs
    ok_storage, err_storage = quota_service.check_quota(org, "storage_bytes", len(data))
    if not ok_storage:
        return None, err_storage

    if knowledge_base_id:
        kb = db.session.get(KnowledgeBase, knowledge_base_id)
        if not kb or kb.organization_id != organization_id:
            return None, "Knowledge base introuvable"

    checksum = hashlib.sha256(data).hexdigest()
    doc_id = uuid4()
    storage_key = f"{organization_id}/{doc_id}/{filename}"

    client = get_s3_client()
    bucket = current_app.config["MINIO_BUCKET"]
    name = (display_name or "").strip() or filename
    name = name[:500]
    mime = MIME_MAP.get(ext, file_storage.mimetype or "application/octet-stream")
    import time

    from app.logging_config import ms_since

    t_upload = time.perf_counter()
    logger.info(
        "[BACKEND:UPLOAD] reçu | doc=%s | id=%s | size=%s | ext=%s | mime=%s | kb=%s | org=%s",
        name,
        doc_id,
        len(data),
        ext,
        mime,
        knowledge_base_id,
        organization_id,
    )

    try:
        t0 = time.perf_counter()
        client.put_object(
            Bucket=bucket,
            Key=storage_key,
            Body=data,
            ContentType=mime,
        )
        logger.info(
            "[BACKEND:UPLOAD] MinIO OK | bucket=%s | key=%s | checksum=%s… | took=%sms",
            bucket,
            storage_key,
            checksum[:12],
            ms_since(t0),
        )
    except Exception as exc:
        logger.exception(
            "[BACKEND:UPLOAD] MinIO failed | doc=%s | id=%s", name, doc_id
        )
        return None, f"Erreur stockage: {exc}"

    cloud = (cloud_url or "").strip() or None
    source = (source_url or "").strip() or None
    if cloud and len(cloud) > 2000:
        return None, "Lien cloud trop long"
    if source and len(source) > 2000:
        return None, "Lien source trop long"

    doc = Document(
        id=doc_id,
        organization_id=organization_id,
        knowledge_base_id=knowledge_base_id,
        uploaded_by=user_id,
        name=name,
        mime_type=mime,
        size_bytes=len(data),
        storage_key=storage_key,
        checksum_sha256=checksum,
        cloud_url=cloud,
        source_url=source,
        status="pending",
    )
    db.session.add(doc)
    db.session.commit()
    logger.info(
        "[BACKEND:UPLOAD] DB pending | doc=%s | id=%s | status=pending | took=%sms → enqueue…",
        doc.name,
        doc.id,
        ms_since(t_upload),
    )

    try:
        from app.workers.document_processor import enqueue_document_processing

        enqueue_document_processing(str(doc.id), document_name=doc.name)
    except Exception as exc:
        logger.exception("[BACKEND:UPLOAD] Failed to enqueue | doc=%s | id=%s", doc.name, doc.id)
        doc.status = "failed"
        doc.error_message = str(exc)[:1000]
        db.session.commit()
        return None, str(exc)

    logger.info(
        "[BACKEND:UPLOAD] DONE | doc=%s | id=%s | total=%sms | en attente callback pipeline",
        doc.name,
        doc.id,
        ms_since(t_upload),
    )
    return doc, None


def download_document_bytes(doc: Document) -> bytes:
    import time

    from app.logging_config import get_doc_logger, ms_since

    log = get_doc_logger(__name__)
    t0 = time.perf_counter()
    client = get_s3_client()
    bucket = current_app.config["MINIO_BUCKET"]
    log.info(
        "[PIPELINE:DOWNLOAD] MinIO get_object | bucket=%s | key=%s",
        bucket,
        doc.storage_key,
    )
    obj = client.get_object(Bucket=bucket, Key=doc.storage_key)
    data = obj["Body"].read()
    log.info(
        "[PIPELINE:DOWNLOAD] MinIO OK | bytes=%s | took=%sms",
        len(data),
        ms_since(t0),
    )
    return data


def update_document_meta(
    doc: Document,
    *,
    name: str | None = None,
    cloud_url: str | None = ...,
    source_url: str | None = ...,
):
    """Update display metadata. Pass Ellipsis to leave a field unchanged; None clears URLs."""
    if name is not None:
        trimmed = name.strip()
        if not trimmed:
            return None, "Nom requis"
        doc.name = trimmed[:500]
    if cloud_url is not ...:
        cloud = (cloud_url or "").strip() or None
        if cloud and len(cloud) > 2000:
            return None, "Lien cloud trop long"
        doc.cloud_url = cloud
    if source_url is not ...:
        source = (source_url or "").strip() or None
        if source and len(source) > 2000:
            return None, "Lien source trop long"
        doc.source_url = source
    db.session.commit()
    return doc, None


def soft_delete_document(doc: Document):
    doc.status = "deleted"
    db.session.commit()
    try:
        from app.services.rag.vectorstore import QdrantVectorStore

        store = QdrantVectorStore()
        store.delete_by_document(str(doc.organization_id), str(doc.id))
    except Exception:
        logger.exception("Failed to purge Qdrant points for document %s", doc.id)

    db.session.query(DocumentChunk).filter_by(document_id=doc.id).delete()
    db.session.commit()
    return doc


def delete_knowledge_base(kb: KnowledgeBase) -> dict:
    """
    Cascade delete a knowledge base:
    - soft-delete linked documents + purge their Qdrant points/chunks
    - purge any remaining Qdrant points for the KB
    - delete linked assistants (conversations cascade via FK)
    - delete the KB itself
    """
    from app.models import Assistant
    from app.services.rag.vectorstore import QdrantVectorStore

    org_id = kb.organization_id
    kb_id = kb.id

    docs = (
        db.session.query(Document)
        .filter(Document.knowledge_base_id == kb_id, Document.status != "deleted")
        .all()
    )
    docs_deleted = 0
    for doc in docs:
        soft_delete_document(doc)
        docs_deleted += 1

    # Also mark already-orphaned linked docs (status deleted) chunks cleanup is optional
    try:
        store = QdrantVectorStore()
        store.delete_by_knowledge_base(str(org_id), str(kb_id))
    except Exception:
        logger.exception("Failed to purge Qdrant points for knowledge base %s", kb_id)

    assistants = db.session.query(Assistant).filter_by(knowledge_base_id=kb_id).all()
    assistants_deleted = len(assistants)
    for assistant in assistants:
        db.session.delete(assistant)
    db.session.flush()

    db.session.delete(kb)
    db.session.commit()
    return {
        "ok": True,
        "documents_deleted": docs_deleted,
        "assistants_deleted": assistants_deleted,
    }