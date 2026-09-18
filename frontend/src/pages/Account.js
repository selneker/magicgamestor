import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { OrderCard } from "@/pages/OrderTrack";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function Account() {
  const { t, lang } = useLang();
  const { user, setUser, logout } = useAuth();
  const [orders, setOrders] = useState(null);
  const [form, setForm] = useState({ name: user.name || "", phone: user.phone || "", ids: (user.saved_pubg_ids || []).join(", ") });
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get("/orders/me").then((r) => setOrders(r.data)).catch(() => setOrders([])); }, []);

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
        <form onSubmit={save} className="mt-6 space-y-4 rounded-[2rem] border border-slate-100 bg-white p-6">
          <h2 className="font-display text-lg font-bold text-slate-900">{t("account.profile")}</h2>
          <div><label className="text-sm font-semibold text-slate-700" htmlFor="acc-name">{t("account.name")}</label><Input id="acc-name" data-testid="profile-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 h-11 rounded-xl" /></div>
          <div><label className="text-sm font-semibold text-slate-700" htmlFor="acc-phone">{t("account.phone")}</label><Input id="acc-phone" data-testid="profile-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 h-11 rounded-xl" placeholder="034 XX XXX XX" /></div>
          <div><label className="text-sm font-semibold text-slate-700" htmlFor="acc-ids">{t("account.pubgIds")}</label><Input id="acc-ids" data-testid="profile-pubg-ids" value={form.ids} onChange={(e) => setForm({ ...form, ids: e.target.value })} className="mt-1 h-11 rounded-xl" placeholder="5123456789, 5987654321" /></div>
          <Button type="submit" disabled={busy} className="w-full rounded-full font-bold" data-testid="profile-save">{t("account.save")}</Button>
        </form>
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
