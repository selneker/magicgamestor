"""Affiche l'identifiant de la conversation Telegram la plus récente (PL-NOTIF-5).

Le jeton est lu **uniquement** dans `TELEGRAM_BOT_TOKEN` : jamais en argument, jamais affiché, jamais
dans un message d'erreur ou une trace. À exécuter depuis `backend/` :

    export TELEGRAM_BOT_TOKEN='...'   # dans le shell, pas dans l'historique partagé
    python scripts/telegram_get_chat_id.py

Prérequis : ouvrir le bot (@BotFather) dans Telegram, lui envoyer « /start » (ou n'importe quel
message), puis relancer le script. Aucun autre appel réseau n'est fait.
"""
import os
import sys

import requests

API_URL = "https://api.telegram.org"
TIMEOUT_S = 10


def _token() -> str:
    return (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()


def _fail(message: str, code: int = 1) -> int:
    print(message, file=sys.stderr)
    return code


def main() -> int:
    token = _token()
    if not token:
        return _fail("TELEGRAM_BOT_TOKEN est absent de l'environnement. Rien n'a été envoyé.")
    # Le jeton est dans l'URL (imposé par l'API) : l'URL et le corps ne sortent jamais de cette fonction.
    url = f"{API_URL}/bot{token}/getUpdates"
    try:
        response = requests.get(url, params={"limit": 100, "timeout": 0}, timeout=TIMEOUT_S)
    except requests.Timeout:
        return _fail("Délai dépassé en contactant Telegram. Réessayez.")
    except requests.RequestException as exc:
        # `str(exc)` contient l'URL, donc le jeton : seule la classe est affichée.
        return _fail(f"Réseau indisponible ({type(exc).__name__}). Réessayez.")
    if response.status_code != 200:
        return _fail(f"Telegram a refusé la requête (HTTP {response.status_code}). "
                     "Vérifiez le jeton, sans le copier ici.")
    try:
        payload = response.json()
    except ValueError:
        return _fail("Réponse illisible de Telegram.")
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        return _fail("Telegram a renvoyé une erreur. Vérifiez le jeton, sans le copier ici.")

    chats = []
    for update in payload.get("result") or []:
        message = update.get("message") or update.get("edited_message") or {}
        chat = message.get("chat") or {}
        if chat.get("id") is not None:
            chats.append(chat)
    if not chats:
        return _fail(
            "Aucun message trouvé.\n"
            "Ouvrez le bot dans Telegram, envoyez-lui « /start », puis relancez ce script.")

    latest = chats[-1]
    print(f"chat_id : {latest['id']}")
    print(f"type    : {latest.get('type', 'inconnu')}")
    if latest.get("type") != "private":
        print("Attention : ce n'est pas une conversation privée. Écrivez au bot en privé "
              "et relancez le script.")
    print("Copiez ce chat_id dans TELEGRAM_CHAT_ID (variable d'environnement, jamais dans le code).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
