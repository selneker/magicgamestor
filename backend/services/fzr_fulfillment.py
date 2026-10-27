"""FazerCards Phase 3/4 — commande fournisseur par UNITÉ de fulfillment.

Une commande MGS = N lignes. Chaque ligne produit possède un mapping fournisseur :
- DIRECT  → 1 unité de fulfillment (1 commande fournisseur).
- COMPOSÉ → décomposition INTERNE en plusieurs unités (720 UC → 660 + 60), chacune = 1 commande
  indépendante utilisant l'offre DIRECTE correspondante. Le panier / prix / ligne client ne changent JAMAIS.

Chaque unité a son propre provider_order_id et sa propre Idempotency-Key STABLE :
- ligne directe idx 0  → record `order.fazercards`,                    clé `{order}-1`      (rétrocompat)
- ligne directe idx>0  → record `order.fazercards_lines.{idx}`,        clé `{order}-L{idx+1}-1`
- composant (idx, u)   → record `order.fazercards_components.{idx}.{u}`, clé `{order}-L{idx+1}-C{u+1}`

FOURNISSEUR : il est décidé **PAR UNITÉ**, jamais une fois pour toute la commande.
- Une unité qui a déjà un record garde le fournisseur ET la cible (`category_id`, `offer_id`)
  enregistrés à sa création, quelle que soit la configuration actuelle du jeu : une bascule de
  fournisseur (ou un mapping modifié/supprimé depuis) ne réoriente JAMAIS une commande en vol,
  et le claim de reprise n'efface aucun identifiant déjà écrit.
- Une unité SANS record suit la configuration actuelle du jeu (`provider_for_game`).
Ensuite, le rafraîchissement, le webhook et la synchronisation de statut lisent CE champ — jamais
la configuration courante du jeu. Aucun repli, aucun retry et aucune création ne changent de
fournisseur.
"""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from core.audit import audit
from core.db import db
from core.games import DEFAULT_GAME_ID
from services import aluu_mapping, fazercards, fzr_mapping, providers
from services.providers.base import OrderStatus

logger = logging.getLogger("mgs.fzr")
PUBLIC = {"_id": 0}
RETRYABLE = ("submit_timeout", "error")
PROVIDER_ALERT_NORMALIZED = (OrderStatus.FAILED, OrderStatus.REFUND)
# Statuts MGS qui closent une unité : plus aucun webhook ne peut les remplacer.
FINAL_STATUSES = (OrderStatus.COMPLETED, OrderStatus.FAILED, OrderStatus.REFUND)
MISSING_IDENTITY_DETAIL = "Champ d'identité requis manquant."


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _identity_fields(order: dict) -> dict:
    """Champs d'identité transmis au provider, pilotés par la donnée (jamais hardcodés PUBG).
    Priorité au snapshot d'identité (fields dynamiques) ; repli legacy sur pubg_id."""
    snapshot = order.get("identity_snapshot") or {}
    fields = {k: v for k, v in (snapshot.get("fields") or {}).items() if v}
    if not fields and order.get("pubg_id"):
        fields = {"player_id": order["pubg_id"]}
    return fields


def _line_path(idx: int) -> str:
    return "fazercards" if idx == 0 else f"fazercards_lines.{idx}"


def _unit_identity(order_number: str, line_index: int, component_index, quantity_index: int = 0):
    """(path Mongo, Idempotency-Key) d'une unité de fulfillment.
    quantity_index 0 = shape/clé LEGACY (rétrocompat totale). Les répétitions (quantity>1) sont stockées
    sous `fazercards_reps` — champ neuf, aucun impact sur les records/clés existants."""
    on, idx, cidx, q = order_number, line_index, component_index, quantity_index
    if q == 0:
        if cidx is None:
            return _line_path(idx), (f"{on}-1" if idx == 0 else f"{on}-L{idx + 1}-1")
        return f"fazercards_components.{idx}.{cidx}", f"{on}-L{idx + 1}-C{cidx + 1}"
    if cidx is None:
        return f"fazercards_reps.{idx}.{q}", f"{on}-L{idx + 1}-U{q + 1}"
    return f"fazercards_reps.{idx}.{q}.{cidx}", f"{on}-L{idx + 1}-U{q + 1}-C{cidx + 1}"


def line_record(order: dict, idx: int) -> dict | None:
    if idx == 0:
        return order.get("fazercards")
    return (order.get("fazercards_lines") or {}).get(str(idx))


def unit_record(order: dict, unit: dict) -> dict | None:
    idx, cidx, q = unit["line_index"], unit["component_index"], unit.get("quantity_index", 0)
    if q == 0:
        if cidx is None:
            return line_record(order, idx)
        comps = (order.get("fazercards_components") or {}).get(str(idx)) or {}
        return comps.get(str(cidx))
    node = ((order.get("fazercards_reps") or {}).get(str(idx)) or {}).get(str(q))
    if cidx is None:
        return node
    return (node or {}).get(str(cidx))


def _sendable(record: dict | None) -> bool:
    """Unité envoyable : aucun record, ou record retryable sans provider_order_id."""
    if not record:
        return True
    return not record.get("provider_order_id") and record.get("status") in RETRYABLE


def _record_provider(record: dict | None) -> str:
    """Fournisseur ENREGISTRÉ sur l'unité. Absent = record historique FazerCards.

    Jamais `provider_for_game` ici : une unité garde le fournisseur qui l'a créée, même si le
    jeu a été basculé depuis. Un nom inconnu fera échouer `get_provider_by_name` (fail-closed).
    """
    return str((record or {}).get("provider") or "").strip().lower() or "fazercards"


def _mapping_state(mapping: dict | None, *, is_aluu: bool) -> str:
    """État d'un mapping pour le fournisseur du jeu : `missing` | `unconfirmed` | `invalid` | `ok`."""
    if not mapping:
        return "missing"
    if mapping.get("confirmed") is False:
        return "unconfirmed"
    usable = aluu_mapping.mapping_ok_aluu(mapping) if is_aluu else fzr_mapping.mapping_ok(mapping)
    return "ok" if usable else "invalid"


def _missing_mapping_reason(state: str, *, is_aluu: bool) -> str:
    if is_aluu:
        return {
            "missing": "⚠ Mapping fournisseur manquant : liez ce produit à un pack ALUU depuis "
                       "l'écran ALUU (aperçu puis application explicite).",
            "unconfirmed": "⚠ Mapping fournisseur « à confirmer » : confirmez la correspondance "
                           "avant tout envoi.",
        }.get(state, "Mapping fournisseur invalide.")
    return {
        "missing": "⚠ Mapping fournisseur manquant : liez ce produit à une offre FazerCards dans Admin → Fournisseur.",
        "unconfirmed": "⚠ Mapping fournisseur « à confirmer » : confirmez la correspondance avant tout envoi.",
    }.get(state, "Mapping fournisseur invalide.")


def _unit_matches(record: dict | None, provider_order_id: str) -> bool:
    """Identifiant fournisseur d'une unité : `provider_order_id`, historique ou liste ALUU."""
    if not record:
        return False
    if record.get("provider_order_id") == provider_order_id:
        return True
    if record.get("aluu_order_id") == provider_order_id:
        return True
    return provider_order_id in (record.get("provider_order_ids") or [])


async def auto_enabled() -> bool:
    doc = await db.settings.find_one({"key": "store"}, {"_id": 0, "fzr_auto": 1})
    return bool(doc and doc.get("fzr_auto"))


class _CurrentProvider:
    """Résolution PARESSEUSE du fournisseur de la configuration ACTUELLE du jeu.

    Elle n'est tentée que parce qu'une unité sans record peut devoir être créée (ou pour lire le
    mapping courant). Une reprise composée uniquement d'unités déjà créées n'en DÉPEND pas : le
    jeu a pu être basculé — ou sa configuration cassée — depuis la création, et la reprise doit
    rester possible.
    """

    def __init__(self, game_id: str | None, provider=None) -> None:
        self._game_id = game_id
        self._provider = provider
        self._error: Exception | None = None
        self._tried = provider is not None

    async def get(self):
        if not self._tried:
            self._tried = True
            try:
                self._provider = await providers.provider_for_game(self._game_id)
            except Exception as exc:  # configuration invalide, base indisponible…
                self._error = exc
        if self._error is not None:
            raise self._error
        return self._provider


def _as_index(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _records_for_line(order: dict, idx: int) -> dict[tuple[int | None, int], dict]:
    """Records DÉJÀ créés d'une ligne, indexés par (component_index, quantity_index).

    Lecture pure du document de commande : aucune base, aucun fournisseur. Un record porte
    toujours un `status` ; c'est ce qui le distingue d'un nœud de composants/répétitions.
    """
    found: dict[tuple[int | None, int], dict] = {}

    def add(component_index, quantity_index, record):
        if isinstance(record, dict):
            found[(component_index, quantity_index)] = record

    if idx == 0:
        add(None, 0, order.get("fazercards"))
    add(None, 0, (order.get("fazercards_lines") or {}).get(str(idx)))
    for key, record in ((order.get("fazercards_components") or {}).get(str(idx)) or {}).items():
        add(_as_index(key), 0, record)
    for key, node in ((order.get("fazercards_reps") or {}).get(str(idx)) or {}).items():
        if not isinstance(node, dict):
            continue
        if isinstance(node.get("status"), str):  # record d'une répétition directe
            add(None, _as_index(key), node)
            continue
        for component_key, record in node.items():
            add(_as_index(component_key), _as_index(key), record)
    return found


def _recorded_provider(order: dict) -> str | None:
    """Premier fournisseur enregistré sur une unité de la commande (`None` = aucune unité créée)."""
    def walk(node):
        if isinstance(node, dict):
            if str(node.get("provider") or "").strip():
                return str(node["provider"]).strip().lower()
            for value in node.values():
                found = walk(value)
                if found:
                    return found
        return None

    return walk({key: order.get(key) for key in
                 ("fazercards", "fazercards_lines", "fazercards_components", "fazercards_reps")})


def _mapping_base(mapping: dict, *, is_aluu: bool) -> tuple[list[dict], str]:
    """(unités de base d'UNE quantité, catégorie fournisseur) lues sur un mapping utilisable."""
    if is_aluu:
        # Le mapping ALUU est toujours direct : `denom` et `game_code`, jamais de composition.
        return ([{"component_index": None, "offer_id": mapping["denom"], "component_name": None}],
                mapping["game_code"])
    if mapping.get("mode", "direct") == "direct":
        return ([{"component_index": None, "offer_id": mapping["offer_id"], "component_name": None}],
                mapping["category_id"])
    base, u = [], 0
    for comp in mapping.get("components") or []:
        for _ in range(int(comp.get("quantity", 1))):
            base.append({"component_index": u, "offer_id": comp["offer_id"],
                         "component_name": comp.get("offer_name")})
            u += 1
    return base, mapping["category_id"]


def _unit(order: dict, idx: int, component_index, quantity_index: int, *, record: dict | None,
          provider_name: str, category_id, offer_id, component_name, product: str) -> dict:
    """Une unité de fulfillment.

    Si elle a un record, SA cible et SON fournisseur priment sur la configuration courante : le
    jeu a pu être basculé et son mapping changé ou supprimé depuis sa création.
    """
    path, key = _unit_identity(order["order_number"], idx, component_index, quantity_index)
    if record:
        provider_name = _record_provider(record)
        category_id = record.get("category_id") or category_id
        offer_id = record.get("offer_id") or offer_id
        component_name = record.get("component_name") if "component_name" in record else component_name
        product = record.get("product_name") or product
    return {"line_index": idx, "component_index": component_index,
            "quantity_index": quantity_index, "path": path, "idempotency_key": key,
            "category_id": category_id, "offer_id": offer_id,
            "product": product, "component_name": component_name,
            "provider": provider_name, "retry": bool(record)}


async def _product_mapping(item: dict, *, is_aluu: bool) -> dict | None:
    """Mapping du produit pour UN fournisseur (`aluu_mapping` ou `fazercards_mapping`)."""
    field = "aluu_mapping" if is_aluu else "fazercards_mapping"
    product = await db.products.find_one({"id": item["product_id"]}, {"_id": 0, field: 1})
    return (product or {}).get(field)


async def _line_mapping(order: dict, idx: int, item: dict, *, records: dict,
                        current: "_CurrentProvider") -> tuple[dict | None, bool, str, str]:
    """(mapping, is_aluu, fournisseur du mapping, état) pour UNE ligne.

    Priorité au fournisseur ENREGISTRÉ sur les records de la ligne : c'est la forme avec
    laquelle elle a été décomposée, et la relire ne demande AUCUNE résolution de la
    configuration actuelle — une reprise ne dépend donc ni d'un jeu basculé, ni d'une config
    cassée. La configuration actuelle ne sert qu'aux lignes SANS record, ou quand le mapping du
    fournisseur enregistré n'est plus utilisable (il ne reste alors que des unités neuves à créer).
    """
    names = sorted({_record_provider(record) for record in records.values()})
    if len(names) == 1:
        name = names[0]
        is_aluu = name == "aluu"
        mapping = await _product_mapping(item, is_aluu=is_aluu)
        state = _mapping_state(mapping, is_aluu=is_aluu)
        if state == "ok":
            return mapping, is_aluu, name, state
    provider = await current.get()  # peut lever : configuration actuelle invalide
    is_aluu = provider.name == "aluu"
    mapping = await _product_mapping(item, is_aluu=is_aluu)
    return mapping, is_aluu, provider.name, _mapping_state(mapping, is_aluu=is_aluu)


async def _units_for_line(order: dict, idx: int, item: dict, *,
                          current: _CurrentProvider) -> tuple[list, dict | None]:
    """Unités d'une ligne. Le FOURNISSEUR est décidé **par unité** :

    - unité qui a déjà un record → fournisseur et cible enregistrés (aucune réorientation) ;
    - unité sans record → configuration actuelle du jeu (voir `_line_mapping`).

    Les positions viennent du mapping du fournisseur enregistré ou, à défaut, du mapping
    courant ; à défaut de tout mapping utilisable, des seuls records déjà créés. Aucune position
    inventée, aucune unité en vol réorientée.
    """
    records = _records_for_line(order, idx)
    qty = max(1, int(item.get("quantity", 1) or 1))
    product_name = item.get("name")
    units: list[dict] = []
    seen: set[tuple[int | None, int]] = set()

    try:
        mapping, is_aluu, provider_name, state = await _line_mapping(
            order, idx, item, records=records, current=current)
    except Exception as exc:  # configuration actuelle illisible : seules les unités existantes
        if not records:
            raise
        logger.debug("fzr: configuration illisible pour la reprise de %s (%s)",
                     order.get("order_number"), type(exc).__name__)
        mapping, is_aluu, provider_name, state = None, False, "", "missing"

    if state == "ok":
        base, category_id = _mapping_base(mapping, is_aluu=is_aluu)
        for q in range(qty):
            for component in base:
                cidx = component["component_index"]
                seen.add((cidx, q))
                units.append(_unit(order, idx, cidx, q, record=records.get((cidx, q)),
                                   provider_name=provider_name, category_id=category_id,
                                   offer_id=component["offer_id"],
                                   component_name=component["component_name"],
                                   product=product_name))

    # Positions enregistrées que le mapping lu ne produit plus (autre fournisseur, mapping
    # modifié ou supprimé) : elles restent envoyables avec LEUR fournisseur et LEUR cible.
    for (cidx, q), record in records.items():
        if (cidx, q) in seen:
            continue
        units.append(_unit(order, idx, cidx, q, record=record, provider_name="",
                           category_id=None, offer_id=None, component_name=None,
                           product=product_name))

    skip = None
    if state != "ok":
        # Aucun mapping utilisable : la ligne n'est complète que si toutes les positions
        # CONNUES (celles des records) ont un record. Les positions qu'un mapping perdu ne
        # décrit plus ne sont pas devinables — aucune unité n'est inventée pour autant.
        components = {cidx for cidx, _q in records} or {None}
        if len(records) < len(components) * qty:
            skip = {"index": idx, "product": product_name,
                    "reason": _missing_mapping_reason(state, is_aluu=is_aluu)}
    return units, skip


async def _all_units(order: dict, *, provider=None,
                     current: _CurrentProvider | None = None) -> tuple[list, list]:
    """Toutes les unités de la commande, chacune avec SON fournisseur (voir `_units_for_line`).

    `current` (ou `provider`) porte la configuration ACTUELLE, partagée par préflight et
    création. La résolution reste PARESSEUSE : une ligne dont toutes les unités sont déjà
    enregistrées la lit sur son propre fournisseur, sans jamais toucher à la config du jeu.
    """
    current = current or _CurrentProvider(order.get("game_id"), provider)
    units, skipped = [], []
    for idx, item in enumerate(order.get("items") or []):
        line_units, skip = await _units_for_line(order, idx, item, current=current)
        units += line_units
        if skip:
            skipped.append(skip)
    return units, skipped


def _is_legacy_single(order: dict, units: list) -> bool:
    """Commande mono-ligne DIRECTE → shape de retour historique (record au premier niveau)."""
    return len(order.get("items") or []) == 1 and len(units) == 1 and units[0]["component_index"] is None


async def eligible_lines(order: dict) -> list:
    units, _ = await _all_units(order)
    return [u for u in units if _sendable(unit_record(order, u))]


async def preflight(order_id: str, *, provider=None,
                    current: _CurrentProvider | None = None) -> dict:
    """Rapport pré-commande : toutes les vérifications par unité, AUCUNE commande créée.

    Le FOURNISSEUR est décidé **par unité** (voir `_units_for_line`) : une unité déjà créée garde
    son fournisseur et sa cible enregistrés, une unité nouvelle suit la configuration actuelle.
    `current` porte la résolution de la configuration actuelle, partagée avec `fulfill_order`
    pour qu'elle n'ait lieu qu'une fois par opération.
    """
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    current = current or _CurrentProvider(order.get("game_id"), provider)
    units, skipped = await _all_units(order, current=current)
    records = [unit_record(order, u) for u in units]
    sent_ids = [r["provider_order_id"] for r in records if r and r.get("provider_order_id")]
    pending = [u for u, r in zip(units, records) if _sendable(r)]
    single = _is_legacy_single(order, units)
    if units and not pending:
        raise HTTPException(status_code=409, detail=f"Déjà envoyée au fournisseur ({', '.join(sent_ids) or 'en cours'}).")
    if order["status"] != "paid":
        raise HTTPException(status_code=409, detail="Paiement non confirmé : la commande doit être au statut « payée ».")
    if not pending:
        detail = skipped[0]["reason"] if single and skipped else \
            "Aucune ligne éligible : " + "; ".join(f"{s['product']} — {s['reason']}" for s in skipped)
        raise HTTPException(status_code=409, detail=detail or "Aucune ligne éligible.")
    instances: dict[str, object] = {}

    def instance(name: str):
        prov = instances.get(name)
        if prov is None:
            prov = instances[name] = providers.get_provider_by_name(name)
        return prov

    first = pending[0]
    validation = await instance(first["provider"]).validate_identity(
        order.get("game_id"), _identity_fields(order))  # 502/504 si service indisponible
    if not validation.valid:
        # Message neutre par jeu : PUBG Mobile conserve son libellé historique, tout autre jeu
        # reçoit un message générique (aucune hypothèse PUBG pour un jeu dynamique).
        if (order.get("game_id") or DEFAULT_GAME_ID) == DEFAULT_GAME_ID:
            detail = "ID PUBG Mobile invalide chez le fournisseur — commande non envoyée."
        else:
            detail = "Identité joueur invalide chez le fournisseur — commande non envoyée."
        raise HTTPException(status_code=409, detail=detail)
    offers_by_cat, lines = {}, []
    for u in pending:
        prov = instance(u["provider"])
        cat = u["category_id"]
        key = (prov.name, cat)
        record = unit_record(order, u)
        if key not in offers_by_cat:
            if record:
                # Reprise d'une unité DÉJÀ créée : la cible enregistrée fait foi (le jeu a pu être
                # basculé depuis, ses catégories changées). On vérifie seulement que l'offre existe
                # encore chez SON fournisseur.
                offers_by_cat[key] = await prov.get_offers(cat)
            else:
                # Offres live de la catégorie, en vérifiant qu'elle appartient bien au jeu de la
                # commande (aucun mélange entre catalogues de jeux). FAIL-CLOSED : un jeu inconnu
                # échoue explicitement (409). Seul le chemin de compatibilité PUBG historique
                # (game_id absent) conserve le comportement d'origine.
                offers_by_cat[key] = await fzr_mapping.offers_for_game(order.get("game_id"), cat,
                                                                      provider=prov)
        offers = offers_by_cat[key]
        offer = next((o for o in offers["offers"] if o["offer_id"] == u["offer_id"]), None)
        if not offer:
            reason = "Offre indisponible chez le fournisseur (retirée du catalogue)."
            if single:
                raise HTTPException(status_code=409, detail=reason)
            skipped.append({"index": u["line_index"], "product": u["product"], "reason": reason})
            continue
        # Champs `/create` exigés par CETTE offre — jamais la liste agrégée du jeu : un pack qui
        # n'exige pas `serverid` ne doit pas être bloqué parce qu'un AUTRE pack l'exige.
        offer_fields = offer.get("fields") or offers.get("fields") or []
        field_keys = [f["key"] for f in offer_fields if f.get("key")]
        if prov.name == "aluu":
            # Un pack ALUU qui exige `serverid` (ou `charname`) ne doit JAMAIS partir avec une
            # identité incomplète : refus explicite avant tout envoi, libellé existant.
            missing = await prov.missing_order_fields(order.get("game_id"), _identity_fields(order), field_keys)
            if missing:
                if single:
                    raise HTTPException(status_code=409, detail=MISSING_IDENTITY_DETAIL)
                skipped.append({"index": u["line_index"], "product": u["product"],
                                "reason": MISSING_IDENTITY_DETAIL})
                continue
        declared = list((_identity_fields(order) or {}).keys())
        # Clé de champ effectivement envoyée : on utilise le champ DÉCLARÉ par le jeu s'il correspond
        # à ce qu'attend le fournisseur. Aucune hypothèse `player_id` universelle.
        matched = [k for k in declared if k in field_keys]
        field_key = matched[0] if matched else (field_keys[0] if field_keys else (declared[0] if declared else "player_id"))
        lines.append({
            "index": u["line_index"], "component_index": u["component_index"], "quantity_index": u["quantity_index"], "path": u["path"],
            "product": u["product"], "component_name": u["component_name"], "category_id": u["category_id"],
            "offer_id": u["offer_id"], "offer_name": offer["name"], "price_usd": offer["price_usd"],
            "field_key": field_key, "idempotency_key": u["idempotency_key"], "retry": bool(record),
            "provider": prov.name,
        })
    if not lines:
        raise HTTPException(status_code=409, detail=skipped[-1]["reason"] if skipped else "Aucune ligne éligible.")
    report = {
        "order_number": order["order_number"], "provider": first["provider"], "player_id": order["pubg_id"],
        "identity_fields": _identity_fields(order),
        "player_name": validation.player_name, "mgs_total": order["total"],
        "lines": lines, "skipped": skipped, "ready_count": len(lines),
    }
    if single:  # compat mono-ligne directe : champs historiques au premier niveau
        report.update({k: lines[0][k] for k in
                       ("product", "category_id", "offer_id", "offer_name", "price_usd", "field_key", "idempotency_key", "retry")})
    return report


async def _update_record(order_id: str, path, fields: dict):
    """path : chemin dotted (str) OU index de ligne (int, rétrocompat)."""
    if isinstance(path, int):
        path = _line_path(path)
    await db.orders.update_one({"id": order_id}, {"$set": {
        **{f"{path}.{k}": v for k, v in fields.items()}, f"{path}.updated_at": _now(), "updated_at": _now()}})


async def _fulfill_unit(order: dict, line: dict, actor: str, provider, *, current=None) -> dict:
    """Claim atomique + création fournisseur pour UNE unité. Retry réutilise la même Idempotency-Key.

    Le FOURNISSEUR DE L'UNITÉ fait foi : s'il existe déjà un record, c'est le sien qui est
    utilisé (et réécrit) — `provider` ne sert qu'à une unité qui n'en a pas encore. Le claim de
    reprise FUSIONNE l'ancien record : aucun identifiant déjà obtenu (`provider_order_id`,
    `aluu_order_id`, `provider_reference`), aucune action manuelle en cours n'est perdue, et
    `provider` n'est jamais remplacé par la configuration actuelle du jeu.
    """
    order_id, idx, cidx, path = order["id"], line["index"], line["component_index"], line["path"]
    q = line.get("quantity_index", 0)
    unit = {"line_index": idx, "component_index": cidx, "quantity_index": q}
    existing = unit_record(order, unit)
    if existing and _record_provider(existing) != provider.name:
        # Reprise d'une unité créée chez un AUTRE fournisseur que la config actuelle : on ne
        # réoriente pas, on repart de SON fournisseur.
        provider = providers.get_provider_by_name(_record_provider(existing))
    record = {
        "provider": provider.name, "status": "creating", "provider_order_id": None, "provider_status": None,
        "line_index": idx, "component_index": cidx, "quantity_index": q, "product_name": line["product"],
        "component_name": line.get("component_name"),
        "category_id": line["category_id"], "offer_id": line["offer_id"], "offer_name": line["offer_name"],
        "player_id": order["pubg_id"], "identity_snapshot": _identity_fields(order),
        "player_name_at_validation": line.get("player_name") or None,
        "supplier_price_usd_at_order": line["price_usd"], "idempotency_key": line["idempotency_key"],
        "requested_by": actor, "last_error": None,
        "created_at": (existing or {}).get("created_at") or _now(), "updated_at": _now(),
    }
    if existing:
        # Fusion (et non remplacement) : tout ce que l'unité a déjà obtenu survit au claim.
        record = {**existing, **record, "provider": _record_provider(existing)}
        claim = await db.orders.update_one(
            {"id": order_id, f"{path}.provider_order_id": None, f"{path}.status": {"$in": list(RETRYABLE)}},
            {"$set": {path: record, "updated_at": _now()}})
    else:
        claim = await db.orders.update_one(
            {"id": order_id, "status": "paid", path: {"$exists": False}},
            {"$set": {path: record, "updated_at": _now()}})
    if claim.modified_count != 1:
        raise HTTPException(status_code=409, detail="Un envoi fournisseur est déjà en cours pour cette unité.")
    fields_payload = _identity_fields(order) or {line["field_key"]: order["pubg_id"]}
    try:
        provider_order = await provider.create_order(
            line["category_id"], line["offer_id"], fields_payload, line["idempotency_key"])
    except providers.ProviderTimeout:
        await _update_record(order_id, path, {"status": "submit_timeout", "last_error": "timeout après soumission"})
        await audit("fzr.order_timeout", actor, order_id, {"idempotency_key": line["idempotency_key"], "line": idx, "component": cidx})
        raise HTTPException(status_code=504, detail="La requête fournisseur a expiré. Réessayez : la même clé d'idempotence sera réutilisée (aucun double top-up).")
    except providers.ProviderOrderError as exc:
        # Refus APRÈS paiement (dont 402 solde insuffisant) : état explicite « action manuelle
        # requise » + audit. `status` reste `error` pour conserver le renvoi manuel du frontend.
        manual_action = ("insufficient_balance"
                         if isinstance(exc, providers.ProviderInsufficientBalanceError)
                         else "provider_refused")
        await _update_record(order_id, path, {
            "status": "error", "last_error": exc.error,
            "manual_action_required": True, "manual_action": manual_action,
            "manual_action_at": _now()})
        await audit("fzr.order_error", actor, order_id, {"error": exc.error, "code": exc.code, "http": exc.status_code, "line": idx, "component": cidx})
        await audit("fzr.manual_action_required", actor, order_id,
                    {"manual_action": manual_action, "code": exc.code, "http": exc.status_code,
                     "provider": provider.name, "line": idx, "component": cidx})
        raise HTTPException(status_code=409 if exc.status_code < 500 else 502,
                            detail=f"Commande fournisseur refusée : {exc.error}")
    provider_status = provider_order.status
    fields_sent = {"status": "submitted", "provider_order_id": provider_order.id,
                   "provider_status": provider_status}
    identifiers: list[str] = []
    if provider.name == "aluu":
        # `provider_order.id` EST le `partner_orderid` envoyé ; ALUU renvoie aussi son `orderid`
        # et sa `reference`. On stocke les trois tels quels (aucune valeur inventée).
        raw = provider_order.raw if isinstance(provider_order.raw, dict) else {}
        aluu_order_id = str(raw.get("orderid") or "").strip() or None
        fields_sent["partner_order_id"] = provider_order.id
        fields_sent["aluu_order_id"] = aluu_order_id
        fields_sent["provider_reference"] = str(raw.get("reference") or "").strip() or None
        identifiers = [value for value in (provider_order.id, aluu_order_id) if value]
    await _update_record(order_id, path, fields_sent)
    if provider.name == "aluu":
        if identifiers:
            await db.orders.update_one({"id": order_id}, {"$addToSet": {"provider_order_ids": {"$each": identifiers}}})
    else:
        await db.orders.update_one({"id": order_id}, {"$addToSet": {"fazercards_provider_ids": provider_order.id}})
    await audit("fzr.order_created", actor, order_id, {
        "provider_order_id": provider_order.id, "offer_id": line["offer_id"], "line": idx, "component": cidx,
        "supplier_price_usd": line["price_usd"], "idempotency_key": line["idempotency_key"],
        "provider": provider.name})
    if provider.normalize_status(provider_status) in PROVIDER_ALERT_NORMALIZED:
        await audit("fzr.provider_failed", actor, order_id, {"provider_status": provider_status, "line": idx, "component": cidx})
    await _sync_mgs_status(order_id, actor, current=current)
    updated = await db.orders.find_one({"id": order_id}, PUBLIC)
    return unit_record(updated, unit)


async def fulfill_order(order_id: str, actor: str) -> dict:
    """Envoie séquentiellement toutes les unités éligibles. Mono-ligne directe : comportement historique inchangé."""
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    # Configuration ACTUELLE résolue UNE fois (paresseusement) : préflight et liste d'unités la
    # partagent. Elle ne concerne QUE les unités encore sans record — chaque unité déjà créée
    # garde le fournisseur enregistré sur elle (voir `_units_for_line`).
    current = _CurrentProvider(order.get("game_id"))
    report = await preflight(order_id, current=current)
    all_units, _ = await _all_units(order, current=current)
    legacy_single = _is_legacy_single(order, all_units)
    instances: dict[str, object] = {}

    def instance(name: str):
        prov = instances.get(name)
        if prov is None:
            prov = instances[name] = providers.get_provider_by_name(name)
        return prov

    results = []
    for line in report["lines"]:
        line = {**line, "player_name": report.get("player_name")}
        try:
            # FOURNISSEUR DE LA LIGNE (celui de son unité), jamais la config du jeu.
            record = await _fulfill_unit(order, line, actor, instance(line["provider"]),
                                         current=current)
            results.append({"index": line["index"], "component_index": line["component_index"],
                            "product": line["product"], "component_name": line.get("component_name"),
                            "ok": True, "fazercards": record})
        except HTTPException as exc:
            if legacy_single:
                raise
            results.append({"index": line["index"], "component_index": line["component_index"],
                            "product": line["product"], "component_name": line.get("component_name"),
                            "ok": False, "error": str(exc.detail), "status_code": exc.status_code})
    if legacy_single:
        updated = await db.orders.find_one({"id": order_id}, PUBLIC)
        return updated["fazercards"]
    return {"order_number": report["order_number"], "results": results, "skipped": report["skipped"]}


async def refresh_status(order_id: str, actor: str) -> dict:
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Aucune commande fournisseur pour cette commande.")
    current = _CurrentProvider(order.get("game_id"))
    units, _ = await _all_units(order, current=current)
    targets = [(u, unit_record(order, u)) for u in units]
    targets = [(u, r) for u, r in targets if r and r.get("provider_order_id")
               and not r.get("polling_stopped")]
    if not targets:
        raise HTTPException(status_code=404, detail="Aucune commande fournisseur pour cette commande.")
    instances: dict = {}
    failures: list[dict] = []
    for u, rec in targets:
        # FOURNISSEUR DE L'UNITÉ (enregistré à sa création), jamais la configuration du jeu.
        name = _record_provider(rec)
        prov = instances.get(name)
        if prov is None:
            prov = instances[name] = providers.get_provider_by_name(name)
        try:
            provider_order = await prov.get_order(rec["provider_order_id"])
        except providers.ProviderError as exc:
            if exc.status_code == 410:
                # ALUU demande d'arrêter d'interroger cet identifiant : statut conservé.
                await _update_record(order_id, u["path"], {"polling_stopped": True,
                                                           "last_error": exc.message})
            await audit("fzr.refresh_error", actor, order_id,
                        {"provider": name, "provider_order_id": rec["provider_order_id"],
                         "code": exc.code, "http": exc.status_code,
                         "line": u["line_index"], "component": u["component_index"]})
            failures.append({"line": u["line_index"], "component": u["component_index"],
                             "provider": name, "status_code": exc.status_code,
                             "code": exc.code, "error": exc.message})
            continue
        provider_status = provider_order.status or rec.get("provider_status") or "processing"
        await _update_record(order_id, u["path"], {"provider_status": provider_status})
        if prov.normalize_status(provider_status) in PROVIDER_ALERT_NORMALIZED:
            await audit("fzr.provider_failed", actor, order_id, {"provider_status": provider_status, "line": u["line_index"], "component": u["component_index"]})
    if failures and len(failures) == len(targets):
        # Aucune unité n'a pu être rafraîchie : erreur explicite, jamais un statut périmé muet.
        raise HTTPException(status_code=502,
                            detail=f"Rafraîchissement impossible pour {len(targets)} unité(s) : {failures[0]['error']}")
    await _sync_mgs_status(order_id, actor, current=current)
    updated = await db.orders.find_one({"id": order_id}, PUBLIC)
    if _is_legacy_single(updated, units):
        return updated["fazercards"]
    result = {"lines": [{"index": u["line_index"], "component_index": u["component_index"],
                         "fazercards": unit_record(updated, u)} for u, _ in targets]}
    if failures:
        result["errors"] = failures
    return result


async def _sync_mgs_status(order_id: str, actor: str, *, current=None):
    """paid → delivered UNIQUEMENT quand TOUTES les unités (composants inclus) sont completed fournisseur."""
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order or order.get("status") != "paid":
        return
    units, skipped = await _all_units(order, current=current)
    if not units or skipped:
        return
    instances: dict = {}

    def completed(record: dict) -> bool:
        name = _record_provider(record)
        prov = instances.get(name)
        if prov is None:
            try:
                prov = instances[name] = providers.get_provider_by_name(name)
            except providers.ProviderError:
                return False  # fournisseur inconnu : jamais considéré comme livré
        return prov.normalize_status(record.get("provider_status")) == OrderStatus.COMPLETED

    records = [unit_record(order, u) for u in units]
    if not all(r and completed(r) for r in records):
        return
    res = await db.orders.update_one(
        {"id": order_id, "status": "paid"},
        {"$set": {"status": "delivered", "updated_at": _now()},
         "$push": {"history": {"status": "delivered", "at": _now()}}})
    if res.modified_count:
        # Note d'audit neutre : la commande peut avoir été livrée par n'importe quel fournisseur.
        note = f"{_recorded_provider(order) or 'fazercards'} completed"
        await audit("order.status_change", actor, order_id, {"from": "paid", "to": "delivered", "note": note})


async def auto_fulfill(order: dict):
    """Mode automatique (kill switch admin). Ne bloque jamais la confirmation de paiement."""
    try:
        if not await auto_enabled() or not await eligible_lines(order):
            return
        await fulfill_order(order["id"], "auto")
        logger.info("fzr auto fulfillment submitted for %s", order["order_number"])
    except HTTPException as exc:
        logger.warning("fzr auto fulfillment refused for %s: %s", order.get("order_number"), exc.detail)
        await audit("fzr.auto_fulfill_refused", "auto", order.get("id"), {"detail": str(exc.detail)[:200]})
    except Exception as exc:
        logger.warning("fzr auto fulfillment error for %s (%s)", order.get("order_number"), type(exc).__name__)


async def _target_unit(order: dict, provider_name: str | None,
                       provider_order_id: str) -> tuple[dict | None, dict | None]:
    """(unité, record) qui répond à un identifiant fournisseur, ou `(None, None)`.

    `provider_name` restreint la recherche aux unités DE CE FOURNISSEUR : un identifiant est
    propre au fournisseur qui l'a émis, et deux fournisseurs peuvent en principe en partager
    un. Une unité dont le record appartient à l'autre fournisseur ne répond donc jamais.
    """
    units, _ = await _all_units(order)
    candidates = [(u, unit_record(order, u)) for u in units]
    if provider_name:
        wanted = provider_name.strip().lower()
        candidates = [(u, r) for u, r in candidates if r and _record_provider(r) == wanted]
    for unit, record in candidates:
        if _unit_matches(record, provider_order_id):
            return unit, record
    return None, None


async def _apply_status_event(order: dict, unit: dict, provider_name: str, status: str,
                              actor: str) -> bool:
    """Applique un statut fournisseur à UNE unité (webhook ou rafraîchissement).

    Partagé avec le webhook ALUU (Lot 5) : le fournisseur vient du RECORD de l'unité, jamais de
    la configuration courante du jeu.

    MONOTONIE : un statut MGS final (`completed` / `failed` / `refund`) déjà enregistré n'est
    jamais remplacé par un autre statut. Un webhook tardif ou réordonné ne peut donc pas
    « dé-livrer » une unité. Retourne `False` quand l'écriture a été refusée pour ce motif.
    """
    prov = providers.get_provider_by_name(provider_name)
    record = unit_record(order, unit) or {}
    current = prov.normalize_status(record.get("provider_status"))
    incoming = prov.normalize_status(status)
    if current in FINAL_STATUSES and incoming != current:
        await audit("fzr.webhook_stale", actor, order["id"],
                    {"provider": provider_name, "provider_order_id": record.get("provider_order_id"),
                     "kept_status": record.get("provider_status"), "ignored_status": status,
                     "line": unit["line_index"], "component": unit["component_index"]})
        return False
    await _update_record(order["id"], unit["path"], {"provider_status": status})
    if prov.normalize_status(status) in PROVIDER_ALERT_NORMALIZED:
        await audit("fzr.provider_failed", actor, order["id"],
                    {"provider_status": status, "line": unit["line_index"],
                     "component": unit["component_index"]})
    await _sync_mgs_status(order["id"], actor)
    return True


async def apply_webhook_event(event: dict, *, provider_name: str | None = None) -> dict:
    """order.created / order.status_changed → synchronise l'unité concernée. Dédupliqué par event_id.

    Chemin FAZERCARDS (inchangé) : la dédup s'appuie sur l'`event_id` fourni par FazerCards.
    Le webhook ALUU n'en transporte pas : il passe par `apply_provider_event`.

    `provider_name` restreint la recherche d'unité au fournisseur qui a ÉMIS l'événement : un
    identifiant est propre à un fournisseur, et deux fournisseurs peuvent en principe en
    partager un. La route FazerCards passe `"fazercards"` ; la route ALUU passe `"aluu"`.
    Absent = pas de filtre (compatibilité des appelants existants).
    """
    data = event.get("data") or {}
    provider_order_id = data.get("order_id")
    if not provider_order_id:
        return {"ok": True, "ignored": True}
    try:
        await db.fzr_webhook_events.insert_one({
            "event_id": event.get("event_id") or str(uuid.uuid4()), "event": event.get("event"),
            "provider_order_id": provider_order_id, "status": data.get("status"), "created_at": _now()})
    except Exception:
        return {"ok": True, "duplicate": True}
    order = await db.orders.find_one({"$or": [{"fazercards.provider_order_id": provider_order_id},
                                              {"fazercards_provider_ids": provider_order_id},
                                              {"provider_order_ids": provider_order_id},
                                              {"aluu_order_id": provider_order_id}]}, PUBLIC)
    if not order:
        return {"ok": True, "ignored": True}
    target, _record = await _target_unit(order, provider_name, provider_order_id)
    if target is None:
        return {"ok": True, "ignored": True}
    if event.get("event") == "order.status_changed" and data.get("status"):
        provider_status = str(data["status"])
        unit_provider = _record_provider(unit_record(order, target))
        await _apply_status_event(order, target, unit_provider, provider_status, f"webhook:{unit_provider}")
        await audit("fzr.webhook_status", unit_provider, order["id"],
                    {"provider_order_id": provider_order_id, "status": provider_status,
                     "previous_status": data.get("previous_status"), "line": target["line_index"], "component": target["component_index"]})
    return {"ok": True}


async def apply_provider_event(*, provider_name: str, provider_order_id: str | None,
                               status: str | None, event: str | None = None,
                               raw: dict | None = None) -> dict:
    """Webhook ALUU (lot 5) — dédup sur `(provider, provider_order_id, status)` + monotonie.

    Différences ASSUMÉES avec `apply_webhook_event` (chemin FazerCards, laissé intact) :
    - **dédup** : un webhook ALUU ne porte ni `event_id` ni date de mise à jour fournisseur.
      La seule information stable est le triplet `(fournisseur, commande, statut)` ; c'est lui
      qui est inséré dans `provider_webhook_events` (index unique). Un rejeu du même statut est
      donc un doublon, sans jamais réécrire l'unité.
    - **monotonie** : un statut final déjà enregistré n'est jamais remplacé (voir
      `_apply_status_event`).
    - **double barrière fournisseur** : la route est dédiée à ALUU (barrière 1) et la recherche
      d'unité filtre sur le fournisseur ENREGISTRÉ (barrière 2).

    Aucun retry, aucun polling : l'événement est appliqué une fois puis acquitté (2xx), y
    compris quand la commande est inconnue (la doc demande de ne pas compter sur un renvoi).
    """
    provider = (provider_name or "").strip().lower()
    order_key = str(provider_order_id or "").strip()
    raw_status = str(status or "").strip()
    if not provider or not order_key or not raw_status:
        return {"ok": True, "ignored": True}
    try:
        await db.provider_webhook_events.insert_one({
            "provider": provider, "provider_order_id": order_key, "status": raw_status,
            "event": event, "created_at": _now()})
    except Exception:
        return {"ok": True, "duplicate": True}
    order = await db.orders.find_one({"$or": [{"fazercards.provider_order_id": order_key},
                                              {"fazercards_provider_ids": order_key},
                                              {"provider_order_ids": order_key},
                                              {"aluu_order_id": order_key}]}, PUBLIC)
    if not order:
        return {"ok": True, "ignored": True}
    target, _record = await _target_unit(order, provider, order_key)
    if target is None:
        return {"ok": True, "ignored": True}
    applied = await _apply_status_event(order, target, provider, raw_status, f"webhook:{provider}")
    if not applied:
        return {"ok": True, "ignored": True}
    await audit("fzr.webhook_status", provider, order["id"],
                {"provider_order_id": order_key, "status": raw_status, "event": event,
                 "line": target["line_index"], "component": target["component_index"]})
    return {"ok": True}

