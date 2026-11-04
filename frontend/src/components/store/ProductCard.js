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
export const typeLabel = (product, game, lang) => {
  if (product.type === "prime_plus") return "Prime+";
  if (product.type === "prime") return "Prime";
  if (product.type === "evo") return "Évolutif";
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
  const contextLabel = context === "popular" ? "Populaire" : context === "evo" ? "Elite Pack" : product.type === "prime_plus" ? "Abonnement" : product.type === "prime" ? "Abonnement" : `Pack ${currencyLabel}`;
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

  return (
    <article data-testid={`product-card-${product.slug}`} className={`product-card group relative flex min-w-0 h-full mgs-card flex-col rounded-[28px] border-2 border-[color:var(--card-border)] bg-[color:var(--card-surface)] p-3 sm:p-5 shadow-none transition duration-200 ease-out hover:shadow-[4px_4px_0_var(--card-shadow)] hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${available ? "" : "grayscale"}`}>
      <Link to={`/produit/${product.slug}`} className="absolute inset-0 z-0 rounded-[28px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[color:var(--card-focus)]" aria-label={product.name || product.slug || "Produit"} />
      <div className="relative z-10 flex h-full flex-col text-[color:var(--card-ink)]">
        <div className="flex items-start justify-between gap-1.5 sm:gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-3">
            {showPopular && (
              <span data-testid={`card-context-${product.slug}`} className="inline-flex items-center gap-1.5 rounded-full border border-ink bg-[color:var(--card-badge-bg)] px-[9px] py-1 font-body text-[10px] font-bold uppercase leading-none tracking-[0.08em] text-ink text-[color:var(--neo-text)]"><Icon name={contextIcon} className="h-3 w-3" />{contextLabel}</span>
            )}
          </div>
          <button type="button" aria-label={`${favorites.includes(product.id) ? t("product.removeFavorite") : t("product.addFavorite")} : ${product.name || product.slug}`} aria-pressed={favorites.includes(product.id)} onClick={handleToggleFavorite} className={`relative before:absolute before:-inset-1.5 before:content-[''] grid aspect-square h-8 w-8 shrink-0 place-items-center !rounded-full border border-ink bg-ink text-white transition duration-150 hover:scale-105 hover:bg-red-500 active:scale-95 aria-[pressed=true]:bg-red-500 aria-[pressed=true]:[&_svg]:fill-white ${focus}`}><Icon name="heart" className="h-4 w-4" /></button>
        </div>

        {hasFigure ? (
          // Carte monnaie : UNE seule vedette — le montant. Le nom du produit
          // reste accessible aux lecteurs d'écran uniquement (MGS-FE-CARDS-20261104-02).
          <>
            <h2 className="sr-only">{product.name || product.slug}</h2>
            <p className={"mt-2 flex min-w-0 items-baseline gap-1 font-display font-extrabold tracking-tighter " + (figureLength >= 5 ? "text-2xl min-[400px]:text-3xl sm:text-4xl" : figureLength >= 4 ? "text-3xl min-[400px]:text-4xl sm:text-5xl" : "text-4xl min-[400px]:text-5xl sm:text-6xl")}>
              {/* Le montant ne doit JAMAIS être coupé : c'est la vedette. */}
              <span className="shrink-0 leading-none">{figure}</span>
              {/* Unité : 11 px / interligne 1 comme le modèle — sans leading-none
                  elle hérite du 40 px du text-4xl et gonfle le bloc vedette. */}
              <span className={"min-w-0 truncate font-bold uppercase leading-none tracking-[-0.01em] text-[color:var(--card-ink-muted)] text-[11px] " + (unit.length > 4 ? "sm:text-base" : "sm:text-xl")}>{unit}</span>
            </p>
          </>
        ) : (
          // Carte pack (sans montant) : le titre est la vedette, précédé d'une
          // étiquette de catégorie discrète. Aucune hauteur minimale.
          <>
            <p className="mt-3 font-body text-[10px] font-bold uppercase leading-3 tracking-[0.08em] text-[color:var(--card-ink-muted)] sm:text-xs">{t(categoryKey)}</p>
            <h2 className="mt-1 line-clamp-2 break-words font-display text-[18px] font-extrabold leading-5 tracking-[-0.02em] [text-wrap:balance] sm:text-[20px] sm:leading-6">{product.name || product.slug}</h2>
          </>
        )}

        {/* Bloc du bas (MGS-FE-CARDS-20261104-02B) : comme le `.mc-bottom` du
            modèle — mt-auto + 12 px au-dessus, remise puis pastille. */}
        <div className="mt-auto pt-3">
          {showDiscountLine ? (
            <div className="flex items-center gap-2 pb-1.5">
              <span data-testid={`card-discount-${product.slug}`} className="shrink-0 rounded-full border border-ink bg-neo px-2 py-0.5 font-body text-[11px] font-bold leading-4 text-ink">-{discount}%</span>
              <span className="min-w-0 font-body text-xs font-semibold line-through text-[color:var(--card-ink-muted)]">{formatAr(oldPrice)}</span>
            </div>
          ) : null}

        {/* La pastille de prix peint un fond blanc FIXE (`--card-pill-bg`) : son
            texte doit donc etre une encre fixe (`text-ink`), sinon il suit le
            theme et tombe a 1,12:1 sur le blanc en mode sombre. */}
        <div className={`flex h-[48px] min-w-0 items-center justify-between gap-1 rounded-[9999px] border-2 border-[color:var(--card-border)] sm:h-[54px] sm:gap-2 ${qty > 0 ? "bg-ink p-1" : available ? "bg-[color:var(--card-pill-bg)] py-1 pl-3 pr-0.5 text-[color:var(--card-ink)]" : "border-dashed bg-transparent px-2 sm:px-3"}`}>
          {!available ? (
            <span className="font-body text-sm font-bold uppercase tracking-wide">Indisponible</span>
          ) : qty > 0 ? (
            <>
              <button type="button" aria-label={`${qty === 1 ? "Retirer du panier" : "Retirer un exemplaire"} : ${product.name || product.slug}`} onClick={handleDecrease} className={`grid aspect-square h-7 w-7 shrink-0 place-items-center !rounded-full bg-neo text-ink transition hover:scale-105 active:scale-95 disabled:opacity-40 ${focus}`}>
                <Icon name={qty === 1 ? "trash" : "minus"} />
              </button>
              <span className="min-w-0 text-center font-body text-sm font-bold leading-tight text-neo" aria-live="polite"><span className="font-display text-2xl font-extrabold">{qty}</span> au panier</span>
              <button type="button" aria-label={`Ajouter un exemplaire : ${product.name || product.slug}`} disabled={qty >= max} onClick={handleIncrease} className={`grid aspect-square h-7 w-7 shrink-0 place-items-center !rounded-full bg-neo text-ink transition hover:scale-105 active:scale-95 disabled:opacity-40 ${focus}`}>
                <Icon name="plus" />
              </button>
            </>
          ) : (
            <>
              {/* Le prix ne doit JAMAIS être coupé : whitespace-nowrap, pas de truncate.
                  mgs-card-price : 14px en container query sous 170px de carte (index.css). */}
              <div className="flex min-w-0 flex-1 items-center gap-1"><span className="mgs-card-price min-w-0 whitespace-nowrap font-display font-extrabold leading-none tracking-normal text-base sm:text-2xl">{formatAr(product.price)}</span></div>
              <button type="button" aria-label={`Ajouter au panier : ${product.name || product.slug}`} onClick={handleAdd} className={`relative before:absolute before:-inset-0.5 before:content-[''] grid aspect-square h-10 w-10 shrink-0 place-items-center !rounded-full bg-[color:var(--card-cta-bg)] text-[color:var(--card-cta-fg)] transition duration-150 hover:scale-105 active:scale-95 ${focus}`}>
                <Icon name={actionIconName} />
              </button>
            </>
          )}
        </div>
        </div>
      </div>
    </article>
  );
}
