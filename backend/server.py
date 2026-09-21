from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, APIRouter
from starlette.middleware.cors import CORSMiddleware

from core.db import client, ensure_indexes
from core.security import PERMISSIONS as DEFAULT_ADMIN_PERMISSIONS
from core.seed import seed_all
from routers import admin_users, auth, products, orders, payments, events, chat, push, loyalty

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("mgs")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await ensure_indexes()
    await seed_all()
    await orders.backfill_subscription_locks()
    await migrate_users()
    logger.info("Magic Game Store API ready (payment mode=%s)", os.environ.get("PAYMENT_MODE"))
    yield
    client.close()


async def migrate_users():
    """Backward-compatible defaults for pre-existing accounts (no data destroyed)."""
    from core.db import db
    await db.users.update_many({"auth_provider": "google", "email_verified": {"$exists": False}}, {"$set": {"email_verified": True}})
    await db.users.update_many({"email_verified": {"$exists": False}}, {"$set": {"email_verified": False}})
    await db.users.update_many({"loyalty": {"$exists": False}}, {"$set": {"loyalty": {"earned": 0, "promo": 0}}})
    await db.users.update_many({"auth_version": {"$exists": False}}, {"$set": {"auth_version": 0}})
    await db.users.update_many({"blocked": {"$exists": False}}, {"$set": {"blocked": False}})
    # Roles: the seeded ADMIN_EMAIL account becomes super_admin, other staff keep "admin" with explicit permissions.
    await db.users.update_many({"role": "admin", "permissions": {"$exists": False}},
                               {"$set": {"permissions": list(DEFAULT_ADMIN_PERMISSIONS)}})


app = FastAPI(title="Magic Game Store API", lifespan=lifespan)
api = APIRouter(prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}


@api.get("/")
async def root():
    return {"name": "Magic Game Store API", "status": "ok"}


for r in (auth.router, products.router, orders.router, payments.router, events.router, chat.router, push.router,
          loyalty.router, admin_users.router):
    api.include_router(r)
app.include_router(api)

origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip() and o.strip() != "*"]
frontend = os.environ.get("FRONTEND_URL")
if frontend and frontend not in origins:
    origins.append(frontend)
# Accept the apex/www variant of each configured origin so credentialed requests are never wildcarded.
for origin in list(origins):
    variant = origin.replace("://www.", "://") if "://www." in origin else origin.replace("://", "://www.")
    if variant not in origins:
        origins.append(variant)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=origins or ["http://localhost:3000"],
                   allow_methods=["*"], allow_headers=["*"])
