"""Post-payment side effects. Called exactly once per order by the atomic pending→paid winner."""
import logging

from core.audit import audit
from core.db import db
from services import loyalty, mailer

logger = logging.getLogger("mgs.fulfillment")


async def on_order_paid(order_id: str, client_ref: str, source: str):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        return
    await audit("order.paid", f"payment:{source}", order_id, {"client_ref": client_ref, "amount": order["total"]})
    try:
        if order.get("user_id"):
            await loyalty.award_for_order(order)
    except Exception as exc:  # loyalty must never block payment confirmation
        logger.warning("loyalty award failed for %s (%s)", order_id, type(exc).__name__)
    if order.get("email"):
        await mailer.send_payment_confirmed(order)


async def on_payment_failed(order_id: str, reason: str):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if order and order.get("email"):
        await mailer.send_payment_failed(order, reason)
