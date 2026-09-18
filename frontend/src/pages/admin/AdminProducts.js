import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const EMPTY = { slug: "", type: "uc", name: "", name_en: "", uc_amount: "", duration_months: "", price: "", old_price: "", popular: false, badge: "", description_fr: "", description_en: "", active: true, sort_order: 0 };

export default function AdminProducts() {
  const { t } = useLang();
  const [products, setProducts] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/products", { params: { include_inactive: true } }).then((r) => setProducts(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    const num = (v) => (v === "" || v === null ? null : Number(v));
    const body = { ...editing, uc_amount: num(editing.uc_amount), duration_months: num(editing.duration_months), price: Number(editing.price), old_price: num(editing.old_price), badge: editing.badge || null, name_en: editing.name_en || null, sort_order: Number(editing.sort_order || 0) };
    try {
      if (editing.id) await api.put(`/admin/products/${editing.id}`, body); else await api.post("/admin/products", body);
      toast.success(t("admin.save")); setEditing(null); load();
    } catch (err) { toast.error(errorMessage(err)); }
  };
  const remove = async (p) => { if (!window.confirm(`${t("admin.delete")} ${p.name} ?`)) return; await api.delete(`/admin/products/${p.id}`); load(); };
  const field = (k, label, type = "text") => (
    <label className="text-sm font-semibold text-slate-700">{label}<Input data-testid={`product-field-${k}`} type={type} value={editing[k] ?? ""} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} className="mt-1 h-10 rounded-xl" /></label>
  );

  return (
    <div data-testid="admin-products">
      <Button className="rounded-full font-bold" onClick={() => setEditing({ ...EMPTY })} data-testid="admin-new-product"><Plus className="mr-1 h-4 w-4" />{t("admin.newProduct")}</Button>
      <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <div key={p.id} data-testid={`admin-product-${p.slug}`} className={`flex items-center gap-3 rounded-2xl border bg-white p-4 ${p.active ? "border-slate-100" : "border-dashed border-slate-300 opacity-60"}`}>
            <div className="min-w-0 flex-1"><p className="truncate font-display font-bold text-slate-900">{p.name}</p><p className="text-xs text-slate-500">{p.type} · {formatAr(p.price)}{p.old_price ? ` (${formatAr(p.old_price)})` : ""}{p.popular ? " · ★" : ""}</p></div>
            <Button size="icon" variant="ghost" className="rounded-full" onClick={() => setEditing({ ...EMPTY, ...p })} data-testid={`admin-edit-product-${p.slug}`}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="rounded-full text-slate-400 hover:text-rose-600" onClick={() => remove(p)} data-testid={`admin-delete-product-${p.slug}`}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl" data-testid="product-dialog">
          <DialogHeader><DialogTitle className="font-display">{editing?.id ? t("admin.edit") : t("admin.newProduct")}</DialogTitle></DialogHeader>
          {editing && (
            <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
              {field("name", "Nom (FR)")}{field("name_en", "Name (EN)")}{field("slug", "Slug")}
              <label className="text-sm font-semibold text-slate-700">Type
                <Select value={editing.type} onValueChange={(v) => setEditing({ ...editing, type: v })}><SelectTrigger className="mt-1 h-10 rounded-xl" data-testid="product-field-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="uc">UC</SelectItem><SelectItem value="prime">Prime</SelectItem><SelectItem value="prime_plus">Prime+</SelectItem></SelectContent></Select>
              </label>
              {field("price", `${t("catalog.price")} (Ar)`, "number")}{field("old_price", "Ancien prix (Ar)", "number")}
              {field("uc_amount", "UC", "number")}{field("duration_months", "Mois", "number")}{field("badge", "Badge")}{field("sort_order", "Ordre", "number")}
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Description FR<Textarea value={editing.description_fr} onChange={(e) => setEditing({ ...editing, description_fr: e.target.value })} className="mt-1 rounded-xl" data-testid="product-field-description_fr" /></label>
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Description EN<Textarea value={editing.description_en} onChange={(e) => setEditing({ ...editing, description_en: e.target.value })} className="mt-1 rounded-xl" data-testid="product-field-description_en" /></label>
              <label className="flex items-center gap-2 text-sm font-semibold"><Switch checked={editing.popular} onCheckedChange={(v) => setEditing({ ...editing, popular: v })} data-testid="product-field-popular" />{t("admin.popular")}</label>
              <label className="flex items-center gap-2 text-sm font-semibold"><Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} data-testid="product-field-active" />{t("admin.active")}</label>
              <Button type="submit" className="rounded-full font-bold sm:col-span-2" data-testid="product-save">{t("admin.save")}</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
