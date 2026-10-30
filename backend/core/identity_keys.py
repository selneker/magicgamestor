"""Clé d'identité joueur (`game_id` + `identity_key`) et migration des verrous anti-doublon.

Contexte (PL-003-BE-7)
----------------------
Les verrous anti-doublon sont des documents insérés AVANT la commande (`subscription_locks`,
`evo_locks`) ; l'unicité est obtenue par un index unique Mongo : la seconde insertion identique
lève `DuplicateKeyError`, ce qui refuse la seconde commande. Jusqu'ici la clé était `pubg_id`
seule — `(pubg_id, type)` et `(pubg_id, offer_slug, period_key)` — donc la ZONE était ignorée et
deux jeux pouvaient entrer en collision sur un même numéro.

La clé devient `game_id` + `identity_key` :

    identity_key = valeurs des champs d'identité DÉCLARÉS par le jeu, dans l'ordre déclaré, jointes
                   par « | »

Normalisation appliquée à la CLÉ seulement (jamais aux valeurs envoyées au fournisseur) :
NFKC, espaces de bord retirés, espaces internes réduits, minuscules, zéros initiaux supprimés
pour une valeur purement numérique. Exemples :

    PUBG Mobile   {"player_id": "52328390220"}                 -> "52328390220"  (== pubg_id)
    Mobile Legends{"player_id": "12345678", "zone_id": "2214"} -> "12345678|2214"

La migration de démarrage est ADDITIVE et REJOUABLE : elle ne fait qu'AJOUTER `game_id` /
`identity_key` aux documents existants, crée les nouveaux index uniques, puis supprime les anciens
index **en dernier** et seulement si tout est en place.
"""
import logging
import os
import unicodedata

from core.db import db
from core.games import DEFAULT_GAME_ID

logger = logging.getLogger("mgs.identity")

IDENTITY_KEY_SEPARATOR = "|"
IDENTITY_KEY_MIGRATION_ENV = "IDENTITY_KEY_MIGRATION"
IDENTITY_COLLECTIONS = ("orders", "subscription_locks", "evo_locks")

# Index uniques ACTIFS (après migration) — noms explicites : la procédure de retour arrière les cite.
SUBSCRIPTION_LOCK_KEYS = [("game_id", 1), ("identity_key", 1), ("type", 1)]
SUBSCRIPTION_LOCK_INDEX = "identity_game_subscription_unique"
EVO_LOCK_KEYS = [("game_id", 1), ("identity_key", 1), ("offer_slug", 1), ("period_key", 1)]
EVO_LOCK_INDEX = "identity_game_evo_unique"

# Index HISTORIQUES (avant migration), supprimés en dernier par la migration.
LEGACY_SUBSCRIPTION_LOCK_KEYS = [("pubg_id", 1), ("type", 1)]
LEGACY_EVO_LOCK_KEYS = [("pubg_id", 1), ("offer_slug", 1), ("period_key", 1)]


# --------------------------------------------------------------------------- #
# Clé d'identité
# --------------------------------------------------------------------------- #
def normalize_identity_value(value: object) -> str:
    """Normalise UNE valeur pour la clé de déduplication (jamais la valeur transmise au fournisseur).

    NFKC (formes Unicode équivalentes), espaces de bord retirés, espaces internes réduits à un
    seul, minuscules, et zéros initiaux supprimés pour une valeur purement numérique
    (« 0002214 » et « 2214 » désignent la même zone).
    """
    text = unicodedata.normalize("NFKC", str(value if value is not None else ""))
    text = " ".join(text.split()).lower()
    if text.isdigit():
        text = text.lstrip("0") or "0"
    return text


def identity_key(fields: dict | None) -> str:
    """Clé d'identité d'un joueur à partir de ses champs d'identité EFFECTIFS.

    L'ordre de `fields` est l'ordre déclaré du jeu : `core.games.check_identity_payload` construit
    le dictionnaire en itérant la spécification du jeu (`identity_fields`), et Mongo conserve
    l'ordre des champs. Les valeurs vides sont ignorées ; aucune valeur inventée n'est ajoutée.

    Returns:
        Les valeurs normalisées jointes par « | » (chaîne vide si aucun champ renseigné).
    """
    values = [normalize_identity_value(v) for v in (fields or {}).values() if str(v or "").strip()]
    return IDENTITY_KEY_SEPARATOR.join(values)


def order_game_id(order: dict | None) -> str:
    """`game_id` d'une commande, avec le repli historique PUBG Mobile (commandes antérieures)."""
    return str((order or {}).get("game_id") or DEFAULT_GAME_ID)


def order_identity_key(order: dict | None) -> str:
    """`identity_key` d'une commande : champ stocké, sinon recalcul depuis son instantané d'identité."""
    order = order or {}
    stored = str(order.get("identity_key") or "").strip()
    if stored:
        return stored
    fields = (order.get("identity_snapshot") or {}).get("fields") or {}
    if not fields and order.get("pubg_id"):
        fields = {"player_id": order["pubg_id"]}
    return identity_key(fields)


async def find_lock(collection, game_id: str, key: str, pubg_id: str | None,
                    extra: dict) -> dict | None:
    """Verrou qui a bloqué une insertion : clé complète, ou verrou HISTORIQUE (pré-migration).

    Le repli sur `pubg_id` ne sert qu'à la fenêtre où les anciens index existent encore sans que le
    backfill ait eu lieu (migration désactivée ou échouée) : le verrou reste alors honoré au lieu de
    renvoyer une erreur générique.
    """
    lock = await collection.find_one({"game_id": game_id, "identity_key": key, **extra})
    if lock is None and pubg_id:
        lock = await collection.find_one({"pubg_id": pubg_id, "identity_key": {"$exists": False}, **extra})
    return lock


# --------------------------------------------------------------------------- #
# Index
# --------------------------------------------------------------------------- #
async def _index_name(collection, keys: list[tuple[str, int]]) -> str | None:
    """Nom de l'index dont les clés sont EXACTEMENT `keys`, sinon None."""
    for name, info in (await collection.index_information()).items():
        if list(info.get("key") or []) == [tuple(k) for k in keys]:
            return name
    return None


async def _safe_drop(collection, name: str) -> bool:
    try:
        await collection.drop_index(name)
        return True
    except Exception as exc:  # index déjà supprimé / disparu : rien à faire
        logger.warning("identity_key : suppression de l'index %s impossible (%s)", name,
                       _safe_error(exc))
        return False


def _safe_error(exc: BaseException) -> str:
    """Type + code d'erreur SEULEMENT : le message Mongo d'une clé dupliquée contient l'identité."""
    code = getattr(exc, "code", None)
    return f"{type(exc).__name__}" + (f"#{code}" if code is not None else "")


async def ensure_lock_indexes() -> None:
    """Garantit qu'un index unique protège les verrous, sans jamais contredire l'autre schéma.

    Appelée à chaque démarrage par `core.db.ensure_indexes()` :
    - le NOUVEL index existe déjà (migration faite) -> on ne recrée pas l'ancien, sinon il
      ré-imposerait l'unicité sur `pubg_id` seul (collision entre deux jeux) ;
    - sinon on (re)crée l'index HISTORIQUE, pour ne jamais démarrer sans protection anti-doublon.
    """
    for collection, new_keys, legacy_keys in (
        (db.subscription_locks, SUBSCRIPTION_LOCK_KEYS, LEGACY_SUBSCRIPTION_LOCK_KEYS),
        (db.evo_locks, EVO_LOCK_KEYS, LEGACY_EVO_LOCK_KEYS),
    ):
        if await _index_name(collection, new_keys):
            continue
        try:
            await collection.create_index([tuple(k) for k in legacy_keys], unique=True)
        except Exception as exc:  # doublons historiques : on signale, l'application démarre
            logger.warning("identity_key : index historique non créé (%s)", _safe_error(exc))


# --------------------------------------------------------------------------- #
# Migration de démarrage (additive, rejouable)
# --------------------------------------------------------------------------- #
def migration_enabled() -> bool:
    """`IDENTITY_KEY_MIGRATION` : activée par défaut ; `off` (ou 0/false/no) la désactive."""
    raw = str(os.environ.get(IDENTITY_KEY_MIGRATION_ENV, "on")).strip().lower()
    return raw not in ("off", "0", "false", "no", "disabled")


def _needs_backfill() -> dict:
    # En Mongo, `{"champ": None}` correspond aussi à un champ ABSENT ; `""` est traité comme absent.
    return {"$or": [{"identity_key": None}, {"identity_key": ""},
                    {"game_id": None}, {"game_id": ""}]}


def _backfill_values(name: str, doc: dict) -> dict:
    """Champs À AJOUTER à un document ancien (aucune donnée existante n'est réécrite)."""
    values: dict[str, str] = {}
    if not doc.get("game_id"):
        values["game_id"] = DEFAULT_GAME_ID
    if not doc.get("identity_key"):
        if name == "orders":
            fields = (doc.get("identity_snapshot") or {}).get("fields") or {}
            if not fields and doc.get("pubg_id"):
                fields = {"player_id": doc["pubg_id"]}
            values["identity_key"] = identity_key(fields)
        else:  # verrous : la seule identité stockée est la colonne historique
            values["identity_key"] = identity_key({"player_id": doc.get("pubg_id")})
    return values


async def _backfill(collection, name: str) -> int:
    backfilled = 0
    projection = {"_id": 1, "game_id": 1, "identity_key": 1, "pubg_id": 1, "identity_snapshot": 1}
    async for doc in collection.find(_needs_backfill(), projection):
        values = _backfill_values(name, doc)
        if not values:
            continue
        await collection.update_one({"_id": doc["_id"]}, {"$set": values})
        backfilled += 1
    return backfilled


async def _missing_keys(collection, name: str) -> int:
    return await collection.count_documents(
        {"$or": [{"identity_key": None}, {"identity_key": ""}, {"game_id": None}, {"game_id": ""}]}
    )


async def migrate_identity_keys() -> dict:
    """Backfill -> nouveaux index uniques -> anciens index supprimés EN DERNIER.

    Rejouable (un second passage ne change rien) et strictement additive. Si le backfill laisse des
    documents sans clé, ou si la création d'un index unique échoue (doublons existants), la
    migration s'ARRÊTE AVANT de supprimer les anciens index : ils continuent de protéger, et
    l'application démarre normalement. Aucun identifiant ni pseudo n'est journalisé.

    Returns:
        Un résumé sérialisable (aucune donnée d'identité) : `enabled`, `backfilled`, `new_indexes`,
        `legacy_indexes_dropped`, `complete`, `reason`.
    """
    summary: dict = {"enabled": migration_enabled(), "backfilled": {}, "new_indexes": False,
                     "legacy_indexes_dropped": [], "complete": False, "reason": None}
    if not summary["enabled"]:
        logger.info("identity_key : migration désactivée (%s=off), index historiques conservés",
                    IDENTITY_KEY_MIGRATION_ENV)
        return summary

    for name in IDENTITY_COLLECTIONS:
        summary["backfilled"][name] = await _backfill(getattr(db, name), name)
        missing = await _missing_keys(getattr(db, name), name)
        if missing:
            summary["reason"] = f"backfill_incomplet:{name}"
            logger.warning("identity_key : %s document(s) sans clé dans %s — anciens index conservés",
                           missing, name)
            return summary

    try:
        await db.subscription_locks.create_index([tuple(k) for k in SUBSCRIPTION_LOCK_KEYS],
                                                 unique=True, name=SUBSCRIPTION_LOCK_INDEX)
        await db.evo_locks.create_index([tuple(k) for k in EVO_LOCK_KEYS],
                                        unique=True, name=EVO_LOCK_INDEX)
    except Exception as exc:
        # Doublons pré-existants : on ne supprime RIEN, les anciens index protègent toujours.
        summary["reason"] = "index_creation_failed"
        logger.warning("identity_key : index unique non créé (%s) — anciens index conservés",
                       _safe_error(exc))
        return summary
    summary["new_indexes"] = True

    for collection, new_keys, legacy_keys in (
        (db.subscription_locks, SUBSCRIPTION_LOCK_KEYS, LEGACY_SUBSCRIPTION_LOCK_KEYS),
        (db.evo_locks, EVO_LOCK_KEYS, LEGACY_EVO_LOCK_KEYS),
    ):
        legacy = await _index_name(collection, legacy_keys)
        if not legacy or not await _index_name(collection, new_keys):
            continue  # rien à supprimer, ou nouvel index absent : on garde tout
        if await _safe_drop(collection, legacy):
            summary["legacy_indexes_dropped"].append(legacy)

    summary["complete"] = True
    logger.info("identity_key : migration terminée (%s document(s) complétés, index historique(s) "
                "supprimé(s) : %s)", sum(summary["backfilled"].values()),
                ", ".join(summary["legacy_indexes_dropped"]) or "aucun")
    return summary


if __name__ == "__main__":  # lancé à la main sur une COPIE : cd backend && python -m core.identity_keys
    import asyncio
    import json

    print(json.dumps(asyncio.run(migrate_identity_keys()), indent=2, ensure_ascii=False))
