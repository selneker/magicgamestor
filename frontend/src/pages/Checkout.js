import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, formatAr } from "@/lib/api";
import { writePendingOrderId } from "@/lib/pendingOrder"; // PL-CHK-3
import { useLang } from "@/context/LanguageContext";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { useGames } from "@/context/GameContext";
import { CaptchaWidget, isCaptchaError, useCaptcha } from "@/components/common/CaptchaWidget";
import { CheckoutSheet } from "@/components/store/checkout/CheckoutSheet";
import { IdentityFieldsVerify } from "@/components/store/checkout/IdentityFieldsVerify";
import { PAYMENT_LOGOS, NetworkPicker, paymentFee } from "@/components/store/PaymentFlow";

// PL-DS-V3 — écran 1 « Commande » rebuild sur la structure EXACTE du prototype
// design-system-v3.html : .mgs-shell.mgs-co-shell > .mgs-co-screen (top
// retour+jeu+suivi, pay « Vous payez » + total, receive, divider, id joueur,
// methods en label.mgs-co-method radio, note, submit .mgs-co-submit). La
// commande est créée ICI puis redirection vers /orders/:id (écrans 2/3).
// Logique, testids, feuille captcha keepMounted inchangés.

// PL-CHK-2-FIX1 : les 422 Pydantic sont traduites en libellés lisibles.
const FIELD_TEXT_KEYS = { payment_phone: "checkout.phoneError", manual_operator: "checkout.orderValidationError" };
const validationDetails = (e) => {
  const d = e?.response?.data?.detail;
  return e?.response?.status === 422 && Array.isArray(d) ? d : null;
};
const validationField = (details) => {
  const loc = details?.find((x) => Array.isArray(x?.loc) && x.loc.length > 1)?.loc;
  return loc ? loc[loc.length - 1] : null;
};

export default function Checkout() {
  const { t, lang } = useLang();
  const { items, total, clear, gameId: cartGameId } = useCart();
  const { user } = useAuth();
  const gameSel = useGames();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [pubgId, setPubgId] = useState(() => {
    const fallback = user?.saved_pubg_ids?.[0] || "";
    try { return searchParams.get("pubg_id") || localStorage.getItem("mgs_last_player_id") || fallback; } catch (_) { return searchParams.get("pubg_id") || fallback; }
  });
  const [verified, setVerifiedState] = useState(null);
  const [editingId, setEditingId] = useState(false);
  const [method, setMethod] = useState(null); // "mvola" | "orange" (manuel) | "binance"
  const [network, setNetwork] = useState(null);
  const [config, setConfig] = useState(null);
  const [crypto, setCrypto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [autoVerify, setAutoVerify] = useState(0);
  const [identity, setIdentity] = useState(null);
  const [identityValues, setIdentityValues] = useState({});
  // Garde anti double-clic synchrone : un seul appel API part jamais.
  const inFlight = useRef(false);
  const captcha = useCaptcha();
  const [captchaKey, setCaptchaKey] = useState(0);
  // Feuille « Vérification de sécurité » : le widget reste MONTÉ (invisible
  // tant que Cloudflare ne demande rien) — la feuille est toujours dans le DOM.
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const pendingSubmit = useRef(false);

  useEffect(() => {
    if (!pubgId) return;
    try { localStorage.setItem("mgs_last_player_id", pubgId); } catch (_) { /* storage indisponible */ }
  }, [pubgId]);

  // The order's game is the CART's game (a cart holds one game).
  const gameId = cartGameId || gameSel?.selectedId || "pubg-mobile";
  const game = (gameSel?.games || []).find((g) => g.id === gameId);
  const identitySpec = useMemo(() => game?.identity_fields || [], [game]);
  useEffect(() => {
    setVerifiedState(null); setIdentity(null); setIdentityValues({}); setEditingId(false);
  }, [gameId]);

  useEffect(() => {
    api.get("/payments/config").then(({ data }) => setConfig(data)).catch(() => {});
    api.get("/crypto/config").then(({ data }) => setCrypto(data)).catch(() => {});
  }, []);

  // Méthodes réellement actives (source : /payments/config + /crypto/config).
  const mvolaActive = !config || config.providers?.mvola?.configured !== false;
  const orangeActive = !config || config.providers?.orange?.configured !== false;
  const binanceActive = !!crypto?.available;

  const subtotal = total;
  const fee = method ? paymentFee(config, method === "binance" ? "binance" : "manual", subtotal) : 0;

  const shownId = useMemo(() => {
    if (gameId !== "pubg-mobile" && identitySpec.length) {
      return identitySpec.map((f) => (identityValues[f.key] || "").trim()).filter(Boolean).join(" / ");
    }
    return pubgId;
  }, [gameId, identitySpec, identityValues, pubgId]);

  const receiveText = items.map((i) => `${i.qty} × ${i.name}`).join(", ");

  const back = () => navigate("/boutique", { replace: true });

  const setVerified = useCallback((v) => {
    setVerifiedState(v);
    if (v) setEditingId(false);
  }, []);

  const saveIdentity = useCallback((fields, name) => {
    if (!user) return;
    const primaryKey = identitySpec.find((f) => f.primary)?.key || identitySpec[0]?.key;
    api.post("/me/game-identities", { game_id: gameId, label: name || fields[primaryKey], fields, ...(name ? { player_name: name } : {}) })
      .then(({ data }) => setIdentity(data))
      .catch(() => { /* l'identité n'est pas mémorisée : commande sans identity_id */ });
  }, [user, gameId, identitySpec]);

  const valuesRef = useRef(identityValues);
  valuesRef.current = identityValues;
  const handleVerified = useCallback((v) => {
    setVerified(v);
    if (!v) return;
    const fields = Object.fromEntries(identitySpec.map((f) => [f.key, (valuesRef.current[f.key] || "").trim()]));
    const primaryKey = identitySpec.find((f) => f.primary)?.key || identitySpec[0]?.key;
    if (primaryKey && fields[primaryKey]) setPubgId(fields[primaryKey]);
    saveIdentity(fields, v.name);
  }, [setVerified, identitySpec, saveIdentity]);

  const createOrder = async (tokenArg) => {
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
      pseudo: verified?.name || pubgValue,
      items: items.map((i) => ({ product_id: i.id, quantity: i.qty })),
      payment_method: method === "binance" ? "binance" : "manual",
      ...(method && method !== "binance" ? { manual_operator: method } : {}),
      captcha_token: tokenArg ?? captcha.tokenFor(),
    });
    writePendingOrderId(data.id, data.created_at || new Date().toISOString());
    clear();
    return data;
  };

  const run = async (fn) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const vDetails = validationDetails(e);
      toast.error(isCaptchaError(e)
        ? t("captcha.verifyAgain")
        : (vDetails ? t(FIELD_TEXT_KEYS[validationField(vDetails)] || "checkout.orderValidationError") : errorMessage(e)));
      if (isCaptchaError(e) && captcha.enabled) { captcha.expire(); setCaptchaKey((k) => k + 1); }
      setCaptchaOpen(false);
    } finally { inFlight.current = false; setBusy(false); }
  };

  const goToOrder = (data) => {
    pendingSubmit.current = false;
    setCaptchaOpen(false);
    navigate(`/orders/${data.id}`, { replace: true });
  };

  const submitOrder = async (tokenArg) => {
    if (!method) return;
    if (method === "binance") {
      let created = null;
      await run(async () => {
        created = await createOrder(tokenArg);
        await api.post("/crypto/initiate", { order_id: created.id, network });
      });
      if (created) goToOrder(created);
      return;
    }
    await run(async () => { const created = await createOrder(tokenArg); goToOrder(created); });
  };

  const onPlaceOrder = () => {
    if (!verified || !method || busy) return;
    if (captcha.enabled && !captcha.ready) {
      pendingSubmit.current = true;
      setCaptchaOpen(true);
      return;
    }
    submitOrder();
  };

  const handleCaptchaVerify = (token) => {
    captcha.onVerify(token);
    if (token && pendingSubmit.current) submitOrder(token);
  };

  const canSubmit = !!verified && !!method && (method !== "binance" || !!network);

  if (items.length === 0) {
    return (
      <section className="section">
        <div className="container">
          <div className="mgs-shell mgs-co-shell">
            <div className="mgs-co-screen" data-testid="checkout-form">
              <div className="mgs-co-top">
                <button type="button" className="mgs-co-back" onClick={back} data-testid="checkout-back"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("common.back")}</button>
              </div>
              <div className="flex flex-1 items-center justify-center py-24 text-center" data-testid="checkout-empty">
                <div>
                  <p className="mgs-sub">{t("cart.empty")}</p>
                  <button type="button" onClick={back} className="button-main h-11" data-button-theme="dark" data-button-accent="yellow" data-testid="checkout-browse" style={{ marginTop: "1em" }}>
                    <span className="button-main-inner full-h"><span className="button-main-inner__back" data-text={t("cart.browse")}></span><span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{t("cart.browse")}</span></span></span></span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="section">
      <div className="container">
        <div className="mgs-shell mgs-co-shell">
          <div className="mgs-co-screen" data-testid="checkout-form">
            {/* En-tête : retour + nom du jeu + sortie suivi. */}
            <div className="mgs-co-top">
              <button type="button" className="mgs-co-back" onClick={back} data-testid="checkout-back"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("common.back")}</button>
              <span className="mgs-co-game" data-testid="checkout-title">{game?.name || t("checkout.title")}</span>
              <Link to="/suivi" className="mgs-co-track" data-testid="checkout-exit">{t("order.viewTrack")}</Link>
            </div>

            {/* Montant en grand. */}
            <div className="mgs-co-pay" data-testid="checkout-amount-block">
              <p className="eyebrow">{t("checkout.youPay")}</p>
              <p className="mgs-co-total" data-testid="checkout-amount">{formatAr(total, lang)}</p>
            </div>
            <div className="mgs-co-receive"><span>{t("checkout.youReceive")}</span><span className="mgs-co-items" data-testid="checkout-receive">{receiveText}</span></div>
            {fee > 0 && <p className="mgs-co-note" data-testid="checkout-fee-line">{t("checkout.paymentFee")} : {formatAr(fee, lang)}</p>}
            <div className="mgs-divider"></div>

            {/* ID joueur : vérifié (ID + pseudo, coche, « Changer ») ou formulaire. */}
            <div className="mgs-co-id">
              <p className="eyebrow">{t("checkout.playerIdLabel")}</p>
              {verified && !editingId ? (
                <div data-testid="checkout-player-verified">
                  <div className="mgs-co-id-row">
                    <strong className="num" data-testid="checkout-player-id" style={{ flex: 1, minWidth: 0 }}>{shownId}</strong>
                    <button type="button" onClick={() => setEditingId(true)} data-testid="checkout-change-id" className="button-main mgs-co-verify" data-button-theme="light" data-button-accent="">
                      <span className="button-main-inner full-h"><span className="button-main-inner__back" data-text={t("checkout.change")}></span><span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{t("checkout.change")}</span></span></span></span>
                    </button>
                  </div>
                  <p className="mgs-co-id-status" data-testid="checkout-player-ok">
                    <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full" style={{ background: "var(--color--green-700, #16a34a)", color: "#fff" }} aria-hidden="true"><Check className="h-3 w-3" strokeWidth={3} /></span>
                    <span className="min-w-0 truncate" data-testid="checkout-player-pseudo">{verified.name || "—"}</span>
                  </p>
                </div>
              ) : (
                <IdentityFieldsVerify
                  spec={identitySpec} gameId={gameId}
                  values={identityValues} setValues={setIdentityValues}
                  onVerified={handleVerified} autoTrigger={autoVerify}
                  editing={editingId}
                  initial={verified} />
              )}
            </div>

            {/* Mode de paiement : label.mgs-co-method radio (jamais de méthode désactivée). */}
            <div className="mgs-co-methods">
              <p className="eyebrow">{t("checkout.payment")}</p>
              <div data-testid="payment-methods">
                {mvolaActive && <MethodLine testId="method-mvola" logo={PAYMENT_LOGOS.mvola} name="MVola" sub={t("checkout.methodManualSub")} selected={method === "mvola"} onSelect={() => setMethod("mvola")} />}
                {orangeActive && <MethodLine testId="method-orange" logo={PAYMENT_LOGOS.orange} name="Orange Money" sub={t("checkout.methodManualSub")} selected={method === "orange"} onSelect={() => setMethod("orange")} dark />}
                {binanceActive && (
                  <div>
                    <MethodLine testId="method-binance" logo={PAYMENT_LOGOS.binance} name="Binance" sub={t("checkout.methodBinanceSub")} selected={method === "binance"} onSelect={() => setMethod("binance")} />
                    {method === "binance" && crypto?.networks?.length > 0 && (
                      <div className="px-3 pb-3 pt-2" data-testid="payment-expanded-binance">
                        <NetworkPicker crypto={crypto} network={network} setNetwork={setNetwork} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Remarque courte — UNE seule, selon la méthode choisie. */}
            {method && (
              <p className="mgs-co-note flex gap-2" data-testid="checkout-remark">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{t(method === "mvola" ? "checkout.remarkMvola" : method === "orange" ? "checkout.remarkOrange" : "checkout.remarkBinance")}</span>
              </p>
            )}

            <button type="button" onClick={onPlaceOrder} disabled={!canSubmit || busy} data-testid="checkout-submit" className="button-main mgs-co-submit disabled:opacity-50" data-button-theme="dark" data-button-accent="green" style={{ width: "100%" }}>
              <span className="button-main-inner full-h">
                <span className="button-main-inner__back" data-text={t("checkout.placeOrder")}></span>
                <span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checkout.creating")}</> : t("checkout.placeOrder")}</span></span></span>
              </span>
            </button>
          </div>

          {/* Feuille « Vérification de sécurité » — coquille keepMounted : le
              widget tourne invisiblement DANS la feuille fermée. */}
          {captcha.enabled && (
            <CheckoutSheet
              open={captchaOpen} keepMounted testId="captcha-sheet"
              busy={busy}
              onOpenChange={(v) => { pendingSubmit.current = false; setCaptchaOpen(v); }}
              title={t("checkout.captchaSheetTitle")}
              footer={
                <button type="button" onClick={() => submitOrder()} disabled={!captcha.ready || busy} data-testid="captcha-sheet-submit" className="button-main h-[52px] flex-1 disabled:opacity-50 lg:h-[46px]" data-button-theme="dark" data-button-accent="green">
                  <span className="button-main-inner full-h">
                    <span className="button-main-inner__back" data-text={t("checkout.placeOrder")}></span>
                    <span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checkout.creating")}</> : t("checkout.placeOrder")}</span></span></span>
                  </span>
                </button>
              }
            >
              <p className="mgs-co-note" style={{ paddingBottom: ".5em" }}>{t("checkout.captchaSheetSub")}</p>
              <CaptchaWidget key={captchaKey} ref={captcha.ref} onVerify={handleCaptchaVerify} onInteractive={(needed) => { if (needed) setCaptchaOpen(true); }} />
            </CheckoutSheet>
          )}
        </div>
      </div>
    </section>
  );
}

// PL-DS-V3 — ligne de méthode du prototype : label.mgs-co-method (radio natif +
// logo + mgs-co-mtext b/small + pastille radio). La sélection pilote l'état React.
function MethodLine({ testId, logo, name, sub, selected, onSelect, dark }) {
  return (
    <label className={`mgs-co-method${selected ? " is--selected" : ""}`} data-testid={testId}>
      <input type="radio" name="comethod" value={name} checked={selected} onChange={onSelect} />
      {logo
        ? <span className={`mgs-co-logo${dark ? " mgs-co-logo--dark" : ""}`}><img src={logo} alt={name} style={{ objectFit: "contain" }} /></span>
        : <span className={`mgs-co-logo${dark ? " mgs-co-logo--dark" : ""}`} aria-hidden="true">{name.slice(0, 1)}</span>}
      <span className="mgs-co-mtext"><b>{name}</b><small>{sub}</small></span>
      <span className="mgs-co-radio" aria-hidden="true" />
    </label>
  );
}