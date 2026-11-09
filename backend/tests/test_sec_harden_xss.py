"""PL-SEC-HARDEN-1 G — XSS stocké : longueurs et sorties HTML déjà sûres (sans échappement API)."""
import pytest


class TestStoredXssDefences:
    def test_free_text_lengths_are_already_capped(self):
        from pydantic import ValidationError
        from routers.chat import MessageIn
        from routers.orders import OrderIn
        with pytest.raises(ValidationError):
            OrderIn(pubg_id="5123456789", pseudo="x" * 41, items=[{"product_id": "p", "quantity": 1}],
                    payment_method="manual", manual_reference="REF")
        with pytest.raises(ValidationError):
            MessageIn(text="x" * 2001)

    def test_email_html_escapes_user_content(self):
        from services import mailer
        html = mailer.layout("<script>alert(1)</script>", "<p>x</p>")
        assert "<script>" not in html and "&lt;script&gt;" in html
        items = mailer._items_html({"items": [{"quantity": 1, "name": "<img src=x onerror=1>", "line_total": 1000}],
                                   "total": 1000})
        assert "<img" not in items and "&lt;img" in items
