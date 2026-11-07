import sys
from pathlib import Path

import pytest
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR / ".env")


@pytest.fixture(autouse=True)
def _no_telegram_network(monkeypatch):
    """`backend/.env` peut contenir un vrai jeton : aucun test ne doit joindre Telegram.

    Les tests du canal de secours (PL-NOTIF-5) reposent ces variables explicitement.
    """
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    monkeypatch.delenv("TELEGRAM_ALERT_EVENTS", raising=False)
    monkeypatch.delenv("TELEGRAM_TIMEOUT_S", raising=False)
