import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { useGames } from "@/context/GameContext";
import { BackButton } from "@/components/common/BackButton";
import { CaptchaWidget, isCaptchaError, useCaptcha } from "@/components/common/CaptchaWidget";
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
  const { items, total, clear, gameId: cartGameId } = useCart();
  const { user } = useAuth();
  const gameSel = useGames();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const ctx = location.state || {};
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [pubgId, setPubgId] = useState(() => {
    const fallback = user?.saved_pubg_ids?.[0] || "";
    try { return ctx.pubgId || searchParams.get("pubg_id") || localStorage.getItem("mgs_last_player_id") || fallback; } catch (_) { return ctx.pubgId || searchParams.get("pubg_id") || fallback; }
  });
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
  const [identityValues, setIdentityValues] = useState({});
  // PL-SEC-HARDEN-1-CAPTCHA : un seul widget persistant pour tout le tunnel
  // (les écrans de saisie sont re-montés à chaque étape, on ne le met pas dedans).
  // Si la clé de site n'est pas configurée, le widget ne s'affiche pas, READY
  // est toujours vrai et `captcha_token` est omis du corps de requête.
  const captcha = useCaptcha();
  const [captchaKey, setCaptchaKey] = useState(0);
  const setVerified = useCallback((v) => setVerifiedState(v), []);
  useEffect(() => {
    if (!pubgId) return;
    try { localStorage.setItem("mgs_last_player_id", pubgId); } catch (_) { /* storage can be unavailable in private mode */ }
  }, [pubgId]);
  // The order's game is the CART's game (a cart holds one game), never a stale header selection.
  const gameId = order?.game_id || cartGameId || gameSel?.selectedId || "pubg-mobile";
  const game = (gameSel?.games || []).find((g) => g.id === gameId);
  // Mémoïsé : sans cela, `game?.identity_fields || []` crée un NOUVEAU tableau à
  // chaque rendu quand le jeu n'a pas de identity_fields. `spec` changeait donc
  // d'identité, `handleVerified` aussi, et l'effet d'annulation de
  // IdentityFieldsVerify (useEffect sur [values, onVerified]) se re-déclenchait : le
  // résultat de la vérification était effacé et le client ne pouvait pas
  // sortir de l'étape 1. Le backend injecte toujours le contrat résolu
  // (GET /api/games), mais le front n'avait pas de repli équivalent à
  // identity_spec() : on fige donc la référence.
  const identitySpec = useMemo(() => game?.identity_fields || [], [game]);
  // Changing game invalidates any identity typed or verified for the previous game.
  useEffect(() => {
    setVerifiedState(null); setIdentity(null); setIdentityValues({});
  }, [gameId]);

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
  const shownId = gameId !== "pubg-mobile" && identitySpec.length
    ? identitySpec.map((f) => (identityValues[f.key] || "").trim()).filter(Boolean).join(" / ")
    : pubgId;
  const summary = { lines, pubgId: order?.pubg_id && gameId === "pubg-mobile" ? order.pubg_id : shownId, name: verified?.name, method: methodLabel(t, method), subtotal, fee: order ? order.payment_fee : paymentFee(config, method, total) };

  const back = () => {
    if (order) return navigate(trackUrl);
    if (step > 0) return go(step - 1);
    return window.history.state?.idx > 0 ? navigate(-1) : navigate("/boutique");
  };

  const createOrder = async (m, extra = {}) => {
    // Identité GÉNÉRIQUE : les champs dynamiques du jeu sont transmis tels quels ; `pubg_id` reste
    // la colonne historique et porte la valeur du champ primaire (PUBG Mobile inchangé).
    const dynamic = gameId !== "pubg-mobile" && identitySpec.length > 0;
    const primaryKey = identitySpec.find((f) => f.primary)?.key || identitySpec[0]?.key || "player_id";
    const fields = dynamic
      ? Object.fromEntries(identitySpec.map((f) => [f.key, (identityValues[f.key] || "").trim()]))
      : undefined;
    const pubgValue = dynamic ? (fields[primaryKey] || "") : pubgId.trim();
    const matchesSaved = identity?.id && (dynamic
      ? Object.entries(identity.fields || {}).every(([k, v]) => fields[k] === v)
      : identity.fields?.player_id === pubgValue);
    const { data } = await api.post("/orders", {
      game_id: gameId, identity_id: user && matchesSaved ? identity.id : undefined, pubg_id: pubgValue,
      ...(fields ? { identity_fields: fields } : {}),
      pseudo: verified?.name || pubgValue, email: email || undefined,
      items: items.map((i) => ({ product_id: i.id, quantity: i.qty })), payment_method: m,
      captcha_token: captcha.tokenFor(),
      ...extra,
    });
    clear();
    setOrder(data);
    return data;
  };

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) {
      toast.error(isCaptchaError(e) ? t("captcha.verifyAgain") : errorMessage(e));
      if (isCaptchaError(e) && captcha.enabled) { captcha.expire(); setCaptchaKey((k) => k + 1); } // jeton à usage unique
    } finally { setBusy(false); }
  };

  const continueMethod = () => {
    if (method !== "binance") return go(2);
    if (!order && !captcha.ready) return;
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
    <StepVerify key="v" gameName={game?.name} pubgId={pubgId} setPubgId={setPubgId} user={user} verified={verified} setVerified={setVerified} autoVerify={autoVerify} setAutoVerify={setAutoVerify} gameId={gameId} identity={identity} setIdentity={setIdentity} identitySpec={identitySpec} identityValues={identityValues} setIdentityValues={setIdentityValues} email={email} setEmail={setEmail} onContinue={() => go(1)} />,
    <PaymentFlow key="m" method={method} setMethod={setMethod} phone={phone} setPhone={setPhone} reference={reference} setReference={setReference} network={network} setNetwork={setNetwork} accepted={accepted} setAccepted={setAccepted} subtotal={subtotal} config={config} crypto={crypto} busy={busy} onContinue={continueMethod} />,
    <StepPay key="p" method={method} order={order} config={config} summary={summary} reference={reference} busy={busy} captchaReady={captcha.ready} onPayAuto={payAuto} onManualPaid={() => go(3)} cryptoPayment={cryptoPayment} onConfirmed={() => go(3)} trackUrl={trackUrl} />,
    <StepConfirm key="c" method={method} order={order} trackUrl={trackUrl} summary={summary} reference={reference} setReference={setReference} busy={busy} captchaReady={captcha.ready} onConfirm={confirmManual} />,
  ];

  return (
    // PL-CHK-1 — colonne de checkout : sur mobile la colonne s'étire jusqu'en
    // bas de l'écran (janvier : header 3.5rem + main pb-6) pour que le gros
    // bouton d'action des étapes 1-2 se colle en bas ; à partir de 1024 px :
    // colonne 480 px, bouton en flux normal (pas d'épinglage).
    <div className="mx-auto flex min-h-[calc(100svh-5rem)] max-w-xl flex-col pt-3 lg:min-h-0 lg:max-w-[480px]" data-testid="checkout-form">
      {/* En-tête compact : retour + petit titre (nom du jeu sur une ligne),
          le gros titre « Finaliser la commande » et la pastille « JEU · NOM »
          sont retirés ; l'étape courante reste portée par le stepper ci-dessous
          via aria-label sur chaque point. */}
      <div className="flex items-center gap-3">
        <BackButton onClick={back} testId="checkout-back" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-bold leading-tight sm:text-base" data-testid="checkout-title">{game?.name || t("checkout.title")}</h1>
        </div>
      </div>
      {/* Stepper 4 points compact (labels remplacés par l'aria de chaque point). */}
      <CheckoutSteps step={step} />
      {/* Screens : pas d'`overflow-hidden` ici — il tuerait tout `sticky`
          descendant ; le glissement horizontal reste clippé par le
          `overflow-x-hidden` racine du Layout. */}
      <div className="relative mt-4 flex flex-1 flex-col">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div key={step} custom={dir} variants={slide} initial="enter" animate="center" exit="exit" transition={{ duration: 0.24, ease: "easeOut" }} className="flex w-full flex-1 flex-col" data-testid={`checkout-screen-${step + 1}`}>
            {screens[step]}
          </motion.div>
        </AnimatePresence>
        {/* Captcha : hors des écrans animés, après la zone étirée — la
            commande est créée au clic de l'étape 2 (binance), 3 (auto) ou
            4 (manuel) — visible et validé pendant tout le parcours ; le
            temps d'apparition (étapes >= 1) et l'alignement sont inchangés. */}
        {step >= 1 && captcha.enabled && (
          <div className="mt-5 rounded-[18px] bg-muted/30 p-3" data-testid="checkout-captcha">
            <CaptchaWidget key={captchaKey} ref={captcha.ref} onVerify={captcha.onVerify} onError={captcha.onError} />
          </div>
        )}
      </div>
    </div>
  );
}
