import { Link } from "react-router-dom";
import { useCart, SUBSCRIPTION_TYPES } from "@/context/CartContext";
import { useFavorites } from "@/lib/favorites";
import { useLang } from "@/context/LanguageContext";
import { useGames } from "@/context/GameContext";
import { currencyOf, gameOf, productFigure, typeLabel as gameTypeLabel } from "@/lib/catalog";
import { formatAr } from "@/lib/api";
import { addFeedback } from "@/context/CartContext";
import { toast } from "sonner";

const ICONS = {
  plus: <path d="M12 5v14M5 12h14" strokeWidth="3.2" strokeLinecap="round" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />,
  cart: <><path d="M3 4h2.5l2 11h10l2-8H7" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /><circle cx="9.5" cy="19.5" r="1.4" fill="currentColor" stroke="none" /><circle cx="17" cy="19.5" r="1.4" fill="currentColor" stroke="none" /></>,
  flame: <path d="M12 3c1 3.5 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .3 1.2 1 1.8 1.8 2C10.5 8.5 11 5.5 12 3z" fill="currentColor" stroke="none" />,
  bolt: <path d="M13 2 5 13h6l-1 9 8-11h-6l1-9z" fill="currentColor" stroke="none" />,
  crown: <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z" fill="currentColor" stroke="none" />,
  minus: <path d="M5 12h14" strokeWidth="3.2" strokeLinecap="round" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v6M14 11v6" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  heart: <path d="M12 20.5s-8-4.7-8-10.2A4.3 4.3 0 0 1 12 7.8a4.3 4.3 0 0 1 8 2.5c0 5.5-8 10.2-8 10.2z" strokeWidth="2.4" strokeLinejoin="round" />,
  check: <path d="M5 12l7 7 10-10" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />,
};

// Badge de type de la carte : abonnements/évolutif inchangés ; sinon la monnaie
// DU JEU (PUBG « UC » comme avant, Free Fire « Diamants », CODM « CP »…) — jamais de « UC » codé en dur.
export const typeLabel = (product, game, lang, t) => {
  if (product.type === "prime_plus") return t("catalog.prime_plus");
  if (product.type === "prime") return t("catalog.prime");
  if (product.type === "evo") return t("product.typeEvo");
  return currencyOf(game) || gameTypeLabel(game, product.type, lang);
};

function Icon({ name, className = "h-5 w-5" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} aria-hidden="true">{ICONS[name]}</svg>;
}

export const productName = (product, lang) => (lang === "en" && product.name_en ? product.name_en : product.name);

export function ProductCard({ product, index = 0, badge }) {
  const { t, lang } = useLang();
  const { games } = useGames();
  const { items, add, setQty, remove, open, setOpen } = useCart();
  const [favorites, toggleFavorite] = useFavorites();
  const game = (games || []).find((g) => g.id === gameOf(product));
  const currencyLabel = currencyOf(game) || gameTypeLabel(game, product.type, lang);
  const productInCart = items.find((item) => item.id === product.id);
  const qty = productInCart ? productInCart.qty : 0;
  const showCart = qty > 0;
  const available = product.purchasable !== false;
  // Même règle que le panier (CartContext) : abonnements Prime/Prime+ et évo = 1 max,
  // jetons de monnaie de TOUT jeu = plafond 20 (jamais « type === "uc" »).
  const single = SUBSCRIPTION_TYPES.includes(product.type) || product.type === "evo";
  const max = single ? 1 : 20;
  const oldPrice = Number(product.old_price);
  const price = Number(product.price);
  const discount = oldPrice > price ? Math.round((1 - price / oldPrice) * 100) : 0;
  const showDiscount = discount >= 5;
  // Ligne de remise au-dessus de la pastille (badge + ancien prix barre) :
  // la pastille de prix reste reservee au prix courant.
  const showDiscountLine = available && showDiscount;
  // Montant vedette : toute monnaie de jeu (PUBG « UC », Free Fire « Diamants »,
  // CODM « CP »…) via productFigure, pas seulement `type === "uc"`.
  const isCurrency = Boolean(product.uc_amount);
  const hasFigure = isCurrency || Boolean(product.duration_months);
  const valueUnit = hasFigure ? productFigure(product, game, lang) : { value: null, unit: "" };
  const figure = valueUnit.value;
  const unit = valueUnit.unit;
  const figureLength = figure ? figure.toString().length : 0;
  // Étiquette de catégorie des cartes SANS montant (MGS-FE-CARDS-20261104-02) :
  // prime/prime_plus → « abonnement », evo → « pack évolutif », reste → « pack ».
  const categoryKey = product.type === "prime" || product.type === "prime_plus" ? "card.category.subscription" : product.type === "evo" ? "card.category.evo" : "card.category.pack";
  const context = badge || (product.popular ? "popular" : product.type === "evo" ? "evo" : "offer");
  const contextIcon = context === "popular" ? "flame" : context === "evo" ? "crown" : product.type === "prime" || product.type === "prime_plus" ? "bolt" : "cart";
  const contextLabel = context === "popular" ? t("catalog.popular") : context === "evo" ? t("card.context.evo") : product.type === "prime_plus" || product.type === "prime" ? t("card.category.subscription") : t("card.packCurrency", { currency: currencyLabel });
  // Seuls les badges de type / de categorie sont retires : la carte n'affiche
  // plus que « Populaire » (flamme), la remise et « Indisponible ».
  const showPopular = context === "popular";
  const focus = "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[color:var(--card-focus)]";
  // « + » sur toutes les pastilles (modèle visuel -02B), l'evo garde son panier.
  const actionIconName = product.type === "evo" ? "cart" : "plus";

  const handleAdd = () => {
    const addResult = add(product);
    addFeedback(addResult, t, toast, setOpen);
  };

  const handleIncrease = () => {
    if (qty < max) {
      setQty(product.id, qty + 1);
    }
  };

  const handleDecrease = () => {
    if (qty > 0) {
      setQty(product.id, qty - 1);
    }
  };

  const handleToggleFavorite = () => {
    toggleFavorite(product.id);
  };

  // PL-DS-V3 — structure EXACTE de la carte du prototype design-system-v3.html :
  // .mgs-pcard > __link + __top (badge flamme + cœur favori) + __figure
  // (montant vedette + unité) + __bottom (remise puis .mgs-pill prix + « + » /
  // .mgs-stepper). Logique quantité, testids, aria-labels inchangés ; zones
  // tactiles 44 px conservées par pseudo-élément.
  return (
    <article data-testid={`product-card-${product.slug}`} className={`mgs-pcard h-full ${available ? "" : "is--unavailable grayscale"}`}>
      <Link to={`/produit/${product.slug}`} className="mgs-pcard__link" aria-label={product.name || product.slug || t("product.fallbackLabel")} />
      <div className="mgs-pcard__top">
        {showPopular ? (
          <span data-testid={`card-context-${product.slug}`} className="mgs-pcard__badge"><Icon name={contextIcon} className="bold-ic" />{contextLabel}</span>
        ) : <span aria-hidden="true" />}
        <button type="button" aria-label={`${favorites.includes(product.id) ? t("product.removeFavorite") : t("product.addFavorite")} : ${product.name || product.slug}`} aria-pressed={favorites.includes(product.id)} onClick={handleToggleFavorite} className="mgs-pcard__fav relative before:absolute before:-inset-1.5 before:content-['']"><Icon name="heart" className="bold-ic h-4 w-4" /></button>
      </div>

      {hasFigure ? (
        <>
          <h3 className="sr-only">{product.name || product.slug}</h3>
          <p className="mgs-pcard__figure"><span className={`mgs-pcard__amount shrink-0 ${figureLength >= 5 ? "is--long" : ""}`}>{figure}</span><span className="mgs-pcard__unit min-w-0 truncate">{unit}</span></p>
        </>
      ) : (
        <>
          <p className="mgs-pcard__cat uppercase">{t(categoryKey)}</p>
          <h3 className="mgs-pcard__title line-clamp-2 [text-wrap:balance]">{product.name || product.slug}</h3>
        </>
      )}

      <div className="mgs-pcard__bottom mt-auto pt-3">
        {showDiscountLine ? (
          <div className="mgs-pcard__old">
            <span data-testid={`card-discount-${product.slug}`} className="mgs-pcard__badge mgs-pcard__badge--disc">-{discount}%</span>
            <s className="line-through">{formatAr(oldPrice, lang)}</s>
          </div>
        ) : null}
        <div className={`mgs-pill ${qty > 0 ? "is--incart" : ""}`}>
          {!available ? (
            <span className="mgs-pill__price whitespace-nowrap">{t("product.unavailable")}</span>
          ) : (
            <>
              <span className="mgs-pill__price whitespace-nowrap">{formatAr(product.price, lang)}</span>
              <button type="button" aria-label={`${t("product.addToCart")} : ${product.name || product.slug}`} onClick={handleAdd} className="mgs-pill__add relative before:absolute before:-inset-0.5 before:content-['']"><Icon name={actionIconName} className="bold-ic" /></button>
              <div className="mgs-stepper">
                <button type="button" aria-label={`${qty === 1 ? t("cart.removeFromCart") : t("cart.removeOneFromCart")} : ${product.name || product.slug}`} onClick={handleDecrease} className="mgs-stepper__btn"><Icon name={qty === 1 ? "trash" : "minus"} className="bold-ic" /></button>
                <span className="mgs-stepper__qty" aria-live="polite">{qty}<span className="sr-only"> {t("product.inCartShort")}</span></span>
                <button type="button" aria-label={`${t("product.addOne")} : ${product.name || product.slug}`} disabled={qty >= max} onClick={handleIncrease} className="mgs-stepper__btn"><Icon name="plus" className="bold-ic" /></button>
              </div>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
