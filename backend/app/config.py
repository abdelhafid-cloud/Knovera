import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

# Load .env BEFORE reading os.getenv in Config (import order is critical)
_ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"
_BACKEND_ENV = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(_ROOT_ENV)
load_dotenv(_BACKEND_ENV)
load_dotenv()


class Config:
    APP_NAME = os.getenv("APP_NAME", "Knovera")
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
    FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
    CORS_ORIGINS = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
        if origin.strip()
    ]

    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg://rag:rag_secret@localhost:5433/rag_enterprise",
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": 300,
        "connect_args": {"connect_timeout": 5},
    }

    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", SECRET_KEY)
    JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(
        minutes=int(os.getenv("JWT_ACCESS_TOKEN_EXPIRES_MINUTES", "15"))
    )
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(
        days=int(os.getenv("JWT_REFRESH_TOKEN_EXPIRES_DAYS", "14"))
    )
    JWT_TOKEN_LOCATION = ["headers"]
    JWT_COOKIE_SECURE = os.getenv("APP_ENV", "development") == "production"
    JWT_COOKIE_CSRF_PROTECT = False
    JWT_COOKIE_SAMESITE = os.getenv("JWT_COOKIE_SAMESITE", "Lax")
    JWT_ACCESS_COOKIE_NAME = "access_token"
    JWT_REFRESH_COOKIE_NAME = "refresh_token"
    JWT_ENCODE_ISSUER = os.getenv("JWT_ISSUER", "org.rag")
    JWT_DECODE_ISSUER = os.getenv("JWT_ISSUER", "org.rag")
    JWT_ENCODE_AUDIENCE = os.getenv("JWT_AUDIENCE", "org.rag-api")
    JWT_DECODE_AUDIENCE = os.getenv("JWT_AUDIENCE", "org.rag-api")

    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

    MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
    MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
    MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
    MINIO_BUCKET = os.getenv("MINIO_BUCKET", "rag-documents")
    MINIO_SECURE = os.getenv("MINIO_SECURE", "false").lower() == "true"

    QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
    QDRANT_API_KEY = os.getenv("QDRANT_API_KEY") or None
    QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "rag_chunks")

    COHERE_API_KEY = os.getenv("COHERE_API_KEY", "")
    COHERE_EMBED_MODEL = os.getenv("COHERE_EMBED_MODEL", "embed-multilingual-v3.0")
    COHERE_EMBED_DIMENSION = int(os.getenv("COHERE_EMBED_DIMENSION", "1024"))

    LLM_API_KEY = os.getenv("LLM_API_KEY", "")
    LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
    LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")

    MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "25"))
    ALLOWED_EXTENSIONS = {
        ext.strip().lower()
        for ext in os.getenv("ALLOWED_EXTENSIONS", "pdf,docx,txt,xlsx").split(",")
        if ext.strip()
    }

    SEED_SUPER_ADMIN_EMAIL = os.getenv("SEED_SUPER_ADMIN_EMAIL", "admin@rag.local")
    SEED_SUPER_ADMIN_PASSWORD = os.getenv("SEED_SUPER_ADMIN_PASSWORD", "ChangeMe123!")
    SEED_SUPER_ADMIN_FIRST_NAME = os.getenv("SEED_SUPER_ADMIN_FIRST_NAME", "Super")
    SEED_SUPER_ADMIN_LAST_NAME = os.getenv("SEED_SUPER_ADMIN_LAST_NAME", "Admin")

    # Email / SMTP (optional — dry-run logs to console if unset)
    SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER = os.getenv("SMTP_USER", "").strip()
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
    SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() == "true"
    MAIL_FROM = os.getenv("MAIL_FROM", "").strip()

    RATELIMIT_STORAGE_URI = os.getenv("RATELIMIT_STORAGE_URI") or (
        "memory://"
        if os.getenv("APP_ENV", "development") != "production"
        else os.getenv("REDIS_URL", "redis://localhost:6379/0")
    )
    RATELIMIT_DEFAULT = "200 per hour"


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False
    JWT_COOKIE_SECURE = True


class TestingConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "TEST_DATABASE_URL",
        "postgresql+psycopg://rag:rag_secret@localhost:5432/rag_enterprise_test",
    )


def _assert_production_secrets():
    """Refuse les placeholders en production."""
    if os.getenv("APP_ENV", "development") != "production":
        return
    weak = (
        "dev-secret-change-me",
        "change-me-to-a-long-random-string-at-least-32-chars",
        "change-me-jwt-secret-long-random-at-least-32-chars",
    )
    secret = os.getenv("SECRET_KEY", "")
    jwt_secret = os.getenv("JWT_SECRET_KEY", "") or secret
    if not secret or len(secret) < 32 or secret in weak:
        raise RuntimeError("SECRET_KEY production invalide (min 32 chars, non placeholder)")
    if not jwt_secret or len(jwt_secret) < 32 or jwt_secret in weak:
        raise RuntimeError("JWT_SECRET_KEY production invalide (min 32 chars, non placeholder)")


_assert_production_secrets()


config_by_name = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
    "testing": TestingConfig,
}
