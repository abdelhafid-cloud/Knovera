from abc import ABC, abstractmethod

from flask import current_app

from app.logging_config import get_doc_logger

logger = get_doc_logger(__name__)


class EmbeddingProvider(ABC):
    @abstractmethod
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError

    @abstractmethod
    def embed_query(self, text: str) -> list[float]:
        raise NotImplementedError

    @property
    @abstractmethod
    def dimension(self) -> int:
        raise NotImplementedError


class CohereEmbeddingProvider(EmbeddingProvider):
    def __init__(self):
        import cohere

        api_key = current_app.config["COHERE_API_KEY"]
        if not api_key:
            raise RuntimeError("COHERE_API_KEY manquante")
        self.client = cohere.ClientV2(api_key=api_key)
        self.model = current_app.config["COHERE_EMBED_MODEL"]
        self._dimension = current_app.config["COHERE_EMBED_DIMENSION"]

    @property
    def dimension(self) -> int:
        return self._dimension

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        kwargs = {
            "texts": texts,
            "model": self.model,
            "input_type": "search_document",
            "embedding_types": ["float"],
        }
        # embed-v4 supports output_dimension
        if "v4" in (self.model or "").lower() or self._dimension:
            kwargs["output_dimension"] = self._dimension
        logger.debug(
            "[PIPELINE:EMBED] cohere.embed | model=%s | dim=%s | n=%s",
            self.model,
            self._dimension,
            len(texts),
        )
        response = self.client.embed(**kwargs)
        vectors = list(response.embeddings.float)
        logger.debug("[PIPELINE:EMBED] cohere OK | vectors=%s", len(vectors))
        return vectors

    def embed_query(self, text: str) -> list[float]:
        kwargs = {
            "texts": [text],
            "model": self.model,
            "input_type": "search_query",
            "embedding_types": ["float"],
        }
        if "v4" in (self.model or "").lower() or self._dimension:
            kwargs["output_dimension"] = self._dimension
        response = self.client.embed(**kwargs)
        return list(response.embeddings.float[0])


def get_embedding_provider() -> EmbeddingProvider:
    return CohereEmbeddingProvider()
