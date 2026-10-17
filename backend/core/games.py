import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from core.db import db

DEFAULT_GAME_ID = "pubg-mobile"
FREE_FIRE_GAME_ID = "free-fire"
PUBG_GAME = {
    "id": DEFAULT_GAME_ID, "slug": DEFAULT_GAME_ID, "name": "PUBG Mobile", "active": True, "sort_order": 0,
    "icon_url": "https://customer-assets-0z36b82j.emergentagent.net/job_games-nav-polish/artifacts/ih6044zb_pubgm_app-icon_512x512%281%29.e9f7efc0.png",
    "description": "UC, Prime, Prime+ & Pack évolutif", "description_en": "UC, Prime, Prime+ & Evolving Pack",
}
# Phase 3 — second real game. `icon_url` is intentionally left empty: the logo is
# admin-configurable (Admin → Jeux) and the storefront falls back to the design-system
# placeholder until an administrator sets it. No commercial data is invented here.
# `active` stays False until Free Fire has a REAL, confirmed commercial configuration
# (admin sets the logo, a purchasable catalog exists and supplier mappings are linked):
# a game with no catalog must never be advertised to customers as ready to sell.
FREE_FIRE_GAME = {
    "id": FREE_FIRE_GAME_ID, "slug": FREE_FIRE_GAME_ID, "name": "Free Fire", "active": False, "sort_order": 1,
    "icon_url": None,
    "description": "Diamants Free Fire", "description_en": "Free Fire Diamonds",
    # Catégorie de validation FazerCards pour ce jeu (espace de validation, distinct des catégories commerciales).
    # À renseigner par l'admin (Admin → Jeux). Aucun jeu n'est présumé l'avoir par défaut.
    "fazercards_validation_category": None,
}


def _now():
    return datetime.now(timezone.utc).isoformat()


async def seed_games():
    """Idempotent: inserts the known games once, never overwrites admin edits."""
    for game in (PUBG_GAME, FREE_FIRE_GAME):
        await db.games.update_one({"id": game["id"]}, {"$setOnInsert": {**game, "created_at": _now()}}, upsert=True)


def legacy_snapshot(order: dict) -> dict:
    """Snapshot rebuilt only from data really present on a pre-multi-game order."""
    snap = {"legacy": True, "fields": {}}
    if order.get("pubg_id"):
        snap["fields"]["player_id"] = order["pubg_id"]
    if order.get("pseudo"):
        snap["player_name"] = order["pseudo"]
    return snap


def with_game_defaults(order: dict | None) -> dict | None:
    """Read-time compatibility for orders not yet touched by the startup migration."""
    if order:
        order.setdefault("game_id", DEFAULT_GAME_ID)
        order.setdefault("identity_snapshot", legacy_snapshot(order))
    return order


def _mapping_ok(mapping: dict | None) -> bool:
    """Mapping fournisseur utilisable (direct ou composé) : structure complète et confirmée.

    Copie locale volontaire de `services.fzr_mapping.mapping_ok` : `core` ne peut pas importer
    `services` (cycle d'import). La règle reste identique.
    """
    if not mapping or mapping.get("confirmed") is False:
        return False
    if mapping.get("mode", "direct") == "direct":
        return bool(mapping.get("category_id") and mapping.get("offer_id"))
    return bool(mapping.get("category_id") and mapping.get("components"))


async def game_has_sellable_catalog(game_id: str) -> bool:
    """Un jeu est VENDABLE s'il a au moins un produit ACTIF réellement livrable.

    L'existence d'un document produit ne suffit pas : un produit inactif, ou actif mais
    exigeant un mapping fournisseur absent/non confirmé, n'est pas vendable. C'est la
    condition d'activation publique d'un jeu — un jeu sans catalogue vendable ne doit
    jamais être annoncé au client.
    """
    async for p in db.products.find({"game_id": game_id, "active": True},
                                    {"_id": 0, "requires_mapping": 1, "fazercards_mapping": 1}):
        if not p.get("requires_mapping") or _mapping_ok(p.get("fazercards_mapping")):
            return True
    return False


# --------------------------------------------------------------------------- #
# Identité joueur GÉNÉRIQUE (multi-jeux).
# Chaque jeu DÉCLARE ses propres champs d'identité (clé, libellé, format, longueurs).
# Aucun jeu n'est présumé utiliser `player_id` : les règles PUBG Mobile ci-dessous ne
# sont qu'un cas particulier (jeu legacy) du modèle générique, jamais une hypothèse globale.
# --------------------------------------------------------------------------- #
IDENTITY_FIELD_KEY = re.compile(r"[a-z][a-z0-9_]{0,31}", re.ASCII)
PUBG_ID_RE = re.compile(r"[0-9]{9,13}", re.ASCII)


def full_match(pattern: str | None, value: str) -> bool:
    """Whole-string match (B1): no partial match, ASCII classes, same contract as the frontend."""
    if not pattern:
        return True
    try:
        return re.fullmatch(pattern, value, re.ASCII) is not None
    except re.error:
        return False
MAX_IDENTITY_FIELDS = 6

# Définition par défaut du seul jeu historique : PUBG Mobile conserve EXACTEMENT son contrat
# (un identifiant numérique de 9 à 13 chiffres), même si aucun admin ne l'a jamais enregistré.
DEFAULT_IDENTITY_FIELDS: dict[str, list[dict]] = {
    DEFAULT_GAME_ID: [
        {"key": "player_id", "label": "ID PUBG Mobile", "label_en": "PUBG Mobile ID",
         "pattern": r"^[0-9]{9,13}$", "min_length": 9, "max_length": 13,
         "required": True, "primary": True},
    ],
}

NO_CATALOG_DETAIL = ("Activation refusee : ce jeu n'a aucun produit actif et correctement configure "
                     "pour la livraison. Creez son catalogue, configurez les mappings fournisseur "
                     "(Admin -> Fournisseur) puis activez-le.")

NO_IDENTITY_DETAIL = (
    "Activation refusee : ce jeu n'a pas encore declare ses champs d'identite joueur. "
    "Definissez-les dans Admin -> Jeux (cle, libelle, format de saisie) : le parcours de "
    "checkout / commande multi-jeux en depend."
)


def normalize_identity_fields(raw) -> list[dict]:
    """Valide et normalise la définition admin des champs d'identité d'un jeu.

    Champs DYNAMIQUES : un jeu peut demander `zone_id`, `server`, `player_id`… Aucune clé
    n'est imposée. Toute définition invalide est rejetée explicitement (400), jamais devinée.
    """
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_IDENTITY_FIELDS:
        raise HTTPException(status_code=400,
                            detail=f"1 a {MAX_IDENTITY_FIELDS} champs d'identite maximum.")
    seen: set[str] = set()
    clean: list[dict] = []
    has_primary = False
    for item in raw:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Champ d'identite invalide.")
        key = str(item.get("key") or "").strip()
        label = str(item.get("label") or "").strip()
        if not IDENTITY_FIELD_KEY.fullmatch(key) or key in seen:
            raise HTTPException(status_code=400, detail=f"Cle de champ invalide ou dupliquee : « {key} ».")
        if not 1 <= len(label) <= 40:
            raise HTTPException(status_code=400, detail=f"Libelle requis pour le champ « {key} ».")
        pattern = str(item.get("pattern") or "").strip() or None
        if pattern:
            try:
                re.compile(pattern)
            except re.error:
                raise HTTPException(status_code=400, detail=f"Motif de validation invalide pour « {key} ».")
        try:
            min_length = int(item.get("min_length") or 1)
            max_length = int(item.get("max_length") or 32)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"Longueurs invalides pour « {key} ».")
        if not 1 <= min_length <= max_length <= 64:
            raise HTTPException(status_code=400, detail=f"Longueurs invalides pour « {key} » (1 a 64).")
        primary = bool(item.get("primary")) and not has_primary
        has_primary = has_primary or primary
        seen.add(key)
        clean.append({"key": key, "label": label,
                      "label_en": str(item.get("label_en") or "").strip() or None,
                      "pattern": pattern, "min_length": min_length, "max_length": max_length,
                      "required": item.get("required", True) is not False, "primary": primary})
    if clean and not has_primary:
        clean[0]["primary"] = True
    return clean


def identity_spec(game: dict | None) -> list[dict]:
    """Champs d'identité effectifs d'un jeu : déclaration admin, sinon défaut du jeu legacy."""
    declared = (game or {}).get("identity_fields")
    if declared:
        return declared
    return DEFAULT_IDENTITY_FIELDS.get((game or {}).get("id") or "", [])


def check_identity_payload(spec: list[dict], fields: dict | None) -> tuple[dict, str] | None:
    """Valide `fields` contre la spécification du jeu.

    Retourne (champs normalisés, valeur primaire) ou None si non conforme — le domaine ne
    complète JAMAIS une saisie manquante par une valeur inventée.
    """
    if not spec or not isinstance(fields, dict):
        return None
    allowed = {f["key"] for f in spec}
    if any(k not in allowed for k in fields):
        return None
    clean: dict[str, str] = {}
    for f in spec:
        raw = fields.get(f["key"])
        value = raw.strip() if isinstance(raw, str) else ""
        if not value:
            if f.get("required", True):
                return None
            continue
        if not f.get("min_length", 1) <= len(value) <= f.get("max_length", 64):
            return None
        if not full_match(f.get("pattern"), value):
            return None
        clean[f["key"]] = value
    if not clean:
        return None
    for f in spec:
        if f.get("primary") and clean.get(f["key"]):
            return clean, clean[f["key"]]
    return clean, next(iter(clean.values()))


async def game_sale_path_ready(game_id: str) -> tuple[bool, str]:
    """Un jeu n'est ouvrable à la vente que si son parcours complet est RÉELLEMENT configuré.

    Conditions vérifiées (aucune donnée commerciale inventée) : jeu existant, champs d'identité
    joueur déclarés, et catalogue vendable (produit actif livrable, mapping fournisseur confirmé).
    Retourne (False, motif explicite) sinon — l'appelant transforme le motif en erreur HTTP.
    """
    if game_id == DEFAULT_GAME_ID:
        return True, ""
    game = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not game:
        return False, "Jeu inconnu."
    readiness = await game_readiness(game)
    if not readiness["ready"]:
        return False, next(c["detail"] for c in readiness["checks"] if not c["ok"])
    return True, ""


async def reconcile_sellable_games():
    """Garantit l'invariant : un jeu PUBLIC a un catalogue VENDABLE. Idempotent, additif.

    Un jeu actif sans produit vendable est invisible pour le client mais apparaîtrait dans
    le sélecteur comme « prêt à vendre » puis ouvrirait une boutique vide. On le désactive —
    l'administrateur le réactive dans Admin → Jeux une fois son catalogue et ses mappings
    fournisseur en place. Ne touche jamais un jeu qui a un catalogue vendable.
    """
    active_ids = [g["id"] async for g in db.games.find({"active": True}, {"_id": 0, "id": 1})]
    for game_id in active_ids:
        if not await game_has_sellable_catalog(game_id):
            await db.games.update_one({"id": game_id}, {"$set": {"active": False, "updated_at": _now()}})


async def migrate_multigame():
    """Additive + idempotent: only documents lacking game_id are enriched ($set only, nothing removed)."""
    await db.products.update_many({"game_id": {"$exists": False}}, {"$set": {"game_id": DEFAULT_GAME_ID}})
    missing = {"$or": [{"game_id": {"$exists": False}}, {"identity_snapshot": {"$exists": False}}]}
    async for order in db.orders.find(missing, {"_id": 0, "id": 1, "pubg_id": 1, "pseudo": 1, "game_id": 1, "identity_snapshot": 1}):
        updates = {}
        if "game_id" not in order:
            updates["game_id"] = DEFAULT_GAME_ID
        if "identity_snapshot" not in order:
            updates["identity_snapshot"] = legacy_snapshot(order)
        await db.orders.update_one({"id": order["id"], **{k: {"$exists": False} for k in updates}}, {"$set": updates})


async def migrate_saved_pubg_ids():
    """Additive + idempotent: each legacy saved PUBG ID becomes one GameIdentity, exactly once.
    `pubg_ids_migrated` remembers handled IDs so a later deleted identity is never recreated."""
    query = {"saved_pubg_ids.0": {"$exists": True}}
    async for user in db.users.find(query, {"_id": 0, "user_id": 1, "saved_pubg_ids": 1, "pubg_ids_migrated": 1}):
        done = set(user.get("pubg_ids_migrated") or [])
        todo = [pid for pid in dict.fromkeys(user["saved_pubg_ids"]) if isinstance(pid, str) and pid and pid not in done]
        if not todo:
            continue
        existing = {d["fields"].get("player_id") async for d in db.game_identities.find(
            {"user_id": user["user_id"], "game_id": DEFAULT_GAME_ID}, {"_id": 0, "fields": 1})}
        docs = [{"id": str(uuid.uuid4()), "user_id": user["user_id"], "game_id": DEFAULT_GAME_ID, "label": f"PUBG {pid}",
                 "fields": {"player_id": pid}, "source": "saved_pubg_ids", "validated": False, "validated_at": None,
                 "created_at": _now(), "updated_at": _now()} for pid in todo if pid not in existing]
        if docs:
            await db.game_identities.insert_many(docs)
        await db.users.update_one({"user_id": user["user_id"]}, {"$addToSet": {"pubg_ids_migrated": {"$each": todo}}})


# --------------------------------------------------------------------------- #
# Per-game MGS product types (internal storefront taxonomy, distinct from provider categories).
# `prime`, `prime_plus` and `evo` carry PUBG-specific subscription / evolving-pack rules (locks keyed
# on the PUBG ID), so they stay reserved to PUBG Mobile; any other game declares its own keys.
# --------------------------------------------------------------------------- #
TYPE_KEY_RE = re.compile(r"[a-z][a-z0-9_]{0,31}", re.ASCII)
RESERVED_TYPE_KEYS = {"prime", "prime_plus", "evo"}
MAX_PRODUCT_TYPES = 12
DEFAULT_PRODUCT_TYPES: dict[str, list[dict]] = {
    DEFAULT_GAME_ID: [
        {"key": "uc", "label": "UC", "label_en": "UC"},
        {"key": "prime", "label": "Prime", "label_en": "Prime"},
        {"key": "prime_plus", "label": "Prime+", "label_en": "Prime+"},
        {"key": "evo", "label": "Pack évolutif", "label_en": "Evolving pack"},
    ],
}


def normalize_product_types(raw, game_id: str) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_PRODUCT_TYPES:
        raise HTTPException(status_code=400, detail=f"{MAX_PRODUCT_TYPES} types de produit maximum.")
    seen: set[str] = set()
    clean: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Type de produit invalide.")
        key = str(item.get("key") or "").strip()
        label = str(item.get("label") or "").strip()
        if not TYPE_KEY_RE.fullmatch(key) or key in seen:
            raise HTTPException(status_code=400, detail=f"Cle de type invalide ou dupliquee : « {key} ».")
        if key in RESERVED_TYPE_KEYS and game_id != DEFAULT_GAME_ID:
            raise HTTPException(status_code=400,
                                detail=f"Le type « {key} » porte des regles PUBG Mobile (abonnement / pack) : choisissez une autre cle.")
        if not 1 <= len(label) <= 30:
            raise HTTPException(status_code=400, detail=f"Libelle requis pour le type « {key} ».")
        seen.add(key)
        clean.append({"key": key, "label": label, "label_en": str(item.get("label_en") or "").strip() or None})
    return clean


def product_types_for(game: dict | None) -> list[dict]:
    declared = (game or {}).get("product_types")
    if declared:
        return declared
    return DEFAULT_PRODUCT_TYPES.get((game or {}).get("id") or "", [])


async def check_product_type(game_id: str, type_key: str) -> dict:
    """Backend source of truth for game/type compatibility (never trust the admin form alone)."""
    game = await db.games.find_one({"id": game_id}, {"_id": 0})
    if not game:
        raise HTTPException(status_code=400, detail="Unknown game")
    allowed = {t["key"] for t in product_types_for(game)}
    if type_key not in allowed:
        raise HTTPException(status_code=400, detail=(
            f"Type « {type_key} » non configure pour {game.get('name') or game_id}. "
            "Ajoutez-le dans Admin -> Jeux -> Types de produit."))
    return game


async def game_readiness(game: dict) -> dict:
    """Explicit, data-driven checklist: a game becomes sellable only when every check is true."""
    gid = game["id"]
    configured = game.get("fazercards_categories_configured") is True
    categories = set(game.get("fazercards_categories") or [])
    types = {t["key"] for t in product_types_for(game)}
    products = await db.products.find({"game_id": gid}, {"_id": 0, "name": 1, "type": 1, "active": 1,
                                                          "requires_mapping": 1, "fazercards_mapping": 1}).to_list(500)
    active = [p for p in products if p.get("active")]
    deliverable = [p for p in active if not p.get("requires_mapping") or _mapping_ok(p.get("fazercards_mapping"))]
    bad_types = sorted({p["name"] for p in products if p.get("type") not in types})
    foreign = sorted({p["name"] for p in products if (p.get("fazercards_mapping") or {}).get("category_id")
                      and configured and p["fazercards_mapping"]["category_id"] not in categories})
    legacy = gid == DEFAULT_GAME_ID
    checks = [
        {"key": "identity", "ok": bool(identity_spec(game)),
         "detail": "Champs d'identite joueur declares." if identity_spec(game) else NO_IDENTITY_DETAIL},
        {"key": "product_types", "ok": bool(types),
         "detail": "Types de produit configures." if types else "Aucun type de produit configure pour ce jeu."},
        {"key": "provider_categories", "ok": legacy or (configured and bool(categories)),
         "detail": "Categories fournisseur affectees." if legacy or (configured and categories)
         else "Aucune categorie FazerCards affectee (Admin -> Fournisseur)."},
        {"key": "catalog", "ok": bool(deliverable),
         "detail": f"{len(deliverable)} produit(s) actif(s) livrable(s)." if deliverable else NO_CATALOG_DETAIL},
        {"key": "type_compat", "ok": not bad_types,
         "detail": "Tous les produits utilisent un type du jeu." if not bad_types
         else "Type incompatible pour : " + ", ".join(bad_types[:5])},
        {"key": "mapping_scope", "ok": not foreign,
         "detail": "Mappings limites aux categories du jeu." if not foreign
         else "Mapping hors categories du jeu : " + ", ".join(foreign[:5])},
    ]
    return {"ready": all(c["ok"] for c in checks), "checks": checks}


async def public_game_ids() -> set[str]:
    """S1: games whose catalogue may be exposed publicly (active + identity contract + deliverable catalog)."""
    ids = set()
    async for g in db.games.find({"active": True}, {"_id": 0, "id": 1, "identity_fields": 1}):
        if identity_spec(g) and (g["id"] == DEFAULT_GAME_ID or await game_has_sellable_catalog(g["id"])):
            ids.add(g["id"])
    return ids
