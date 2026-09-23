"""Organization quotas stored in Organization.settings['quotas']."""

from __future__ import annotations

from uuid import UUID

from app.extensions import db
from app.models import Assistant, Document, KnowledgeBase, Organization, OrganizationMember

DEFAULT_QUOTAS = {
    "max_members": 50,
    "max_documents": 500,
    "max_assistants": 20,
    "max_knowledge_bases": 20,
    "max_storage_bytes": 5 * 1024 * 1024 * 1024,  # 5 Go
}

QUOTA_LABELS = {
    "max_members": "membres",
    "max_documents": "documents",
    "max_assistants": "assistants",
    "max_knowledge_bases": "knowledge bases",
    "max_storage_bytes": "stockage",
}


def get_quotas(org: Organization | None) -> dict:
    raw = ((org.settings or {}) if org else {}).get("quotas") or {}
    out = dict(DEFAULT_QUOTAS)
    for key, default in DEFAULT_QUOTAS.items():
        if key in raw and raw[key] is not None:
            try:
                val = int(raw[key])
                if val >= 0:
                    out[key] = val
            except (TypeError, ValueError):
                pass
    return out


def set_quotas(org: Organization, quotas: dict) -> dict:
    merged = get_quotas(org)
    for key in DEFAULT_QUOTAS:
        if key in quotas and quotas[key] is not None:
            try:
                val = int(quotas[key])
                if val >= 0:
                    merged[key] = val
            except (TypeError, ValueError):
                continue
    settings = dict(org.settings or {})
    settings["quotas"] = merged
    org.settings = settings
    return merged


def get_usage(organization_id: UUID) -> dict:
    members = (
        db.session.query(OrganizationMember)
        .filter_by(organization_id=organization_id, status="active")
        .count()
    )
    documents = (
        db.session.query(Document)
        .filter(Document.organization_id == organization_id, Document.status != "deleted")
        .count()
    )
    assistants = db.session.query(Assistant).filter_by(organization_id=organization_id).count()
    knowledge_bases = (
        db.session.query(KnowledgeBase).filter_by(organization_id=organization_id).count()
    )
    storage = (
        db.session.query(db.func.coalesce(db.func.sum(Document.size_bytes), 0))
        .filter(Document.organization_id == organization_id, Document.status != "deleted")
        .scalar()
        or 0
    )
    return {
        "members": int(members),
        "documents": int(documents),
        "assistants": int(assistants),
        "knowledge_bases": int(knowledge_bases),
        "storage_bytes": int(storage),
    }


def usage_vs_quotas(org: Organization) -> dict:
    quotas = get_quotas(org)
    usage = get_usage(org.id)
    mapping = {
        "members": "max_members",
        "documents": "max_documents",
        "assistants": "max_assistants",
        "knowledge_bases": "max_knowledge_bases",
        "storage_bytes": "max_storage_bytes",
    }
    items = []
    for usage_key, quota_key in mapping.items():
        used = usage[usage_key]
        limit = quotas[quota_key]
        pct = round((used / limit) * 100, 1) if limit > 0 else 0
        items.append(
            {
                "key": usage_key,
                "quota_key": quota_key,
                "label": QUOTA_LABELS[quota_key],
                "used": used,
                "limit": limit,
                "percent": min(pct, 999),
                "over": used >= limit if limit > 0 else False,
                "warning": pct >= 80 if limit > 0 else False,
            }
        )
    return {"quotas": quotas, "usage": usage, "items": items}


def check_quota(org: Organization, resource: str, extra: int = 1) -> tuple[bool, str | None]:
    """
    resource: members | documents | assistants | knowledge_bases | storage_bytes
    extra: increment to apply (file size for storage_bytes)
    """
    data = usage_vs_quotas(org)
    item = next((i for i in data["items"] if i["key"] == resource), None)
    if not item:
        return True, None
    if item["limit"] <= 0:
        return False, f"Quota {item['label']} désactivé (limite 0)"
    if item["used"] + extra > item["limit"]:
        return (
            False,
            f"Quota {item['label']} atteint ({item['used']}/{item['limit']})",
        )
    return True, None


def orgs_near_quota(limit: int = 10) -> list[dict]:
    """Orgs at >= 80% of any quota — for SA alerts."""
    orgs = (
        db.session.query(Organization)
        .filter(Organization.status == "active")
        .order_by(Organization.created_at.desc())
        .limit(200)
        .all()
    )
    alerts = []
    for org in orgs:
        data = usage_vs_quotas(org)
        hot = [i for i in data["items"] if i["warning"] or i["over"]]
        if not hot:
            continue
        alerts.append(
            {
                "organization_id": str(org.id),
                "organization_name": org.name,
                "items": hot,
            }
        )
        if len(alerts) >= limit:
            break
    return alerts
