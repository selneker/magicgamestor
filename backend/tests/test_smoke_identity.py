"""Tests du script de fumée d'identité — `backend/scripts/smoke_identity.py` (PL-003-SMOKE-1).

Aucun réseau, aucun backend, aucun Mongo : toutes les réponses HTTP sont simulées par un
`httpx.MockTransport` en mémoire. Les identifiants utilisés ici sont des valeurs de test
inventées, jamais des comptes réels.

Ce qui est vérifié :

- refus d'une URL non locale sans `SMOKE_ALLOW_REMOTE=1` (aucune requête émise) ;
- saut explicite des cas dont la variable d'environnement manque ;
- masquage des IDs (4 derniers caractères au plus) et des pseudos (2 caractères + `***`) ;
- plafond dur de 12 requêtes, et budget réel de 6 requêtes pour le cas nominal ;
- code de sortie non nul en cas d'échec ;
- lecture seule : aucune requête hors des deux routes de validation, aucune création de commande ;
- **PL-003-BE-9** : les ID invalides sont FIXES (`000000001`, jamais tirés au hasard), un 404,
  un 405 ou un 5xx n'est JAMAIS un « refus client » accepté, `provider_unavailable` fait échouer
  les cas 2 et 4, et un échec de configuration est signalé comme tel dans la sortie.
"""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import sys
from pathlib import Path

import httpx
import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "smoke_identity.py"

PUBG_ID = "100000001"          # valeur de test, jamais un compte réel
FF_ID = "200000002"
PUBG_NAME = "PseudoPubgTest"
FF_NAME = "PseudoFreeFireTest"

BASE_ENV = {
    "SMOKE_BASE_URL": "http://127.0.0.1:8001",
    "SMOKE_PUBG_ID": PUBG_ID,
    "SMOKE_FF_ID": FF_ID,
}


@pytest.fixture(scope="module")
def smoke():
    """Charge le script comme un module (il n'est pas un paquet importable)."""
    spec = importlib.util.spec_from_file_location("smoke_identity_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    # `sys.modules` d'abord : les dataclasses annotées (PEP 563) le consultent à la définition.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _json(request: httpx.Request) -> dict:
    return json.loads(request.content or b"{}")


def happy_handler(request: httpx.Request) -> httpx.Response:
    """Backend simulé conforme : un ID connu valide, tout autre est refusé."""
    body = _json(request)
    if request.url.path == "/fazercards/pubg/validate-id":
        fields = {"player_id": body.get("player_id")}
        return httpx.Response(200, json={"valid": True, "player_name": PUBG_NAME, "region": "ID"})
    fields = body.get("fields") or {}
    game_id = body.get("game_id")
    if not fields:
        return httpx.Response(422, json={"detail": [{
            "type": "value_error", "loc": ["body", "fields"],
            "msg": "Value error, 1 à 10 champs d'identité requis.", "input": {},
        }]})
    if game_id == "pubg-mobile":
        if fields.get("player_id") == PUBG_ID:
            return httpx.Response(200, json={"valid": True, "player_name": PUBG_NAME,
                                             "region": "ID", "game_id": game_id})
        return httpx.Response(200, json={"valid": False, "message": "ID PUBG Mobile invalide",
                                         "code": "invalid_id", "game_id": game_id})
    if fields.get("player_id") == FF_ID:
        return httpx.Response(200, json={"valid": True, "player_name": FF_NAME,
                                         "region": "SG", "game_id": game_id})
    return httpx.Response(200, json={"valid": False,
                                     "message": "Identifiant joueur invalide pour ce jeu.",
                                     "code": "invalid_id", "game_id": game_id})


def run(smoke, handler, env: dict | None = None) -> tuple[int, str, str, list[httpx.Request]]:
    """Exécute le script hors réseau et retourne (code, stdout, stderr, requêtes émises)."""
    seen: list[httpx.Request] = []

    def recording(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stderr(err):
        code = smoke.main(env=BASE_ENV if env is None else env,
                          transport=httpx.MockTransport(recording), out=out)
    return code, out.getvalue(), err.getvalue(), seen


# --------------------------------------------------------------------------- #
# Garde-fou d'URL
# --------------------------------------------------------------------------- #
def test_refuse_une_url_non_locale(smoke):
    env = {**BASE_ENV, "SMOKE_BASE_URL": "http://backend.exemple.test:8001"}

    code, out, err, seen = run(smoke, happy_handler, env)

    assert code == 2
    assert seen == []                      # refus AVANT toute requête
    assert "SMOKE_ALLOW_REMOTE" in err
    assert "backend.exemple.test" not in out


def test_autorise_une_url_distante_si_confirmee(smoke):
    env = {**BASE_ENV, "SMOKE_BASE_URL": "http://backend.exemple.test:8001",
           "SMOKE_ALLOW_REMOTE": "1"}

    code, out, _err, seen = run(smoke, happy_handler, env)

    assert code == 0
    assert seen and all(str(r.url.host) == "backend.exemple.test" for r in seen)
    assert "autorisé" in out


def test_refuse_une_url_sans_schema_http(smoke):
    code, _out, err, seen = run(smoke, happy_handler, {**BASE_ENV, "SMOKE_BASE_URL": "ftp://x"})

    assert code == 2
    assert seen == []
    assert "SMOKE_BASE_URL invalide" in err


# --------------------------------------------------------------------------- #
# Cas sautés
# --------------------------------------------------------------------------- #
def test_saute_les_cas_sans_identifiant(smoke):
    env = {k: v for k, v in BASE_ENV.items() if k != "SMOKE_FF_ID"}

    code, out, _err, seen = run(smoke, happy_handler, env)

    assert code == 0                       # un cas sauté n'est pas un échec
    assert "SAUTÉ" in out and "SMOKE_FF_ID absent" in out
    assert len(seen) == 3                  # cas 1, 2 et 6 seulement


def test_saute_tout_si_aucun_identifiant(smoke):
    code, out, _err, seen = run(smoke, happy_handler, {k: BASE_ENV[k] for k in ("SMOKE_BASE_URL",)})

    assert code == 0
    assert seen == []
    assert "SMOKE_PUBG_ID absent" in out
    assert "sauté — aucune réponse collectée" in out


# --------------------------------------------------------------------------- #
# Masquage
# --------------------------------------------------------------------------- #
def test_masque_les_identifiants_et_les_pseudos(smoke):
    code, out, _err, _seen = run(smoke, happy_handler)

    assert code == 0
    assert PUBG_ID not in out and FF_ID not in out
    assert PUBG_NAME not in out and FF_NAME not in out
    assert "****" + PUBG_ID[-4:] in out
    assert "****" + FF_ID[-4:] in out
    assert "Ps***" in out


def test_masque_un_identifiant_cite_dans_un_message_derreur(smoke):
    def echoing_handler(request: httpx.Request) -> httpx.Response:
        body = _json(request)
        fields = body.get("fields") or {}
        value = next(iter(fields.values()), "")
        return httpx.Response(422, json={"detail": [{
            "type": "value_error", "loc": ["body", "fields"],
            "msg": f"Valeur refusée : {value}", "input": fields,
        }]})

    code, out, _err, _seen = run(smoke, echoing_handler)

    assert code == 1
    assert PUBG_ID not in out and FF_ID not in out   # le `detail` est masqué
    assert len(PUBG_ID) > 4 and PUBG_ID[-4:] in out


def test_fonctions_de_masquage(smoke):
    assert smoke.mask_id(PUBG_ID) == "****0001"
    assert smoke.mask_id(None) == "—"
    assert smoke.mask_id("1234") == "****"
    assert smoke.mask_name(PUBG_NAME) == "Ps***"
    assert smoke.mask_name("") == "—"
    assert smoke.mask_name(None) == "—"


# --------------------------------------------------------------------------- #
# Budget de requêtes
# --------------------------------------------------------------------------- #
def test_plafond_dur_de_douze_requetes(smoke):
    assert smoke.MAX_REQUESTS == 12


def test_bloque_au_dela_du_plafond(smoke, monkeypatch):
    monkeypatch.setattr(smoke, "MAX_REQUESTS", 2)

    code, out, _err, seen = run(smoke, happy_handler)

    assert code == 1
    assert len(seen) == 2                  # jamais plus que le plafond
    assert out.count("non exécuté") == 4
    assert "plafond de 2 requêtes atteint" in out


def test_cas_nominal_envoie_six_requetes(smoke):
    _code, out, _err, seen = run(smoke, happy_handler)

    assert len(seen) == 6
    assert "6 requête(s) envoyée(s) sur 12 autorisées" in out


# --------------------------------------------------------------------------- #
# Lecture seule
# --------------------------------------------------------------------------- #
def test_aucune_requete_hors_des_deux_routes_de_validation(smoke):
    _code, _out, _err, seen = run(smoke, happy_handler)

    allowed = {"/fazercards/validate-id", "/fazercards/pubg/validate-id"}
    assert seen
    assert {request.url.path for request in seen} == allowed
    assert {request.method for request in seen} == {"POST"}
    # Lecture seule : aucun chemin de commande, de paiement ou de top-up.
    forbidden = ("/orders", "/payments", "/topup", "/checkout", "/admin")
    assert not [r for r in seen if any(word in r.url.path for word in forbidden)]


def test_route_hors_perimetre_refusee(smoke):
    config = smoke.Config(base_url="http://127.0.0.1:8001")
    runner = smoke.Smoke(config, client=None, out=io.StringIO())

    with pytest.raises(ValueError, match="hors périmètre"):
        runner._post("/orders", {"game_id": "free-fire"})


# --------------------------------------------------------------------------- #
# Tableau, bilan et code de sortie
# --------------------------------------------------------------------------- #
def test_tableau_complet_des_sept_cas(smoke):
    code, out, _err, _seen = run(smoke, happy_handler)

    assert code == 0
    for number in range(1, 8):
        assert f"{number}. " in out
    assert "Bilan : 7 OK, 0 échec(s), 0 sauté(s)" in out
    assert "tous les cas exécutés sont conformes" in out
    assert "30 requêtes" in out and "10 min" in out   # avertissement de débit


def test_code_de_sortie_non_nul_sur_echec(smoke):
    def refusing_handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/fazercards/pubg/validate-id":
            return httpx.Response(200, json={"valid": True, "player_name": PUBG_NAME, "region": "ID"})
        body = _json(request)
        return httpx.Response(200, json={"valid": False, "message": "refusé",
                                         "code": "invalid_id", "game_id": body.get("game_id")})

    code, out, _err, _seen = run(smoke, refusing_handler)

    assert code == 1
    assert "ÉCHEC" in out
    assert "ÉCHEC : " in out


def test_echec_sur_erreur_serveur(smoke):
    def broken_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"detail": "Service de vérification momentanément "
                                                   "indisponible. Réessayez plus tard.",
                                         "code": "provider_unavailable",
                                         "game_id": "free-fire"})

    code, out, _err, _seen = run(smoke, broken_handler)

    assert code == 1
    assert "HTTP 503" in out
    assert "provider_unavailable" in out
    # Jamais le corps brut : seule la paire code/detail est reprise.
    assert "{" not in out and '"detail"' not in out


# --------------------------------------------------------------------------- #
# PL-003-BE-9 — ID invalides fixes, refus client strict, échec de configuration
# --------------------------------------------------------------------------- #
def test_ids_invalides_fixes_et_jamais_aleatoires(smoke):
    """Les cas 2 et 4 envoient le MÊME ID fixe : un tirage aléatoire peut être un vrai compte."""
    _code, _out, _err, seen = run(smoke, happy_handler)

    payloads = [json.loads(request.content or b"{}") for request in seen]
    invalides = [p for p in payloads
                 if (p.get("fields") or {}).get("player_id") == smoke.INVALID_ID]

    assert smoke.INVALID_ID == "000000001"          # préfixe de zéros : non attribuable
    assert len(invalides) == 2                      # cas 2 (PUBG) et cas 4 (Free Fire)
    assert {p["game_id"] for p in invalides} == {"pubg-mobile", "free-fire"}
    # Aucun identifiant « improbable » de longueur variable n'est plus généré.
    longueurs = {len(p["fields"]["player_id"]) for p in payloads if p.get("fields")}
    assert longueurs <= {len(smoke.INVALID_ID), len(PUBG_ID), len(FF_ID)}


@pytest.mark.parametrize("status", [404, 405, 500, 502, 503, 504])
def test_un_404_un_405_ou_un_5xx_nest_jamais_un_refus_accepte(smoke, status):
    """Avant BE-9, tout 4xx était accepté comme « refus client » : 404 et 405 passaient pour OK."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"detail": "panne", "code": "provider_unavailable"})

    code, out, _err, _seen = run(smoke, handler)

    assert code == 1
    assert f"HTTP {status}" in out
    assert "2. PUBG Mobile — ID invalide" in out.split("ÉCHEC : ", 1)[1]
    assert "4. Free Fire — ID invalide" in out.split("ÉCHEC : ", 1)[1]


def test_provider_unavailable_fait_echouer_les_cas_2_et_4(smoke):
    """Le but des cas 2/4 est de vérifier la traduction « ID invalide », pas une panne."""

    def handler(request: httpx.Request) -> httpx.Response:
        body = _json(request)
        if (body.get("fields") or {}).get("player_id") == smoke.INVALID_ID:
            return httpx.Response(503, json={"detail": "Service de vérification momentanément "
                                                       "indisponible. Réessayez plus tard.",
                                             "code": "provider_unavailable"})
        return happy_handler(request)

    code, out, _err, _seen = run(smoke, handler)

    assert code == 1
    assert ("ÉCHEC : 2. PUBG Mobile — ID invalide, 4. Free Fire — ID invalide"
            in out)


def test_un_echec_de_configuration_est_signale_comme_tel(smoke):
    """404 (route/jeu absent) et 503 « non configuré » ne sont pas des verdicts d'identité."""

    def no_game(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"detail": "Game not found", "code": "unsupported_game"})

    code, out, _err, _seen = run(smoke, no_game)

    assert code == 1
    assert "ÉCHEC DE CONFIGURATION" in out
    assert "FAZERCARDS_API_KEY" in out          # la cause probable est nommée
    assert "aucun verdict d'identité" in out


def test_une_panne_fournisseur_nest_pas_annoncee_comme_configuration(smoke):
    """Un 502 est une panne du fournisseur : le message de configuration serait trompeur."""

    def outage(request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, json={"detail": "Service de vérification momentanément "
                                                   "indisponible. Réessayez plus tard.",
                                         "code": "provider_unavailable"})

    code, out, _err, _seen = run(smoke, outage)

    assert code == 1
    assert "ÉCHEC DE CONFIGURATION" not in out


def test_cas_5_accepte_un_422_de_notre_api(smoke):
    """422 = validation du corps par NOTRE API : c'est un refus client légitime."""
    code, out, _err, _seen = run(smoke, happy_handler)   # happy_handler répond 422 au cas 5

    assert code == 0
    assert "HTTP 422 (refus client de notre API)" in out


def test_cas_5_refuse_un_404(smoke):
    def handler(request: httpx.Request) -> httpx.Response:
        body = _json(request)
        if not (body.get("fields") or {}):
            return httpx.Response(404, json={"detail": "Game not found", "code": "unsupported_game"})
        return happy_handler(request)

    code, out, _err, _seen = run(smoke, handler)

    assert code == 1
    assert "5. Free Fire — champ requis absent" in out.split("ÉCHEC : ", 1)[1]


# --------------------------------------------------------------------------- #
# Contrôle de fuite
# --------------------------------------------------------------------------- #
def test_signale_une_fuite_sans_afficher_le_corps(smoke):
    secret = "sk_test_NE_DOIT_PAS_APPARAITRE"

    def leaking_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"valid": True, "player_name": PUBG_NAME,
                                         "identity_verifier": {"api_key": secret},
                                         "reason": "cache_hit"})

    code, out, _err, _seen = run(smoke, leaking_handler)

    assert code == 1
    assert "identity_verifier" in out and "reason" in out
    assert secret not in out               # le contenu de la réponse n'est jamais recopié


def test_aucune_fuite_dans_les_reponses_conformes(smoke):
    code, out, _err, _seen = run(smoke, happy_handler)

    assert code == 0
    assert "aucune fuite" in out
