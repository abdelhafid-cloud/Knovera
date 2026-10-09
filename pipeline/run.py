"""
Worker RQ — point d'entrée unique à la racine de pipeline/.

Depuis la racine du repo (recommandé) :
  python -m pipeline.run
  powershell -File scripts/start-pipeline.ps1

Depuis pipeline/ :
  python run.py
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

# Repo root = parent de pipeline/ — obligatoire pour `import pipeline`
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
os.environ["PYTHONPATH"] = (
    str(_ROOT)
    if not os.environ.get("PYTHONPATH")
    else str(_ROOT) + os.pathsep + os.environ["PYTHONPATH"]
)
os.environ["RAG_PROCESS"] = "pipeline"
os.chdir(_ROOT)

# UTF-8 console (évite les erreurs cp1252 sur Windows)
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
except Exception:
    pass

from dotenv import load_dotenv
from redis import Redis
from rq import Queue, Worker
from rq.worker import SimpleWorker

load_dotenv(_ROOT / ".env")
load_dotenv()


def main() -> int:
    from pipeline.app.config import settings
    from pipeline.app.logging_config import configure_logging

    configure_logging(force=True)

    # Vérifie que le job est importable avant d'écouter
    try:
        from pipeline.app.jobs import run_process_document  # noqa: F401
    except Exception:
        logging.exception(
            "[PIPELINE] Impossible d'importer pipeline.app.jobs — "
            "lancez depuis la racine: python -m pipeline.run"
        )
        return 1

    use_simple = sys.platform.startswith("win") or os.getenv(
        "RQ_SIMPLE_WORKER", ""
    ).strip().lower() in ("1", "true", "yes")
    conn = Redis.from_url(settings.REDIS_URL)
    queue_name = settings.RQ_QUEUE
    queues = [Queue(queue_name, connection=conn)]
    worker_cls = SimpleWorker if use_simple else Worker

    logging.info("=" * 50)
    logging.info("  PIPELINE — worker documents")
    logging.info("  Queue   : %s", queue_name)
    logging.info("  Redis   : %s", settings.REDIS_URL)
    logging.info("  OCR     : enabled=%s | engine=%s", settings.OCR_ENABLED, settings.OCR_ENGINE)
    logging.info("  PYTHONPATH root: %s", _ROOT)
    if not settings.OCR_ENABLED:
        logging.warning(
            "  OCR_ENABLED=false — scans/images sans texte natif non indexés"
        )
    logging.info("=" * 50)

    worker_cls(queues, connection=conn).work(with_scheduler=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
