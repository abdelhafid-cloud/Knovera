from datetime import datetime, timedelta, timezone
from uuid import UUID

from app.extensions import db
from app.models import Invitation, Organization, OrganizationMember, Permission, Role, User
from app.services.organizations import quotas as quota_service
from app.services.rbac_seed import PERMISSION_SEED, ROLE_PERMISSION_MAP
from app.utils.security import generate_token, hash_password, hash_token, slugify


def ensure_permissions():
    existing = {p.code: p for p in db.session.query(Permission).all()}
    for code, description in PERMISSION_SEED:
        if code not in existing:
            perm = Permission(code=code, description=description)
            db.session.add(perm)
            existing[code] = perm
    db.session.flush()
    return existing


def get_or_create_system_roles():
    permissions = ensure_permissions()
    roles = {}
    for code, name in (("org_admin", "Organization Admin"), ("org_member", "Organization Member")):
        role = db.session.query(Role).filter_by(organization_id=None, code=code).first()
        if not role:
            role = Role(organization_id=None, code=code, name=name, is_system=True)
            db.session.add(role)
            db.session.flush()
        desired = ROLE_PERMISSION_MAP[code]
        role.permissions = [permissions[c] for c in desired if c in permissions]
        roles[code] = role
    db.session.flush()
    return roles


def seed_super_admin(email, password, first_name, last_name):
    ensure_permissions()
    get_or_create_system_roles()
    user = db.session.query(User).filter(User.email == email.lower()).first()
    if not user:
        user = User(
            email=email.lower(),
            password_hash=hash_password(password),
            first_name=first_name,
            last_name=last_name,
            is_super_admin=True,
            is_active=True,
        )
        db.session.add(user)
    else:
        user.is_super_admin = True
        user.is_active = True
    db.session.commit()
    ensure_super_admin_workspace(user)
    return user


def _find_super_admin_workspace(user: User) -> Organization | None:
    uid = str(user.id)
    candidates = (
        db.session.query(Organization)
        .filter(Organization.status != "deleted")
        .order_by(Organization.created_at.asc())
        .all()
    )
    for org in candidates:
        settings = org.settings or {}
        if settings.get("is_super_admin_workspace") and settings.get("owner_user_id") == uid:
            return org
    return None


def ensure_super_admin_workspace(user: User) -> tuple[Organization, KnowledgeBase | None]:
    """Personal workspace for a super admin (upload / RAG testing).

    Creates the org once. The default « Base de test » is only created with a
    brand-new workspace — it is NOT recreated after the user deletes it.
    """
    from app.models import KnowledgeBase

    if not user.is_super_admin:
        raise ValueError("Réservé au super admin")

    org = _find_super_admin_workspace(user)
    roles = get_or_create_system_roles()
    created_org = False

    if not org:
        created_org = True
        slug = f"sa-espace-{str(user.id).replace('-', '')[:12]}"
        while db.session.query(Organization).filter_by(slug=slug).first():
            slug = f"{slug}-x"
        display = (user.first_name or "Super").strip() or "Super"
        org = Organization(
            name=f"Mon espace — {display}",
            slug=slug,
            status="active",
            settings={
                "is_super_admin_workspace": True,
                "owner_user_id": str(user.id),
                "quotas": {
                    "max_members": 10,
                    "max_documents": 5000,
                    "max_assistants": 50,
                    "max_knowledge_bases": 50,
                    "max_storage_bytes": 50 * 1024 * 1024 * 1024,
                },
            },
        )
        db.session.add(org)
        db.session.flush()

    # Ensure membership so the space appears as "theirs"
    member = (
        db.session.query(OrganizationMember)
        .filter_by(user_id=user.id, organization_id=org.id)
        .first()
    )
    if not member:
        db.session.add(
            OrganizationMember(
                organization_id=org.id,
                user_id=user.id,
                role_id=roles["org_admin"].id,
                status="active",
            )
        )
    elif member.status != "active":
        member.status = "active"
        member.role_id = roles["org_admin"].id

    kb = (
        db.session.query(KnowledgeBase)
        .filter_by(organization_id=org.id)
        .order_by(KnowledgeBase.created_at.asc())
        .first()
    )
    # Seed default KB only when provisioning a brand-new workspace
    if created_org and not kb:
        kb = KnowledgeBase(
            organization_id=org.id,
            name="Base de test",
            description="Knowledge base personnelle du super admin",
            rag_settings={"chunk_size": 800, "overlap": 120, "top_k": 5},
            created_by=user.id,
        )
        db.session.add(kb)
        db.session.flush()

    db.session.commit()
    return org, kb


def resolve_logo_url(org: Organization) -> str | None:
    """MinIO storage key → URL proxy publique."""
    logo = org.logo_url
    if not logo:
        return None
    if (
        logo.startswith("http://")
        or logo.startswith("https://")
        or logo.startswith("data:")
        or logo.startswith("/")
    ):
        return logo
    from flask import has_request_context, request

    version = int(org.updated_at.timestamp()) if org.updated_at else 0
    if has_request_context():
        return f"{request.url_root.rstrip('/')}/api/organizations/{org.id}/logo?v={version}"
    return f"/api/organizations/{org.id}/logo?v={version}"


def organization_to_dict(org: Organization, include_usage: bool = False):
    settings = org.settings or {}
    data = {
        "id": str(org.id),
        "name": org.name,
        "slug": org.slug,
        "logo_url": resolve_logo_url(org),
        "status": org.status,
        "settings": settings,
        "is_super_admin_workspace": bool(settings.get("is_super_admin_workspace")),
        "created_at": org.created_at.isoformat() if org.created_at else None,
        "updated_at": org.updated_at.isoformat() if org.updated_at else None,
    }
    if include_usage:
        data.update(quota_service.usage_vs_quotas(org))
    return data


def create_organization(
    name: str,
    admin_email: str | None = None,
    admin_password: str | None = None,
    admin_name=None,
    invited_by: UUID | None = None,
    admin_first_name: str | None = None,
    admin_last_name: str | None = None,
    quotas: dict | None = None,
):
    """
    Create an organization.
    - If admin_email + admin_password: create admin user immediately.
    - If admin_email only: create an invitation (invite email).
    Returns (org, meta) where meta may include invitation_token / admin_created.
    """
    base_slug = slugify(name)
    slug = base_slug
    i = 1
    while db.session.query(Organization).filter_by(slug=slug).first():
        slug = f"{base_slug}-{i}"
        i += 1

    admin_email = (admin_email or "").strip().lower() or None
    admin_password = (admin_password or "").strip() or None
    initial_quotas = dict(quota_service.DEFAULT_QUOTAS)
    if isinstance(quotas, dict):
        for key in quota_service.DEFAULT_QUOTAS:
            if key in quotas and quotas[key] is not None:
                try:
                    val = int(quotas[key])
                    if val >= 0:
                        initial_quotas[key] = val
                except (TypeError, ValueError):
                    continue

    org = Organization(
        name=name.strip(),
        slug=slug,
        # Avec admin (invitation ou compte) → invited jusqu'à acceptation / 1ère connexion
        status="invited" if admin_email else "active",
        settings={"quotas": initial_quotas},
    )
    db.session.add(org)
    db.session.flush()

    roles = get_or_create_system_roles()
    meta: dict = {"admin_created": False, "invitation_token": None, "admin_email": None}

    if admin_email and admin_password and len(admin_password) >= 8:
        admin_user = db.session.query(User).filter(User.email == admin_email).first()
        if not admin_user:
            fallback = (admin_name or "Admin").strip()
            first = (admin_first_name or "").strip() or fallback.split(" ")[0]
            last = (admin_last_name or "").strip() or (
                " ".join(fallback.split(" ")[1:]) or "Org"
            )
            admin_user = User(
                email=admin_email,
                password_hash=hash_password(admin_password),
                first_name=first,
                last_name=last,
                is_active=True,
            )
            db.session.add(admin_user)
            db.session.flush()
        existing = (
            db.session.query(OrganizationMember)
            .filter_by(organization_id=org.id, user_id=admin_user.id)
            .first()
        )
        if not existing:
            db.session.add(
                OrganizationMember(
                    organization_id=org.id,
                    user_id=admin_user.id,
                    role_id=roles["org_admin"].id,
                    status="active",
                )
            )
        meta["admin_created"] = True
        meta["admin_email"] = admin_email
        meta["temporary_password"] = admin_password
    elif admin_email:
        inviter = invited_by
        if not inviter:
            # fallback: any super admin
            sa = db.session.query(User).filter_by(is_super_admin=True).first()
            inviter = sa.id if sa else None
        if inviter:
            invitation, raw = create_invitation(
                org.id, admin_email, "org_admin", inviter, commit=False
            )
            settings = dict(org.settings or {})
            settings["pending_admin"] = {
                "email": admin_email,
                "first_name": (admin_first_name or "").strip(),
                "last_name": (admin_last_name or "").strip(),
            }
            org.settings = settings
            meta["invitation_token"] = raw
            meta["admin_email"] = admin_email
            meta["invitation_id"] = str(invitation.id)

    db.session.commit()
    return org, meta


def create_invitation(
    organization_id: UUID,
    email: str,
    role_code: str,
    invited_by: UUID,
    *,
    commit: bool = True,
):
    roles = get_or_create_system_roles()
    role = roles.get(role_code) or roles["org_member"]
    raw = generate_token(32)
    invitation = Invitation(
        organization_id=organization_id,
        email=email.lower().strip(),
        role_id=role.id,
        token_hash=hash_token(raw),
        invited_by=invited_by,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        status="pending",
    )
    db.session.add(invitation)
    if commit:
        db.session.commit()
    else:
        db.session.flush()
    return invitation, raw


def preview_invitation(token: str):
    """Public preview: org logo + name for the activation screen."""
    from app.models import Role

    invitation = db.session.query(Invitation).filter_by(token_hash=hash_token(token)).first()
    now = datetime.now(timezone.utc)
    if not invitation or invitation.status != "pending" or invitation.expires_at < now:
        return None, "Invitation invalide ou expirée"

    org = db.session.get(Organization, invitation.organization_id)
    if not org or org.status == "deleted":
        return None, "Organisation introuvable"

    pending = (org.settings or {}).get("pending_admin") or {}
    first_name = ""
    last_name = ""
    if (pending.get("email") or "").lower() == invitation.email.lower():
        first_name = (pending.get("first_name") or "").strip()
        last_name = (pending.get("last_name") or "").strip()

    role = db.session.get(Role, invitation.role_id)
    return {
        "email": invitation.email,
        "first_name": first_name or None,
        "last_name": last_name or None,
        "organization_name": org.name,
        "logo_url": resolve_logo_url(org),
        "role_code": role.code if role else None,
    }, None


def accept_invitation(token: str, password: str, first_name: str, last_name: str):
    invitation = db.session.query(Invitation).filter_by(token_hash=hash_token(token)).first()
    now = datetime.now(timezone.utc)
    if not invitation or invitation.status != "pending" or invitation.expires_at < now:
        return None, "Invitation invalide ou expirée"

    org = db.session.get(Organization, invitation.organization_id)
    pending = ((org.settings or {}) if org else {}).get("pending_admin") or {}
    if (pending.get("email") or "").lower() == invitation.email.lower():
        first_name = (first_name or "").strip() or (pending.get("first_name") or "")
        last_name = (last_name or "").strip() or (pending.get("last_name") or "")

    user = db.session.query(User).filter(User.email == invitation.email).first()
    if not user:
        user = User(
            email=invitation.email,
            password_hash=hash_password(password),
            first_name=(first_name or "Admin").strip() or "Admin",
            last_name=(last_name or "").strip(),
            is_active=True,
        )
        db.session.add(user)
        db.session.flush()
    else:
        if password:
            user.password_hash = hash_password(password)
        user.first_name = first_name.strip() or user.first_name
        user.last_name = last_name.strip() or user.last_name

    existing = (
        db.session.query(OrganizationMember)
        .filter_by(organization_id=invitation.organization_id, user_id=user.id)
        .first()
    )
    # First active member of an org is always org_admin
    roles = get_or_create_system_roles()
    active_count = (
        db.session.query(OrganizationMember)
        .filter_by(organization_id=invitation.organization_id, status="active")
        .count()
    )
    role_id = invitation.role_id
    if active_count == 0:
        role_id = roles["org_admin"].id

    if not existing:
        db.session.add(
            OrganizationMember(
                organization_id=invitation.organization_id,
                user_id=user.id,
                role_id=role_id,
                status="active",
            )
        )
    else:
        existing.status = "active"
        existing.role_id = role_id if active_count == 0 else invitation.role_id

    invitation.status = "accepted"
    invitation.accepted_at = now

    # Première acceptation → organisation active
    if org and org.status == "invited":
        org.status = "active"
    if org and (org.settings or {}).get("pending_admin"):
        settings = dict(org.settings or {})
        pending = settings.get("pending_admin") or {}
        if (pending.get("email") or "").lower() == invitation.email.lower():
            settings.pop("pending_admin", None)
            org.settings = settings

    db.session.commit()
    return user, None


def create_organization_user(
    organization_id: UUID,
    email: str,
    password: str,
    first_name: str,
    last_name: str,
    role_code: str = "org_member",
    assistant_ids: list | None = None,
):
    """Create (or attach) a user in an organization. First member is always org_admin.

    For org_member: optional assistant_ids grants AssistantAccess per assistant.
    For org_admin: full access via role (no ACL rows needed).
    """
    from app.models import Assistant, AssistantAccess

    email = email.lower().strip()
    if not email or len(password) < 8:
        return None, "Email et mot de passe (min 8) requis"

    org = db.session.get(Organization, organization_id)
    if not org or org.status == "deleted":
        return None, "Organisation introuvable"
    if org.status == "suspended":
        return None, "Organisation suspendue"

    roles = get_or_create_system_roles()
    if role_code not in ("org_admin", "org_member"):
        role_code = "org_member"

    active_count = (
        db.session.query(OrganizationMember)
        .filter_by(organization_id=organization_id, status="active")
        .count()
    )
    if active_count == 0:
        role_code = "org_admin"

    role = roles[role_code]
    user = db.session.query(User).filter(User.email == email).first()
    if user:
        membership = (
            db.session.query(OrganizationMember)
            .filter_by(organization_id=organization_id, user_id=user.id)
            .first()
        )
        if membership and membership.status == "active":
            return None, "Cet utilisateur est déjà membre de l'organisation"
        ok, err = quota_service.check_quota(org, "members", 1)
        if not ok:
            return None, err
        if password:
            user.password_hash = hash_password(password)
        user.first_name = first_name.strip() or user.first_name
        user.last_name = last_name.strip() or user.last_name
        user.is_active = True
        if membership:
            membership.status = "active"
            membership.role_id = role.id
        else:
            db.session.add(
                OrganizationMember(
                    organization_id=organization_id,
                    user_id=user.id,
                    role_id=role.id,
                    status="active",
                )
            )
    else:
        ok, err = quota_service.check_quota(org, "members", 1)
        if not ok:
            return None, err
        user = User(
            email=email,
            password_hash=hash_password(password),
            first_name=first_name.strip() or "User",
            last_name=last_name.strip() or "",
            is_active=True,
        )
        db.session.add(user)
        db.session.flush()
        db.session.add(
            OrganizationMember(
                organization_id=organization_id,
                user_id=user.id,
                role_id=role.id,
                status="active",
            )
        )

    db.session.flush()

    # Accès assistants : membres seulement (admin = tout automatiquement)
    if role_code == "org_member" and assistant_ids:
        for raw_aid in assistant_ids:
            try:
                aid = UUID(str(raw_aid))
            except (ValueError, TypeError):
                continue
            assistant = db.session.get(Assistant, aid)
            if not assistant or assistant.organization_id != organization_id:
                continue
            exists = (
                db.session.query(AssistantAccess)
                .filter_by(assistant_id=aid, user_id=user.id)
                .first()
            )
            if exists:
                continue
            db.session.add(
                AssistantAccess(
                    assistant_id=aid,
                    organization_id=organization_id,
                    user_id=user.id,
                )
            )

    db.session.commit()
    return user, None


ALLOWED_LOGO_EXT = {"jpg", "jpeg", "png", "webp", "gif"}
LOGO_MIME = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
}


def upload_organization_logo(org: Organization, file_storage):
    from datetime import datetime, timezone
    from uuid import uuid4

    from flask import current_app
    from werkzeug.utils import secure_filename

    from app.services.documents.service import get_s3_client

    if not file_storage or not file_storage.filename:
        return None, "Fichier requis"

    filename = secure_filename(file_storage.filename)
    if "." not in filename:
        return None, "Extension invalide"
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_LOGO_EXT:
        return None, "Formats autorisés : JPG, PNG, WEBP, GIF"

    data = file_storage.read()
    if len(data) > 2 * 1024 * 1024:
        return None, "Image trop lourde (max 2 Mo)"

    old = org.logo_url
    storage_key = f"org-logos/{org.id}/{uuid4().hex}.{ext}"
    client = get_s3_client()
    bucket = current_app.config["MINIO_BUCKET"]
    try:
        client.put_object(
            Bucket=bucket,
            Key=storage_key,
            Body=data,
            ContentType=LOGO_MIME.get(ext, "application/octet-stream"),
        )
    except Exception as exc:
        return None, f"Erreur stockage: {exc}"

    if old and not (
        old.startswith("http://")
        or old.startswith("https://")
        or old.startswith("data:")
        or old.startswith("/")
    ):
        try:
            client.delete_object(Bucket=bucket, Key=old)
        except Exception:
            pass

    org.logo_url = storage_key
    org.updated_at = datetime.now(timezone.utc)
    db.session.commit()
    return org, None


def get_organization_logo_bytes(org: Organization):
    from flask import current_app

    from app.services.documents.service import get_s3_client

    if not org.logo_url:
        return None, None
    key = org.logo_url
    if key.startswith("http") or key.startswith("data:"):
        return None, None
    client = get_s3_client()
    try:
        obj = client.get_object(Bucket=current_app.config["MINIO_BUCKET"], Key=key)
        return obj["Body"].read(), obj.get("ContentType") or "application/octet-stream"
    except Exception:
        return None, None


def remove_organization_logo(org: Organization):
    from datetime import datetime, timezone

    from flask import current_app

    from app.services.documents.service import get_s3_client

    key = org.logo_url
    if key and not key.startswith("http") and not key.startswith("data:") and not key.startswith("/"):
        try:
            client = get_s3_client()
            client.delete_object(Bucket=current_app.config["MINIO_BUCKET"], Key=key)
        except Exception:
            pass
    org.logo_url = None
    org.updated_at = datetime.now(timezone.utc)
    db.session.commit()
    return org
