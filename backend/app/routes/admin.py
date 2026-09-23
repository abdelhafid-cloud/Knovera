from flask import Blueprint, g, request

from app.extensions import db
from app.models import (
    Assistant,
    AuditLog,
    Conversation,
    Document,
    KnowledgeBase,
    Organization,
    OrganizationMember,
    User,
)
from app.utils.security import (
    api_error,
    api_success,
    auth_required,
    parse_uuid,
    require_org_context,
)
from app.utils.audit import write_audit

bp = Blueprint("admin", __name__, url_prefix="/api")


@bp.get("/admin/dashboard")
@auth_required
def platform_dashboard():
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    return api_success(_platform_stats())


def _platform_stats():
    from datetime import datetime, timedelta, timezone

    docs_by_status = {
        row[0]: row[1]
        for row in db.session.query(Document.status, db.func.count(Document.id))
        .filter(Document.status != "deleted")
        .group_by(Document.status)
        .all()
    }

    orgs_by_status = {
        row[0]: row[1]
        for row in db.session.query(Organization.status, db.func.count(Organization.id))
        .filter(Organization.status != "deleted")
        .group_by(Organization.status)
        .all()
    }

    # Activity last 14 days
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=13)
    start_dt = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)

    def _daily_counts(model, date_col):
        rows = (
            db.session.query(db.func.date(date_col), db.func.count(model.id))
            .filter(date_col >= start_dt)
            .group_by(db.func.date(date_col))
            .all()
        )
        return {str(r[0]): r[1] for r in rows}

    users_daily = _daily_counts(User, User.created_at)
    docs_daily = _daily_counts(Document, Document.created_at)
    conv_daily = _daily_counts(Conversation, Conversation.created_at)

    activity_series = []
    for i in range(14):
        day = start + timedelta(days=i)
        key = day.isoformat()
        activity_series.append(
            {
                "date": key,
                "label": day.strftime("%d/%m"),
                "users": users_daily.get(key, 0),
                "documents": docs_daily.get(key, 0),
                "conversations": conv_daily.get(key, 0),
            }
        )

    # Top organizations by documents
    from app.services.organizations.service import resolve_logo_url

    top_orgs = []
    orgs = (
        db.session.query(Organization)
        .filter(Organization.status != "deleted")
        .order_by(Organization.created_at.desc())
        .limit(100)
        .all()
    )
    for org in orgs:
        docs = (
            db.session.query(Document)
            .filter(Document.organization_id == org.id, Document.status != "deleted")
            .count()
        )
        convs = db.session.query(Conversation).filter_by(organization_id=org.id).count()
        assistants = db.session.query(Assistant).filter_by(organization_id=org.id).count()
        kbs = db.session.query(KnowledgeBase).filter_by(organization_id=org.id).count()
        members = (
            db.session.query(OrganizationMember)
            .filter_by(organization_id=org.id, status="active")
            .count()
        )
        top_orgs.append(
            {
                "id": str(org.id),
                "name": org.name,
                "logo_url": resolve_logo_url(org),
                "status": org.status,
                "documents": docs,
                "conversations": convs,
                "assistants": assistants,
                "knowledge_bases": kbs,
                "members": members,
            }
        )
    top_orgs.sort(key=lambda x: (x["documents"] + x["conversations"]), reverse=True)
    top_orgs = top_orgs[:12]

    from app.services.organizations import quotas as quota_service

    # Operational alerts
    alerts = []
    failed = (
        db.session.query(Document).filter_by(status="failed").count()
    )
    processing = (
        db.session.query(Document)
        .filter(Document.status.in_(("pending", "processing")))
        .count()
    )
    suspended = (
        db.session.query(Organization).filter_by(status="suspended").count()
    )
    if failed:
        alerts.append(
            {
                "id": "docs_failed",
                "severity": "danger" if failed >= 5 else "warning",
                "title": f"{failed} document(s) en échec",
                "description": "Vérifiez le pipeline d’indexation.",
                "href": "/super-admin/documents",
            }
        )
    if processing >= 10:
        alerts.append(
            {
                "id": "docs_queue",
                "severity": "warning",
                "title": f"{processing} documents en file",
                "description": "La file d’indexation est chargée.",
                "href": "/super-admin/documents",
            }
        )
    if suspended:
        alerts.append(
            {
                "id": "orgs_suspended",
                "severity": "warning",
                "title": f"{suspended} organisation(s) suspendue(s)",
                "description": "Des tenants sont inactifs.",
                "href": "/super-admin/organizations",
            }
        )
    for near in quota_service.orgs_near_quota(5):
        over = [i for i in near["items"] if i["over"]]
        warn = [i for i in near["items"] if i["warning"] and not i["over"]]
        label = ", ".join(i["label"] for i in (over or warn)[:3])
        alerts.append(
            {
                "id": f"quota_{near['organization_id']}",
                "severity": "danger" if over else "warning",
                "title": f"Quota — {near['organization_name']}",
                "description": f"Limite proche ou atteinte : {label}",
                "href": f"/super-admin/organizations/{near['organization_id']}",
            }
        )

    return {
        "total_organizations": db.session.query(Organization)
        .filter(Organization.status != "deleted")
        .count(),
        "active_organizations": db.session.query(Organization).filter_by(status="active").count(),
        "suspended_organizations": db.session.query(Organization)
        .filter_by(status="suspended")
        .count(),
        "total_users": db.session.query(User).count(),
        "total_assistants": db.session.query(Assistant).count(),
        "total_documents": db.session.query(Document).filter(Document.status != "deleted").count(),
        "total_conversations": db.session.query(Conversation).count(),
        "total_knowledge_bases": db.session.query(KnowledgeBase).count(),
        "documents_processing": processing,
        "documents_failed": failed,
        "documents_by_status": docs_by_status,
        "organizations_by_status": orgs_by_status,
        "activity_series": activity_series,
        "top_organizations": top_orgs,
        "alerts": alerts,
    }


@bp.get("/admin/analytics")
@auth_required
def platform_analytics():
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)

    docs_by_status = {
        row[0]: row[1]
        for row in db.session.query(Document.status, db.func.count(Document.id))
        .filter(Document.status != "deleted")
        .group_by(Document.status)
        .all()
    }

    orgs = (
        db.session.query(Organization)
        .filter(Organization.status != "deleted")
        .order_by(Organization.created_at.desc())
        .limit(50)
        .all()
    )
    org_rows = []
    for org in orgs:
        org_rows.append(
            {
                "id": str(org.id),
                "name": org.name,
                "slug": org.slug,
                "status": org.status,
                "members": db.session.query(OrganizationMember)
                .filter_by(organization_id=org.id, status="active")
                .count(),
                "documents": db.session.query(Document)
                .filter(Document.organization_id == org.id, Document.status != "deleted")
                .count(),
                "assistants": db.session.query(Assistant)
                .filter_by(organization_id=org.id)
                .count(),
                "conversations": db.session.query(Conversation)
                .filter_by(organization_id=org.id)
                .count(),
            }
        )

    payload = _platform_stats()
    payload["documents_by_status"] = docs_by_status
    payload["organizations_breakdown"] = org_rows
    return api_success(payload)


@bp.get("/admin/system")
@auth_required
def platform_system():
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from flask import current_app

    checks = {}

    try:
        db.session.execute(db.text("SELECT 1"))
        checks["database"] = {"status": "ok"}
    except Exception as exc:
        checks["database"] = {"status": "error", "detail": str(exc)}

    try:
        import redis

        r = redis.from_url(current_app.config.get("REDIS_URL") or "redis://localhost:6379/0")
        r.ping()
        checks["redis"] = {"status": "ok"}
    except Exception as exc:
        checks["redis"] = {"status": "error", "detail": str(exc)}

    try:
        from qdrant_client import QdrantClient

        client = QdrantClient(
            url=current_app.config.get("QDRANT_URL"),
            api_key=current_app.config.get("QDRANT_API_KEY") or None,
            timeout=5,
        )
        cols = client.get_collections()
        checks["qdrant"] = {
            "status": "ok",
            "collections": len(cols.collections) if cols and cols.collections else 0,
        }
    except Exception as exc:
        checks["qdrant"] = {"status": "error", "detail": str(exc)}

    try:
        from botocore.client import Config
        import boto3

        endpoint = current_app.config.get("MINIO_ENDPOINT") or "localhost:9000"
        secure = bool(current_app.config.get("MINIO_SECURE"))
        bucket = current_app.config.get("MINIO_BUCKET") or "rag-documents"
        # Same client stack as document upload/download (boto3), not the optional minio SDK
        client = boto3.client(
            "s3",
            endpoint_url=f"{'https' if secure else 'http'}://{endpoint}",
            aws_access_key_id=current_app.config.get("MINIO_ACCESS_KEY"),
            aws_secret_access_key=current_app.config.get("MINIO_SECRET_KEY"),
            config=Config(signature_version="s3v4"),
            region_name="us-east-1",
        )
        exists = False
        try:
            client.head_bucket(Bucket=bucket)
            exists = True
        except Exception:
            # Fallback: list buckets (head may fail on some MinIO setups)
            names = {b.get("Name") for b in (client.list_buckets().get("Buckets") or [])}
            exists = bucket in names
        checks["minio"] = {
            "status": "ok" if exists else "warn",
            "bucket": bucket,
            "exists": exists,
            "endpoint": endpoint,
        }
    except Exception as exc:
        checks["minio"] = {"status": "error", "detail": str(exc)}

    overall = "ok"
    if any(c.get("status") == "error" for c in checks.values()):
        overall = "degraded"
    elif any(c.get("status") == "warn" for c in checks.values()):
        overall = "warn"

    return api_success({"status": overall, "services": checks, "stats": _platform_stats()})


@bp.get("/admin/workspace")
@auth_required
def super_admin_workspace():
    """Personal space for the logged-in super admin (testing uploads / RAG)."""
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from app.services.documents import service as doc_service
    from app.services.organizations import service as org_service

    org, default_kb = org_service.ensure_super_admin_workspace(g.current_user)
    kbs = (
        db.session.query(KnowledgeBase)
        .filter_by(organization_id=org.id)
        .order_by(KnowledgeBase.created_at.asc())
        .all()
    )
    return api_success(
        {
            "organization": org_service.organization_to_dict(org, include_usage=True),
            "default_knowledge_base_id": str(default_kb.id) if default_kb else None,
            "knowledge_bases": [doc_service.kb_to_dict(kb) for kb in kbs],
        }
    )


@bp.get("/admin/knowledge-bases")
@auth_required
def platform_knowledge_bases():
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from app.services.documents import service as doc_service
    from app.services.organizations import service as org_service

    scope = request.args.get("scope", "workspace")  # workspace | all
    q = db.session.query(KnowledgeBase)
    if scope != "all":
        org, _ = org_service.ensure_super_admin_workspace(g.current_user)
        q = q.filter(KnowledgeBase.organization_id == org.id)
    kbs = q.order_by(KnowledgeBase.created_at.desc()).limit(200).all()
    result = []
    for kb in kbs:
        item = doc_service.kb_to_dict(kb)
        org = db.session.get(Organization, kb.organization_id)
        item["organization_name"] = org.name if org else None
        result.append(item)
    return api_success(result)


@bp.post("/admin/knowledge-bases")
@auth_required
def create_platform_knowledge_base():
    """Super admin: create a KB in own workspace or another organization."""
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from app.services.documents import service as doc_service
    from app.services.organizations import quotas as quota_service
    from app.services.organizations import service as org_service

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return api_error("Nom requis", 400)

    workspace, _ = org_service.ensure_super_admin_workspace(g.current_user)
    org = workspace
    org_raw = (data.get("organization_id") or "").strip()
    if org_raw:
        try:
            oid = parse_uuid(org_raw, "organization_id")
        except ValueError as e:
            return api_error(str(e), 400)
        target = db.session.get(Organization, oid)
        if not target or target.status == "deleted":
            return api_error("Organisation introuvable", 404)
        if target.status == "suspended":
            return api_error("Organisation suspendue", 400)
        org = target

    ok, err = quota_service.check_quota(org, "knowledge_bases", 1)
    if not ok:
        return api_error(err, 400)

    kb = KnowledgeBase(
        organization_id=org.id,
        name=name,
        description=data.get("description"),
        rag_settings=data.get("rag_settings") or {"chunk_size": 800, "overlap": 120, "top_k": 5},
        created_by=g.current_user.id,
    )
    db.session.add(kb)
    db.session.commit()
    write_audit("knowledge_base.create", resource_type="knowledge_base", resource_id=kb.id)
    item = doc_service.kb_to_dict(kb)
    item["organization_name"] = org.name
    return api_success(item, status=201)


@bp.delete("/admin/knowledge-bases/<kb_id>")
@auth_required
def delete_platform_knowledge_base(kb_id):
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from app.services.documents import service as doc_service

    try:
        kid = parse_uuid(kb_id)
    except ValueError as e:
        return api_error(str(e), 400)
    kb = db.session.get(KnowledgeBase, kid)
    if not kb:
        return api_error("Knowledge base introuvable", 404)
    result = doc_service.delete_knowledge_base(kb)
    write_audit("knowledge_base.delete", resource_type="knowledge_base", resource_id=kid)
    return api_success(result)


@bp.get("/admin/documents")
@auth_required
def platform_documents():
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from app.services.documents import service as doc_service
    from app.services.organizations import service as org_service

    status = request.args.get("status")
    scope = request.args.get("scope", "workspace")  # workspace | all
    q = db.session.query(Document).filter(Document.status != "deleted")
    if status:
        q = q.filter(Document.status == status)
    if scope != "all":
        org, _ = org_service.ensure_super_admin_workspace(g.current_user)
        q = q.filter(Document.organization_id == org.id)
    docs = q.order_by(Document.created_at.desc()).limit(100).all()
    result = []
    for d in docs:
        item = doc_service.document_to_dict(d)
        org = db.session.get(Organization, d.organization_id)
        item["organization_name"] = org.name if org else None
        result.append(item)
    return api_success(result)


@bp.post("/admin/documents")
@auth_required
def upload_super_admin_document():
    """Upload into the super admin workspace, or into another organization."""
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from app.services.documents import service as doc_service
    from app.services.organizations import service as org_service

    if "file" not in request.files:
        return api_error("Fichier requis (multipart field: file)", 400)

    workspace, default_kb = org_service.ensure_super_admin_workspace(g.current_user)
    org = workspace
    default_kb_id = default_kb.id if default_kb else None

    org_raw = (request.form.get("organization_id") or "").strip()
    if org_raw:
        try:
            target_org_id = parse_uuid(org_raw, "organization_id")
        except ValueError as e:
            return api_error(str(e), 400)
        target = db.session.get(Organization, target_org_id)
        if not target or target.status == "deleted":
            return api_error("Organisation introuvable", 404)
        if target.status == "suspended":
            return api_error("Organisation suspendue", 400)
        org = target
        first_kb = (
            db.session.query(KnowledgeBase)
            .filter_by(organization_id=org.id)
            .order_by(KnowledgeBase.created_at.asc())
            .first()
        )
        default_kb_id = first_kb.id if first_kb else None

    kb_raw = request.form.get("knowledge_base_id")
    if kb_raw:
        try:
            kb_id = parse_uuid(kb_raw, "knowledge_base_id")
        except ValueError as e:
            return api_error(str(e), 400)
        kb = db.session.get(KnowledgeBase, kb_id)
        if not kb or kb.organization_id != org.id:
            return api_error("Knowledge base introuvable dans cette organisation", 400)
    else:
        kb_id = default_kb_id

    if not kb_id:
        return api_error("Aucune knowledge base — créez-en une avant d’uploader", 400)

    doc, err = doc_service.upload_document(
        org.id,
        kb_id,
        g.current_user.id,
        request.files["file"],
        display_name=request.form.get("name"),
        cloud_url=request.form.get("cloud_url"),
        source_url=request.form.get("source_url"),
    )
    if err:
        return api_error(err, 400)
    write_audit("document.upload", resource_type="document", resource_id=doc.id)
    item = doc_service.document_to_dict(doc)
    item["organization_name"] = org.name
    return api_success(item, status=201)


@bp.get("/admin/documents/<doc_id>")
@auth_required
def get_platform_document(doc_id):
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from app.services.documents import service as doc_service

    try:
        did = parse_uuid(doc_id)
    except ValueError as e:
        return api_error(str(e), 400)
    doc = db.session.get(Document, did)
    if not doc or doc.status == "deleted":
        return api_error("Document introuvable", 404)
    item = doc_service.document_to_dict(doc, include_storage=True, include_minio_url=True)
    org = db.session.get(Organization, doc.organization_id)
    item["organization_name"] = org.name if org else None
    return api_success(item)


@bp.patch("/admin/documents/<doc_id>")
@auth_required
def update_platform_document(doc_id):
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from app.services.documents import service as doc_service

    try:
        did = parse_uuid(doc_id)
    except ValueError as e:
        return api_error(str(e), 400)
    doc = db.session.get(Document, did)
    if not doc or doc.status == "deleted":
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
    item = doc_service.document_to_dict(updated)
    org = db.session.get(Organization, updated.organization_id)
    item["organization_name"] = org.name if org else None
    return api_success(item)


@bp.get("/admin/documents/<doc_id>/download")
@auth_required
def download_platform_document(doc_id):
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from io import BytesIO

    from flask import send_file

    from app.services.documents import service as doc_service

    try:
        did = parse_uuid(doc_id)
    except ValueError as e:
        return api_error(str(e), 400)
    doc = db.session.get(Document, did)
    if not doc or doc.status == "deleted":
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


@bp.delete("/admin/documents/<doc_id>")
@auth_required
def delete_platform_document(doc_id):
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from app.services.documents import service as doc_service

    try:
        did = parse_uuid(doc_id)
    except ValueError as e:
        return api_error(str(e), 400)
    doc = db.session.get(Document, did)
    if not doc or doc.status == "deleted":
        return api_error("Document introuvable", 404)
    doc_service.soft_delete_document(doc)
    write_audit("document.delete", resource_type="document", resource_id=doc.id)
    return api_success({"ok": True})


@bp.get("/admin/assistants")
@auth_required
def platform_assistants():
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from app.services.chat import service as chat_service

    q = db.session.query(Assistant).order_by(Assistant.created_at.desc())
    org_raw = (request.args.get("organization_id") or "").strip()
    if org_raw:
        try:
            oid = parse_uuid(org_raw, "organization_id")
        except ValueError as e:
            return api_error(str(e), 400)
        q = q.filter_by(organization_id=oid)
    assistants = q.limit(200).all()
    result = []
    for a in assistants:
        item = chat_service.assistant_to_dict(a)
        org = db.session.get(Organization, a.organization_id)
        item["organization_name"] = org.name if org else None
        result.append(item)
    return api_success(result)


@bp.post("/admin/assistants")
@auth_required
def create_platform_assistant():
    """Super admin: create an assistant in own workspace or another organization."""
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from app.services.chat import service as chat_service
    from app.services.organizations import quotas as quota_service
    from app.services.organizations import service as org_service

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    kb_raw = data.get("knowledge_base_id")
    if not name or not kb_raw:
        return api_error("name et knowledge_base_id requis", 400)

    workspace, _ = org_service.ensure_super_admin_workspace(g.current_user)
    org = workspace
    org_raw = (data.get("organization_id") or "").strip()
    if org_raw:
        try:
            oid = parse_uuid(org_raw, "organization_id")
        except ValueError as e:
            return api_error(str(e), 400)
        target = db.session.get(Organization, oid)
        if not target or target.status == "deleted":
            return api_error("Organisation introuvable", 404)
        if target.status == "suspended":
            return api_error("Organisation suspendue", 400)
        org = target

    try:
        kid = parse_uuid(kb_raw, "knowledge_base_id")
    except ValueError as e:
        return api_error(str(e), 400)
    kb = db.session.get(KnowledgeBase, kid)
    if not kb or kb.organization_id != org.id:
        return api_error("Knowledge base introuvable dans cette organisation", 400)

    ok, err = quota_service.check_quota(org, "assistants", 1)
    if not ok:
        return api_error(err, 400)

    assistant = Assistant(
        organization_id=org.id,
        knowledge_base_id=kid,
        name=name,
        description=data.get("description"),
        avatar_url=data.get("avatar_url"),
        system_prompt=data.get("system_prompt")
        or "Tu es un assistant utile basé sur les documents de l'organisation.",
        model=data.get("model") or "gpt-4o-mini",
        temperature=float(data.get("temperature", 0.2)),
        top_k=int(data.get("top_k", 5)),
        welcome_message=data.get("welcome_message") or "Bonjour, comment puis-je vous aider ?",
        is_active=bool(data.get("is_active", True)),
        rag_settings=data.get("rag_settings") or {},
        created_by=g.current_user.id,
    )
    db.session.add(assistant)
    db.session.commit()
    write_audit("assistant.create", resource_type="assistant", resource_id=assistant.id)
    item = chat_service.assistant_to_dict(assistant, include_prompt=True)
    item["organization_name"] = org.name
    return api_success(item, status=201)


@bp.get("/admin/conversations")
@auth_required
def platform_conversations():
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from app.services.chat import service as chat_service

    conversations = (
        db.session.query(Conversation).order_by(Conversation.updated_at.desc()).limit(100).all()
    )
    result = []
    for c in conversations:
        item = chat_service.conversation_to_dict(c)
        org = db.session.get(Organization, c.organization_id)
        item["organization_name"] = org.name if org else None
        result.append(item)
    return api_success(result)


@bp.get("/admin/settings")
@auth_required
def platform_settings():
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from flask import current_app

    return api_success(
        {
            "app_name": current_app.config.get("APP_NAME"),
            "frontend_url": current_app.config.get("FRONTEND_URL"),
            "max_upload_size_mb": current_app.config.get("MAX_UPLOAD_SIZE_MB"),
            "allowed_extensions": sorted(current_app.config.get("ALLOWED_EXTENSIONS") or []),
            "cohere_embed_model": current_app.config.get("COHERE_EMBED_MODEL"),
            "llm_model": current_app.config.get("LLM_MODEL"),
            "qdrant_collection": current_app.config.get("QDRANT_COLLECTION"),
            "jwt_access_minutes": int(
                current_app.config.get("JWT_ACCESS_TOKEN_EXPIRES").total_seconds() / 60
            )
            if current_app.config.get("JWT_ACCESS_TOKEN_EXPIRES")
            else None,
        }
    )


@bp.get("/admin/audit-logs")
@auth_required
def audit_logs():
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    page = max(int(request.args.get("page", 1)), 1)
    per_page = min(int(request.args.get("per_page", 50)), 100)
    q = db.session.query(AuditLog).order_by(AuditLog.created_at.desc())
    total = q.count()
    logs = q.offset((page - 1) * per_page).limit(per_page).all()
    return api_success(
        [
            {
                "id": str(l.id),
                "actor_user_id": str(l.actor_user_id) if l.actor_user_id else None,
                "organization_id": str(l.organization_id) if l.organization_id else None,
                "action": l.action,
                "resource_type": l.resource_type,
                "resource_id": l.resource_id,
                "ip_address": l.ip_address,
                "metadata": l.meta,
                "created_at": l.created_at.isoformat() if l.created_at else None,
            }
            for l in logs
        ],
        meta={"page": page, "per_page": per_page, "total": total},
    )


@bp.get("/admin/users")
@auth_required
def list_users():
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from app.services.auth import service as auth_service

    users = db.session.query(User).order_by(User.created_at.desc()).limit(200).all()
    payload = []
    for user in users:
        memberships = (
            db.session.query(OrganizationMember)
            .filter_by(user_id=user.id)
            .all()
        )
        payload.append(
            auth_service.user_to_dict(
                user,
                [auth_service.membership_to_dict(m) for m in memberships],
            )
        )
    return api_success(payload)


@bp.patch("/admin/users/<user_id>")
@auth_required
def update_user(user_id):
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from app.services.auth import service as auth_service
    from app.utils.security import hash_password

    try:
        uid = parse_uuid(user_id, "user_id")
    except ValueError as e:
        return api_error(str(e), 400)
    user = db.session.get(User, uid)
    if not user:
        return api_error("Utilisateur introuvable", 404)
    data = request.get_json(silent=True) or {}

    if "first_name" in data and data["first_name"] is not None:
        user.first_name = str(data["first_name"]).strip()[:100]
    if "last_name" in data and data["last_name"] is not None:
        user.last_name = str(data["last_name"]).strip()[:100]
    if "email" in data and data["email"]:
        new_email = str(data["email"]).strip().lower()
        if new_email != user.email:
            existing = db.session.query(User).filter(User.email == new_email).first()
            if existing and existing.id != user.id:
                return api_error("Cet email est déjà utilisé", 400)
            user.email = new_email
    if "is_active" in data:
        if user.id == g.current_user.id and not data["is_active"]:
            return api_error("Vous ne pouvez pas vous désactiver vous-même", 400)
        user.is_active = bool(data["is_active"])
    if "is_super_admin" in data:
        if user.id == g.current_user.id and not data["is_super_admin"]:
            return api_error("Vous ne pouvez pas retirer votre propre rôle Super Admin", 400)
        user.is_super_admin = bool(data["is_super_admin"])
    if data.get("password"):
        password = str(data["password"])
        if len(password) < 8:
            return api_error("Mot de passe trop court (min 8)", 400)
        user.password_hash = hash_password(password)

    db.session.commit()
    write_audit("user.update", resource_type="user", resource_id=str(user.id))
    return api_success(auth_service.user_to_dict(user))


@bp.delete("/admin/users/<user_id>")
@auth_required
def delete_user(user_id):
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    try:
        uid = parse_uuid(user_id, "user_id")
    except ValueError as e:
        return api_error(str(e), 400)
    user = db.session.get(User, uid)
    if not user:
        return api_error("Utilisateur introuvable", 404)
    if user.id == g.current_user.id:
        return api_error("Vous ne pouvez pas supprimer votre propre compte", 400)

    from app.models import Invitation, PasswordResetToken

    # Soft FKs without ON DELETE CASCADE
    db.session.query(AuditLog).filter_by(actor_user_id=uid).update(
        {"actor_user_id": None}, synchronize_session=False
    )
    db.session.query(Document).filter_by(uploaded_by=uid).update(
        {"uploaded_by": None}, synchronize_session=False
    )
    db.session.query(KnowledgeBase).filter_by(created_by=uid).update(
        {"created_by": None}, synchronize_session=False
    )
    db.session.query(Assistant).filter_by(created_by=uid).update(
        {"created_by": None}, synchronize_session=False
    )
    # invited_by is NOT NULL — reassign to current admin
    db.session.query(Invitation).filter_by(invited_by=uid).update(
        {"invited_by": g.current_user.id}, synchronize_session=False
    )
    db.session.query(PasswordResetToken).filter_by(user_id=uid).delete(synchronize_session=False)

    try:
        db.session.delete(user)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return api_error(f"Suppression impossible: {exc.__class__.__name__}", 400)

    write_audit("user.delete", resource_type="user", resource_id=str(uid))
    return api_success({"ok": True})


@bp.post("/admin/users")
@auth_required
def create_user():
    """Super Admin only: create a user (admin or member) in an organization."""
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from app.services.auth import service as auth_service
    from app.services.organizations import service as org_service

    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""
    first_name = (data.get("first_name") or "").strip()
    last_name = (data.get("last_name") or "").strip()
    organization_id = data.get("organization_id")
    role_code = data.get("role_code") or "org_member"
    if role_code in ("admin", "org_admin"):
        role_code = "org_admin"
    else:
        role_code = "org_member"

    if not organization_id:
        return api_error("organisation_id requis", 400)
    try:
        oid = parse_uuid(organization_id, "organization_id")
    except ValueError as e:
        return api_error(str(e), 400)

    user, err = org_service.create_organization_user(
        oid,
        email,
        password,
        first_name,
        last_name,
        role_code,
        assistant_ids=data.get("assistant_ids") or [],
    )
    if err:
        return api_error(err, 400)
    write_audit("user.create", resource_type="user", resource_id=str(user.id))
    return api_success(auth_service.user_to_dict(user), status=201)


@bp.post("/admin/users/<user_id>/reset-password")
@auth_required
def admin_reset_password(user_id):
    """Super Admin: generate a one-time password reset token for a user."""
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    from app.services.auth import service as auth_service

    try:
        uid = parse_uuid(user_id, "user_id")
    except ValueError as e:
        return api_error(str(e), 400)
    user = db.session.get(User, uid)
    if not user:
        return api_error("Utilisateur introuvable", 404)
    raw = auth_service.request_password_reset(user.email)
    if not raw:
        return api_error("Impossible de générer le token", 400)
    write_audit("user.reset_password", resource_type="user", resource_id=str(user.id))
    from flask import current_app

    frontend = current_app.config.get("FRONTEND_URL") or "http://localhost:3000"
    return api_success(
        {
            "email": user.email,
            "token": raw,
            "reset_url": f"{frontend.rstrip('/')}/reset-password?token={raw}",
            "expires_in_minutes": 60,
        }
    )


@bp.get("/organization/dashboard")
@require_org_context
def organization_dashboard():
    is_admin = g.is_super_admin or (
        g.membership and g.membership.role and g.membership.role.code == "org_admin"
    )
    if not is_admin:
        return api_error("Permission insuffisante", 403)

    oid = g.organization.id
    from app.services.organizations import quotas as quota_service

    usage_data = quota_service.usage_vs_quotas(g.organization)
    return api_success(
        {
            "total_members": usage_data["usage"]["members"],
            "total_documents": usage_data["usage"]["documents"],
            "active_assistants": db.session.query(Assistant)
            .filter_by(organization_id=oid, is_active=True)
            .count(),
            "knowledge_bases": usage_data["usage"]["knowledge_bases"],
            "conversations": db.session.query(Conversation)
            .filter_by(organization_id=oid)
            .count(),
            "documents_processing": db.session.query(Document)
            .filter(
                Document.organization_id == oid,
                Document.status.in_(("pending", "processing")),
            )
            .count(),
            "storage_usage_bytes": usage_data["usage"]["storage_bytes"],
            "quotas": usage_data["quotas"],
            "usage": usage_data["usage"],
            "quota_items": usage_data["items"],
        }
    )
