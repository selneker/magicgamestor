"""PL-ORDER-PROOF-1 — preuves de paiement manuel : validation, compression, Azure Blob privé.

Règles volontairement strictes :
- le type est décidé par les OCTETS (signature JPEG/PNG), jamais par l'extension ni le
  `Content-Type` envoyé par le client ;
- l'image est TOUJOURS réencodée en JPEG (métadonnées EXIF supprimées, côté long ≤ 1600 px,
  cible ≤ 300 Ko) avant de quitter le processus ;
- le blob porte un nom aléatoire (UUID) : ni l'identifiant de commande, ni le nom d'origine ;
- aucun accès public : l'admin relit le contenu via une route authentifiée qui relaie Azure.

Sans `AZURE_STORAGE_CONNECTION_STRING` / `AZURE_PROOF_CONTAINER`, `configured()` est faux et la
route répond « indisponible » : le reste du site n'est jamais affecté. L'import du SDK Azure est
paresseux (aucun démarrage cassé si le paquet venait à manquer).
"""
import asyncio
import hashlib
import io
import logging
import os
import uuid
from datetime import datetime, timezone

logger = logging.getLogger("mgs.proofs")

MAX_FILES = 3
MAX_INPUT_BYTES = 8 * 1024 * 1024
MAX_LONG_SIDE = 1600
TARGET_BYTES = 300 * 1024
CONTENT_TYPE = "image/jpeg"
JPEG_SIGNATURE = b"\xff\xd8\xff"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# Garde-fou Pillow : une bombe de décompression reste une erreur, jamais une consommation RAM.
MAX_PIXELS = 40_000_000


class ProofError(Exception):
    """Erreur de preuve avec un code stable (jamais le contenu de l'image)."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def configured() -> bool:
    """Fonction disponible seulement si le stockage privé est configuré."""
    return bool(_env("AZURE_STORAGE_CONNECTION_STRING") and _env("AZURE_PROOF_CONTAINER"))


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


def metadata(blob_name: str, payload: bytes) -> dict:
    return {
        "blob_name": blob_name,
        "size": len(payload),
        "content_type": CONTENT_TYPE,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }


def _blob_client(blob_name: str):
    from azure.storage.blob import BlobServiceClient

    service = BlobServiceClient.from_connection_string(_env("AZURE_STORAGE_CONNECTION_STRING"))
    return service.get_blob_client(container=_env("AZURE_PROOF_CONTAINER"), blob=blob_name)


def _upload_sync(blob_name: str, payload: bytes) -> None:
    from azure.storage.blob import ContentSettings

    _blob_client(blob_name).upload_blob(
        payload, overwrite=False,
        content_settings=ContentSettings(content_type=CONTENT_TYPE),
    )


async def upload(payload: bytes) -> str:
    """Dépose le JPEG compressé dans le conteneur privé et retourne le nom du blob."""
    blob_name = f"{uuid.uuid4().hex}.jpg"
    await asyncio.to_thread(_upload_sync, blob_name, payload)
    return blob_name


async def download(blob_name: str) -> bytes:
    """Contenu du blob (route admin uniquement)."""
    return await asyncio.to_thread(lambda: _blob_client(blob_name).download_blob().readall())


async def delete(blob_name: str) -> bool:
    """Supprime un blob. Idempotent : un blob déjà absent n'est pas une erreur."""
    from azure.core.exceptions import ResourceNotFoundError

    def _delete() -> bool:
        try:
            _blob_client(blob_name).delete_blob()
        except ResourceNotFoundError:
            return True
        return True

    try:
        return await asyncio.to_thread(_delete)
    except Exception as exc:  # une panne Azure est journalisée, jamais propagée en boucle
        logger.warning("Suppression du blob de preuve impossible (%s)", type(exc).__name__)
        raise
