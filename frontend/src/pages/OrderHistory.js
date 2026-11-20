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

// PL-DS-V3 — historique + détail commande rebuild sur la structure EXACTE du
// prototype design-system-v3.html : liste .mgs-cmd-list > .mgs-tabs.mgs-cmd-tabs
// + .mgs-list.mgs-order-list de .mgs-order (main titre/méta, méthode, right
// prix + .mgs-status--famille) ; détail .mgs-cmd-detail > .mgs-panel. Les
// décisions de l'ancienne maquette (badge rectangle transparent, poids ≤600,
// double layout mobile/desktop) sont remplacées par le langage du prototype.
// Logique, testids, copie sans navigation, repli, aide, reorder/resume, reçu
// imprimable inchangés. Aucun appel API nouveau : GET /orders/me + /orders/{id}.

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

export const helpVisibleFor = (status) => !["delivered", "cancelled", "refunded"].includes(status);

const STATUS_PROGRESS = ["pending_payment", "awaiting_verification", "proof_submitted", "late_payment", "paid"];
const TAB_FILTERS = {
  all: () => true,
  progress: (s) => STATUS_PROGRESS.includes(s),
  done: (s) => !STATUS_PROGRESS.includes(s),
};

const openAssistant = (navigate, order) => navigate("/chat", { state: { order_id: order?.id } });

const gameNameOf = (order, games) => games.find((g) => g.id === order.game_id)?.name || order.game_id || "";

const identityParts = (order, games) => {
  const spec = games.find((g) => g.id === (order.game_id || "pubg-mobile"))?.identity_fields || [];
  const fields = order.identity_snapshot?.fields || { player_id: order.pubg_id };
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
    .map(([k, v]) => `${spec.find((f) => f.key === k)?.label || k} ${v}`);
};

const identityLine = (order, games) => identityParts(order, games).join(" · ");

const methodLabel = (order, t) =>
  order.payment_method === "manual" && order.manual_operator
    ? paymentOperatorLabel(order.manual_operator)
    : paymentLabel(order.payment_method, t);

const dateShort = (iso, lang) => {
  const d = new Date(iso);
  const loc = lang === "en" ? "en-GB" : "fr-FR";
  const date = d.toLocaleDateString(loc, { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
};

// Badge de statut du prototype : .mgs-status + .mgs-status--famille (pastille
// colorée pleine). « Annulée » = famille cancel (fond clair, jamais rouge).
export function OrderStatusBadge({ status }) {
  const { t } = useLang();
  const family = STATUS_FAMILY[status] || "pending";
  return (
    <span data-testid={`order-badge-${status}`} className={`mgs-status mgs-status--${family}`}>
      {t(`order.status.${status}`)}
    </span>
  );
}

// Onglets « Toutes / En cours / Terminées » du prototype : .mgs-tab pilules
// bordées, actif noir/blanc (filtre local, aucun nouvel appel API).
function Tabs({ tab, setTab }) {
  const { t } = useLang();
  return (
    <div className="mgs-tabs mgs-cmd-tabs" role="tablist" aria-label={t("account.orders")}>
      {["all", "progress", "done"].map((key) => (
        <button key={key} type="button" role="tab" aria-selected={tab === key} data-testid={`orders-tab-${key}`} onClick={() => setTab(key)} className={`mgs-tab mgs-cmd-tab${tab === key ? " is--active" : ""}`}>
          {t(`order.tabs.${key}`)}
        </button>
      ))}
    </div>
  );
}

// Zone de copie : zone de clic DISTINCTE (relative z-10) + stopPropagation —
// copier l'ID de commande ne doit JAMAIS naviguer vers le détail.
function CopyZone({ order, testId }) {
  const { t } = useLang();
  return (
    <span className="relative z-10 inline-flex" onClick={(e) => e.stopPropagation()}>
      <CopyButton value={order.id} label={t("order.copyNumber")} testId={testId} />
    </span>
  );
}

// Carte de la liste du prototype : .mgs-order (grille main / méthode / right),
// toute la carte cliquable (lien étiré), copie + aide au-dessus.
function HistoryCard({ order }) {
  const { t, lang } = useLang();
  const { games } = useGames();
  const navigate = useNavigate();
  const products = (order.items || []).map((i) => (lang === "en" && i.name_en ? i.name_en : i.name)).join(" + ");
  const title = `${gameNameOf(order, games)} — ${products}`;
  return (
    <article data-testid={`order-history-card-${order.order_number}`} className="mgs-order relative">
      <Link
        to={`/commandes/${order.id}`}
        data-testid={`order-history-open-${order.order_number}`}
        aria-label={`${t("order.title")} ${order.order_number}`}
        className="absolute inset-0 z-0 rounded-[1.1em] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-foreground"
      />
      <div className="mgs-order__main">
        <p className="mgs-order__title">{title}</p>
        <p className="mgs-order__meta">
          <span className="mgs-mono">{order.order_number}</span>
          <CopyZone order={order} testId={`order-copy-${order.order_number}`} />
          <span>· {dateShort(order.created_at, lang)}</span>
        </p>
        <p className="mgs-order__meta">{identityLine(order, games)}</p>
      </div>
      <span className="mgs-order__method">{methodLabel(order, t)}</span>
      <div className="mgs-order__right">
        <p className="mgs-order__price">{formatAr(order.total, lang)}</p>
        <OrderStatusBadge status={order.status} />
      </div>
      {helpVisibleFor(order.status) && (
        <button type="button" onClick={() => openAssistant(navigate, order)} data-testid={`order-help-${order.order_number}`} className="mgs-chip relative z-10" style={{ gridColumn: "1 / -1", justifySelf: "start" }}>
          <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />{t("order.helpAsk")}
        </button>
      )}
    </article>
  );
}

export default function OrderHistory({ query = "", onResult }) {
  const { t } = useLang();
  const { user } = useAuth();
  const { games } = useGames();
  const [orders, setOrders] = useState(null);
  const [tab, setTab] = useState("all");

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

  useEffect(() => {
    if (!onResult) return;
    onResult(ql ? filtered.length : -1, ql);
  }, [ql, filtered.length, onResult]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="order-history-weight mgs-cmd-list" data-testid="order-history-page">
      <Tabs tab={tab} setTab={setTab} />
      {orders === null ? null : filtered.length === 0 ? (
        <p className="mgs-panel mt-4 p-5 text-sm" data-testid="orders-empty">
          {ql ? t("order.notFound") : t("order.historyEmpty")}
        </p>
      ) : (
        <div className="mgs-list mgs-order-list mt-3">
          {filtered.map((o) => <HistoryCard key={o.id} order={o} />)}
        </div>
      )}
    </div>
  );
}

// Reçu imprimable : construit UNIQUEMENT à partir des données affichées. Caché
// à l'écran (hidden), seule vue peinte à l'impression (body.receipt-print).
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
        {(order.payment_fee ?? 0) > 0 && row(t("order.receipt.fee"), formatAr(order.payment_fee, lang), "receipt-fee")}
        {row(t("order.receipt.amount"), formatAr(order.total, lang), "receipt-total")}
      </div>
      <p className="mt-4 text-[11px]" style={{ color: "var(--receipt-muted)" }}>{t("order.receipt.footer")}</p>
    </div>
  );
}

const CANCEL_LABEL_KEYS = {
  wrong_info: "checkout.cancelWrongInfo",
  change_method: "checkout.cancelChangeMethod",
  too_short: "checkout.cancelTooShort",
  cannot_pay_now: "checkout.cancelCannotPayNow",
  other: "checkout.cancelOther",
};

// Ligne d'action du détail : icône, libellé, chevron › (rendue en .mgs-set-row).
function ActionRow({ icon, label, onClick, testId }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} className="mgs-set-row">
      <span aria-hidden="true" className="text-[14px] leading-none">{icon}</span>
      <span className="mgs-set-label">{label}</span>
      <span className="mgs-set-trail"><ChevronRight aria-hidden="true" className="h-4 w-4" /></span>
    </button>
  );
}

// Détail d'une commande (/commandes/:orderId) : .mgs-cmd-detail > .mgs-panel,
// montant en grand + statut .mgs-status, lignes Produit / ID / Méthode, zone
// repliée (numéro + date + preuves + annulation), barre d'action bas (Chat +
// principal). Retour EXPLICITE vers /suivi.
export function OrderDetail() {
  const { orderId } = useParams();
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { games } = useGames();
  const { add, setOpen } = useCart();
  const [order, setOrder] = useState(null);
  const [state, setState] = useState("loading");
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

  useEffect(() => {
    if (!user) return;
    let active = true;
    api.get("/orders/me").then(({ data }) => { if (active) setMe(Array.isArray(data) ? data : []); }).catch(() => {});
    return () => { active = false; };
  }, [user]);

  if (state === "loading") return null;

  if (state === "denied") {
    return (
      <div className="order-history-weight mgs-cmd-detail" data-testid="order-detail-page">
        <div className="flex items-center gap-2">
          <BackButton onClick={() => navigate("/suivi")} testId="order-detail-back" />
        </div>
        <div className="mt-10 text-center" data-testid="order-detail-unavailable">
          <p className="mgs-title" style={{ fontSize: "1.6em" }}>{t("order.notAvailable")}</p>
          <p className="mgs-sub mx-auto mt-2 max-w-sm">{t("order.notAvailableBody")}</p>
          <Link to="/suivi" className="button-main mt-6" data-button-theme="dark" data-button-accent="yellow" data-testid="order-detail-back-home"><span className="button-main-inner full-h"><span className="button-main-inner__back" data-text={t("order.backHome")}></span><span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{t("order.backHome")}</span></span></span></span></Link>
        </div>
      </div>
    );
  }

  const family = STATUS_FAMILY[order.status] || "pending";
  const cancelled = order.status === "cancelled";
  const products = (order.items || []).map((i) => `${i.quantity} × ${lang === "en" && i.name_en ? i.name_en : i.name}`).join(" + ");
  const canHelp = helpVisibleFor(order.status);
  const paidOnce = Boolean(order.paid_at);

  const selfResumable = ["pending_payment", "proof_submitted"].includes(order.status);
  const firstItem = (order.items || [])[0];
  const pendingSame = !selfResumable && (me || []).find(
    (o) => o.id !== order.id && o.status === "pending_payment" && (o.items || []).some((i) => i.product_id === firstItem?.product_id),
  );
  const resumeTarget = selfResumable ? order.id : pendingSame?.id || null;
  const resumeLabel = selfResumable && order.status === "proof_submitted" ? t("order.resumeView") : t("checkout.resume");

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
      } catch (_) { /* produit introuvable : on continue */ }
    }
    const playerId = order.pubg_id;
    try { if (playerId) localStorage.setItem("mgs_last_player_id", playerId); } catch (_) { /* storage indisponible */ }
    if (added > 0) {
      navigate(playerId ? `/commande?pubg_id=${playerId}` : "/commande");
      return;
    }
    const slug = (order.items || [])[0]?.slug;
    if (slug) navigate(`/produit/${slug}`);
    else toast.error(t("common.error"));
  };

  const printReceipt = () => {
    document.body.classList.add("receipt-print");
    const cleanup = () => {
      document.body.classList.remove("receipt-print");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
    setTimeout(cleanup, 1000);
  };

  const proofs = (order.payment_proofs || []).length;

  return (
    <div className="order-history-weight mgs-cmd-detail" data-testid="order-detail-page">
      <OrderReceipt order={order} />

      <div>
        <div className="mgs-co-top">
          <BackButton onClick={() => navigate("/suivi")} testId="order-detail-back" />
          <span className="mgs-co-game min-w-0 flex-1 truncate text-center">{t("order.title")} {order.order_number}</span>
        </div>

        {/* En-tête : montant en grand + statut. Coche ronde UNIQUEMENT si livrée. */}
        <div className="mgs-co-pay" style={{ textAlign: "center" }}>
          <p className="mgs-co-total" data-testid="order-detail-amount">{formatAr(order.total, lang)}</p>
          {cancelled ? (
            <p className={`mgs-status mgs-status--cancel mt-2 inline-flex items-center gap-1.5`} data-testid="order-hero-status">
              <X className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
              {t(`order.status.${order.status}`)}
            </p>
          ) : order.status === "delivered" ? (
            <p className={`mgs-status mgs-status--done mt-2 inline-flex items-center gap-[7px]`} data-testid="order-hero-status">
              <span data-testid="order-hero-check" className="inline-flex h-[19px] w-[19px] items-center justify-center rounded-full" style={{ background: "var(--color--light)", color: "var(--color--green-700)" }} aria-hidden="true">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
              {t(`order.status.${order.status}`)}
            </p>
          ) : (
            <p className={`mgs-status mgs-status--${family} mt-2 inline-flex items-center gap-1.5`} data-testid="order-hero-status">
              {t(`order.status.${order.status}`)}
            </p>
          )}
        </div>

        {/* Carte .mgs-panel : jeu, lignes Produit / ID / Méthode, zone repliée. */}
        <section className="mgs-panel mt-4" data-testid="order-detail-card">
          <div className="border-b border-[color:var(--rule)] py-3">
            <p className="min-w-0 truncate text-[14px] font-semibold">{gameNameOf(order, games)}</p>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-b border-[color:var(--rule)] py-3 text-[13px]" data-testid="order-detail-product">
            <span className="mgs-muted">{t("order.detail.product")}</span>
            <span className="text-right font-semibold">{products}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-b border-[color:var(--rule)] py-3 text-[13px]" data-testid="order-detail-identity">
            <span className="mgs-muted">{t("order.detail.playerId")}</span>
            <span className="num text-right font-semibold">{identityLine(order, games)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 py-3 text-[13px]" data-testid="order-detail-method">
            <span className="mgs-muted">{t("order.detail.method")}</span>
            <span className="text-right font-semibold">{methodLabel(order, t)}</span>
          </div>

          <div id="order-detail-extra" data-testid="order-detail-extra" className={`${detailsOpen ? "block" : "hidden"} border-t border-[color:var(--rule)] py-3 text-[12.5px]`}>
            {proofs > 0 && (
              <p className="flex justify-between gap-3 py-1" data-testid="order-detail-proofs">
                <span className="mgs-muted">{t("order.detail.extra.proofs")}</span>
                <span className="text-right font-semibold">{t("order.detail.extra.proofCount", { n: proofs })}</span>
              </p>
            )}
            {order.cancel_reason && (
              <p className="flex justify-between gap-3 py-1" data-testid="order-detail-cancel">
                <span className="mgs-muted">{t("order.detail.extra.cancelReason")}</span>
                <span className="text-right font-semibold">{t(CANCEL_LABEL_KEYS[order.cancel_reason] || "common.error")}</span>
              </p>
            )}
            {order.cancel_note && (
              <p className="py-1" data-testid="order-detail-cancel-note">
                <span className="mgs-muted">{t("order.detail.extra.note")} : </span>
                <span className="font-semibold">{order.cancel_note}</span>
              </p>
            )}
            {order.cancelled_at && (
              <p className="flex justify-between gap-3 py-1">
                <span className="mgs-muted">{t("order.detail.extra.cancelledAt")}</span>
                <span className="text-right font-semibold">{dateShort(order.cancelled_at, lang)}</span>
              </p>
            )}
            <div className="flex items-center justify-between gap-3 py-1" data-testid="order-detail-number">
              <span className="mgs-muted">{t("order.number")}</span>
              <span className="inline-flex items-center gap-1 text-right font-semibold">
                <span className="num">{order.order_number}</span>
                <span className="relative z-10 inline-flex" onClick={(e) => e.stopPropagation()}>
                  <CopyButton value={order.id} label={t("order.copyNumber")} testId="order-detail-copy" />
                </span>
              </span>
            </div>
            <p className="flex justify-between gap-3 py-1" data-testid="order-detail-date">
              <span className="mgs-muted">{t("order.detail.orderedAt")}</span>
              <span className="text-right font-semibold">{dateShort(order.created_at, lang)}</span>
            </p>
          </div>

          {/* Chevron de repli NU (icône seule), tout en bas ; ouvert : rotation 180°. */}
          <div className="flex justify-center pb-1.5">
            <button type="button" onClick={() => setDetailsOpen((v) => !v)} aria-expanded={detailsOpen} aria-controls="order-detail-extra" data-testid="order-details-toggle" aria-label={t("order.detail.detailsAria")} className="inline-flex h-11 w-11 items-center justify-center text-muted-foreground">
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${detailsOpen ? "rotate-180" : ""}`} />
            </button>
          </div>
        </section>

        <div className="mgs-set mt-2">
          {canHelp && <ActionRow icon="💬" label={t("order.detail.helpRow")} testId="order-help-row" onClick={() => openAssistant(navigate, order)} />}
          {paidOnce && <ActionRow icon="🧾" label={t("order.detail.receiptAction")} testId="order-receipt-action" onClick={printReceipt} />}
        </div>
      </div>

      {/* Barre d'action bas : Chat pilule + bouton principal (reprise / reorder). */}
      <div data-testid="order-detail-bar" className="sticky bottom-0 z-10 mt-5 flex gap-2 border-t border-[color:var(--rule)] bg-[color:hsl(var(--background))] pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:pb-2">
        <button type="button" onClick={() => openAssistant(navigate, order)} data-testid="order-chat-button" className="button-main h-12 flex-none" data-button-theme="dark" data-button-accent="yellow" style={{ width: "92px" }}>
          <span className="button-main-inner full-h"><span className="button-main-inner__back" data-text={t("order.chat")}></span><span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span><MessageCircle className="h-4 w-4" strokeWidth={2} aria-hidden="true" />{t("order.chat")}</span></span></span></span>
        </button>
        {resumeTarget ? (
          <button type="button" onClick={() => navigate(`/orders/${resumeTarget}`)} data-testid="order-resume-pending-button" className="button-main h-12 min-w-0 flex-1" data-button-theme="light" data-button-accent="">
            <span className="button-main-inner full-h"><span className="button-main-inner__back" data-text={resumeLabel}></span><span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{resumeLabel}</span></span></span></span>
          </button>
        ) : (
          <button type="button" onClick={reorder} data-testid="order-again-button" className="button-main h-12 min-w-0 flex-1" data-button-theme="light" data-button-accent="">
            <span className="button-main-inner full-h"><span className="button-main-inner__back" data-text={t("order.detail.orderAgain")}></span><span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{t("order.detail.orderAgain")}</span></span></span></span>
          </button>
        )}
      </div>
    </div>
  );
}