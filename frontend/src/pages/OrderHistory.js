import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Check, ChevronDown, ChevronRight, MessageCircle, X } from "lucide-react";
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
// `repports/maquettes/apercu-historique-commandes.html` ; PL-005-FE-02
// l'applique aux corrections « RONDE 2 » de la maquette v3 (écrans 3 et 4) :
// liste affichée directement sur /suivi (3 colonnes souples sur bureau),
// badge « Annulée » sans rouge, copie = ID de commande sans navigation,
// chevron de repli nu tout en bas, barre d'action fixée (Chat + principal),
// aucun poids de police au-dessus de 600 sur ces pages. Style = cartes
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

// PL-005-FE-02 (tâche 6) — badge « Annulée » SANS ROUGE : la maquette RONDE 2
// remplace la famille rouge par un blanc ~62 % (en sombre) ; en clair ce
// blanc échouerait sur la crème, la maquette le prévoit explicitement
// (« si 62 % échoue en thème clair, utiliser l'encre du thème à 62 % ») :
// les deux valeurs vivent dans les tokens `--badge-cancel-*` (index.css).
// Liste : le badge garde sa fine bordure (blanc/encre 30 %) comme les autres
// badges de liste ; détail : aucune bordure + icône ✕.
const CANCEL_TEXT = "text-[color:var(--badge-cancel-text)]";
const CANCEL_BORDER = "border-[color:var(--badge-cancel-border)]";

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
// d'appel (pastille de la liste, bouton Chat de la barre du bas, ligne «
// Besoin d'aide avec cette commande ») passent tous par ici.
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
// pleine). Tâche 6 : « Annulée » = blanc/encre 62 % + fine bordure 30 %,
// JAMAIS de rouge.
export function OrderStatusBadge({ status }) {
  const { t } = useLang();
  const cancelled = status === "cancelled";
  const text = cancelled ? CANCEL_TEXT : FAMILY_TEXT[STATUS_FAMILY[status] || "pending"];
  const border = cancelled ? CANCEL_BORDER : FAMILY_BORDER[STATUS_FAMILY[status] || "pending"];
  return (
    <span
      data-testid={`order-badge-${status}`}
      className={`inline-flex flex-none items-center whitespace-nowrap rounded-[7px] border bg-transparent px-[9px] py-1 text-[11px] font-semibold ${border} ${text}`}
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
          className={`relative flex min-h-[44px] items-center text-[13px] font-semibold ${tab === key ? "text-foreground" : "text-muted-foreground"}`}
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

// Zone de copie du numéro : bouton de copie au-dessus du lien étiré de la
// carte (zone de clic DISTINCTE, `relative z-10`) et stopPropagation —
// PL-005-FE-02 tâche 5 : copier l'ID de commande ne doit JAMAIS naviguer
// vers le détail. La copie porte l'ID (`order.id`), pas le numéro affiché.
// (Dans le détail, la copie est rendue en ligne avec `t()` — voir OrderDetail.)
function CopyZone({ order, testId }) {
  const { t } = useLang();
  return (
    <span className="relative z-10 inline-flex" onClick={(e) => e.stopPropagation()}>
      <CopyButton value={order.id} label={t("order.copyNumber")} testId={testId} />
    </span>
  );
}

// Carte de la liste (maquette écrans 1 et 3) : mobile = jeu + produit en
// texte, badge SUR LA LIGNE DU TITRE (alignement haut, tâche 4), montant /
// méthode, numéro + copie / date ; bureau (≥1024 px) = 3 colonnes souples
// (titre + numéro / méthode / montant + badge, tâche 3). Toute la carte est
// cliquable (lien étiré, la copie et la pastille au-dessus).
function HistoryCard({ order }) {
  const { t, lang } = useLang();
  const { games } = useGames();
  const navigate = useNavigate();
  const products = (order.items || []).map((i) => (lang === "en" && i.name_en ? i.name_en : i.name)).join(" + ");
  const title = `${gameNameOf(order, games)} — ${products}`;
  const badge = <OrderStatusBadge status={order.status} />;
  return (
    <article data-testid={`order-history-card-${order.order_number}`} className="relative rounded-[18px] border bg-card p-3.5">
      <Link
        to={`/commandes/${order.id}`}
        data-testid={`order-history-open-${order.order_number}`}
        aria-label={`${t("order.title")} ${order.order_number}`}
        className="absolute inset-0 rounded-[18px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-foreground"
      />
      {/* Mobile (écran 1). */}
      <div className="lg:hidden">
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-semibold leading-snug">{title}</p>
            <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{identityLine(order, games)}</p>
          </div>
          {badge}
        </div>
        <div className="mt-2.5 flex items-baseline justify-between gap-2">
          <span className="num text-[15.5px] font-semibold">{formatAr(order.total)}</span>
          <span className="text-[12.5px] text-muted-foreground">{methodLabel(order, t)}</span>
        </div>
        <div className="mt-2.5 flex items-center gap-1 border-t border-[color:var(--rule)] pt-2">
          <span className="num text-[11.5px] text-muted-foreground">{order.order_number}</span>
          <CopyZone order={order} testId={`order-copy-${order.order_number}`} />
          <span className="ml-auto text-[11px] text-muted-foreground">{dateShort(order.created_at, lang)}</span>
        </div>
      </div>
      {/* Bureau (écran 3) : 3 colonnes souples, moins collées (gap 5). */}
      <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_140px_170px] lg:items-center lg:gap-5">
        <div className="min-w-0">
          <p className="truncate text-[14.5px] font-semibold leading-snug">{title}</p>
          <div className="mt-1 flex items-center gap-1">
            <span className="num text-[11.5px] text-muted-foreground">{order.order_number}</span>
            <CopyZone order={order} testId={`order-copy-wide-${order.order_number}`} />
            <span className="ml-2 text-[11px] text-muted-foreground">{dateShort(order.created_at, lang)}</span>
          </div>
        </div>
        <p className="text-right text-[12.5px] text-muted-foreground">{methodLabel(order, t)}</p>
        <div className="text-right">
          <p className="num text-[15.5px] font-semibold">{formatAr(order.total)}</p>
          <div className="mt-1.5 flex justify-end">{badge}</div>
        </div>
      </div>
      {helpVisibleFor(order.status) && (
        <button
          type="button"
          onClick={() => openAssistant(navigate, order)}
          data-testid={`order-help-${order.order_number}`}
          className="relative z-10 mt-2.5 inline-flex min-h-[32px] items-center gap-1.5 rounded-[8px] border border-[color:var(--rule-strong)] bg-muted px-2.5 py-1.5 text-[11.5px] font-semibold text-foreground"
        >
          <span aria-hidden="true" className="text-[12px] leading-none">💬</span>
          {t("order.helpAsk")}
        </button>
      )}
    </article>
  );
}

// PL-005-FE-02 — historique « COMMANDES » (libellé inchangé), affiché
// directement sur /suivi (tâche 1) : plus de route dédiée ni de h1 ici, le
// titre vit dans la page de suivi. Le filtre de recherche du bouton
// CommandButton (tâche 2) arrive en prop `query` : filtre LOCAL (numéro, ID
// joueur, produit — insensible à la casse) et le nombre de correspondances
// remonte au parent via `onResult` (rien + ressemblance MGS-… → l'API de
// suivi prend le relais, champ ID joueur compact affiché par le parent).
export default function OrderHistory({ query = "", onResult }) {
  const { t } = useLang();
  const { user } = useAuth();
  const { games } = useGames();
  const [orders, setOrders] = useState(null);
  const [tab, setTab] = useState("all");

  // Une seule source : GET /orders/me (liste complète, 200 dernières).
  // Les onglets et la recherche filtrent localement — aucun paramètre de
  // statut n'existe côté API et aucun nouvel appel n'est déclenché.
  useEffect(() => {
    if (!user) return;
    let active = true;
    api.get("/orders/me")
      .then(({ data }) => { if (active) setOrders(Array.isArray(data) ? data : []); })
      .catch(() => { if (active) setOrders([]); });
    return () => { active = false; };
  }, [user]);

  const ql = String(query || "").trim().toLowerCase();
  const matches = (o) => {
    if (!ql) return true;
    const hay = [
      o.order_number,
      o.pubg_id,
      identityLine(o, games),
      ...(o.items || []).flatMap((i) => [i.name, i.name_en]),
    ].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(ql);
  };

  const filtered = (orders || []).filter((o) => TAB_FILTERS[tab](o.status) && matches(o));

  // Compteur de correspondances remonté au parent (-1 = aucune recherche).
  useEffect(() => {
    if (!onResult) return;
    onResult(ql ? filtered.length : -1, ql);
  }, [ql, filtered.length, onResult]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="order-history-weight pt-4" data-testid="order-history-page">
      <Tabs tab={tab} setTab={setTab} />
      {orders === null ? null : filtered.length === 0 ? (
        <p className="mt-4 rounded-[18px] border bg-card p-5 text-sm text-muted-foreground" data-testid="orders-empty">
          {ql ? t("order.notFound") : t("order.historyEmpty")}
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
// en page simple, couleurs papier/encre fixes. Tâche 7 : aucun poids > 600.
function OrderReceipt({ order }) {
  const { t, lang } = useLang();
  const { games } = useGames();
  const row = (label, value, testId) => (
    <div className="flex items-baseline justify-between gap-4 py-1.5" style={{ borderBottom: "1px solid var(--receipt-line)" }}>
      <span style={{ color: "var(--receipt-muted)" }}>{label}</span>
      <span className="text-right font-semibold" data-testid={testId}>{value}</span>
    </div>
  );
  return (
    <div className="order-receipt hidden" data-testid="order-receipt-view" aria-hidden="true">
      <p className="text-[13px] font-semibold uppercase tracking-[0.18em]">{t("account.pubgCard.brand")}</p>
      <p className="mt-2 text-[20px] font-semibold">{t("order.receipt.title")}</p>
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
      className="flex min-h-[48px] w-full items-center gap-2.5 border-b border-[color:var(--rule)] py-3 text-left text-[13.5px] font-semibold text-foreground"
    >
      <span aria-hidden="true" className="text-[14px] leading-none text-muted-foreground">{icon}</span>
      {label}
      <ChevronRight aria-hidden="true" className="ml-auto h-4 w-4 text-muted-foreground" />
    </button>
  );
}

// Écran 2 — détail d'une commande (/commandes/:orderId), corrections RONDE 2
// (écran 4 de la maquette v3) : badge « Annulée » sans rouge ni bordure,
// lignes visibles Produit / ID joueur / Méthode uniquement (date + numéro
// DANS la zone repliée), chevron nu tout en bas (le contenu replié s'affiche
// au-dessus), barre d'action fixée en bas (Chat pilule lime 48 px + bouton
// principal), flèche de retour = même composant que la page de paiement et
// ramène TOUJOURS à /suivi (jamais navigate(-1)).
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
      <div className="order-history-weight mx-auto w-full max-w-[480px] px-4 pb-16 pt-4" data-testid="order-detail-page">
        <div className="flex items-center gap-2">
          <BackButton onClick={() => navigate("/suivi")} testId="order-detail-back" />
        </div>
        <div className="mt-10 text-center" data-testid="order-detail-unavailable">
          <p className="font-display text-2xl font-semibold">{t("order.notAvailable")}</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{t("order.notAvailableBody")}</p>
          <Button asChild className="mt-6 h-12 w-full max-w-xs rounded-full font-semibold" data-testid="order-detail-back-home">
            <Link to="/suivi">{t("order.backHome")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const family = STATUS_FAMILY[order.status] || "pending";
  const cancelled = order.status === "cancelled";
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

  const proofs = (order.payment_proofs || []).length;

  return (
    <div className="order-history-weight mx-auto w-full max-w-[480px] px-4 pb-10 pt-3" data-testid="order-detail-page">
      {/* Reçu imprimable : hors flux écran, seule vue peinte à l'impression. */}
      <OrderReceipt order={order} />

      <div>
        <div className="flex items-center gap-2">
          {/* Tâche 8 — même composant que la flèche de la page de paiement ;
              retour EXPLICITE vers la liste /suivi, jamais navigate(-1). */}
          <BackButton onClick={() => navigate("/suivi")} testId="order-detail-back" />
          <h1 className="min-w-0 flex-1 truncate text-center font-display text-[16px] font-semibold">
            {t("order.title")} {order.order_number}
          </h1>
        </div>

        {/* En-tête : montant en grand + statut. Cas général = point de couleur
            + texte ; le coche rond vert n'existe QUE pour « Livrée » (écran
            2bis), « Annulée » porte le badge sans rouge de la RONDE 2 (✕ +
            blanc 62 %, aucune bordure — tâche 6), nulle part ailleurs. */}
        <div className="pt-4 text-center">
          <p className="num text-[30px] font-semibold leading-tight" data-testid="order-detail-amount">{formatAr(order.total)}</p>
          {cancelled ? (
            <p
              className={`mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold ${CANCEL_TEXT}`}
              data-testid="order-hero-status"
            >
              <X className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
              {t(`order.status.${order.status}`)}
            </p>
          ) : order.status === "delivered" ? (
            <p
              className={`mt-2 inline-flex items-center gap-[7px] text-[14px] font-semibold ${FAMILY_TEXT.done}`}
              data-testid="order-hero-status"
            >
              <span
                data-testid="order-hero-check"
                className={`inline-flex h-[19px] w-[19px] items-center justify-center rounded-full text-[11px] font-semibold ${FAMILY_BG.done} text-[color:hsl(var(--card))]`}
                aria-hidden="true"
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
              {t(`order.status.${order.status}`)}
            </p>
          ) : (
            <p
              className={`mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold ${FAMILY_TEXT[family]}`}
              data-testid="order-hero-status"
            >
              <span aria-hidden="true" className={`h-[7px] w-[7px] rounded-full ${FAMILY_BG[family]}`} />
              {t(`order.status.${order.status}`)}
            </p>
          )}
        </div>

        {/* Carte : jeu en texte seul. Lignes VISIBLES (tâche 9) : Produit /
            ID joueur / Méthode UNIQUEMENT — « Commandée le » et le numéro
            n'apparaissent que dans la zone repliée. Le bouton « Chat »
            n'est plus dans la carte : il vit dans la barre du bas (tâche 11).
            L'encart IA (lime clair) de la maquette n'existe que si
            l'assistant PL-005-BE-01 est livré. */}
        <section className="mt-4 rounded-[18px] border bg-card px-3.5" data-testid="order-detail-card">
          <div className="border-b border-[color:var(--rule)] py-3">
            <p className="min-w-0 truncate text-[14px] font-semibold">{gameNameOf(order, games)}</p>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-b border-[color:var(--rule)] py-3 text-[13px]" data-testid="order-detail-product">
            <span className="text-muted-foreground">{t("order.detail.product")}</span>
            <span className="text-right font-semibold">{products}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-b border-[color:var(--rule)] py-3 text-[13px]" data-testid="order-detail-identity">
            <span className="text-muted-foreground">{t("order.detail.playerId")}</span>
            <span className="num text-right font-semibold">{identityLine(order, games)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 py-3 text-[13px]" data-testid="order-detail-method">
            <span className="text-muted-foreground">{t("order.detail.method")}</span>
            <span className="inline-flex items-center gap-1.5 text-right font-semibold">
              <span aria-hidden="true" className={`h-[7px] w-[7px] rounded-full ${METHOD_DOT_CLASS[order.payment_method] || METHOD_DOT_CLASS.manual}`} />
              {methodLabel(order, t)}
            </span>
          </div>

          {/* Zone repliée (tâches 9 et 10) : preuves / raison d'annulation
              ET le numéro + la date, qui ne sont visibles QUE ICI. Le bloc
              est rendu AVANT le chevron : une fois ouvert, son contenu
              s'affiche au-dessus et le chevron reste tout en bas. */}
          <div
            id="order-detail-extra"
            data-testid="order-detail-extra"
            className={`${detailsOpen ? "block" : "hidden"} border-t border-[color:var(--rule)] py-3 text-[12.5px]`}
          >
            {proofs > 0 && (
              <p className="flex justify-between gap-3 py-1" data-testid="order-detail-proofs">
                <span className="text-muted-foreground">{t("order.detail.extra.proofs")}</span>
                <span className="text-right font-semibold">{t("order.detail.extra.proofCount", { n: proofs })}</span>
              </p>
            )}
            {order.cancel_reason && (
              <p className="flex justify-between gap-3 py-1" data-testid="order-detail-cancel">
                <span className="text-muted-foreground">{t("order.detail.extra.cancelReason")}</span>
                <span className="text-right font-semibold">{t(CANCEL_LABEL_KEYS[order.cancel_reason] || "common.error")}</span>
              </p>
            )}
            {order.cancel_note && (
              <p className="py-1" data-testid="order-detail-cancel-note">
                <span className="text-muted-foreground">{t("order.detail.extra.note")} : </span>
                <span className="font-semibold">{order.cancel_note}</span>
              </p>
            )}
            {order.cancelled_at && (
              <p className="flex justify-between gap-3 py-1">
                <span className="text-muted-foreground">{t("order.detail.extra.cancelledAt")}</span>
                <span className="text-right font-semibold">{dateShort(order.cancelled_at, lang)}</span>
              </p>
            )}
            <div className="flex items-center justify-between gap-3 py-1" data-testid="order-detail-number">
              <span className="text-muted-foreground">{t("order.number")}</span>
              <span className="inline-flex items-center gap-1 text-right font-semibold">
                <span className="num">{order.order_number}</span>
                {/* Tâche 5 (détail) : la copie porte l'ID de commande, zone
                    de clic distincte, ne navigue jamais. */}
                <span className="relative z-10 inline-flex" onClick={(e) => e.stopPropagation()}>
                  <CopyButton value={order.id} label={t("order.copyNumber")} testId="order-detail-copy" />
                </span>
              </span>
            </div>
            <p className="flex justify-between gap-3 py-1" data-testid="order-detail-date">
              <span className="text-muted-foreground">{t("order.detail.orderedAt")}</span>
              <span className="text-right font-semibold">{dateShort(order.created_at, lang)}</span>
            </p>
          </div>

          {/* Chevron de repli (tâche 10) : NU — aucune bordure, aucun fond,
              uniquement l'icône ; zone cliquable 44 px par padding. Tout en
              bas de la carte, sous le contenu ; ouvert : rotation 180°
              (200 ms, désactivée sous prefers-reduced-motion), le contenu
              replié reste AU-DESSUS de lui. aria-expanded/controls conservés. */}
          <div className="flex justify-center pb-1.5">
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              aria-expanded={detailsOpen}
              aria-controls="order-detail-extra"
              data-testid="order-details-toggle"
              aria-label={t("order.detail.detailsAria")}
              className="inline-flex h-11 w-11 items-center justify-center text-muted-foreground"
            >
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${detailsOpen ? "rotate-180" : ""}`} />
            </button>
          </div>
        </section>

        {/* Actions (maquette `.alink`) : la ligne « Besoin d'aide » suit la
            même règle de visibilité que la pastille de la liste ; le reçu
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
      </div>

      {/* Barre d'action fixée en bas (tâche 11, maquette écran 4) : Chat en
          pilule lime (92 px, hauteur 48 px, rayon 999 px — comme le bouton
          principal) + bouton principal (« Reprendre le paiement » /
          « Commander à nouveau », règle existante). Mobile : barre collée au
          bas de l'écran, comme la page de paiement ; ≥1024 px : flux normal.
          La maquette écran 4 (commande ANNULÉE) montre le Chat dans cette
          barre : il y reste quel que soit le statut (le point d'entrée IA
          passe toujours par openAssistant). */}
      <div
        data-testid="order-detail-bar"
        className="sticky bottom-0 z-10 -mx-4 mt-5 flex gap-2 border-t border-[color:var(--rule)] bg-[color:hsl(var(--background))] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 lg:static lg:z-auto lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:pb-2"
      >
        <button
          type="button"
          onClick={() => openAssistant(navigate, order)}
          data-testid="order-chat-button"
          className="inline-flex h-12 w-[92px] flex-none items-center justify-center gap-1.5 rounded-[999px] bg-[color:var(--brand-lime)] text-[13.5px] font-semibold text-ink"
        >
          {/* Retour design : icône de message (jamais l'emoji 💬). */}
          <MessageCircle className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          {t("order.chat")}
        </button>
        {resumeTarget ? (
          <Button
            variant="outline"
            onClick={() => navigate(`/orders/${resumeTarget}`)}
            data-testid="order-resume-pending-button"
            className="h-12 min-w-0 flex-1 rounded-[999px] text-[14px] font-semibold"
          >
            {resumeLabel}
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={reorder}
            data-testid="order-again-button"
            className="h-12 min-w-0 flex-1 rounded-[999px] text-[14px] font-semibold"
          >
            {t("order.detail.orderAgain")}
          </Button>
        )}
      </div>
    </div>
  );
}
