import json
import subprocess
import sys

BASE = "http://localhost:8001/api"
CJ = "/tmp/cj.txt"


def req(method, path, body=None):
    cmd = ["curl", "-s", "-b", CJ, "-X", method, f"{BASE}{path}", "-H", "Content-Type: application/json"]
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    try:
        return json.loads(out)
    except ValueError:
        return {"_raw": out[:300]}


ok, fail = 0, 0


def check(name, cond, extra=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"PASS {name}")
    else:
        fail += 1
        print(f"FAIL {name} {extra}")


products = {p["slug"]: p for p in req("GET", "/admin/fazercards/mappings")["products"]}
catalog = req("GET", "/fazercards/pubg/catalog")["categories"]
auto = next(c for c in catalog if c["category_id"] == "pubg_mobile_auto")
offers = {o["offer_id"]: o for o in auto["offers"]}
cid = auto["category_id"]

# 1-2. direct UC mapping create + modify
r = req("PATCH", f"/admin/fazercards/products/{products['60-uc']['id']}/mapping",
        {"mode": "direct", "category_id": cid, "offer_id": "60_uc"})
check("1 direct 60 UC", r.get("fazercards_mapping", {}).get("offer_id") == "60_uc" and r.get("fulfillable") is True)
r = req("PATCH", f"/admin/fazercards/products/{products['60-uc']['id']}/mapping",
        {"mode": "direct", "category_id": cid, "offer_id": "60_uc", "confirmed": True})
check("2 modify direct", r.get("mapping_status") == "direct" and r.get("supplier_cost_usd") == offers["60_uc"]["price_usd"])

# 3-4. Prime / Prime Plus direct
r = req("PATCH", f"/admin/fazercards/products/{products['prime-1m']['id']}/mapping",
        {"mode": "direct", "category_id": cid, "offer_id": "prime_1_month"})
check("3 prime 1m", r.get("fazercards_mapping", {}).get("offer_id") == "prime_1_month")
r = req("PATCH", f"/admin/fazercards/products/{products['prime-plus-1m']['id']}/mapping",
        {"mode": "direct", "category_id": cid, "offer_id": "prime_plus_1_month"})
check("4 prime plus 1m", r.get("fazercards_mapping", {}).get("offer_id") == "prime_plus_1_month")

# 4b. Prime composition refused
r = req("PATCH", f"/admin/fazercards/products/{products['prime-3m']['id']}/mapping",
        {"mode": "composite", "category_id": cid, "components": [{"offer_id": "prime_1_month", "quantity": 3}]})
check("4b prime composite refused", "composition" in str(r.get("detail", "")).lower(), r)

# 5. Pack evo direct mappings (live confirmed by exact offer names)
for slug, oid in [("evo-premier-achat", "first_purchase_pack"),
                  ("evo-fragments-materiaux", "upgradable_firearm_materials_pack"),
                  ("evo-embleme-mythique", "weekly_mythic_emblem_value_pack"),
                  ("evo-weekly-deal-1", "weekly_deal_pack_1"),
                  ("evo-weekly-deal-2", "weekly_deal_pack_2")]:
    r = req("PATCH", f"/admin/fazercards/products/{products[slug]['id']}/mapping",
            {"mode": "direct", "category_id": cid, "offer_id": oid})
    check(f"5 evo {slug}", r.get("fazercards_mapping", {}).get("offer_id") == oid)

# 5b. Fragments mythique -> mythic_emblem_pack NON CONFIRMÉ
r = req("PATCH", f"/admin/fazercards/products/{products['evo-fragments-mythique']['id']}/mapping",
        {"mode": "direct", "category_id": cid, "offer_id": "mythic_emblem_pack", "confirmed": False})
check("5b fragments mythique unconfirmed", r.get("mapping_status") == "unconfirmed" and r.get("fulfillable") is False)

# 10. invalid mapping refused (unknown offer)
r = req("PATCH", f"/admin/fazercards/products/{products['90-uc']['id']}/mapping",
        {"mode": "direct", "category_id": cid, "offer_id": "does_not_exist"})
check("10 invalid offer refused", "n'existe pas" in str(r.get("detail", "")), r)

# 13-14. composition 60+60 = 120
r = req("PATCH", f"/admin/fazercards/products/{products['120-uc']['id']}/mapping",
        {"mode": "composite", "category_id": cid, "components": [{"offer_id": "60_uc", "quantity": 2}]})
m = r.get("fazercards_mapping", {})
check("13 composite 120=60x2", m.get("mode") == "composite" and m.get("total_uc") == 120)
check("14 composite total usd", r.get("supplier_cost_usd") == round(float(offers["60_uc"]["price_usd"]) * 2, 4))
check("14b composite not fulfillable (hors scope)", r.get("fulfillable") is False)

# composition 720 = 660 + 60
r = req("PATCH", f"/admin/fazercards/products/{products['720-uc']['id']}/mapping",
        {"mode": "composite", "category_id": cid,
         "components": [{"offer_id": "660_uc", "quantity": 1}, {"offer_id": "60_uc", "quantity": 1}]})
check("13b composite 720=660+60", r.get("fazercards_mapping", {}).get("total_uc") == 720)

# 15. incorrect composition refused (120 = 60+325)
r = req("PATCH", f"/admin/fazercards/products/{products['120-uc']['id']}/mapping",
        {"mode": "composite", "category_id": cid,
         "components": [{"offer_id": "60_uc", "quantity": 1}, {"offer_id": "325_uc", "quantity": 1}]})
check("15 wrong sum refused", "Composition invalide" in str(r.get("detail", "")), r)
# non-UC component refused
r = req("PATCH", f"/admin/fazercards/products/{products['120-uc']['id']}/mapping",
        {"mode": "composite", "category_id": cid, "components": [{"offer_id": "first_purchase_pack", "quantity": 2}]})
check("15b non-UC component refused", "pas une offre UC" in str(r.get("detail", "")), r)

# 16-17. modify composition (delete component / change qty): 120 -> 60x2 again
r = req("PATCH", f"/admin/fazercards/products/{products['120-uc']['id']}/mapping",
        {"mode": "composite", "category_id": cid, "components": [{"offer_id": "60_uc", "quantity": 2}]})
check("16/17 recompose", r.get("fazercards_mapping", {}).get("total_uc") == 120)

# 11. mappings list enriched
listed = {p["slug"]: p for p in req("GET", "/admin/fazercards/mappings")["products"]}
missing_slug = next(s for s, p in listed.items() if p["mapping_status"] == "missing" and p["active"])
check("11 missing detected", listed[missing_slug]["fulfillable"] is False, missing_slug)
check("11b unconfirmed flagged", listed["evo-fragments-mythique"]["mapping_status"] == "unconfirmed")
check("11c all types present", all(t in {p["type"] for p in listed.values()} for t in ("uc", "prime", "prime_plus", "evo")))

# coverage
cov = req("GET", "/admin/fazercards/coverage")["offers"]
specials = [o for o in cov if o["kind"] == "special"]
used = [o for o in specials if o["used_by"]]
unused = [o for o in specials if not o["used_by"]]
check("cov specials found", len(specials) >= 6, len(specials))
check("cov weekly_deal_1 used", any(o["offer_id"] == "weekly_deal_pack_1" and o["used_by"] for o in specials))
check("cov unused exist (available not activated)", len(unused) >= 1, [o["offer_id"] for o in unused][:5])

# activate weekly packs now that mapping is confirmed
for slug in ("evo-weekly-deal-1", "evo-weekly-deal-2"):
    p = req("GET", "/admin/fazercards/mappings")["products"]
    prod = next(x for x in p if x["slug"] == slug)
    full = [x for x in req("GET", f"/products?type=evo&include_inactive=true") if x["slug"] == slug][0]
    body = {k: full.get(k) for k in ("slug", "type", "evo_limit", "name", "name_en", "uc_amount", "duration_months",
                                     "price", "old_price", "popular", "badge", "description_fr", "description_en",
                                     "sort_order")}
    body["active"] = True
    r = req("PUT", f"/admin/products/{prod['id']}", body)
    check(f"activate {slug}", r.get("active") is True and r.get("requires_mapping") is True, r)

# 12/25. product without mapping + requires_mapping not purchasable:
# create a test product requiring mapping, try to activate -> refused; order -> refused
r = req("POST", "/admin/products", {"slug": "test-needs-mapping", "type": "evo", "evo_limit": "week",
                                    "name": "Test mapping requis", "price": 1000, "active": False,
                                    "requires_mapping": True, "description_fr": "x", "description_en": "x"})
tid = r.get("id")
check("create requires_mapping product", bool(tid), r)
r = req("PUT", f"/admin/products/{tid}", {"slug": "test-needs-mapping", "type": "evo", "evo_limit": "week",
                                          "name": "Test mapping requis", "price": 1000, "active": True,
                                          "description_fr": "x", "description_en": "x"})
check("12 activation without mapping refused", "Mapping fournisseur" in str(r.get("detail", "")), r)
# direct order attempt on inactive product -> unavailable
r = req("POST", "/orders", {"pubg_id": "5123456789", "pseudo": "Tester",
                            "items": [{"product_id": tid, "quantity": 1}],
                            "payment_method": "manual", "manual_reference": "REF123"})
check("25 unmapped product not purchasable", "unavailable" in str(r.get("detail", "")) or "indisponible" in str(r.get("detail", "")), r)
req("DELETE", f"/admin/products/{tid}")

# public products never expose mapping/supplier cost
pub = req("GET", "/products?type=uc")
check("no supplier leak", all("fazercards_mapping" not in p and "price_usd" not in json.dumps(p) for p in pub))
check("purchasable flag public", all("purchasable" in p for p in pub))

# preflight distinct errors: order on unmapped product (active, no mapping)
prod180 = listed[missing_slug]
r = req("POST", "/orders", {"pubg_id": "5123456789", "pseudo": "Tester",
                            "items": [{"product_id": prod180["id"], "quantity": 1}],
                            "payment_method": "manual", "manual_reference": "REF999"})
oid_order = r.get("id")
check("order unmapped legacy product still OK (no regression)", bool(oid_order), r)
req("PATCH", f"/admin/orders/{oid_order}", {"status": "paid"})
r = req("GET", f"/admin/orders/{oid_order}/fazercards/preflight")
check("preflight missing mapping msg", "Mapping fournisseur manquant" in str(r.get("detail", "")), r)
req("PATCH", f"/admin/orders/{oid_order}", {"status": "cancelled"})

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
