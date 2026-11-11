import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Loader2, Plus, X } from "lucide-react";
import { Link } from "react-router-dom";
import { api, errorMessage, formatAr } from "@/lib/api";
import { isCaptchaError } from "@/components/common/CaptchaWidget";
import { useLang } from "@/context/LanguageContext";
import { paymentLabel } from "@/lib/paymentLabels";
import { CheckoutSheet } from "@/components/store/checkout/CheckoutSheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";

// PL-CHK-4 — preuve de paiement, style Binance :
//   · écran 3 — feuille du bas « Confirmation du paiement » (ProofSheet) :
//     vignettes + « n/3 », ligne récap unique, case « J'ai déjà payé le montant
//     exact », bouton Confirmer grisé tant qu'il manque une image valide OU la
//     case. La LOGIQUE de l'ancien ProofUpload est conservée telle quelle
//     (validation locale, FormData SANS Content-Type manuel, revokeObjectURL,
//     erreurs proof_*, 429, 503).
//   · écran 4 — attente (ProofWaiting) : illustration SVG en ligne, carte
//     « Détails de la commande » repliable (ouverte par défaut), Relancer avec
//     cooldown (PL-CHK-2, plafond 3, autorité serveur). Relancer vit fixé en bas.
//   · écran 8 — expiration (ProofExpired) : icône horloge, texte avec n° de
//     commande, « Recommencer ».
// Les écrans late_payment / cancelled / failed restent des écrans courts centrés.

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

// Statuts qui clôturent l'écran d'attente : paid/delivered → confirmation ;
// cancelled/failed/expired → écrans de fin. Le parent change de branche dès que
// le statut vu par l'API bouge (poll ci-dessous).
const FINAL_STATUSES = ["paid", "delivered", "cancelled", "failed", "expired"];

/* ------------------------------------------------- écran 3 : feuille de preuve */

export function ProofSheet({ open, onOpenChange, order, summary, onSubmitted, onUpdated }) {
  const { t } = useLang();
  const [files, setFiles] = useState([]); // { file, name, url }
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  // Compteur n / 3 : la limite INCLUT les preuves déjà envoyées.
  const alreadySent = (order.payment_proofs || []).length;
  const left = MAX_FILES - alreadySent - files.length;
  const recap = (summary?.lines || []).map((l) => l.label).join(", ");
  const amount = (summary?.subtotal ?? order.subtotal ?? order.total) + (summary?.fee ?? order.payment_fee ?? 0);

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
    if (!files.length || !checked || busy) return;
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
      onSubmitted?.(); // statut proof_submitted → écran 4 ; la feuille se ferme
    } catch (e) {
      if (bodyCode(e) === "proof_deadline_passed") { await refresh(); onSubmitted?.(); return; }
      setError(proofErrorMessage(e, t) || t("checkout.proofDeadlinePassed"));
    } finally { setBusy(false); }
  };

  return (
    // PL-CHK-5 — coquille partagée (CheckoutSheet) : contenu défilable + pied
    // FIXE où vit « Confirmer » (jamais coupé, même à 620 px de bureau) ;
    // Radix : focus piégé, Échap, aria-modal ; fermeture REFUSÉE pendant
    // l'envoi (busy).
    <CheckoutSheet
      open={open} onOpenChange={onOpenChange} busy={busy}
      title={t("checkout.proofSheetTitle")} testId="proof-sheet"
      footer={
        <Button type="button" onClick={submit} disabled={busy || files.length === 0 || !checked}
          data-testid="proof-submit" className="h-[52px] flex-1 rounded-full text-[15px] font-extrabold lg:h-[46px]">
          {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checkout.proofConfirming")}</> : t("checkout.proofConfirm")}
        </Button>
      }
    >
      <p className="text-sm font-bold">{t("checkout.proofTitle")}</p>
      <p className="mb-3 mt-0.5 text-xs leading-[1.45] text-muted-foreground">{t("checkout.proofSheetHelp")}</p>

      {/* Vignettes (vrais fichiers) + case « + n/3 » (plafond 3 au total,
          preuves déjà envoyées comprises). */}
      <div className="flex gap-2.5" data-testid="proof-thumbs">
        {files.map((f, i) => (
          <div key={f.url} className="relative h-[116px] w-[92px] shrink-0 overflow-hidden rounded-[14px] border border-[color:var(--rule)]" data-testid={`proof-thumb-${i}`}>
            <img src={f.url} alt={f.name || t("checkout.proofAdd")} className="h-full w-full object-cover" />
            <button type="button" onClick={() => remove(i)} data-testid={`proof-remove-${i}`}
              aria-label={t("checkout.proofRemove", { n: i + 1 })}
              className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-foreground/85 text-background">
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        ))}
        {left > 0 && (
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
            data-testid="proof-add-button"
            className="flex h-[116px] w-[92px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-[14px] border border-dashed border-[color:var(--rule-strong)] bg-muted/40 text-muted-foreground">
            <Plus className="h-6 w-6" aria-hidden="true" />
            <span className="text-xs font-semibold" aria-hidden="true">{t("checkout.proofCounter", { n: alreadySent + files.length + 1 })}</span>
          </button>
        )}
      </div>
      {/* Le champ lui-même est visuellement réduit ; libellé via aria-label. */}
      <input
        ref={inputRef} id="proof-input" type="file" accept="image/jpeg,image/png" multiple
        onChange={(e) => addFiles(e.target.files)} data-testid="proof-input"
        className="sr-only" aria-label={t("checkout.proofAddPhoto")} />
      <p className="sr-only" aria-live="polite" data-testid="proof-count">{t("checkout.proofCounter", { n: alreadySent + files.length })}</p>

      {/* Ligne récap UNIQUE (« 1 × 60 UC · ID … » + montant). */}
      <p className="flex items-center justify-between gap-3 border-t border-[color:var(--rule)] pt-2.5 text-xs text-muted-foreground" data-testid="proof-recap">
        <span className="min-w-0 truncate">{recap}{summary?.pubgId ? <> · ID <b className="text-foreground">{summary.pubgId}</b></> : null}</span>
        <b className="shrink-0 text-foreground">{formatAr(amount)}</b>
      </p>

      {/* Case obligatoire : « J'ai déjà effectué le paiement. » (texte maquette). */}
      <label className="mb-2 mt-3 flex cursor-pointer items-start gap-3 pb-2 text-[13px] leading-[1.45]" data-testid="proof-exact-row">
        <Checkbox checked={checked} onCheckedChange={(v) => setChecked(!!v)} data-testid="proof-exact-checkbox" className="mt-0.5" />
        <span className="min-w-0 flex-1">{t("checkout.proofExactPaid")}</span>
      </label>

      <p role="alert" className={`text-sm font-semibold ${error ? "" : "sr-only"}`} data-testid="proof-error" aria-live="assertive">{error || "\u00a0"}</p>
    </CheckoutSheet>
  );
}

/* --------------------------------------------- écran 4 : attente + Relancer */

export function ProofWaiting({ order, onUpdated }) {
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
  // au démontage et sur statut final. paid/delivered → le parent change de
  // branche (carte de confirmation) via onUpdated.
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

  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const proofsCount = (order.payment_proofs || []).length;
  const paidWith = order.payment_method === "manual"
    ? (order.manual_operator === "orange" ? t("checkout.methodOrange") : t("checkout.methodMvola"))
    : paymentLabel(order.payment_method, t);

  return (
    <section className="flex flex-1 flex-col" data-testid="proof-waiting">
      <div className="flex min-h-0 flex-1 flex-col px-1">
        {/* Illustration SVG EN LIGNE (maquette écran 4) — aucun fichier externe. */}
        <div className="mt-2 grid place-items-center" aria-hidden="true">
          <svg width="108" height="108" viewBox="0 0 108 108" fill="none">
            <rect x="26" y="8" width="52" height="68" rx="8" stroke="currentColor" strokeWidth="3" className="text-foreground" />
            <circle cx="52" cy="30" r="10" stroke="currentColor" strokeWidth="3" className="text-foreground" />
            <path d="M38 52h28M38 60h20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-foreground" />
            <circle cx="72" cy="74" r="17" fill="var(--brand-lime)" />
            <path d="M72 64v10l7 4" stroke="#000" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
        <div className="mt-2 text-center">
          <h2 className="font-display text-[22px] font-extrabold leading-tight" data-testid="proof-wait-title">{t("checkout.waitTitle")}</h2>
          <p className="mt-1.5 text-[13.5px] leading-snug text-muted-foreground">{t("checkout.waitSub")}</p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground" data-testid="proof-sent-count">{t("checkout.proofsCount", { n: proofsCount })}</p>
        </div>

        {/* Carte « Détails de la commande » — repliable, OUVERTE par défaut ;
            le récapitulatif ne vit PLUS qu'ici (jamais sur l'écran de paiement). */}
        <Collapsible defaultOpen className="mt-4" data-testid="order-details">
          <div className="rounded-[18px] border border-[color:var(--rule)] bg-card px-4">
            <CollapsibleTrigger asChild>
              <button type="button" className="flex h-[46px] w-full items-center justify-between text-[15px] font-bold" data-testid="order-details-toggle" aria-label={t("checkout.detailsTitle")}>
                {t("checkout.detailsTitle")}
                <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <dl className="space-y-2 pb-3 pt-1 text-[13.5px]" data-testid="order-details-rows">
                <DetailRow label={t("checkout.detailsProduct")} value={(order.items || []).map((i) => `${i.quantity} × ${i.name}`).join(", ")} testId="details-product" />
                <DetailRow label={t("checkout.detailsPlayerId")} value={order.pubg_id} testId="details-player-id" />
                <DetailRow label={t("checkout.detailsPseudo")} value={order.pseudo} testId="details-pseudo" />
                <DetailRow label={t("checkout.detailsPaidWith")} value={paidWith} testId="details-paid-with" />
                <DetailRow label={t("checkout.detailsAmount")} value={formatAr(order.total)} testId="details-amount" />
                <DetailRow label={t("checkout.detailsOrder")} value={`#${order.order_number}`} testId="details-number" />
              </dl>
            </CollapsibleContent>
          </div>
        </Collapsible>

        <div className="mt-3 space-y-1.5" role="status" aria-live="polite">
          {left !== null && <p className="text-sm font-semibold" data-testid="remind-left">{t("checkout.remindLeft", { n: left })}</p>}
          {cd > 0 && !remindLimit && <p className="text-sm text-muted-foreground" data-testid="remind-cd">{t("checkout.remindNext", { time: mmss(cd) })}</p>}
          {(remindLimit || left === 0) && <p className="text-sm font-semibold" data-testid="remind-limit">{t("checkout.remindLimitReached")}</p>}
          {message && <p role="alert" className="text-sm font-semibold" data-testid="proof-wait-error">{message}</p>}
        </div>
      </div>

      {/* Relancer fixé en bas — cooldown mm:ss visible sur le bouton. */}
      <div className="sticky bottom-0 z-10 flex-none bg-[color:hsl(var(--background))] px-1 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 lg:static lg:z-auto lg:bg-transparent lg:pb-2">
        <Button type="button" onClick={remind} disabled={busy || remindLimit || left === 0 || cd > 0} data-testid="remind-button" className="h-[52px] w-full rounded-full text-[15px] font-extrabold">
          {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checkout.reminding")}</>
            : cd > 0 ? t("checkout.remindCooldown", { time: mmss(cd) })
            : t("checkout.remind")}
        </Button>
      </div>
    </section>
  );
}

function DetailRow({ label, value, testId }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-right font-bold" data-testid={testId}>{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------ écrans de fin de course */

export function LateScreen() {
  const { t } = useLang();
  return (
    <section className="mx-auto flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center" data-testid="proof-late">
      <CheckCircle2 className="h-14 w-14 text-foreground" aria-hidden="true" />
      <p className="font-display text-[22px] font-extrabold">{t("checkout.latePaymentTitle")}</p>
      <p className="mx-auto max-w-[290px] text-[13.5px] leading-snug text-muted-foreground">{t("checkout.latePaymentBody")}</p>
      <p className="inline-block rounded-full bg-muted px-4 py-1 text-sm font-semibold">{t("order.status.late_payment")}</p>
      <Button asChild variant="outline" className="mt-2 h-12 w-full max-w-xs rounded-full font-bold" data-testid="proof-home"><Link to="/">{t("checkout.proofHome")}</Link></Button>
    </section>
  );
}

export function EndScreen({ order }) {
  const { t } = useLang();
  return (
    <section className="mx-auto flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center" data-testid="proof-cancelled">
      <p className="font-display text-[22px] font-extrabold">{t(`order.status.${order.status}`)}</p>
      <p className="mx-auto max-w-[290px] text-[13.5px] leading-snug text-muted-foreground">{t(`order.next.${order.status}`)}</p>
      <Button asChild variant="outline" className="mt-2 h-12 w-full max-w-xs rounded-full font-bold" data-testid="proof-home"><Link to="/">{t("checkout.proofHome")}</Link></Button>
    </section>
  );
}

/* ---------------------------------------------------------------- écran 8 : expiration */

export function ProofExpired({ order }) {
  const { t } = useLang();
  return (
    <section className="mx-auto flex flex-1 flex-col items-center justify-center gap-2.5 py-10 text-center" data-testid="proof-expired">
      {/* Icône horloge SVG EN LIGNE (maquette écran 8). */}
      <svg width="84" height="84" viewBox="0 0 84 84" fill="none" aria-hidden="true">
        <circle cx="42" cy="42" r="36" stroke="currentColor" strokeWidth="3" className="text-muted-foreground" />
        <path d="M42 24v19l12 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-foreground" />
      </svg>
      <h2 className="font-display text-[22px] font-extrabold" data-testid="proof-expired-title">{t("checkout.orderExpiredTitle")}</h2>
      <p className="mx-auto max-w-[290px] text-[13.5px] leading-normal text-muted-foreground">
        {t("checkout.orderExpiredBody", { number: order?.order_number })}
      </p>
      <Button asChild className="mt-3 h-12 w-full max-w-xs rounded-full font-extrabold" data-testid="proof-restart"><Link to="/boutique">{t("checkout.restart")}</Link></Button>
    </section>
  );
}
