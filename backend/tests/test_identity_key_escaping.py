"""PL-003-BE-10 — séparateur échappé dans `identity_key`, portée réelle de `check_evo`.

Deux défauts signalés par la revue PL-003-REV-1 :

1. `identity_key` joignait les valeurs par « | » SANS échappement : deux identités distinctes
   pouvaient produire la même clé (`{"player_id": "a|b", "zone_id": "c"}` et
   `{"player_id": "a", "zone_id": "b|c"}` donnaient toutes deux « a|b|c »), donc la seconde
   commande était refusée à tort comme doublon.
2. `check_evo` ne voit que les verrous `game_id ∈ {pubg-mobile, None}` : il fallait établir si le
   Pack évolutif peut exister pour un autre jeu, ou si ce filtre est la règle.

Contrainte vérifiée ici : pour toute valeur SANS « | » ni « \\ », la clé est STRICTEMENT identique
à celle de l'ancienne fonction (recopiée ci-dessous), donc aucune clé déjà écrite en production
n'est réécrite.

Aucun réseau, aucun Mongo : les collections sont les `FakeCollection` de `tests/test_identity_keys.py`
(index uniques réellement appliqués). Les identifiants sont fictifs.
"""
from __future__ import annotations

import itertools

import pytest
from fastapi import HTTPException

from core import identity_keys as ik
from core.games import DEFAULT_GAME_ID, normalize_product_types
from routers import evo as evo_mod
from test_identity_keys import (  # noqa: F401  (fixtures partagées)
    EVO_PRODUCT, _with_new_indexes, fake_db, make_order, run)

PUBG = DEFAULT_GAME_ID
FREE_FIRE = "free-fire"
ML = "mobile-legends"


def legacy_identity_key(fields: dict | None) -> str:
    """ANCIENNE fonction, recopiée à l'identique : sert de référence avant/après."""
    values = [ik.normalize_identity_value(v) for v in (fields or {}).values() if str(v or "").strip()]
    return "|".join(values)


# --------------------------------------------------------------------------- #
# A. Échappement du séparateur
# --------------------------------------------------------------------------- #
# Lot de valeurs RÉALISTES (formats des jeux connus) : aucune ne contient « | » ni « \ ».
REALISTIC = [
    {"player_id": "52328390220"},                                   # PUBG Mobile
    {"player_id": "123456789"},
    {"player_id": "1234567890123"},
    {"player_id": "12345678", "zone_id": "2214"},                   # Mobile Legends
    {"player_id": "12345678", "zone_id": "0002214"},
    {"player_id": "12345678", "zone_id": "2214", "server": "Asia"},  # jeu à 3 champs
    {"player_id": "123456789"},                                     # Free Fire
    {"player_id": "  Nom#Tag  "},                                   # espaces + casse
    {"player_id": "Nom   #Tag"},
    {"player_id": "１２３45678"},                                     # NFKC pleine largeur
    {"player_id": "0002214"},                                       # zéros initiaux
    {"player_id": "12345678", "zone_id": ""},                       # champ vide ignoré
    {"player_id": "12345678", "zone_id": None},
    {},
    None,
]


@pytest.mark.parametrize("fields", REALISTIC)
def test_cle_inchangee_pour_toute_valeur_sans_separateur(fields):
    """Preuve d'identité avant/après : sans « | » ni « \\ », la clé est EXACTEMENT la même."""
    assert ik.identity_key(fields) == legacy_identity_key(fields)


def test_les_cles_connues_ne_sont_pas_reecrites():
    assert ik.identity_key({"player_id": "52328390220"}) == "52328390220"      # == pubg_id
    assert ik.identity_key({"player_id": "12345678", "zone_id": "2214"}) == "12345678|2214"
    assert ik.identity_key({"player_id": "12345678", "zone_id": "0002214"}) == "12345678|2214"
    assert ik.identity_key({"player_id": " 12345678 ", "zone_id": "2214"}) == "12345678|2214"


def test_deux_identites_differentes_ne_partagent_plus_une_cle():
    """Cas exact de la revue : sans échappement, les deux produisaient « a|b|c »."""
    joined = ik.identity_key({"player_id": "a|b", "zone_id": "c"})
    split = ik.identity_key({"player_id": "a", "zone_id": "b|c"})

    assert joined != split
    assert joined == "a\\|b|c"          # le « | » DE LA VALEUR est échappé
    assert split == "a|b\\|c"           # le « | » de jointure reste nu


def test_backslash_echappe_a_son_tour():
    """« \\ » est échappé en premier, sinon « a\\|b » se lirait comme un séparateur échappé."""
    assert ik.identity_key({"player_id": "a\\b"}) == "a\\\\b"
    assert ik.identity_key({"player_id": "a\\b"}) != ik.identity_key({"player_id": "a", "zone_id": "b"})
    # Valeur contenant un vrai « \| » vs valeur suivante commençant par « | » : clés distinctes.
    assert (ik.identity_key({"player_id": "a\\|b", "zone_id": "c"})
            != ik.identity_key({"player_id": "a", "zone_id": "b|c"}))


def test_valeur_vide_reste_ignoree_meme_avec_echappement():
    assert ik.identity_key({"player_id": "a|b", "zone_id": ""}) == "a\\|b"
    assert ik.identity_key({"player_id": "", "zone_id": ""}) == ""


def test_ordre_des_champs_reste_significatif():
    assert (ik.identity_key({"player_id": "12345678", "zone_id": "2214"})
            != ik.identity_key({"zone_id": "2214", "player_id": "12345678"}))
    assert ik.identity_key({"player_id": "a", "zone_id": "b"}) == "a|b"
    assert ik.identity_key({"zone_id": "b", "player_id": "a"}) == "b|a"


def test_la_jointure_est_injective_sur_un_petit_alphabet():
    """Aucun couple de valeurs distinct ne produit la même clé (recherche exhaustive)."""
    values = ["a", "b", "|", "\\", "a|b", "a\\b", "a\\|b", "\\|", "||", "a||b", "\\a\\"]
    seen: dict[str, tuple] = {}
    for first, second in itertools.product(values, repeat=2):
        key = ik.identity_key({"player_id": first, "zone_id": second})
        assert seen.setdefault(key, (first, second)) == (first, second), key
    for single in values:
        key = ik.identity_key({"player_id": single})
        assert seen.setdefault(key, (single,)) == (single,), key


def test_migration_et_runtime_utilisent_la_meme_fonction(fake_db):
    """Le backfill écrit exactement la clé que le runtime recalcule (même fonction)."""
    fake_db.orders.docs.append({"_id": "x", "id": "ord-1", "pubg_id": "a|b",
                                "identity_snapshot": {"fields": {"player_id": "a|b",
                                                                "zone_id": "c"}}})
    run(ik.migrate_identity_keys())

    assert fake_db.orders.docs[0]["identity_key"] == ik.identity_key(
        {"player_id": "a|b", "zone_id": "c"}) == "a\\|b|c"
    # Et la clé relue depuis la commande est celle-là (aucun recalcul divergent).
    assert ik.order_identity_key(fake_db.orders.docs[0]) == "a\\|b|c"


def test_une_cle_deja_ecrite_n_est_jamais_reecrite(fake_db):
    """Une clé existante (format jointure compris) reste telle quelle : la migration n'y touche pas."""
    fake_db.orders.docs.append({"_id": "z", "id": "ord-1", "pubg_id": "12345678",
                                "game_id": ML, "identity_key": "12345678|2214"})
    fake_db.subscription_locks.docs.append({"_id": "w", "pubg_id": "12345678", "type": "prime",
                                            "game_id": PUBG, "identity_key": "12345678",
                                            "order_id": "ord-1"})

    summary = run(ik.migrate_identity_keys())

    assert summary["backfilled"]["orders"] == 0
    assert fake_db.orders.docs[0]["identity_key"] == "12345678|2214"
    assert fake_db.subscription_locks.docs[0]["identity_key"] == "12345678"


def test_un_verrou_et_sa_commande_portent_la_meme_cle(fake_db):
    """Le verrou inséré par `reserve_evo` utilise la clé échappée de la commande."""
    run(_with_new_indexes(fake_db))
    order = make_order(game_id=ML, fields={"player_id": "a|b", "zone_id": "c"}, pubg_id="a|b")
    fake_db.orders.docs.append({"_id": "y", **order})

    run(evo_mod.reserve_evo(order, EVO_PRODUCT))

    lock = fake_db.evo_locks.docs[0]
    assert lock["identity_key"] == "a\\|b|c" == order["identity_key"]
    assert lock["game_id"] == ML


# --------------------------------------------------------------------------- #
# B. Portée de `check_evo`
# --------------------------------------------------------------------------- #
def test_le_pack_evolutif_est_reserve_a_pubg_mobile():
    """`core/games.py:313-315` : le type « evo » est refusé pour tout jeu autre que PUBG."""
    with pytest.raises(HTTPException) as exc:
        normalize_product_types([{"key": "evo", "label": "Pack évolutif"}], FREE_FIRE)
    assert exc.value.status_code == 400

    accepted = normalize_product_types([{"key": "evo", "label": "Pack évolutif"}], PUBG)
    assert [t["key"] for t in accepted] == ["evo"]


def test_un_verrou_evo_d_un_autre_jeu_ne_bloque_pas_pubg(fake_db):
    """Scénario de la revue : verrou d'un autre jeu, MÊME numéro → PUBG reste éligible.

    Avec la clé `game_id` + `identity_key`, ce verrou ne peut pas non plus provoquer de
    `DuplicateKeyError` à la réservation PUBG.
    """
    run(_with_new_indexes(fake_db))
    other = make_order(game_id=FREE_FIRE, fields={"player_id": "123456789"}, pubg_id="123456789")
    fake_db.orders.docs.append({"_id": "a", **other})
    fake_db.evo_locks.docs.append({"_id": "l1", "game_id": FREE_FIRE,
                                   "identity_key": other["identity_key"],
                                   "pubg_id": other["pubg_id"], "offer_slug": EVO_PRODUCT["slug"],
                                   "period_key": "lifetime", "order_id": other["id"]})

    assert run(evo_mod.check_evo(EVO_PRODUCT, "123456789"))["eligible"] is True

    pubg_order = make_order(fields={"player_id": "123456789"}, pubg_id="123456789")
    fake_db.orders.docs.append({"_id": "b", **pubg_order})
    assert run(evo_mod.reserve_evo(pubg_order, EVO_PRODUCT)) == ("lifetime", None)
    assert len(fake_db.evo_locks.docs) == 2


def test_un_verrou_evo_pubg_bloque_toujours(fake_db):
    run(_with_new_indexes(fake_db))
    holder = make_order(fields={"player_id": "123456789"}, pubg_id="123456789")
    fake_db.orders.docs.append({"_id": "a", **holder})
    run(evo_mod.reserve_evo(holder, EVO_PRODUCT))

    result = run(evo_mod.check_evo(EVO_PRODUCT, "123456789"))
    assert result["eligible"] is False
    assert "déjà" in result["reason"]

    challenger = make_order(fields={"player_id": "123456789"}, pubg_id="123456789")
    fake_db.orders.docs.append({"_id": "b", **challenger})
    with pytest.raises(HTTPException) as exc:
        run(evo_mod.reserve_evo(challenger, EVO_PRODUCT))
    assert exc.value.status_code == 409


def test_un_verrou_evo_historique_sans_game_id_bloque_encore(fake_db):
    """Avant la migration, un verrou n'a pas de `game_id` : le filtre le voit (`None`)."""
    holder = make_order(fields={"player_id": "123456789"}, pubg_id="123456789")
    fake_db.orders.docs.append({"_id": "a", **holder})
    fake_db.evo_locks.docs.append({"_id": "l1", "pubg_id": "123456789",
                                   "offer_slug": EVO_PRODUCT["slug"],
                                   "period_key": "lifetime", "order_id": holder["id"]})

    result = run(evo_mod.check_evo(EVO_PRODUCT, "123456789"))
    assert result["eligible"] is False
