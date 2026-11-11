import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, formatAr } from "@/lib/api";
import { readPendingOrderId, writePendingOrderId, clearPendingOrderId } from "@/lib/pendingOrder"; // PL-CHK-3
import { useLang } from "@/context/LanguageContext";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { useGames } from "@/context/GameContext";
import { BackButton } from "@/components/common/BackButton";
import { CaptchaWidget, isCaptchaError, useCaptcha } from "@/components/common/CaptchaWidget";
import { CheckoutSheet } from "@/components/store/checkout/CheckoutSheet";
import { IdentityFieldsVerify } from "@/components/store/checkout/IdentityFieldsVerify";
import { PAYMENT_LOGOS, NetworkPicker, paymentFee } from "@/components/store/PaymentFlow";
import { Button } from "@/components/ui/button";

// PL-CHK-4 — écran 1 « Commande » (maquette Binance, 3 étapes réelles, aucun
// stepper). L'écran tient dans 360×640 sans défilement, bouton principal fixé
// en bas : en-tête minimal (retour + nom du jeu), montant en grand, ID joueur
// vérifié (ID + pseudo sur deux lignes), modes de paiement en LIGNES séparées
// (MVola manuel / Orange Money manuel / Binance USDT — uniquement les méthodes
// réellement actives), une remarque courte selon la méthode. AUCUN récapitulatif
// (il vit à la fin, écran 4), aucun bloc de frais détaillé (une seule petite
// ligne si des frais > 0 existent), aucun stepper, aucune carte explicative.
// La commande est créée ICI puis redirection vers /orders/:id (écran 2), qui
// est le SEUL écran de paiement (reprise PL-CHK-3 comprise).

// Statuts qui clôturent le tunnel : la clé de reprise est retirée.
const DONE_STATUSES = ["paid", "delivered", "cancelled", "failed", "expired", "late_payment"];
const ACTIVE_STATUSES = ["pending_payment", "proof_submitted"];

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
  const { t } = useLang();
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
  // Reprise : un rechargement de /commande avec une commande en attente
  // redirige vers l'écran de paiement — jamais de nouvelle commande.
  const [recovering, setRecovering] = useState(() => !!readPendingOrderId());
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

  // Reprise PL-CHK-3 : une commande en attente connue (invité ou compte) ouvre
  // directement son écran de paiement — /commande ne recrée JAMAIS une commande
  // par-dessus une commande active.
  useEffect(() => {
    const pending = readPendingOrderId(); // { id, createdAt } | null
    if (!pending) { setRecovering(false); return; }
    api.get(`/orders/${pending.id}`).then(({ data }) => {
      if (ACTIVE_STATUSES.includes(data.status)) { navigate(`/orders/${data.id}`, { replace: true }); return; }
      if (DONE_STATUSES.includes(data.status)) clearPendingOrderId();
      setRecovering(false);
    }).catch(() => { clearPendingOrderId(); setRecovering(false); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const back = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate("/boutique"));

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

  if (items.length === 0 && !recovering) {
    return (
      <div className="mx-auto flex min-h-[100svh] max-w-[480px] flex-col" data-testid="checkout-form">
        <header className="flex h-[52px] flex-none items-center px-1">
          <BackButton onClick={back} testId="checkout-back" />
        </header>
        <div className="flex flex-1 items-center justify-center py-24 text-center" data-testid="checkout-empty">
          <div>
            <p className="text-muted-foreground">{t("cart.empty")}</p>
            <Button type="button" onClick={back} className="mt-4 rounded-full" data-testid="checkout-browse">{t("cart.browse")}</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    // Colonne 480 px (desktop) ; mobile : plein écran, CTA collé en bas.
    <div className="mx-auto flex min-h-[100svh] w-full max-w-[480px] flex-col lg:min-h-0" data-testid="checkout-form">
      {/* En-tête minimal (mode focalisé) : retour + nom du jeu. */}
      <header className="flex h-[52px] flex-none items-center gap-2 px-1">
        <BackButton onClick={back} testId="checkout-back" />
        <h1 className="min-w-0 flex-1 truncate text-[16px] font-extrabold leading-tight" data-testid="checkout-title">{game?.name || t("checkout.title")}</h1>
        <span className="h-8 w-8 shrink-0" aria-hidden="true" />
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-1 pb-2">
        {/* Montant en grand. */}
        <div className="border-b border-[color:var(--rule)] pb-3 pt-1" data-testid="checkout-amount-block">
          <p className="text-xs text-muted-foreground">{t("checkout.youPay")}</p>
          <p className="my-0.5 font-display text-[32px] font-extrabold leading-tight tracking-[-0.01em]" data-testid="checkout-amount">{formatAr(total)} <span className="text-[15px] font-bold text-muted-foreground">Ar</span></p>
          <div className="flex items-center justify-between text-[13px] text-muted-foreground">
            <span>{t("checkout.youReceive")}</span>
            <b className="text-foreground" data-testid="checkout-receive">{receiveText}</b>
          </div>
          {fee > 0 && <p className="mt-1 text-xs text-muted-foreground" data-testid="checkout-fee-line">{t("checkout.paymentFee")} : {formatAr(fee)} Ar</p>}
        </div>

        {/* ID joueur : ID et pseudo sur DEUX lignes séparées, coche + pseudo,
            lien « Changer ». Tant que ce n'est pas vérifié : vérification
            générique (IdentityFieldsVerify, tous jeux). */}
        <div className="pt-3">
          <p className="mb-1.5 text-xs text-muted-foreground">{t("checkout.playerIdLabel")}</p>
          {verified && !editingId ? (
            <div data-testid="checkout-player-verified">
              <div className="flex h-[46px] items-center justify-between rounded-[14px] border border-[color:var(--rule)] bg-card px-3.5">
                <span className="num truncate text-[15px] font-bold" data-testid="checkout-player-id">{shownId}</span>
                <button type="button" onClick={() => setEditingId(true)} className="shrink-0 text-xs font-bold text-primary" data-testid="checkout-change-id">{t("checkout.change")}</button>
              </div>
              <p className="mt-1.5 flex items-center gap-2 text-[13px] font-bold text-primary" data-testid="checkout-player-ok">
                <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-primary text-[#0A0A0A]" aria-hidden="true"><Check className="h-3 w-3" strokeWidth={3} /></span>
                <span className="min-w-0 truncate" data-testid="checkout-player-pseudo">{verified.name || "—"}</span>
              </p>
            </div>
          ) : (
            <IdentityFieldsVerify
              spec={identitySpec} gameId={gameId}
              values={identityValues} setValues={setIdentityValues}
              onVerified={handleVerified} autoTrigger={autoVerify}
              initial={verified} />
          )}
        </div>

        {/* Mode de paiement : lignes séparées (jamais de méthode désactivée). */}
        <div className="pt-3">
          <p className="mb-1.5 text-xs text-muted-foreground">{t("checkout.payment")}</p>
          <div className="flex flex-col gap-1.5" data-testid="payment-methods">
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
          <p className="mt-auto flex gap-2 pb-1 pt-3 text-[12.5px] leading-[1.45] text-muted-foreground" data-testid="checkout-remark">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t(method === "mvola" ? "checkout.remarkMvola" : method === "orange" ? "checkout.remarkOrange" : "checkout.remarkBinance")}</span>
          </p>
        )}
      </div>

      {/* Bouton principal fixé en bas (mobile) ; ≥1024 px : flux normal. */}
      <div className="sticky bottom-0 z-10 flex-none bg-[color:hsl(var(--background))] px-1 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 lg:static lg:z-auto lg:bg-transparent lg:pb-2">
        <Button type="button" onClick={onPlaceOrder} disabled={!canSubmit || busy} data-testid="checkout-submit" className="h-[52px] w-full rounded-full text-[15px] font-extrabold">
          {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checkout.creating")}</> : t("checkout.placeOrder")}
        </Button>
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
            <Button type="button" onClick={() => submitOrder()} disabled={!captcha.ready || busy} data-testid="captcha-sheet-submit" className="h-[52px] flex-1 rounded-full text-[15px] font-extrabold lg:h-[46px]">
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checkout.creating")}</> : t("checkout.placeOrder")}
            </Button>
          }
        >
          <p className="pb-2 text-[13px] leading-snug text-muted-foreground">{t("checkout.captchaSheetSub")}</p>
          <CaptchaWidget key={captchaKey} ref={captcha.ref} onVerify={handleCaptchaVerify} onInteractive={(needed) => { if (needed) setCaptchaOpen(true); }} />
        </CheckoutSheet>
      )}
    </div>
  );
}

// Ligne de méthode (maquette : logo, nom + sous-titre, pastille de choix) ;
// la ligne choisie porte le contour `--brand-lime`. Pastille neutre aux jetons
// si le logo manque (aucune couleur de marque inventée).
function MethodLine({ testId, logo, name, sub, selected, onSelect }) {
  return (
    <button type="button" data-testid={testId} aria-pressed={selected} onClick={onSelect}
      className={`flex min-h-[46px] w-full items-center gap-3 rounded-[14px] border bg-card px-3.5 py-2 text-left transition-colors motion-reduce:transition-none ${selected ? "border-[color:var(--brand-lime)]" : "border-[color:var(--rule)]"}`}>
      {logo
        ? <img src={logo} alt="" aria-hidden="true" className="h-[26px] w-[26px] shrink-0 rounded-[8px] object-contain" />
        : <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] bg-muted text-xs font-black text-muted-foreground" aria-hidden="true">{name.slice(0, 1)}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-bold leading-tight">{name}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">{sub}</span>
      </span>
      <span className={`h-[18px] w-[18px] shrink-0 rounded-full border-2 ${selected ? "border-[color:var(--brand-lime)] bg-[radial-gradient(var(--brand-lime)_45%,transparent_50%)]" : "border-[color:var(--rule-strong)]"}`} aria-hidden="true" />
    </button>
  );
}
