import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import (APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Request,
                     UploadFile)
from fastapi.responses import Response
from pymongo.errors import DuplicateKeyError
from pydantic import BaseModel, Field, field_validator

from core import ratelimit
from core.audit import audit
from core.db import db
from core.games import (DEFAULT_GAME_ID, check_identity_payload, game_sale_path_ready, identity_spec,
                        with_game_defaults)
from core.identity_keys import find_lock, identity_key, order_game_id, order_identity_key
from core.security import (ADMIN_ROLES, get_current_user, get_optional_user, require_admin,
                           require_permission, require_super_admin)
from routers.evo import EVO_TYPE, release_evo_locks, reserve_evo
from services import captcha, loyalty, mailer
from services import notifications
from services import order_maintenance
from services import payments as gw
from services import proofs as proof_store
from services.fulfillment import on_order_paid
from services.fzr_mapping import purchase_blocked, supplier_cost_usd
from services.notifications import notify_new_order

router = APIRouter(tags=["orders"])
PUBLIC = {"_id": 0}
# Suivi public : le numéro de commande et l'identifiant joueur suffisent au client ;
# l'email et le téléphone de paiement ne doivent jamais sortir par cette route publique.
TRACK_PUBLIC = {"_id": 0, "email": 0, "payment_phone": 0}
STATUSES = ["pending_payment", "awaiting_verification", "proof_submitted", "late_payment", "paid",
            "delivered", "cancelled", "failed", "expired"]
SUBSCRIPTION_TYPES = ("prime", "prime_plus")
SUBSCRIPTION_LABELS = {"prime": "Prime", "prime_plus": "Prime+"}
INACTIVE_STATUSES = ("cancelled", "failed", "expired")
TRANSITIONS = {
    "pending_payment": {"paid", "cancelled", "failed", "expired", "proof_submitted", "late_payment"},
    "awaiting_verification": {"paid", "delivered", "cancelled", "failed"},
    "proof_submitted": {"paid", "delivered", "cancelled", "failed"},
    "late_payment": {"paid", "cancelled"},
    "paid": {"delivered", "cancelled"},
    "failed": {"paid", "cancelled"},
    "expired": {"paid", "cancelled", "late_payment"},
    "delivered": set(),
    "cancelled": set(),
}


class OrderItemIn(BaseModel):
    product_id: str
    quantity: int = Field(ge=1, le=20)


class OrderIn(BaseModel):
    # `pubg_id` reste la colonne HISTORIQUE de compatibilité (PUBG Mobile + toutes les commandes
    # passées) : elle est toujours renseignée, y compris pour un jeu dynamique (valeur primaire).
    pubg_id: str
    # Contrat GÉNÉRIQUE : pour un jeu à champs dynamiques, la saisie complète arrive ici
    # (ex. {"zone_id": "…", "player_id": "…"}). `pubg_id` n'est JAMAIS supposé universel.
    identity_fields: dict[str, str] | None = None
    pseudo: str = Field(min_length=2, max_length=40)
    items: list[OrderItemIn] = Field(min_length=1, max_length=20)
    payment_method: str = Field(pattern=r"^(mvola|orange|manual|binance)$")
    payment_phone: str | None = None
    manual_reference: str | None = Field(default=None, max_length=60)
    email: str | None = None
    game_id: str = Field(default=DEFAULT_GAME_ID, min_length=1, max_length=60)
    identity_id: str | None = Field(default=None, max_length=60)
    captcha_token: str | None = Field(default=None, max_length=4096)

    @field_validator("pubg_id")
    @classmethod
    def valid_pubg(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("identifiant joueur requis")
        return v

    @field_validator("identity_fields")
    @classmethod
    def valid_identity_fields(cls, v):
        if v is None:
            return v
        if not 1 <= len(v) <= 10:
            raise ValueError("1 to 10 identity fields required")
        return {str(k): str(val or "").strip() for k, val in v.items()}

    @field_validator("payment_phone")
    @classmethod
    def valid_phone(cls, v):
        if v is None:
            return v
        digits = "".join(ch for ch in v if ch.isdigit())
        if len(digits) < 10:
            raise ValueError("Invalid phone number")
        return digits[-10:] if len(digits) > 10 else digits


class StatusIn(BaseModel):
    status: str = Field(pattern="^(" + "|".join(STATUSES) + ")$")
    admin_note: str | None = Field(default=None, max_length=300)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _order_number():
    return "MGS-" + secrets.token_hex(3).upper()


def initial_status(payment_method: str, manual_reference: str | None) -> str:
    """Statut initial d'une commande.

    Le paiement manuel SANS référence (nouvelle expérience, preuve par captures) attend un
    paiement ; la référence texte historique reste acceptée pour les clients/écrans existants et
    conserve le statut `awaiting_verification` d'avant le lot.
    """
    if payment_method == "manual" and manual_reference:
        return "awaiting_verification"
    return "pending_payment"


def public_order(order: dict | None, *, admin: bool = False) -> dict | None:
    """Commande exposée par l'API publique : jamais le nom de blob Azure ni le hash de l'image."""
    order = with_game_defaults(order)
    if order:
        # Contrat stable pour le frontend : les champs du lot existent toujours (null si absents).
        order.setdefault("payment_deadline_at", None)
        order.setdefault("payment_proofs", [])
    if order and not admin and order.get("payment_proofs"):
        order["payment_proofs"] = [
            {key: value for key, value in proof.items() if key not in ("blob_name", "sha256")}
            for proof in order["payment_proofs"]
        ]
    return order


async def _accessible_order(order_id: str, user: dict | None) -> dict:
    """Même règle d'accès que le reste : propriétaire connecté, ou invité porteur de l'UUID.

    L'UUID d'une commande invitée est un secret de fait : le porteur y accède sans compte, comme
    pour la lecture de la commande et de son statut (correctif IDOR conservé).
    """
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("user_id") and (
            not user or (user["user_id"] != order["user_id"] and user.get("role") not in ADMIN_ROLES)):
        raise HTTPException(status_code=403, detail="Forbidden")
    return order


def subscription_expiry(created_at: str, months: int) -> str:
    start = datetime.fromisoformat(created_at)
    month_index = start.month - 1 + int(months or 1)
    year, month = start.year + month_index // 12, month_index % 12 + 1
    day = min(start.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return start.replace(year=year, month=month, day=day).isoformat()


def _blocked_message(sub_type: str, expires_at: str) -> str:
    label = SUBSCRIPTION_LABELS[sub_type]
    until = datetime.fromisoformat(expires_at).strftime("%d/%m/%Y")
    return f"Un abonnement {label} est déjà actif ou en attente pour ce PUBG ID (jusqu’au {until}). Un seul {label} actif par PUBG ID."


async def release_subscription_locks(order_id: str):
    await db.subscription_locks.delete_many({"order_id": order_id})
    await release_evo_locks(order_id)  # evo locks follow the exact same order lifecycle


async def reserve_subscription(pubg_id: str, sub_type: str, order: dict, months: int):
    """Réservation atomique par (game_id, identity_key, type) via l'index unique dédié.

    `pubg_id` reste stocké (colonne historique) ; la CLÉ d'unicité est le couple
    `game_id` + `identity_key` : deux zones, ou deux jeux, ne se bloquent plus entre eux.
    """
    expires_at = subscription_expiry(order["created_at"], months)
    game_id, key = order_game_id(order), order_identity_key(order)
    for _ in range(3):
        try:
            await db.subscription_locks.insert_one({"game_id": game_id, "identity_key": key,
                                                    "pubg_id": pubg_id, "type": sub_type,
                                                    "order_id": order["id"],
                                                    "expires_at": expires_at, "created_at": _now()})
            return
        except DuplicateKeyError:
            existing = await find_lock(db.subscription_locks, game_id, key, pubg_id, {"type": sub_type})
            if not existing:
                continue
            holder = await db.orders.find_one({"id": existing["order_id"]}, {"status": 1})
            stale = not holder or holder["status"] in INACTIVE_STATUSES or existing["expires_at"] <= _now()
            if not stale:
                raise HTTPException(status_code=409, detail=_blocked_message(sub_type, existing["expires_at"]))
            await db.subscription_locks.delete_one({"_id": existing["_id"]})
    raise HTTPException(status_code=409, detail="Réessayez dans un instant.")


async def active_subscriptions(pubg_id: str) -> dict:
    result = {}
    # Route PUBG Mobile uniquement : un verrou d'un AUTRE jeu partageant le même numéro ne doit
    # pas apparaître comme un abonnement PUBG (documents antérieurs : `game_id` absent).
    query = {"pubg_id": pubg_id, "game_id": {"$in": [DEFAULT_GAME_ID, None]}}
    async for lock in db.subscription_locks.find(query):
        holder = await db.orders.find_one({"id": lock["order_id"]}, {"status": 1})
        if holder and holder["status"] not in INACTIVE_STATUSES and lock["expires_at"] > _now():
            result[lock["type"]] = {"expires_at": lock["expires_at"], "status": holder["status"], "order_id": lock["order_id"]}
    return result


async def backfill_subscription_locks():
    """One-off: register still-valid legacy subscription orders that predate the locks collection."""
    query = {"items.type": {"$in": list(SUBSCRIPTION_TYPES)}, "status": {"$nin": list(INACTIVE_STATUSES)}}
    async for order in db.orders.find(query, PUBLIC).sort("created_at", 1):
        for item in order["items"]:
            if item["type"] not in SUBSCRIPTION_TYPES:
                continue
            months = item.get("duration_months")
            if months is None:
                product = await db.products.find_one({"id": item["product_id"]}, {"duration_months": 1})
                months = (product or {}).get("duration_months") or 1
            expires_at = subscription_expiry(order["created_at"], months)
            if expires_at <= _now():
                continue
            try:
                await db.subscription_locks.insert_one({"game_id": order_game_id(order),
                                                        "identity_key": order_identity_key(order),
                                                        "pubg_id": order["pubg_id"], "type": item["type"],
                                                        "order_id": order["id"],
                                                        "expires_at": expires_at, "created_at": _now()})
            except DuplicateKeyError:
                pass


def _identity_error() -> HTTPException:
    # 422 = entité non traitable : identifiant joueur mal formé pour le jeu. PUBG Mobile conserve
    # EXACTEMENT le code de statut historique (422) ; les jeux dynamiques ont le même contrat.
    return HTTPException(status_code=422, detail="Identifiant joueur invalide pour ce jeu.")


async def _identity_snapshot(body: OrderIn, user: dict | None) -> dict:
    """Copie immuable de l'identité utilisée pour cet achat (jamais une référence à game_identities).

    Contrat GÉNÉRIQUE par jeu : les champs attendus sont ceux DÉCLARÉS par le jeu (« identity_fields »).
    PUBG Mobile (jeu legacy sans déclaration explicite) conserve son contrat historique : un
    `pubg_id` numérique de 9 à 13 chiffres — les commandes et produits Phase 1 restent identiques.
    """
    game = await db.games.find_one({"id": body.game_id}, {"_id": 0, "id": 1, "identity_fields": 1})
    spec = identity_spec(game)
    # La colonne legacy `pubg_id` est TOUJOURS renseignée : pour un jeu dynamique elle porte la
    # valeur du champ primaire, ce qui garde les index, la recherche et le suivi existants valides.
    supplied = dict(body.identity_fields or {})
    if spec:
        primary = next((f["key"] for f in spec if f.get("primary")), spec[0]["key"])
    else:
        primary = "player_id"
    if not supplied:
        supplied = {primary: body.pubg_id}
    elif not supplied.get(primary):
        supplied = {**supplied, primary: body.pubg_id}
    checked = check_identity_payload(spec, supplied)
    if not checked:
        raise _identity_error()
    clean_fields, primary_value = checked
    if not body.identity_id:
        return {"source": "checkout", "game_id": body.game_id, "fields": clean_fields,
                "player_name": body.pseudo.strip(), "validated": False, "captured_at": _now()}
    if not user:
        raise HTTPException(status_code=401, detail="Login required to use a saved game identity")
    ident = await db.game_identities.find_one({"id": body.identity_id, "user_id": user["user_id"]}, PUBLIC)
    if not ident or ident["game_id"] != body.game_id:
        raise HTTPException(status_code=400, detail="Game identity not found for this game")
    for key, value in (ident.get("fields") or {}).items():
        if clean_fields.get(key) != value:
            raise HTTPException(status_code=400, detail="Game identity does not match the player ID")
    return {"source": "identity", "identity_id": ident["id"], "game_id": ident["game_id"], "label": ident.get("label"),
            "fields": dict(ident["fields"]), "player_name": ident.get("player_name") or body.pseudo.strip(),
            "region": ident.get("region"), "validated": bool(ident.get("validated")),
            "validated_at": ident.get("validated_at"), "captured_at": _now()}


@router.post("/orders", status_code=201)
async def create_order(body: OrderIn, background_tasks: BackgroundTasks, request: Request, user=Depends(get_optional_user)):
    ip = ratelimit.client_ip(request)
    ratelimit.check(f"orders:ip:{ip}", ratelimit.setting("ORDERS_PER_HOUR_PER_IP", 30), 3600)
    if user:
        ratelimit.check(f"orders:user:{user['user_id']}", ratelimit.setting("ORDERS_PER_HOUR_PER_USER", 20), 3600)
    await captcha.require(body.captcha_token, ip)
    # ------------------------------------------------------------------ #
    # ENTITÉ D'ABORD, MOYEN DE PAIEMENT ENSUITE.
    # L'identité joueur et la vendabilité du jeu sont validées AVANT toute dépendance de paiement :
    # un identifiant mal formé renvoie donc toujours 422, indépendamment de la disponibilité du
    # fournisseur de paiement (et non un 409 trompeur venu du canal de règlement).
    # ------------------------------------------------------------------ #
    game = await db.games.find_one({"id": body.game_id, "active": True}, {"_id": 0, "id": 1})
    if not game:
        raise HTTPException(status_code=400, detail="Unknown or inactive game")
    ready, reason = await game_sale_path_ready(body.game_id)
    if not ready:
        # FAIL-CLOSED explicite : un jeu sans parcours de vente réellement fonctionnel (identité
        # par jeu + catalogue livrable) ne peut PAS déclencher de commande. Jamais de repli PUBG.
        if body.game_id != DEFAULT_GAME_ID:
            raise HTTPException(status_code=409, detail=reason)
    identity_snapshot = await _identity_snapshot(body, user)
    # Clé d'anti-doublon : identité EFFECTIVE de cette commande (voir core.identity_keys).
    identity_key_value = identity_key(identity_snapshot.get("fields"))
    from services import fiveone
    payment_provider = None
    if body.payment_method in ("mvola", "orange"):
        if not body.payment_phone:
            raise HTTPException(status_code=400, detail="Payment phone number is required")
        payment_provider = await fiveone.resolve_provider()
        if not payment_provider:
            raise HTTPException(status_code=409, detail=gw.PAPI_AUTO_OFF_MESSAGE)
    if body.payment_method == "binance":
        from services import crypto
        if not await crypto.available():
            raise HTTPException(status_code=409, detail="Paiement Binance USDT indisponible.")
        payment_provider = "binance"
    ids = [i.product_id for i in body.items]
    products = {p["id"]: p for p in await db.products.find({"id": {"$in": ids}, "active": True}, PUBLIC).to_list(100)}
    if len(products) != len(set(ids)):
        raise HTTPException(status_code=400, detail="One or more products are unavailable")
    if any(p.get("game_id", DEFAULT_GAME_ID) != body.game_id for p in products.values()):
        raise HTTPException(status_code=400, detail="Products do not belong to the selected game")
    for p in products.values():
        blocked = purchase_blocked(p)
        if blocked:
            raise HTTPException(status_code=409, detail=blocked)
    items, total = [], 0
    for line in body.items:
        p = products[line.product_id]
        items.append({"product_id": p["id"], "slug": p["slug"], "name": p["name"], "type": p["type"],
                      "duration_months": p.get("duration_months"),
                      "unit_price": p["price"], "quantity": line.quantity, "line_total": p["price"] * line.quantity})
        total += p["price"] * line.quantity
    subscriptions = [i for i in items if i["type"] in SUBSCRIPTION_TYPES]
    for sub_type in SUBSCRIPTION_TYPES:
        same = [i for i in subscriptions if i["type"] == sub_type]
        if len(same) > 1 or (same and same[0]["quantity"] > 1):
            raise HTTPException(status_code=400, detail=f"Un seul abonnement {SUBSCRIPTION_LABELS[sub_type]} par commande et par PUBG ID.")
    evo_items = [i for i in items if i["type"] == EVO_TYPE]
    if len(evo_items) != len({i["product_id"] for i in evo_items}) or any(i["quantity"] > 1 for i in evo_items):
        raise HTTPException(status_code=400, detail="Une seule offre Pack évolutif identique par commande et par PUBG ID.")
    from services import fees
    payment_fee = await fees.calculate_payment_fee(payment_provider, total)
    status = initial_status(body.payment_method, body.manual_reference)
    # Commande invitée : l'UUID `id` est un secret de fait (lecture publique de la commande et de
    # son statut de paiement). Ne jamais le journaliser ni l'exposer dans une page indexable.
    order = {
        "id": str(uuid.uuid4()), "order_number": _order_number(), "user_id": user["user_id"] if user else None,
        "email": (user or {}).get("email") or body.email, "pubg_id": body.pubg_id, "pseudo": body.pseudo.strip(),
        "game_id": body.game_id, "identity_snapshot": identity_snapshot, "identity_key": identity_key_value,
        "items": items, "subtotal": total, "payment_fee": payment_fee, "total": total + payment_fee, "currency": "Ar",
        "payment_method": body.payment_method, "payment_provider": payment_provider,
        "payment_phone": body.payment_phone, "manual_reference": body.manual_reference,
        "status": status,
        # PL-ORDER-PROOF-1 : seul un paiement encore attendu porte l'échéance de 30 minutes.
        "payment_deadline_at": order_maintenance.payment_deadline_iso() if status == "pending_payment" else None,
        "payment_proofs": [],
        "admin_note": None, "created_at": _now(), "updated_at": _now(),
        "history": [{"status": "created", "at": _now()}],
    }
    try:
        for item in subscriptions:
            await reserve_subscription(body.pubg_id, item["type"], order, item.get("duration_months") or 1)
        for item in evo_items:
            product = products[item["product_id"]]
            period_key, season = await reserve_evo(order, product)
            item.update({"evo_limit": product.get("evo_limit"), "period_key": period_key,
                         "season_id": (season or {}).get("id"), "season_name": (season or {}).get("name"),
                         "week_key": period_key.removeprefix("week:") if period_key.startswith("week:") else None})
        await db.orders.insert_one(order)
    except Exception:
        await release_subscription_locks(order["id"])
        raise
    background_tasks.add_task(notify_new_order, order)
    if order.get("email"):
        background_tasks.add_task(mailer.send_order_created, order)
    if user:
        # Historique de saisie rapide PUBG Mobile uniquement : pour un jeu à champs dynamiques, le
        # contrat vit dans `game_identities` — on n'entasse PAS d'identifiants bruts (et on ne
        # migre jamais un identifiant non-PUBG comme s'il s'agissait d'un ID PUBG Mobile).
        if body.game_id == DEFAULT_GAME_ID and body.pubg_id not in user.get("saved_pubg_ids", []):
            await db.users.update_one({"user_id": user["user_id"]}, {"$push": {"saved_pubg_ids": {"$each": [body.pubg_id], "$slice": -10}}})
        if identity_snapshot["source"] == "identity":  # already a GameIdentity: startup migration must skip it
            await db.users.update_one({"user_id": user["user_id"]}, {"$addToSet": {"pubg_ids_migrated": body.pubg_id}})
    order.pop("_id", None)
    return public_order(order)


@router.get("/orders/me")
async def my_orders(user=Depends(get_current_user)):
    return [public_order(o) for o in await db.orders.find({"user_id": user["user_id"]}, PUBLIC).sort("created_at", -1).to_list(200)]


@router.get("/orders/subscriptions")
async def subscription_status(request: Request, pubg_id: str = Query(min_length=9, max_length=13)):
    # Route publique d'information (le tunnel de commande l'utilise) : la limite par IP rend
    # l'énumération d'identifiants joueurs inexploitable sans imposer une connexion au client.
    ratelimit.check(f"order_subs:ip:{ratelimit.client_ip(request)}",
                    ratelimit.setting("ORDER_SUBS_PER_HOUR_PER_IP", 60), 3600)
    return {"pubg_id": pubg_id.strip(), "active": await active_subscriptions(pubg_id.strip())}


@router.get("/orders/track")
async def track_order(request: Request, order_number: str = Query(min_length=6), pubg_id: str = Query(min_length=9)):
    ratelimit.check(f"order_track:ip:{ratelimit.client_ip(request)}",
                    ratelimit.setting("ORDER_TRACK_PER_HOUR_PER_IP", 20), 3600)
    order = await db.orders.find_one({"order_number": order_number.upper().strip(), "pubg_id": pubg_id.strip()}, TRACK_PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["status"] == "pending_payment" and order["payment_method"] != "manual":
        from routers.payments import latest_attempt, expire_attempt
        from services.payments import is_expired
        attempt = await latest_attempt(order["id"])
        if attempt and attempt["status"] == "pending" and is_expired(attempt):
            await expire_attempt(attempt)
            order = await db.orders.find_one({"id": order["id"]}, TRACK_PUBLIC)
    return public_order(order)


@router.get("/orders/{order_id}")
async def get_order(order_id: str, user=Depends(get_optional_user)):
    order = await _accessible_order(order_id, user)
    return public_order(order)


# --------------------------------------------------------------------------- #
# PL-ORDER-PROOF-1 — preuve de paiement manuelle (1 à 3 captures) et relance admin.
# --------------------------------------------------------------------------- #
def _proof_error(detail: str, code: str, remaining_seconds: int | None = None,
                 reminders_left: int | None = None) -> HTTPException:
    body = {"code": code, "message": detail}
    if remaining_seconds is not None:
        body["remaining_seconds"] = int(remaining_seconds)
    if reminders_left is not None:
        body["reminders_left"] = int(reminders_left)
    return HTTPException(status_code=409 if code != "remind_cooldown" and code != "remind_limit" else 429,
                         detail=body)


@router.post("/orders/{order_id}/proof")
async def upload_order_proof(order_id: str, request: Request, background: BackgroundTasks,
                             files: list[UploadFile] = File(...),
                             user=Depends(get_optional_user)):
    """Reçoit 1 à 3 captures (JPEG/PNG réels), les compresse et les dépose dans Azure privé."""
    ip = ratelimit.client_ip(request)
    ratelimit.check(f"proof:ip:{ip}", ratelimit.setting("PROOF_UPLOAD_PER_HOUR_PER_IP", 20), 3600)
    order = await _accessible_order(order_id, user)
    if order.get("payment_method") != "manual":
        raise _proof_error("La preuve n'est disponible que pour un paiement manuel.", "proof_not_allowed")
    if order.get("status") != "pending_payment":
        raise _proof_error("Cette commande n'attend plus de preuve.", "proof_not_pending")
    if order.get("proof_validated_at"):
        raise _proof_error("Une preuve a déjà été validée pour cette commande.", "proof_already_validated")
    deadline = order.get("payment_deadline_at")
    if not deadline or deadline <= _now():
        raise _proof_error("Le délai de paiement est dépassé.", "proof_deadline_passed")
    if not proof_store.configured():
        # Désactivation propre : le site continue de fonctionner, seule cette fonction est indisponible.
        raise HTTPException(status_code=503, detail="Envoi de preuve indisponible.")
    if not 1 <= len(files) <= proof_store.MAX_FILES:
        raise _proof_error("Envoyez 1 à 3 captures d'écran.", "proof_count")
    existing = order.get("payment_proofs") or []
    if len(existing) + len(files) > proof_store.MAX_FILES:
        raise _proof_error("Trois preuves maximum par commande.", "proof_limit")
    ratelimit.check(f"proof:order:{order_id}", ratelimit.setting("PROOF_UPLOAD_PER_HOUR_PER_ORDER", 6), 3600)

    prepared, uploaded = [], []
    try:
        for upload in files:
            raw = await upload.read(proof_store.MAX_INPUT_BYTES + 1)
            if len(raw) > proof_store.MAX_INPUT_BYTES:
                raise _proof_error("Chaque capture doit faire 8 Mo maximum.", "proof_too_large")
            if proof_store.sniff(raw) is None:
                raise _proof_error("Format non pris en charge : JPEG ou PNG uniquement.", "proof_format")
            try:
                jpeg = proof_store.compress(raw)
            except proof_store.ProofError:
                raise _proof_error("Image illisible.", "proof_format")
            blob_name = await proof_store.upload(jpeg)
            uploaded.append(blob_name)
            prepared.append(proof_store.metadata(blob_name, jpeg))
    except HTTPException:
        for blob_name in uploaded:
            try:
                await proof_store.delete(blob_name)
            except Exception:
                pass
        raise
    except Exception:
        for blob_name in uploaded:
            try:
                await proof_store.delete(blob_name)
            except Exception:
                pass
        raise HTTPException(status_code=503, detail="Stockage des preuves indisponible.")

    submitted_at = _now()
    try:
        res = await db.orders.update_one(
            {"id": order_id, "status": "pending_payment",
             "payment_deadline_at": {"$gt": submitted_at},
             "proof_validated_at": {"$exists": False},
             # Garde atomique : le total des preuves déjà présentes + celles-ci ne dépasse jamais 3.
             "$expr": {"$lte": [{"$size": {"$ifNull": ["$payment_proofs", []]}},
                                proof_store.MAX_FILES - len(prepared)]}},
            {"$set": {"status": "proof_submitted", "proof_submitted_at": submitted_at,
                      "updated_at": submitted_at},
             "$unset": {"payment_deadline_at": ""},
             "$push": {"payment_proofs": {"$each": prepared},
                       "history": {"status": "proof_submitted", "at": submitted_at}}},
        )
    except Exception:
        for blob_name in uploaded:
            try:
                await proof_store.delete(blob_name)
            except Exception:
                pass
        raise
    if res.modified_count != 1:
        for blob_name in uploaded:
            try:
                await proof_store.delete(blob_name)
            except Exception:
                pass
        raise _proof_error("Trop de preuves ou commande déjà traitée.", "proof_conflict")

    await audit("order.proof_submitted", (user or {}).get("user_id") or f"ip:{ip}", order_id,
                {"count": len(prepared)})
    notifications.schedule(background, notifications.notify_proof_submitted,
                           order_id, order.get("order_number"), order.get("total"), len(prepared))
    updated = await db.orders.find_one({"id": order_id}, PUBLIC)
    return {"ok": True, "status": "proof_submitted", "payment_deadline_at": None,
            "proofs": public_order(updated).get("payment_proofs", []) if updated else []}


@router.post("/orders/{order_id}/remind")
async def remind_order_proof(order_id: str, request: Request, background: BackgroundTasks,
                             user=Depends(get_optional_user)):
    """Relance l'admin : 3 minutes d'attente entre deux relances, 3 relances maximum."""
    ip = ratelimit.client_ip(request)
    ratelimit.check(f"remind:ip:{ip}", ratelimit.setting("PROOF_REMIND_PER_HOUR_PER_IP", 30), 3600)
    order = await _accessible_order(order_id, user)
    if order.get("status") != "proof_submitted":
        raise _proof_error("Aucune preuve en attente pour cette commande.", "remind_not_pending")
    if order.get("proof_validated_at") or order.get("proof_reviewed_at"):
        raise _proof_error("La preuve a déjà été traitée.", "remind_already_processed")

    cooldown = ratelimit.setting("PROOF_REMIND_COOLDOWN_SECONDS", 180)
    maximum = max(1, ratelimit.setting("PROOF_REMIND_MAX", 3))
    count = int(order.get("proof_remind_count") or 0)
    if count >= maximum:
        raise _proof_error("Nombre maximal de relances atteint.", "remind_limit", 0, 0)
    last = order.get("proof_reminded_at")
    if last:
        try:
            elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(last)).total_seconds()
        except (TypeError, ValueError):
            elapsed = cooldown
        if elapsed < cooldown:
            raise _proof_error("Patientez avant une nouvelle relance.", "remind_cooldown",
                               int(cooldown - elapsed), maximum - count)

    moment = datetime.now(timezone.utc)
    cutoff = (moment - timedelta(seconds=cooldown)).isoformat()
    res = await db.orders.update_one(
        {"id": order_id, "status": "proof_submitted",
         "proof_validated_at": {"$exists": False},
         "$expr": {"$lt": [{"$ifNull": ["$proof_remind_count", 0]}, maximum]},
         "$or": [{"proof_reminded_at": {"$exists": False}},
                 {"proof_reminded_at": {"$lte": cutoff}}]},
        {"$inc": {"proof_remind_count": 1},
         "$set": {"proof_reminded_at": moment.isoformat(), "updated_at": moment.isoformat()}},
    )
    if res.modified_count != 1:
        raise _proof_error("Relance impossible pour le moment.", "remind_conflict",
                           cooldown, max(0, maximum - count))
    sent = count + 1
    left = maximum - sent
    await audit("order.proof_reminded", (user or {}).get("user_id") or f"ip:{ip}", order_id,
                {"count": sent})
    notifications.schedule(background, notifications.notify_proof_remind,
                           order_id, order.get("order_number"), sent, left)
    return {"ok": True, "reminders_left": left, "remaining_seconds": cooldown,
            "next_at": (moment + timedelta(seconds=cooldown)).isoformat()}


# ---------- Admin ----------
@router.get("/admin/orders", dependencies=[Depends(require_permission("orders.manage"))])
async def admin_orders(status: str | None = None, method: str | None = None,
                       q: str | None = Query(default=None, max_length=100), limit: int = 200):
    from routers.payments import expire_stale_attempts
    await expire_stale_attempts()
    query = {}
    if status and status != "all":
        query["status"] = status
    if method and method != "all":
        query["payment_method"] = method
    if q:
        needle = re.escape(q)  # même règle que /admin/users : jamais de motif regex fourni par l'appelant
        query["$or"] = [{"pubg_id": {"$regex": needle}}, {"pseudo": {"$regex": needle, "$options": "i"}},
                        {"order_number": {"$regex": needle.upper()}}, {"email": {"$regex": needle, "$options": "i"}}]
    return await db.orders.find(query, PUBLIC).sort("created_at", -1).to_list(min(limit, 1000))


@router.get("/admin/orders/{order_id}/proofs/{index}")
async def admin_order_proof(order_id: str, index: int,
                            admin=Depends(require_permission("orders.manage"))):
    """Relaye une preuve depuis Azure. Aucune URL publique, aucun SAS : uniquement ce flux admin."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0, "payment_proofs": 1})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    entries = order.get("payment_proofs") or []
    if index < 0 or index >= len(entries):
        raise HTTPException(status_code=404, detail="Proof not found")
    entry = entries[index] or {}
    if entry.get("purged_at") or not entry.get("blob_name"):
        raise HTTPException(status_code=410, detail="Preuve supprimée.")
    if not proof_store.configured():
        raise HTTPException(status_code=503, detail="Stockage des preuves indisponible.")
    try:
        payload = await proof_store.download(entry["blob_name"])
    except Exception:
        raise HTTPException(status_code=502, detail="Preuve temporairement indisponible.")
    return Response(content=payload, media_type=proof_store.CONTENT_TYPE,
                    headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                             "Content-Disposition": "inline"})


@router.get("/admin/audit", dependencies=[Depends(require_admin)])
async def admin_audit(target: str | None = None, action: str | None = None, limit: int = 100):
    query = {}
    if target:
        query["target"] = target
    if action:
        query["action"] = {"$regex": f"^{action}"}
    return await db.orders.database.audit_logs.find(query, PUBLIC).sort("created_at", -1).to_list(min(limit, 500))


@router.patch("/admin/orders/{order_id}")
async def admin_update_order(order_id: str, body: StatusIn, background_tasks: BackgroundTasks, admin=Depends(require_permission("orders.manage"))):
    current = await db.orders.find_one({"id": order_id}, {"status": 1, "user_id": 1})
    if not current:
        raise HTTPException(status_code=404, detail="Order not found")
    if body.status != current["status"] and body.status not in TRANSITIONS[current["status"]]:
        raise HTTPException(status_code=409, detail=f"Transition impossible : {current['status']} → {body.status}.")
    updates = {"status": body.status, "updated_at": _now()}
    if body.admin_note is not None:
        updates["admin_note"] = body.admin_note
    if body.status != current["status"] and current["status"] == "proof_submitted":
        # La revue admin clôt le délai de relance ; « payée/livrée » vaut validation de la preuve.
        updates["proof_reviewed_at"] = _now()
        if body.status in ("paid", "delivered"):
            updates["proof_validated_at"] = _now()
    push = {"history": {"status": body.status, "at": _now()}} if body.status != current["status"] else None
    res = await db.orders.update_one({"id": order_id, "status": current["status"]}, {"$set": updates, **({"$push": push} if push else {})})
    if res.matched_count == 0:
        raise HTTPException(status_code=409, detail="La commande a changé, rechargez la liste.")
    if body.status != current["status"]:
        await audit("order.status_change", admin["user_id"], order_id, {"from": current["status"], "to": body.status, "note": body.admin_note})
        if body.status == "paid":
            background_tasks.add_task(on_order_paid, order_id, "manual", f"admin:{admin['user_id']}")
        if body.status == "cancelled" and current["status"] in ("paid", "delivered") and current.get("user_id"):
            order = await db.orders.find_one({"id": order_id}, PUBLIC)
            await loyalty.reverse_for_order(order, f"admin:{admin['user_id']}")
    if body.status in INACTIVE_STATUSES:
        await release_subscription_locks(order_id)
    return await db.orders.find_one({"id": order_id}, PUBLIC)


@router.delete("/admin/orders/{order_id}")
async def admin_delete_order(order_id: str, admin=Depends(require_super_admin)):
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    delivered = order["status"] == "delivered"
    if not delivered and (order["status"] == "paid" or await db.payments.find_one({"order_id": order_id, "status": {"$in": ["completed", "late_success"]}})):
        raise HTTPException(status_code=409, detail="Une commande payée ne peut pas être supprimée (traçabilité). Annulez-la.")
    if delivered:
        # Traçabilité financière : archive append-only, les paiements/ledger loyalty restent intacts.
        await db.deleted_orders.insert_one({**order, "archived_at": _now(), "archived_by": admin["user_id"]})
    await db.orders.delete_one({"id": order_id})
    await db.payments.update_many({"order_id": order_id, "status": "pending"}, {"$set": {"status": "cancelled", "updated_at": _now()}})
    await release_subscription_locks(order_id)
    await audit("order.deleted", admin["user_id"], order_id, {
        "order_number": order["order_number"], "status": order["status"],
        "total": order.get("total"), "archived": delivered,
    })
    return {"ok": True}


@router.get("/admin/stats", dependencies=[Depends(require_admin)])
async def admin_stats():
    pipeline = [{"$group": {"_id": "$status", "count": {"$sum": 1}, "revenue": {"$sum": "$total"}}}]
    by_status = {row["_id"]: row for row in await db.orders.aggregate(pipeline).to_list(20)}
    revenue = sum(row["revenue"] for s, row in by_status.items() if s in ("paid", "delivered"))
    by_method = await db.orders.aggregate([{"$group": {"_id": "$payment_method", "count": {"$sum": 1}}}]).to_list(10)
    daily = await db.orders.aggregate([
        {"$match": {"status": {"$in": ["paid", "delivered"]}}},
        {"$group": {"_id": {"$substr": ["$created_at", 0, 10]}, "revenue": {"$sum": "$total"}, "count": {"$sum": 1}}},
        {"$sort": {"_id": -1}}, {"$limit": 14},
    ]).to_list(14)
    top = await db.orders.aggregate([
        {"$unwind": "$items"}, {"$group": {"_id": "$items.name", "qty": {"$sum": "$items.quantity"}}},
        {"$sort": {"qty": -1}}, {"$limit": 5},
    ]).to_list(5)
    # Commandes réellement en attente de paiement + total fournisseur à payer (USD, coût FazerCards existant).
    pending_orders = await db.orders.find({"status": {"$in": ["pending_payment", "awaiting_verification"]}}, PUBLIC).to_list(5000)
    prod_ids = list({it["product_id"] for o in pending_orders for it in o.get("items", [])})
    prods = {p["id"]: p for p in await db.products.find({"id": {"$in": prod_ids}}, PUBLIC).to_list(1000)}
    pending_usd = 0.0
    for o in pending_orders:
        for it in o.get("items", []):
            cost = supplier_cost_usd((prods.get(it["product_id"]) or {}).get("fazercards_mapping"))
            if cost:
                pending_usd += float(cost) * it.get("quantity", 1)
    return {
        "total_orders": sum(r["count"] for r in by_status.values()), "revenue": revenue,
        "status_count": {s: by_status.get(s, {}).get("count", 0) for s in STATUSES},
        "by_method": {r["_id"]: r["count"] for r in by_method}, "daily": list(reversed(daily)), "top_products": top,
        "customers": await db.users.count_documents({"role": "customer"}),
        "pending_payment_count": len(pending_orders), "pending_payment_usd": round(pending_usd, 2),
    }


def _csv_cell(value) -> str:
    """CSV quoting + neutralisation des formules (Excel/LibreOffice) contrôlées par le client."""
    text = str(value or "").replace('"', "'")
    if text.startswith(("=", "+", "-", "@", "\t", "\r")):
        text = "'" + text
    return '"' + text + '"'


@router.get("/admin/export", dependencies=[Depends(require_permission("orders.manage"))])
async def admin_export():
    orders = await db.orders.find({}, PUBLIC).sort("created_at", -1).to_list(5000)
    header = "order_number,date,status,pubg_id,pseudo,items,total,payment_method,payment_phone,manual_reference,email\n"
    rows = []
    for o in orders:
        items = " | ".join(f"{i['quantity']}x {i['name']}" for i in o["items"])
        rows.append(",".join(_csv_cell(v) for v in [
            o["order_number"], o["created_at"], o["status"], o["pubg_id"], o["pseudo"], items, o["total"],
            o["payment_method"], o.get("payment_phone"), o.get("manual_reference"), o.get("email")]))
    from fastapi.responses import Response
    return Response(content=header + "\n".join(rows), media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=orders-{datetime.now(timezone.utc).date()}.csv"})
