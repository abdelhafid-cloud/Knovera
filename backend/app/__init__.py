import logging
import os

from dotenv import load_dotenv
from flask import Flask, request
from flask_cors import CORS

from app.config import config_by_name
from app.extensions import db, jwt, limiter, migrate


def _ensure_org_status_invited():
    """Add 'invited' to org_status enum if missing (Postgres)."""
    try:
        db.session.execute(
            db.text(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_enum e
                        JOIN pg_type t ON e.enumtypid = t.oid
                        WHERE t.typname = 'org_status' AND e.enumlabel = 'invited'
                    ) THEN
                        ALTER TYPE org_status ADD VALUE 'invited';
                    END IF;
                END
                $$;
                """
            )
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
        logging.getLogger(__name__).exception("Could not ensure org_status.invited enum value")


def _ensure_document_link_columns():
    """Add optional cloud_url / source_url on documents if missing."""
    try:
        db.session.execute(db.text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS cloud_url TEXT"))
        db.session.execute(db.text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_url TEXT"))
        db.session.commit()
    except Exception:
        db.session.rollback()
        logging.getLogger(__name__).exception("Could not ensure document link columns")


def _ensure_refresh_token_columns():
    """Colonnes rotation / audit refresh tokens."""
    try:
        db.session.execute(
            db.text(
                "ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS replaced_by UUID "
                "REFERENCES refresh_tokens(id) ON DELETE SET NULL"
            )
        )
        db.session.execute(
            db.text("ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ")
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
        logging.getLogger(__name__).exception("Could not ensure refresh_tokens columns")


def create_app(config_name=None):
    root_env = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
    load_dotenv(root_env)
    load_dotenv()  # also allow backend/.env overrides
    config_name = config_name or os.getenv("APP_ENV", "development")
    app = Flask(__name__)
    app.config.from_object(config_by_name.get(config_name, config_by_name["development"]))

    from app.logging_config import configure_logging

    configure_logging(force=True)

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)

    @jwt.token_in_blocklist_loader
    def _jwt_blocklist_callback(_jwt_header, jwt_payload):
        from app.services.auth.token_blocklist import is_jti_revoked

        return is_jti_revoked(jwt_payload.get("jti"))

    # Prefer configured storage (memory in dev) so API stays up if Redis is down
    app.config.setdefault("RATELIMIT_STORAGE_URI", "memory://")
    limiter.init_app(app)

    @limiter.request_filter
    def _exempt_options_and_health():
        # Preflight CORS must never consume / trip rate limits
        if request.method == "OPTIONS":
            return True
        if request.path in ("/api/health", "/api/auth/me"):
            return True
        return False

    CORS(
        app,
        resources={r"/*": {"origins": app.config["CORS_ORIGINS"]}},
        origins=app.config["CORS_ORIGINS"],
        supports_credentials=True,
        allow_headers=["Authorization", "Content-Type", "X-Organization-Id", "X-Requested-With"],
        methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        expose_headers=["Content-Type"],
        max_age=86400,
    )

    _CORS_ALLOW_HEADERS = (
        "Authorization, Content-Type, X-Organization-Id, X-Requested-With"
    )
    _CORS_ALLOW_METHODS = "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"

    @app.after_request
    def _ensure_cors_headers(response):
        origin = request.headers.get("Origin")
        allowed = app.config.get("CORS_ORIGINS") or []
        if origin and origin in allowed:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Headers"] = _CORS_ALLOW_HEADERS
            response.headers["Access-Control-Allow-Methods"] = _CORS_ALLOW_METHODS
            response.headers["Vary"] = "Origin"
        # Always answer preflight with the headers browsers require
        if request.method == "OPTIONS":
            response.status_code = 204
        return response

    # Import models for metadata
    from app import models as _models  # noqa: F401

    from app.routes.admin import bp as admin_bp
    from app.routes.assistants import bp_assistants, bp_chat
    from app.routes.auth import bp as auth_bp
    from app.routes.documents import bp_docs, bp_kb
    from app.routes.health import bp as health_bp
    from app.routes.organizations import bp as orgs_bp

    app.register_blueprint(health_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(orgs_bp)
    app.register_blueprint(bp_docs)
    app.register_blueprint(bp_kb)
    app.register_blueprint(bp_assistants)
    app.register_blueprint(bp_chat)
    app.register_blueprint(admin_bp)

    with app.app_context():
        _ensure_org_status_invited()
        _ensure_document_link_columns()
        _ensure_refresh_token_columns()

    # Callback pipeline → logs dans le terminal BACKEND uniquement (pas dans le worker)
    if os.getenv("RAG_PROCESS", "api") == "api":
        if (not app.debug) or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
            from app.services.pipeline_events import start_pipeline_callback_listener

            start_pipeline_callback_listener(app)

    @app.errorhandler(404)
    def not_found(_e):
        from app.utils.security import api_error

        return api_error("Ressource introuvable", 404, code="not_found")

    @app.errorhandler(429)
    def rate_limited(_e):
        from app.utils.security import api_error

        return api_error("Trop de requêtes", 429, code="rate_limited")

    @app.errorhandler(500)
    def server_error(_e):
        from app.utils.security import api_error

        app.logger.exception("Unhandled error")
        return api_error("Erreur interne", 500, code="internal_error")

    @app.cli.command("seed")
    def seed_command():
        """Seed permissions, roles and super admin."""
        from app.services.organizations.service import seed_super_admin

        user = seed_super_admin(
            email=app.config["SEED_SUPER_ADMIN_EMAIL"],
            password=app.config["SEED_SUPER_ADMIN_PASSWORD"],
            first_name=app.config["SEED_SUPER_ADMIN_FIRST_NAME"],
            last_name=app.config["SEED_SUPER_ADMIN_LAST_NAME"],
        )
        print(f"Seeded super admin: {user.email} (espace personnel créé)")

    return app
