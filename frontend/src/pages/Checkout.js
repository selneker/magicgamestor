import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, formatAr } from "@/lib/api";
import { writePendingOrderId } from "@/lib/pendingOrder"; // PL-CHK-3
import { useLang } from "@/context/LanguageContext";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { useGames } from "@/context/GameContext";
import { BackButton } from "@/components/common/BackButton";
import { CaptchaWidget, isCaptchaError, useCaptcha } from "@/components/common/CaptchaWidget";
import { CheckoutSheet } from "@/components/store/checkout/CheckoutSheet";
import { IdentityFieldsVerify } from "@/components/store/checkout/IdentityFieldsVerify";
import { PAYMENT_LOGOS, NetworkPicker, paymentFee } from "@/components/store/PaymentFlow";

// PL-CHK-4 — écran 1 « Commande » (maquette Binance, 3 étapes réelles, aucun
// stepper). L'écran tient dans 360×640 sans défilement, bouton principal fixé
// en bas : en-tête minimal (retour + nom du jeu), montant en grand, ID joueur
// vérifié (ID + pseudo sur deux lignes), modes de paiement en LIGNES séparées
// (MVola manuel / Orange Money manuel / Binance USDT — uniquement les méthodes
// réellement actives), une remarque courte selon la méthode. AUCUN récapitulatif
// (il vit à la fin, écran 4), aucun bloc de frais détaillé (une seule petite
// ligne si des frais > 0 existent), aucun stepper, aucune carte explicative.
// La commande est créée ICI puis redirection vers /orders/:id (écran 2), qui
// est le SEUL écran de paiement. PL-CHK-6 : /commande ne lit plus la clé de
// reprise — une commande en attente s'offre par la bannière, jamais ici.

// PL-CHK-6 — PLUS AUCUNE reprise ici : une commande en attente s'offre
// (bannière « Commande en cours ») et la liste des commandes la montre ; elle
// ne s'impose JAMAIS. L'ancienne reprise PL-CHK-3 redirigeait /commande vers
// /orders/:id pour TOUTE commande mémorisée active — y compris une commande
// invalide (manuelle sans opérateur) : le client était bloqué hors du tunnel
// et « Recommencer » ne purgeait pas la clé → boucle. La seule redirection du
// tunnel reste celle qui suit immédiatement une création réussie.

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
  // Feuille « Vérification de sécurité » (écran 9) : le widget reste MONTÉ
  // (invisible tant que Cloudflare ne demande rien) — la feuille est donc
  // toujours dans le DOM, en `invisible` quand fermée.
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const pendingSubmit = useRef(false);

  useEffect(() => {
    if (!pubgId) return;
    try { localStorage.setItem("mgs_last_player_id", pubgId); } catch (_) { /* storage indisponible */ }
  }, [pubgId]);

  // The order's game is the CART's game (a cart holds one game).
  const gameId = cartGameId || gameSel?.selectedId || "pubg-mobile";
  const game = (gameSel?.games || []).find((g) => g.id === gameId);
  // Référence figée (voir PL-CHK-1 : sans memo, le résultat de vérification
  // était effacé par le re-déclenchement de l'effet d'annulation).
  const identitySpec = useMemo(() => game?.identity_fields || [], [game]);
  useEffect(() => {
    setVerifiedState(null); setIdentity(null); setIdentityValues({}); setEditingId(false);
  }, [gameId]);

  useEffect(() => {
    api.get("/payments/config").then(({ data }) => setConfig(data)).catch(() => {});
    api.get("/crypto/config").then(({ data }) => setCrypto(data)).catch(() => {});
  }, []);

  // Méthodes réellement actives (source : /payments/config + /crypto/config,
  // inventaire étape 0). Aucune méthode désactivée n'est jamais affichée :
  // MVola / Orange manuels suivent providers.*.configured (env backend),
  // Binance suit crypto.available.
  const mvolaActive = !config || config.providers?.mvola?.configured !== false;
  const orangeActive = !config || config.providers?.orange?.configured !== false;
  const binanceActive = !!crypto?.available;

  const subtotal = total;
  // Frais de la méthode choisie (Binance : 0) — une seule petite ligne.
  const fee = method ? paymentFee(config, method === "binance" ? "binance" : "manual", subtotal) : 0;

  const shownId = useMemo(() => {
    if (gameId !== "pubg-mobile" && identitySpec.length) {
      return identitySpec.map((f) => (identityValues[f.key] || "").trim()).filter(Boolean).join(" / ");
    }
    return pubgId;
  }, [gameId, identitySpec, identityValues, pubgId]);

  const receiveText = items.map((i) => `${i.qty} × ${i.name}`).join(", ");

  // PL-005-FE-02 (tâche 0) — même bug que l'écran de paiement : le fallback
  // `navigate("/boutique")` était un PUSH (oscillation quand /commande est la
  // première entrée d'historique). Le retour est désormais une navigation
  // EXPLICITE en replace vers la boutique — jamais un empilement.
  const back = () => navigate("/boutique", { replace: true });

  const setVerified = useCallback((v) => {
    setVerifiedState(v);
    if (v) setEditingId(false);
  }, []);

  // Identité mémorisée (compte connecté) : après vérification réussie, POST
  // /me/game-identities (dédupliqué côté serveur) → identity_id dans le
  // payload /orders. Invité : rien n'est mémorisé, la commande part sans.
  const saveIdentity = useCallback((fields, name) => {
    if (!user) return;
    const primaryKey = identitySpec.find((f) => f.primary)?.key || identitySpec[0]?.key;
    api.post("/me/game-identities", { game_id: gameId, label: name || fields[primaryKey], fields, ...(name ? { player_name: name } : {}) })
      .then(({ data }) => setIdentity(data))
      .catch(() => { /* l'identité n'est pas mémorisée : commande sans identity_id */ });
  }, [user, gameId, identitySpec]);

  // Après vérification réussie : les champs TRIMMÉS du formulaire partent dans
  // la commande ; la valeur primaire miroite `pubgId` (colonne historique du
  // payload /orders, PUBG inchangé — portage de l'ancien StepVerify). Les
  // valeurs passent par une REF : le verdict peut arriver avec une closure
  // antérieure au dernier rendu (portage exact du valuesRef de StepVerify).
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

  // Création de la commande (contrat inchangé + manual_operator pour le
  // manuel). JAMAIS de manual_reference ; JAMAIS de téléphone vide — le
  // manuel n'a PAS de champ téléphone (la preuve passe par l'USSD marchand).
  // `tokenArg` : jeton passé explicitement lors de l'auto-soumission CAPTCHA —
  // le state du hook n'est pas encore à jour au même rendu (jeton à usage
  // unique, jamais périmé dans le payload).
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
      ...(method && method !== "binance" ? { manual_operator: method } : {}), // "mvola" | "orange"
      captcha_token: tokenArg ?? captcha.tokenFor(),
    });
    // PL-CHK-3 : mémorisation MINIMALE { id, createdAt } pour la reprise.
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
      if (isCaptchaError(e) && captcha.enabled) { captcha.expire(); setCaptchaKey((k) => k + 1); } // jeton à usage unique
      setCaptchaOpen(false); // une erreur technique referme la feuille
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
      // Binance : création PUIS ouverture du slot USDT existant — jamais de
      // 2ᵉ initiation (l'écran 2 relit GET /crypto/{id}/status).
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
      // Cloudflare n'a pas encore délivré de jeton : la feuille « Vérification
      // de sécurité » s'ouvre (elle contient le widget, déjà monté) ; jeton
      // reçu → création automatique + fermeture.
      pendingSubmit.current = true;
      setCaptchaOpen(true);
      return;
    }
    submitOrder();
  };

  // Jeton reçu (invisible ou après interaction) : poursuite automatique — le
  // jeton est passé explicitement (state pas encore à jour au même rendu).
  const handleCaptchaVerify = (token) => {
    captcha.onVerify(token);
    if (token && pendingSubmit.current) submitOrder(token);
  };

  const canSubmit = !!verified && !!method && (method !== "binance" || !!network);

  if (items.length === 0) {
    return (
      <div className="co-screen" data-testid="checkout-form">
        <header className="co-topbar">
          <BackButton onClick={back} testId="checkout-back" />
        </header>
        <div className="flex flex-1 items-center justify-center py-24 text-center" data-testid="checkout-empty">
          <div>
            <p className="p-m">{t("cart.empty")}</p>
            <button type="button" onClick={back} className="button-main h-11" data-button-theme="dark" data-button-accent="violet" data-testid="checkout-browse" style={{ marginTop: "1em" }}>
              <span className="button-main-inner full-h"><span className="button-main-inner__back" data-text={t("cart.browse")}></span><span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{t("cart.browse")}</span></span></span></span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    // PL-DS-003-V1 — écran 1 porté sur les classes littérales du DS (.co-screen,
    // .co-topbar, .co-amount, .co-id, .pm-list/.pm-row, .co-remark, .co-footer-btn,
    // .button-main). Logique, testids et feuille captcha inchangés.
    <div className="co-screen" data-testid="checkout-form">
      {/* En-tête minimal (mode focalisé) : retour + nom du jeu. */}
      <header className="co-topbar">
        <BackButton onClick={back} testId="checkout-back" />
        <h1 className="co-header-title min-w-0 flex-1 truncate" data-testid="checkout-title">{game?.name || t("checkout.title")}</h1>
        {/* PL-005-FE-02 (tâche 13) — sortie rapide PC vers la page des
            commandes /suivi (le span vide, équilibre de l'en-tête, est
            remplacé). Mobile : la flèche suffit. */}
        <Link
          to="/suivi"
          data-testid="checkout-exit"
          className="link hidden min-h-[44px] flex-none items-center lg:inline-flex"
          style={{ fontSize: ".8em" }}
        >
          {t("order.viewTrack")}
        </Link>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Montant en grand. */}
        <div className="co-amount" data-testid="checkout-amount-block">
          <p className="label">{t("checkout.youPay")}</p>
          <p className="value" data-testid="checkout-amount">{formatAr(total, lang)} <small>Ar</small></p>
          <div className="co-lines" style={{ marginBottom: 0 }}>
            <div className="co-line"><span className="kv-muted">{t("checkout.youReceive")}</span><strong data-testid="checkout-receive">{receiveText}</strong></div>
          </div>
          {fee > 0 && <p className="co-remark" style={{ marginBottom: 0, marginTop: ".5em" }} data-testid="checkout-fee-line">{t("checkout.paymentFee")} : {formatAr(fee, lang)} Ar</p>}
        </div>

        {/* ID joueur : ID et pseudo sur DEUX lignes séparées, coche + pseudo,
            lien « Changer ». Tant que ce n'est pas vérifié : vérification
            générique (IdentityFieldsVerify, tous jeux). */}
        <div style={{ paddingTop: ".4em" }}>
          <p className="co-remark" style={{ marginBottom: ".5em" }}>{t("checkout.playerIdLabel")}</p>
          {verified && !editingId ? (
            <div data-testid="checkout-player-verified">
              <div className="co-id">
                <span className="co-id__txt"><strong className="num" data-testid="checkout-player-id">{shownId}</strong></span>
                <button type="button" onClick={() => setEditingId(true)} data-testid="checkout-change-id">{t("checkout.change")}</button>
              </div>
              <p className="co-proof-ok" data-testid="checkout-player-ok">
                <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden="true"><Check className="h-3 w-3" strokeWidth={3} /></span>
                <span className="min-w-0 truncate" data-testid="checkout-player-pseudo">{verified.name || "—"}</span>
              </p>
            </div>
          ) : (
            <IdentityFieldsVerify
              spec={identitySpec} gameId={gameId}
              values={identityValues} setValues={setIdentityValues}
              onVerified={handleVerified} autoTrigger={autoVerify}
              // PL-UX-3 : « Changer » rend le champ modifiable → les ID déjà
              // utilisés réapparaissent (les suggestions restent masquées tant
              // que l'ID est vérifié).
              editing={editingId}
              initial={verified} />
          )}
        </div>

        {/* Mode de paiement : lignes séparées (jamais de méthode désactivée). */}
        <div style={{ paddingTop: ".4em" }}>
          <p className="co-remark" style={{ marginBottom: ".5em" }}>{t("checkout.payment")}</p>
          <div className="pm-list" data-testid="payment-methods">
            {mvolaActive && <MethodLine testId="method-mvola" logo={PAYMENT_LOGOS.mvola} name="MVola" sub={t("checkout.methodManualSub")} selected={method === "mvola"} onSelect={() => setMethod("mvola")} />}
            {orangeActive && <MethodLine testId="method-orange" logo={PAYMENT_LOGOS.orange} name="Orange Money" sub={t("checkout.methodManualSub")} selected={method === "orange"} onSelect={() => setMethod("orange")} />}
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
          <p className="co-remark mt-auto flex gap-2" style={{ paddingTop: ".8em" }} data-testid="checkout-remark">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t(method === "mvola" ? "checkout.remarkMvola" : method === "orange" ? "checkout.remarkOrange" : "checkout.remarkBinance")}</span>
          </p>
        )}
      </div>

      {/* Bouton principal fixé en bas (mobile) ; ≥1024 px : flux normal. */}
      <div className="sticky bottom-0 z-10 flex-none bg-[color:hsl(var(--background))] px-1 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 lg:static lg:z-auto lg:bg-transparent lg:pb-2">
        <div className="co-footer-btn" style={{ marginTop: 0 }}>
          <button type="button" onClick={onPlaceOrder} disabled={!canSubmit || busy} data-testid="checkout-submit" className="button-main h-[52px] w-full disabled:opacity-50" data-button-theme="dark" data-button-accent="violet">
            <span className="button-main-inner full-h">
              <span className="button-main-inner__back" data-text={t("checkout.placeOrder")}></span>
              <span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checkout.creating")}</> : t("checkout.placeOrder")}</span></span></span>
            </span>
          </button>
        </div>
      </div>

      {/* Feuille « Vérification de sécurité » (écran 9) — coquille partagée
          PL-CHK-5 avec keepMounted : le widget tourne invisiblement DANS la
          feuille fermée (interaction-only), la feuille n'apparaît que si
          Cloudflare demande une action. */}
      {captcha.enabled && (
        <CheckoutSheet
          open={captchaOpen} keepMounted testId="captcha-sheet"
          busy={busy}
          onOpenChange={(v) => { pendingSubmit.current = false; setCaptchaOpen(v); }}
          title={t("checkout.captchaSheetTitle")}
          footer={
            <button type="button" onClick={() => submitOrder()} disabled={!captcha.ready || busy} data-testid="captcha-sheet-submit" className="button-main h-[52px] flex-1 disabled:opacity-50 lg:h-[46px]" data-button-theme="dark" data-button-accent="violet">
              <span className="button-main-inner full-h">
                <span className="button-main-inner__back" data-text={t("checkout.placeOrder")}></span>
                <span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checkout.creating")}</> : t("checkout.placeOrder")}</span></span></span>
              </span>
            </button>
          }
        >
          <p className="co-remark" style={{ paddingBottom: ".5em" }}>{t("checkout.captchaSheetSub")}</p>
          <CaptchaWidget key={captchaKey} ref={captcha.ref} onVerify={handleCaptchaVerify} onInteractive={(needed) => { if (needed) setCaptchaOpen(true); }} />
        </CheckoutSheet>
      )}
    </div>
  );
}

// Ligne de méthode (maquette : pm-row) ; la ligne sélectionnée prend le
// contour --color--dark (ink) et un fond très atténué. Pastille neutre aux
// jetons si le logo manque (aucune couleur de marque inventée).
function MethodLine({ testId, logo, name, sub, selected, onSelect }) {
  return (
    <button type="button" data-testid={testId} aria-pressed={selected} onClick={onSelect}
      className={`pm-row${selected ? " is--selected" : ""}`}>
      {logo
        ? <img src={logo} alt="" aria-hidden="true" className="pm-logo" style={{ objectFit: "contain" }} />
        : <span className="pm-logo" style={{ background: "hsl(0 0% 7% / .08)", color: "hsl(0 0% 7% / .6)" }} aria-hidden="true">{name.slice(0, 1)}</span>}
      <span className="pm-row__txt" style={{ flex: 1 }}>
        <strong style={{ fontSize: ".9em" }}>{name}</strong>
        <small>{sub}</small>
      </span>
      <span className="pm-row__radio" aria-hidden="true" />
    </button>
  );
}
