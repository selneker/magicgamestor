#!/usr/bin/env python3
"""Test de fumée — vérification d'identité joueur (Free Fire / PUBG Mobile).

MODE D'EMPLOI (lis tout avant de lancer)
========================================

Ce script interroge UNIQUEMENT les deux routes de validation d'identité :

    POST /fazercards/validate-id        (générique, multi-jeux)
    POST /fazercards/pubg/validate-id   (compat historique PUBG Mobile)

Il est en LECTURE SEULE : aucune commande n'est créée, aucun paiement ni top-up n'est déclenché.

1) Backend local démarré (port 8001 par défaut), puis :

       export SMOKE_PUBG_ID='<ton_id_pubg>'          # cas 1, 2 et 6
       export SMOKE_FF_ID='<ton_id_free_fire>'       # cas 3, 4 et 5
       # export SMOKE_FF_SERVER='<ta_zone>'          # seulement si le jeu a un 2e champ (ex. zone)
       python backend/scripts/smoke_identity.py

   Un cas dont la variable manque est SAUTÉ (message explicite), pas considéré comme un échec.

2) Backend non local : refusé par défaut. Pour l'autoriser, confirme-le explicitement :

       SMOKE_ALLOW_REMOTE=1 SMOKE_BASE_URL='https://<mon-backend>' python backend/scripts/smoke_identity.py

3) La limitation de débit s'applique AVANT l'appel au fournisseur : 30 requêtes / 10 min par IP
   (FZR_VALIDATE_PER_10MIN_PER_IP). Ce script envoie au plus 12 requêtes — 6 dans le cas nominal.
   Ne le lance pas en boucle.

4) Sortie : un tableau (cas / attendu / obtenu / OK-ÉCHEC / durée en ms), un bilan, et un code de
   sortie ≠ 0 en cas d'échec. Les IDs sont masqués (****1234) et les pseudos aussi (Ps***).
   En cas d'échec, seuls le code HTTP et `code`/`detail` sont affichés — jamais le corps brut.

VARIABLES D'ENVIRONNEMENT (aucune valeur n'est codée en dur)

    SMOKE_BASE_URL           défaut http://localhost:8001
    SMOKE_PUBG_ID            ID PUBG Mobile valide (ton compte)
    SMOKE_FF_ID              ID Free Fire valide (ton compte)
    SMOKE_FF_SERVER          valeur du 2e champ d'identité de Free Fire, si le jeu en déclare un
    SMOKE_FF_FIELD           clé du champ identifiant Free Fire      (défaut player_id)
    SMOKE_FF_SERVER_FIELD    clé du 2e champ d'identité Free Fire    (défaut zone_id)
    SMOKE_FF_GAME_ID         défaut free-fire
    SMOKE_PUBG_GAME_ID       défaut pubg-mobile
    SMOKE_ALLOW_REMOTE       1 pour autoriser une URL non locale

CAS (un appel chacun, dans cet ordre)

    1  PUBG Mobile, ID valide ............ 200, valid:true, pseudo non vide
    2  PUBG Mobile, ID invalide .......... valid:false, jamais 5xx
    3  Free Fire, ID valide .............. 200, valid:true, pseudo non vide
    4  Free Fire, ID invalide ............ valid:false, jamais 5xx
    5  Free Fire, champ requis absent .... erreur cliente, jamais 5xx ni valid:true
    6  Route historique PUBG ............. même résultat que le cas 1
    7  Contrôle de fuite (0 requête) ..... aucun `identity_verifier`, clé API, ni `reason`

Codes de sortie : 0 = tout est OK, 1 = au moins un échec, 2 = configuration refusée.
"""
from __future__ import annotations

import json
import os
import random
import sys
import time
from dataclasses import dataclass
from typing import Any, Callable, Mapping
from urllib.parse import urlsplit

import httpx

GENERIC_ROUTE = "/fazercards/validate-id"
LEGACY_PUBG_ROUTE = "/fazercards/pubg/validate-id"
ALLOWED_ROUTES = (GENERIC_ROUTE, LEGACY_PUBG_ROUTE)

DEFAULT_BASE_URL = "http://localhost:8001"
DEFAULT_PUBG_GAME_ID = "pubg-mobile"
DEFAULT_FF_GAME_ID = "free-fire"
DEFAULT_FF_FIELD = "player_id"
DEFAULT_FF_SERVER_FIELD = "zone_id"

# Limite de débit des routes de validation (core/ratelimit.py, avant le fournisseur).
RATE_LIMIT_REQUESTS = 30
RATE_LIMIT_WINDOW_MINUTES = 10
# Plafond dur : le script n'envoie jamais plus de 12 requêtes, quoi qu'il arrive.
MAX_REQUESTS = 12
TIMEOUT_S = 20.0

# Marqueurs de fuite interdits dans une réponse de validation.
LEAK_MARKERS = ("identity_verifier", "api_key", "api_secret", "neferbyte")

HEADERS = ("Cas", "Attendu", "Obtenu", "État", "Durée")


# --------------------------------------------------------------------------- #
# Masquage — aucune valeur complète (ID, pseudo) ne doit atteindre la sortie.
# --------------------------------------------------------------------------- #
def mask_id(value: str | None) -> str:
    """Masque un identifiant : 4 derniers caractères au plus (ex. `****1234`)."""
    if not value:
        return "—"
    if len(value) <= 4:
        return "*" * len(value)
    return "****" + value[-4:]


def mask_name(value: Any) -> str:
    """Masque un pseudo : 2 premiers caractères puis `***` (ex. `Ps***`)."""
    if not isinstance(value, str) or not value.strip():
        return "—"
    text = value.strip()
    return text[:2] + "***" if len(text) > 2 else "***"


def _safe_detail(detail: Any, secrets: list[str]) -> str:
    """Rend un `detail` affichable : texte court, jamais la valeur soumise.

    Les erreurs de validation Pydantic portent la saisie dans `input` : on n'affiche que `msg`.
    """
    if detail is None:
        return ""
    if isinstance(detail, str):
        text = detail
    elif isinstance(detail, list):
        parts = [str(item.get("msg") or "") for item in detail if isinstance(item, dict)]
        text = " ; ".join(part for part in parts if part) or "détail structuré"
    else:
        return "détail non textuel"
    for secret in secrets:
        if secret and secret in text:
            text = text.replace(secret, mask_id(secret))
    return text[:120]


# --------------------------------------------------------------------------- #
# Configuration (tout vient de l'environnement)
# --------------------------------------------------------------------------- #
class ConfigError(ValueError):
    """Configuration inutilisable : le script refuse de démarrer."""


@dataclass(frozen=True)
class Config:
    base_url: str
    allow_remote: bool = False
    pubg_id: str | None = None
    ff_id: str | None = None
    ff_server: str | None = None
    ff_field: str = DEFAULT_FF_FIELD
    ff_server_field: str = DEFAULT_FF_SERVER_FIELD
    pubg_game_id: str = DEFAULT_PUBG_GAME_ID
    ff_game_id: str = DEFAULT_FF_GAME_ID

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "Config":
        """Construit la configuration ; lève `ConfigError` si l'URL cible est refusée."""
        base_url = _clean(env.get("SMOKE_BASE_URL")) or DEFAULT_BASE_URL
        allow_remote = _clean(env.get("SMOKE_ALLOW_REMOTE")) == "1"
        _check_base_url(base_url, allow_remote)
        return cls(
            base_url=base_url.rstrip("/"),
            allow_remote=allow_remote,
            pubg_id=_clean(env.get("SMOKE_PUBG_ID")),
            ff_id=_clean(env.get("SMOKE_FF_ID")),
            ff_server=_clean(env.get("SMOKE_FF_SERVER")),
            ff_field=_clean(env.get("SMOKE_FF_FIELD")) or DEFAULT_FF_FIELD,
            ff_server_field=_clean(env.get("SMOKE_FF_SERVER_FIELD")) or DEFAULT_FF_SERVER_FIELD,
            pubg_game_id=_clean(env.get("SMOKE_PUBG_GAME_ID")) or DEFAULT_PUBG_GAME_ID,
            ff_game_id=_clean(env.get("SMOKE_FF_GAME_ID")) or DEFAULT_FF_GAME_ID,
        )

    @property
    def target(self) -> str:
        """Origine affichable de la cible (sans chemin, sans requête)."""
        parts = urlsplit(self.base_url)
        port = f":{parts.port}" if parts.port else ""
        return f"{parts.scheme}://{parts.hostname or '?'}{port}"

    @property
    def secrets(self) -> list[str]:
        """Valeurs à masquer dans les messages d'erreur du backend."""
        return [value for value in (self.pubg_id, self.ff_id, self.ff_server) if value]


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


def _is_local_host(host: str | None) -> bool:
    if not host:
        return False
    host = host.lower()
    return host == "localhost" or host == "::1" or host.startswith("127.")


def _check_base_url(base_url: str, allow_remote: bool) -> None:
    """Refuse une URL non locale, sauf autorisation explicite `SMOKE_ALLOW_REMOTE=1`."""
    parts = urlsplit(base_url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ConfigError(f"SMOKE_BASE_URL invalide : {base_url!r} (attendu http(s)://hôte[:port]).")
    if not _is_local_host(parts.hostname) and not allow_remote:
        raise ConfigError(
            "SMOKE_BASE_URL n'est pas locale : refusé. Définis SMOKE_ALLOW_REMOTE=1 pour "
            "confirmer explicitement que tu vises un backend distant.")


# --------------------------------------------------------------------------- #
# Résultat d'un cas
# --------------------------------------------------------------------------- #
@dataclass
class Row:
    case: str
    expected: str
    obtained: str = ""
    ok: bool = False
    skipped: bool = False
    duration_ms: int | None = None

    @property
    def state(self) -> str:
        if self.skipped:
            return "SAUTÉ"
        return "OK" if self.ok else "ÉCHEC"


@dataclass(frozen=True)
class Case:
    number: str
    title: str
    expected: str
    route: str
    payload: dict
    check: Callable[[int, dict], tuple[bool, str]]
    skip_reason: str | None = None


class BudgetExceeded(RuntimeError):
    """Le plafond de requêtes du script a été atteint (garde-fou, ne doit pas arriver)."""


# --------------------------------------------------------------------------- #
# Vérifications de chaque cas
# --------------------------------------------------------------------------- #
def _json_body(response: httpx.Response) -> dict:
    try:
        data = response.json()
    except (ValueError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _flag(value: Any) -> str:
    if value is True:
        return "true"
    if value is False:
        return "false"
    return "absent"


def check_valid(status: int, body: dict) -> tuple[bool, str]:
    """Cas 1, 3 et 6 : 200, `valid:true` et un pseudo non vide."""
    name = body.get("player_name")
    if status >= 500:
        return False, f"HTTP {status} (erreur serveur), code={body.get('code') or '—'}"
    ok = status == 200 and body.get("valid") is True and isinstance(name, str) and bool(name.strip())
    return ok, f"HTTP {status}, valid={_flag(body.get('valid'))}, pseudo {mask_name(name)}"


def check_invalid(status: int, body: dict) -> tuple[bool, str]:
    """Cas 2 et 4 : identifiant refusé, jamais 5xx ni `valid:true`."""
    code = body.get("code") or "—"
    if status >= 500:
        return False, f"HTTP {status} (erreur serveur), code={code}"
    if status == 200:
        return body.get("valid") is False, f"HTTP 200, valid={_flag(body.get('valid'))}, code={code}"
    return 400 <= status < 500, f"HTTP {status} (refus client), code={code}"


def check_missing_field(status: int, body: dict) -> tuple[bool, str]:
    """Cas 5 : champ requis absent → erreur cliente claire, jamais 5xx ni `valid:true`."""
    code = body.get("code") or "—"
    if status >= 500:
        return False, f"HTTP {status} (erreur serveur), code={code}"
    if status == 200:
        ok = body.get("valid") is not True and code == "missing_field"
        return ok, f"HTTP 200, valid={_flag(body.get('valid'))}, code={code}"
    return 400 <= status < 500, f"HTTP {status} (refus client), code={code}"


def _invalid_numeric_id(digits: int) -> str:
    """Identifiant numérique improbable, de la longueur attendue par le fournisseur."""
    generator = random.SystemRandom()
    return str(generator.randrange(10 ** (digits - 1), 10**digits))


def _has_key(node: Any, key: str) -> bool:
    if isinstance(node, dict):
        return key in node or any(_has_key(value, key) for value in node.values())
    if isinstance(node, list):
        return any(_has_key(value, key) for value in node)
    return False


def find_leaks(response: httpx.Response) -> list[str]:
    """Marqueurs interdits présents dans une réponse (texte brut et clé `reason`)."""
    found: list[str] = []
    text = (response.text or "").lower()
    for marker in LEAK_MARKERS:
        if marker in text:
            found.append(marker)
    try:
        body: Any = response.json()
    except ValueError:
        body = None
    if _has_key(body, "reason") and "reason" not in found:
        found.append("reason")
    return found


# --------------------------------------------------------------------------- #
# Exécution
# --------------------------------------------------------------------------- #
class Smoke:
    """Enchaîne les cas, compte les requêtes et met en forme le tableau."""

    def __init__(self, config: Config, client: httpx.Client, out: Any = None) -> None:
        self.config = config
        self.client = client
        self.out = out or sys.stdout
        self.sent = 0
        self.responses: list[tuple[str, httpx.Response]] = []

    # -- transport -------------------------------------------------------- #
    def _post(self, route: str, payload: dict) -> tuple[httpx.Response, int]:
        if route not in ALLOWED_ROUTES:
            raise ValueError(f"route hors périmètre (lecture seule) : {route}")
        if self.sent >= MAX_REQUESTS:
            raise BudgetExceeded(f"plafond de {MAX_REQUESTS} requêtes atteint")
        self.sent += 1
        started = time.perf_counter()
        response = self.client.post(route, json=payload)
        duration_ms = int(round((time.perf_counter() - started) * 1000))
        return response, duration_ms

    # -- cas -------------------------------------------------------------- #
    def _ff_fields(self, ff_id: str | None) -> dict:
        fields = {self.config.ff_field: ff_id or ""}
        if self.config.ff_server:
            fields[self.config.ff_server_field] = self.config.ff_server
        return fields

    def _cases(self) -> list[Case]:
        cfg = self.config
        pubg_skip = None if cfg.pubg_id else "SMOKE_PUBG_ID absent"
        ff_skip = None if cfg.ff_id else "SMOKE_FF_ID absent"
        pubg_fields = {"player_id": cfg.pubg_id or ""}
        ff_missing_fields = (
            {cfg.ff_server_field: cfg.ff_server} if cfg.ff_server else {}
        )
        return [
            Case("1", "PUBG Mobile — ID valide",
                 "200, valid:true, pseudo non vide",
                 GENERIC_ROUTE,
                 {"game_id": cfg.pubg_game_id, "fields": pubg_fields},
                 check_valid, pubg_skip),
            Case("2", "PUBG Mobile — ID invalide",
                 "valid:false, jamais 5xx",
                 GENERIC_ROUTE,
                 {"game_id": cfg.pubg_game_id, "fields": {"player_id": _invalid_numeric_id(13)}},
                 check_invalid, pubg_skip),
            Case("3", "Free Fire — ID valide",
                 "200, valid:true, pseudo non vide",
                 GENERIC_ROUTE,
                 {"game_id": cfg.ff_game_id, "fields": self._ff_fields(cfg.ff_id)},
                 check_valid, ff_skip),
            Case("4", "Free Fire — ID invalide",
                 "valid:false, jamais 5xx",
                 GENERIC_ROUTE,
                 {"game_id": cfg.ff_game_id, "fields": {cfg.ff_field: _invalid_numeric_id(10)}},
                 check_invalid, ff_skip),
            Case("5", "Free Fire — champ requis absent",
                 "erreur cliente, jamais 5xx ni valid:true",
                 GENERIC_ROUTE,
                 {"game_id": cfg.ff_game_id, "fields": ff_missing_fields},
                 check_missing_field, ff_skip),
            Case("6", "Route historique PUBG — ID valide",
                 "même résultat que le cas 1 (200, valid:true)",
                 LEGACY_PUBG_ROUTE,
                 {"player_id": cfg.pubg_id or ""},
                 check_valid, pubg_skip),
        ]

    def _label(self, case: Case) -> str:
        return f"{case.number}. {case.title}"

    def _execute(self, case: Case) -> Row:
        label = self._label(case)
        if case.skip_reason:
            return Row(label, case.expected, f"sauté — {case.skip_reason}", skipped=True)
        try:
            response, duration_ms = self._post(case.route, case.payload)
        except BudgetExceeded as exc:
            return Row(label, case.expected, f"non exécuté — {exc}")
        body = _json_body(response)
        self.responses.append((label, response))
        ok, obtained = case.check(response.status_code, body)
        detail = _safe_detail(body.get("detail"), self.config.secrets)
        if detail and (not ok or response.status_code >= 400):
            obtained = f"{obtained} — {detail}"
        return Row(label, case.expected, obtained, ok=ok, duration_ms=duration_ms)

    def _leak_row(self) -> Row:
        label = "7. Contrôle de fuite (toutes les réponses)"
        expected = "aucun identity_verifier, clé API, ni champ interne reason"
        if not self.responses:
            return Row(label, expected, "sauté — aucune réponse collectée", skipped=True)
        leaks: list[str] = []
        for case_label, response in self.responses:
            for marker in find_leaks(response):
                entry = f"{marker} ({case_label.split('.', 1)[0]})"
                if entry not in leaks:
                    leaks.append(entry)
        if leaks:
            return Row(label, expected, "fuite : " + ", ".join(leaks))
        return Row(label, expected, f"aucune fuite sur {len(self.responses)} réponse(s)", ok=True)

    # -- sortie ----------------------------------------------------------- #
    def _write(self, text: str = "") -> None:
        print(text, file=self.out)

    def _banner(self) -> None:
        self._write(f"Cible        : {self.config.target}"
                    f"{' (distant, autorisé)' if self.config.allow_remote else ''}")
        self._write(f"Jeux         : PUBG Mobile={self.config.pubg_game_id} · "
                    f"Free Fire={self.config.ff_game_id}")
        self._write(f"Identifiants : PUBG {mask_id(self.config.pubg_id)} · "
                    f"Free Fire {mask_id(self.config.ff_id)}")
        self._write("Lecture seule : uniquement les routes de validation d'identité.")
        self._write(f"Débit        : limite {RATE_LIMIT_REQUESTS} requêtes / "
                    f"{RATE_LIMIT_WINDOW_MINUTES} min par IP — ce script envoie au plus "
                    f"{MAX_REQUESTS} requêtes.")
        self._write()

    def _table(self, rows: list[Row]) -> None:
        cells = [(row.case, row.expected, row.obtained, row.state,
                  f"{row.duration_ms} ms" if row.duration_ms is not None else "—") for row in rows]
        widths = [max(len(HEADERS[i]), *(len(line[i]) for line in cells)) if cells
                  else len(HEADERS[i]) for i in range(len(HEADERS))]
        line = "  ".join(header.ljust(widths[i]) for i, header in enumerate(HEADERS))
        self._write(line.rstrip())
        self._write("  ".join("-" * width for width in widths))
        for row in cells:
            self._write("  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)).rstrip())

    def run(self) -> int:
        self._banner()
        rows = [self._execute(case) for case in self._cases()]
        rows.append(self._leak_row())
        self._table(rows)
        self._write()
        failed = [row for row in rows if not row.ok and not row.skipped]
        skipped = [row for row in rows if row.skipped]
        passed = [row for row in rows if row.ok]
        self._write(f"Bilan : {len(passed)} OK, {len(failed)} échec(s), {len(skipped)} sauté(s) — "
                    f"{self.sent} requête(s) envoyée(s) sur {MAX_REQUESTS} autorisées.")
        if skipped:
            self._write("Sauté(s) : " + ", ".join(row.case.split(".", 1)[0] for row in skipped))
        if failed:
            self._write("ÉCHEC : " + ", ".join(row.case for row in failed))
            return 1
        self._write("Résultat : tous les cas exécutés sont conformes.")
        return 0


def main(env: Mapping[str, str] | None = None, transport: httpx.BaseTransport | None = None,
         out: Any = None) -> int:
    """Point d'entrée testable : `env` et `transport` sont injectables (aucun réseau en test)."""
    stream = out or sys.stdout
    try:
        config = Config.from_env(os.environ if env is None else env)
    except ConfigError as exc:
        print(f"ERREUR DE CONFIGURATION : {exc}", file=sys.stderr)
        return 2
    with httpx.Client(base_url=config.base_url, timeout=TIMEOUT_S, transport=transport) as client:
        return Smoke(config, client, stream).run()


if __name__ == "__main__":
    sys.exit(main())
