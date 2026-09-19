import os
from motor.motor_asyncio import AsyncIOMotorClient

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]


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
    # Uses the immutable item snapshot, not today's product catalogue. UC orders are excluded.
    await db.orders.create_index("pubg_id", unique=True, name="one_subscription_order_per_pubg",
                                 partialFilterExpression={"items.type": {"$in": ["prime", "prime_plus"]}})
    await db.chat_conversations.create_index("user_id", unique=True)
    await db.chat_conversations.create_index([("updated_at", -1), ("_id", -1)])
    await db.chat_messages.create_index([("conversation_id", 1), ("created_at", -1), ("_id", -1)])
    await db.chat_messages.create_index([("conversation_id", 1), ("sender_role", 1), ("read", 1)])
    await db.push_subscriptions.create_index("endpoint", unique=True)
    await db.push_subscriptions.create_index("user_id")
    await db.payments.create_index("order_id", unique=True)
    await db.payments.create_index("provider_ref")
    await db.events.create_index("id", unique=True)
    await db.reactions.create_index([("event_id", 1), ("session_id", 1), ("kind", 1)], unique=True)
