from io import BytesIO

from flask import Blueprint, g, request, send_file

from app.extensions import db
from app.models import Document, KnowledgeBase
from app.services.documents import service as doc_service
from app.utils.audit import write_audit
from app.utils.security import api_error, api_success, parse_uuid, require_org_context

bp_docs = Blueprint("documents", __name__, url_prefix="/api/documents")
bp_kb = Blueprint("knowledge_bases", __name__, url_prefix="/api/knowledge-bases")


def _require_org_admin():
    if g.is_super_admin and g.organization:
        return True
    if g.membership and g.membership.role and g.membership.role.code == "org_admin":
        return True
    return False


@bp_docs.get("")
@require_org_context
def list_documents():
    if not _require_org_admin() and "documents.list" not in g.permissions:
        return api_error("Permission insuffisante", 403)
    q = db.session.query(Document).filter(
        Document.organization_id == g.organization.id,
        Document.status != "deleted",
    )
    kb_id = request.args.get("knowledge_base_id")
    status = request.args.get("status")
    if kb_id:
        q = q.filter(Document.knowledge_base_id == parse_uuid(kb_id, "knowledge_base_id"))
    if status:
        q = q.filter(Document.status == status)
    docs = q.order_by(Document.created_at.desc()).all()
    return api_success([doc_service.document_to_dict(d) for d in docs])


@bp_docs.post("")
@require_org_context
def upload_document():
    if not _require_org_admin() and "documents.upload" not in g.permissions:
        return api_error("Permission insuffisante", 403)
    if "file" not in request.files:
        return api_error("Fichier requis (multipart field: file)", 400)
    file = request.files["file"]
    kb_raw = request.form.get("knowledge_base_id")
    kb_id = parse_uuid(kb_raw, "knowledge_base_id") if kb_raw else None
    doc, err = doc_service.upload_document(
        g.organization.id,
        kb_id,
        g.current_user.id,
        file,
        display_name=request.form.get("name"),
        cloud_url=request.form.get("cloud_url"),
        source_url=request.form.get("source_url"),
    )
    if err:
        return api_error(err, 400)
    write_audit("document.upload", resource_type="document", resource_id=doc.id)
    return api_success(doc_service.document_to_dict(doc), status=201)


@bp_docs.get("/<doc_id>")
@require_org_context
def get_document(doc_id):
    if not _require_org_admin() and "documents.list" not in g.permissions:
        return api_error("Permission insuffisante", 403)
    try:
        did = parse_uuid(doc_id)
    except ValueError as e:
        return api_error(str(e), 400)
    doc = db.session.get(Document, did)
    if not doc or doc.organization_id != g.organization.id or doc.status == "deleted":
        return api_error("Document introuvable", 404)
    return api_success(
        doc_service.document_to_dict(doc, include_storage=True, include_minio_url=True)
    )


@bp_docs.patch("/<doc_id>")
@require_org_context
def update_document(doc_id):
    if not _require_org_admin() and "documents.upload" not in g.permissions:
        return api_error("Permission insuffisante", 403)
    try:
        did = parse_uuid(doc_id)
    except ValueError as e:
        return api_error(str(e), 400)
    doc = db.session.get(Document, did)
    if not doc or doc.organization_id != g.organization.id or doc.status == "deleted":
        return api_error("Document introuvable", 404)
    data = request.get_json(silent=True) or {}
    kwargs = {}
    if "name" in data:
        kwargs["name"] = data.get("name")
    if "cloud_url" in data:
        kwargs["cloud_url"] = data.get("cloud_url")
    if "source_url" in data:
        kwargs["source_url"] = data.get("source_url")
    if not kwargs:
        return api_error("Aucun champ à mettre à jour", 400)
    updated, err = doc_service.update_document_meta(doc, **kwargs)
    if err:
        return api_error(err, 400)
    write_audit("document.update", resource_type="document", resource_id=doc.id)
    return api_success(doc_service.document_to_dict(updated))


@bp_docs.get("/<doc_id>/download")
@require_org_context
def download_document(doc_id):
    if not _require_org_admin() and "documents.list" not in g.permissions:
        return api_error("Permission insuffisante", 403)
    try:
        did = parse_uuid(doc_id)
    except ValueError as e:
        return api_error(str(e), 400)
    doc = db.session.get(Document, did)
    if not doc or doc.organization_id != g.organization.id or doc.status == "deleted":
        return api_error("Document introuvable", 404)
    try:
        body = doc_service.download_document_bytes(doc)
    except Exception:
        return api_error("Impossible de télécharger le fichier", 502)
    filename = doc.name or "document"
    if "." not in filename and doc.mime_type:
        ext = {
            "application/pdf": ".pdf",
            "text/plain": ".txt",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
        }.get(doc.mime_type)
        if ext:
            filename = f"{filename}{ext}"
    as_attachment = request.args.get("download") == "1"
    return send_file(
        BytesIO(body),
        mimetype=doc.mime_type or "application/octet-stream",
        as_attachment=as_attachment,
        download_name=filename,
        max_age=0,
    )


@bp_docs.delete("/<doc_id>")
@require_org_context
def delete_document(doc_id):
    if not _require_org_admin() and "documents.delete" not in g.permissions:
        return api_error("Permission insuffisante", 403)
    try:
        did = parse_uuid(doc_id)
    except ValueError as e:
        return api_error(str(e), 400)
    doc = db.session.get(Document, did)
    if not doc or doc.organization_id != g.organization.id or doc.status == "deleted":
        return api_error("Document introuvable", 404)
    doc_service.soft_delete_document(doc)
    write_audit("document.delete", resource_type="document", resource_id=doc.id)
    return api_success({"ok": True})


@bp_docs.post("/<doc_id>/reprocess")
@require_org_context
def reprocess_document(doc_id):
    if not _require_org_admin():
        return api_error("Permission insuffisante", 403)
    try:
        did = parse_uuid(doc_id)
    except ValueError as e:
        return api_error(str(e), 400)
    doc = db.session.get(Document, did)
    if not doc or doc.organization_id != g.organization.id or doc.status == "deleted":
        return api_error("Document introuvable", 404)
    doc.status = "pending"
    doc.error_message = None
    db.session.commit()
    from app.workers.document_processor import enqueue_document_processing

    enqueue_document_processing(str(doc.id), document_name=doc.name)
    return api_success(doc_service.document_to_dict(doc))


@bp_kb.get("")
@require_org_context
def list_kbs():
    if not _require_org_admin() and "knowledge_bases.manage" not in g.permissions:
        return api_error("Permission insuffisante", 403)
    kbs = (
        db.session.query(KnowledgeBase)
        .filter_by(organization_id=g.organization.id)
        .order_by(KnowledgeBase.created_at.desc())
        .all()
    )
    return api_success([doc_service.kb_to_dict(kb) for kb in kbs])


@bp_kb.post("")
@require_org_context
def create_kb():
    if not _require_org_admin():
        return api_error("Permission insuffisante", 403)
    from app.services.organizations import quotas as quota_service

    ok, err = quota_service.check_quota(g.organization, "knowledge_bases", 1)
    if not ok:
        return api_error(err, 400)
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return api_error("Nom requis", 400)
    kb = KnowledgeBase(
        organization_id=g.organization.id,
        name=name,
        description=data.get("description"),
        rag_settings=data.get("rag_settings") or {"chunk_size": 800, "overlap": 120, "top_k": 5},
        created_by=g.current_user.id,
    )
    db.session.add(kb)
    db.session.commit()
    write_audit("knowledge_base.create", resource_type="knowledge_base", resource_id=kb.id)
    return api_success(doc_service.kb_to_dict(kb), status=201)


@bp_kb.get("/<kb_id>")
@require_org_context
def get_kb(kb_id):
    if not _require_org_admin():
        return api_error("Permission insuffisante", 403)
    try:
        kid = parse_uuid(kb_id)
    except ValueError as e:
        return api_error(str(e), 400)
    kb = db.session.get(KnowledgeBase, kid)
    if not kb or kb.organization_id != g.organization.id:
        return api_error("Knowledge base introuvable", 404)
    return api_success(doc_service.kb_to_dict(kb))


@bp_kb.patch("/<kb_id>")
@require_org_context
def update_kb(kb_id):
    if not _require_org_admin():
        return api_error("Permission insuffisante", 403)
    try:
        kid = parse_uuid(kb_id)
    except ValueError as e:
        return api_error(str(e), 400)
    kb = db.session.get(KnowledgeBase, kid)
    if not kb or kb.organization_id != g.organization.id:
        return api_error("Knowledge base introuvable", 404)
    data = request.get_json(silent=True) or {}
    if "name" in data and data["name"]:
        kb.name = data["name"].strip()
    if "description" in data:
        kb.description = data["description"]
    if "rag_settings" in data and isinstance(data["rag_settings"], dict):
        kb.rag_settings = {**(kb.rag_settings or {}), **data["rag_settings"]}
    db.session.commit()
    return api_success(doc_service.kb_to_dict(kb))


@bp_kb.delete("/<kb_id>")
@require_org_context
def delete_kb(kb_id):
    if not _require_org_admin():
        return api_error("Permission insuffisante", 403)
    try:
        kid = parse_uuid(kb_id)
    except ValueError as e:
        return api_error(str(e), 400)
    kb = db.session.get(KnowledgeBase, kid)
    if not kb or kb.organization_id != g.organization.id:
        return api_error("Knowledge base introuvable", 404)
    result = doc_service.delete_knowledge_base(kb)
    write_audit("knowledge_base.delete", resource_type="knowledge_base", resource_id=kid)
    return api_success(result)