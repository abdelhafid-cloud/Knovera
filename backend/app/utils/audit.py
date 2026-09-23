from flask import g, request

from app.extensions import db
from app.models import AuditLog


def write_audit(action, resource_type=None, resource_id=None, metadata=None):
    log = AuditLog(
        actor_user_id=getattr(g, "current_user", None).id if getattr(g, "current_user", None) else None,
        organization_id=getattr(g, "organization", None).id if getattr(g, "organization", None) else None,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id else None,
        ip_address=request.headers.get("X-Forwarded-For", request.remote_addr),
        user_agent=request.headers.get("User-Agent"),
        meta=metadata or {},
    )
    db.session.add(log)
    db.session.commit()
