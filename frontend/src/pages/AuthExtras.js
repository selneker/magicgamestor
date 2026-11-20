import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { authErrorKey } from "@/lib/authErrors";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { BackButton } from "@/components/common/BackButton";
import { CaptchaWidget, isCaptchaError, useCaptcha } from "@/components/common/CaptchaWidget";

// PL-DS-003-V1 — présentation portée sur les classes littérales du design system
// (.h-c, .p-m, .eyebrow, .review-card, .form-field, .button-main, .link). Logique,
// captcha, testids et comportement inchangés (AuthExtras.test.js reste vert).
function Shell({ title, subtitle, testId, back, children }) {
  const navigate = useNavigate();
  // PL-CHK-4 — mode focalisé (mot de passe oublié) : en-tête minimal, flèche
  // retour avec repli accueil (fonctionne sans historique, onglet profond).
  // PL-CHK-5 — compacté (360 × 640) : en-tête 44 px, marges resserrées,
  // champs 44 px.
  return (
    <div className="mx-auto max-w-md pb-6 pt-1" data-testid={testId}>
      {back && (
        <header className="flex h-11 items-center px-1">
          <BackButton onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate("/"))} testId={`${testId}-back`} />
        </header>
      )}
      <p className="eyebrow">Magic Game Store</p>
      <h1 className="h-c">{title}</h1>
      {subtitle && <p className="p-m" style={{ marginTop: ".3em" }}>{subtitle}</p>}
      <div className="review-card" style={{ marginTop: "1.2em", padding: "1.4em", gap: 0 }}>{children}</div>
    </div>
  );
}

// Face animée d'un bouton de soumission DS (vrai <button> : .disabled conservé).
function SubmitButton({ testId, label, busy, disabled }) {
  return (
    <button type="submit" disabled={disabled} className="button-main h-11 w-full disabled:opacity-50" data-button-theme="dark" data-button-accent="violet" data-testid={testId}>
      <span className="button-main-inner full-h">
        <span className="button-main-inner__back" data-text={label}></span>
        <span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : label}</span></span></span>
      </span>
    </button>
  );
}

export function ForgotPassword() {
  const { t } = useLang();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const captcha = useCaptcha();
  const [captchaKey, setCaptchaKey] = useState(0);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api.post("/auth/forgot-password", { email, captcha_token: captcha.tokenFor() }); setSent(true); }
    catch (err) {
      // PL-UX-4 — message français (jamais le détail anglais du serveur).
      toast.error(isCaptchaError(err) ? t("captcha.required") : t(authErrorKey(err)));
      if (captcha.enabled) { captcha.expire(); setCaptchaKey((k) => k + 1); } // jeton à usage unique
    } finally { setBusy(false); }
  };
  return (
    <Shell title={t("auth.forgotTitle")} subtitle={t("auth.forgotSub")} testId="forgot-password-page" back>
      {sent ? <p className="p-m" data-testid="forgot-sent">{t("auth.forgotSent")}</p> : (
        <form onSubmit={submit} className="space-y-4">
          <div><label htmlFor="fp-email" className="text-sm font-medium">{t("auth.email")}</label><input id="fp-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="form-field mt-1 w-full" data-testid="forgot-email-input" /></div>
          {captcha.enabled && <CaptchaWidget key={captchaKey} ref={captcha.ref} onVerify={captcha.onVerify} onError={captcha.onError} />}
          <SubmitButton testId="forgot-submit" label={t("auth.forgotCta")} busy={busy} disabled={busy || (captcha.enabled && !captcha.ready)} />
        </form>
      )}
      <p className="p-m" style={{ marginTop: "1em", textAlign: "center" }}><Link to="/connexion" className="link" style={{ fontWeight: 700 }} data-testid="back-to-login">{t("auth.login")}</Link></p>
    </Shell>
  );
}

export function ResetPassword() {
  const { t } = useLang();
  const { token } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) return toast.error(t("auth.passwordMismatch"));
    setBusy(true);
    try { await api.post("/auth/reset-password", { token, password: form.password }); toast.success(t("auth.resetDone")); navigate("/connexion", { replace: true }); }
    // PL-UX-4 — lien invalide/expiré (400) ou erreur serveur : message français.
    catch (err) { toast.error(t(authErrorKey(err, "auth.errorInvalidLink"))); } finally { setBusy(false); }
  };
  return (
    <Shell title={t("auth.resetTitle")} subtitle={t("auth.resetSub")} testId="reset-password-page">
      <form onSubmit={submit} className="space-y-4">
        <div><label htmlFor="rp-pass" className="text-sm font-medium">{t("auth.newPassword")}</label><input id="rp-pass" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="form-field mt-1 w-full" data-testid="reset-password-input" /></div>
        <div><label htmlFor="rp-confirm" className="text-sm font-medium">{t("auth.confirmPassword")}</label><input id="rp-confirm" type="password" required minLength={8} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} className="form-field mt-1 w-full" data-testid="reset-confirm-input" /></div>
        <SubmitButton testId="reset-submit" label={t("auth.resetCta")} busy={busy} disabled={busy} />
      </form>
    </Shell>
  );
}

export function VerifyEmail() {
  const { t } = useLang();
  const { token } = useParams();
  const { refresh } = useAuth();
  const [state, setState] = useState("busy");
  useEffect(() => {
    api.post("/auth/verify-email", { token }).then(() => { setState("ok"); refresh(); }).catch(() => setState("error"));
  }, [token, refresh]);
  return (
    <Shell title={t("auth.verifyTitle")} testId="verify-email-page">
      <div className="text-center">
        {state === "busy" && <Loader2 className="mx-auto h-10 w-10 animate-spin" style={{ color: "hsl(0 0% 7% / .6)" }} />}
        {state === "ok" && <><CheckCircle2 className="mx-auto h-14 w-14 text-[color:var(--status-done)]" /><p className="p-m" style={{ marginTop: "1em" }} data-testid="verify-success">{t("auth.verifyOk")}</p></>}
        {state === "error" && <><XCircle className="mx-auto h-14 w-14 text-destructive" /><p className="p-m" style={{ marginTop: "1em" }} data-testid="verify-error">{t("auth.verifyError")}</p></>}
        <Link to="/compte" className="button-main h-11 w-full" data-button-theme="dark" data-button-accent="violet" data-testid="verify-continue" style={{ marginTop: "1.5em" }}>
          <span className="button-main-inner full-h">
            <span className="button-main-inner__back" data-text={t("account.title")}></span>
            <span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{t("account.title")}</span></span></span>
          </span>
        </Link>
      </div>
    </Shell>
  );
}