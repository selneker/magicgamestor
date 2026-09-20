import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function Shell({ title, subtitle, testId, children }) {
  return (
    <div className="mx-auto max-w-md pb-24 pt-10" data-testid={testId}>
      <p className="eyebrow">Magic Game Store</p>
      <h1 className="font-display text-3xl font-bold text-slate-900 sm:text-4xl">{title}</h1>
      {subtitle && <p className="mt-2 text-slate-500">{subtitle}</p>}
      <div className="mt-8 rounded-[2rem] border border-slate-100 bg-white p-6">{children}</div>
    </div>
  );
}

export function ForgotPassword() {
  const { t } = useLang();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api.post("/auth/forgot-password", { email }); setSent(true); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Shell title={t("auth.forgotTitle")} subtitle={t("auth.forgotSub")} testId="forgot-password-page">
      {sent ? <p className="text-sm" data-testid="forgot-sent">{t("auth.forgotSent")}</p> : (
        <form onSubmit={submit} className="space-y-4">
          <div><label htmlFor="fp-email" className="text-sm font-medium">{t("auth.email")}</label><Input id="fp-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-12 rounded-xl" data-testid="forgot-email-input" /></div>
          <Button type="submit" disabled={busy} className="h-12 w-full rounded-full font-semibold" data-testid="forgot-submit">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("auth.forgotCta")}</Button>
        </form>
      )}
      <p className="mt-5 text-center text-sm text-slate-500"><Link to="/connexion" className="font-semibold text-primary" data-testid="back-to-login">{t("auth.login")}</Link></p>
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
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Shell title={t("auth.resetTitle")} subtitle={t("auth.resetSub")} testId="reset-password-page">
      <form onSubmit={submit} className="space-y-4">
        <div><label htmlFor="rp-pass" className="text-sm font-medium">{t("auth.newPassword")}</label><Input id="rp-pass" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1 h-12 rounded-xl" data-testid="reset-password-input" /></div>
        <div><label htmlFor="rp-confirm" className="text-sm font-medium">{t("auth.confirmPassword")}</label><Input id="rp-confirm" type="password" required minLength={8} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} className="mt-1 h-12 rounded-xl" data-testid="reset-confirm-input" /></div>
        <Button type="submit" disabled={busy} className="h-12 w-full rounded-full font-semibold" data-testid="reset-submit">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("auth.resetCta")}</Button>
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
