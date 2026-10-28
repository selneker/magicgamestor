"""Lot 6 — administration du fournisseur ALUU : écran fournisseur, écran de mapping, écritures.

Contrat de référence : `contracts/aluu-admin/` (hors dépôt), qui FAIT FOI. Deux règles
structurent ce module :

- **les écrans se lisent sur le DOCUMENT `games`**, jamais via `provider_for_game` : un écran
  d'administration doit s'afficher PRÉCISÉMENT quand la configuration est cassée (c'est là
  qu'on la répare). `provider_for_game` lève en 503 sur une config ALUU incomplète ;
- **aucune écriture sans validation complète** : code jeu (forme PUIS catalogue live), endpoint,
  table d'identité — et si le catalogue live est indisponible, rien n'est écrit.

Aucune route de ce module n'écrit `fazercards_mapping` et aucune ne fait de `$unset` : un retour
à FazerCards conserve les champs `aluu_*`, seule façon de reprendre une commande ALUU en vol.
"""
import logging
import os
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from core.audit import audit
from core.db import db
from core.games import game_provider, identity_spec
from core.security import has_permission, is_super_admin, require_permission, require_super_admin
from services import aluu, aluu_mapping, providers
from services.providers.aluu_adapter import _read_config, allowed_check_params

router = APIRouter(tags=["aluu-admin"])
logger = logging.getLogger("mgs.aluu.admin")

CONTRACT_VERSION = "v0"

# Forme d'un code jeu ALUU : filtre de SÉCURITÉ (le catalogue live reste la règle métier).
GAME_CODE_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# Tout ce que lisent les écrans. Aucun champ d'identité JOUEUR n'est chargé.
GAME_DOC = {"_id": 0, "id": 1, "name": 1, "provider": 1, "aluu_game_code": 1,
            "aluu_check_endpoint": 1, "aluu_identity_map": 1, "identity_fields": 1}

CHECK_ENDPOINT_LABELS = {
    "game-check": "admin.provider.check_endpoint.game_check",
    "mlbb-check": "admin.provider.check_endpoint.mlbb_check",
    "bgmi": "admin.provider.check_endpoint.bgmi",
}


class _Invalid(Exception):
    """Validation refusée : porte la réponse d'erreur déjà au format du contrat."""

    def __init__(self, response: JSONResponse) -> None:
        super().__init__("validation refusée")
        self.response = response


class ProviderSwitchIn(BaseModel):
    provider: str


class ProviderConfigIn(BaseModel):
    """Corps de `put_config`. Champs optionnels : c'est la validation qui refuse, avec un code."""

    aluu_game_code: str | None = None
    aluu_check_endpoint: str | None = None
    aluu_identity_map: dict | None = None


class MappingLineIn(BaseModel):
    product_id: str
    denom: str


class MappingApplyIn(BaseModel):
    apply: list[MappingLineIn] = Field(default_factory=list)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _error(status: int, code: str, game_id: str | None, detail: str) -> JSONResponse:
    """Enveloppe d'erreur du contrat : `{detail, code, game_id}`, jamais un message brut."""
    return JSONResponse(status_code=status,
                        content={"detail": detail, "code": code, "game_id": game_id})


async def _catalogue() -> list[dict] | None:
    """Catalogue ALUU live, ou `None` s'il est indisponible (jamais une liste inventée)."""
    try:
        return await aluu.games()
    except providers.ProviderError as exc:
        logger.warning("aluu admin: catalogue indisponible code=%s http=%s", exc.code,
                       exc.status_code)
        return None


async def _packs(game_code: str) -> list[dict]:
    """Packs live d'un jeu. Lève `ProviderError` : l'appelant décide de ne rien écrire."""
    return await aluu_mapping.live_packs(game_code)


async def _validate_aluu_config(game_id: str, code: str | None, endpoint: str | None,
                                identity_map: dict | None) -> tuple[dict[str, str], list[dict]]:
    """Valide une configuration ALUU dans l'ORDRE du contrat, ou lève `_Invalid`.

    Ordre : forme du code → catalogue live (source de vérité) → endpoint → table d'identité.
    Si le catalogue est indisponible, RIEN n'est écrit : 502 `provider_unavailable`.
    """
    value = str(code or "").strip()
    if not GAME_CODE_RE.match(value):
        raise _Invalid(_error(400, "invalid_game_code", game_id,
                              "Code jeu invalide : lettres, chiffres, tiret et souligné "
                              "uniquement (64 caractères maximum)."))

    catalogue = await _catalogue()
    if catalogue is None:
        # Rien n'est écrit tant que le catalogue live n'a pas confirmé le code jeu. Le statut
        # est celui que `errors.json` associe à `provider_unavailable` (502, cf. README § 7).
        raise _Invalid(_error(502, "provider_unavailable", game_id,
                              "Catalogue ALUU indisponible : aucune configuration n'a été "
                              "enregistrée."))
    if value not in {str(game.get("game_code") or "") for game in catalogue}:
        raise _Invalid(_error(409, "game_code_not_in_catalog", game_id,
                              "Ce code jeu est absent du catalogue ALUU."))

    endpoint_value = str(endpoint or "").strip()
    if endpoint_value not in aluu.CHECK_ENDPOINTS:
        raise _Invalid(_error(400, "invalid_check_endpoint", game_id,
                              "Endpoint de vérification inconnu : "
                              f"{', '.join(aluu.CHECK_ENDPOINTS)} attendu."))

    allowed = allowed_check_params(endpoint_value) or frozenset()
    if not isinstance(identity_map, dict) or not identity_map:
        raise _Invalid(_error(400, "invalid_identity_map", game_id,
                              "Table d'identité vide : déclarez au moins un champ du jeu."))
    clean: dict[str, str] = {}
    for key, param in identity_map.items():
        field, aluu_param = str(key or "").strip(), str(param or "").strip()
        if not field or not aluu_param or aluu_param not in allowed:
            raise _Invalid(_error(400, "invalid_identity_map", game_id,
                                  "Table d'identité invalide : un paramètre n'est pas accepté "
                                  "par cet endpoint de vérification."))
        clean[field] = aluu_param
    return clean, catalogue


# --------------------------------------------------------------------------- écran fournisseur

def _provider_blocks(doc: dict, catalogue: list[dict] | None) -> list[dict]:
    provider = game_provider(doc)
    declared = bool(str(doc.get("provider") or "").strip())
    code = str(doc.get("aluu_game_code") or "").strip() or None
    endpoint = str(doc.get("aluu_check_endpoint") or "").strip() or None
    declared_map = doc.get("aluu_identity_map")
    declared_map = declared_map if isinstance(declared_map, dict) else {}
    allowed = allowed_check_params(endpoint) or frozenset()

    api_key = aluu.configured()
    webhook_secret = bool(os.environ.get("ALUU_WEBHOOK_SECRET"))
    connection = [
        {"key": "api_key", "label_key": "admin.provider.connection.api_key",
         "value_key": "admin.provider.connection.configured", "value": None,
         "configured": api_key, "state": "mapped" if api_key else "missing"},
        {"key": "webhook_secret", "label_key": "admin.provider.connection.webhook_secret",
         "value_key": "admin.provider.connection.configured", "value": None,
         "configured": webhook_secret, "state": "mapped" if webhook_secret else "missing"},
        # Aucune variable d'environnement ne porte cette URL dans ce dépôt : on ne l'invente pas.
        {"key": "webhook_url", "label_key": "admin.provider.connection.webhook_url",
         "value_key": "admin.provider.connection.not_configured", "value": None,
         "configured": False, "state": "missing"},
    ]

    spec = identity_spec(doc)
    identity_rows: list[dict] = []
    seen: set[str] = set()
    for field in spec:
        key = str(field.get("key") or "")
        param = declared_map.get(key)
        identity_rows.append({
            "key": key, "label": field.get("label") or key,
            "aluu_param": str(param) if param else None,
            "state": "mapped" if param and str(param) in allowed else "missing",
            # Liste fermée des paramètres que l'écran peut proposer pour ce champ (contrat § 5).
            "allowed_params": sorted(allowed)})
        seen.add(key)
    # Une clé déclarée hors des champs du jeu reste VISIBLE : la masquer cacherait une
    # configuration orpheline que personne ne pourrait corriger.
    for key, param in declared_map.items():
        if key in seen:
            continue
        identity_rows.append({"key": key, "label": key, "aluu_param": str(param),
                              "state": "mapped" if str(param) in allowed else "missing",
                              "allowed_params": sorted(allowed)})

    return [
        {"kind": "heading", "label_key": "admin.provider.title", "level": 1},
        {"kind": "text", "label_key": "admin.provider.intro", "tone": "muted"},
        {"kind": "text", "label_key": "admin.provider.readonly_notice", "tone": "muted"},
        {"kind": "select", "key": "provider", "label_key": "admin.provider.field.provider",
         "value": provider, "disabled": True, "options": [
             {"value": "fazercards", "label_key": "admin.provider.option.fazercards"},
             {"value": "aluu", "label_key": "admin.provider.option.aluu"}]},
        {"kind": "text", "label_key": "admin.provider.undeclared_hint", "tone": "warning",
         "visible_when": {"provider_declared": False}},
        {"kind": "heading", "label_key": "admin.provider.section.connection", "level": 2},
        {"kind": "table", "key": "connection", "empty_key": "common.empty", "columns": [
            {"key": "label_key", "label_key": "admin.provider.column.setting",
             "format": "label_key"},
            {"key": "value", "label_key": "admin.provider.column.value", "format": "text"}],
         "rows": connection},
        {"kind": "heading", "label_key": "admin.provider.section.game", "level": 2},
        {"kind": "text", "label_key": "admin.provider.section.game.hint", "tone": "muted"},
        {"kind": "select", "key": "aluu_game_code", "label_key": "admin.provider.field.game_code",
         "value": code, "placeholder_key": "admin.provider.placeholder.game_code",
         "disabled": False,
         "options": [{"value": game["game_code"], "label_key": None,
                      "label": game.get("name") or game["game_code"]}
                     for game in (catalogue or []) if game.get("game_code")]},
        {"kind": "select", "key": "aluu_check_endpoint",
         "label_key": "admin.provider.field.check_endpoint", "value": endpoint,
         "placeholder_key": "admin.provider.placeholder.check_endpoint", "disabled": False,
         # La liste vient du FOURNISSEUR (`aluu.CHECK_ENDPOINTS`) : une option en plus côté
         # ALUU ne peut pas être oubliée ici, et une option fantôme ne peut pas y apparaître.
         "options": [{"value": name,
                      "label_key": CHECK_ENDPOINT_LABELS.get(
                          name, "admin.provider.placeholder.check_endpoint")}
                     for name in aluu.CHECK_ENDPOINTS]},
        {"kind": "table", "key": "identity_fields", "empty_key": "admin.provider.identity.empty",
         "columns": [
             {"key": "key", "label_key": "admin.provider.column.identity_field",
              "format": "text"},
             {"key": "label", "label_key": "admin.provider.column.identity_label",
              "format": "text"},
             {"key": "aluu_param", "label_key": "admin.provider.column.aluu_param",
              "format": "text"}],
         "rows": identity_rows},
        {"kind": "text", "label_key": "admin.provider.identity.hint", "tone": "muted"},
        {"kind": "button", "key": "save_config", "label_key": "common.save",
         "action": "put_config", "variant": "primary",
         "requires": ["permissions.can_edit"]},
        {"kind": "heading", "label_key": "admin.provider.section.switch", "level": 2},
        {"kind": "text", "label_key": "admin.provider.switch.warning", "tone": "warning"},
        {"kind": "button", "key": "switch_provider", "label_key": "admin.provider.switch.action",
         "action": "put_game_provider", "variant": "danger",
         "requires": ["permissions.can_switch_provider"],
         "confirm_key": "admin.provider.switch.confirm"},
        {"kind": "text", "label_key": "admin.provider.switch.in_flight", "tone": "neutral"},
    ]


def _provider_screen(doc: dict, user: dict, catalogue: list[dict] | None) -> dict:
    return {
        "contract_version": CONTRACT_VERSION,
        "screen": "provider",
        "generated_at": _now(),
        "game": {"id": doc.get("id"), "name": doc.get("name") or doc.get("id"),
                 "provider": game_provider(doc),
                 "provider_declared": bool(str(doc.get("provider") or "").strip())},
        "permissions": {"can_edit": has_permission(user, "catalog.manage"),
                        "can_switch_provider": is_super_admin(user),
                        "can_preview": has_permission(user, "catalog.manage"),
                        "can_apply": has_permission(user, "catalog.manage")},
        "blocks": _provider_blocks(doc, catalogue),
    }


@router.get("/admin/games/{game_id}/provider")
async def get_provider_screen(game_id: str,
                              user=Depends(require_permission("catalog.manage"))):
    """Écran « fournisseur du jeu ». Lecture DIRECTE de `games` (une config cassée doit s'afficher)."""
    doc = await db.games.find_one({"id": game_id}, GAME_DOC)
    if doc is None:
        return _error(404, "game_not_found", game_id, "Jeu introuvable.")
    return _provider_screen(doc, user, await _catalogue())


@router.put("/admin/games/{game_id}/provider")
async def put_game_provider(game_id: str, body: ProviderSwitchIn,
                            user=Depends(require_super_admin)):
    """Bascule de fournisseur — SUPER ADMIN uniquement : seule opération irréversible du contrat.

    Vers `aluu` : la configuration DÉJÀ ENREGISTRÉE est revalidée (forme, catalogue live,
    endpoint, table d'identité). Vers `fazercards` : aucun appel catalogue, aucun `$unset` —
    les champs `aluu_*` restent, pour reprendre une commande ALUU en vol.
    """
    target = str(body.provider or "").strip().lower()
    if target not in providers.SUPPORTED_PROVIDERS:
        return _error(400, "invalid_payload", game_id,
                      "Fournisseur inconnu : fazercards ou aluu attendu.")
    doc = await db.games.find_one({"id": game_id}, GAME_DOC)
    if doc is None:
        return _error(404, "game_not_found", game_id, "Jeu introuvable.")

    if target == "aluu":
        code = str(doc.get("aluu_game_code") or "").strip()
        endpoint = str(doc.get("aluu_check_endpoint") or "").strip()
        identity_map = doc.get("aluu_identity_map")
        if not code and not endpoint and not identity_map:
            return _error(503, "unsupported_game", game_id,
                          "Enregistrez d'abord la configuration ALUU du jeu.")
        try:
            _identity_map, catalogue = await _validate_aluu_config(
                game_id, code, endpoint, identity_map)
        except _Invalid as invalid:
            return invalid.response
    else:
        catalogue = await _catalogue()

    await db.games.update_one({"id": game_id}, {"$set": {"provider": target,
                                                        "updated_at": _now()}})
    providers.invalidate_provider_cache(game_id)
    await audit("aluu.provider_changed", user["user_id"], game_id,
                {"from": game_provider(doc), "to": target})
    logger.info("aluu admin: fournisseur du jeu %s changé vers %s", game_id, target)
    return _provider_screen({**doc, "provider": target}, user, catalogue)


@router.put("/admin/games/{game_id}/provider/config")
async def put_provider_config(game_id: str, body: ProviderConfigIn,
                              user=Depends(require_permission("catalog.manage"))):
    """Enregistre la configuration ALUU du jeu. N'active PAS ALUU (route de bascule dédiée)."""
    doc = await db.games.find_one({"id": game_id}, GAME_DOC)
    if doc is None:
        return _error(404, "game_not_found", game_id, "Jeu introuvable.")

    try:
        identity_map, catalogue = await _validate_aluu_config(
            game_id, body.aluu_game_code, body.aluu_check_endpoint, body.aluu_identity_map)
    except _Invalid as invalid:
        return invalid.response

    code = str(body.aluu_game_code or "").strip()
    endpoint = str(body.aluu_check_endpoint or "").strip()
    await db.games.update_one({"id": game_id}, {"$set": {
        "aluu_game_code": code, "aluu_check_endpoint": endpoint,
        "aluu_identity_map": identity_map, "updated_at": _now()}})
    providers.invalidate_provider_cache(game_id)
    await audit("aluu.provider_config_saved", user["user_id"], game_id,
                {"game_code": code, "check_endpoint": endpoint,
                 "identity_fields": sorted(identity_map)})
    return _provider_screen({**doc, "aluu_game_code": code, "aluu_check_endpoint": endpoint,
                             "aluu_identity_map": identity_map}, user, catalogue)


# --------------------------------------------------------------------------- écran de mapping

def _mapping_blocks(current: list[dict], proposal: list[dict]) -> list[dict]:
    return [
        {"kind": "heading", "label_key": "admin.aluu_mapping.title", "level": 1},
        {"kind": "text", "label_key": "admin.aluu_mapping.intro", "tone": "muted"},
        {"kind": "text", "label_key": "admin.aluu_mapping.preview_notice", "tone": "warning"},
        {"kind": "table", "key": "products", "empty_key": "admin.aluu_mapping.empty",
         "columns": [
             {"key": "name", "label_key": "admin.aluu_mapping.column.product",
              "format": "text"},
             {"key": "price", "label_key": "admin.aluu_mapping.column.price",
              "format": "money"},
             {"key": "state", "label_key": "admin.aluu_mapping.column.state",
              "format": "state"},
             {"key": "match", "label_key": "admin.aluu_mapping.column.match",
              "format": "pack"}],
         "rows": current},
        {"kind": "button", "key": "preview", "label_key": "admin.aluu_mapping.preview",
         "action": "mapping_preview", "variant": "secondary",
         "requires": ["permissions.can_preview"]},
        {"kind": "heading", "label_key": "admin.aluu_mapping.section.preview", "level": 2},
        {"kind": "table", "key": "preview", "empty_key": "admin.aluu_mapping.preview.empty",
         "columns": [
             # La case à cocher du flux « aperçu → sélection → appliquer » (contrat § 5).
             {"key": "selected", "label_key": "admin.aluu_mapping.column.selected",
              "format": "checkbox"},
             {"key": "product_id", "label_key": "admin.aluu_mapping.column.product",
              "format": "text"},
             {"key": "state", "label_key": "admin.aluu_mapping.column.state",
              "format": "state"},
             {"key": "matched_by", "label_key": "admin.aluu_mapping.column.matched_by",
              "format": "text"},
             {"key": "match", "label_key": "admin.aluu_mapping.column.match",
              "format": "pack"}],
         "rows": proposal},
        {"kind": "text", "label_key": "admin.aluu_mapping.apply_notice", "tone": "warning"},
        {"kind": "button", "key": "apply", "label_key": "admin.aluu_mapping.apply",
         "action": "mapping_apply", "variant": "primary",
         "requires": ["permissions.can_apply"],
         "confirm_key": "admin.aluu_mapping.apply.confirm"},
    ]


async def _mapping_screen(doc: dict, packs: list[dict] | None) -> dict:
    """Les deux tables de l'écran, sur le MÊME ensemble de produits appariables.

    `packs = None` (catalogue live indisponible) : la table courante reste servie depuis la
    vérité locale, la proposition est vide — jamais une proposition inventée.
    """
    code = str(doc.get("aluu_game_code") or "").strip()
    products = await aluu_mapping.appariable_products(doc["id"])
    current = aluu_mapping.current_rows(products, packs, code)
    proposal = aluu_mapping.proposal_rows(products, packs, code) if packs is not None else []
    return {
        "contract_version": CONTRACT_VERSION,
        "screen": "mapping",
        "generated_at": _now(),
        "game": {"id": doc.get("id"), "name": doc.get("name") or doc.get("id"),
                 "provider": game_provider(doc)},
        # Le mapping ne s'édite pas en place : il s'APERÇOIT puis s'APPLIQUE.
        "permissions": {"can_edit": False,
                        "can_preview": True, "can_apply": True},
        "blocks": _mapping_blocks(current, proposal),
    }


async def _live_context(game_id: str, doc: dict) -> tuple[str, list[dict]]:
    """Code jeu + packs live, ou `_Invalid`. Refuse une configuration ALUU inutilisable."""
    if _read_config(doc, require_endpoint=True) is None:
        raise _Invalid(_error(503, "unsupported_game", game_id,
                              "Jeu configuré ALUU mais configuration incomplète : code jeu, "
                              "endpoint Name Check ou table d'identité manquant/invalide."))
    code = str(doc.get("aluu_game_code") or "").strip()
    try:
        packs = await _packs(code)
    except providers.ProviderError as exc:
        status = exc.status_code if 400 <= int(exc.status_code or 0) <= 599 else 502
        raise _Invalid(_error(status, exc.code or "provider_unavailable", game_id, exc.message))
    return code, packs


@router.get("/admin/games/{game_id}/aluu-mapping")
async def get_mapping_screen(game_id: str,
                            user=Depends(require_permission("catalog.manage"))):
    """Écran de mapping. Un catalogue indisponible ne fait PAS échouer l'écran."""
    doc = await db.games.find_one({"id": game_id}, GAME_DOC)
    if doc is None:
        return _error(404, "game_not_found", game_id, "Jeu introuvable.")
    code = str(doc.get("aluu_game_code") or "").strip()
    packs: list[dict] | None = None
    if code:
        try:
            packs = await _packs(code)
        except providers.ProviderError as exc:
            logger.warning("aluu admin: catalogue indisponible pour %s code=%s", game_id, exc.code)
    return await _mapping_screen(doc, packs)


@router.post("/admin/games/{game_id}/aluu-mapping/preview")
async def preview_mapping(game_id: str,
                          user=Depends(require_permission("catalog.manage"))):
    """Aperçu LECTURE SEULE. Aucune écriture, aucune confirmation, aucun appel d'écriture."""
    doc = await db.games.find_one({"id": game_id}, GAME_DOC)
    if doc is None:
        return _error(404, "game_not_found", game_id, "Jeu introuvable.")
    try:
        code, packs = await _live_context(game_id, doc)
    except _Invalid as invalid:
        return invalid.response
    products = await aluu_mapping.appariable_products(game_id)
    rows = aluu_mapping.proposal_rows(products, packs, code)
    summary = {"proposed": sum(1 for r in rows if r["state"] == "proposed"),
               "ambiguous": sum(1 for r in rows if r["state"] == "ambiguous"),
               "missing": sum(1 for r in rows if r["state"] == "missing")}
    return {"game_id": game_id, "aluu_game_code": code, "rows": rows, "summary": summary}


@router.post("/admin/games/{game_id}/aluu-mapping/apply")
async def apply_mapping(game_id: str, body: MappingApplyIn,
                        user=Depends(require_permission("catalog.manage"))):
    """Applique la sélection après RECALCUL COMPLET de l'aperçu.

    La sélection du client n'est jamais crue : chaque ligne est revalidée contre l'aperçu frais.
    Une seule ligne non `proposed` (ou dont le `denom` diverge) fait échouer TOUTE la requête en
    `409 mapping_stale`, avant la moindre écriture.
    """
    doc = await db.games.find_one({"id": game_id}, GAME_DOC)
    if doc is None:
        return _error(404, "game_not_found", game_id, "Jeu introuvable.")
    try:
        code, packs = await _live_context(game_id, doc)
    except _Invalid as invalid:
        return invalid.response

    fresh = await aluu_mapping.preview(game_id, code, packs)
    by_id = {item.get("product_id"): item for item in fresh.get("items") or []}
    for line in body.apply:
        item = by_id.get(line.product_id)
        if item is None:
            return _error(404, "mapping_not_found", game_id,
                          f"Produit {line.product_id} introuvable pour ce jeu.")
        if item.get("match") != aluu_mapping.EXACT or item.get("denom") != line.denom:
            return _error(409, "mapping_stale", game_id,
                          "La sélection ne correspond plus à l'aperçu : rien n'a été enregistré. "
                          "Relancez l'aperçu.")

    result = await aluu_mapping.apply(fresh, [line.product_id for line in body.apply],
                                      actor=f"admin:{user['user_id']}")
    return {"game_id": game_id, "aluu_game_code": code, **result}
