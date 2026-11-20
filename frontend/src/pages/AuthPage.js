import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { authErrorKey } from "@/lib/authErrors";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { startGoogleLogin } from "@/components/AuthCallback";
import { BackButton } from "@/components/common/BackButton";
import { CaptchaWidget, isCaptchaError, useCaptcha } from "@/components/common/CaptchaWidget";
import { Checkbox } from "@/components/ui/checkbox";

// PL-DS-V3 — connexion/inscription rebuild sur la structure EXACTE du prototype
// design-system-v3.html : .mgs-auth (plein écran focalisé, nav/footer masqués
// par Layout) > .mgs-auth-bg (doodles animés) > .mgs-auth-card > .mgs-head centré
// + .mgs-panel (onglets .mgs-tabs Connexion/Inscription, Google, champs
// .mgs-field/.mgs-input, « Se souvenir » + oublié, submit .button-main).
// Logique, captcha, checkbox Radix (data-state) et testids inchangés.
export default function AuthPage({ mode = "login" }) {
  const { t } = useLang();
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "", name: "", remember: true });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const captcha = useCaptcha();
  const [captchaKey, setCaptchaKey] = useState(0);
  const [loginFailed, setLoginFailed] = useState(false);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const showCaptcha = captcha.enabled && (mode === "register" || loginFailed);
  const from = location.state?.from || "/";

  if (user) return <Navigate to={from} replace />;

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    const captchaUsed = showCaptcha ? captcha.tokenFor() : undefined;
    try {
      const { data } = await api.post(`/auth/${mode}`, mode === "login"
        ? { email: form.email, password: form.password, remember: form.remember, captcha_token: captchaUsed }
        : { ...form, captcha_token: captchaUsed });
      setUser(data.user);
      if (mode === "register") toast.message(t("auth.verifySent"));
      setLoginFailed(false);
      setCaptchaRequired(false);
      navigate(from, { replace: true });
    } catch (err) {
      const captchaError = isCaptchaError(err);
      if (captchaError) setCaptchaRequired(true);
      setError(captchaError ? t("captcha.required") : t(authErrorKey(err)));
      if (mode === "login") setLoginFailed(true);
      if (showCaptcha) { captcha.expire(); setCaptchaKey((k) => k + 1); }
    } finally { setBusy(false); }
  };

  const doodle = (d, cls, style) => (
    <span className={cls} style={style} aria-hidden="true">
      <svg className="bold-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
    </span>
  );

  return (
    <div className="mgs-auth" data-testid={`${mode}-page`}>
      <div className="mgs-auth-bg" aria-hidden="true">
        {doodle("M17.32 5H6.68a4 4 0 0 0-3.978 3.59C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258A4 4 0 0 0 17.32 5z", "f1", { top: "8%", left: "6%", width: "5em" })}
        {doodle("M13 2 3 14h9l-1 8 10-12h-9l1-8z", "f2", { top: "16%", right: "10%", width: "4em" })}
        {doodle("M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z", "f3", { bottom: "20%", left: "9%", width: "4.5em" })}
        {doodle("M12 2v20M2 12h20", "spin", { bottom: "10%", right: "7%", width: "5em" })}
      </div>

      <div className="mgs-auth-card">
        <div className="flex h-11 items-center justify-between">
          <BackButton onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate("/"))} testId={`${mode}-back`} />
          <span className="h-11 w-11" aria-hidden="true" />
        </div>
        <div className="mgs-head" style={{ textAlign: "center", alignItems: "center", marginBottom: "1.5em" }}>
          <p className="eyebrow">{t("auth.welcome")}</p>
          <h1 className="mgs-title" style={{ fontSize: "2.8em" }}>{mode === "login" ? t("auth.login") : t("auth.register")}</h1>
          <p className="mgs-sub" style={{ fontSize: "1em" }}>{mode === "login" ? t("auth.loginSub") : t("auth.registerSub")}</p>
        </div>

        <div className="mgs-panel" style={{ background: "var(--color--light)" }}>
          {/* Onglets Connexion / Inscription du prototype. */}
          <div className="mgs-tabs" style={{ marginBottom: "1.25em" }}>
            <Link to="/connexion" state={location.state} className={`mgs-tab${mode === "login" ? " is--active" : ""}`} style={{ flex: 1, textAlign: "center" }} data-testid={mode === "login" ? "tab-login" : "switch-auth-mode"}>{t("auth.login")}</Link>
            <Link to="/inscription" state={location.state} className={`mgs-tab${mode === "register" ? " is--active" : ""}`} style={{ flex: 1, textAlign: "center" }} data-testid={mode === "register" ? "tab-register" : "switch-auth-mode"}>{t("auth.register")}</Link>
          </div>

          <button type="button" onClick={() => startGoogleLogin(from)} data-testid="google-login-button" className="button-main h-11 w-full" data-button-theme="light" data-button-accent="" style={{ marginBottom: "1em" }}>
            <span className="button-main-inner full-h">
              <span className="button-main-inner__back" data-text={t("auth.google")}></span>
              <span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text has--logo"><svg className="button-main-inner__logo" viewBox="0 0 24 24" style={{ width: "1.2em", height: "1.2em" }} aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg><span>{t("auth.google")}</span></span></span>
            </span>
          </button>

          <form onSubmit={submit}>
            {mode === "register" && <div className="mgs-field"><label htmlFor="name">{t("auth.name")}</label><input id="name" data-testid="name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} className="mgs-input" /></div>}
            <div className="mgs-field"><label htmlFor="email">{t("auth.email")}</label><input id="email" type="email" data-testid="email-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className="mgs-input" placeholder="vous@example.mg" /></div>
            <div className="mgs-field">
              <label htmlFor="password">{t("auth.password")}</label>
              <div className="relative">
                <input id="password" type={showPassword ? "text" : "password"} data-testid="password-input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={mode === "register" ? 8 : 6} className="mgs-input w-full pr-12" placeholder="••••••••" />
                <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? t("account.hidePassword") : t("account.showPassword")} title={showPassword ? t("account.hidePassword") : t("account.showPassword")} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center" style={{ color: "hsl(0 0% 0% / .6)" }} data-testid="password-input-eye">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {mode === "login" && (
              <div className="mgs-between" style={{ margin: ".25em 0 1em", fontSize: ".85em" }}>
                <label className="mgs-row" style={{ gap: ".4em", cursor: "pointer" }} data-testid="remember-label">
                  <Checkbox checked={form.remember} onCheckedChange={(v) => setForm({ ...form, remember: v === true })} data-testid="remember-checkbox" aria-label={t("auth.remember")} />
                  {t("auth.remember")}
                </label>
                <Link to="/mot-de-passe-oublie" className="mgs-muted" style={{ textDecoration: "underline" }} data-testid="login-forgot-password-link">{t("auth.forgot")}</Link>
              </div>
            )}
            {showCaptcha && <CaptchaWidget key={captchaKey} ref={captcha.ref} onVerify={captcha.onVerify} onError={captcha.onError} visible={captchaRequired} />}
            {error && <p role="alert" className="rounded-xl bg-destructive p-3 text-sm font-semibold text-destructive-foreground" style={{ marginBottom: "1em" }} data-testid="auth-error">{error}</p>}
            <button type="submit" disabled={busy || (captcha.enabled && showCaptcha && !captcha.ready)} className="button-main h-11 w-full disabled:opacity-50" data-button-theme="dark" data-button-accent="yellow" data-testid="auth-submit">
              <span className="button-main-inner full-h">
                <span className="button-main-inner__back" data-text={t("auth.submit")}></span>
                <span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("auth.submit")}</span></span></span>
              </span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}