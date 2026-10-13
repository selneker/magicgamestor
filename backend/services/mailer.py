"""Transactional email over the Mailjet Send API v3.1 (HTTPS — Render Free blocks SMTP ports).
Never logs recipients, token links or Mailjet credentials."""
import html
import logging
import os

import httpx

logger = logging.getLogger("mgs.mail")

BRAND = "Magic Game Store"
MAILJET_ENDPOINT = "https://api.mailjet.com/v3.1/send"
TIMEOUT = 15.0


def configured() -> bool:
    return bool(os.environ.get("MAILJET_API_KEY") and os.environ.get("MAILJET_SECRET_KEY")
                and os.environ.get("MAILJET_FROM_EMAIL"))


def frontend_url() -> str:
    return (os.environ.get("FRONTEND_URL") or "").rstrip("/")


def _wordmark() -> str:
    # Same wordmark as the site Header: "Magic" + neon block "Game" + "Store".
    return ('<a href="{url}" style="text-decoration:none;color:#0A0A0A;font-weight:700;font-size:20px;letter-spacing:-0.02em;">'
            'Magic<span style="background:#C5FE02;color:#0A0A0A;padding:0 4px;border-radius:4px;">Game</span>Store</a>').format(url=frontend_url())


def layout(title: str, body_html: str, cta: tuple[str, str] | None = None) -> str:
    button = ""
    if cta:
        button = (f'<p style="margin:28px 0;"><a href="{cta[1]}" style="display:inline-block;background:#C5FE02;color:#0A0A0A;'
                  f'padding:12px 22px;border-radius:10px;font-weight:600;text-decoration:none;border:1px solid rgba(10,10,10,.38);">{html.escape(cta[0])}</a></p>')
    return f"""<!doctype html><html><body style="margin:0;background:#F4F3EE;font-family:Archivo,Helvetica,Arial,sans-serif;color:#0A0A0A;">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;">
  <div style="margin-bottom:24px;">{_wordmark()}</div>
  <div style="background:#FFFFFF;border:1px solid rgba(10,10,10,.15);border-radius:14px;padding:28px;">
    <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;letter-spacing:-0.02em;">{html.escape(title)}</h1>
    <div style="font-size:15px;line-height:1.55;font-weight:400;">{body_html}</div>
    {button}
  </div>
  <p style="font-size:12px;color:#8A8A82;margin-top:20px;font-weight:400;">{BRAND} · PUBG Mobile · Madagascar<br>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
</div></body></html>"""


def _mask(email: str) -> str:
    name, _, domain = (email or "").partition("@")
    return f"{name[:1]}***@{domain}" if domain else "***"


def _payload(to: str, subject: str, html_body: str, text_body: str) -> dict:
    return {"Messages": [{
        "From": {"Email": os.environ["MAILJET_FROM_EMAIL"], "Name": os.environ.get("MAILJET_FROM_NAME") or BRAND},
        "To": [{"Email": to}],
        "Subject": subject,
        "TextPart": text_body,
        "HTMLPart": html_body,
    }]}


async def send(to: str, subject: str, title: str, body_html: str, text_body: str, cta: tuple[str, str] | None = None) -> bool:
    if not configured():
        logger.info("Mailjet not configured — email '%s' skipped", subject)
        return False
    payload = _payload(to, subject, layout(title, body_html, cta), text_body)
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            res = await client.post(MAILJET_ENDPOINT, json=payload,
                                    auth=(os.environ["MAILJET_API_KEY"], os.environ["MAILJET_SECRET_KEY"]))
    except Exception as exc:
        logger.warning("Email '%s' to %s failed (%s)", subject, _mask(to), type(exc).__name__)
        return False
    if 200 <= res.status_code < 300:
        try:
            status = (res.json().get("Messages") or [{}])[0].get("Status")
        except Exception:
            status = None
        if status and status != "success":
            logger.warning("Email '%s' to %s rejected by Mailjet (status=%s)", subject, _mask(to), status)
            return False
        logger.info("Email '%s' sent to %s (HTTP %s)", subject, _mask(to), res.status_code)
        return True
    logger.warning("Email '%s' to %s failed (Mailjet HTTP %s)", subject, _mask(to), res.status_code)
    return False


# ---------- Account ----------
async def send_verification(to: str, name: str, token: str):
    link = f"{frontend_url()}/verifier-email/{token}"
    body = f"<p>Bonjour {html.escape(name)},</p><p>Confirmez votre adresse email pour activer toutes les fonctionnalités de votre compte {BRAND}.</p><p>Ce lien expire dans 24 heures.</p>"
    return await send(to, f"{BRAND} — Confirmez votre email", "Confirmez votre email", body,
                      f"Bonjour {name},\nConfirmez votre email : {link}\nCe lien expire dans 24 heures.", ("Confirmer mon email", link))


async def send_password_reset(to: str, name: str, token: str):
    link = f"{frontend_url()}/reinitialiser/{token}"
    body = f"<p>Bonjour {html.escape(name)},</p><p>Vous avez demandé la réinitialisation de votre mot de passe. Ce lien expire dans 30 minutes et ne peut être utilisé qu'une fois.</p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>"
    return await send(to, f"{BRAND} — Réinitialisation du mot de passe", "Réinitialiser le mot de passe", body,
                      f"Bonjour {name},\nRéinitialisez votre mot de passe : {link}\nCe lien expire dans 30 minutes.", ("Choisir un nouveau mot de passe", link))


async def send_password_changed(to: str, name: str):
    body = f"<p>Bonjour {html.escape(name)},</p><p>Le mot de passe de votre compte {BRAND} vient d'être modifié. Si ce n'est pas vous, contactez immédiatement le support via le chat du site.</p>"
    return await send(to, f"{BRAND} — Mot de passe modifié", "Mot de passe modifié", body, "Votre mot de passe a été modifié.")


async def send_account_deleted(to: str, name: str):
    body = f"<p>Bonjour {html.escape(name)},</p><p>Votre compte {BRAND} a été supprimé et vos données personnelles anonymisées. L'historique des commandes est conservé de façon anonyme pour nos obligations comptables.</p>"
    return await send(to, f"{BRAND} — Compte supprimé", "Compte supprimé", body, "Votre compte a été supprimé.")


# ---------- Orders ----------
def _items_html(order: dict) -> str:
    rows = "".join(f"<li>{i['quantity']} × {html.escape(i['name'])} — {i['line_total']:,} Ar</li>".replace(",", " ") for i in order["items"])
    return f"<ul style='padding-left:18px;'>{rows}</ul><p><b>Total : {order['total']:,} Ar</b></p>".replace(",", " ")


def _track_link(order: dict) -> str:
    return f"{frontend_url()}/suivi/{order['order_number']}?pubg_id={order['pubg_id']}"


async def send_order_created(order: dict):
    body = f"<p>Votre commande <b>{order['order_number']}</b> pour le PUBG ID <b>{order['pubg_id']}</b> a été créée.</p>{_items_html(order)}"
    return await send(order["email"], f"{BRAND} — Commande {order['order_number']}", "Commande enregistrée", body,
                      f"Commande {order['order_number']} créée. Suivi : {_track_link(order)}", ("Suivre ma commande", _track_link(order)))


async def send_payment_confirmed(order: dict):
    body = f"<p>Paiement reçu pour la commande <b>{order['order_number']}</b>. Vos articles arrivent sur le compte PUBG <b>{order['pubg_id']}</b>.</p>{_items_html(order)}"
    return await send(order["email"], f"{BRAND} — Paiement confirmé {order['order_number']}", "Paiement confirmé", body,
                      f"Paiement confirmé pour {order['order_number']}. Suivi : {_track_link(order)}", ("Voir ma commande", _track_link(order)))


async def send_payment_failed(order: dict, reason: str):
    title = "Paiement expiré" if reason == "expired" else "Paiement échoué"
    body = f"<p>Le paiement de la commande <b>{order['order_number']}</b> n'a pas abouti ({'délai de 15 minutes dépassé' if reason == 'expired' else 'refusé ou annulé'}). Vous pouvez relancer le paiement depuis la page de suivi.</p>"
    return await send(order["email"], f"{BRAND} — {title} {order['order_number']}", title, body,
                      f"{title} pour {order['order_number']}. Relancer : {_track_link(order)}", ("Relancer le paiement", _track_link(order)))
