import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, Loader2, Plus, Smartphone, X } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api, errorMessage, formatAr } from "@/lib/api";
import { isCaptchaError } from "@/components/common/CaptchaWidget";
import { useLang } from "@/context/LanguageContext";
import { PaymentCountdown } from "@/components/store/checkout/PaymentCountdown";
import { OrderSummary } from "@/components/store/checkout/StepConfirm";
import { USSD, pretty } from "@/components/store/PaymentFlow";
import { Button } from "@/components/ui/button";

// PL-CHK-2 — paiement manuel : la commande est DÉJÀ créée (à la fin de l'étape
// Méthode). Ici : instructions USSD conservées (textes inchangés), zone de
// preuve (1 à 3 captures, JPEG/PNG, 8 Mo max), puis écran d'attente « Preuve
// envoyée » avec Relancer (POST /orders/{id}/remind) et interrogation du
// statut (~10 s, onglet visible uniquement, ralentissement jusqu'à 30 s,
// arrêt au démontage et sur statut final).

const MAX_FILES = 3;
const MAX_BYTES = 8 * 1024 * 1024; // 8 Mo — l'autorité finale reste le serveur
const ACCEPTED_TYPES = ["image/jpeg", "image/png"];

// Codes serveur → clé i18n. Un nom technique de code n'est JAMAIS affiché.
const PROOF_CODE_KEYS = {
  proof_not_allowed: "checkout.proofNotPending", proof_not_pending: "checkout.proofNotPending",
  proof_already_validated: "checkout.proofAlreadyValidated", proof_limit: "checkout.proofLimit",
  proof_count: "checkout.proofCount", proof_format: "checkout.proofBadType", proof_too_large: "checkout.proofTooLarge",
  proof_conflict: "checkout.proofConflict",
};

const bodyCode = (err) => {
  const d = err?.response?.data?.detail;
  return typeof d === "object" ? d?.code : null;
};

// Message FR/EN d'une erreur d'upload/relance. null ⇒ gestion spéciale
// (proof_deadline_passed → l'appelant recharge la commande → écran d'expiration).
function proofErrorMessage(err, t) {
  const code = bodyCode(err);
  if (err?.response?.status === 400 && code === "proof_deadline_passed") return null;
  if (isCaptchaError(err)) return t("captcha.verifyAgain"); // mécanisme SEC-HARDEN existant
  const status = err?.response?.status;
  if (code && PROOF_CODE_KEYS[code]) return t(PROOF_CODE_KEYS[code]);
  if (status === 429) return t("checkout.proofRateLimited");
  if (status === 503 || status === 502) return t("checkout.proofUnavailable");
  if (status === 403) return t("checkout.proofDenied");
  if (status === 404) return t("checkout.proofNotFound");
  return errorMessage(err, t("common.error"));
}

// paid/delivered reçus (rechargement ou poll) → étape Confirmation  (onConfirmed).
// Le signal vit ICI, au niveau du routeur : le poll vit dans ProofWaiting qui
// est démonté dès que le statut quitte proof_submitted — un effet dedans ne
// serait jamais tiré pour paid/delivered.
function useDoneSignal({ order, onConfirmed }) {
  useEffect(() => {
    if (order && ["paid", "delivered"].includes(order.status)) onConfirmed?.();
  }, [order?.status]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function ProofPay(props) {
  useDoneSignal(props);
  const { order, config, summary, reference, onUpdated, onConfirmed } = props;
  if (!order) return null;
  if (order.status === "proof_submitted") return <ProofWaiting order={order} onUpdated={onUpdated} />;
  if (order.status === "late_payment") return <LateScreen />;
  if (order.status === "expired") return <ProofExpired />;
  if (["cancelled", "failed"].includes(order.status)) return <EndScreen order={order} />;
  return <ProofUpload order={order} config={config} summary={summary} reference={reference} onUpdated={onUpdated} />;
}

// Statuts qui clôturent l'écran d'attente : paid/delivered → étape
// Confirmation (parent) ; cancelled/failed/expired → message + retour.
const FINAL_STATUSES = ["paid", "delivered", "cancelled", "failed", "expired"];

/* ------------------------------------------------- écran 1 : envoi de preuve */

function ProofUpload({ order, config, summary, reference, onUpdated }) {
  const { t } = useLang();
  const [files, setFiles] = useState([]); // { file, name, url }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  // Compteur n / 3 : la limite INCLUT les preuves déjà envoyées.
  const alreadySent = (order.payment_proofs || []).length;
  const left = MAX_FILES - alreadySent - files.length;
  const provider = reference.provider || "mvola";
  const merchant = config?.providers?.[provider];
  const code = merchant ? USSD[provider](merchant.merchant, summary.subtotal + summary.fee) : "";
  const steps = t("checkout.ussdSteps");

  // Nettoyage final au démontage : passe par un ref au DERNIER rendu — les
  // URL encore vivantes sont libérées, y compris celles ajoutées après le
  // premier rendu (les retraits individuels et le succès d'envoi libèrent
  // déjà le reste).
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => { filesRef.current.forEach((f) => URL.revokeObjectURL(f.url)); }, []); // démontage

  const addFiles = (list) => {
    setError("");
    const next = [...files];
    for (const file of Array.from(list || [])) {
      const typeOk = ACCEPTED_TYPES.includes(file.type) || /\.(jpe?g|png)$/i.test(file.name || "");
      if (!typeOk) { setError(t("checkout.proofBadType")); continue; }
      if (file.size > MAX_BYTES) { setError(t("checkout.proofTooLarge")); continue; }
      if (next.length >= left) { setError(t("checkout.proofTooMany")); break; }
      next.push({ file, name: file.name, url: URL.createObjectURL(file) });
    }
    setFiles(next);
    if (inputRef.current) inputRef.current.value = ""; // re-sélection du même fichier possible
  };

  const remove = (i) => {
    URL.revokeObjectURL(files[i].url);
    setFiles(files.filter((_, u) => u !== i));
    setError("");
  };

  const refresh = () => api.get(`/orders/${order.id}`).then(({ data }) => onUpdated(data)).catch(() => {});

  const submit = async () => {
    if (!files.length || busy) return;
    setBusy(true); setError("");
    try {
      // FormData : JAMAIS de Content-Type à la main — le navigateur pose la
      // limite multipart (et sa longueur) ; champ `files` répété (1 à 3).
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f.file, f.name));
      await api.post(`/orders/${order.id}/proof`, fd);
      files.forEach((f) => URL.revokeObjectURL(f.url));
      const { data: fresh } = await api.get(`/orders/${order.id}`); // état réel
      onUpdated(fresh);
    } catch (e) {
      if (bodyCode(e) === "proof_deadline_passed") { await refresh(); return; }
      setError(proofErrorMessage(e, t) || t("checkout.proofDeadlinePassed"));
    } finally { setBusy(false); }
  };

  return (
    <section className="space-y-4" data-testid="checkout-step-pay-manual">
      <PaymentCountdown order={order} onZero={refresh} />
      <OrderSummary summary={summary} sticky />
      <div>
        <h2 className="font-display text-lg font-bold leading-tight">{t("checkout.manualPayTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("checkout.manualHowto")}</p>

        <p className="eyebrow mt-5">{t("checkout.ussdAmount")}</p>
        <p className="mt-1 font-display text-3xl font-bold num" data-testid="manual-amount">{formatAr(summary.subtotal + summary.fee)}</p>

        {merchant && (
          <div className="mt-5 rounded-[16px] border border-[color:var(--rule)] bg-muted/40 p-4">
            <p className="eyebrow">{t("checkout.ussdTitle")}</p>
            <p className="mt-3 text-sm font-semibold">{t("checkout.ussdCode")}</p>
            <p className="mt-1 select-all break-all font-mono text-sm font-bold leading-relaxed" data-testid="ussd-code">{code}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => copyText(code, t)} data-testid="copy-ussd-code"
                aria-label={`${t("checkout.copy")} ${t("checkout.ussdCode")}`}
                className="h-11 rounded-full px-4 text-sm font-bold">
                <Copy className="h-4 w-4" aria-hidden="true" />{t("checkout.copy")}
              </Button>
              {/* Le # final d'un code USSD est un fragment d'URL si laissé brut :
                  encodage intégral du code pour que l'OS compose la séquence.
                  Texte ENCRE sur la couleur de marque (PL-CHK-1, untouched). */}
              <a href={`tel:*${encodeURIComponent(code.slice(1))}`} data-testid="ussd-button" className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full font-semibold text-ink transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink" style={{ background: provider === "mvola" ? "var(--mvola)" : "var(--orange)" }}>
                <Smartphone className="h-4 w-4 shrink-0" aria-hidden="true" />{t("checkout.ussd")}
              </a>
            </div>
            <p className="mt-4 text-sm font-semibold">{t("checkout.ussdNumber")}</p>
            <p className="mt-1 num text-base font-bold" data-testid="merchant-number">{pretty(merchant.merchant)}</p>
          </div>
        )}

        {Array.isArray(steps) && (
          <ol className="mt-5 space-y-2 text-sm text-muted-foreground" data-testid="ussd-steps">
            {steps.map((step, i) => (
              <li key={step} className="flex gap-2">
                <span className="num shrink-0 font-bold text-foreground">{i + 1}.</span>
                <span className="min-w-0">{step}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-sm text-muted-foreground">{t("checkout.ussdNote")}</p>
      </div>

      <ProofZone files={files} count={alreadySent + files.length} left={left} busy={busy} error={error} inputRef={inputRef} onAdd={addFiles} onRemove={remove} onSubmit={submit} />
    </section>
  );
}

async function copyText(value, t) {
  // navigator.clipboard exige un contexte sûr : repli sur une copie de
  // sélection ; échec annoncé seulement si les deux échouent (PL-CHK-1).
  let ok = false;
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); ok = true; } } catch (_) { /* repli */ }
  if (!ok) {
    try {
      const area = document.createElement("textarea");
      area.value = value; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
      document.body.appendChild(area); area.select();
      ok = document.execCommand("copy");
      document.body.removeChild(area);
    } catch (_) { ok = false; }
  }
  ok ? toast.success(t("checkout.ussdCopied")) : toast.error(t("common.error"));
}

function ProofZone({ files, count, left, busy, error, inputRef, onAdd, onRemove, onSubmit }) {
  const { t } = useLang();
  return (
    <div className="space-y-3" data-testid="proof-drop-zone">
      <div className="flex items-center justify-between gap-3">
        <p className="font-display text-lg font-bold leading-tight">{t("checkout.proofTitle")}</p>
        <p className="num shrink-0 text-sm font-bold text-muted-foreground" data-testid="proof-count" aria-live="polite">{t("checkout.proofCounter", { n: count })}</p>
      </div>
      <p className="text-sm text-muted-foreground">{t("checkout.proofHint")}</p>

      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2" data-testid="proof-thumbs">
          {files.map((f, i) => (
            <li key={f.url} className="relative" data-testid={`proof-thumb-${i}`}>
              <img src={f.url} alt={f.name || t("checkout.proofAdd")} className="h-20 w-20 rounded-[10px] border border-[color:var(--rule)] object-cover" />
              <button type="button" onClick={() => onRemove(i)} data-testid={`proof-remove-${i}`}
                aria-label={t("checkout.proofRemove", { n: i + 1 })}
                className="absolute -right-1.5 -top-1.5 flex h-7 w-7 items-center justify-center rounded-full border bg-card text-foreground transition-opacity hover:opacity-80">
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Le champ lui-même est visuellement réduit, son bouton porte la cible
          tactile ≥44 px + le libellé visible (a11y : label via aria-label). */}
      <input
        ref={inputRef}
        id="proof-input"
        type="file"
        accept="image/jpeg,image/png"
        multiple
        onChange={(e) => onAdd(e.target.files)}
        data-testid="proof-input"
        className="sr-only"
        aria-label={t("checkout.proofAddPhoto")}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={busy || left <= 0}
        data-testid="proof-add-button"
        className="h-11 w-full rounded-full border-[color:var(--rule-strong)] text-sm font-bold">
        <Plus className="mr-2 h-4 w-4" aria-hidden="true" />{t("checkout.proofAdd")}
      </Button>
      {/* Zone d'erreur LA PLUS PROCHE de l'action + annonce aux dicts. */}
      <p role="alert" className={error ? "rounded-[10px] bg-muted px-3 py-2 text-sm font-semibold text-foreground" : "sr-only"} data-testid="proof-error" aria-live="assertive">{error || "\u00a0"}</p>

      {/* Gros bouton épinglé en bas (style PL-CHK-1) : sticky sur mobile. */}
      <div className="sticky bottom-2 z-10 -mt-1 flex flex-col justify-end bg-[color:hsl(var(--background))] pb-3 pt-3 lg:static lg:z-auto">
        <Button type="button" onClick={onSubmit} disabled={busy || files.length === 0} data-testid="proof-submit" className="h-14 w-full rounded-full text-base font-bold shadow-lg lg:shadow-none">
          {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checkout.proofSubmitting")}</> : t("checkout.proofSubmit")}
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------- écran 2 : attente + Relancer */

function ProofWaiting({ order, onUpdated }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // Relance : cooldown issu de remaining_seconds (réponse 200) ou du 429
  // remind_cooldown ; remind_limit désactive le bouton (3 max, autorité serveur).
  const [cd, setCd] = useState(0); // secondes restantes de cooldown
  const [remindLimit, setRemindLimit] = useState(false);
  const [left, setLeft] = useState(null); // relances restantes

  useEffect(() => {
    if (!cd) return undefined;
    const id = setInterval(() => setCd((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cd]);

  const remind = async () => {
    if (busy || remindLimit || cd > 0) return;
    setBusy(true); setMessage("");
    try {
      const { data } = await api.post(`/orders/${order.id}/remind`, {});
      setCd(data.remaining_seconds || 0);
      setLeft(typeof data.reminders_left === "number" ? data.reminders_left : left);
    } catch (e) {
      const status = e?.response?.status;
      const code = bodyCode(e);
      if (code === "remind_limit" || status === 429 && code === "remind_limit") { setRemindLimit(true); setLeft(0); }
      else if (code === "remind_cooldown") { setCd(e?.response?.data?.detail?.remaining_seconds || 0); setLeft(e?.response?.data?.detail?.reminders_left ?? left); }
      else if (code === "remind_already_processed" || code === "remind_not_pending") {
        // La commande a bougé pendant la relance : état réel → parent.
        await api.get(`/orders/${order.id}`).then(({ data: fresh }) => onUpdated(fresh)).catch(() => {});
      } else setMessage(proofErrorMessage(e, t));
    } finally { setBusy(false); }
  };

  // Interrogation du statut : onglet visible uniquement, 10 s → 30 s, arrêt
  // au démontage et sur statut final. paid/delivered → étape Confirmation.
  useEffect(() => {
    let stop = false;
    let timer;
    let tick = 0;
    const sleep = (ms) => new Promise((r) => { timer = setTimeout(r, ms); });
    const run = async () => {
      // Ralentissement progressif : 3× de 10 s, 2× de 20 s, puis 30 s.
      while (!stop) {
        if (document.visibilityState === "visible") {
          try {
            const { data } = await api.get(`/orders/${order.id}`);
            if (stop) return;
            onUpdated(data);
            if (FINAL_STATUSES.includes(data.status)) return; // statut final : arrêt
          } catch (_) { /* réseau : on retente à la prochaine salve */ }
        }
        tick += 1;
        await sleep(tick <= 3 ? 10000 : tick <= 5 ? 20000 : 30000);
      }
    };
    run();
    return () => { stop = true; clearTimeout(timer); };
  }, [order.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // paid/delivered → étape 4 : géré par useDoneSignal au niveau du routeur
  // (ProofWaiting est démonté quand le statut quitte proof_submitted).

  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const proofsCount = (order.payment_proofs || []).length;

  return (
    <section className="mx-auto space-y-4 text-center" data-testid="proof-waiting">
      <CheckCircle2 className="mx-auto h-16 w-16 text-foreground" />
      <h2 role="status" aria-live="polite" className="mt-2 font-display text-2xl font-bold">{t("checkout.proofWaitTitle")}</h2>
      <p className="mx-auto max-w-sm text-sm text-muted-foreground">{t("checkout.proofWaitBody")}</p>
      <p className="text-sm font-semibold" data-testid="proof-sent-count">{t("checkout.proofsCount", { n: proofsCount })}</p>
      <p className="text-center text-xs text-muted-foreground">{t(`order.status.${order.status}`)}</p>

      <div className="space-y-2 rounded-[14px] bg-muted px-4 py-3 text-left">
        {left !== null && <p className="text-sm font-semibold" data-testid="remind-left">{t("checkout.remindLeft", { n: left })}</p>}
        {cd > 0 && <p className="text-sm text-muted-foreground" data-testid="remind-cd">{t("checkout.remindNext", { time: mmss(cd) })}</p>}
        {remindLimit && <p className="text-sm font-semibold" data-testid="remind-limit">{t("checkout.remindLimitReached")}</p>}
        {left === 0 && !remindLimit && <p className="text-sm font-semibold" data-testid="remind-empty">{t("checkout.remindLimitReached")}</p>}
        {message && <p role="alert" className="text-sm font-semibold text-foreground" data-testid="proof-error">{message}</p>}
        {/* Relance 3 min entre deux coups, 3 relances max : le serveur reste
            l'autorité ; bouton désactivé pendant l'appel ET pendant le cd. */}
        <Button type="button" onClick={remind} disabled={busy || remindLimit || left === 0 || cd > 0} data-testid="remind-button" className="h-11 w-full rounded-full font-bold">
          {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checkout.reminding")}</> : t("checkout.remind")}
        </Button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------ écrans de fin de course */

export function LateScreen() {
  const { t } = useLang();
  return (
    <section className="mx-auto space-y-3 text-center" data-testid="proof-late">
      <p className="font-display text-2xl font-bold">{t("checkout.latePaymentTitle")}</p>
      <p className="mx-auto max-w-sm text-sm text-muted-foreground">{t("checkout.latePaymentBody")}</p>
      <p className="inline-block rounded-full bg-muted px-4 py-1 text-sm font-semibold">{t("order.status.late_payment")}</p>
      <Button asChild variant="outline" className="mt-2 h-12 w-full rounded-full font-bold" data-testid="proof-home"><Link to="/">{t("checkout.proofHome")}</Link></Button>
    </section>
  );
}

export function EndScreen({ order }) {
  const { t } = useLang();
  return (
    <section className="mx-auto space-y-3 text-center" data-testid="proof-cancelled">
      <p className="font-display text-2xl font-bold">{t(`order.status.${order.status}`)}</p>
      <p className="mx-auto max-w-sm text-sm text-muted-foreground">{t(`order.next.${order.status}`)}</p>
      <Button asChild variant="outline" className="mt-2 h-12 w-full rounded-full font-bold" data-testid="proof-home"><Link to="/">{t("checkout.proofHome")}</Link></Button>
    </section>
  );
}

/* ---------------------------------------------------------------- expiration */

export function ProofExpired() {
  const { t } = useLang();
  return (
    <section className="mx-auto space-y-3 text-center" data-testid="proof-expired">
      <p className="font-display text-2xl font-bold">{t("checkout.orderExpiredTitle")}</p>
      <p className="mx-auto max-w-sm text-sm text-muted-foreground">{t("checkout.orderExpiredBody")}</p>
      <Button asChild className="h-12 w-full rounded-full font-bold" data-testid="proof-restart"><Link to="/boutique">{t("checkout.restart")}</Link></Button>
    </section>
  );
}
