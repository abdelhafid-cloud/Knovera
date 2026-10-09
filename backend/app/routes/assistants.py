import json

from flask import Blueprint, Response, g, request, stream_with_context

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


def _require_content_manager():
    """Création / édition assistants : super admin uniquement."""
    return bool(g.is_super_admin and g.organization)


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


@bp_assistants.get("/llm-providers")
@require_org_context
def list_llm_providers():
    if not _require_content_manager():
        return api_error("Réservé au super admin", 403)
    from app.services.rag.llm_providers import list_providers_for_api

    return api_success(list_providers_for_api())


@bp_assistants.post("/generate-prompt")
@require_org_context
def generate_assistant_prompt():
    if not _require_content_manager():
        return api_error("Réservé au super admin", 403)
    from app.services.rag.llm import generate_assistant_system_prompt

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    kb_id = data.get("knowledge_base_id")
    if not name or not kb_id:
        return api_error("name et knowledge_base_id requis pour générer le prompt", 400)
    try:
        kid = parse_uuid(kb_id, "knowledge_base_id")
    except ValueError as e:
        return api_error(str(e), 400)
    kb = db.session.get(KnowledgeBase, kid)
    if not kb or kb.organization_id != g.organization.id:
        return api_error("Knowledge base introuvable", 404)
    provider = (data.get("llm_provider") or "openai").strip().lower()
    model = (data.get("model") or "").strip() or None
    try:
        prompt = generate_assistant_system_prompt(
            assistant_name=name,
            assistant_description=data.get("description"),
            knowledge_base_name=kb.name,
            knowledge_base_description=kb.description,
            llm_provider=provider,
            model=model,
        )
    except Exception as exc:
        return api_error(f"Génération du prompt échouée: {exc}", 502)
    if not prompt:
        return api_error("Prompt généré vide", 502)
    return api_success({"system_prompt": prompt})


@bp_assistants.post("")
@require_org_context
def create_assistant():
    if not _require_content_manager():
        return api_error("Réservé au super admin", 403)
    from app.services.organizations import quotas as quota_service
    from app.services.rag.llm_providers import default_model_for

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

    provider = (data.get("llm_provider") or "openai").strip().lower()
    if provider not in ("openai", "anthropic", "openrouter"):
        return api_error("llm_provider invalide", 400)
    model = (data.get("model") or "").strip() or default_model_for(provider)
    system_prompt = (data.get("system_prompt") or "").strip() or (
        f"Tu es « {name} », un assistant utile basé sur la knowledge base « {kb.name} »."
    )

    from app.services.platform_settings import default_rag_settings

    rag_defaults = default_rag_settings()
    rag_incoming = data.get("rag_settings") if isinstance(data.get("rag_settings"), dict) else {}
    rag_settings = {**rag_defaults, **rag_incoming}
    top_k = int(data.get("top_k", rag_settings.get("top_k") or 5))
    rag_settings["top_k"] = top_k

    assistant = Assistant(
        organization_id=g.organization.id,
        knowledge_base_id=kid,
        name=name,
        description=data.get("description"),
        avatar_url=data.get("avatar_url"),
        system_prompt=system_prompt,
        llm_provider=provider,
        model=model,
        temperature=float(data.get("temperature", 0.2)),
        top_k=top_k,
        welcome_message=data.get("welcome_message"),
        banner_color=chat_service.normalize_banner_color(data.get("banner_color")),
        is_active=bool(data.get("is_active", True)),
        rag_settings=rag_settings,
        created_by=g.current_user.id,
    )
    db.session.add(assistant)
    db.session.flush()

    user_ids = data.get("user_ids") or []
    role_ids = data.get("role_ids") or []
    for user_id in user_ids:
        db.session.add(
            AssistantAccess(
                assistant_id=assistant.id,
                organization_id=g.organization.id,
                user_id=parse_uuid(user_id, "user_id"),
            )
        )
    for role_id in role_ids:
        db.session.add(
            AssistantAccess(
                assistant_id=assistant.id,
                organization_id=g.organization.id,
                role_id=parse_uuid(role_id, "role_id"),
            )
        )
    # Par défaut : tous les membres org voient l'assistant
    if not user_ids and not role_ids:
        from app.models import Role

        member_role = (
            db.session.query(Role)
            .filter_by(code="org_member", organization_id=None)
            .first()
        )
        if member_role:
            db.session.add(
                AssistantAccess(
                    assistant_id=assistant.id,
                    organization_id=g.organization.id,
                    role_id=member_role.id,
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
    if not _require_content_manager():
        return api_error("Réservé au super admin", 403)
    try:
        aid = parse_uuid(assistant_id)
    except ValueError as e:
        return api_error(str(e), 400)
    assistant = db.session.get(Assistant, aid)
    if not assistant or assistant.organization_id != g.organization.id:
        return api_error("Assistant introuvable", 404)
    data = request.get_json(silent=True) or {}
    for field in (
        "name",
        "description",
        "avatar_url",
        "system_prompt",
        "model",
        "welcome_message",
        "llm_provider",
    ):
        if field in data:
            setattr(assistant, field, data[field])
    if "banner_color" in data:
        assistant.banner_color = chat_service.normalize_banner_color(data.get("banner_color"))
    if "llm_provider" in data:
        provider = (data.get("llm_provider") or "").strip().lower()
        if provider not in ("openai", "anthropic", "openrouter"):
            return api_error("llm_provider invalide", 400)
        assistant.llm_provider = provider
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
        if "top_k" in data["rag_settings"]:
            try:
                assistant.top_k = int(data["rag_settings"]["top_k"])
            except (TypeError, ValueError):
                pass
    db.session.commit()
    return api_success(chat_service.assistant_to_dict(assistant, include_prompt=True))


@bp_assistants.delete("/<assistant_id>")
@require_org_context
def delete_assistant(assistant_id):
    if not _require_content_manager():
        return api_error("Réservé au super admin", 403)
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


@bp_assistants.get("/<assistant_id>/access")
@require_org_context
def get_assistant_access(assistant_id):
    if not _is_org_admin():
        return api_error("Permission insuffisante", 403)
    try:
        aid = parse_uuid(assistant_id)
    except ValueError as e:
        return api_error(str(e), 400)
    assistant = db.session.get(Assistant, aid)
    if not assistant or assistant.organization_id != g.organization.id:
        return api_error("Assistant introuvable", 404)
    from app.models import Role, User

    rules = (
        db.session.query(AssistantAccess)
        .filter_by(assistant_id=aid, organization_id=g.organization.id)
        .all()
    )
    users = []
    roles = []
    for rule in rules:
        if rule.user_id:
            u = db.session.get(User, rule.user_id)
            if u:
                users.append(
                    {
                        "id": str(u.id),
                        "email": u.email,
                        "full_name": u.full_name,
                    }
                )
        if rule.role_id:
            r = db.session.get(Role, rule.role_id)
            if r:
                roles.append({"id": str(r.id), "code": r.code, "name": r.name})
    from app.services.organizations import service as org_service

    system_roles = org_service.get_or_create_system_roles()
    available_roles = [
        {"id": str(r.id), "code": r.code, "name": r.name}
        for code, r in system_roles.items()
        if code in ("org_member", "org_admin")
    ]
    return api_success(
        {
            "assistant_id": str(aid),
            "user_ids": [u["id"] for u in users],
            "role_ids": [r["id"] for r in roles],
            "users": users,
            "roles": roles,
            "available_roles": available_roles,
        }
    )


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
    write_audit("assistant.access.update", resource_type="assistant", resource_id=aid)
    return get_assistant_access(assistant_id)


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


@bp_chat.post("/chat/stream")
@require_org_context
def chat_stream():
    """SSE streaming — events: meta, token, done, error."""
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

    org_id = g.organization.id
    user_id = g.current_user.id

    def generate():
        try:
            for event in chat_service.run_chat_stream(
                organization_id=org_id,
                user_id=user_id,
                assistant=assistant,
                question=question,
                conversation_id=cid,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)}, ensure_ascii=False)}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


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
