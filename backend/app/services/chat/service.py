from uuid import UUID
import logging
import time

from app.extensions import db
from app.logging_config import ms_since
from app.models import (
    Assistant,
    AssistantAccess,
    Conversation,
    Document,
    DocumentChunk,
    Message,
    MessageSource,
    OrganizationMember,
)
from app.services.rag.embeddings import get_embedding_provider
from app.services.rag.llm import (
    build_conversational_prompt,
    build_rag_prompt,
    get_llm_provider,
    skips_document_retrieval,
)
from app.services.rag.vectorstore import QdrantVectorStore

logger = logging.getLogger(__name__)


def assistant_to_dict(a: Assistant, include_prompt=False):
    data = {
        "id": str(a.id),
        "organization_id": str(a.organization_id),
        "knowledge_base_id": str(a.knowledge_base_id),
        "name": a.name,
        "description": a.description,
        "avatar_url": a.avatar_url,
        "model": a.model,
        "temperature": a.temperature,
        "top_k": a.top_k,
        "welcome_message": a.welcome_message,
        "is_active": a.is_active,
        "rag_settings": a.rag_settings or {},
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }
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
    # Garder le meilleur score par document (page de l'extrait le plus pertinent)
    best_by_doc: dict[str, object] = {}
    orphan = []
    for s in m.sources or []:
        if not s.document_id:
            orphan.append(s)
            continue
        key = str(s.document_id)
        prev = best_by_doc.get(key)
        if prev is None or (s.relevance_score or 0) > (prev.relevance_score or 0):
            best_by_doc[key] = s

    sources = []
    for s in list(best_by_doc.values()) + orphan:
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
            llm = get_llm_provider()
            if assistant.model:
                llm.model = assistant.model
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
    logger.info(
        "[BACKEND:CHAT] route=rag | question=%r | org=%s | kb=%s | top_k=%s | assistant=%s",
        question[:120],
        organization_id,
        assistant.knowledge_base_id,
        assistant.top_k or 5,
        assistant.name,
    )
    t0 = time.perf_counter()
    embedder = get_embedding_provider()
    query_vector = embedder.embed_query(question)
    logger.info(
        "[BACKEND:CHAT] embed_query OK | dim=%s | model=%s | took=%sms",
        len(query_vector),
        getattr(embedder, "model", "?"),
        ms_since(t0),
    )
    store = QdrantVectorStore()
    top_k = assistant.top_k or 5
    t0 = time.perf_counter()
    hits = store.search(
        vector=query_vector,
        organization_id=str(organization_id),
        knowledge_base_id=str(assistant.knowledge_base_id),
        top_k=top_k,
    )
    logger.info(
        "[BACKEND:CHAT] qdrant search | hits=%s | collection=%s | took=%sms",
        len(hits),
        store.collection,
        ms_since(t0),
    )

    context_blocks = []
    min_score = (assistant.rag_settings or {}).get("min_score", 0.25)

    for hit in hits:
        score = float(hit.score or 0)
        if score < min_score:
            logger.info(
                "[BACKEND:CHAT] chunk ignoré | score=%.3f < min=%.3f | doc=%s",
                score,
                min_score,
                (hit.payload or {}).get("document_name"),
            )
            continue
        payload = hit.payload or {}
        # Defense in depth — re-check tenant
        if payload.get("organization_id") != str(organization_id):
            continue
        if payload.get("knowledge_base_id") != str(assistant.knowledge_base_id):
            continue
        context_blocks.append(
            {
                "document_name": payload.get("document_name"),
                "page_number": payload.get("page_number"),
                "score": score,
                "content": payload.get("content"),
                "document_id": payload.get("document_id"),
                "chunk_id": payload.get("chunk_id"),
            }
        )
        logger.info(
            "[BACKEND:CHAT] chunk retenu | doc=%s | score=%.4f | chunk_id=%s | page=%s",
            payload.get("document_name"),
            score,
            payload.get("chunk_id"),
            payload.get("page_number"),
        )

    logger.info(
        "[BACKEND:CHAT] context_blocks=%s | min_score=%s",
        len(context_blocks),
        min_score,
    )

    t0 = time.perf_counter()
    system, user_prompt = build_rag_prompt(assistant.system_prompt, context_blocks, question)
    try:
        llm = get_llm_provider()
        if assistant.model:
            llm.model = assistant.model
        answer = llm.generate(system, user_prompt, temperature=assistant.temperature or 0.2)
    except Exception as exc:
        logger.exception("[BACKEND:CHAT] LLM rag failed")
        return None, f"Erreur LLM: {exc}"
    logger.info(
        "[BACKEND:CHAT] LLM OK | model=%s | answer_chars=%s | took=%sms",
        getattr(llm, "model", "?"),
        len(answer or ""),
        ms_since(t0),
    )

    # UI : une seule source = le chunk le plus pertinent (meilleur score)
    source_payloads = []
    if context_blocks:
        best = max(context_blocks, key=lambda b: float(b.get("score") or 0))
        source_payloads = [best]
        logger.info(
            "[BACKEND:CHAT] source UI | doc=%s | score=%.4f | total_rag=%sms",
            best.get("document_name"),
            float(best.get("score") or 0),
            ms_since(t_rag),
        )
    else:
        logger.warning(
            "[BACKEND:CHAT] aucune source | total_rag=%sms",
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

    for src in source_payloads:
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
                message_id=assistant_msg.id,
                document_id=document_id,
                chunk_id=chunk_id,
                page_number=src.get("page_number"),
                relevance_score=src.get("score"),
                excerpt=(src.get("content") or "")[:500],
            )
        )

    db.session.commit()
    return {
        "conversation": conversation_to_dict(conversation),
        "message": message_to_dict(assistant_msg),
        "user_message": message_to_dict(user_msg),
    }, None
