from uuid import UUID
import logging
import re
import time

from app.extensions import db
from app.logging_config import ms_since
from app.models import (
    Assistant,
    AssistantAccess,
    Conversation,
    Document,
    DocumentChunk,
    KnowledgeBase,
    Message,
    MessageSource,
    OrganizationMember,
)
from app.services.rag.embeddings import get_embedding_provider
from app.services.rag.llm import (
    build_conversational_prompt,
    build_rag_prompt,
    get_llm_for_assistant,
    skips_document_retrieval,
)
from app.services.rag.vectorstore import QdrantVectorStore

logger = logging.getLogger(__name__)

DEFAULT_BANNER_COLOR = "#3B82F6"
_BANNER_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


def normalize_banner_color(value) -> str:
    if isinstance(value, str) and _BANNER_COLOR_RE.fullmatch(value.strip()):
        return value.strip().upper()
    return DEFAULT_BANNER_COLOR


def assistant_to_dict(a: Assistant, include_prompt=False):
    data = {
        "id": str(a.id),
        "organization_id": str(a.organization_id),
        "knowledge_base_id": str(a.knowledge_base_id),
        "name": a.name,
        "description": a.description,
        "avatar_url": a.avatar_url,
        "llm_provider": getattr(a, "llm_provider", None) or "openai",
        "model": a.model,
        "temperature": a.temperature,
        "top_k": a.top_k,
        "welcome_message": a.welcome_message,
        "banner_color": normalize_banner_color(getattr(a, "banner_color", None)),
        "is_active": a.is_active,
        "rag_settings": a.rag_settings or {},
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }
    org = a.organization
    if org:
        from app.services.organizations.service import resolve_logo_url

        data["organization_name"] = org.name
        data["organization_logo_url"] = resolve_logo_url(org)
    if include_prompt:
        data["system_prompt"] = a.system_prompt
    return data


def conversation_to_dict(c: Conversation, include_messages=False):
    data = {
        "id": str(c.id),
        "organization_id": str(c.organization_id),
        "assistant_id": str(c.assistant_id),
        "user_id": str(c.user_id),
        "title": c.title,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }
    if include_messages:
        data["messages"] = [message_to_dict(m) for m in c.messages]
    return data


def message_to_dict(m: Message):
    """Toutes les sources (chunks) utilisées, triées par score décroissant."""
    ordered = sorted(
        list(m.sources or []),
        key=lambda s: float(s.relevance_score or 0),
        reverse=True,
    )
    sources = []
    for s in ordered:
        doc = db.session.get(Document, s.document_id) if s.document_id else None
        minio_url = None
        if doc:
            try:
                from app.services.documents.service import generate_presigned_url

                minio_url = generate_presigned_url(doc)
                if minio_url and s.page_number:
                    minio_url = f"{minio_url}#page={int(s.page_number)}"
            except Exception:
                minio_url = None
        sources.append(
            {
                "id": str(s.id),
                "document_id": str(s.document_id) if s.document_id else None,
                "chunk_id": str(s.chunk_id) if s.chunk_id else None,
                "page_number": s.page_number,
                "relevance_score": s.relevance_score,
                "excerpt": s.excerpt,
                "document_name": doc.name if doc else None,
                "minio_url": minio_url,
            }
        )
    return {
        "id": str(m.id),
        "conversation_id": str(m.conversation_id),
        "role": m.role,
        "content": m.content,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "sources": sources,
    }


def user_can_access_assistant(user_id: UUID, membership: OrganizationMember | None, assistant: Assistant, is_org_admin: bool) -> bool:
    if not assistant.is_active:
        return False
    if is_org_admin:
        return True
    if not membership:
        return False
    rules = assistant.access_rules or []
    if not rules:
        # No explicit ACL → org members cannot access by default
        return False
    for rule in rules:
        if rule.user_id and rule.user_id == user_id:
            return True
        if rule.role_id and rule.role_id == membership.role_id:
            return True
    return False


def run_chat(
    *,
    organization_id: UUID,
    user_id: UUID,
    assistant: Assistant,
    question: str,
    conversation_id: UUID | None = None,
):
    if not assistant.knowledge_base_id:
        return None, "Assistant sans knowledge base"

    # Create or load conversation
    if conversation_id:
        conversation = db.session.get(Conversation, conversation_id)
        if (
            not conversation
            or conversation.organization_id != organization_id
            or conversation.user_id != user_id
            or conversation.assistant_id != assistant.id
        ):
            return None, "Conversation introuvable"
    else:
        title = question.strip()[:80] or "Nouvelle conversation"
        conversation = Conversation(
            organization_id=organization_id,
            assistant_id=assistant.id,
            user_id=user_id,
            title=title,
        )
        db.session.add(conversation)
        db.session.flush()

    user_msg = Message(
        conversation_id=conversation.id,
        organization_id=organization_id,
        role="user",
        content=question,
    )
    db.session.add(user_msg)
    db.session.flush()

    # [A] SOCIAL / [B] MÉTA → LLM via SYSTEM_PROMPT, sans retrieval ni sources
    if skips_document_retrieval(question):
        logger.info(
            "[BACKEND:CHAT] route=conversational | question=%r",
            question[:80],
        )
        t0 = time.perf_counter()
        system, user_prompt = build_conversational_prompt(assistant.system_prompt, question)
        try:
            llm = get_llm_for_assistant(assistant)
            answer = llm.generate(
                system, user_prompt, temperature=max(assistant.temperature or 0.2, 0.4)
            )
        except Exception as exc:
            logger.exception("[BACKEND:CHAT] LLM conversational failed")
            return None, f"Erreur LLM: {exc}"
        logger.info(
            "[BACKEND:CHAT] conversational OK | answer_chars=%s | took=%sms",
            len(answer or ""),
            ms_since(t0),
        )
        assistant_msg = Message(
            conversation_id=conversation.id,
            organization_id=organization_id,
            role="assistant",
            content=answer,
        )
        db.session.add(assistant_msg)
        db.session.commit()
        return {
            "conversation": conversation_to_dict(conversation),
            "message": message_to_dict(assistant_msg),
            "user_message": message_to_dict(user_msg),
        }, None

    # [C]/[D] — Retrieval scoped by org + KB
    t_rag = time.perf_counter()
    rag_settings = assistant.rag_settings or {}
    logger.info(
        "[BACKEND:CHAT] route=rag | question=%r | org=%s | kb=%s | top_k=%s | assistant=%s | hybrid=%s | rerank=%s",
        question[:120],
        organization_id,
        assistant.knowledge_base_id,
        assistant.top_k or 5,
        assistant.name,
        bool(rag_settings.get("hybrid_search", True)),
        bool(rag_settings.get("rerank", True)),
    )
    context_blocks = _retrieve_context_blocks(
        organization_id=organization_id,
        assistant=assistant,
        question=question,
    )
    logger.info(
        "[BACKEND:CHAT] context_blocks=%s | took=%sms",
        len(context_blocks),
        ms_since(t_rag),
    )

    t0 = time.perf_counter()
    system, user_prompt = build_rag_prompt(assistant.system_prompt, context_blocks, question)
    try:
        llm = get_llm_for_assistant(assistant)
        answer = llm.generate(system, user_prompt, temperature=assistant.temperature or 0.2)
    except Exception as exc:
        logger.exception("[BACKEND:CHAT] LLM rag failed")
        return None, f"Erreur LLM: {exc}"
    logger.info(
        "[BACKEND:CHAT] LLM OK | model=%s | answer_chars=%s | took=%sms | total_rag=%sms",
        getattr(llm, "model", "?"),
        len(answer or ""),
        ms_since(t0),
        ms_since(t_rag),
    )

    assistant_msg = Message(
        conversation_id=conversation.id,
        organization_id=organization_id,
        role="assistant",
        content=answer,
    )
    db.session.add(assistant_msg)
    db.session.flush()
    _persist_sources(assistant_msg.id, context_blocks)

    db.session.commit()
    return {
        "conversation": conversation_to_dict(conversation),
        "message": message_to_dict(assistant_msg),
        "user_message": message_to_dict(user_msg),
    }, None


def _persist_sources(message_id, context_blocks: list[dict]) -> None:
    for src in context_blocks:
        document_id = None
        chunk_id = None
        if src.get("document_id"):
            try:
                document_id = UUID(str(src["document_id"]))
                if not db.session.get(Document, document_id):
                    document_id = None
            except (ValueError, TypeError):
                document_id = None
        if src.get("chunk_id"):
            try:
                candidate = UUID(str(src["chunk_id"]))
                if db.session.get(DocumentChunk, candidate):
                    chunk_id = candidate
            except (ValueError, TypeError):
                chunk_id = None
        db.session.add(
            MessageSource(
                message_id=message_id,
                document_id=document_id,
                chunk_id=chunk_id,
                page_number=src.get("page_number"),
                relevance_score=src.get("score"),
                excerpt=(src.get("content") or "")[:500],
            )
        )


def _retrieve_context_blocks(
    *,
    organization_id: UUID,
    assistant: Assistant,
    question: str,
) -> list[dict]:
    embedder = get_embedding_provider()
    query_vector = embedder.embed_query(question)
    kb = db.session.get(KnowledgeBase, assistant.knowledge_base_id)
    store = QdrantVectorStore(collection_name=(kb.qdrant_collection if kb else None))
    top_k = assistant.top_k or 5
    rag_settings = assistant.rag_settings or {}
    min_score = float(rag_settings.get("min_score", 0.25))
    use_hybrid = bool(rag_settings.get("hybrid_search", True))
    use_rerank = bool(rag_settings.get("rerank", True))
    fetch_k = max(top_k * 4, top_k) if (use_hybrid or use_rerank) else top_k

    hits = store.search(
        vector=query_vector,
        organization_id=str(organization_id),
        knowledge_base_id=str(assistant.knowledge_base_id),
        top_k=fetch_k,
    )

    context_blocks = []
    for hit in hits:
        score = float(hit.score or 0)
        payload = hit.payload or {}
        if payload.get("organization_id") != str(organization_id):
            continue
        if payload.get("knowledge_base_id") != str(assistant.knowledge_base_id):
            continue
        content = payload.get("content") or ""
        if use_hybrid:
            q_terms = [t for t in question.lower().split() if len(t) > 2]
            if q_terms:
                text = content.lower()
                hits_term = sum(1 for t in q_terms if t in text)
                score = score + 0.03 * hits_term
        if score < min_score:
            continue
        context_blocks.append(
            {
                "document_name": payload.get("document_name"),
                "page_number": payload.get("page_number"),
                "score": score,
                "content": content,
                "document_id": payload.get("document_id"),
                "chunk_id": payload.get("chunk_id"),
            }
        )

    if use_rerank and context_blocks:
        try:
            from app.services.rag.rerank import rerank_blocks

            context_blocks = rerank_blocks(question, context_blocks, top_k=top_k)
        except Exception:
            logger.exception("[BACKEND:CHAT] rerank failed — fallback score")
            context_blocks = sorted(
                context_blocks, key=lambda b: float(b.get("score") or 0), reverse=True
            )[:top_k]
    else:
        context_blocks = sorted(
            context_blocks, key=lambda b: float(b.get("score") or 0), reverse=True
        )[:top_k]
    return context_blocks


def _get_or_create_conversation(
    *,
    organization_id: UUID,
    user_id: UUID,
    assistant: Assistant,
    question: str,
    conversation_id: UUID | None,
):
    if conversation_id:
        conversation = db.session.get(Conversation, conversation_id)
        if (
            not conversation
            or conversation.organization_id != organization_id
            or conversation.user_id != user_id
            or conversation.assistant_id != assistant.id
        ):
            return None, "Conversation introuvable"
        return conversation, None
    title = question.strip()[:80] or "Nouvelle conversation"
    conversation = Conversation(
        organization_id=organization_id,
        assistant_id=assistant.id,
        user_id=user_id,
        title=title,
    )
    db.session.add(conversation)
    db.session.flush()
    return conversation, None


def run_chat_stream(
    *,
    organization_id: UUID,
    user_id: UUID,
    assistant: Assistant,
    question: str,
    conversation_id: UUID | None = None,
):
    """Yield SSE event dicts: meta, token, done, error."""
    if not assistant.knowledge_base_id:
        yield {"type": "error", "message": "Assistant sans knowledge base"}
        return

    conversation, err = _get_or_create_conversation(
        organization_id=organization_id,
        user_id=user_id,
        assistant=assistant,
        question=question,
        conversation_id=conversation_id,
    )
    if err:
        yield {"type": "error", "message": err}
        return

    user_msg = Message(
        conversation_id=conversation.id,
        organization_id=organization_id,
        role="user",
        content=question,
    )
    db.session.add(user_msg)
    db.session.flush()
    db.session.commit()

    yield {
        "type": "meta",
        "conversation_id": str(conversation.id),
        "user_message": message_to_dict(user_msg),
    }

    context_blocks: list[dict] = []
    try:
        if skips_document_retrieval(question):
            system, user_prompt = build_conversational_prompt(assistant.system_prompt, question)
            temperature = max(assistant.temperature or 0.2, 0.4)
        else:
            context_blocks = _retrieve_context_blocks(
                organization_id=organization_id,
                assistant=assistant,
                question=question,
            )
            system, user_prompt = build_rag_prompt(
                assistant.system_prompt, context_blocks, question
            )
            temperature = assistant.temperature or 0.2

        llm = get_llm_for_assistant(assistant)
        answer_parts: list[str] = []
        for delta in llm.stream(system, user_prompt, temperature=temperature):
            if not delta:
                continue
            # Gros blocs (ex. fallback non-stream) → découpe pour un rendu fluide
            pieces = [delta] if len(delta) <= 24 else [
                delta[i : i + 12] for i in range(0, len(delta), 12)
            ]
            for piece in pieces:
                answer_parts.append(piece)
                yield {"type": "token", "text": piece}
        answer = "".join(answer_parts)
    except Exception as exc:
        logger.exception("[BACKEND:CHAT] stream failed")
        yield {"type": "error", "message": f"Erreur LLM: {exc}"}
        return

    assistant_msg = Message(
        conversation_id=conversation.id,
        organization_id=organization_id,
        role="assistant",
        content=answer,
    )
    db.session.add(assistant_msg)
    db.session.flush()
    if context_blocks:
        _persist_sources(assistant_msg.id, context_blocks)
    db.session.commit()

    yield {
        "type": "done",
        "conversation": conversation_to_dict(conversation),
        "message": message_to_dict(assistant_msg),
        "user_message": message_to_dict(user_msg),
    }
