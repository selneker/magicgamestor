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
les images (Atlas gratuit = 512 Mo pour tout le site) ; la purge des preuves anciennes libère la
place.
"""
import hashlib
import io
import logging
import os
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


def max_total_bytes() -> int:
    """Quota total des images (`PROOF_MAX_TOTAL_MB`, 150 Mo par défaut, jamais négatif)."""
    raw = _env("PROOF_MAX_TOTAL_MB")
    try:
        megabytes = int(raw) if raw else DEFAULT_MAX_TOTAL_MB
    except ValueError:
        megabytes = DEFAULT_MAX_TOTAL_MB
    return max(0, megabytes) * 1024 * 1024


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


async def quota_alert_once() -> bool:
    """Réserve l'alerte de dépassement ; vrai seulement pour le premier refus de la série."""
    now = datetime.now(timezone.utc).isoformat()
    try:
        result = await db[QUOTA_ALERTS].update_one(
            {"_id": QUOTA_ALERT_ID},
            {"$setOnInsert": {"created_at": now, "updated_at": now}},
            upsert=True,
        )
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Marqueur de quota illisible (%s)", type(exc).__name__)
        return False
    return result.upserted_id is not None


async def clear_quota_alert() -> None:
    """Efface le marqueur dès qu'un envoi repasse : un futur dépassement alertera de nouveau."""
    try:
        await db[QUOTA_ALERTS].delete_one({"_id": QUOTA_ALERT_ID})
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Marqueur de quota non effacé (%s)", type(exc).__name__)
