from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from flask import current_app, request
from flask_jwt_extended import create_access_token

from app.extensions import db
from app.models import OrganizationMember, PasswordResetToken, RefreshToken, User
from app.utils.security import generate_token, hash_password, hash_token, verify_password


def user_to_dict(user: User, memberships=None):
    avatar = user.avatar_url
    if avatar and not (
        avatar.startswith("http://")
        or avatar.startswith("https://")
        or avatar.startswith("data:")
        or avatar.startswith("/")
    ):
        # MinIO storage key → public proxy URL (+ cache bust)
        from flask import has_request_context, request

        version = int(user.updated_at.timestamp()) if user.updated_at else 0
        if has_request_context():
            avatar = f"{request.url_root.rstrip('/')}/api/auth/avatars/{user.id}?v={version}"
        else:
            avatar = f"/api/auth/avatars/{user.id}?v={version}"

    data = {
        "id": str(user.id),
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": user.full_name,
        "avatar_url": avatar,
        "is_active": user.is_active,
        "is_super_admin": user.is_super_admin,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }
    if memberships is not None:
        data["memberships"] = memberships
    return data


def membership_to_dict(m: OrganizationMember):
    logo = None
    if m.organization:
        from app.services.organizations.service import resolve_logo_url

        logo = resolve_logo_url(m.organization)
    return {
        "id": str(m.id),
        "organization_id": str(m.organization_id),
        "organization_name": m.organization.name if m.organization else None,
        "organization_slug": m.organization.slug if m.organization else None,
        "organization_status": m.organization.status if m.organization else None,
        "organization_logo_url": logo,
        "role": {
            "id": str(m.role_id),
            "code": m.role.code if m.role else None,
            "name": m.role.name if m.role else None,
        },
        "permissions": [p.code for p in m.role.permissions] if m.role else [],
        "status": m.status,
    }


def issue_tokens(
    user: User,
    *,
    family_id=None,
    replaced_token: RefreshToken | None = None,
    commit: bool = True,
):
    """Émet access JWT + refresh opaque. family_id=None → nouvelle session (login)."""
    from flask import has_request_context

    additional_claims = {"is_super_admin": bool(user.is_super_admin)}
    access = create_access_token(identity=str(user.id), additional_claims=additional_claims)
    raw_refresh = generate_token(48)
    fid = family_id or uuid4()
    expires = datetime.now(timezone.utc) + current_app.config["JWT_REFRESH_TOKEN_EXPIRES"]
    now = datetime.now(timezone.utc)
    ua = None
    ip = None
    if has_request_context():
        ua = request.headers.get("User-Agent")
        ip = (request.headers.get("X-Forwarded-For") or request.remote_addr or "")[:64] or None
    row = RefreshToken(
        user_id=user.id,
        token_hash=hash_token(raw_refresh),
        family_id=fid,
        expires_at=expires,
        last_used_at=now,
        user_agent=ua,
        ip_address=ip,
    )
    db.session.add(row)
    db.session.flush()
    if replaced_token is not None:
        replaced_token.replaced_by = row.id
        replaced_token.revoked_at = replaced_token.revoked_at or now
    if commit:
        db.session.commit()
    return access, raw_refresh, row


def login(email: str, password: str):
    user = db.session.query(User).filter(User.email == email.lower().strip()).first()
    if not user or not verify_password(user.password_hash, password):
        return None, "Email ou mot de passe incorrect"
    if not user.is_active:
        return None, "Compte désactivé"
    user.last_login_at = datetime.now(timezone.utc)

    from app.models import Organization

    memberships_q = (
        db.session.query(OrganizationMember)
        .filter_by(user_id=user.id, status="active")
        .all()
    )
    for m in memberships_q:
        org = m.organization or db.session.get(Organization, m.organization_id)
        if org and org.status == "invited":
            org.status = "active"

    db.session.commit()
    access, refresh, _ = issue_tokens(user)
    memberships = [membership_to_dict(m) for m in memberships_q]
    return {
        "access_token": access,
        "refresh_token": refresh,
        "user": user_to_dict(user, memberships),
    }, None


def _aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def refresh_session(raw_refresh: str):
    """Rotation atomique + détection de réutilisation (family revoke)."""
    token_hash = hash_token(raw_refresh)
    now = datetime.now(timezone.utc)

    try:
        stored = (
            db.session.query(RefreshToken)
            .filter_by(token_hash=token_hash)
            .with_for_update()
            .first()
        )

        if not stored:
            db.session.rollback()
            return None, "Refresh token invalide"

        if stored.revoked_at is not None:
            db.session.query(RefreshToken).filter_by(family_id=stored.family_id).update(
                {"revoked_at": now}, synchronize_session=False
            )
            db.session.commit()
            return None, "Refresh token révoqué"

        if _aware(stored.expires_at) < now:
            stored.revoked_at = now
            db.session.commit()
            return None, "Refresh token expiré"

        user = db.session.get(User, stored.user_id)
        if not user or not user.is_active:
            stored.revoked_at = now
            db.session.commit()
            return None, "Utilisateur invalide"

        stored.revoked_at = now
        stored.last_used_at = now
        db.session.flush()

        access, new_refresh, _new_row = issue_tokens(
            user,
            family_id=stored.family_id,
            replaced_token=stored,
            commit=True,
        )
        return {"access_token": access, "refresh_token": new_refresh}, None
    except Exception:
        db.session.rollback()
        raise


def logout(raw_refresh: str | None, access_jwt: dict | None = None):
    """Révoque le refresh courant + place le jti access en blocklist."""
    now = datetime.now(timezone.utc)
    if raw_refresh:
        stored = (
            db.session.query(RefreshToken)
            .filter_by(token_hash=hash_token(raw_refresh))
            .with_for_update()
            .first()
        )
        if stored and not stored.revoked_at:
            stored.revoked_at = now
            db.session.commit()
        else:
            db.session.rollback()

    if access_jwt:
        from app.services.auth.token_blocklist import revoke_access_jti

        revoke_access_jti(access_jwt.get("jti"), access_jwt.get("exp"))


def logout_all_sessions(user_id, access_jwt: dict | None = None):
    now = datetime.now(timezone.utc)
    db.session.query(RefreshToken).filter_by(user_id=user_id).filter(
        RefreshToken.revoked_at.is_(None)
    ).update({"revoked_at": now}, synchronize_session=False)
    db.session.commit()
    if access_jwt:
        from app.services.auth.token_blocklist import revoke_access_jti

        revoke_access_jti(access_jwt.get("jti"), access_jwt.get("exp"))


def request_password_reset(email: str):
    user = db.session.query(User).filter(User.email == email.lower().strip()).first()
    if not user:
        return None
    raw = generate_token(32)
    row = PasswordResetToken(
        user_id=user.id,
        token_hash=hash_token(raw),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    db.session.add(row)
    db.session.commit()
    current_app.logger.info(
        "Password reset demandé | user_id=%s | reset_token_id=%s (token non loggé)",
        user.id,
        row.id,
    )
    return raw


def reset_password(token: str, new_password: str):
    stored = db.session.query(PasswordResetToken).filter_by(token_hash=hash_token(token)).first()
    now = datetime.now(timezone.utc)
    if not stored or stored.used_at or stored.expires_at < now:
        return False, "Token invalide ou expiré"
    user = db.session.get(User, stored.user_id)
    if not user:
        return False, "Utilisateur introuvable"
    user.password_hash = hash_password(new_password)
    stored.used_at = now
    db.session.commit()
    logout_all_sessions(user.id)
    return True, None


def update_profile(user: User, first_name: str | None = None, last_name: str | None = None):
    if first_name is not None:
        user.first_name = first_name.strip()[:100] or user.first_name
    if last_name is not None:
        user.last_name = last_name.strip()[:100] or user.last_name
    db.session.commit()
    return user


def change_password(user: User, current_password: str, new_password: str):
    if not verify_password(user.password_hash, current_password):
        return False, "Mot de passe actuel incorrect"
    if len(new_password) < 8:
        return False, "Nouveau mot de passe trop court (min 8)"
    user.password_hash = hash_password(new_password)
    db.session.commit()
    # Invalider toutes les sessions refresh après changement de mot de passe
    logout_all_sessions(user.id)
    return True, None


ALLOWED_AVATAR_EXT = {"jpg", "jpeg", "png", "webp", "gif"}
AVATAR_MIME = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
}


def upload_avatar(user: User, file_storage):
    from werkzeug.utils import secure_filename

    from app.services.documents.service import get_s3_client

    if not file_storage or not file_storage.filename:
        return None, "Fichier requis"

    filename = secure_filename(file_storage.filename)
    if "." not in filename:
        return None, "Extension invalide"
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_AVATAR_EXT:
        return None, "Formats autorisés : JPG, PNG, WEBP, GIF"

    data = file_storage.read()
    max_bytes = 2 * 1024 * 1024
    if len(data) > max_bytes:
        return None, "Image trop lourde (max 2 Mo)"

    storage_key = f"avatars/{user.id}/{uuid4().hex}.{ext}"
    client = get_s3_client()
    bucket = current_app.config["MINIO_BUCKET"]
    try:
        client.put_object(
            Bucket=bucket,
            Key=storage_key,
            Body=data,
            ContentType=AVATAR_MIME.get(ext, "application/octet-stream"),
        )
    except Exception as exc:
        current_app.logger.exception("Avatar upload failed")
        return None, f"Erreur stockage: {exc}"

    user.avatar_url = storage_key
    user.updated_at = datetime.now(timezone.utc)
    db.session.commit()
    return user, None


def get_avatar_bytes(user: User):
    from app.services.documents.service import get_s3_client

    if not user.avatar_url:
        return None, None
    key = user.avatar_url
    if key.startswith("http") or key.startswith("data:"):
        return None, None
    client = get_s3_client()
    bucket = current_app.config["MINIO_BUCKET"]
    try:
        obj = client.get_object(Bucket=bucket, Key=key)
        body = obj["Body"].read()
        content_type = obj.get("ContentType") or "application/octet-stream"
        return body, content_type
    except Exception:
        current_app.logger.exception("Avatar fetch failed")
        return None, None


def remove_avatar(user: User):
    from app.services.documents.service import get_s3_client

    key = user.avatar_url
    if key and not key.startswith("http") and not key.startswith("data:"):
        try:
            client = get_s3_client()
            client.delete_object(Bucket=current_app.config["MINIO_BUCKET"], Key=key)
        except Exception:
            current_app.logger.exception("Avatar delete failed")
    user.avatar_url = None
    user.updated_at = datetime.now(timezone.utc)
    db.session.commit()
    return user
