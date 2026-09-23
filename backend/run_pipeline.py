"""
Terminal PIPELINE — indexation documents (séparé du backend API).

Usage (depuis backend/) :
  python run_pipeline.py
"""

from __future__ import annotations

import logging
import os
import sys

from dotenv import load_dotenv
from redis import Redis
from rq import Queue, Worker
from rq.worker import SimpleWorker


def main() -> int:
    os.environ["RAG_PROCESS"] = "pipeline"

    root_env = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env"))
    load_dotenv(root_env)
    load_dotenv()

    # Configure logging avant imports app
    sys.path.insert(0, os.path.dirname(__file__))
    from app.logging_config import configure_logging

    configure_logging(force=True)

    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    queue_name = os.getenv("RQ_QUEUE", "documents")
    force_simple = os.getenv("RQ_SIMPLE_WORKER", "").strip().lower() in ("1", "true", "yes")
    use_simple = force_simple or sys.platform.startswith("win")
    log_level = (os.getenv("LOG_LEVEL") or "INFO").upper()

    conn = Redis.from_url(redis_url)
    queues = [Queue(queue_name, connection=conn)]
    worker_cls = SimpleWorker if use_simple else Worker

    logging.info("=" * 60)
    logging.info("  PIPELINE RAG — worker documents")
    logging.info("  Classe  : %s", worker_cls.__name__)
    logging.info("  Queue   : %s", queue_name)
    logging.info("  Redis   : %s", redis_url)
    logging.info("  LOG_LEVEL: %s", log_level)
    logging.info("  Platform: %s", sys.platform)
    logging.info("=" * 60)

    worker = worker_cls(queues, connection=conn)
    worker.work(with_scheduler=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
