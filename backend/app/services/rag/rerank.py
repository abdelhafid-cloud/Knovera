"""Reranking Cohere (optionnel) des chunks récupérés."""

from __future__ import annotations

import logging

from flask import current_app

logger = logging.getLogger(__name__)


def rerank_blocks(query: str, blocks: list[dict], *, top_k: int = 5) -> list[dict]:
    """Réordonne les blocs via Cohere Rerank si la clé est dispo, sinon score local."""
    if not blocks:
        return []
    api_key = (current_app.config.get("COHERE_API_KEY") or "").strip()
    model = (current_app.config.get("COHERE_RERANK_MODEL") or "rerank-v3.5").strip()
    if not api_key:
        return sorted(blocks, key=lambda b: float(b.get("score") or 0), reverse=True)[:top_k]

    try:
        import cohere

        client = cohere.ClientV2(api_key=api_key)
        documents = [str(b.get("content") or "")[:4000] for b in blocks]
        result = client.rerank(
            model=model,
            query=query,
            documents=documents,
            top_n=min(top_k, len(documents)),
        )
        out = []
        for item in result.results or []:
            idx = int(item.index)
            block = dict(blocks[idx])
            block["score"] = float(getattr(item, "relevance_score", None) or block.get("score") or 0)
            out.append(block)
        return out
    except Exception:
        logger.exception("[RAG:RERANK] Cohere rerank failed")
        return sorted(blocks, key=lambda b: float(b.get("score") or 0), reverse=True)[:top_k]
