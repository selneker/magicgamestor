"""Client Neferbyte « Game ID Checker » — vérification d'identité joueur (ID / zone).

Neferbyte ne sert QUE la vérification d'identité : il ne crée aucune commande. Le top-up reste
FazerCards. Ce module est volontairement autonome : il ne connaît ni le routeur, ni la base, ni
`get_provider()`. Le branchement est fait en BE-3 / BE-4.

Contrat interne (aucune exception HTTP levée ici) : `verify_identity` renvoie toujours un
`IdentityCheck` dont `status` vaut

- `ok`                    : pseudo trouvé (`success === true` ET `data.username` non vide) ;
- `invalid_id`            : ID inexistant ou entrée refusée par le fournisseur (pas une panne) ;
- `provider_unavailable`  : clé absente/invalide, abonnement, add-on, quota, maintenance,
                            réponse inattendue ou message inconnu (fail-closed) ;
- `timeout`               : l'appel a expiré ;
- `config_error`          : slug inconnu ou champs incohérents avec le catalogue (AUCUN appel).

Mapping HTTP prévu (BE-4) : `ok` → `valid: true` ; `invalid_id` → `valid: false` ;
`provider_unavailable` → 503 `provider_unavailable` ; `timeout` → 504 ; `config_error` → 503
`unsupported_game`.

Règles de sécurité : la clé ne quitte jamais l'en-tête `x-api-key` (jamais loguée, jamais
renvoyée), et ni l'ID joueur ni le pseudo n'apparaissent dans les logs — le message d'erreur du
fournisseur contient l'ID en clair, il n'est donc jamais logué tel quel.

Quota (PL-003-BE-5) : `set_attempt_hook(hook)` installe, pour la tâche courante, un point d'accroche
asynchrone appelé AVANT chaque tentative HTTP ; s'il renvoie `False`, aucune requête ne part et le
résultat est `provider_unavailable` / `quota_guard`. C'est le crochet utilisé par
`services.neferbyte_guard` pour compter les appels réels ; ce module ne connaît ni le cache ni la base.
"""
from __future__ import annotations

import asyncio
import contextvars
import logging
import os
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

# Point d'accroche appelé AVANT chaque tentative HTTP (comptage de quota, PL-003-BE-5). Un
# `ContextVar` et non un paramètre de `verify_identity` : les appelants existants gardent la même
# signature, et deux vérifications simultanées ne partagent pas leur compteur.
AttemptHook = Callable[[], Awaitable[bool]]
_attempt_hook: contextvars.ContextVar[AttemptHook | None] = contextvars.ContextVar(
    "neferbyte_attempt_hook", default=None)


def set_attempt_hook(hook: AttemptHook | None):
    """Installe le hook des tentatives ; renvoie le jeton à passer à `reset_attempt_hook`."""
    return _attempt_hook.set(hook)


def reset_attempt_hook(token) -> None:
    """Rétablit le hook précédent (toujours dans un `finally`)."""
    _attempt_hook.reset(token)

DEFAULT_BASE_URL = "https://api.neferbyte.com"
# Timeout volontairement court : la vérification est sur le chemin critique du checkout.
# Pire cas avec l'unique nouvel essai : 2 x 6 s + 2,5 s d'attente = ~14,5 s.
DEFAULT_TIMEOUT_S = 6.0
# Délai avant l'unique nouvel essai (doc : « retry once after 2–3s »).
RETRY_DELAY_S = 2.5

# Statuts de résultat (contrat interne, mappés en HTTP par le routeur — jamais d'exception ici).
OK = "ok"
INVALID_ID = "invalid_id"
PROVIDER_UNAVAILABLE = "provider_unavailable"
TIMEOUT = "timeout"
CONFIG_ERROR = "config_error"


class _RedactIdentityUrls(logging.Filter):
    """Masque les segments d'identité des URLs Neferbyte dans les logs `httpx`.

    httpx journalise chaque requête à l'INFO, URL complète comprise : l'ID joueur (et le
    serveur/tag) y apparaîtrait en clair. Le filtre est volontairement limité aux chemins
    `/game-id-checker/…` (aucune autre requête de l'application n'est touchée).
    """

    _PATTERN = re.compile(r"(/game-id-checker/[^/\s\"]+)/[^/\s\"]+(?:/[^/\s\"]+)?")

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003 - signature stdlib
        try:
            message = record.getMessage()
        except Exception:  # pragma: no cover - message mal formé : ne rien casser
            return True
        if "/game-id-checker/" not in message:
            return True
        record.msg = self._PATTERN.sub(r"\1/<redacted>", message)
        record.args = ()
        return True


def _install_identity_log_redaction() -> None:
    httpx_logger = logging.getLogger("httpx")
    if not any(isinstance(f, _RedactIdentityUrls) for f in httpx_logger.filters):
        httpx_logger.addFilter(_RedactIdentityUrls())


_install_identity_log_redaction()


@dataclass
class IdentityCheck:
    """Résultat typé d'une vérification d'identité Neferbyte.

    `reason` est une clé machine SÛRE (jamais l'ID ni le pseudo) destinée aux logs.
    `raw` garde la charge utile `data` du fournisseur (région, `is_ban`…) pour le diagnostic
    interne ; il n'est jamais journalisé.
    """

    status: str
    player_name: str | None = None
    region: str | None = None
    is_ban: bool | None = None
    reason: str | None = None
    raw: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status == OK


@dataclass(frozen=True)
class GameSpec:
    """Description d'un endpoint Neferbyte, dérivée de la documentation PDF.

    `server_label` vaut `None` quand l'endpoint ne prend qu'un segment d'identifiant
    (`/slug/{id}`) ; sinon le libellé du second segment (`server`, `tag`), et sa nature.
    """

    slug: str
    id_kind: str = "numeric"          # "numeric" | "text"
    server_label: str | None = None   # None = un seul segment
    server_kind: str | None = None    # "numeric" | "text"
    returns_region: bool = False
    returns_is_ban: bool = False
    requires_addon: bool = False

    @property
    def needs_server(self) -> bool:
        return self.server_label is not None


# Catalogue statique — source : docs-magicgamestor/neferbyte_api_documentation.pdf (API v1, 39
# endpoints : 32 jeux + 7 live/social). Les slugs sont sensibles à la casse : ne jamais les
# normaliser. Aucune valeur n'est devinée : chaque entrée correspond à une section du PDF.
_GAMES: tuple[GameSpec, ...] = (
    # --- jeux (32) ---
    GameSpec("mobile-legends", server_label="server", server_kind="numeric"),
    GameSpec("free-fire"),
    GameSpec("ff-global", returns_region=True),
    GameSpec("bgmi", requires_addon=True),
    GameSpec("pubgm-global", returns_is_ban=True),
    GameSpec("pubgm-lite"),
    GameSpec("cod-mobile"),
    GameSpec("valorant", id_kind="text", server_label="tag", server_kind="text"),
    GameSpec("honor-of-kings", returns_is_ban=True),
    GameSpec("arena-of-valor"),
    GameSpec("blood-strike"),
    GameSpec("arena-breakout"),
    GameSpec("pokemonunite", id_kind="text"),
    GameSpec("genshin", returns_region=True),
    GameSpec("mu-devils-awaken"),
    GameSpec("mu-origin-3"),
    GameSpec("dragon-raja"),
    GameSpec("lifeafter"),
    GameSpec("opm-the-strongest"),
    GameSpec("metal-slug"),
    GameSpec("revelation"),
    GameSpec("gov-nikke"),
    GameSpec("eggy-party"),
    GameSpec("tom-and-jerry-chase"),
    GameSpec("whiteoutsurvival"),
    GameSpec("ace-racer"),
    GameSpec("speed-drifters"),
    GameSpec("mcgg"),
    GameSpec("dfm"),
    GameSpec("dfm-garena"),
    GameSpec("teen-patti-gold"),
    GameSpec("jawaker"),
    # --- live & social (7) ---
    GameSpec("bigo-live"),
    GameSpec("poppo"),
    GameSpec("tumile"),
    GameSpec("livu"),
    GameSpec("higgs-domino"),
    GameSpec("mixu"),
    GameSpec("hiya"),
)

GAMES: dict[str, GameSpec] = {spec.slug: spec for spec in _GAMES}

# Messages d'erreur documentés (comparés en minuscules, par sous-chaîne).
_NOT_FOUND_MARKERS = ("can't find a username", "cannot find a username")
_INVALID_ENTRY_MARKERS = (
    "the id field is required",
    "must contain only numbers",
    "tag field must contain valid tags",
)
_UNAVAILABLE_MARKERS = (
    "authentication is required",
    "enter a valid x-api-key",
    "don't have an active subscription",
    "daily limit",
    "under maintenance",
)


def game_spec(slug: str | None) -> GameSpec | None:
    """Spec catalogue du slug, ou `None` si le slug est inconnu (jamais de slug inventé)."""
    return GAMES.get((slug or "").strip())


def configured() -> bool:
    """Vrai si une clé API est présente dans l'environnement (aucune clé par défaut)."""
    return bool(os.environ.get("NEFERBYTE_API_KEY"))


def _config() -> tuple[str, str]:
    base = os.environ.get("NEFERBYTE_API_BASE", DEFAULT_BASE_URL).rstrip("/")
    return base, os.environ.get("NEFERBYTE_API_KEY") or ""


def _timeout() -> float:
    """Timeout par tentative : `NEFERBYTE_TIMEOUT_S`, valeur par défaut sûre sinon."""
    raw = os.environ.get("NEFERBYTE_TIMEOUT_S")
    if not raw:
        return DEFAULT_TIMEOUT_S
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_TIMEOUT_S
    return value if value > 0 else DEFAULT_TIMEOUT_S


async def _sleep(seconds: float) -> None:
    """Point d'attente unique (remplacé par les tests, jamais d'attente réelle en test)."""
    await asyncio.sleep(seconds)


def _url(base: str, slug: str, player_id: str, server: str | None) -> str:
    """URL de l'endpoint, chaque segment percent-encodé (`#`, espaces, caractères spéciaux)."""
    path = f"/game-id-checker/{quote(slug, safe='')}/{quote(player_id, safe='')}"
    if server:
        path += f"/{quote(server, safe='')}"
    return f"{base}{path}"


def _unavailable_reason(message: str) -> str:
    """Catégorie sûre (sans ID ni pseudo) d'une indisponibilité annoncée par le fournisseur."""
    text = (message or "").lower()
    if "x-api-key" in text or "authentication" in text:
        return "auth"
    if "active subscription" in text:
        return "subscription"
    if "daily limit" in text:
        return "quota"
    if "maintenance" in text:
        return "maintenance"
    return "unavailable"


def _daily_limit_announced(response: httpx.Response) -> bool:
    """Vrai si une réponse 429 annonce le quota JOURNALIER, et non une limite de débit.

    Un 429 peut être momentané (trop de requêtes à la seconde) : seule la mention explicite
    « daily limit » justifie de fermer Neferbyte jusqu'à 00:00 UTC. Le corps n'est jamais logué
    et une charge utile illisible vaut « pas d'indication » (donc pas de fermeture du jour).
    """
    try:
        payload = response.json()
    except (ValueError, httpx.HTTPError):
        return False
    if not isinstance(payload, dict):
        return False
    message = payload.get("msg")
    return isinstance(message, str) and "daily limit" in message.lower()


def _classify_error_message(message: str | None) -> tuple[str, str]:
    """(statut, raison) d'un message d'erreur Neferbyte. Tout l'inconnu est `provider_unavailable`."""
    text = (message or "").strip().lower()
    if any(marker in text for marker in _NOT_FOUND_MARKERS):
        return INVALID_ID, "not_found"
    if any(marker in text for marker in _INVALID_ENTRY_MARKERS):
        return INVALID_ID, "invalid_entry"
    if any(marker in text for marker in _UNAVAILABLE_MARKERS):
        return PROVIDER_UNAVAILABLE, _unavailable_reason(text)
    return PROVIDER_UNAVAILABLE, "unknown_error"


def _read_payload(spec: GameSpec, payload: dict) -> IdentityCheck:
    """Traduit le corps Neferbyte. Branche sur `success`, jamais sur le seul statut HTTP."""
    if payload.get("success") is True:
        data = payload.get("data")
        if not isinstance(data, dict):
            return IdentityCheck(status=PROVIDER_UNAVAILABLE, reason="invalid_payload")
        username = data.get("username")
        if not isinstance(username, str) or not username.strip():
            # Succès annoncé sans pseudo : jamais validé par défaut (fail-closed).
            return IdentityCheck(status=PROVIDER_UNAVAILABLE, reason="missing_username")
        region = None
        if spec.returns_region:
            candidate = data.get("region") or data.get("server")
            region = candidate.strip() if isinstance(candidate, str) and candidate.strip() else None
        is_ban = data.get("is_ban") if spec.returns_is_ban else None
        if not isinstance(is_ban, bool):
            is_ban = None
        return IdentityCheck(status=OK, player_name=username.strip(), region=region,
                             is_ban=is_ban, raw=data)
    if payload.get("error") is True:
        status, reason = _classify_error_message(payload.get("msg"))
        return IdentityCheck(status=status, reason=reason)
    return IdentityCheck(status=PROVIDER_UNAVAILABLE, reason="unexpected_payload")


async def verify_identity(slug: str, player_id: str | None, server: str | None = None) -> IdentityCheck:
    """Vérifie une identité joueur chez Neferbyte. Ne lève jamais : renvoie un `IdentityCheck`.

    `player_id` est le premier segment d'identifiant (`{id}` ou `{name}` pour Valorant) ; `server`
    le second segment quand le jeu en exige un (`{server}` ou `{tag}`). Aucun repli silencieux :
    une incohérence avec le catalogue est détectée AVANT l'appel (`config_error`).
    """
    spec = game_spec(slug)
    if spec is None:
        logger.warning("neferbyte: slug inconnu du catalogue (aucun appel)")
        return IdentityCheck(status=CONFIG_ERROR, reason="unknown_slug")

    ident = (player_id or "").strip()
    if not ident:
        return IdentityCheck(status=CONFIG_ERROR, reason="missing_id")
    second = (server or "").strip()
    if spec.needs_server and not second:
        return IdentityCheck(status=CONFIG_ERROR, reason="missing_server")
    if second and not spec.needs_server:
        return IdentityCheck(status=CONFIG_ERROR, reason="unexpected_server")

    base, key = _config()
    if not key:
        logger.warning("neferbyte %s: clé API absente (service non configuré)", spec.slug)
        return IdentityCheck(status=PROVIDER_UNAVAILABLE, reason="not_configured")

    url = _url(base, spec.slug, ident, second if spec.needs_server else None)
    headers = {"x-api-key": key}
    timeout = _timeout()

    result: IdentityCheck | None = None
    for attempt in (1, 2):
        # Comptage/plafond AVANT chaque requête : aucune requête ne part sans être comptée, et un
        # refus du hook (plafond atteint) empêche l'appel. Un hook en erreur bloque (fail-closed).
        hook = _attempt_hook.get()
        if hook is not None:
            try:
                allowed = await hook()
            except Exception:  # pragma: no cover - le hook gère ses propres erreurs
                allowed = False
            if not allowed:
                logger.warning("neferbyte %s: appel bloqué par la protection du quota", spec.slug)
                return IdentityCheck(status=PROVIDER_UNAVAILABLE, reason="quota_guard")
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.get(url, headers=headers)
        except httpx.TimeoutException:
            if attempt == 1:
                await _sleep(RETRY_DELAY_S)
                continue
            logger.warning("neferbyte %s: timeout", spec.slug)
            return IdentityCheck(status=TIMEOUT, reason="timeout")
        except httpx.HTTPError:
            if attempt == 1:
                await _sleep(RETRY_DELAY_S)
                continue
            logger.warning("neferbyte %s: erreur réseau", spec.slug)
            return IdentityCheck(status=PROVIDER_UNAVAILABLE, reason="network")

        if response.status_code >= 500:
            if attempt == 1:
                await _sleep(RETRY_DELAY_S)
                continue
            logger.warning("neferbyte %s: erreur serveur (%s)", spec.slug, response.status_code)
            return IdentityCheck(status=PROVIDER_UNAVAILABLE, reason="server_error")

        if response.status_code in (401, 403):
            logger.warning("neferbyte %s: authentification refusée", spec.slug)
            return IdentityCheck(status=PROVIDER_UNAVAILABLE, reason="auth")
        if response.status_code == 429:
            # Seul un 429 qui annonce explicitement le quota du jour ferme la journée côté garde.
            # Une limite de débit momentanée reste `provider_unavailable` sans nouvel essai
            # immédiat, mais ne coupe pas Neferbyte jusqu'à 00:00 UTC.
            if _daily_limit_announced(response):
                logger.warning("neferbyte %s: quota journalier atteint", spec.slug)
                return IdentityCheck(status=PROVIDER_UNAVAILABLE, reason="quota")
            logger.warning("neferbyte %s: limite de débit momentanée (429)", spec.slug)
            return IdentityCheck(status=PROVIDER_UNAVAILABLE, reason="rate_limited")

        try:
            payload = response.json()
        except ValueError:
            logger.warning("neferbyte %s: réponse non JSON", spec.slug)
            return IdentityCheck(status=PROVIDER_UNAVAILABLE, reason="invalid_json")
        if not isinstance(payload, dict):
            logger.warning("neferbyte %s: charge utile inattendue", spec.slug)
            return IdentityCheck(status=PROVIDER_UNAVAILABLE, reason="invalid_payload")

        result = _read_payload(spec, payload)
        # « Can't find a username » peut venir d'une limitation en amont : un seul nouvel essai.
        # Quota, authentification et maintenance ne sont JAMAIS réessayés.
        if result.status == INVALID_ID and result.reason == "not_found" and attempt == 1:
            await _sleep(RETRY_DELAY_S)
            continue
        if result.status != OK:
            logger.info("neferbyte %s: %s (%s)", spec.slug, result.status, result.reason)
        return result

    return result or IdentityCheck(status=PROVIDER_UNAVAILABLE, reason="unavailable")


__all__ = [
    "CONFIG_ERROR", "DEFAULT_BASE_URL", "DEFAULT_TIMEOUT_S", "GAMES", "GameSpec", "INVALID_ID",
    "IdentityCheck", "OK", "PROVIDER_UNAVAILABLE", "RETRY_DELAY_S", "TIMEOUT", "configured",
    "game_spec", "reset_attempt_hook", "set_attempt_hook", "verify_identity",
]
