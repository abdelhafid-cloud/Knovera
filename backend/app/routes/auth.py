from flask import Blueprint, g, request
from flask_jwt_extended import get_jwt

from app.extensions import limiter
from app.services.auth import service as auth_service
from app.services.organizations import service as org_service
from app.utils.audit import write_audit
from app.utils.security import api_error, api_success, auth_required

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


def _refresh_cookie_kwargs():
    from flask import current_app

    return {
        "httponly": True,
        "samesite": current_app.config.get("JWT_COOKIE_SAMESITE") or "Lax",
        "secure": bool(current_app.config.get("JWT_COOKIE_SECURE")),
        "max_age": int(current_app.config["JWT_REFRESH_TOKEN_EXPIRES"].total_seconds()),
        "path": "/api/auth",
    }


def _set_refresh_cookie(response, raw_refresh: str):
    response.set_cookie("refresh_token", raw_refresh, **_refresh_cookie_kwargs())


def _clear_refresh_cookie(response):
    response.set_cookie("refresh_token", "", expires=0, path="/api/auth")


def _public_auth_payload(result: dict) -> dict:
    """Ne jamais exposer le refresh token dans le JSON (cookie HttpOnly uniquement)."""
    return {
        "access_token": result.get("access_token"),
        "user": result.get("user"),
    }


@bp.post("/login")
@limiter.limit("10 per minute")
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""
    if not email or not password:
        return api_error("Email et mot de passe requis", 400)
    result, err = auth_service.login(email, password)
    if err:
        return api_error(err, 401, code="invalid_credentials")
    write_audit("auth.login", resource_type="user", resource_id=result["user"]["id"])
    response, status = api_success(_public_auth_payload(result))
    _set_refresh_cookie(response, result["refresh_token"])
    return response, status


@bp.post("/logout")
@auth_required
def logout():
    data = request.get_json(silent=True) or {}
    raw = data.get("refresh_token") or request.cookies.get("refresh_token")
    access_jwt = None
    try:
        access_jwt = get_jwt()
    except Exception:
        access_jwt = None
    auth_service.logout(raw, access_jwt=access_jwt)
    write_audit("auth.logout")
    response, status = api_success({"ok": True})
    _clear_refresh_cookie(response)
    return response, status


@bp.post("/logout-all")
@auth_required
def logout_all():
    access_jwt = None
    try:
        access_jwt = get_jwt()
    except Exception:
        access_jwt = None
    auth_service.logout_all_sessions(g.current_user.id, access_jwt=access_jwt)
    write_audit("auth.logout_all", resource_type="user", resource_id=str(g.current_user.id))
    response, status = api_success({"ok": True})
    _clear_refresh_cookie(response)
    return response, status


@bp.post("/refresh")
@limiter.limit("30 per minute")
def refresh():
    data = request.get_json(silent=True) or {}
    raw = data.get("refresh_token") or request.cookies.get("refresh_token")
    if not raw:
        return api_error("Refresh token manquant", 401)
    result, err = auth_service.refresh_session(raw)
    if err:
        response, status = api_error(err, 401, code="invalid_refresh")
        if err == "Refresh token révoqué":
            _clear_refresh_cookie(response)
        return response, status
    response, status = api_success({"access_token": result["access_token"]})
    _set_refresh_cookie(response, result["refresh_token"])
    return response, status


@bp.get("/me")
@auth_required
def me():
    from app.extensions import db
    from app.models import OrganizationMember

    memberships = [
        auth_service.membership_to_dict(m)
        for m in db.session.query(OrganizationMember)
        .filter_by(user_id=g.current_user.id, status="active")
        .all()
    ]
    return api_success(
        {
            "user": auth_service.user_to_dict(g.current_user, memberships),
            "current_organization": org_service.organization_to_dict(g.organization)
            if g.organization
            else None,
            "permissions": sorted(g.permissions),
            "is_super_admin": g.is_super_admin,
        }
    )


@bp.patch("/me")
@auth_required
def update_me():
    data = request.get_json(silent=True) or {}
    user = auth_service.update_profile(
        g.current_user,
        first_name=data.get("first_name"),
        last_name=data.get("last_name"),
    )
    write_audit("profile.update", resource_type="user", resource_id=str(user.id))
    return api_success(auth_service.user_to_dict(user))


@bp.post("/me/password")
@auth_required
@limiter.limit("5 per minute")
def change_password():
    data = request.get_json(silent=True) or {}
    ok, err = auth_service.change_password(
        g.current_user,
        data.get("current_password") or "",
        data.get("new_password") or "",
    )
    if not ok:
        return api_error(err, 400)
    write_audit("profile.password_change", resource_type="user", resource_id=str(g.current_user.id))
    return api_success({"message": "Mot de passe mis à jour"})


@bp.post("/me/avatar")
@auth_required
@limiter.limit("10 per minute")
def upload_avatar():
    file = request.files.get("avatar") or request.files.get("file")
    user, err = auth_service.upload_avatar(g.current_user, file)
    if err:
        return api_error(err, 400)
    write_audit("profile.avatar_update", resource_type="user", resource_id=str(user.id))
    return api_success(auth_service.user_to_dict(user))


@bp.delete("/me/avatar")
@auth_required
def delete_avatar():
    user = auth_service.remove_avatar(g.current_user)
    write_audit("profile.avatar_delete", resource_type="user", resource_id=str(user.id))
    return api_success(auth_service.user_to_dict(user))


@bp.get("/avatars/<user_id>")
def get_avatar(user_id):
    from io import BytesIO
    from uuid import UUID

    from flask import send_file

    from app.extensions import db
    from app.models import User

    try:
        uid = UUID(user_id)
    except ValueError:
        return api_error("Utilisateur invalide", 404)

    user = db.session.get(User, uid)
    if not user:
        return api_error("Utilisateur introuvable", 404)

    body, content_type = auth_service.get_avatar_bytes(user)
    if not body:
        return api_error("Avatar introuvable", 404)

    response = send_file(
        BytesIO(body),
        mimetype=content_type or "application/octet-stream",
        download_name=f"avatar-{user_id}",
        max_age=0,
        conditional=True,
        etag=True,
    )
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    return response


@bp.post("/forgot-password")
@limiter.limit("5 per minute")
def forgot_password():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip()
    if not email:
        return api_error("Email requis", 400)
    auth_service.request_password_reset(email)
    return api_success({"message": "Si le compte existe, un email a été envoyé."})


@bp.post("/reset-password")
@limiter.limit("5 per minute")
def reset_password():
    data = request.get_json(silent=True) or {}
    token = data.get("token") or ""
    password = data.get("password") or ""
    if len(password) < 8:
        return api_error("Mot de passe trop court (min 8)", 400)
    ok, err = auth_service.reset_password(token, password)
    if not ok:
        return api_error(err, 400)
    return api_success({"message": "Mot de passe mis à jour"})


@bp.get("/invitation")
@limiter.limit("30 per minute")
def preview_invitation():
    token = (request.args.get("token") or "").strip()
    if not token:
        return api_error("Token requis", 400)
    data, err = org_service.preview_invitation(token)
    if err:
        return api_error(err, 400)
    return api_success(data)


@bp.post("/accept-invitation")
@limiter.limit("10 per minute")
def accept_invitation():
    data = request.get_json(silent=True) or {}
    token = data.get("token") or ""
    password = data.get("password") or ""
    first_name = data.get("first_name") or ""
    last_name = data.get("last_name") or ""
    if not token or len(password) < 8:
        return api_error("Token et mot de passe (min 8) requis", 400)
    user, err = org_service.accept_invitation(token, password, first_name, last_name)
    if err:
        return api_error(err, 400)
    result, login_err = auth_service.login(user.email, password)
    if login_err:
        return api_success({"user": auth_service.user_to_dict(user)})
    response, status = api_success(_public_auth_payload(result))
    _set_refresh_cookie(response, result["refresh_token"])
    return response, status
