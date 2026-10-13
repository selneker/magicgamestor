import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const EMPTY = { slug: "", type: "", game_id: "pubg-mobile", name: "", name_en: "", uc_amount: "", duration_months: "", price: "", old_price: "", popular: false, badge: "", evo_limit: "", image_url: "", description_fr: "", description_en: "", active: false, requires_mapping: true, sort_order: 0 };

function SeasonsPanel({ t }) {
  const [seasons, setSeasons] = useState(null);
  const [name, setName] = useState("");
  const load = () => api.get("/admin/seasons").then((r) => setSeasons(r.data)).catch(() => setSeasons([]));
  useEffect(() => { load(); }, []);
  const create = async (e) => {
    e.preventDefault();
    try { await api.post("/admin/seasons", { name, activate: true }); setName(""); toast.success(t("admin.save")); load(); }
    catch (err) { toast.error(errorMessage(err)); }
  };
  const activate = async (s) => {
    try { await api.post(`/admin/seasons/${s.id}/activate`); load(); } catch (err) { toast.error(errorMessage(err)); }
  };
  if (seasons === null) return null;
  return (
    <section className="mb-6 border-2 border-foreground bg-card p-4" data-testid="admin-seasons">
      <h2 className="font-display text-lg font-bold">{t("admin.seasons")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("admin.seasonsHint")}</p>
      <form onSubmit={create} className="mt-3 flex flex-wrap gap-2">
        <Input data-testid="season-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("admin.seasonName")} required className="h-10 w-full rounded-xl sm:w-56" />
        <Button type="submit" className="rounded-full font-bold" data-testid="season-create-button">{t("admin.newSeason")}</Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {seasons.map((s) => (
          <span key={s.id} data-testid={`season-${s.id}`} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${s.active ? "border-foreground bg-primary text-[#0A0A0A]" : "border-slate-200 text-slate-600"}`}>
            {s.name}{s.active ? ` · ${t("admin.activeSeason")}` : (
              <button type="button" onClick={() => activate(s)} className="underline" data-testid={`season-activate-${s.id}`}>{t("admin.activateSeason")}</button>
            )}
          </span>
        ))}
      </div>
    </section>
  );
}

export default function AdminProducts() {
  const { t } = useLang();
  const [products, setProducts] = useState([]);
  const [games, setGames] = useState([]);
  const [gameId, setGameId] = useState("pubg-mobile");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/products", { params: { include_inactive: true } }).then((r) => setProducts(r.data)).catch(() => {});
  useEffect(() => { load(); api.get("/admin/games").then((r) => setGames(r.data)).catch(() => {}); }, []);

  // Catalogue management is centred on ONE selected game: never mix catalogues.
  const typesOf = (gid) => games.find((g) => g.id === (gid || "pubg-mobile"))?.product_types || [];
  const typeName = (p) => typesOf(p.game_id).find((pt) => pt.key === p.type)?.label || p.type;
  const currentGame = useMemo(() => games.find((g) => g.id === gameId), [games, gameId]);
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return products
      .filter((p) => (p.game_id || "pubg-mobile") === gameId)
      .filter((p) => !term || [p.name, p.name_en, p.slug].some((v) => (v || "").toLowerCase().includes(term)));
  }, [products, gameId, q]);

  const save = async (e) => {
    e.preventDefault();
    if (!typesOf(editing.game_id).some((pt) => pt.key === editing.type)) return toast.error("Choisissez un type de produit valide pour ce jeu.");
    const num = (v) => (v === "" || v === null ? null : Number(v));
    const body = { ...editing, game_id: editing.game_id || "pubg-mobile", requires_mapping: ((editing.game_id || "pubg-mobile") !== "pubg-mobile" || !editing.id) ? true : editing.requires_mapping !== false, uc_amount: num(editing.uc_amount), duration_months: num(editing.duration_months), price: Number(editing.price), old_price: num(editing.old_price), badge: editing.badge || null, name_en: editing.name_en || null, evo_limit: editing.type === "evo" ? (editing.evo_limit || "season") : null, image_url: (editing.image_url || "").trim() || null, sort_order: Number(editing.sort_order || 0) };
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
      {/* Game selector — the whole catalogue screen is scoped to this game. */}
      <section className="border-2 border-foreground bg-card p-4 sm:p-5" data-testid="admin-catalog-gamebar">
        <p className="eyebrow">{t("admin.catalogPickGame")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("admin.catalogGameHint")}</p>
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto" role="tablist" data-testid="admin-game-tabs">
          {games.map((g) => {
            const active = g.id === gameId;
            return (
              <button key={g.id} type="button" role="tab" aria-selected={active} data-testid={`admin-game-tab-${g.id}`} onClick={() => setGameId(g.id)}
                className={`inline-flex shrink-0 items-center gap-2 border px-4 py-2 text-[11px] font-black uppercase tracking-[0.1em] transition-colors ${active ? "border-foreground bg-primary text-[#0A0A0A]" : "border-foreground bg-card text-muted-foreground hover:bg-foreground hover:text-background"}`}>
                {g.name}{g.active ? "" : ` · ${t("admin.inactive")}`}
              </button>
            );
          })}
        </div>
      </section>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button className="rounded-full font-bold" onClick={() => setEditing({ ...EMPTY, game_id: gameId })} data-testid="admin-new-product"><Plus className="mr-1 h-4 w-4" />{t("admin.newProduct")}</Button>
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground" data-testid="admin-catalog-count">{visible.length} {t("admin.catalogCount")}</span>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input data-testid="admin-catalog-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("admin.catalogSearch")} className="h-10 rounded-full pl-9" />
          {q && <button type="button" data-testid="admin-catalog-search-clear" aria-label="clear" onClick={() => setQ("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="h-4 w-4" /></button>}
        </div>
      </div>

      {gameId === "pubg-mobile" && <div className="mt-6"><SeasonsPanel t={t} /></div>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((p) => (
          <div key={p.id} data-testid={`admin-product-${p.slug}`} className={`flex min-w-0 items-center gap-2 border-2 bg-card p-3 sm:gap-3 sm:p-4 ${p.active ? "border-foreground" : "border-dashed border-[color:var(--rule-strong)] opacity-60"}`}>
            <div className="min-w-0 flex-1">
              <p className="break-words font-display text-sm font-bold leading-snug sm:text-base">{p.name}</p>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="rounded-full border border-[color:var(--rule-strong)] px-2 py-0.5 font-semibold uppercase tracking-[0.08em]">{typeName(p)}</span>
                <span className="font-semibold text-foreground">{formatAr(p.price)}</span>
                {p.old_price ? <span className="line-through">{formatAr(p.old_price)}</span> : null}
                {p.popular ? <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-[#0A0A0A]">★</span> : null}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${p.active ? "bg-foreground text-background" : "border border-[color:var(--rule-strong)]"}`}>{p.active ? t("admin.active") : t("admin.inactive")}</span>
              </p>
            </div>
            <div className="flex shrink-0 items-center">
              <Button size="icon" variant="ghost" className="h-9 w-9 rounded-full" onClick={() => setEditing({ ...EMPTY, ...p, game_id: p.game_id || "pubg-mobile", requires_mapping: p.requires_mapping ?? false })} data-testid={`admin-edit-product-${p.slug}`}><Pencil className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-9 w-9 rounded-full text-slate-400 hover:text-rose-600" onClick={() => remove(p)} data-testid={`admin-delete-product-${p.slug}`}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
        ))}
      </div>
      {visible.length === 0 && (
        <div className="mt-4 border-2 border-dashed border-[color:var(--rule-strong)] bg-card p-10 text-center" data-testid="admin-catalog-empty">
          <p className="font-display text-base font-bold">{currentGame?.name || ""}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("admin.catalogEmptyGame")}</p>
          <Button className="mt-4 rounded-full font-bold" onClick={() => setEditing({ ...EMPTY, game_id: gameId })} data-testid="admin-catalog-empty-new"><Plus className="mr-1 h-4 w-4" />{t("admin.newProduct")}</Button>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl" data-testid="product-dialog">
          <DialogHeader><DialogTitle className="font-display">{editing?.id ? t("admin.edit") : t("admin.newProduct")}</DialogTitle></DialogHeader>
          {editing && (
            <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
              {field("name", "Nom (FR)")}{field("name_en", "Name (EN)")}{field("slug", "Slug")}
              <label className="text-sm font-semibold text-slate-700">Jeu associé
                <Select value={editing.game_id || "pubg-mobile"} onValueChange={(v) => setEditing({ ...editing, game_id: v, type: typesOf(v).some((pt) => pt.key === editing.type) ? editing.type : "" })}>
                  <SelectTrigger className="mt-1 h-10 rounded-xl" data-testid="product-field-game_id"><SelectValue placeholder="Choisir un jeu" /></SelectTrigger>
                  <SelectContent>{games.map((g) => <SelectItem key={g.id} value={g.id}>{g.name} {g.active ? "" : "· Inactif"}</SelectItem>)}</SelectContent>
                </Select>
              </label>
              <label className="text-sm font-semibold text-slate-700">Type
                <Select value={editing.type || ""} onValueChange={(v) => setEditing({ ...editing, type: v })}><SelectTrigger className="mt-1 h-10 rounded-xl" data-testid="product-field-type"><SelectValue placeholder={typesOf(editing.game_id).length ? "Choisir un type" : "Aucun type configuré"} /></SelectTrigger><SelectContent>{typesOf(editing.game_id).map((pt) => <SelectItem key={pt.key} value={pt.key} data-testid={`product-type-option-${pt.key}`}>{pt.label}</SelectItem>)}</SelectContent></Select>
                {typesOf(editing.game_id).length === 0 && <span className="mt-1 block text-xs font-normal text-amber-700" data-testid="product-type-missing">Configurez les types de produit de ce jeu dans Admin → Jeux.</span>}
              </label>
              {editing.type === "evo" && (editing.game_id || "pubg-mobile") === "pubg-mobile" && (
                <label className="text-sm font-semibold text-slate-700">{t("admin.evoLimit")}
                  <Select value={editing.evo_limit || "season"} onValueChange={(v) => setEditing({ ...editing, evo_limit: v })}><SelectTrigger className="mt-1 h-10 rounded-xl" data-testid="product-field-evo_limit"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="season">{t("evo.limit.season")}</SelectItem><SelectItem value="lifetime">{t("evo.limit.lifetime")}</SelectItem><SelectItem value="week">{t("evo.limit.week")}</SelectItem></SelectContent></Select>
                </label>
              )}
              {field("price", `${t("catalog.price")} (Ar)`, "number")}{field("old_price", "Ancien prix (Ar)", "number")}
              {field("uc_amount", `${games.find((g) => g.id === (editing.game_id || "pubg-mobile"))?.currency_label || ((editing.game_id || "pubg-mobile") === "pubg-mobile" ? "UC" : "Quantité de monnaie")}`, "number")}{field("duration_months", "Mois", "number")}{field("badge", "Badge")}{field("sort_order", "Ordre", "number")}
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Logo URL<Input data-testid="product-field-image_url" type="url" inputMode="url" placeholder="https://example.com/60uc.png" value={editing.image_url ?? ""} onChange={(e) => setEditing({ ...editing, image_url: e.target.value })} className="mt-1 h-10 rounded-xl" /></label>
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Description FR<Textarea value={editing.description_fr} onChange={(e) => setEditing({ ...editing, description_fr: e.target.value })} className="mt-1 rounded-xl" data-testid="product-field-description_fr" /></label>
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Description EN<Textarea value={editing.description_en} onChange={(e) => setEditing({ ...editing, description_en: e.target.value })} className="mt-1 rounded-xl" data-testid="product-field-description_en" /></label>
              <label className="flex items-center gap-2 text-sm font-semibold"><Switch checked={editing.popular} onCheckedChange={(v) => setEditing({ ...editing, popular: v })} data-testid="product-field-popular" />{t("admin.popular")}</label>
              <p className="text-xs font-semibold text-slate-700 sm:col-span-2">Mapping fournisseur obligatoire pour tout nouveau pack. Un pack reste inactif jusqu'à ce que tu confirmes son offre dans Admin → Fournisseur.</p>
              <label className="flex items-center gap-2 text-sm font-semibold"><Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} data-testid="product-field-active" />{t("admin.active")}</label>
              <p className="text-xs text-slate-500 sm:col-span-2">Pour un nouveau jeu, créez d'abord le produit inactif, configurez son mapping dans Fournisseur, puis activez-le. Un jeu ne devient public qu'avec un catalogue livrable.</p>
              <Button type="submit" className="rounded-full font-bold sm:col-span-2" data-testid="product-save">{t("admin.save")}</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
