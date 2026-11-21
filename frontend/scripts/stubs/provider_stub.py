#!/usr/bin/env python3
"""Stub fournisseurs pour l'essai local du prototype (PL-FE-008-V2).

Répond aux URLs de base que le backend lit (FAZERCARDS_API_BASE, BINANCE_API_BASE)
pour la validation d'identité, le catalogue et la création de commande. Aucun appel
vers FazerCards, Shop2Topup, Neferbyte, P2P.Army, Mailjet ou Binance : le backend
pointe ces variables vers ce stub, et les autres sorties passent par le proxy
127.0.0.1:9 (noir).

Stdlib seulement — aucune dépendance. Lancer :
    python3 frontend/scripts/stubs/provider_stub.py --port 9009
"""
import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# Identifiants de test : l'ID 123456789 est valide, les autres sont refusés.
VALID_ID = "123456789"
INVALID_IDS = {"000000000", ""}
PLAYER_NAME = "TestPlayer"

CATEGORIES = [{"category_id": "pubgm_uc", "name": "PUBG Mobile UC", "note": ""}]
OFFERS = [{
    "category_id": "pubgm_uc", "name": "PUBG Mobile UC",
    "offers": [
        {"offer_id": "off-60", "name": "60 UC", "price_usd": 0.83},
        {"offer_id": "off-325", "name": "325 UC", "price_usd": 4.51},
        {"offer_id": "off-660", "name": "660 UC", "price_usd": 9.14},
    ],
    "fields": [{"key": "player_id", "label": "Player ID", "type": "text"}],
}]
ORDERS = {}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):  # journal vers stdout (pour le rapport)
        sys.stderr.write("[stub] %s %s\n" % (self.command, self.path))

    def _send(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw or b"{}")
        except ValueError:
            return {}

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/topups/validate-id":
            return self._send({"ok": True, "items": [{"category_id": "pubgm_uc", "fields": [{"key": "player_id", "label": "Player ID", "type": "text"}]}]})
        if u.path == "/topups":
            return self._send({"ok": True, "items": CATEGORIES, "meta": {"has_more": False, "next_cursor": None}})
        if u.path == "/topups/offers":
            for off in OFFERS:
                if off["category_id"] == (q.get("category_id") or [""])[0]:
                    return self._send({"ok": True, **off})
            return self._send({"ok": True, "category_id": (q.get("category_id") or [""])[0], "name": None, "offers": [], "fields": []})
        if u.path.startswith("/orders/"):
            order = ORDERS.get(u.path.split("/")[-1])
            return self._send({"ok": True, "order": order or {"id": u.path.split("/")[-1], "status": "success"}})
        if u.path == "/sapi/v1/capital/config/getall":
            return self._send([{"coin": "USDT", "networkList": [{"network": "TRX", "name": "Tron", "depositEnable": True, "memoRegex": "", "sameAddress": False, "minConfirm": 20, "unLockConfirm": 30, "depositDust": "0.00000001"}]}])
        if u.path == "/sapi/v1/capital/deposit/hisrec":
            return self._send([])
        return self._send({"ok": True})

    def do_POST(self):
        u = urlparse(self.path)
        body = self._body()
        if u.path == "/topups/validate-id":
            fields = body.get("fields") or {}
            pid = str(fields.get("player_id") or "")
            if pid in INVALID_IDS or not pid:
                return self._send({"ok": True, "valid": False})
            return self._send({"ok": True, "valid": True, "player_name": PLAYER_NAME, "region": "MG"})
        if u.path == "/topups/order":
            oid = "po_test_1"
            ORDERS[oid] = {"id": oid, "status": "success", "category_id": body.get("category_id"), "offer_id": body.get("offer_id")}
            return self._send({"ok": True, "order": ORDERS[oid]})
        return self._send({"ok": True})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9009)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[stub] fournisseurs sur http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
