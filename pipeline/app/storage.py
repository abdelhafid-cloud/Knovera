"""Téléchargement MinIO / S3."""

from __future__ import annotations

import time

import boto3
from botocore.client import Config

from pipeline.app.config import settings
from pipeline.app.logging_config import get_doc_logger, ms_since

logger = get_doc_logger(__name__)


def get_s3_client():
    scheme = "https" if settings.MINIO_SECURE else "http"
    return boto3.client(
        "s3",
        endpoint_url=f"{scheme}://{settings.MINIO_ENDPOINT}",
        aws_access_key_id=settings.MINIO_ACCESS_KEY,
        aws_secret_access_key=settings.MINIO_SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )


def download_bytes(storage_key: str, bucket: str | None = None) -> bytes:
    t0 = time.perf_counter()
    client = get_s3_client()
    target = (bucket or "").strip() or settings.MINIO_BUCKET
    logger.info(
        "[PIPELINE:DOWNLOAD] MinIO get_object | bucket=%s | key=%s",
        target,
        storage_key,
    )
    data = client.get_object(Bucket=target, Key=storage_key)["Body"].read()
    logger.info("[PIPELINE:DOWNLOAD] OK | bytes=%s | took=%sms", len(data), ms_since(t0))
    return data
