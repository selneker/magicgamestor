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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
      <h1 className="font-display text-[26px] font-bold leading-tight text-slate-900">{title}</h1>
      {subtitle && <p className="mt-1 text-slate-500">{subtitle}</p>}
      <div className="mt-5 rounded-[2rem] border border-slate-100 bg-white p-5">{children}</div>
    </div>
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
      {sent ? <p className="text-sm" data-testid="forgot-sent">{t("auth.forgotSent")}</p> : (
        <form onSubmit={submit} className="space-y-4">
          <div><label htmlFor="fp-email" className="text-sm font-medium">{t("auth.email")}</label><Input id="fp-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-11 rounded-xl" data-testid="forgot-email-input" /></div>
          {captcha.enabled && <CaptchaWidget key={captchaKey} ref={captcha.ref} onVerify={captcha.onVerify} onError={captcha.onError} />}
          <Button type="submit" disabled={busy || (captcha.enabled && !captcha.ready)} className="h-11 w-full rounded-full font-semibold" data-testid="forgot-submit">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("auth.forgotCta")}</Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm text-slate-500"><Link to="/connexion" className="font-semibold text-primary" data-testid="back-to-login">{t("auth.login")}</Link></p>
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
        <div><label htmlFor="rp-pass" className="text-sm font-medium">{t("auth.newPassword")}</label><Input id="rp-pass" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1 h-11 rounded-xl" data-testid="reset-password-input" /></div>
        <div><label htmlFor="rp-confirm" className="text-sm font-medium">{t("auth.confirmPassword")}</label><Input id="rp-confirm" type="password" required minLength={8} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} className="mt-1 h-11 rounded-xl" data-testid="reset-confirm-input" /></div>
        <Button type="submit" disabled={busy} className="h-11 w-full rounded-full font-semibold" data-testid="reset-submit">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("auth.resetCta")}</Button>
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
        {state === "busy" && <Loader2 className="mx-auto h-10 w-10 animate-spin text-slate-400" />}
        {state === "ok" && <><CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" /><p className="mt-4 text-sm" data-testid="verify-success">{t("auth.verifyOk")}</p></>}
        {state === "error" && <><XCircle className="mx-auto h-14 w-14 text-destructive" /><p className="mt-4 text-sm" data-testid="verify-error">{t("auth.verifyError")}</p></>}
        <Button asChild className="mt-6 h-11 w-full rounded-full font-semibold" data-testid="verify-continue"><Link to="/compte">{t("account.title")}</Link></Button>
      </div>
    </Shell>
  );
}
