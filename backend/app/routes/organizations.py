from flask import Blueprint, g, request

from app.extensions import db
from app.models import Conversation, Organization, OrganizationMember, User
from app.services.organizations import service as org_service
from app.services.auth import service as auth_service
from app.utils.audit import write_audit
from app.utils.security import (
    api_error,
    api_success,
    auth_required,
    parse_uuid,
    require_org_context,
)

bp = Blueprint("organizations", __name__, url_prefix="/api/organizations")


@bp.get("")
@auth_required
def list_organizations():
    if g.is_super_admin:
        include_workspace = request.args.get("include_workspace") == "1"
        orgs = (
            db.session.query(Organization)
            .filter(Organization.status != "deleted")
            .order_by(Organization.created_at.desc())
            .all()
        )
        result = []
        for o in orgs:
            if not include_workspace and (o.settings or {}).get("is_super_admin_workspace"):
                continue
            item = org_service.organization_to_dict(o, include_usage=True)
            item["members_count"] = item.get("usage", {}).get("members") or (
                db.session.query(OrganizationMember)
                .filter_by(organization_id=o.id, status="active")
                .count()
            )
            item["documents_count"] = item.get("usage", {}).get("documents") or 0
            item["assistants_count"] = item.get("usage", {}).get("assistants") or 0
            item["conversations_count"] = (
                db.session.query(Conversation).filter_by(organization_id=o.id).count()
            )
            result.append(item)
        return api_success(result)

    memberships = (
        db.session.query(OrganizationMember)
        .filter_by(user_id=g.current_user.id, status="active")
        .all()
    )
    return api_success(
        [org_service.organization_to_dict(m.organization) for m in memberships if m.organization]
    )


@bp.post("")
@auth_required
def create_organization():
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return api_error("Nom requis", 400)

    admin_email = (data.get("admin_email") or "").strip() or None
    admin_password = (data.get("admin_password") or "").strip() or None
    if admin_email and admin_password and len(admin_password) < 8:
        return api_error("Mot de passe admin trop court (min 8)", 400)

    quotas = data.get("quotas") if isinstance(data.get("quotas"), dict) else None

    org, meta = org_service.create_organization(
        name=name,
        admin_email=admin_email,
        admin_password=admin_password,
        admin_name=data.get("admin_name"),
        admin_first_name=(data.get("admin_first_name") or "").strip() or None,
        admin_last_name=(data.get("admin_last_name") or "").strip() or None,
        quotas=quotas,
        invited_by=g.current_user.id,
    )
    write_audit("organization.create", resource_type="organization", resource_id=org.id)

    # Emails: notify Super Admin + invite org admin
    from flask import current_app
    from app.services.email import notify_org_admin_invited, notify_super_admin_org_created

    frontend = (current_app.config.get("FRONTEND_URL") or "http://localhost:3000").rstrip("/")
    created_by = g.current_user.full_name or g.current_user.email

    notify_super_admin_org_created(
        to_email=g.current_user.email,
        org_name=org.name,
        org_slug=org.slug,
        admin_email=meta.get("admin_email"),
        created_by_name=created_by,
    )
    # Si le Super Admin a un email local (.local), renvoyer aussi vers MAIL_FROM / SMTP_USER
    sa_email = (g.current_user.email or "").lower()
    fallback = (current_app.config.get("MAIL_FROM") or current_app.config.get("SMTP_USER") or "").lower()
    if fallback and fallback != sa_email and sa_email.endswith(".local"):
        notify_super_admin_org_created(
            to_email=fallback,
            org_name=org.name,
            org_slug=org.slug,
            admin_email=meta.get("admin_email"),
            created_by_name=created_by,
        )

    if meta.get("invitation_token") and meta.get("admin_email"):
        invite_url = f"{frontend}/register?token={meta['invitation_token']}"
        notify_org_admin_invited(
            to_email=meta["admin_email"],
            org_name=org.name,
            invite_url=invite_url,
        )
    elif meta.get("admin_created") and meta.get("admin_email"):
        notify_org_admin_invited(
            to_email=meta["admin_email"],
            org_name=org.name,
            login_url=f"{frontend}/login",
            temporary_password=meta.get("temporary_password"),
        )

    payload = org_service.organization_to_dict(org, include_usage=True)
    payload["emails"] = {
        "super_admin_notified": g.current_user.email,
        "admin_invited": meta.get("admin_email"),
        "invitation_sent": bool(meta.get("invitation_token")),
        "account_created": bool(meta.get("admin_created")),
    }
    # Ne pas renvoyer invitation_token / invite_url / mot de passe dans l'API

    return api_success(payload, status=201)


@bp.get("/<org_id>")
@auth_required
def get_organization(org_id):
    try:
        oid = parse_uuid(org_id)
    except ValueError as e:
        return api_error(str(e), 400)
    org = db.session.get(Organization, oid)
    if not org or org.status == "deleted":
        return api_error("Organisation introuvable", 404)
    if not g.is_super_admin:
        membership = (
            db.session.query(OrganizationMember)
            .filter_by(user_id=g.current_user.id, organization_id=oid, status="active")
            .first()
        )
        if not membership:
            return api_error("Accès refusé", 403)
    return api_success(org_service.organization_to_dict(org, include_usage=True))


@bp.patch("/<org_id>")
@auth_required
def update_organization(org_id):
    try:
        oid = parse_uuid(org_id)
    except ValueError as e:
        return api_error(str(e), 400)
    org = db.session.get(Organization, oid)
    if not org or org.status == "deleted":
        return api_error("Organisation introuvable", 404)

    if not g.is_super_admin:
        membership = (
            db.session.query(OrganizationMember)
            .filter_by(user_id=g.current_user.id, organization_id=oid, status="active")
            .first()
        )
        if not membership or not membership.role or membership.role.code != "org_admin":
            return api_error("Permission insuffisante", 403)

    data = request.get_json(silent=True) or {}
    if "name" in data and data["name"]:
        org.name = data["name"].strip()
    # logo_url raw string only for external URLs; uploads use POST /logo
    if "logo_url" in data and data["logo_url"] is None:
        org_service.remove_organization_logo(org)
        return api_success(org_service.organization_to_dict(org, include_usage=True))
    if "logo_url" in data and isinstance(data["logo_url"], str) and data["logo_url"].startswith("http"):
        org.logo_url = data["logo_url"].strip() or None
    if "settings" in data and isinstance(data["settings"], dict):
        incoming = dict(data["settings"])
        if not g.is_super_admin:
            incoming.pop("quotas", None)
        org.settings = {**(org.settings or {}), **incoming}
    if g.is_super_admin and "quotas" in data and isinstance(data["quotas"], dict):
        from app.services.organizations import quotas as quota_service

        quota_service.set_quotas(org, data["quotas"])
    if g.is_super_admin and "status" in data and data["status"] in ("active", "invited", "suspended"):
        org.status = data["status"]
    db.session.commit()
    write_audit("organization.update", resource_type="organization", resource_id=org.id)
    return api_success(org_service.organization_to_dict(org, include_usage=True))


def _can_manage_org_logo(org) -> bool:
    if g.is_super_admin:
        return True
    membership = (
        db.session.query(OrganizationMember)
        .filter_by(user_id=g.current_user.id, organization_id=org.id, status="active")
        .first()
    )
    return bool(membership and membership.role and membership.role.code == "org_admin")


@bp.post("/<org_id>/logo")
@auth_required
def upload_organization_logo(org_id):
    try:
        oid = parse_uuid(org_id)
    except ValueError as e:
        return api_error(str(e), 400)
    org = db.session.get(Organization, oid)
    if not org or org.status == "deleted":
        return api_error("Organisation introuvable", 404)
    if not _can_manage_org_logo(org):
        return api_error("Permission insuffisante", 403)
    file = request.files.get("logo") or request.files.get("file") or request.files.get("avatar")
    updated, err = org_service.upload_organization_logo(org, file)
    if err:
        return api_error(err, 400)
    write_audit("organization.logo_update", resource_type="organization", resource_id=str(org.id))
    return api_success(org_service.organization_to_dict(updated, include_usage=True))


@bp.delete("/<org_id>/logo")
@auth_required
def delete_organization_logo(org_id):
    try:
        oid = parse_uuid(org_id)
    except ValueError as e:
        return api_error(str(e), 400)
    org = db.session.get(Organization, oid)
    if not org or org.status == "deleted":
        return api_error("Organisation introuvable", 404)
    if not _can_manage_org_logo(org):
        return api_error("Permission insuffisante", 403)
    org_service.remove_organization_logo(org)
    write_audit("organization.logo_delete", resource_type="organization", resource_id=str(org.id))
    return api_success(org_service.organization_to_dict(org, include_usage=True))


@bp.get("/<org_id>/logo")
def get_organization_logo(org_id):
    from io import BytesIO

    from flask import send_file

    try:
        oid = parse_uuid(org_id)
    except ValueError as e:
        return api_error(str(e), 400)
    org = db.session.get(Organization, oid)
    if not org or org.status == "deleted":
        return api_error("Organisation introuvable", 404)
    body, content_type = org_service.get_organization_logo_bytes(org)
    if not body:
        return api_error("Logo introuvable", 404)
    response = send_file(
        BytesIO(body),
        mimetype=content_type or "application/octet-stream",
        download_name=f"logo-{org_id}",
        max_age=0,
        conditional=True,
        etag=True,
    )
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@bp.get("/<org_id>/usage")
@auth_required
def organization_usage(org_id):
    try:
        oid = parse_uuid(org_id)
    except ValueError as e:
        return api_error(str(e), 400)
    org = db.session.get(Organization, oid)
    if not org or org.status == "deleted":
        return api_error("Organisation introuvable", 404)
    if not g.is_super_admin:
        membership = (
            db.session.query(OrganizationMember)
            .filter_by(user_id=g.current_user.id, organization_id=oid, status="active")
            .first()
        )
        if not membership:
            return api_error("Accès refusé", 403)
    from app.services.organizations import quotas as quota_service

    return api_success(quota_service.usage_vs_quotas(org))


@bp.post("/<org_id>/suspend")
@auth_required
def suspend_organization(org_id):
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    try:
        oid = parse_uuid(org_id)
    except ValueError as e:
        return api_error(str(e), 400)
    org = db.session.get(Organization, oid)
    if not org:
        return api_error("Organisation introuvable", 404)
    org.status = "suspended"
    db.session.commit()
    write_audit("organization.suspend", resource_type="organization", resource_id=org.id)
    return api_success(org_service.organization_to_dict(org))


@bp.post("/<org_id>/activate")
@auth_required
def activate_organization(org_id):
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    try:
        oid = parse_uuid(org_id)
    except ValueError as e:
        return api_error(str(e), 400)
    org = db.session.get(Organization, oid)
    if not org or org.status == "deleted":
        return api_error("Organisation introuvable", 404)
    org.status = "active"
    db.session.commit()
    write_audit("organization.activate", resource_type="organization", resource_id=org.id)
    return api_success(org_service.organization_to_dict(org))


@bp.delete("/<org_id>")
@auth_required
def delete_organization(org_id):
    if not g.is_super_admin:
        return api_error("Permission insuffisante", 403)
    try:
        oid = parse_uuid(org_id)
    except ValueError as e:
        return api_error(str(e), 400)
    org = db.session.get(Organization, oid)
    if not org:
        return api_error("Organisation introuvable", 404)
    org.status = "deleted"
    db.session.commit()
    write_audit("organization.delete", resource_type="organization", resource_id=org.id)
    return api_success({"ok": True})


@bp.get("/<org_id>/members")
@auth_required
def list_members(org_id):
    try:
        oid = parse_uuid(org_id)
    except ValueError as e:
        return api_error(str(e), 400)
    if not _can_manage_members(oid):
        return api_error("Permission insuffisante", 403)
    members = db.session.query(OrganizationMember).filter_by(organization_id=oid).all()
    result = []
    for m in members:
        item = auth_service.membership_to_dict(m)
        item["user"] = auth_service.user_to_dict(m.user) if m.user else None
        result.append(item)
    return api_success(result)


@bp.patch("/<org_id>/members/<member_id>")
@auth_required
def update_member(org_id, member_id):
    try:
        oid = parse_uuid(org_id)
        mid = parse_uuid(member_id, "member_id")
    except ValueError as e:
        return api_error(str(e), 400)
    if not _can_manage_members(oid):
        return api_error("Permission insuffisante", 403)
    member = db.session.get(OrganizationMember, mid)
    if not member or member.organization_id != oid:
        return api_error("Membre introuvable", 404)
    data = request.get_json(silent=True) or {}
    if "status" in data and data["status"] in ("active", "disabled"):
        member.status = data["status"]
    if "role_code" in data:
        roles = org_service.get_or_create_system_roles()
        role = roles.get(data["role_code"])
        if role:
            member.role_id = role.id
    db.session.commit()
    write_audit("member.update", resource_type="organization_member", resource_id=member.id)
    return api_success(auth_service.membership_to_dict(member))


@bp.delete("/<org_id>/members/<member_id>")
@auth_required
def delete_member(org_id, member_id):
    try:
        oid = parse_uuid(org_id)
        mid = parse_uuid(member_id, "member_id")
    except ValueError as e:
        return api_error(str(e), 400)
    if not _can_manage_members(oid):
        return api_error("Permission insuffisante", 403)
    member = db.session.get(OrganizationMember, mid)
    if not member or member.organization_id != oid:
        return api_error("Membre introuvable", 404)
    db.session.delete(member)
    db.session.commit()
    write_audit("member.delete", resource_type="organization_member", resource_id=mid)
    return api_success({"ok": True})


@bp.post("/<org_id>/members")
@auth_required
def add_member(org_id):
    """Org Admin / Super Admin: create or attach a user to the organization."""
    try:
        oid = parse_uuid(org_id)
    except ValueError as e:
        return api_error(str(e), 400)
    if not _can_manage_members(oid):
        return api_error("Permission insuffisante", 403)

    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""
    first_name = (data.get("first_name") or "").strip()
    last_name = (data.get("last_name") or "").strip()
    role_code = data.get("role_code") or "org_member"
    if role_code in ("admin", "org_admin"):
        role_code = "org_admin"
    else:
        role_code = "org_member"

    # Org admins cannot create super-admins; role is only org_admin or org_member
    user, err = org_service.create_organization_user(
        oid,
        email,
        password,
        first_name,
        last_name,
        role_code,
        assistant_ids=data.get("assistant_ids") or [],
    )
    if err:
        return api_error(err, 400)
    write_audit("member.create", resource_type="user", resource_id=str(user.id))
    item = auth_service.membership_to_dict(
        db.session.query(OrganizationMember)
        .filter_by(organization_id=oid, user_id=user.id, status="active")
        .first()
    )
    item["user"] = auth_service.user_to_dict(user)
    return api_success(item, status=201)


@bp.get("/<org_id>/invitations")
@auth_required
def list_invitations(org_id):
    try:
        oid = parse_uuid(org_id)
    except ValueError as e:
        return api_error(str(e), 400)
    if not _can_manage_members(oid):
        return api_error("Permission insuffisante", 403)
    from app.models import Invitation

    invitations = (
        db.session.query(Invitation)
        .filter_by(organization_id=oid)
        .order_by(Invitation.created_at.desc())
        .all()
    )
    return api_success(
        [
            {
                "id": str(i.id),
                "email": i.email,
                "role_id": str(i.role_id),
                "status": i.status,
                "expires_at": i.expires_at.isoformat() if i.expires_at else None,
                "created_at": i.created_at.isoformat() if i.created_at else None,
            }
            for i in invitations
        ]
    )


@bp.post("/<org_id>/invitations")
@auth_required
def create_invitation(org_id):
    try:
        oid = parse_uuid(org_id)
    except ValueError as e:
        return api_error(str(e), 400)
    if not _can_manage_members(oid):
        return api_error("Permission insuffisante", 403)
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    role_code = data.get("role_code") or "org_member"
    if not email:
        return api_error("Email requis", 400)
    from app.services.organizations import quotas as quota_service

    org = db.session.get(Organization, oid)
    if not org:
        return api_error("Organisation introuvable", 404)
    ok, err = quota_service.check_quota(org, "members", 1)
    if not ok:
        return api_error(err, 400)
    invitation, raw_token = org_service.create_invitation(oid, email, role_code, g.current_user.id)
    write_audit("invitation.create", resource_type="invitation", resource_id=invitation.id)

    from flask import current_app
    from app.services.email import notify_org_admin_invited

    frontend = (current_app.config.get("FRONTEND_URL") or "http://localhost:3000").rstrip("/")
    invite_url = f"{frontend}/register?token={raw_token}"
    notify_org_admin_invited(to_email=email, org_name=org.name, invite_url=invite_url)

    return api_success(
        {
            "id": str(invitation.id),
            "email": invitation.email,
            "status": invitation.status,
            "token": raw_token,
            "invite_url": invite_url,
            "expires_at": invitation.expires_at.isoformat(),
        },
        status=201,
    )


@bp.delete("/<org_id>/invitations/<invitation_id>")
@auth_required
def revoke_invitation(org_id, invitation_id):
    from app.models import Invitation

    try:
        oid = parse_uuid(org_id)
        iid = parse_uuid(invitation_id, "invitation_id")
    except ValueError as e:
        return api_error(str(e), 400)
    if not _can_manage_members(oid):
        return api_error("Permission insuffisante", 403)
    invitation = db.session.get(Invitation, iid)
    if not invitation or invitation.organization_id != oid:
        return api_error("Invitation introuvable", 404)
    invitation.status = "revoked"
    db.session.commit()
    return api_success({"ok": True})


def _can_manage_members(org_id):
    if g.is_super_admin:
        return True
    membership = (
        db.session.query(OrganizationMember)
        .filter_by(user_id=g.current_user.id, organization_id=org_id, status="active")
        .first()
    )
    return bool(membership and membership.role and membership.role.code == "org_admin")
