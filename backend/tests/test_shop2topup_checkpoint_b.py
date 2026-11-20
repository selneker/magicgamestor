"""PL-006-T08C-V1 — script d'essai Checkpoint B, avec transport bouchonné.

Aucun appel réseau, aucune clé réelle, aucune base : `httpx.MockTransport` répond à la place du
fournisseur. On vérifie les garde-fous du script (blanc par défaut, clé absente = arrêt,
masquage, pas de secret affiché, budgets 1 / 6 / 1, clé d'idempotence stable).
"""
import asyncio
import importlib.util
import json
from pathlib import Path

import httpx

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "shop2topup_checkpoint_b.py"
_spec = importlib.util.spec_from_file_location("shop2topup_checkpoint_b", SCRIPT_PATH)
checkpoint = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(checkpoint)

from services.providers.shop2topup_adapter import (  # noqa: E402
    BATCH_REQUEST_KEY, Shop2TopupProvider, provider_order_id_for)


def transport_provider(handler):
    return Shop2TopupProvider(client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def test_masquage_moitie():
    assert checkpoint.mask_half("52328390220") == "52328******"
    assert checkpoint.mask_half("1234") == "12**"
    assert checkpoint.mask_half("") == "<vide>"


def test_sanitize_purge_les_soldes_et_les_secrets():
    cleaned = checkpoint.sanitize({
        "wallet": "12.500000", "balance": "3", "api_key": "clé",
        "nested": {"wallet": 1, "ok": "visible"},
    })

    assert cleaned == {"wallet": "<balance>", "balance": "<balance>", "api_key": "***",
                       "nested": {"wallet": "<balance>", "ok": "visible"}}


def test_essai_a_blanc_par_defaut_sans_reseau_ni_cle(monkeypatch):
    monkeypatch.delenv("SHOP2TOPUP_API_KEY", raising=False)
    lines = []

    code = asyncio.new_event_loop().run_until_complete(
        checkpoint.run(player_id="52328390220", out=lines.append))

    output = "\n".join(lines)
    assert code == 0
    assert "ESSAI À BLANC" in output
    assert "13 = 60 UC" in output
    assert "52328******" in output and "52328390220" not in output
    assert checkpoint.IDEMPOTENCY_KEY in output
    assert "aucun appel réseau" in output


def test_confirm_spend_sans_cle_arrete_avant_tout_appel(monkeypatch):
    monkeypatch.delenv("SHOP2TOPUP_API_KEY", raising=False)
    lines = []

    code = asyncio.new_event_loop().run_until_complete(
        checkpoint.run(player_id="52328390220", confirm_spend=True, out=lines.append))

    output = "\n".join(lines)
    assert code == 2
    assert "absente : arrêt AVANT tout appel" in output


def test_appel_reel_bornes_et_masquage(monkeypatch):
    monkeypatch.setenv("SHOP2TOPUP_API_KEY", "sentinelle-cle")
    seen = {"create": [], "batch": [], "status": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/orders/create"):
            seen["create"].append(json.loads(request.content))
            return httpx.Response(200, json={"success": True, "data": {"order": {
                "order_id": "prov-1", "status": "pending"}}})
        if path.endswith("/orders/batch"):
            seen["batch"].append(json.loads(request.content))
            return httpx.Response(200, json={"success": True, "data": {
                "orders": [{"order_id": "prov-1", "status": "pending"}], "not_found": []}})
        if path.endswith("/orders/prov-1"):
            seen["status"] += 1
            status = "completed" if seen["status"] >= 2 else "pending"
            return httpx.Response(200, json={"success": True, "data": {"order": {
                "order_id": "prov-1", "status": status}}})
        return httpx.Response(404, json={"success": False})

    lines = []
    code = asyncio.new_event_loop().run_until_complete(checkpoint.run(
        player_id="52328390220", confirm_spend=True, probe_batch=True,
        provider=transport_provider(handler), out=lines.append))

    output = "\n".join(lines)
    assert code == 0
    assert len(seen["create"]) == 1
    assert len(seen["batch"]) == 1
    assert 1 <= seen["status"] <= checkpoint.STATUS_READS_MAX
    assert seen["create"][0]["sub_category_id"] == 13
    assert seen["create"][0]["quantity"] == 1
    assert seen["create"][0]["requirements"] == {"player_id": "52328390220"}
    assert seen["batch"][0] == {BATCH_REQUEST_KEY: ["prov-1"]}
    assert f"champ d'entrée = {BATCH_REQUEST_KEY}" in output
    assert "52328390220" not in output
    assert "sentinelle-cle" not in output
    assert "SHOP2TOPUP_API_KEY=***" in output


def test_cle_d_idempotence_identique_au_retry(monkeypatch):
    monkeypatch.setenv("SHOP2TOPUP_API_KEY", "sentinelle-cle")
    order_ids = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/orders/create"):
            order_ids.append(json.loads(request.content)["order_id"])
            return httpx.Response(200, json={"success": True, "data": {"order": {
                "order_id": "prov-1", "status": "completed"}}})
        if request.url.path.endswith("/orders/prov-1"):
            return httpx.Response(200, json={"success": True, "data": {"order": {
                "order_id": "prov-1", "status": "completed"}}})
        return httpx.Response(404, json={"success": False})

    for _ in range(2):
        asyncio.new_event_loop().run_until_complete(checkpoint.run(
            player_id="52328390220", confirm_spend=True,
            provider=transport_provider(handler), out=lambda *_: None))

    assert order_ids == [provider_order_id_for(checkpoint.IDEMPOTENCY_KEY)] * 2


def test_zone_transmise_seulement_si_fournie():
    assert checkpoint.identity_fields("123") == {"player_id": "123"}
    assert checkpoint.identity_fields("123", "2214") == {"player_id": "123", "zone_id": "2214"}


def test_main_a_blanc_ne_requiert_aucune_cle(monkeypatch, capsys):
    monkeypatch.delenv("SHOP2TOPUP_API_KEY", raising=False)

    code = checkpoint.main(["--player-id", "52328390220"])

    assert code == 0
    assert "ESSAI À BLANC" in capsys.readouterr().out
