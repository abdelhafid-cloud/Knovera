from functools import wraps
import hashlib
import secrets
import re
from uuid import UUID

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from flask import g, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, verify_jwt_in_request

from app.extensions import db
from app.models import Organization, OrganizationMember, User


ph = PasswordHasher()


def hash_password(password: str) -> str:
    return ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return ph.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def slugify(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^\w\s-]", "", value)
    value = re.sub(r"[\s_-]+", "-", value)
    return value[:90] or "org"


def api_success(data=None, meta=None, status=200):
    return jsonify({"success": True, "data": data, "error": None, "meta": meta}), status


def api_error(message, status=400, code=None, details=None):
    return (
        jsonify(
            {
                "success": False,
                "data": None,
                "error": {"message": message, "code": code or "error", "details": details},
                "meta": None,
            }
        ),
        status,
    )


def parse_uuid(value, field_name="id"):
    try:
        return UUID(str(value))
    except (ValueError, TypeError):
        raise ValueError(f"{field_name} invalide")


def get_current_user() -> User | None:
    identity = get_jwt_identity()
    if not identity:
        return None
    return db.session.get(User, UUID(identity))


def resolve_tenant_context(user: User):
    """Resolve organization from validated membership — never trust client blindly."""
    claims = get_jwt() or {}
    is_super_admin = bool(user.is_super_admin or claims.get("is_super_admin"))

    org_header = request.headers.get("X-Organization-Id")
    membership = None
    organization = None

    if org_header:
        try:
            org_id = UUID(org_header)
        except ValueError:
            return None, None, is_super_admin, "organization_id invalide"

        membership = (
            db.session.query(OrganizationMember)
            .filter_by(user_id=user.id, organization_id=org_id, status="active")
            .first()
        )
        if membership:
            organization = membership.organization
        elif is_super_admin:
            organization = db.session.get(Organization, org_id)
            if organization and organization.status == "deleted":
                organization = None
        else:
            return None, None, is_super_admin, "Accès organisation refusé"

    elif not is_super_admin:
        memberships = (
            db.session.query(OrganizationMember)
            .filter_by(user_id=user.id, status="active")
            .all()
        )
        if len(memberships) == 1:
            membership = memberships[0]
            organization = membership.organization

    if organization and organization.status == "suspended" and not is_super_admin:
        return None, None, is_super_admin, "Organisation suspendue"
    if organization and organization.status == "invited" and not is_super_admin:
        return None, None, is_super_admin, "Organisation en attente d'activation (invitation)"

    return organization, membership, is_super_admin, None


def permission_codes_for_membership(membership: OrganizationMember | None) -> set[str]:
    if not membership or not membership.role:
        return set()
    return {p.code for p in membership.role.permissions}


ORG_ADMIN_PERMISSIONS = {
    "org.dashboard.view",
    "org.settings.manage",
    "org.members.manage",
    "org.invitations.manage",
    "documents.list",
    "documents.upload",
    "documents.delete",
    "documents.view_content",
    "knowledge_bases.manage",
    "assistants.manage",
    "assistants.use",
    "chat.create",
    "conversations.view_own",
    "conversations.view_org",
    "profile.manage_own",
}

ORG_MEMBER_PERMISSIONS = {
    "assistants.use",
    "chat.create",
    "conversations.view_own",
    "profile.manage_own",
}

SUPER_ADMIN_PERMISSIONS = {
    "platform.dashboard.view",
    "platform.organizations.manage",
    "platform.users.manage",
    "platform.settings.manage",
    "platform.audit.view",
    "platform.analytics.view",
    "profile.manage_own",
}


def auth_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        verify_jwt_in_request()
        user = get_current_user()
        if not user or not user.is_active:
            return api_error("Non authentifié", 401, code="unauthorized")

        organization, membership, is_super_admin, err = resolve_tenant_context(user)
        if err and request.headers.get("X-Organization-Id"):
            return api_error(err, 403, code="forbidden")

        g.current_user = user
        g.organization = organization
        g.membership = membership
        g.is_super_admin = is_super_admin
        g.permissions = set()
        if is_super_admin:
            g.permissions |= SUPER_ADMIN_PERMISSIONS
        g.permissions |= permission_codes_for_membership(membership)
        return fn(*args, **kwargs)

    return wrapper


def require_permissions(*codes):
    def decorator(fn):
        @wraps(fn)
        @auth_required
        def wrapper(*args, **kwargs):
            missing = [c for c in codes if c not in g.permissions]
            if missing and not (g.is_super_admin and all(c.startswith("platform.") for c in codes)):
                if not all(c in g.permissions for c in codes):
                    # Super admin platform perms already in g.permissions
                    if missing:
                        return api_error("Permission insuffisante", 403, code="forbidden")
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def require_org_context(fn):
    @wraps(fn)
    @auth_required
    def wrapper(*args, **kwargs):
        if not g.organization:
            return api_error(
                "Header X-Organization-Id requis",
                400,
                code="org_required",
            )
        return fn(*args, **kwargs)

    return wrapper
