import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { useGames } from "@/context/GameContext";
import { BackButton } from "@/components/common/BackButton";
import { PaymentFlow, methodLabel, paymentFee } from "@/components/store/PaymentFlow";
import { CheckoutSteps } from "@/components/store/checkout/CheckoutSteps";
import { StepVerify } from "@/components/store/checkout/StepVerify";
import { StepPay } from "@/components/store/checkout/StepPay";
import { StepConfirm } from "@/components/store/checkout/StepConfirm";
import { Button } from "@/components/ui/button";

const slide = {
  enter: (d) => ({ x: d > 0 ? "100%" : "-100%", opacity: 0.5 }),
  center: { x: 0, opacity: 1 },
  exit: (d) => ({ x: d > 0 ? "-100%" : "100%", opacity: 0.5 }),
};
const initiateUrl = (o) => (o.payment_provider === "fiveone" ? "/payments/fiveone/initiate" : "/payments/initiate");

export default function Checkout() {
  const { t, lang } = useLang();
  const { items, total, clear } = useCart();
  const { user } = useAuth();
  const gameId = useGames()?.selectedId || "pubg-mobile";
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const ctx = location.state || {};
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [pubgId, setPubgId] = useState(ctx.pubgId || searchParams.get("pubg_id") || user?.saved_pubg_ids?.[0] || "");
  const [verified, setVerifiedState] = useState(null);
  const [email, setEmail] = useState(ctx.email || "");
  const [method, setMethod] = useState(null);
  const [phone, setPhone] = useState(user?.phone || "");
  const [reference, setReference] = useState({ provider: "mvola", value: "" });
  const [network, setNetwork] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [config, setConfig] = useState(null);
  const [crypto, setCrypto] = useState(null);
  const [order, setOrder] = useState(null);
  const [cryptoPayment, setCryptoPayment] = useState(null);
  const [busy, setBusy] = useState(false);
  const [autoVerify, setAutoVerify] = useState(0);
  const [identity, setIdentity] = useState(null);
  const setVerified = useCallback((v) => setVerifiedState(v), []);

  useEffect(() => {
    api.get("/payments/config").then(({ data }) => setConfig(data)).catch(() => {});
    api.get("/crypto/config").then(({ data }) => setCrypto(data)).catch(() => {});
  }, []);

  const go = useCallback((n) => { setDir(n > step ? 1 : -1); setStep(n); window.scrollTo({ top: 0, behavior: "smooth" }); }, [step]);


  if (items.length === 0 && !order) {
    return <div className="py-24 text-center" data-testid="checkout-empty"><p className="text-muted-foreground">{t("cart.empty")}</p><Button asChild className="mt-4 rounded-full"><Link to="/boutique">{t("cart.browse")}</Link></Button></div>;
  }

  const trackUrl = order ? `/suivi/${order.order_number}?pubg_id=${order.pubg_id}` : "/suivi";
  const subtotal = order ? order.subtotal : total;
  const lines = order
    ? order.items.map((i) => ({ key: i.product_id, label: `${i.quantity} × ${i.name}` }))
    : items.map((i) => ({ key: i.id, label: `${i.qty} × ${lang === "en" && i.name_en ? i.name_en : i.name}` }));
  const summary = { lines, pubgId, name: verified?.name, method: methodLabel(t, method), subtotal, fee: order ? order.payment_fee : paymentFee(config, method, total) };

  const back = () => {
    if (order) return navigate(trackUrl);
    if (step > 0) return go(step - 1);
    return window.history.state?.idx > 0 ? navigate(-1) : navigate("/boutique");
  };

  const createOrder = async (m, extra = {}) => {
    const { data } = await api.post("/orders", {
      game_id: gameId, identity_id: user && identity?.fields?.player_id === pubgId.trim() ? identity.id : undefined, pubg_id: pubgId.trim(), pseudo: verified?.name || pubgId.trim(), email: email || undefined,
      items: items.map((i) => ({ product_id: i.id, quantity: i.qty })), payment_method: m, ...extra,
    });
    clear();
    setOrder(data);
    return data;
  };

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const continueMethod = () => {
    if (method !== "binance") return go(2);
    return run(async () => {
      const created = order || await createOrder("binance");
      const { data } = await api.post("/crypto/initiate", { order_id: created.id, network });
      setCryptoPayment(data);
      go(2);
    });
  };

  const payAuto = () => run(async () => {
    const created = order || await createOrder(method, { payment_phone: phone });
    const { data: payment } = await api.post(initiateUrl(created), { order_id: created.id });
    if (payment.payment_url && !payment.simulated) { window.location.assign(payment.payment_url); return; }
    setOrder({ ...created, simulated: payment.simulated, attempt: (order?.attempt || 0) + 1 });
  });

  const confirmManual = () => run(async () => {
    const created = await createOrder("manual", { manual_reference: `${reference.provider}:${reference.value.trim()}` });
    toast.success(`${t("order.title")} ${created.order_number}`);
    navigate(`/suivi/${created.order_number}?pubg_id=${created.pubg_id}`);
  });

  const screens = [
    <StepVerify key="v" pubgId={pubgId} setPubgId={setPubgId} user={user} verified={verified} setVerified={setVerified} autoVerify={autoVerify} setAutoVerify={setAutoVerify} gameId={gameId} identity={identity} setIdentity={setIdentity} email={email} setEmail={setEmail} onContinue={() => go(1)} />,
    <PaymentFlow key="m" method={method} setMethod={setMethod} phone={phone} setPhone={setPhone} reference={reference} setReference={setReference} network={network} setNetwork={setNetwork} accepted={accepted} setAccepted={setAccepted} subtotal={subtotal} config={config} crypto={crypto} busy={busy} onContinue={continueMethod} />,
    <StepPay key="p" method={method} order={order} config={config} summary={summary} reference={reference} busy={busy} onPayAuto={payAuto} onManualPaid={() => go(3)} cryptoPayment={cryptoPayment} onConfirmed={() => go(3)} trackUrl={trackUrl} />,
    <StepConfirm key="c" method={method} order={order} trackUrl={trackUrl} summary={summary} reference={reference} setReference={setReference} busy={busy} onConfirm={confirmManual} />,
  ];

  return (
    <div className="mx-auto max-w-xl pb-16 pt-3" data-testid="checkout-form">
      <div className="flex items-center gap-3">
        <BackButton onClick={back} testId="checkout-back" />
        <div className="min-w-0">
          <p className="eyebrow" data-testid="checkout-step-label">{t("checkout.stepOf", { n: step + 1 })}</p>
          <h1 className="font-display text-2xl font-bold sm:text-3xl">{t("checkout.title")}</h1>
        </div>
      </div>
      <CheckoutSteps step={step} />
      <div className="relative mt-5 overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div key={step} custom={dir} variants={slide} initial="enter" animate="center" exit="exit" transition={{ duration: 0.24, ease: "easeOut" }} className="w-full" data-testid={`checkout-screen-${step + 1}`}>
            {screens[step]}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
