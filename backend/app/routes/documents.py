import json
import time
from io import BytesIO

from flask import Blueprint, Response, g, request, send_file, stream_with_context

from app.extensions import db
from app.models import Document, DocumentChunk, EvalQuestion, KnowledgeBase
from app.services.documents import service as doc_service
from app.utils.audit import write_audit
from app.utils.security import api_error, api_success, parse_uuid, require_org_context

bp_docs = Blueprint("documents", __name__, url_prefix="/api/documents")
bp_kb = Blueprint("knowledge_bases", __name__, url_prefix="/api/knowledge-bases")


def _require_org_admin():
    """Lecture / vue org : super admin (avec org) ou admin organisation."""
    if g.is_super_admin and g.organization:
        return True
    if g.membership and g.membership.role and g.membership.role.code == "org_admin":
        return True
    return False


def _require_content_manager():
    """Création / modification KB & documents : super admin uniquement."""
    return bool(g.is_super_admin and g.organization)


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
    if not _require_content_manager():
        return api_error("Réservé au super admin", 403)
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


@bp_docs.get("/events")
@require_org_context
def document_events():
    """SSE — événements pipeline (OCR / indexation) filtrés par organisation."""
    if not _require_org_admin() and "documents.list" not in g.permissions:
        return api_error("Permission insuffisante", 403)

    from flask import current_app
    from redis import Redis

    from app.services.pipeline_events import CHANNEL

    org_id = str(g.organization.id)
    redis_url = current_app.config.get("REDIS_URL") or "redis://localhost:6379/0"

    def generate():
        client = None
        pubsub = None
        try:
            client = Redis.from_url(redis_url, decode_responses=True)
            pubsub = client.pubsub(ignore_subscribe_messages=True)
            pubsub.subscribe(CHANNEL)
            yield f"data: {json.dumps({'type': 'connected', 'organization_id': org_id}, ensure_ascii=False)}\n\n"
            idle = 0
            while True:
                message = pubsub.get_message(timeout=1.0)
                if message is None:
                    idle += 1
                    if idle >= 15:
                        idle = 0
                        yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
                    time.sleep(0.05)
                    continue
                idle = 0
                if message.get("type") != "message":
                    continue
                raw = message.get("data")
                try:
                    data = json.loads(raw) if isinstance(raw, str) else {}
                except json.JSONDecodeError:
                    continue
                if data.get("organization_id") and str(data.get("organization_id")) != org_id:
                    continue
                if not data.get("organization_id") and data.get("document_id"):
                    try:
                        doc = db.session.get(Document, parse_uuid(str(data["document_id"])))
                        if not doc or str(doc.organization_id) != org_id:
                            continue
                        data["organization_id"] = org_id
                    except Exception:
                        continue
                data.setdefault("type", data.get("event") or "update")
                yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
        except GeneratorExit:
            pass
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)}, ensure_ascii=False)}\n\n"
        finally:
            try:
                if pubsub:
                    pubsub.close()
            except Exception:
                pass
            try:
                if client:
                    client.close()
            except Exception:
                pass

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


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
    if not _require_content_manager():
        return api_error("Réservé au super admin", 403)
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
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/webp": ".webp",
            "image/tiff": ".tiff",
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
    if not _require_content_manager():
        return api_error("Réservé au super admin", 403)
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
    if not _require_content_manager():
        return api_error("Réservé au super admin", 403)
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


@bp_docs.get("/<doc_id>/chunks")
@require_org_context
def list_document_chunks(doc_id):
    if not _require_org_admin() and "documents.list" not in g.permissions:
        return api_error("Permission insuffisante", 403)
    try:
        did = parse_uuid(doc_id)
    except ValueError as e:
        return api_error(str(e), 400)
    doc = db.session.get(Document, did)
    if not doc or doc.organization_id != g.organization.id or doc.status == "deleted":
        return api_error("Document introuvable", 404)
    chunks = (
        db.session.query(DocumentChunk)
        .filter_by(document_id=did)
        .order_by(DocumentChunk.chunk_index.asc())
        .all()
    )
    return api_success(
        [
            {
                "id": str(c.id),
                "document_id": str(c.document_id),
                "chunk_index": c.chunk_index,
                "content": c.content,
                "page_number": c.page_number,
                "section_title": c.section_title,
                "token_count": c.token_count,
            }
            for c in chunks
        ]
    )


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


@bp_kb.get("/provisioning-preview")
@require_org_context
def kb_provisioning_preview():
    if not _require_content_manager():
        return api_error("Réservé au super admin", 403)
    from app.services.storage_provision import ensure_org_minio_bucket, provisioning_preview

    ensure_org_minio_bucket(g.organization, create=True)
    db.session.commit()
    return api_success(provisioning_preview(g.organization))


@bp_kb.post("")
@require_org_context
def create_kb():
    if not _require_content_manager():
        return api_error("Réservé au super admin", 403)
    from app.services.organizations import quotas as quota_service
    from app.services.storage_provision import provision_knowledge_base

    ok, err = quota_service.check_quota(g.organization, "knowledge_bases", 1)
    if not ok:
        return api_error(err, 400)
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return api_error("Nom requis", 400)
    kb = provision_knowledge_base(
        g.organization,
        name=name,
        description=data.get("description"),
        created_by=g.current_user.id,
        rag_settings=data.get("rag_settings") or None,
    )
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
    if not _require_content_manager():
        return api_error("Réservé au super admin", 403)
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
    if not _require_content_manager():
        return api_error("Réservé au super admin", 403)
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


def _eval_to_dict(q: EvalQuestion) -> dict:
    return {
        "id": str(q.id),
        "knowledge_base_id": str(q.knowledge_base_id),
        "organization_id": str(q.organization_id),
        "question": q.question,
        "expected_answer": q.expected_answer,
        "created_at": q.created_at.isoformat() if q.created_at else None,
        "updated_at": q.updated_at.isoformat() if q.updated_at else None,
    }


@bp_kb.get("/<kb_id>/eval-questions")
@require_org_context
def list_eval_questions(kb_id):
    if not _require_org_admin():
        return api_error("Permission insuffisante", 403)
    try:
        kid = parse_uuid(kb_id)
    except ValueError as e:
        return api_error(str(e), 400)
    kb = db.session.get(KnowledgeBase, kid)
    if not kb or kb.organization_id != g.organization.id:
        return api_error("Knowledge base introuvable", 404)
    rows = (
        db.session.query(EvalQuestion)
        .filter_by(knowledge_base_id=kid)
        .order_by(EvalQuestion.created_at.desc())
        .all()
    )
    return api_success([_eval_to_dict(q) for q in rows])


@bp_kb.post("/<kb_id>/eval-questions")
@require_org_context
def create_eval_question(kb_id):
    if not _require_content_manager():
        return api_error("Réservé au super admin", 403)
    try:
        kid = parse_uuid(kb_id)
    except ValueError as e:
        return api_error(str(e), 400)
    kb = db.session.get(KnowledgeBase, kid)
    if not kb or kb.organization_id != g.organization.id:
        return api_error("Knowledge base introuvable", 404)
    data = request.get_json(silent=True) or {}
    question = (data.get("question") or "").strip()
    if not question:
        return api_error("question requise", 400)
    row = EvalQuestion(
        organization_id=g.organization.id,
        knowledge_base_id=kid,
        question=question,
        expected_answer=(data.get("expected_answer") or "").strip() or None,
        created_by=g.current_user.id,
    )
    db.session.add(row)
    db.session.commit()
    return api_success(_eval_to_dict(row), status=201)


@bp_kb.delete("/<kb_id>/eval-questions/<question_id>")
@require_org_context
def delete_eval_question(kb_id, question_id):
    if not _require_content_manager():
        return api_error("Réservé au super admin", 403)
    try:
        kid = parse_uuid(kb_id)
        qid = parse_uuid(question_id)
    except ValueError as e:
        return api_error(str(e), 400)
    row = db.session.get(EvalQuestion, qid)
    if (
        not row
        or row.knowledge_base_id != kid
        or row.organization_id != g.organization.id
    ):
        return api_error("Question introuvable", 404)
    db.session.delete(row)
    db.session.commit()
    return api_success({"ok": True})