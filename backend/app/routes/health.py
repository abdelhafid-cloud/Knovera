from flask import Blueprint

from app.utils.security import api_success

bp = Blueprint("health", __name__)


@bp.get("/api/health")
def health():
    return api_success({"status": "ok"})


@bp.get("/api/ready")
def ready():
    from app.extensions import db

    try:
        db.session.execute(db.text("SELECT 1"))
        return api_success({"status": "ready", "database": "ok"})
    except Exception as exc:
        from app.utils.security import api_error

        return api_error(f"Database unavailable: {exc}", 503)
