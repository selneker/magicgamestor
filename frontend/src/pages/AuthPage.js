import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { startGoogleLogin } from "@/components/AuthCallback";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function AuthPage({ mode = "login" }) {
  const { t } = useLang();
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const from = location.state?.from || "/compte";

  if (user) return <Navigate to={from} replace />;

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const { data } = await api.post(`/auth/${mode}`, mode === "login" ? { email: form.email, password: form.password } : form);
      setUser(data.user);
      navigate(from, { replace: true });
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-md pb-24 pt-10" data-testid={`${mode}-page`}>
      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("auth.welcome")}</p>
      <h1 className="font-display text-3xl font-bold text-slate-900 sm:text-4xl">{mode === "login" ? t("auth.login") : t("auth.register")}</h1>
      <p className="mt-2 text-slate-500">{mode === "login" ? t("auth.loginSub") : t("auth.registerSub")}</p>
      <div className="mt-8 rounded-[2rem] border border-slate-100 bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
        <Button type="button" variant="outline" onClick={() => startGoogleLogin(from)} data-testid="google-login-button" className="h-12 w-full rounded-full font-semibold">
          <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          {t("auth.google")}
        </Button>
        <div className="my-5 flex items-center gap-3 text-xs font-semibold uppercase text-slate-400"><span className="h-px flex-1 bg-slate-200" />{t("auth.or")}<span className="h-px flex-1 bg-slate-200" /></div>
        <form onSubmit={submit} className="space-y-4">
          {mode === "register" && <div><label htmlFor="name" className="text-sm font-semibold text-slate-700">{t("auth.name")}</label><Input id="name" data-testid="name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} className="mt-1 h-12 rounded-xl" /></div>}
          <div><label htmlFor="email" className="text-sm font-semibold text-slate-700">{t("auth.email")}</label><Input id="email" type="email" data-testid="email-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className="mt-1 h-12 rounded-xl" /></div>
          <div><label htmlFor="password" className="text-sm font-semibold text-slate-700">{t("auth.password")}</label><Input id="password" type="password" data-testid="password-input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} className="mt-1 h-12 rounded-xl" /></div>
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700" data-testid="auth-error">{error}</p>}
          <Button type="submit" disabled={busy} className="h-12 w-full rounded-full text-base font-bold" data-testid="auth-submit">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("auth.submit")}</Button>
        </form>
        <p className="mt-5 text-center text-sm text-slate-500">
          {mode === "login" ? t("auth.noAccount") : t("auth.hasAccount")}{" "}
          <Link to={mode === "login" ? "/inscription" : "/connexion"} state={location.state} className="font-semibold text-primary" data-testid="switch-auth-mode">{mode === "login" ? t("auth.register") : t("auth.login")}</Link>
        </p>
      </div>
    </div>
  );
}
