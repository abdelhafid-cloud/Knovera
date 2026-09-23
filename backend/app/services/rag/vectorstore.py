from uuid import uuid4

from flask import current_app
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from app.logging_config import get_doc_logger

logger = get_doc_logger(__name__)


class QdrantVectorStore:
    def __init__(self):
        self.client = QdrantClient(
            url=current_app.config["QDRANT_URL"],
            api_key=current_app.config.get("QDRANT_API_KEY"),
            check_compatibility=False,
        )
        self.collection = current_app.config["QDRANT_COLLECTION"]
        self.dimension = current_app.config["COHERE_EMBED_DIMENSION"]

    def ensure_collection(self):
        collections = [c.name for c in self.client.get_collections().collections]
        if self.collection not in collections:
            self.client.create_collection(
                collection_name=self.collection,
                vectors_config=qmodels.VectorParams(
                    size=self.dimension,
                    distance=qmodels.Distance.COSINE,
                ),
            )
            self.client.create_payload_index(
                collection_name=self.collection,
                field_name="organization_id",
                field_schema=qmodels.PayloadSchemaType.KEYWORD,
            )
            self.client.create_payload_index(
                collection_name=self.collection,
                field_name="knowledge_base_id",
                field_schema=qmodels.PayloadSchemaType.KEYWORD,
            )
            self.client.create_payload_index(
                collection_name=self.collection,
                field_name="document_id",
                field_schema=qmodels.PayloadSchemaType.KEYWORD,
            )

    def upsert_chunks(self, points: list[dict]):
        """points: {id, vector, payload}"""
        self.ensure_collection()
        logger.info(
            "[PIPELINE:PERSIST] qdrant.upsert | collection=%s | points=%s",
            self.collection,
            len(points),
        )
        self.client.upsert(
            collection_name=self.collection,
            points=[
                qmodels.PointStruct(
                    id=p["id"],
                    vector=p["vector"],
                    payload=p["payload"],
                )
                for p in points
            ],
        )
        logger.info(
            "[PIPELINE:PERSIST] qdrant.upsert OK | collection=%s | points=%s",
            self.collection,
            len(points),
        )

    def search(
        self,
        vector: list[float],
        organization_id: str,
        knowledge_base_id: str,
        top_k: int = 5,
    ):
        self.ensure_collection()
        # qdrant-client >= 1.16 removed client.search(); use query_points
        response = self.client.query_points(
            collection_name=self.collection,
            query=vector,
            limit=top_k,
            query_filter=qmodels.Filter(
                must=[
                    qmodels.FieldCondition(
                        key="organization_id",
                        match=qmodels.MatchValue(value=organization_id),
                    ),
                    qmodels.FieldCondition(
                        key="knowledge_base_id",
                        match=qmodels.MatchValue(value=knowledge_base_id),
                    ),
                    qmodels.FieldCondition(
                        key="document_status",
                        match=qmodels.MatchValue(value="indexed"),
                    ),
                ]
            ),
            with_payload=True,
        )
        return list(response.points or [])

    def delete_by_document(self, organization_id: str, document_id: str):
        self.ensure_collection()
        logger.info(
            "[PIPELINE:PURGE] qdrant.delete_by_document | collection=%s | document_id=%s",
            self.collection,
            document_id,
        )
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

    def delete_by_knowledge_base(self, organization_id: str, knowledge_base_id: str):
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
                            key="knowledge_base_id",
                            match=qmodels.MatchValue(value=knowledge_base_id),
                        ),
                    ]
                )
            ),
        )


def new_point_id() -> str:
    return str(uuid4())
