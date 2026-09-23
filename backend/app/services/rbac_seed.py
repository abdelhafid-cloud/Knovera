PERMISSION_SEED = [
    ("platform.dashboard.view", "Voir le dashboard plateforme"),
    ("platform.organizations.manage", "Gérer les organisations"),
    ("platform.users.manage", "Gérer les utilisateurs plateforme"),
    ("platform.settings.manage", "Paramètres globaux"),
    ("platform.audit.view", "Voir les audit logs"),
    ("platform.analytics.view", "Analytics plateforme"),
    ("platform.documents.view_content", "Voir contenu documents (explicite)"),
    ("org.dashboard.view", "Dashboard organisation"),
    ("org.settings.manage", "Paramètres organisation"),
    ("org.members.manage", "Gérer les membres"),
    ("org.invitations.manage", "Gérer les invitations"),
    ("documents.list", "Lister les documents"),
    ("documents.upload", "Uploader des documents"),
    ("documents.delete", "Supprimer des documents"),
    ("documents.view_content", "Voir le contenu des documents"),
    ("knowledge_bases.manage", "Gérer les knowledge bases"),
    ("assistants.manage", "Gérer les assistants"),
    ("assistants.use", "Utiliser les assistants"),
    ("chat.create", "Créer des conversations"),
    ("conversations.view_own", "Voir ses conversations"),
    ("conversations.view_org", "Voir les conversations de l'organisation"),
    ("profile.manage_own", "Gérer son profil"),
]

from app.utils.security import ORG_ADMIN_PERMISSIONS, ORG_MEMBER_PERMISSIONS, SUPER_ADMIN_PERMISSIONS

ROLE_PERMISSION_MAP = {
    "super_admin": SUPER_ADMIN_PERMISSIONS,
    "org_admin": ORG_ADMIN_PERMISSIONS,
    "org_member": ORG_MEMBER_PERMISSIONS,
}
