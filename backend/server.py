from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, APIRouter
from starlette.middleware.cors import CORSMiddleware

from core.db import client, ensure_indexes
from core.seed import seed_all
from routers import auth, products, orders, payments, events, chat, push

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("mgs")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await ensure_indexes()
    await seed_all()
    await orders.backfill_subscription_locks()
    logger.info("Magic Game Store API ready (payment mode=%s)", os.environ.get("PAYMENT_MODE"))
    yield
    client.close()


app = FastAPI(title="Magic Game Store API", lifespan=lifespan)
api = APIRouter(prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}


@api.get("/")
async def root():
    return {"name": "Magic Game Store API", "status": "ok"}


for r in (auth.router, products.router, orders.router, payments.router, events.router, chat.router, push.router):
    api.include_router(r)
app.include_router(api)

origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip() and o.strip() != "*"]
frontend = os.environ.get("FRONTEND_URL")
if frontend and frontend not in origins:
    origins.append(frontend)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=origins or ["http://localhost:3000"],
                   allow_methods=["*"], allow_headers=["*"])
