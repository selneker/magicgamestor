"""PL-006-T02 — lecture du stock publié par le fournisseur de top-up.

Le fournisseur expose, sur ses pages produit **publiques**, un bloc JSON-LD
`schema.org/Product` dont chaque offre porte un `sku` et une `availability`.
C'est la seule source de stock lisible aujourd'hui : elle ne demande ni clé, ni
compte. Ce module la lit et la traduit en un état par SKU — rien de plus. Il ne
décide pas d'un achat, il ne touche à aucune collection : c'est `T06` qui
applique le résultat au catalogue (`availability_sync`).

Trois règles portent tout le module :

1. **On ne conclut que ce qui est explicitement publié.** `InStock` vaut `True`,
   `OutOfStock` vaut `False`, tout le reste (autre valeur, valeur absente,
   valeurs contradictoires) ne vaut **ni l'un ni l'autre** : le SKU est absent du
   résultat. Une page qui change de forme ne peut donc pas vider le catalogue.
2. **Aucune exception ne sort de la lecture.** Une page en échec est comptée dans
   `pages_failed`, jamais propagée : un incident réseau ne doit pas faire échouer
   la tâche de maintenance qui appelle ce module.
3. **La lecture est bornée.** Un délai par requête et un budget total explicites :
   la route cron qui déclenche le relevé ne doit pas expirer à cause de lui.

Le nom du fournisseur n'apparaît dans aucun message destiné au client : les
journaux de ce module restent côté serveur.
"""
import json
import logging
import time
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Iterable, Sequence

import httpx

logger = logging.getLogger("mgs.shop2topup_stock")

BASE_URL = "https://shop2topup.com"
LOCALE = "en"

# Identifiable, conformément à T02 : un relevé qui se présente ne se fait pas confondre avec un navigateur.
USER_AGENT = "MagicGameStore-stock/1.0"

# Budget de la lecture : 10 s par page, 30 s pour l'ensemble. Au-delà, les pages non lues sont
# comptées en échec et la lecture s'arrête — mieux vaut un relevé partiel qu'une route cron qui expire.
REQUEST_TIMEOUT_S = 10.0
TOTAL_BUDGET_S = 30.0

# Pages mesurées le 18/11/2026 (§ 2.3 du plan) : HTTP 200, JSON-LD `Product → offers → offers[]`.
# C'est la liste par défaut de `fetch_stock()`. Les sous-pages Free Fire (`free-fire/eu`, `/sg`…)
# sont lisibles de la même façon, mais leur URL n'a pas été vérifiée une par une : elles ne sont
# donc pas déclarées ici (on n'invente pas d'URL) et se passent explicitement en argument.
KNOWN_PAGES: tuple[str, ...] = ("pubg-mobile", "free-fire/mena-direct-topup")

_SCHEMA_PREFIXES = ("https://schema.org/", "http://schema.org/")

# Valeurs `schema.org` qui ont un sens pour nous. Toute autre valeur n'est pas conclue : voir règle 1.
_AVAILABILITY_IN_STOCK = "instock"
_AVAILABILITY_OUT_OF_STOCK = "outofstock"


@dataclass(frozen=True)
class StockReading:
    """Résultat d'un relevé.

    `states` ne contient **que** les SKU dont l'état a été explicitement publié.
    Un SKU absent de `states` n'est pas « disponible » : il est **inconnu**, et
    l'appelant ne doit rien en faire (T06 : « aucune modification »).

    `pages_ok` / `pages_failed` servent à la santé du relevé : une lecture qui
    échoue en silence est le pire des cas, puisqu'elle laisse croire que tout va
    bien. `unknown_availability` compte les valeurs de disponibilité non
    reconnues, par valeur, pour repérer un changement de vocabulaire du fournisseur.
    """

    states: dict[str, bool] = field(default_factory=dict)
    pages_ok: int = 0
    pages_failed: int = 0
    unknown_availability: dict[str, int] = field(default_factory=dict)

    @property
    def conclusive(self) -> bool:
        """Vrai si au moins une page a été lue ET qu'au moins un SKU a été conclu."""
        return self.pages_ok > 0 and bool(self.states)


class _JsonLdCollector(HTMLParser):
    """Ramasse le contenu brut de chaque `<script type="application/ld+json">`.

    On utilise `html.parser` de la bibliothèque standard plutôt qu'une expression
    régulière sur le HTML : le contenu d'un `<script>` est du texte brut, où un
    `</script>` peut apparaître dans une chaîne, et où les entités HTML ne doivent
    pas être décodées. Découper à la regex casserait ces deux cas.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.blocks: list[str] = []
        self._buffer: list[str] | None = None

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag != "script":
            return
        script_type = (dict(attrs).get("type") or "").strip().lower()
        if script_type == "application/ld+json":
            self._buffer = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._buffer is not None:
            self.blocks.append("".join(self._buffer))
            self._buffer = None

    def handle_data(self, data: str) -> None:
        if self._buffer is not None:
            self._buffer.append(data)


def _normalize_availability(value) -> bool | None:
    """Traduit une valeur `schema.org` en `True` / `False` / `None` (non conclu)."""
    if isinstance(value, (list, tuple)):
        # Une liste contradictoire ne conclut rien : on préfère « inconnu » à un choix arbitraire.
        conclusions = {_normalize_availability(item) for item in value}
        if len(conclusions) == 1:
            return conclusions.pop()
        return None
    if not isinstance(value, str):
        return None
    text = value.strip()
    for prefix in _SCHEMA_PREFIXES:
        if text.lower().startswith(prefix):
            text = text[len(prefix):]
            break
    text = text.strip().strip("/").lower()
    if text == _AVAILABILITY_IN_STOCK:
        return True
    if text == _AVAILABILITY_OUT_OF_STOCK:
        return False
    return None


def _iter_offers(node) -> Iterable[dict]:
    """Parcourt les offres d'un document JSON-LD, quelle que soit leur imbrication.

    La page réelle imbrique `Product.offers` (un `AggregateOffer`) puis `offers[]`.
    Une page peut aussi publier directement une liste d'offres : les deux formes
    sont acceptées, et tout ce qui n'est pas reconnaissable est ignoré.

    On descend dans `offers` dès qu'il existe et on ne retient ensuite que les
    nœuds feuilles portant un `sku` — c'est ce qui distingue une offre d'un
    conteneur (`Product`, `AggregateOffer`). Une offre **sans** `availability` est
    bien retenue : c'est l'appelant qui décide qu'elle ne conclut rien, mais le
    compteur de valeurs inconnues doit la voir.
    """
    if isinstance(node, list):
        for item in node:
            yield from _iter_offers(item)
        return
    if not isinstance(node, dict):
        return

    offers = node.get("offers")
    if offers is not None:
        yield from _iter_offers(offers)
        return

    node_type = node.get("@type")
    if isinstance(node_type, str) and "product" in node_type.lower():
        return
    if "sku" in node:
        yield node


def parse_html(html: str) -> tuple[dict[str, bool], dict[str, int]]:
    """Lit une page et retourne `({sku: bool}, {valeur_non_reconnue: occurrences})`.

    Aucune exception n'est levée : un bloc JSON invalide est ignoré, une page sans
    JSON-LD rend un dictionnaire vide. Si un même SKU est publié deux fois dans la
    page avec des états différents, le dernier gagne et le conflit est journalisé.
    """
    collector = _JsonLdCollector()
    try:
        collector.feed(html)
        collector.close()
    except Exception as exc:  # html.parser est tolérant, mais on ne veut aucune exception qui sorte
        logger.warning("page HTML illisible, aucun état conclu : %s", exc)
        return {}, {}

    states: dict[str, bool] = {}
    unknown: dict[str, int] = {}

    for block in collector.blocks:
        try:
            document = json.loads(block)
        except (ValueError, TypeError) as exc:
            # Un bloc de métadonnées annexe (WebSite, Organization…) peut être tronqué sans que
            # la partie produit le soit : on ignore ce bloc, on ne condamne pas la page.
            logger.warning("bloc JSON-LD ignoré (JSON invalide) : %s", exc)
            continue

        for offer in _iter_offers(document):
            sku = offer.get("sku")
            if not isinstance(sku, str) or not sku.strip():
                continue
            sku = sku.strip()

            verdict = _normalize_availability(offer.get("availability"))
            if verdict is None:
                raw = offer.get("availability")
                if raw is None:
                    label = "<absente>"
                elif isinstance(raw, str):
                    label = raw
                else:
                    label = json.dumps(raw, ensure_ascii=False)
                unknown[label] = unknown.get(label, 0) + 1
                continue

            if sku in states and states[sku] != verdict:
                logger.warning(
                    "SKU %s publié avec deux états contradictoires sur la même page "
                    "(%s puis %s) : le dernier est retenu", sku, states[sku], verdict)
            states[sku] = verdict

    return states, unknown


def page_url(slug: str) -> str:
    """URL publique d'une page produit, à partir de son identifiant (`pubg-mobile`)."""
    return f"{BASE_URL}/{LOCALE}/shop/{slug.strip().strip('/')}"


async def fetch_stock(
    pages: Sequence[str] = KNOWN_PAGES,
    *,
    client: httpx.AsyncClient | None = None,
) -> StockReading:
    """Relève l'état publié pour les pages demandées.

    `pages` est une **liste explicite** d'identifiants de page (`pubg-mobile`,
    `free-fire/mena-direct-topup`…), `KNOWN_PAGES` par défaut : les deux pages vérifiées
    le 18/11. Les sous-pages ne sont pas découvertes en suivant les liens du site — un crawl
    n'a pas de budget borné, et une page peut lier n'importe quoi. Elles se déclarent donc
    une par une, soit ici, soit à l'appel.

    Un identifiant qui n'est pas une chaîne est ignoré, journalisé et compté dans
    `pages_failed` : la lecture ne doit jamais lever sur une entrée mal formée. Un slug
    répété n'est lu qu'une fois, dans l'ordre d'apparition.

    Un SKU publié sur plusieurs pages prend le dernier état lu **sans jamais
    écraser en silence** : un changement d'état entre deux pages est journalisé.

    `client` permet d'injecter un transport (tests). Sans lui, la fonction crée le
    sien et le referme.
    """
    valid: list[str] = []
    invalid = 0
    for raw in pages:
        if not isinstance(raw, str):
            invalid += 1
            logger.warning("page ignorée : identifiant de type %s, aucune requête",
                           type(raw).__name__)
            continue
        slug = raw.strip()
        if slug:
            valid.append(slug)
    # Déduplication en conservant l'ordre : un même slug n'est lu qu'une fois.
    slugs = list(dict.fromkeys(valid))
    if not slugs:
        # Aucun identifiant exploitable : les entrées invalides restent comptées en échec.
        return StockReading(pages_failed=invalid)

    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(
            timeout=REQUEST_TIMEOUT_S,
            headers={"User-Agent": USER_AGENT},
            # Suivre les redirections est délibéré et propre à ce module : le site peut renvoyer
            # une page de langue ou une page déplacée. Ne pas suivre rendrait la lecture
            # dépendante d'une URL qui bouge, alors qu'on veut juger le contenu final.
            follow_redirects=True,
        )

    states: dict[str, bool] = {}
    unknown: dict[str, int] = {}
    pages_ok = 0
    # Les identifiants inexploitables comptent comme des pages en échec : un relevé qui les
    # ignorerait silencieusement laisserait croire que tout a été lu.
    pages_failed = invalid
    deadline = time.monotonic() + TOTAL_BUDGET_S

    try:
        for index, slug in enumerate(slugs):
            if time.monotonic() >= deadline:
                remaining = len(slugs) - index
                pages_failed += remaining
                logger.warning(
                    "budget de lecture épuisé (%.0f s) : %d page(s) non lue(s)",
                    TOTAL_BUDGET_S, remaining)
                break

            url = page_url(slug)
            try:
                # L'en-tête est reposé à chaque requête, et ce n'est pas un doublon : quand un
                # client est injecté (tests), il n'a pas forcément notre User-Agent, et le relevé
                # doit rester identifiable quoi qu'il arrive.
                response = await client.get(url, headers={"User-Agent": USER_AGENT})
                response.raise_for_status()
                html = response.text
            except Exception as exc:
                # Volontairement large : réseau, DNS, TLS, 403 anti-bot, 5xx, délai dépassé.
                # Aucune de ces pannes ne doit remonter jusqu'à la tâche de maintenance.
                pages_failed += 1
                logger.warning("page %s illisible (%s), aucun état conclu pour elle",
                               slug, type(exc).__name__)
                continue

            page_states, page_unknown = parse_html(html)
            if not page_states:
                # Page servie mais sans état exploitable : c'est un échec de lecture, pas un
                # « tout est disponible ». Compter 0 SKU conclu en succès masquerait la panne.
                pages_failed += 1
                logger.warning("page %s lue mais sans aucun SKU conclu (structure changée ?)", slug)
                for label, count in page_unknown.items():
                    unknown[label] = unknown.get(label, 0) + count
                continue

            pages_ok += 1
            for sku, verdict in page_states.items():
                if sku in states and states[sku] != verdict:
                    logger.warning(
                        "SKU %s déjà relevé %s sur une page précédente, %s sur %s : "
                        "le dernier relevé est retenu", sku, states[sku], verdict, slug)
                states[sku] = verdict
            for label, count in page_unknown.items():
                unknown[label] = unknown.get(label, 0) + count

    finally:
        if own_client:
            try:
                await client.aclose()
            except Exception as exc:
                # Une fermeture ratée ne doit pas annuler un relevé déjà effectué : le contrat
                # du module est qu'aucune exception ne sort de la lecture.
                logger.warning("fermeture du client impossible (%s)", type(exc).__name__)

    reading = StockReading(
        states=states,
        pages_ok=pages_ok,
        pages_failed=pages_failed,
        unknown_availability=unknown,
    )
    logger.info(
        "relevé terminé : %d page(s) lue(s), %d en échec, %d SKU conclu(s) (%d disponible(s))",
        reading.pages_ok, reading.pages_failed, len(reading.states),
        sum(1 for v in reading.states.values() if v))
    return reading
