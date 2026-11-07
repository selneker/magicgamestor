"""Canal de secours Telegram des alertes admin (PL-NOTIF-5).

L'API Telegram transporte le jeton **dans l'URL** (`/bot<TOKEN>/sendMessage`). Une exception HTTP,
un journal de requête ou une trace peuvent donc le contenir : ce module ne journalise jamais l'URL,
ne remonte jamais le texte renvoyé par Telegram et ne rend que des **catégories** stables
(`telegram_not_configured`, `telegram_http_<code>`, `telegram_timeout`, `telegram_network_error`,
`telegram_rejected`). `httpx` écrit l'URL complète en INFO : ce logger est donc bridé à WARNING
ci-dessous, sinon le jeton apparaîtrait dans les logs applicatifs (niveau INFO dans `server.py`).

`send_message` ne lève jamais : l'issue d'une alerte push ne dépend jamais du canal de secours.
"""
import logging
import os

import httpx

logger = logging.getLogger("mgs.telegram")

API_BASE = "https://api.telegram.org"
MAX_TEXT = 400
DEFAULT_TIMEOUT_S = 5.0
MAX_TIMEOUT_S = 30.0
DEFAULT_EVENTS = frozenset({
    "order_created",
    "order_paid",
    "payment_failed",
    "late_success",
    "amount_mismatch",
    "delivery_blocked",
    "crypto_unmatched",
    "order_unprocessed",
    "test",
})

# httpx journalise « HTTP Request: POST https://api.telegram.org/bot<jeton>/… » au niveau INFO.
# On musèle ce logger (sans toucher à WARNING/ERROR) pour que le jeton ne puisse pas fuir par là.
_httpx_logger = logging.getLogger("httpx")
if _httpx_logger.level in (logging.NOTSET, logging.DEBUG, logging.INFO):
    _httpx_logger.setLevel(logging.WARNING)


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def configured() -> bool:
    """Les deux variables sont lues à l'appel : un redéploiement n'exige aucun redémarrage du code."""
    return bool(_env("TELEGRAM_BOT_TOKEN") and _env("TELEGRAM_CHAT_ID"))


def alert_events() -> frozenset[str]:
    """Événements envoyés sur Telegram (`TELEGRAM_ALERT_EVENTS`, liste séparée par des virgules)."""
    raw = _env("TELEGRAM_ALERT_EVENTS")
    if not raw:
        return DEFAULT_EVENTS
    return frozenset(part.strip().lower() for part in raw.split(",") if part.strip())


def enabled_for(event: str) -> bool:
    return configured() and event in alert_events()


def timeout_seconds() -> float:
    """Délai total court et borné : le cron et les tâches de fond ne doivent jamais attendre."""
    try:
        value = float(os.environ.get("TELEGRAM_TIMEOUT_S", str(DEFAULT_TIMEOUT_S)))
    except (TypeError, ValueError):
        value = DEFAULT_TIMEOUT_S
    return min(MAX_TIMEOUT_S, max(1.0, value))


def bounded(text: str) -> str:
    """Texte borné (une notification lisible, pas un rapport) — jamais interprété comme balisage."""
    text = text or ""
    return text if len(text) <= MAX_TEXT else text[:MAX_TEXT - 1] + "…"


def format_message(title: str | None, body: str | None) -> str:
    """Texte brut : aucun `parse_mode`, donc aucun balisage Telegram interprété."""
    return bounded("\n".join(part for part in (title or "", body or "") if part.strip()))


async def send_message(text: str) -> tuple[str, str | None]:
    """Envoie `text` à l'unique destinataire configuré. Retourne `(statut, catégorie)`, ne lève jamais."""
    token, chat_id = _env("TELEGRAM_BOT_TOKEN"), _env("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return "skipped", "telegram_not_configured"
    # Le jeton reste dans l'URL (imposé par l'API) : jamais journalisé, jamais rendu à l'appelant.
    url = f"{API_BASE}/bot{token}/sendMessage"
    payload = {"chat_id": chat_id, "text": bounded(text), "disable_web_page_preview": True}
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds()) as client:
            response = await client.post(url, json=payload)
    except httpx.TimeoutException:
        logger.warning("Envoi Telegram : délai dépassé")
        return "failed", "telegram_timeout"
    except httpx.HTTPError as exc:
        logger.warning("Envoi Telegram : erreur réseau (%s)", type(exc).__name__)
        return "failed", "telegram_network_error"
    except Exception as exc:  # jamais d'exception vers l'appelant
        logger.warning("Envoi Telegram : erreur (%s)", type(exc).__name__)
        return "failed", "telegram_error"
    if response.status_code != 200:
        # Code seul : le corps renvoyé par Telegram n'est jamais lu ni journalisé.
        logger.warning("Envoi Telegram refusé (HTTP %s)", response.status_code)
        return "failed", f"telegram_http_{response.status_code}"
    try:
        body = response.json()
    except ValueError:
        return "failed", "telegram_rejected"
    if not isinstance(body, dict) or body.get("ok") is not True:
        return "failed", "telegram_rejected"
    return "sent", None
