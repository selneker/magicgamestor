"""PL-ORDER-PROOF-1B — preuves de paiement manuel : validation, compression, stockage GridFS.

Règles volontairement strictes :
- le type est décidé par les OCTETS (signature JPEG/PNG), jamais par l'extension ni le
  `Content-Type` envoyé par le client ;
- l'image est TOUJOURS réencodée en JPEG (métadonnées EXIF supprimées, côté long ≤ 1600 px,
  cible ≤ 300 Ko) avant de quitter le processus ;
- le fichier GridFS porte un nom aléatoire (UUID) : ni l'identifiant de commande, ni le nom
  d'origine ;
- aucun accès public : l'admin relit le contenu via une route authentifiée qui relaie GridFS.

Le stockage est un bucket GridFS dédié (`payment_proofs`) dans la base MongoDB du site : aucun
service externe, aucun réseau supplémentaire. `PROOF_STORAGE_ENABLED=false` désactive proprement
les envois (503) sans affecter le reste du site. `PROOF_MAX_TOTAL_MB` plafonne l'espace occupé par
les images ; la purge des preuves anciennes libère la place.

PL-PROOF-QUOTA-1 ajoute un garde-fou sur la base ENTIÈRE (Atlas gratuit = 512 Mo tout compris,
écritures refusées une fois plein) : `PROOF_DB_MAX_MB` refuse les envois au-delà, et
`PROOF_DB_WARN_MB` déclenche une alerte précoce. La taille vient de `dbStats`
(`storageSize + indexSize`), mise en cache 5 minutes ; une commande refusée ou une panne rend la
taille inconnue (`None`) et ne bloque jamais rien.
"""
import hashlib
import io
import logging
import os
import time
import uuid
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from gridfs.errors import NoFile
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from core.db import db

logger = logging.getLogger("mgs.proofs")

BUCKET = "payment_proofs"
MAX_FILES = 3
MAX_INPUT_BYTES = 8 * 1024 * 1024
MAX_LONG_SIDE = 1600
TARGET_BYTES = 300 * 1024
CONTENT_TYPE = "image/jpeg"
JPEG_SIGNATURE = b"\xff\xd8\xff"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# Garde-fou Pillow : une bombe de décompression reste une erreur, jamais une consommation RAM.
MAX_PIXELS = 40_000_000
# Quota total (Mo) des images stockées : Atlas gratuit = 512 Mo pour tout le site.
DEFAULT_MAX_TOTAL_MB = 150
# Marqueur du dépassement déjà notifié (une alerte par dépassement, pas une par requête).
QUOTA_ALERTS = "proof_storage_alerts"
QUOTA_ALERT_ID = "proofs-quota"

# PL-PROOF-QUOTA-1 — garde-fou sur la taille RÉELLE de toute la base (Atlas gratuit = 512 Mo).
# Refus au-delà de `PROOF_DB_MAX_MB` (défaut 400), alerte précoce au-delà de `PROOF_DB_WARN_MB`
# (défaut 350). Mesure `dbStats` (storageSize + indexSize) mise en cache 5 minutes.
DEFAULT_DB_MAX_MB = 400
DEFAULT_DB_WARN_MB = 350
DB_USAGE_CACHE_S = 300
DB_ALERTS = "proof_db_alerts"
DB_ALERT_ID = "proofs-db"
DB_WARNINGS = "proof_storage_warnings"
DB_WARN_ID = "proofs-db-warn"


class ProofError(Exception):
    """Erreur de preuve avec un code stable (jamais le contenu de l'image)."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class ProofNotFound(ProofError):
    """Fichier de preuve absent du stockage (déjà purgé, identifiant inconnu)."""

    def __init__(self) -> None:
        super().__init__("not_found")


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def storage_enabled() -> bool:
    """`PROOF_STORAGE_ENABLED` (défaut vrai) : faux = envois refusés proprement."""
    return _env("PROOF_STORAGE_ENABLED").lower() not in ("0", "false", "no", "off")


def _env_mb(name: str, default: int) -> int:
    """Valeur en Mo lue dans l'environnement, jamais négative, défaut si illisible."""
    raw = _env(name)
    try:
        megabytes = int(raw) if raw else default
    except ValueError:
        megabytes = default
    return max(0, megabytes)


def max_total_mb() -> int:
    """Quota total des images (`PROOF_MAX_TOTAL_MB`, 150 Mo par défaut)."""
    return _env_mb("PROOF_MAX_TOTAL_MB", DEFAULT_MAX_TOTAL_MB)


def max_total_bytes() -> int:
    """Quota total des images en octets (jamais négatif)."""
    return max_total_mb() * 1024 * 1024


def db_max_mb() -> int:
    """Refus des envois au-delà de cette taille de base (`PROOF_DB_MAX_MB`, 400 Mo)."""
    return _env_mb("PROOF_DB_MAX_MB", DEFAULT_DB_MAX_MB)


def db_max_bytes() -> int:
    return db_max_mb() * 1024 * 1024


def db_warn_mb() -> int:
    """Seuil d'alerte précoce (`PROOF_DB_WARN_MB`, 350 Mo)."""
    return _env_mb("PROOF_DB_WARN_MB", DEFAULT_DB_WARN_MB)


def db_warn_bytes() -> int:
    return db_warn_mb() * 1024 * 1024


# --------------------------------------------------------------------------- #
# Validation et compression (inchangées depuis PL-ORDER-PROOF-1)
# --------------------------------------------------------------------------- #
def sniff(data: bytes) -> str | None:
    """Type réel d'après les octets magiques. `None` = refusé."""
    if not data:
        return None
    if data.startswith(JPEG_SIGNATURE):
        return "image/jpeg"
    if data.startswith(PNG_SIGNATURE):
        return "image/png"
    return None


def _flatten(img):
    """Fond blanc pour les PNG transparents, puis RGB (aucune donnée EXIF conservée)."""
    from PIL import Image

    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.split()[-1])
        return background
    return img.convert("RGB")


def compress(data: bytes) -> bytes:
    """Rééchantillonne et recompresse en JPEG ≤ 300 Ko, sans EXIF.

    Lève `ProofError("invalid_image")` si le contenu n'est pas une image exploitable.
    """
    from PIL import Image, UnidentifiedImageError

    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with Image.open(io.BytesIO(data)) as opened:
            opened.load()
            img = _flatten(opened)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ProofError("invalid_image") from exc

    img.thumbnail((MAX_LONG_SIDE, MAX_LONG_SIDE), Image.LANCZOS)
    quality = 85
    while True:
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=quality, optimize=True, progressive=True)
        output = buffer.getvalue()
        if len(output) <= TARGET_BYTES:
            return output
        if quality > 35:
            quality -= 10
            continue
        if max(img.size) <= 320:
            # Cas extrême (bruit intégral) : on rend le meilleur effort possible, toujours sans EXIF.
            return output
        img = img.resize((max(1, int(img.width * 0.75)), max(1, int(img.height * 0.75))), Image.LANCZOS)
        quality = 75


def metadata(stored_id: str, payload: bytes) -> dict:
    return {
        "blob_name": stored_id,
        "size": len(payload),
        "content_type": CONTENT_TYPE,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }


# --------------------------------------------------------------------------- #
# Couche de stockage (seule surface utilisée par le reste du code)
# --------------------------------------------------------------------------- #
def _bucket() -> AsyncIOMotorGridFSBucket:
    return AsyncIOMotorGridFSBucket(db, bucket_name=BUCKET)


async def save(payload: bytes) -> str:
    """Écrit le JPEG compressé dans le bucket GridFS et retourne l'identifiant stocké."""
    stored_id = await _bucket().upload_from_stream(
        f"{uuid.uuid4().hex}.jpg", payload, metadata={"content_type": CONTENT_TYPE})
    return str(stored_id)


async def read(stored_id: str) -> bytes:
    """Contenu d'une preuve (route admin uniquement)."""
    try:
        stream = await _bucket().open_download_stream(ObjectId(stored_id))
    except (NoFile, InvalidId) as exc:
        raise ProofNotFound() from exc
    return await stream.read()


async def delete(stored_id: str) -> bool:
    """Supprime une preuve. Idempotent : un fichier déjà absent n'est pas une erreur."""
    try:
        await _bucket().delete(ObjectId(stored_id))
    except (NoFile, InvalidId):
        return True
    return True


# --------------------------------------------------------------------------- #
# Quota
# --------------------------------------------------------------------------- #
async def usage_bytes() -> int:
    """Espace réellement occupé par les fichiers du bucket (une panne = 0, jamais un blocage)."""
    total = 0
    try:
        async for doc in db[f"{BUCKET}.files"].find({}, {"length": 1}):
            total += int(doc.get("length") or 0)
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Taille du stockage des preuves illisible (%s)", type(exc).__name__)
        return 0
    return total


async def has_room(extra_bytes: int = 0) -> bool:
    """Vrai si le quota total reste respecté en ajoutant `extra_bytes`."""
    return await usage_bytes() + max(0, extra_bytes) <= max_total_bytes()


async def _marker_once(collection: str, marker_id: str) -> bool:
    """Réserve un marqueur atomique ; vrai seulement s'il vient d'être créé.

    Une panne d'écriture est journalisée et vaut « pas d'alerte » : l'observabilité ne casse
    jamais la requête en cours (`quota_alert_once` historique et alertes PL-PROOF-QUOTA-1).
    """
    now = datetime.now(timezone.utc).isoformat()
    try:
        result = await db[collection].update_one(
            {"_id": marker_id},
            {"$setOnInsert": {"created_at": now, "updated_at": now}},
            upsert=True,
        )
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Marqueur d'alerte illisible (%s)", type(exc).__name__)
        return False
    return result.upserted_id is not None


async def _marker_clear(collection: str, marker_id: str) -> None:
    """Efface un marqueur (idempotent, jamais d'exception)."""
    try:
        await db[collection].delete_one({"_id": marker_id})
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Marqueur d'alerte non effacé (%s)", type(exc).__name__)


async def count_files() -> int:
    """Nombre de fichiers de preuve stockés (0 si illisible, jamais d'exception)."""
    try:
        return int(await db[f"{BUCKET}.files"].count_documents({}))
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Nombre de preuves illisible (%s)", type(exc).__name__)
        return 0


async def quota_alert_once() -> bool:
    """Réserve l'alerte de dépassement ; vrai seulement pour le premier refus de la série."""
    return await _marker_once(QUOTA_ALERTS, QUOTA_ALERT_ID)


async def clear_quota_alert() -> None:
    """Efface le marqueur dès qu'un envoi repasse : un futur dépassement alertera de nouveau."""
    await _marker_clear(QUOTA_ALERTS, QUOTA_ALERT_ID)


# --------------------------------------------------------------------------- #
# PL-PROOF-QUOTA-1 — taille réelle de la base, refus et alertes
# --------------------------------------------------------------------------- #
_clock = time.monotonic
# Cache (horodatage monotone, octets ou None) : évite un `dbStats` à chaque requête.
_db_usage_cache: tuple[float, int | None] | None = None


def reset_db_usage_cache() -> None:
    """Vide le cache de taille (tests et diagnostic manuel uniquement)."""
    global _db_usage_cache
    _db_usage_cache = None


async def _read_db_stats() -> int | None:
    """`storageSize + indexSize` de la base courante, ou `None` si la commande échoue.

    `dbStats` est autorisé sur le niveau gratuit d'Atlas pour la base du site (seules `local` et
    `config` sont interdites). Toute erreur ou refus reste une valeur inconnue, jamais une exception.
    """
    try:
        stats = await db.command("dbStats", scale=1)
        return int(stats.get("storageSize") or 0) + int(stats.get("indexSize") or 0)
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Taille de la base illisible (%s)", type(exc).__name__)
        return None


async def db_usage_bytes() -> int | None:
    """Taille réelle de la base (octets), en cache 5 minutes ; `None` = inconnue."""
    global _db_usage_cache
    now = _clock()
    if _db_usage_cache is not None and now - _db_usage_cache[0] < DB_USAGE_CACHE_S:
        return _db_usage_cache[1]
    value = await _read_db_stats()
    _db_usage_cache = (now, value)
    return value


async def db_alert_once() -> bool:
    """Réserve l'alerte « base saturée » ; vrai une seule fois par dépassement."""
    return await _marker_once(DB_ALERTS, DB_ALERT_ID)


async def clear_db_alert() -> None:
    """Un envoi accepté referme la série : un prochain dépassement alertera de nouveau."""
    await _marker_clear(DB_ALERTS, DB_ALERT_ID)


def _day(now: datetime | None = None) -> str:
    """Jour UTC `AAAA-MM-JJ` (clé de l'alerte quotidienne)."""
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%d")


async def storage_warning_once(now: datetime | None = None) -> bool:
    """Réserve l'alerte précoce du jour ; vrai seulement au premier passage de la journée UTC."""
    return await _marker_once(DB_WARNINGS, f"{DB_WARN_ID}:{_day(now)}")


async def check_storage_warnings(now: datetime | None = None) -> dict:
    """Alerte précoce quotidienne (base ou preuves proches du plafond). Ne lève jamais.

    Appelée par la tâche planifiée existante (`POST /api/internal/orders/run`). Une seule
    notification par jour UTC, même si la tâche tourne plusieurs fois.
    """
    db_bytes = await db_usage_bytes()
    proofs_bytes = await usage_bytes()
    proofs_limit = max_total_bytes()
    over_db = db_bytes is not None and db_bytes >= db_warn_bytes()
    over_proofs = proofs_limit > 0 and proofs_bytes >= proofs_limit * 80 // 100
    if not (over_db or over_proofs):
        return {"storage_alerts": 0}
    if not await storage_warning_once(now):
        return {"storage_alerts": 0}
    from services import notifications  # import local : garde ce module sans dépendance d'alerte

    notifications.schedule(None, notifications.notify_storage_warning,
                           db_bytes, db_max_bytes(), proofs_bytes, proofs_limit, _day(now))
    return {"storage_alerts": 1}
