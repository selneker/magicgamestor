# Fixtures — lecture du stock Shop2Topup (T02)

Ces fichiers servent aux tests de `backend/services/shop2topup_stock.py`. **Aucun test ne fait d'appel réseau** :
tout se joue sur ces pages.

| Fichier | Origine | Ce qu'il prouve |
|---|---|---|
| `pubg-mobile.html` | **Réel**, `https://shop2topup.com/en/shop/pubg-mobile`, 2026-11-18, HTTP 200, 699 649 octets reçus | 34 offres, 33 `InStock`, 1 `OutOfStock` (`sku` 12 = 10 UC) ; structure `Product → offers (AggregateOffer) → offers[]` ; pas de doublon de `sku` |
| `free-fire-mena-direct-topup.html` | **Réel**, `https://shop2topup.com/en/shop/free-fire/mena-direct-topup`, 2026-11-18, HTTP 200, 644 104 octets reçus | 21 offres, toutes `InStock` ; une sous-page régionale est lisible de la même façon |
| `odd-availability.html` | **Synthétique** | bloc JSON-LD invalide ignoré ; `SoldOut` / `LimitedAvailability` / `PreOrder` / `availability` absente / liste contradictoire ⇒ **non conclu** ; `Product.offers` en liste plate |
| `no-jsonld.html` | **Synthétique** | page anti-bot ou page dont la structure a changé ⇒ dictionnaire vide, aucune exception |

## Ce qui a été retiré des deux fixtures réelles

Seuls les blocs `<script type="application/ld+json">` ont été conservés, **verbatim**. Le reste du document
(JavaScript, CSS, navigation, en-têtes) a été retiré : le lecteur ne lit que ces blocs, donc les garder
n'ajouterait rien et alourdirait le dépôt de ~1,3 Mo.

Vérifié avant écriture : aucun cookie, aucun jeton, aucune clé, aucune donnée de compte dans ces blocs. Les
mots `password`, `bearer`, `api_key`, `token` présents dans la page complète appartiennent au bundle
JavaScript du site, pas aux blocs JSON-LD — d'où le choix de ne garder que les blocs.

## Si une fixture devient fausse

Une fixture réelle vieillit : les prix et les états de stock du fournisseur changent. C'est normal.
Ce qui doit rester vrai, c'est la **forme** (`Product → offers → offers[] → sku` + `availability`).

Pour la rafraîchir, refaire une requête sur la page publique, réextraire les blocs JSON-LD et remplacer le
fichier — sans jamais y mettre de cookie ni d'en-tête de session.
