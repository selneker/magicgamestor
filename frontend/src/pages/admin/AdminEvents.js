import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const EMPTY = { slug: "", title_fr: "", title_en: "", description_fr: "", description_en: "", image_url: "", badge: "promo", product_slug: "", price_label: "", old_price_label: "", active: true };

export default function AdminEvents() {
  const { t } = useLang();
  const [events, setEvents] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/admin/events").then((r) => setEvents(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(Object.entries(editing).filter(([k]) => k in EMPTY).map(([k, v]) => [k, v === "" ? null : v]));
    body.active = !!editing.active; body.description_fr = body.description_fr || ""; body.description_en = body.description_en || "";
    try {
      if (editing.id) await api.put(`/admin/events/${editing.id}`, body); else await api.post("/admin/events", body);
      toast.success(t("admin.save")); setEditing(null); load();
    } catch (err) { toast.error(errorMessage(err)); }
  };
  const remove = async (ev) => { if (!window.confirm(`${t("admin.delete")} ?`)) return; await api.delete(`/admin/events/${ev.id}`); load(); };
  const field = (k, label) => <label className="text-sm font-semibold text-slate-700">{label}<Input data-testid={`event-field-${k}`} value={editing[k] ?? ""} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} className="mt-1 h-10 rounded-xl" /></label>;

  return (
    <div data-testid="admin-events">
      <Button className="rounded-full font-bold" onClick={() => setEditing({ ...EMPTY })} data-testid="admin-new-event"><Plus className="mr-1 h-4 w-4" />{t("admin.newEvent")}</Button>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {events.map((ev) => (
          <div key={ev.id} data-testid={`admin-event-${ev.slug}`} className={`flex items-center gap-3 rounded-2xl border bg-white p-4 ${ev.active ? "border-slate-100" : "border-dashed opacity-60"}`}>
            {ev.image_url && <img src={ev.image_url} alt="" className="h-14 w-20 rounded-xl object-cover" />}
            <div className="min-w-0 flex-1"><p className="truncate font-display font-bold text-slate-900">{ev.title_fr}</p><p className="text-xs text-slate-500">♥ {ev.likes} · ↗ {ev.shares} · {ev.product_slug || "—"}</p></div>
            <Button size="icon" variant="ghost" className="rounded-full" onClick={() => setEditing({ ...EMPTY, ...ev })} data-testid={`admin-edit-event-${ev.slug}`}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="rounded-full text-slate-400 hover:text-rose-600" onClick={() => remove(ev)} data-testid={`admin-delete-event-${ev.slug}`}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl" data-testid="event-dialog">
          <DialogHeader><DialogTitle className="font-display">{editing?.id ? t("admin.edit") : t("admin.newEvent")}</DialogTitle></DialogHeader>
          {editing && (
            <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
              {field("title_fr", "Titre (FR)")}{field("title_en", "Title (EN)")}{field("slug", "Slug")}{field("badge", "Badge")}
              {field("image_url", "Image URL")}{field("product_slug", "Produit lié (slug)")}{field("price_label", "Prix affiché")}{field("old_price_label", "Ancien prix affiché")}
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Description FR<Textarea value={editing.description_fr || ""} onChange={(e) => setEditing({ ...editing, description_fr: e.target.value })} className="mt-1 rounded-xl" data-testid="event-field-description_fr" /></label>
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Description EN<Textarea value={editing.description_en || ""} onChange={(e) => setEditing({ ...editing, description_en: e.target.value })} className="mt-1 rounded-xl" data-testid="event-field-description_en" /></label>
              <label className="flex items-center gap-2 text-sm font-semibold"><Switch checked={!!editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} data-testid="event-field-active" />{t("admin.active")}</label>
              <Button type="submit" className="rounded-full font-bold sm:col-span-2" data-testid="event-save">{t("admin.save")}</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
