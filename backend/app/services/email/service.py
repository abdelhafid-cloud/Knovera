"""Transactional email via Resend (HTTPS) or SMTP. Dry-run when neither is configured."""

from __future__ import annotations

import json
import logging
import re
import smtplib
import threading
import urllib.error
import urllib.request
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from flask import current_app

logger = logging.getLogger(__name__)


def _smtp_configured() -> bool:
    return bool(current_app.config.get("SMTP_HOST") and current_app.config.get("MAIL_FROM"))


def _resend_from(app_name: str) -> str:
    explicit = (current_app.config.get("RESEND_FROM") or "").strip()
    if explicit:
        return explicit
    return f"{app_name} <onboarding@resend.dev>"


def _send_via_resend(to: str, subject: str, html_body: str, text_body: str, mail_from: str) -> bool:
    payload = json.dumps(
        {
            "from": mail_from,
            "to": [to],
            "subject": subject,
            "html": html_body,
            "text": text_body,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": f"Bearer {current_app.config.get('RESEND_API_KEY')}",
            "Content-Type": "application/json",
            "User-Agent": "knovera",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            logger.info("Email sent via Resend to %s (%s) status=%s", to, subject, response.status)
            return True
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        logger.error("Resend a refusé l'email vers %s : %s %s", to, exc.code, detail)
        return False
    except Exception:
        logger.exception("Échec Resend vers %s", to)
        return False


def send_email(to: str, subject: str, html_body: str, text_body: str | None = None) -> bool:
    """Send an email. Returns True if sent (or logged in dry-run). Never raises to callers."""
    to = (to or "").strip().lower()
    if not to:
        return False
    if to.endswith(".local") or to.endswith(".test") or to.endswith(".invalid"):
        logger.info("Email ignoré (adresse non routable) to=%s subject=%s", to, subject)
        return False

    app_name = current_app.config.get("APP_NAME", "Knovera")
    text_body = text_body or _html_to_text(html_body)

    if current_app.config.get("RESEND_API_KEY"):
        return _send_via_resend(to, subject, html_body, text_body, _resend_from(app_name))

    mail_from = current_app.config.get("MAIL_FROM") or f"noreply@{app_name.lower().replace(' ', '')}.local"

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
        with smtplib.SMTP(host, port, timeout=8) as smtp:
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


def spawn_email(fn, *args, **kwargs) -> None:
    """Envoie hors de la requête HTTP. Un SMTP injoignable ne doit pas faire échouer l'API."""
    app = current_app._get_current_object()

    def _run() -> None:
        with app.app_context():
            try:
                fn(*args, **kwargs)
            except Exception:
                logger.exception("Tâche email interrompue")

    threading.Thread(target=_run, daemon=True, name="knovera-email").start()


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
