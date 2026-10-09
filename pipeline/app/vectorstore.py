from __future__ import annotations

from uuid import uuid4

from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from pipeline.app.config import settings
from pipeline.app.logging_config import get_doc_logger

logger = get_doc_logger(__name__)


class QdrantVectorStore:
    def __init__(self, collection_name: str | None = None):
        self.client = QdrantClient(
            url=settings.QDRANT_URL,
            api_key=settings.QDRANT_API_KEY,
            check_compatibility=False,
        )
        self.collection = collection_name or settings.QDRANT_COLLECTION
        self.dimension = settings.COHERE_EMBED_DIMENSION

    def ensure_collection(self):
        names = [c.name for c in self.client.get_collections().collections]
        if self.collection in names:
            return
        self.client.create_collection(
            collection_name=self.collection,
            vectors_config=qmodels.VectorParams(
                size=self.dimension, distance=qmodels.Distance.COSINE
            ),
        )
        for field in ("organization_id", "knowledge_base_id", "document_id"):
            self.client.create_payload_index(
                collection_name=self.collection,
                field_name=field,
                field_schema=qmodels.PayloadSchemaType.KEYWORD,
            )
        logger.info("[PIPELINE:QDRANT] collection créée | name=%s", self.collection)

    def delete_by_document(self, organization_id: str, document_id: str):
        self.ensure_collection()
        self.client.delete(
            collection_name=self.collection,
            points_selector=qmodels.FilterSelector(
                filter=qmodels.Filter(
                    must=[
                        qmodels.FieldCondition(
                            key="organization_id",
                            match=qmodels.MatchValue(value=organization_id),
                        ),
                        qmodels.FieldCondition(
                            key="document_id",
                            match=qmodels.MatchValue(value=document_id),
                        ),
                    ]
                )
            ),
        )

    def upsert_chunks(self, points: list[dict]):
        self.ensure_collection()
        self.client.upsert(
            collection_name=self.collection,
            points=[
                qmodels.PointStruct(id=p["id"], vector=p["vector"], payload=p["payload"])
                for p in points
            ],
        )


def new_point_id() -> str:
    return str(uuid4())
