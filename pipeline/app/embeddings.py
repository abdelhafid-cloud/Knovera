from __future__ import annotations

import cohere

from pipeline.app.config import settings
from pipeline.app.logging_config import get_doc_logger

logger = get_doc_logger(__name__)


class CohereEmbeddingProvider:
    def __init__(self):
        if not settings.COHERE_API_KEY:
            raise RuntimeError("COHERE_API_KEY manquante")
        self.client = cohere.ClientV2(api_key=settings.COHERE_API_KEY)
        self.model = settings.COHERE_EMBED_MODEL
        self.dimension = settings.COHERE_EMBED_DIMENSION

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        response = self.client.embed(
            texts=texts,
            model=self.model,
            input_type="search_document",
            embedding_types=["float"],
            output_dimension=self.dimension,
        )
        return list(response.embeddings.float)


def get_embedding_provider() -> CohereEmbeddingProvider:
    return CohereEmbeddingProvider()
