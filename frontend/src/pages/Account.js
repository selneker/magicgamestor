import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Coins, LogOut, MailCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { OrderCard } from "@/pages/OrderTrack";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function VerifyBanner({ user }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  if (user.email_verified) return null;
  const resend = async () => {
    setBusy(true);
    try { await api.post("/auth/resend-verification"); toast.success(t("account.verifyResent")); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-strong bg-primary/15 px-4 py-3 text-sm" data-testid="verify-email-banner">
      <MailCheck className="h-4 w-4 shrink-0" />
      <span className="flex-1">{t("account.verifyNotice")}</span>
      <Button size="sm" variant="outline" onClick={resend} disabled={busy} className="rounded-full" data-testid="resend-verification-button">{t("account.verifyResend")}</Button>
    </div>
  );
}

function SecuritySection({ user }) {
  const { t } = useLang();
  const { setUser, logout } = useAuth();
  const local = user.auth_provider === "password";
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [del, setDel] = useState({ password: "", confirmation: "", open: false });
  const [busy, setBusy] = useState(false);

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) return toast.error(t("auth.passwordMismatch"));
    setBusy(true);
    try { const { data } = await api.post("/auth/change-password", { current_password: pw.current || undefined, new_password: pw.next }); setUser(data.user); setPw({ current: "", next: "", confirm: "" }); toast.success(t("account.passwordChanged")); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const deleteAccount = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api.post("/auth/me/delete", { password: del.password || undefined, confirmation: del.confirmation }); toast.success(t("account.deleted")); await logout(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <section className="mt-6 space-y-4 rounded-[2rem] border border-slate-100 bg-white p-6" data-testid="account-security">
      <h2 className="font-display text-lg font-bold text-slate-900">{t("account.security")}</h2>
      <form onSubmit={changePassword} className="space-y-3">
        {local && <div><label htmlFor="pw-cur" className="text-sm font-medium">{t("account.currentPassword")}</label><Input id="pw-cur" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required className="mt-1 h-11 rounded-xl" data-testid="current-password-input" /></div>}
        <div><label htmlFor="pw-next" className="text-sm font-medium">{t("auth.newPassword")}</label><Input id="pw-next" type="password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required className="mt-1 h-11 rounded-xl" data-testid="new-password-input" /></div>
        <div><label htmlFor="pw-conf" className="text-sm font-medium">{t("auth.confirmPassword")}</label><Input id="pw-conf" type="password" minLength={8} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required className="mt-1 h-11 rounded-xl" data-testid="confirm-password-input" /></div>
        <Button type="submit" variant="outline" disabled={busy} className="w-full rounded-full font-semibold" data-testid="change-password-submit">{local ? t("account.changePassword") : t("account.setPassword")}</Button>
      </form>
      <div className="rule-t pt-4">
        {!del.open ? (
          <Button type="button" variant="ghost" onClick={() => setDel({ ...del, open: true })} className="w-full rounded-full text-destructive hover:text-destructive" data-testid="delete-account-open"><ShieldAlert className="mr-2 h-4 w-4" />{t("account.deleteAccount")}</Button>
        ) : (
          <form onSubmit={deleteAccount} className="space-y-3" data-testid="delete-account-form">
            <p className="text-sm text-muted-foreground">{t("account.deleteWarning")}</p>
            {local && <div><label htmlFor="del-pw" className="text-sm font-medium">{t("auth.password")}</label><Input id="del-pw" type="password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} required className="mt-1 h-11 rounded-xl" data-testid="delete-password-input" /></div>}
            <div><label htmlFor="del-conf" className="text-sm font-medium">{t("account.deleteType")}</label><Input id="del-conf" value={del.confirmation} onChange={(e) => setDel({ ...del, confirmation: e.target.value })} required placeholder="SUPPRIMER" className="mt-1 h-11 rounded-xl font-mono" data-testid="delete-confirmation-input" /></div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setDel({ password: "", confirmation: "", open: false })} className="flex-1 rounded-full" data-testid="delete-account-cancel">{t("common.back")}</Button>
              <Button type="submit" variant="destructive" disabled={busy || del.confirmation.toUpperCase() !== "SUPPRIMER"} className="flex-1 rounded-full font-semibold" data-testid="delete-account-submit">{t("account.deleteConfirm")}</Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

export default function Account() {
  const { t, lang } = useLang();
  const { user, setUser, logout } = useAuth();
  const [orders, setOrders] = useState(null);
  const [points, setPoints] = useState(null);
  const [form, setForm] = useState({ name: user.name || "", phone: user.phone || "", ids: (user.saved_pubg_ids || []).join(", ") });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/orders/me").then((r) => setOrders(r.data)).catch(() => setOrders([]));
    api.get("/loyalty/me").then((r) => setPoints(r.data.balance)).catch(() => setPoints(null));
  }, []);

  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const { data } = await api.patch("/auth/me", { name: form.name, phone: form.phone, saved_pubg_ids: form.ids.split(/[,\s]+/).filter(Boolean) });
      setUser(data); toast.success(t("account.saved"));
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-8 pb-24 pt-6 lg:grid-cols-[0.8fr_1.2fr]" data-testid="account-page">
      <section>
        <div className="flex items-center gap-4">
          {user.picture ? <img src={user.picture} alt="" className="h-14 w-14 rounded-full" /> : <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 font-display text-xl font-bold text-primary">{(user.name || user.email)[0].toUpperCase()}</div>}
          <div><h1 className="font-display text-2xl font-bold text-slate-900" data-testid="account-name">{user.name}</h1><p className="text-sm text-slate-500" data-testid="account-email">{user.email}</p></div>
        </div>
        <p className="mt-2 text-xs text-slate-400">{t("account.memberSince")} {new Date(user.created_at).toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR")}</p>
        <VerifyBanner user={user} />
        {points && (
          <Link to="/compte/points" className="card-lift mt-4 flex items-center justify-between rounded-xl border border-strong bg-foreground px-4 py-3 text-background" data-testid="account-points-card">
            <span className="flex items-center gap-2 text-sm"><Coins className="h-4 w-4 text-[#C5FE02]" />{t("loyalty.title")}</span>
            <span className="num text-xl text-[#C5FE02]" data-testid="account-points-balance">{points.total} pts</span>
          </Link>
        )}
        <form onSubmit={save} className="mt-6 space-y-4 rounded-[2rem] border border-slate-100 bg-white p-6">
          <h2 className="font-display text-lg font-bold text-slate-900">{t("account.profile")}</h2>
          <div><label className="text-sm font-semibold text-slate-700" htmlFor="acc-name">{t("account.name")}</label><Input id="acc-name" data-testid="profile-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 h-11 rounded-xl" /></div>
          <div><label className="text-sm font-semibold text-slate-700" htmlFor="acc-phone">{t("account.phone")}</label><Input id="acc-phone" data-testid="profile-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 h-11 rounded-xl" placeholder="034 XX XXX XX" /></div>
          <div><label className="text-sm font-semibold text-slate-700" htmlFor="acc-ids">{t("account.pubgIds")}</label><Input id="acc-ids" data-testid="profile-pubg-ids" value={form.ids} onChange={(e) => setForm({ ...form, ids: e.target.value })} className="mt-1 h-11 rounded-xl" placeholder="5123456789, 5987654321" /></div>
          <Button type="submit" disabled={busy} className="w-full rounded-full font-bold" data-testid="profile-save">{t("account.save")}</Button>
        </form>
        <SecuritySection user={user} />
        <Button variant="ghost" onClick={logout} className="mt-4 w-full rounded-full text-rose-600 hover:bg-rose-50 hover:text-rose-700" data-testid="account-logout"><LogOut className="mr-2 h-4 w-4" />{t("nav.logout")}</Button>
      </section>
      <section>
        <h2 className="font-display text-2xl font-bold text-slate-900">{t("account.orders")}</h2>
        <div className="mt-4 space-y-4" data-testid="account-orders">
          {orders === null && <p className="text-slate-500">{t("common.loading")}</p>}
          {orders?.length === 0 && <p className="rounded-2xl bg-white p-6 text-slate-500" data-testid="account-orders-empty">{t("order.none")}</p>}
          {orders?.map((o) => <OrderCard key={o.id} order={o} />)}
        </div>
      </section>
    </div>
  );
}
