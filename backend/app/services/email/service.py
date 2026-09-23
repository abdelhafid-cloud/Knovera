"""Transactional email via SMTP. Falls back to logging when SMTP is not configured."""

from __future__ import annotations

import logging
import re
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from flask import current_app

logger = logging.getLogger(__name__)


def _smtp_configured() -> bool:
    return bool(current_app.config.get("SMTP_HOST") and current_app.config.get("MAIL_FROM"))


def send_email(to: str, subject: str, html_body: str, text_body: str | None = None) -> bool:
    """Send an email. Returns True if sent (or logged in dry-run). Never raises to callers."""
    to = (to or "").strip().lower()
    if not to:
        return False

    app_name = current_app.config.get("APP_NAME", "Knovera")
    mail_from = current_app.config.get("MAIL_FROM") or f"noreply@{app_name.lower().replace(' ', '')}.local"
    text_body = text_body or _html_to_text(html_body)

    if not _smtp_configured():
        logger.info("[email:dry-run] to=%s subject=%s\n%s", to, subject, text_body[:2000])
        try:
            print(f"\n=== EMAIL (dry-run) -> {to} ===\nSubject: {subject}\n{text_body}\n=== END EMAIL ===\n")
        except UnicodeEncodeError:
            print(f"\n=== EMAIL (dry-run) -> {to} ===\nSubject: {subject.encode('ascii','replace').decode()}\n")
        return True

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = mail_from
    msg["To"] = to
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    host = current_app.config["SMTP_HOST"]
    port = int(current_app.config.get("SMTP_PORT") or 587)
    user = current_app.config.get("SMTP_USER") or ""
    password = current_app.config.get("SMTP_PASSWORD") or ""
    use_tls = bool(current_app.config.get("SMTP_USE_TLS", True))

    try:
        with smtplib.SMTP(host, port, timeout=20) as smtp:
            if use_tls:
                smtp.starttls()
            if user:
                smtp.login(user, password)
            smtp.sendmail(mail_from, [to], msg.as_string())
        logger.info("Email sent to %s (%s)", to, subject)
        return True
    except Exception:
        logger.exception("Failed to send email to %s", to)
        return False


def _html_to_text(html: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
    text = re.sub(r"</p>", "\n\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def notify_super_admin_org_created(
    *,
    to_email: str,
    org_name: str,
    org_slug: str,
    admin_email: str | None,
    created_by_name: str,
) -> bool:
    app_name = current_app.config.get("APP_NAME", "Knovera")
    frontend = (current_app.config.get("FRONTEND_URL") or "http://localhost:3000").rstrip("/")
    subject = f"[{app_name}] Nouvelle organisation : {org_name}"
    html = f"""
    <div style="font-family:sans-serif;line-height:1.5;color:#111">
      <h2>Nouvelle organisation créée</h2>
      <p>Bonjour,</p>
      <p><strong>{created_by_name}</strong> vient de créer l’organisation suivante sur {app_name}.</p>
      <ul>
        <li><strong>Nom :</strong> {org_name}</li>
        <li><strong>Slug :</strong> {org_slug}</li>
        <li><strong>Admin invité :</strong> {admin_email or "—"}</li>
      </ul>
      <p><a href="{frontend}/super-admin/organizations">Voir les organisations</a></p>
    </div>
    """
    return send_email(to_email, subject, html)


def notify_org_admin_invited(
    *,
    to_email: str,
    org_name: str,
    invite_url: str | None = None,
    login_url: str | None = None,
    temporary_password: str | None = None,
) -> bool:
    app_name = current_app.config.get("APP_NAME", "Knovera")
    subject = f"[{app_name}] Invitation — {org_name}"
    if invite_url:
        action = f"""
        <p>Vous êtes invité(e) à rejoindre la plateforme <strong>{app_name}</strong>
        en tant qu’administrateur de <strong>{org_name}</strong>.</p>
        <p><a href="{invite_url}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px">
          Accepter l’invitation
        </a></p>
        <p style="font-size:12px;color:#666">Ou copiez ce lien :<br>{invite_url}</p>
        """
    else:
        action = f"""
        <p>Votre organisation <strong>{org_name}</strong> a été créée sur {app_name}.
        Vous pouvez vous connecter dès maintenant.</p>
        <p><a href="{login_url}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px">
          Se connecter
        </a></p>
        """
        if temporary_password:
            action += f"<p><strong>Mot de passe temporaire :</strong> {temporary_password}</p>"

    html = f"""
    <div style="font-family:sans-serif;line-height:1.5;color:#111">
      <h2>Bienvenue sur {app_name}</h2>
      <p>Bonjour,</p>
      {action}
      <p>À bientôt,<br>L’équipe {app_name}</p>
    </div>
    """
    return send_email(to_email, subject, html)
