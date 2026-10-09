"""Configuration — lit le .env racine du monorepo."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_ROOT / ".env")
load_dotenv()


def _bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")


class Settings:
    DATABASE_URL = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg://rag:rag_secret@localhost:5433/rag_enterprise",
    )
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    RQ_QUEUE = os.getenv("RQ_QUEUE", "pipeline")

    MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
    MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
    MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
    MINIO_BUCKET = os.getenv("MINIO_BUCKET", "rag-documents")
    MINIO_SECURE = _bool("MINIO_SECURE")

    QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
    QDRANT_API_KEY = os.getenv("QDRANT_API_KEY") or None
    QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "rag_chunks")

    COHERE_API_KEY = os.getenv("COHERE_API_KEY", "")
    COHERE_EMBED_MODEL = os.getenv("COHERE_EMBED_MODEL", "embed-multilingual-v3.0")
    COHERE_EMBED_DIMENSION = int(os.getenv("COHERE_EMBED_DIMENSION", "1024"))

    CHUNK_SIZE = int(os.getenv("PIPELINE_CHUNK_SIZE", "800"))
    CHUNK_OVERLAP = int(os.getenv("PIPELINE_CHUNK_OVERLAP", "120"))

    OCR_ENABLED = _bool("OCR_ENABLED", "true")
    OCR_MIN_CHARS_PER_PAGE = int(os.getenv("OCR_MIN_CHARS_PER_PAGE", "40"))
    OCR_PDF_DPI = int(os.getenv("OCR_PDF_DPI", "110"))
    OCR_ENGINE = os.getenv("OCR_ENGINE", "mistral_ocr")
    MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY", "")
    MISTRAL_OCR_MODEL = os.getenv("MISTRAL_OCR_MODEL", "mistral-ocr-latest")
    # OCR pages complexes (schémas) — pas seulement pages vides
    OCR_ON_COMPLEX = _bool("OCR_ON_COMPLEX", "true")
    OCR_COMPLEX_MIN_IMAGES = int(os.getenv("OCR_COMPLEX_MIN_IMAGES", "2"))
    # Si la page a déjà beaucoup de texte natif, on saute l'OCR (sauf beaucoup d'images)
    OCR_COMPLEX_MAX_NATIVE_CHARS = int(os.getenv("OCR_COMPLEX_MAX_NATIVE_CHARS", "350"))
    OCR_COMPLEX_FORCE_IMAGES = int(os.getenv("OCR_COMPLEX_FORCE_IMAGES", "8"))
    # Limite de pages OCR par document (coût API Mistral)
    OCR_MAX_PAGES = int(os.getenv("OCR_MAX_PAGES", "16"))
    OCR_PAGE_TIMEOUT_SEC = int(os.getenv("OCR_PAGE_TIMEOUT_SEC", "90"))
    LOG_LEVEL = (os.getenv("LOG_LEVEL") or "INFO").upper()


settings = Settings()
