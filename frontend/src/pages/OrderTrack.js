import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CheckCircle2, Clock, PackageCheck, Search, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, formatAr } from "@/lib/api";
import { paymentColor, paymentLabel } from "@/lib/paymentLabels";
import { clearPendingOrderId } from "@/lib/pendingOrder";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useGames } from "@/context/GameContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/common/BackButton";
import { PaymentCountdown } from "@/components/store/checkout/PaymentCountdown";
import { ProofWaiting, ProofSheet, LateScreen, EndScreen, ProofExpired } from "@/components/store/checkout/ProofPay";
import { CancelSheet } from "@/components/store/checkout/CancelSheet";
import { BinancePay } from "@/components/store/checkout/BinancePay";
import { ManualProviderPicker, CopyButton, pretty } from "@/components/store/PaymentFlow";

// PL-CHK-2 — proof_submitted / late_payment (preuves par captures) rejoignent
// la famille « en attente » : bordure encrée, horloge — même style que les
// anciens statuts de vérification, tokens existants clair et sombre.
const STYLE = {
  pending_payment: ["border-foreground bg-transparent text-foreground", Clock],
  awaiting_verification: ["border-foreground bg-transparent text-foreground", Clock],
  proof_submitted: ["border-foreground bg-transparent text-foreground", Clock],
  late_payment: ["border-foreground bg-transparent text-foreground", Clock],
  paid: ["border-[#0A0A0A] bg-primary text-[#0A0A0A]", CheckCircle2],
  delivered: ["border-foreground bg-foreground text-background", PackageCheck],
  cancelled: ["border-foreground/40 bg-transparent text-muted-foreground line-through", XCircle],
  failed: ["border-destructive bg-destructive text-destructive-foreground", XCircle],
  expired: ["border-foreground/40 bg-transparent text-muted-foreground", Clock],
};

export function StatusPill({ status }) {
  const { t } = useLang();
  const [cls, Icon] = STYLE[status] || STYLE.pending_payment;
  return <span data-testid={`status-${status}`} className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${cls}`}><Icon className="h-3 w-3" strokeWidth={2.25} />{t(`order.status.${status}`)}</span>;
}

// Game + identity captured on the order (snapshot), never assumed to be a PUBG ID.
export function OrderIdentity({ order }) {
  const { games } = useGames();
  const game = games.find((g) => g.id === (order.game_id || "pubg-mobile"));
  const spec = game?.identity_fields || [];
  const fields = order.identity_snapshot?.fields || { player_id: order.pubg_id };
  const parts = Object.entries(fields).map(([k, v]) => `${spec.find((f) => f.key === k)?.label || k} ${v}`);
  return <span data-testid={`order-identity-${order.order_number}`}><b className="text-foreground">{game?.name || order.game_id || "PUBG Mobile"}</b> · {parts.join(" · ")}</span>;
}

export function OrderCard({ order }) {
  const { t, lang } = useLang();
  return (
    <article data-testid={`order-card-${order.order_number}`} className="border border-foreground bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="eyebrow">{t("order.number")}</p><p className="num text-xl">{order.order_number}</p></div>
        <StatusPill status={order.status} />
      </div>
      <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600" data-testid="order-next-step">{t(`order.next.${order.status}`)}</p>
      {order.late_payment && <p className="mt-2 rounded-xl border border-strong px-3 py-2 text-xs" data-testid="order-late-payment">{t("order.latePayment")}</p>}
      <ul className="mt-4 divide-y text-sm">
        {order.items.map((i, idx) => <li key={idx} className="flex justify-between py-2"><span>{i.quantity} × {lang === "en" && i.name_en ? i.name_en : i.name}</span><span className="font-semibold">{formatAr(i.line_total)}</span></li>)}
        {(order.payment_fee ?? order.verification_fee) > 0 && <li className="flex justify-between py-2 text-slate-500" data-testid="order-verification-fee"><span>{t("checkout.paymentFee")}</span><span className="font-semibold">{formatAr(order.payment_fee ?? order.verification_fee)}</span></li>}
      </ul>
      <div className="mt-3 flex flex-wrap justify-between gap-2 border-t pt-3 text-sm text-slate-500">
        <span><OrderIdentity order={order} /> · {order.pseudo}</span>
        <span>{paymentLabel(order.payment_method, t)}</span>
        <span>{new Date(order.created_at).toLocaleString(lang === "en" ? "en-GB" : "fr-FR")}</span>
        <span className="num text-xl text-foreground">{formatAr(order.total)}</span>
      </div>
    </article>
  );
}

// PL-CHK-3 — hook partagé entre la page de recherche (/suivi) et l'écran de
// reprise (/orders/:id) : sondage du paiement AUTOMATIQUE (mvola / orange / fiveone…),
// stocke la réponse (/payments/{id}/status) et signale au parent quand le
// statut vu par le PROVIDER a bougé (visibilité d'écran pas concernée ici :
// 5 s, autorité = serveur). Manuel : exclu (pas d'URL de paiement) — Binance a
// son propre sondage (/crypto/{id}/status dans BinancePay).
function useAutoPaymentPoll(order, onChanged) {
  const [payInfo, setPayInfo] = useState(null);
  useEffect(() => {
    if (!order || order.status !== "pending_payment" || order.payment_method === "manual") return;
    let active = true;
    const refresh = async () => {
      try {
        const { data } = await api.get(`/payments/${order.id}/status`);
        if (!active) return;
        setPayInfo(data);
        if (data.order_status !== order.status) onChanged?.();
      } catch (_) { /* no payment yet */ }
    };
    refresh();
    const id = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(id); };
  }, [order?.id, order?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  return payInfo;
}

// PL-CHK-3 — relance de paiement automatique quand l'échéance a expiré
// (POST /payments/initiate → redirection provider, sinon rechargement local).
// Partagée par les deux écrans ; jamais appelée pour manual (ProofExpired
// propose « recommencer ») ni Binance (jamais de 2ᵉ initiation).
function usePaymentRetry(order, onDone) {
  const [retrying, setRetrying] = useState(false);
  const retry = useCallback(async () => {
    if (!order) return;
    setRetrying(true);
    try {
      const { data } = await api.post("/payments/initiate", { order_id: order.id });
      if (data.payment_url && !data.simulated) { window.location.assign(data.payment_url); return; }
      onDone?.();
    } catch (e) { toast.error(errorMessage(e)); } finally { setRetrying(false); }
  }, [order?.id, onDone]); // eslint-disable-line react-hooks/exhaustive-deps
  return { retrying, retry };
}

// Statut final présent dans ProofPay.js (FINAL_STATUSES) : plafonne aussi la
// mémorisation de reprise (client lecture de commande).
const RESUME_DONE = ["paid", "delivered", "cancelled", "failed", "expired"];

// PL-CHK-4 — écran 2 « Paiement » (/orders/:id, SEUL écran de paiement, reprise
// PL-CHK-3 comprise) reproduit la maquette : en-tête minimal (retour + « Annuler
// la commande »), titre « Ouvrir MVola / Orange Money pour payer » ou « Envoyer
// des USDT », « Payer sous » + compte à rebours mm:ss, deux étapes numérotées
// (losanges, filet vertical), boutons de copie avec retour « Copié », bouton
// fixé en bas. AUCUN récapitulatif (il vit à la fin, écran 4), aucune
// explication longue. Binance : flux existant (détection automatique, aucune
// preuve) — jamais de 2ᵉ initiation. Anciennes commandes sans `manual_operator`
// persisté : le sélecteur d'opérateur de PL-CHK-3 s'affiche.
export function OrderResume({ orderId }) {
  const { t } = useLang();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [config, setConfig] = useState(null);
  const [cryptoPayment, setCryptoPayment] = useState(null);
  const [state, setState] = useState("loading"); // loading | ok | denied
  const [operator, setOperator] = useState(null); // "mvola" | "orange"
  const [proofOpen, setProofOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  // Config (numéro et nom Mvola/Orange issus de la config API, jamais écrits en dur).
  useEffect(() => {
    api.get("/payments/config").then(({ data }) => setConfig(data)).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    setOrder(null); setCryptoPayment(null); setState("loading"); setOperator(null);
    api.get(`/orders/${orderId}`).then(async ({ data }) => {
      if (!active) return;
      setOrder(data);
      setOperator(data.manual_operator || null);
      setState("ok");
      // Binance : rouverture du slot USDT existant via GET /crypto/{id}/status
      // quand il est encore actif — JAMAIS de 2ᵉ initiation (PL-CHK-2).
      if (data?.status === "pending_payment" && data.payment_method === "binance") {
        api.get(`/crypto/${orderId}/status`).then(({ data: st }) => {
          if (active && st?.payment && st.payment.status !== "FAILED") setCryptoPayment(st.payment);
        }).catch(() => { /* sans slot : le compte à rebours reste le seul écran */ });
      }
    }).catch(() => { if (active) setState("denied"); });
    return () => { active = false; };
  }, [orderId]);

  // Statut final / expiration vu par l'API : la mémorisation de reprise meurt
  // (l'invité n'a plus de commande en attente à retrouver).
  useEffect(() => {
    if (order && RESUME_DONE.includes(order.status)) clearPendingOrderId();
  }, [order?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Échéance atteinte ou provider signale un changement : état réel depuis l'API.
  const refetch = useCallback(() =>
    api.get(`/orders/${orderId}`).then(({ data }) => setOrder(data)).catch(() => {}), [orderId]);

  const payInfo = useAutoPaymentPoll(
    order?.status === "pending_payment" && order.payment_method !== "binance" ? order : null,
    refetch,
  );
  const { retrying, retry } = usePaymentRetry(
    ["failed", "expired"].includes(order?.status) && !["manual", "binance"].includes(order?.payment_method) ? order : null,
    refetch,
  );

  if (state === "loading") return null;

  // Récap dérivé de la commande lue (consommé par la feuille de preuve).
  const summary = order ? {
    lines: (order.items || []).map((i) => ({ key: i.product_id, label: `${i.quantity} × ${i.name}` })),
    pubgId: order.pubg_id,
    subtotal: order.subtotal ?? order.total, fee: order.payment_fee ?? 0,
  } : null;

  const back = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate("/"));

  const header = (right) => (
    <header className="flex h-[52px] flex-none items-center justify-between gap-2 px-1">
      <BackButton onClick={back} testId="order-back" />
      {right}
    </header>
  );

  if (state === "denied") {
    // 403 (commande d'un autre client) ou 404 (introuvable) : message générique,
    // JAMAIS de détail — la seule sortie est le retour à l'accueil.
    return (
      <div className="mx-auto flex min-h-[100svh] w-full max-w-[480px] flex-col" data-testid="order-resume">
        {header(null)}
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 text-center" data-testid="order-not-available">
          <p className="font-display text-2xl font-bold">{t("order.notAvailable")}</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{t("order.notAvailableBody")}</p>
          <Button asChild className="mt-6 h-12 w-full max-w-xs rounded-full font-bold" data-testid="order-back-home">
            <Link to="/">{t("order.backHome")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const pending = order.status === "pending_payment";
  const manual = pending && order.payment_method === "manual";
  const binance = pending && order.payment_method === "binance";
  const autoPending = pending && !manual && !binance;
  // Opérateur : champ persisté (PL-ORDER-CLIENT-1) ; null (ancienne commande)
  // → sélecteur PL-CHK-3 affiché, repli local "mvola" pour le titre.
  const op = operator || "mvola";
  const opName = op === "orange" ? t("checkout.methodOrange") : t("checkout.methodMvola");
  const opTitle = op === "orange" ? t("checkout.payTitleOrange") : t("checkout.payTitleMvola");
  const merchant = config?.providers?.[op];
  const payTotal = formatAr((order.subtotal ?? order.total) + (order.payment_fee ?? 0));

  return (
    <div className="mx-auto flex min-h-[100svh] w-full max-w-[480px] flex-col lg:min-h-0" data-testid="order-resume">
      {header(pending && (
        <button type="button" onClick={() => setCancelOpen(true)} data-testid="order-cancel-open"
          className="min-h-[44px] text-xs text-muted-foreground underline decoration-dotted underline-offset-[3px]">
          {t("checkout.cancelOrder")}
        </button>
      ))}

      <div className="flex min-h-0 flex-1 flex-col px-1 pb-2">
        {manual && (
          <>
            {!order.manual_operator && (
              <div className="pt-2" data-testid="resume-operator-picker">
                <ManualProviderPicker provider={op} onSelect={setOperator} />
              </div>
            )}
            <h2 className="pt-3 font-display text-[24px] font-extrabold leading-[1.15]" data-testid="resume-pay-title">{opTitle}</h2>
            <div className="pt-2.5">
              <PaymentCountdown order={order} onZero={refetch} />
            </div>
            {/* Deux étapes numérotées : losanges + filet vertical (maquette). */}
            <div className="relative mt-5 pl-9" data-testid="resume-steps">
              <span className="absolute bottom-4 left-[13px] top-3.5 w-px bg-[color:var(--rule-strong)]" aria-hidden="true" />
              <div className="relative mb-4">
                <Diamond n={1} />
                <h3 className="text-[16px] font-bold leading-[27px]">{t("checkout.transferVia", { name: opName })}</h3>
                {merchant ? (
                  <div className="mt-1">
                    <KV label={t("checkout.youPay")} value={payTotal} copyValue={String((order.subtotal ?? order.total) + (order.payment_fee ?? 0))} testId="pay-amount" />
                    <KV label={t("checkout.ussdName")} value={merchant.name} copyValue={merchant.name} testId="merchant-name" />
                    <KV label={t("checkout.ussdNumberShort")} value={pretty(merchant.merchant)} copyValue={merchant.merchant} testId="merchant-number" />
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground" data-testid="merchant-loading">{t("common.error")}</p>
                )}
              </div>
              <div className="relative">
                <Diamond n={2} />
                <p className="text-[15px] font-semibold leading-snug" data-testid="resume-proof-step">{t("checkout.proofStepText")}</p>
              </div>
            </div>
          </>
        )}

        {binance && (
          <>
            <h2 className="pt-3 font-display text-[24px] font-extrabold leading-[1.15]" data-testid="resume-pay-title">{t("checkout.payTitleBinance")}</h2>
            <div className="pt-2.5">
              <PaymentCountdown order={order} onZero={refetch} />
            </div>
            {cryptoPayment
              ? <div className="mt-4" data-testid="resume-binance"><BinancePay payment={cryptoPayment} orderId={order.id} onConfirmed={refetch} trackUrl="/suivi" /></div>
              : <p className="mt-4 text-sm font-medium text-muted-foreground" data-testid="resume-binance-noproof">{t("checkout.binanceNoProof")}</p>}
          </>
        )}

        {autoPending && (
          // Anciennes commandes automatiques (mvola/orange PAPI) : reprise
          // PL-CHK-3 conservée, restylée (titre + compte à rebours + lien).
          <section className="mt-3 space-y-3" data-testid="resume-auto">
            <h2 className="font-display text-[24px] font-extrabold leading-[1.15]" data-testid="resume-pay-title">{paymentLabel(order.payment_method, t)}</h2>
            <PaymentCountdown order={order} onZero={refetch} />
            {payInfo?.payment_url && !payInfo.simulated && (
              <Button asChild className="h-12 w-full rounded-full font-bold" style={{ background: paymentColor(order.payment_method) }} data-testid="resume-payment-button">
                <a href={payInfo.payment_url}>{t("checkout.resume")}</a>
              </Button>
            )}
            {payInfo?.expires_at && <p className="text-center text-xs text-muted-foreground" data-testid="payment-deadline">{t("checkout.deadline", { time: new Date(payInfo.expires_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) })}</p>}
          </section>
        )}

        {order.status === "proof_submitted" && <ProofWaiting order={order} onUpdated={setOrder} />}
        {order.status === "late_payment" && <LateScreen />}
        {order.status === "expired" && <ProofExpired order={order} />}
        {["cancelled", "failed"].includes(order.status) && <EndScreen order={order} />}
        {["paid", "delivered", "awaiting_verification"].includes(order.status) && <OrderCard order={order} />}
      </div>

      {/* Boutons fixés en bas (mobile) ; ≥1024 px : flux normal. */}
      {manual && (
        <div className="sticky bottom-0 z-10 flex-none bg-[color:hsl(var(--background))] px-1 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 lg:static lg:z-auto lg:bg-transparent lg:pb-2">
          <Button type="button" onClick={() => setProofOpen(true)} data-testid="send-proof-button" className="h-[52px] w-full rounded-full text-[15px] font-extrabold">
            {t("checkout.sendProof")}
          </Button>
        </div>
      )}
      {binance && (
        <div className="sticky bottom-0 z-10 flex-none bg-[color:hsl(var(--background))] px-1 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 lg:static lg:z-auto lg:bg-transparent lg:pb-2">
          <Button type="button" disabled data-testid="binance-waiting" className="h-[52px] w-full rounded-full text-[15px] font-extrabold">
            {t("checkout.binanceWaiting")}
          </Button>
        </div>
      )}
      {["failed", "expired"].includes(order.status) && !["manual", "binance"].includes(order.payment_method) && (
        <div className="sticky bottom-0 z-10 flex-none bg-[color:hsl(var(--background))] px-1 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 lg:static lg:z-auto lg:bg-transparent lg:pb-2">
          <Button onClick={retry} disabled={retrying} variant="outline" className="h-12 w-full rounded-full font-bold" data-testid="retry-payment-button">{t("checkout.retry")}</Button>
        </div>
      )}

      {/* Feuille 3 (preuve) et feuille 7 (annulation). */}
      {manual && (
        <ProofSheet
          open={proofOpen} onOpenChange={setProofOpen}
          order={order} summary={summary}
          onSubmitted={() => setProofOpen(false)} onUpdated={setOrder} />
      )}
      {pending && (
        <CancelSheet
          open={cancelOpen} onOpenChange={setCancelOpen}
          order={order}
          onCancelled={() => navigate("/", { replace: true })}
          onConflict={refetch} />
      )}
    </div>
  );
}

// Losange numéroté (maquette : carré pivoté 45°, chiffre redressé).
function Diamond({ n }) {
  return (
    <span className="absolute -left-9 top-0 flex h-[27px] w-[27px] rotate-45 items-center justify-center rounded-[6px] bg-foreground" aria-hidden="true">
      <span className="-rotate-45 text-[13px] font-extrabold text-background">{n}</span>
    </span>
  );
}

// Ligne clé/valeur de l'étape 1 + bouton de copie (retour « Copié » polie).
function KV({ label, value, copyValue, testId }) {
  const { t } = useLang();
  return (
    <div className="mt-3.5 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 num break-all text-[16px] font-bold" data-testid={testId}>{value}</p>
      </div>
      <CopyButton value={copyValue} label={`${t("checkout.copy")} ${label}`} testId={`copy-${testId}`} />
    </div>
  );
}

export default function OrderTrack() {
  // PL-CHK-3 — sélecteur de route sans hook conditionnel : /orders/:orderId
  // monte l'écran de reprise, toute autre route équipe la page de recherche.
  const { orderId } = useParams();
  if (orderId) return <OrderResume orderId={orderId} />;
  return <OrderTrackSearch />;
}

function OrderTrackSearch() {
  const { orderNumber } = useParams();
  const { t } = useLang();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [number, setNumber] = useState(orderNumber || "");
  const [pubgId, setPubgId] = useState(params.get("pubg_id") || "");
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!user) { setHistory(null); return; }
    api.get("/orders/me").then((r) => setHistory(r.data)).catch(() => setHistory([]));
  }, [user]);

  const search = async (n = number, p = pubgId) => {
    if (!n || !p) return;
    setBusy(true); setError(""); setOrder(null);
    try { const { data } = await api.get("/orders/track", { params: { order_number: n, pubg_id: p } }); setOrder(data); }
    catch (e) { setError(e.response?.status === 404 ? t("order.notFound") : errorMessage(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (orderNumber && params.get("pubg_id")) search(orderNumber, params.get("pubg_id")); }, [orderNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  const payInfo = useAutoPaymentPoll(order, () => search(order.order_number, order.pubg_id));
  const { retrying, retry } = usePaymentRetry(order, () => search(order.order_number, order.pubg_id));

  useEffect(() => {
    const ret = params.get("return");
    if (ret === "failure") toast.error(t("order.next.failed"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-2xl pb-24 pt-6">
      <h1 className="font-display text-3xl font-bold text-slate-900 sm:text-4xl">{t("order.track")}</h1>
      {user && <p className="mt-1 text-sm text-slate-500"><Link to="/compte" className="font-semibold text-primary" data-testid="go-to-account">{t("account.orders")} →</Link></p>}
      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="mt-6 grid gap-3 rounded-[2rem] border border-slate-100 bg-white p-5 sm:grid-cols-[1fr_1fr_auto]" data-testid="track-form">
        <Input data-testid="track-order-number" value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} placeholder="MGS-XXXXXX" className="h-12 rounded-xl font-mono" required />
        <Input data-testid="track-pubg-id" value={pubgId} onChange={(e) => setPubgId(e.target.value.replace(/\D/g, ""))} placeholder={t("checkout.pubgId")} className="h-12 rounded-xl" required inputMode="numeric" />
        <Button type="submit" disabled={busy} className="h-12 rounded-xl px-5 font-bold" data-testid="track-submit"><Search className="mr-2 h-4 w-4" />{t("order.find")}</Button>
      </form>
      {error && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700" data-testid="track-error">{error}</p>}
      {order && (
        <div className="mt-6 space-y-3">
          <OrderCard order={order} />
          {order.status === "pending_payment" && payInfo?.payment_url && !payInfo.simulated && (
            <Button asChild className="h-12 w-full rounded-full font-bold" style={{ background: paymentColor(order.payment_method) }} data-testid="resume-payment-button">
              <a href={payInfo.payment_url}>{t("checkout.resume")}</a>
            </Button>
          )}
          {order.status === "pending_payment" && payInfo?.expires_at && <p className="text-center text-xs text-muted-foreground" data-testid="payment-deadline">{t("checkout.deadline", { time: new Date(payInfo.expires_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) })}</p>}
          {["failed", "expired"].includes(order.status) && !["manual", "binance"].includes(order.payment_method) && (
            <Button onClick={retry} disabled={retrying} variant="outline" className="h-12 w-full rounded-full font-bold" data-testid="retry-payment-button">{t("checkout.retry")}</Button>
          )}
        </div>
      )}
      {user && history && (
        <section className="mt-12" data-testid="order-history">
          <div className="flex items-end justify-between gap-3">
            <h2 className="font-display text-xl font-bold text-slate-900 sm:text-2xl">{t("order.history")}</h2>
            {history.length > 5 && (
              <button onClick={() => setShowAll((s) => !s)} className="text-sm font-semibold text-primary" data-testid="order-history-toggle">
                {showAll ? t("order.seeLess") : `${t("order.seeAll")} (${history.length})`}
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-slate-100 bg-white p-6 text-sm text-slate-500" data-testid="order-history-empty">{t("order.historyEmpty")}</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {history.slice(0, showAll ? 100 : 5).map((o) => (
                <li key={o.id} data-testid={`history-order-${o.order_number}`} className="rounded-2xl border border-slate-100 bg-white p-5">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2.5">
                        <span className="num text-lg text-foreground">{o.order_number}</span>
                        <StatusPill status={o.status} />
                      </p>
                      <p className="mt-2 truncate text-sm font-medium text-slate-700">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</p>
                      <p className="mt-1.5 text-xs text-slate-500">{new Date(o.created_at).toLocaleString("fr-FR")} · <OrderIdentity order={o} /></p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2.5">
                      <span className="num text-xl text-foreground">{formatAr(o.total)}</span>
                      {/* PL-CHK-3 — commande en attente : bouton de reprise menant à
                          /orders/:id (écran complet). Labels par statut/méthode. */}
                      {["pending_payment", "proof_submitted"].includes(o.status) && (
                        <Button asChild size="sm" className="h-8 rounded-full px-4 text-xs font-bold" data-testid={`history-resume-${o.order_number}`}>
                          <Link to={`/orders/${o.id}`}>
                            {o.status === "proof_submitted" ? t("order.resumeView")
                              : o.payment_method === "manual" ? t("order.resumeProof") : t("order.resumePay")}
                          </Link>
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-8 rounded-full px-4 text-xs font-bold" data-testid={`history-track-${o.order_number}`}
                        onClick={() => { setNumber(o.order_number); setPubgId(o.pubg_id); search(o.order_number, o.pubg_id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                        {t("order.viewTrack")}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
