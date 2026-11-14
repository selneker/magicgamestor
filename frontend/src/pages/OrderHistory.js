import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { api, formatAr } from "@/lib/api";
import { paymentLabel, paymentOperatorLabel } from "@/lib/paymentLabels";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useGames } from "@/context/GameContext";
import { addFeedback, useCart } from "@/context/CartContext";
import { BackButton } from "@/components/common/BackButton";
import { CopyButton } from "@/components/store/PaymentFlow";
import { Button } from "@/components/ui/button";

// PL-005-FE-01 — historique des commandes client, d'après la maquette
// `repports/maquettes/apercu-historique-commandes.html` : liste « Mes
// commandes » (/commandes, onglets + cartes arrondies du checkout) et détail
// d'une commande (/commandes/:orderId, montant en grand + statut, carte jeu,
// repli chevron, reçu imprimable, « Commander à nouveau »). Style = cartes
// arrondies existantes (bg-card, bord 1 px, radius 14-18 px) — PAS le style
// carré de l'admin. Aucun appel API nouveau : GET /orders/me et
// GET /orders/{id} (contrats existants), produits relus via GET /products/{slug}
// pour ne jamais commander avec un prix périmé.

// Familles de statut de la maquette : vert = livrée, lime = payée / en cours,
// gris = en attente, rouge = annulée, or = remboursée. Le badge est un
// rectangle bordé (radius 7 px) à FOND TRANSPARENT, texte coloré — jamais une
// pilule pleine. `refunded` n'existe pas encore côté API (les remboursements
// sont un signal fournisseur) : la famille est prête, le libellé traduit est
// en place, la couleur s'affichera le jour où l'API renverra ce statut.
const STATUS_FAMILY = {
  delivered: "done",
  paid: "progress",
  awaiting_verification: "progress",
  proof_submitted: "progress",
  late_payment: "progress",
  pending_payment: "pending",
  expired: "pending",
  cancelled: "cancel",
  failed: "cancel",
  refunded: "refund",
};

// Couleurs : jetons de `index.css` (`--status-*` clair/sombre,
// --muted-foreground, --destructive) — jamais de hex en composant. Classes
// arbitraires LITTÉRALES (pattern ProductCard, `ProductCard.test.js`) :
// Tailwind JIT les génère depuis le source et les tests peuvent les affirmer
// (le prop `style` n'est pas fiable en test — plugin babel visual-edits).
const FAMILY_TEXT = {
  done: "text-[color:var(--status-done)]",
  progress: "text-[color:var(--status-progress)]",
  pending: "text-[color:var(--muted-foreground)]",
  cancel: "text-[color:var(--destructive)]",
  refund: "text-[color:var(--status-refund)]",
};

const FAMILY_BG = {
  done: "bg-[color:var(--status-done)]",
  progress: "bg-[color:var(--status-progress)]",
  pending: "bg-[color:var(--muted-foreground)]",
  cancel: "bg-[color:var(--destructive)]",
  refund: "bg-[color:var(--status-refund)]",
};

// Bordure du badge : 35 % de la couleur de famille sur fond transparent
// (`_` = espace pour le JIT Tailwind, couleur-mix arbitraire).
const FAMILY_BORDER = {
  done: "border-[color:color-mix(in_srgb,var(--status-done)_35%,transparent)]",
  progress: "border-[color:color-mix(in_srgb,var(--status-progress)_35%,transparent)]",
  pending: "border-[color:var(--rule-strong)]",
  cancel: "border-[color:color-mix(in_srgb,var(--destructive)_35%,transparent)]",
  refund: "border-[color:color-mix(in_srgb,var(--status-refund)_35%,transparent)]",
};

// Pastille du moyen de paiement : classes littérales alignées sur
// paymentColor() (`paymentLabels.js`) ; valeur inconnue → sable de marque.
const METHOD_DOT_CLASS = {
  mvola: "bg-[color:var(--mvola)]",
  orange: "bg-[color:var(--orange)]",
  manual: "bg-[color:var(--brand-sand)]",
  binance: "bg-[color:var(--brand-sand)]",
};

// Pastille « Besoin d'aide ? » : affichée seulement si le statut n'est ni
// livrée, ni annulée, ni remboursée (spécification maquette, à la lettre).
export const helpVisibleFor = (status) => !["delivered", "cancelled", "refunded"].includes(status);

// Onglets : filtre LOCAL sur la liste déjà chargée (aucun nouvel appel API).
const STATUS_PROGRESS = ["pending_payment", "awaiting_verification", "proof_submitted", "late_payment", "paid"];
const TAB_FILTERS = {
  all: () => true,
  progress: (s) => STATUS_PROGRESS.includes(s),
  done: (s) => !STATUS_PROGRESS.includes(s),
};

// PL-005-BE-01 — point d'entrée UNIQUE de l'assistant IA support. Le widget
// n'existe pas encore à ce lot : redirection temporaire vers la page de
// support actuelle (/chat), avec { order_id } déjà passé dans l'état de
// navigation. Quand l'assistant sera livré, remplacer CETTE SEULE fonction
// par l'ouverture du widget avec { order_id } en contexte — les trois points
// d'appel (pastille de la liste, bouton Chat du détail, ligne « Besoin
// d'aide avec cette commande ») passent tous par ici.
const openAssistant = (navigate, order) => navigate("/chat", { state: { order_id: order?.id } });

// Nom du jeu (texte seul, aucune icône/pastille — maquette).
const gameNameOf = (order, games) => games.find((g) => g.id === order.game_id)?.name || order.game_id || "";

// Libellés des identifiants joueur (snapshot de la commande, même logique
// que OrderIdentity de OrderTrack.js — jamais supposé « ID PUBG »).
const identityParts = (order, games) => {
  const spec = games.find((g) => g.id === (order.game_id || "pubg-mobile"))?.identity_fields || [];
  const fields = order.identity_snapshot?.fields || { player_id: order.pubg_id };
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
    .map(([k, v]) => `${spec.find((f) => f.key === k)?.label || k} ${v}`);
};

const identityLine = (order, games) => identityParts(order, games).join(" · ");

// Libellé du moyen de paiement : l'opérateur persisté (`manual_operator`)
// prime pour les commandes manuelles, sinon le libellé de la méthode.
const methodLabel = (order, t) =>
  order.payment_method === "manual" && order.manual_operator
    ? paymentOperatorLabel(order.manual_operator)
    : paymentLabel(order.payment_method, t);

// Date courte « 13 nov. 16:30 », dans la langue de l'interface (date et heure
// formatées séparément : `toLocaleString` insère une virgule en fr-FR,
// « 13 nov., 16:30 », que la maquette n'a pas).
const dateShort = (iso, lang) => {
  const d = new Date(iso);
  const loc = lang === "en" ? "en-GB" : "fr-FR";
  const date = d.toLocaleDateString(loc, { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
};

// Badge de statut : rectangle bordé, radius 7 px, fond transparent, texte
// coloré selon la famille (maquette « comme Binance » — jamais une pilule
// pleine).
export function OrderStatusBadge({ status }) {
  const { t } = useLang();
  const family = STATUS_FAMILY[status] || "pending";
  return (
    <span
      data-testid={`order-badge-${status}`}
      className={`inline-flex flex-none items-center whitespace-nowrap rounded-[7px] border bg-transparent px-[9px] py-1 text-[11px] font-extrabold ${FAMILY_BORDER[family]} ${FAMILY_TEXT[family]}`}
    >
      {t(`order.status.${status}`)}
    </span>
  );
}

// Onglets « Toutes / En cours / Terminées » (filtre local, aucun nouvel
// appel API) : souligné 2 px sous l'onglet actif (bg-primary = lime en
// sombre, encre en clair — même pattern que les accents du site).
function Tabs({ tab, setTab }) {
  const { t } = useLang();
  return (
    <div className="mt-2 flex gap-4" role="tablist" aria-label={t("account.orders")}>
      {["all", "progress", "done"].map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          data-testid={`orders-tab-${key}`}
          onClick={() => setTab(key)}
          className={`relative flex min-h-[44px] items-center text-[13px] font-bold ${tab === key ? "text-foreground" : "text-muted-foreground"}`}
        >
          {t(`order.tabs.${key}`)}
          {tab === key && (
            <span aria-hidden="true" className="absolute inset-x-0 bottom-[9px] h-0.5 rounded-[2px] bg-primary" />
          )}
        </button>
      ))}
    </div>
  );
}

// Carte de la liste (maquette écran 1) : jeu + produit en texte, badge à
// droite, montant / méthode, numéro + copie / date, pastille d'aide. Toute
// la carte est cliquable (lien étiré, la copie et la pastille au-dessus).
function HistoryCard({ order }) {
  const { t, lang } = useLang();
  const { games } = useGames();
  const navigate = useNavigate();
  const products = (order.items || []).map((i) => (lang === "en" && i.name_en ? i.name_en : i.name)).join(" + ");
  const open = () => navigate(`/commandes/${order.id}`);
  return (
    <article data-testid={`order-history-card-${order.order_number}`} className="relative rounded-[18px] border bg-card p-3.5">
      <Link
        to={`/commandes/${order.id}`}
        data-testid={`order-history-open-${order.order_number}`}
        aria-label={`${t("order.title")} ${order.order_number}`}
        className="absolute inset-0 rounded-[18px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-foreground"
      />
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-bold leading-snug">{gameNameOf(order, games)} — {products}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{identityLine(order, games)}</p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>
      <div className="mt-2.5 flex items-baseline justify-between gap-2">
        <span className="num text-[15.5px] font-extrabold">{formatAr(order.total)}</span>
        <span className="text-[12.5px] text-muted-foreground">{methodLabel(order, t)}</span>
      </div>
      <div className="mt-2.5 flex items-center gap-1 border-t border-[color:var(--rule)] pt-2">
        <span className="num text-[11.5px] text-muted-foreground">{order.order_number}</span>
        <CopyButton value={order.order_number} label={t("order.copyNumber")} testId={`order-copy-${order.order_number}`} />
        <span className="ml-auto text-[11px] text-muted-foreground">{dateShort(order.created_at, lang)}</span>
      </div>
      {helpVisibleFor(order.status) && (
        <button
          type="button"
          onClick={() => openAssistant(navigate, order)}
          data-testid={`order-help-${order.order_number}`}
          className="relative z-10 mt-2.5 inline-flex min-h-[32px] items-center gap-1.5 rounded-[8px] border border-[color:var(--rule-strong)] bg-muted px-2.5 py-1.5 text-[11.5px] font-extrabold text-foreground"
        >
          <span aria-hidden="true" className="text-[12px] leading-none">💬</span>
          {t("order.helpAsk")}
        </button>
      )}
    </article>
  );
}

// Écran 1 — liste « Mes commandes » (/commandes).
export default function OrderHistory() {
  const { t } = useLang();
  const { user } = useAuth();
  const [orders, setOrders] = useState(null);
  const [tab, setTab] = useState("all");

  // Une seule source : GET /orders/me (liste complète, 200 dernières).
  // Les onglets filtrent localement — aucun paramètre de statut n'existe
  // côté API et aucun nouvel appel n'est déclenché au changement d'onglet.
  useEffect(() => {
    if (!user) return;
    let active = true;
    api.get("/orders/me")
      .then(({ data }) => { if (active) setOrders(Array.isArray(data) ? data : []); })
      .catch(() => { if (active) setOrders([]); });
    return () => { active = false; };
  }, [user]);

  const filtered = (orders || []).filter((o) => TAB_FILTERS[tab](o.status));

  return (
    <div className="mx-auto w-full max-w-[480px] px-4 pb-16 pt-4" data-testid="order-history-page">
      <h1 className="font-display text-[19px] font-extrabold">{t("account.orders")}</h1>
      <Tabs tab={tab} setTab={setTab} />
      {orders === null ? null : filtered.length === 0 ? (
        <p className="mt-4 rounded-[18px] border bg-card p-5 text-sm text-muted-foreground" data-testid="orders-empty">
          {t("order.historyEmpty")}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {filtered.map((o) => <HistoryCard key={o.id} order={o} />)}
        </div>
      )}
    </div>
  );
}

// Reçu imprimable : construit UNIQUEMENT à partir des données déjà affichées
// sur la page (aucune route backend, aucune dépendance). Caché à l'écran
// (`hidden`), seule vue peinte à l'impression (voir `@media print` dans
// index.css, activé par `body.receipt-print`). Logo = texte de marque, mise
// en page simple, couleurs papier/encre fixes.
function OrderReceipt({ order }) {
  const { t, lang } = useLang();
  const { games } = useGames();
  const row = (label, value, testId) => (
    <div className="flex items-baseline justify-between gap-4 py-1.5" style={{ borderBottom: "1px solid var(--receipt-line)" }}>
      <span style={{ color: "var(--receipt-muted)" }}>{label}</span>
      <span className="text-right font-bold" data-testid={testId}>{value}</span>
    </div>
  );
  return (
    <div className="order-receipt hidden" data-testid="order-receipt-view" aria-hidden="true">
      <p className="text-[13px] font-black uppercase tracking-[0.18em]">{t("account.pubgCard.brand")}</p>
      <p className="mt-2 text-[20px] font-extrabold">{t("order.receipt.title")}</p>
      <div className="mt-3">
        {row(t("order.number"), order.order_number, "receipt-number")}
        {row(t("order.date"), new Date(order.created_at).toLocaleString(lang === "en" ? "en-GB" : "fr-FR"), "receipt-date")}
        {row(t("order.receipt.status"), t(`order.status.${order.status}`), "receipt-status")}
        {row(t("order.receipt.game"), gameNameOf(order, games), "receipt-game")}
        {row(t("order.receipt.product"), (order.items || []).map((i) => `${i.quantity} × ${lang === "en" && i.name_en ? i.name_en : i.name}`).join(" + "), "receipt-product")}
        {row(t("order.receipt.playerId"), identityLine(order, games), "receipt-player")}
        {row(t("order.receipt.method"), methodLabel(order, t), "receipt-method")}
        {(order.payment_fee ?? 0) > 0 && row(t("order.receipt.fee"), formatAr(order.payment_fee), "receipt-fee")}
        {row(t("order.receipt.amount"), formatAr(order.total), "receipt-total")}
      </div>
      <p className="mt-4 text-[11px]" style={{ color: "var(--receipt-muted)" }}>{t("order.receipt.footer")}</p>
    </div>
  );
}

// Raisons d'annulation (contrat PL-ORDER-CLIENT-1) → libellés traduits
// existants de la feuille d'annulation (CancelSheet.js:20-26).
const CANCEL_LABEL_KEYS = {
  wrong_info: "checkout.cancelWrongInfo",
  change_method: "checkout.cancelChangeMethod",
  too_short: "checkout.cancelTooShort",
  cannot_pay_now: "checkout.cancelCannotPayNow",
  other: "checkout.cancelOther",
};

// Ligne d'action du détail (maquette `.alink`) : icône, libellé, chevron ›.
function ActionRow({ icon, label, onClick, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="flex min-h-[48px] w-full items-center gap-2.5 border-b border-[color:var(--rule)] py-3 text-left text-[13.5px] font-bold text-foreground"
    >
      <span aria-hidden="true" className="text-[14px] leading-none text-muted-foreground">{icon}</span>
      {label}
      <ChevronRight aria-hidden="true" className="ml-auto h-4 w-4 text-muted-foreground" />
    </button>
  );
}

// Écran 2 — détail d'une commande (/commandes/:orderId).
export function OrderDetail() {
  const { orderId } = useParams();
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { games } = useGames();
  const { add, setOpen } = useCart();
  const [order, setOrder] = useState(null);
  const [state, setState] = useState("loading"); // loading | ok | denied
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [me, setMe] = useState([]);

  useEffect(() => {
    let active = true;
    setOrder(null);
    setState("loading");
    api.get(`/orders/${orderId}`)
      .then(({ data }) => { if (active) { setOrder(data); setState("ok"); } })
      .catch(() => { if (active) setState("denied"); });
    return () => { active = false; };
  }, [orderId]);

  // Commandes du compte : sert au remplacement « Commander à nouveau » →
  // « Reprendre le paiement » quand une commande pending_payment existe déjà
  // pour le même produit (réutilise la liste existante, aucun appel nouveau).
  useEffect(() => {
    if (!user) return;
    let active = true;
    api.get("/orders/me").then(({ data }) => { if (active) setMe(Array.isArray(data) ? data : []); }).catch(() => {});
    return () => { active = false; };
  }, [user]);

  if (state === "loading") return null;

  if (state === "denied") {
    // 403/404 : message générique, jamais de détail (même contrat que
    // l'écran de paiement /orders/:id).
    return (
      <div className="mx-auto w-full max-w-[480px] px-4 pb-16 pt-4" data-testid="order-detail-page">
        <div className="flex items-center gap-2">
          <BackButton onClick={() => navigate("/commandes")} testId="order-detail-back" />
        </div>
        <div className="mt-10 text-center" data-testid="order-detail-unavailable">
          <p className="font-display text-2xl font-bold">{t("order.notAvailable")}</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{t("order.notAvailableBody")}</p>
          <Button asChild className="mt-6 h-12 w-full max-w-xs rounded-full font-bold" data-testid="order-detail-back-home">
            <Link to="/commandes">{t("order.backHome")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const family = STATUS_FAMILY[order.status] || "pending";
  const products = (order.items || []).map((i) => `${i.quantity} × ${lang === "en" && i.name_en ? i.name_en : i.name}`).join(" + ");
  const canHelp = helpVisibleFor(order.status);
  // Reçu : seulement si la commande a été payée au moins une fois
  // (`paid_at` posé à la validation du paiement) — jamais sur une commande
  // encore sans paiement.
  const paidOnce = Boolean(order.paid_at);

  // Reprise : la commande courante en attente (paiement / preuve) reprend
  // vers l'écran de paiement existant /orders/:id ; sinon une commande
  // pending_payment pour le MÊME produit remplace « Commander à nouveau ».
  const selfResumable = ["pending_payment", "proof_submitted"].includes(order.status);
  const firstItem = (order.items || [])[0];
  const pendingSame = !selfResumable && (me || []).find(
    (o) => o.id !== order.id && o.status === "pending_payment" && (o.items || []).some((i) => i.product_id === firstItem?.product_id),
  );
  const resumeTarget = selfResumable ? order.id : pendingSame?.id || null;
  const resumeLabel = selfResumable && order.status === "proof_submitted" ? t("order.resumeView") : t("checkout.resume");

  // « Commander à nouveau » : pré-remplit le panier avec le MÊME jeu, produit
  // et ID joueur, puis renvoie au flux normal (/commande) — ne crée JAMAIS de
  // commande. Le produit est relu (GET /products/{slug}) pour ne jamais
  // réutiliser un prix périmé ; indisponible → fiche produit, flux normal.
  const reorder = async () => {
    let added = 0;
    for (const it of order.items || []) {
      try {
        const { data } = await api.get(`/products/${it.slug}`);
        const product = Array.isArray(data) ? data.find((p) => p.id === it.product_id) : data;
        if (!product || product.purchasable === false) continue;
        const r = add(product, it.quantity || 1);
        if (r.ok) added += 1;
        else addFeedback(r, t, toast, setOpen);
      } catch (_) { /* produit introuvable : on continue avec les suivants */ }
    }
    const playerId = order.pubg_id;
    try { if (playerId) localStorage.setItem("mgs_last_player_id", playerId); } catch (_) { /* storage indisponible */ }
    if (added > 0) {
      navigate(playerId ? `/commande?pubg_id=${playerId}` : "/commande");
      return;
    }
    // Rien n'a pu être ajouté (produit retiré/indisponible) : la fiche
    // produit ouvre le flux normal, aucune commande n'est créée.
    const slug = (order.items || [])[0]?.slug;
    if (slug) navigate(`/produit/${slug}`);
    else toast.error(t("common.error"));
  };

  // Vue reçu : la classe `receipt-print` n'est posée QUE pendant l'impression
  // (le client choisit « Enregistrer en PDF » dans la boîte du navigateur).
  const printReceipt = () => {
    document.body.classList.add("receipt-print");
    const cleanup = () => {
      document.body.classList.remove("receipt-print");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
    // Filet : navigateurs sans `afterprint` fiable — la classe ne survit pas
    // au retour de window.print() (bloquant dans Chrome/Firefox) pour que le
    // prochain Ctrl+P imprime bien la page normale.
    setTimeout(cleanup, 1000);
  };

  const rows = (order.payment_proofs || []).length;

  return (
    <div className="mx-auto w-full max-w-[480px] px-4 pb-10 pt-3" data-testid="order-detail-page">
      {/* Reçu imprimable : hors flux écran, seule vue peinte à l'impression. */}
      <OrderReceipt order={order} />

      <div>
        <div className="flex items-center gap-2">
          <BackButton onClick={() => navigate("/commandes")} testId="order-detail-back" />
          <h1 className="min-w-0 flex-1 truncate text-center font-display text-[16px] font-extrabold">
            {t("order.title")} {order.order_number}
          </h1>
        </div>

        {/* En-tête : montant en grand + statut. Cas général = point de couleur
            + texte ; le coche rond vert n'existe QUE pour « Livrée » (écran
            2bis de la maquette), nulle part ailleurs. */}
        <div className="pt-4 text-center">
          <p className="num text-[30px] font-extrabold leading-tight" data-testid="order-detail-amount">{formatAr(order.total)}</p>
          {order.status === "delivered" ? (
            <p
              className={`mt-2 inline-flex items-center gap-[7px] text-[14px] font-bold ${FAMILY_TEXT.done}`}
              data-testid="order-hero-status"
            >
              <span
                data-testid="order-hero-check"
                className={`inline-flex h-[19px] w-[19px] items-center justify-center rounded-full text-[11px] font-black ${FAMILY_BG.done} text-[color:hsl(var(--card))]`}
                aria-hidden="true"
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
              {t(`order.status.${order.status}`)}
            </p>
          ) : (
            <p
              className={`mt-2 inline-flex items-center gap-1.5 text-[13px] font-bold ${FAMILY_TEXT[family]}`}
              data-testid="order-hero-status"
            >
              <span aria-hidden="true" className={`h-[7px] w-[7px] rounded-full ${FAMILY_BG[family]}`} />
              {t(`order.status.${order.status}`)}
            </p>
          )}
        </div>

        {/* Carte : jeu en texte seul (aucune icône) + bouton « Chat » (radius
            8 px, pas une pilule). L'encart IA (lime clair) de la maquette
            n'existe que si l'assistant PL-005-BE-01 est livré — volontairement
            absent de ce lot, il prendra place entre la carte et les actions. */}
        <section className="mt-4 rounded-[18px] border bg-card px-3.5" data-testid="order-detail-card">
          <div className="flex items-center justify-between gap-2 border-b border-[color:var(--rule)] py-3">
            <p className="min-w-0 truncate text-[14px] font-bold">{gameNameOf(order, games)}</p>
            {canHelp && (
              <button
                type="button"
                onClick={() => openAssistant(navigate, order)}
                data-testid="order-chat-button"
                className="inline-flex min-h-[32px] flex-none items-center gap-1.5 rounded-[8px] bg-primary px-3.5 py-[7px] text-[12.5px] font-extrabold text-primary-foreground"
              >
                <span aria-hidden="true" className="text-[12px] leading-none">💬</span>
                {t("order.chat")}
              </button>
            )}
          </div>
          <div className="flex items-baseline justify-between gap-3 border-b border-[color:var(--rule)] py-3 text-[13px]" data-testid="order-detail-product">
            <span className="text-muted-foreground">{t("order.detail.product")}</span>
            <span className="text-right font-bold">{products}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-b border-[color:var(--rule)] py-3 text-[13px]" data-testid="order-detail-identity">
            <span className="text-muted-foreground">{t("order.detail.playerId")}</span>
            <span className="num text-right font-bold">{identityLine(order, games)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-[color:var(--rule)] py-3 text-[13px]" data-testid="order-detail-method">
            <span className="text-muted-foreground">{t("order.detail.method")}</span>
            <span className="inline-flex items-center gap-1.5 text-right font-bold">
              <span aria-hidden="true" className={`h-[7px] w-[7px] rounded-full ${METHOD_DOT_CLASS[order.payment_method] || METHOD_DOT_CLASS.manual}`} />
              {methodLabel(order, t)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-3 text-[13px]" data-testid="order-detail-date">
            <span className="text-muted-foreground">{t("order.detail.orderedAt")}</span>
            <span className="text-right font-bold">{dateShort(order.created_at, lang)}</span>
          </div>

          {/* Repli chevron (pattern PL-UX-5 admin : carré bordé 26 px, chevron
              180°, 200 ms, motion-reduce, aria-expanded/controls) — aucune
              zone tactile réduite : le bouton fait 44 px. Replie les
              informations déjà existantes (preuves, raison d'annulation). */}
          {(rows > 0 || order.cancel_reason) && (
            <div className="flex justify-center pb-1.5">
              <button
                type="button"
                onClick={() => setDetailsOpen((v) => !v)}
                aria-expanded={detailsOpen}
                aria-controls="order-detail-extra"
                data-testid="order-details-toggle"
                aria-label={t("order.detail.detailsAria")}
                className="inline-flex h-11 w-11 items-center justify-center"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-[8px] border border-[color:var(--rule-strong)] text-muted-foreground"
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${detailsOpen ? "rotate-180" : ""}`} />
                </span>
              </button>
            </div>
          )}
          <div
            id="order-detail-extra"
            data-testid="order-detail-extra"
            className={`${detailsOpen ? "block" : "hidden"} border-t border-[color:var(--rule)] py-3 text-[12.5px]`}
          >
            {rows > 0 && (
              <p className="flex justify-between gap-3 py-1" data-testid="order-detail-proofs">
                <span className="text-muted-foreground">{t("order.detail.extra.proofs")}</span>
                <span className="text-right font-bold">{t("order.detail.extra.proofCount", { n: rows })}</span>
              </p>
            )}
            {order.cancel_reason && (
              <p className="flex justify-between gap-3 py-1" data-testid="order-detail-cancel">
                <span className="text-muted-foreground">{t("order.detail.extra.cancelReason")}</span>
                <span className="text-right font-bold">{t(CANCEL_LABEL_KEYS[order.cancel_reason] || "common.error")}</span>
              </p>
            )}
            {order.cancel_note && (
              <p className="py-1" data-testid="order-detail-cancel-note">
                <span className="text-muted-foreground">{t("order.detail.extra.note")} : </span>
                <span className="font-bold">{order.cancel_note}</span>
              </p>
            )}
            {order.cancelled_at && (
              <p className="flex justify-between gap-3 py-1">
                <span className="text-muted-foreground">{t("order.detail.extra.cancelledAt")}</span>
                <span className="text-right font-bold">{dateShort(order.cancelled_at, lang)}</span>
              </p>
            )}
          </div>
        </section>

        {/* Actions (maquette `.alink`) : la ligne « Besoin d'aide » suit la
            même règle de visibilité que la pastille/bouton Chat ; le reçu
            n'existe que pour une commande payée au moins une fois. */}
        <div className="mt-2">
          {canHelp && (
            <ActionRow
              icon="💬"
              label={t("order.detail.helpRow")}
              testId="order-help-row"
              onClick={() => openAssistant(navigate, order)}
            />
          )}
          {paidOnce && (
            <ActionRow
              icon="🧾"
              label={t("order.detail.receiptAction")}
              testId="order-receipt-action"
              onClick={printReceipt}
            />
          )}
        </div>

        {/* Bouton du bas (maquette `.btn.ghost`, radius plein du site) :
            « Reprendre le paiement » vers la commande en attente du même
            produit (logique existante, jamais de commande forcée), sinon
            « Commander à nouveau » (pré-remplit le panier, le client repasse
            par tout le flux normal). */}
        <div className="mt-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {resumeTarget ? (
            <Button
              variant="outline"
              onClick={() => navigate(`/orders/${resumeTarget}`)}
              data-testid="order-resume-pending-button"
              className="h-[50px] w-full rounded-full text-[14.5px] font-extrabold"
            >
              {resumeLabel}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={reorder}
              data-testid="order-again-button"
              className="h-[50px] w-full rounded-full text-[14.5px] font-extrabold"
            >
              {t("order.detail.orderAgain")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
