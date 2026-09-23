from flask import Blueprint, g, request

from app.extensions import db
from app.models import Assistant, AssistantAccess, Conversation, KnowledgeBase
from app.services.chat import service as chat_service
from app.utils.audit import write_audit
from app.utils.security import api_error, api_success, parse_uuid, require_org_context

bp_assistants = Blueprint("assistants", __name__, url_prefix="/api/assistants")
bp_chat = Blueprint("chat", __name__, url_prefix="/api")


def _is_org_admin():
    if g.is_super_admin and g.organization:
        return True
    return bool(g.membership and g.membership.role and g.membership.role.code == "org_admin")


@bp_assistants.get("")
@require_org_context
def list_assistants():
    q = db.session.query(Assistant).filter_by(organization_id=g.organization.id)
    if not _is_org_admin():
        q = q.filter_by(is_active=True)
    assistants = q.order_by(Assistant.created_at.desc()).all()
    result = []
    for a in assistants:
        if _is_org_admin() or chat_service.user_can_access_assistant(
            g.current_user.id, g.membership, a, False
        ):
            result.append(chat_service.assistant_to_dict(a, include_prompt=_is_org_admin()))
    return api_success(result)


@bp_assistants.post("")
@require_org_context
def create_assistant():
    if not _is_org_admin():
        return api_error("Permission insuffisante", 403)
    from app.services.organizations import quotas as quota_service

    ok, err = quota_service.check_quota(g.organization, "assistants", 1)
    if not ok:
        return api_error(err, 400)
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    kb_id = data.get("knowledge_base_id")
    if not name or not kb_id:
        return api_error("name et knowledge_base_id requis", 400)
    try:
        kid = parse_uuid(kb_id, "knowledge_base_id")
    except ValueError as e:
        return api_error(str(e), 400)
    kb = db.session.get(KnowledgeBase, kid)
    if not kb or kb.organization_id != g.organization.id:
        return api_error("Knowledge base introuvable", 404)

    assistant = Assistant(
        organization_id=g.organization.id,
        knowledge_base_id=kid,
        name=name,
        description=data.get("description"),
        avatar_url=data.get("avatar_url"),
        system_prompt=data.get("system_prompt")
        or "Tu es un assistant utile basé sur les documents de l'organisation.",
        model=data.get("model") or "gpt-4o-mini",
        temperature=float(data.get("temperature", 0.2)),
        top_k=int(data.get("top_k", 5)),
        welcome_message=data.get("welcome_message"),
        is_active=bool(data.get("is_active", True)),
        rag_settings=data.get("rag_settings") or {},
        created_by=g.current_user.id,
    )
    db.session.add(assistant)
    db.session.flush()

    for user_id in data.get("user_ids") or []:
        db.session.add(
            AssistantAccess(
                assistant_id=assistant.id,
                organization_id=g.organization.id,
                user_id=parse_uuid(user_id, "user_id"),
            )
        )

    db.session.commit()
    write_audit("assistant.create", resource_type="assistant", resource_id=assistant.id)
    return api_success(chat_service.assistant_to_dict(assistant, include_prompt=True), status=201)


@bp_assistants.get("/<assistant_id>")
@require_org_context
def get_assistant(assistant_id):
    try:
        aid = parse_uuid(assistant_id)
    except ValueError as e:
        return api_error(str(e), 400)
    assistant = db.session.get(Assistant, aid)
    if not assistant or assistant.organization_id != g.organization.id:
        return api_error("Assistant introuvable", 404)
    if not _is_org_admin() and not chat_service.user_can_access_assistant(
        g.current_user.id, g.membership, assistant, False
    ):
        return api_error("Accès refusé", 403)
    return api_success(chat_service.assistant_to_dict(assistant, include_prompt=_is_org_admin()))


@bp_assistants.patch("/<assistant_id>")
@require_org_context
def update_assistant(assistant_id):
    if not _is_org_admin():
        return api_error("Permission insuffisante", 403)
    try:
        aid = parse_uuid(assistant_id)
    except ValueError as e:
        return api_error(str(e), 400)
    assistant = db.session.get(Assistant, aid)
    if not assistant or assistant.organization_id != g.organization.id:
        return api_error("Assistant introuvable", 404)
    data = request.get_json(silent=True) or {}
    for field in ("name", "description", "avatar_url", "system_prompt", "model", "welcome_message"):
        if field in data:
            setattr(assistant, field, data[field])
    if "temperature" in data:
        assistant.temperature = float(data["temperature"])
    if "top_k" in data:
        assistant.top_k = int(data["top_k"])
    if "is_active" in data:
        assistant.is_active = bool(data["is_active"])
    if "knowledge_base_id" in data:
        kid = parse_uuid(data["knowledge_base_id"], "knowledge_base_id")
        kb = db.session.get(KnowledgeBase, kid)
        if not kb or kb.organization_id != g.organization.id:
            return api_error("Knowledge base introuvable", 404)
        assistant.knowledge_base_id = kid
    if "rag_settings" in data and isinstance(data["rag_settings"], dict):
        assistant.rag_settings = {**(assistant.rag_settings or {}), **data["rag_settings"]}
    db.session.commit()
    return api_success(chat_service.assistant_to_dict(assistant, include_prompt=True))


@bp_assistants.delete("/<assistant_id>")
@require_org_context
def delete_assistant(assistant_id):
    if not _is_org_admin():
        return api_error("Permission insuffisante", 403)
    try:
        aid = parse_uuid(assistant_id)
    except ValueError as e:
        return api_error(str(e), 400)
    assistant = db.session.get(Assistant, aid)
    if not assistant or assistant.organization_id != g.organization.id:
        return api_error("Assistant introuvable", 404)
    db.session.delete(assistant)
    db.session.commit()
    write_audit("assistant.delete", resource_type="assistant", resource_id=aid)
    return api_success({"ok": True})


@bp_assistants.put("/<assistant_id>/access")
@require_org_context
def set_assistant_access(assistant_id):
    if not _is_org_admin():
        return api_error("Permission insuffisante", 403)
    try:
        aid = parse_uuid(assistant_id)
    except ValueError as e:
        return api_error(str(e), 400)
    assistant = db.session.get(Assistant, aid)
    if not assistant or assistant.organization_id != g.organization.id:
        return api_error("Assistant introuvable", 404)
    data = request.get_json(silent=True) or {}
    db.session.query(AssistantAccess).filter_by(assistant_id=aid).delete()
    for user_id in data.get("user_ids") or []:
        db.session.add(
            AssistantAccess(
                assistant_id=aid,
                organization_id=g.organization.id,
                user_id=parse_uuid(user_id, "user_id"),
            )
        )
    for role_id in data.get("role_ids") or []:
        db.session.add(
            AssistantAccess(
                assistant_id=aid,
                organization_id=g.organization.id,
                role_id=parse_uuid(role_id, "role_id"),
            )
        )
    db.session.commit()
    return api_success({"ok": True})


@bp_chat.post("/chat")
@require_org_context
def chat():
    if "chat.create" not in g.permissions and not _is_org_admin():
        return api_error("Permission insuffisante", 403)
    data = request.get_json(silent=True) or {}
    question = (data.get("message") or data.get("question") or "").strip()
    assistant_id = data.get("assistant_id")
    conversation_id = data.get("conversation_id")
    if not question or not assistant_id:
        return api_error("assistant_id et message requis", 400)
    try:
        aid = parse_uuid(assistant_id, "assistant_id")
        cid = parse_uuid(conversation_id, "conversation_id") if conversation_id else None
    except ValueError as e:
        return api_error(str(e), 400)

    assistant = db.session.get(Assistant, aid)
    if not assistant or assistant.organization_id != g.organization.id:
        return api_error("Assistant introuvable", 404)
    if not chat_service.user_can_access_assistant(
        g.current_user.id, g.membership, assistant, _is_org_admin()
    ):
        return api_error("Accès assistant refusé", 403)

    result, err = chat_service.run_chat(
        organization_id=g.organization.id,
        user_id=g.current_user.id,
        assistant=assistant,
        question=question,
        conversation_id=cid,
    )
    if err:
        return api_error(err, 400)
    write_audit(
        "chat.message",
        resource_type="conversation",
        resource_id=result["conversation"]["id"],
    )
    return api_success(result)


@bp_chat.get("/conversations")
@require_org_context
def list_conversations():
    q = db.session.query(Conversation).filter_by(organization_id=g.organization.id)
    if not _is_org_admin() and "conversations.view_org" not in g.permissions:
        q = q.filter_by(user_id=g.current_user.id)
    conversations = q.order_by(Conversation.updated_at.desc()).limit(100).all()
    return api_success([chat_service.conversation_to_dict(c) for c in conversations])


@bp_chat.get("/conversations/<conversation_id>")
@require_org_context
def get_conversation(conversation_id):
    try:
        cid = parse_uuid(conversation_id)
    except ValueError as e:
        return api_error(str(e), 400)
    conversation = db.session.get(Conversation, cid)
    if not conversation or conversation.organization_id != g.organization.id:
        return api_error("Conversation introuvable", 404)
    if (
        conversation.user_id != g.current_user.id
        and not _is_org_admin()
        and "conversations.view_org" not in g.permissions
    ):
        return api_error("Accès refusé", 403)
    return api_success(chat_service.conversation_to_dict(conversation, include_messages=True))


@bp_chat.delete("/conversations/<conversation_id>")
@require_org_context
def delete_conversation(conversation_id):
    try:
        cid = parse_uuid(conversation_id)
    except ValueError as e:
        return api_error(str(e), 400)
    conversation = db.session.get(Conversation, cid)
    if not conversation or conversation.organization_id != g.organization.id:
        return api_error("Conversation introuvable", 404)
    if conversation.user_id != g.current_user.id and not _is_org_admin():
        return api_error("Accès refusé", 403)
    db.session.delete(conversation)
    db.session.commit()
    return api_success({"ok": True})
