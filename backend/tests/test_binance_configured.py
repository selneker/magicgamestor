"""binance.configured() must be False for absent, empty or placeholder credentials."""
import pytest

from services import binance

REAL_LIKE_KEY = "vmPUZE6mv9SD5VNHk4HlWFsOr6aKE2zvsw0MuIgwCIPy6utIco14y7Ju91duEh8A"
REAL_LIKE_SECRET = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j"


@pytest.mark.parametrize("key,secret", [
    (None, None),
    ("", ""),
    ("   ", "   "),
    (REAL_LIKE_KEY, None),
    (None, REAL_LIKE_SECRET),
    (REAL_LIKE_KEY, ""),
    ("preview-dummy-not-a-real-key", "preview-dummy-not-a-real-secret"),
    ("your_api_key_here", "your_api_secret_here"),
    ("changeme", "changeme"),
    ("x" * 64, "x" * 64),
    ("ab" * 32, "cd" * 32),
    ("YourApiKey" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4Y5z6Q7", REAL_LIKE_SECRET),
    ("dummy" + "A" * 59, REAL_LIKE_SECRET),
    ("short123", "short456"),
])
def test_not_configured(monkeypatch, key, secret):
    for name, value in (("BINANCE_API_KEY", key), ("BINANCE_API_SECRET", secret)):
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)
    assert binance.configured() is False


def test_configured_with_real_format_keys(monkeypatch):
    monkeypatch.setenv("BINANCE_API_KEY", REAL_LIKE_KEY)
    monkeypatch.setenv("BINANCE_API_SECRET", f"  {REAL_LIKE_SECRET}  ")
    assert binance.configured() is True
