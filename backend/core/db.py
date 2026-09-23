import os
from motor.motor_asyncio import AsyncIOMotorClient

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]


async def _drop_if_exists(collection, name: str):
    if name in await collection.index_information():
        await collection.drop_index(name)


async def ensure_indexes():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.products.create_index("slug", unique=True)
    await db.orders.create_index("id", unique=True)
    await db.orders.create_index("order_number", unique=True)
    await db.orders.create_index([("user_id", 1), ("created_at", -1)])
    await db.orders.create_index("pubg_id")
    # Per-type rule (1 Prime + 1 Prime+ per PUBG ID) replaces the former single-subscription index.
    await _drop_if_exists(db.orders, "one_subscription_order_per_pubg")
    await db.subscription_locks.create_index([("pubg_id", 1), ("type", 1)], unique=True)
    await db.subscription_locks.create_index("order_id")
    # Pack évolutif: one order per (PUBG ID, offer, period) enforced atomically.
    await db.evo_locks.create_index([("pubg_id", 1), ("offer_slug", 1), ("period_key", 1)], unique=True)
    await db.evo_locks.create_index("order_id")
    await db.seasons.create_index("id", unique=True)
    await db.chat_conversations.create_index("user_id", unique=True)
    await db.chat_conversations.create_index([("updated_at", -1), ("_id", -1)])
    await db.chat_messages.create_index([("conversation_id", 1), ("created_at", -1), ("_id", -1)])
    await db.chat_messages.create_index([("conversation_id", 1), ("sender_role", 1), ("read", 1)])
    await db.push_subscriptions.create_index("endpoint", unique=True)
    await db.push_subscriptions.create_index("user_id")
    # Payments: one document per payment ATTEMPT (legacy docs = attempt 1, client_ref == order_number).
    await _drop_if_exists(db.payments, "order_id_1")
    await db.payments.create_index([("order_id", 1), ("created_at", -1)])
    await db.payments.create_index("client_ref", unique=True)
    await db.payments.create_index("provider_ref")
    await db.payments.create_index([("status", 1), ("expires_at", 1)])
    await db.payment_events.create_index("dedupe_key", unique=True)
    await db.payment_events.create_index([("client_ref", 1), ("created_at", -1)])
    await db.events.create_index("id", unique=True)
    await db.reactions.create_index([("event_id", 1), ("session_id", 1), ("kind", 1)], unique=True)
    # Auth tokens (email verification / password reset) stored hashed, single use.
    await db.auth_tokens.create_index("token_hash", unique=True)
    await db.auth_tokens.create_index([("user_id", 1), ("purpose", 1)])
    await db.auth_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.oauth_states.create_index("created_at", expireAfterSeconds=900)
    # Loyalty ledger + rewards + transfers.
    await db.loyalty_ledger.create_index([("user_id", 1), ("created_at", -1)])
    await db.loyalty_ledger.create_index("id", unique=True)
    await db.loyalty_ledger.create_index([("type", 1), ("order_id", 1)], unique=True,
                                         partialFilterExpression={"type": "earn", "order_id": {"$type": "string"}})
    await db.loyalty_rewards.create_index("id", unique=True)
    await db.loyalty_redemptions.create_index("id", unique=True)
    await db.loyalty_redemptions.create_index([("user_id", 1), ("created_at", -1)])
    await db.loyalty_transfers.create_index("id", unique=True)
    await db.loyalty_transfers.create_index([("from_user_id", 1), ("created_at", -1)])
    await db.loyalty_transfers.create_index([("to_user_id", 1), ("status", 1)])
    await db.audit_logs.create_index([("created_at", -1)])
    await db.audit_logs.create_index([("target", 1), ("created_at", -1)])
