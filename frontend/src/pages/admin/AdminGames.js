import { useEffect, useState } from "react";
import { Gamepad2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Phase 3 — game management. `icon_url` is the single logo source: the visible label
// is "Logo URL" and the administrator can set/change it. No upload, no media manager.
const EMPTY = { id: "", name: "", slug: "", icon_url: "", description: "", description_en: "", active: true, sort_order: 0 };

export default function AdminGames() {
  const { t } = useLang();
  const [games, setGames] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/admin/games").then((r) => setGames(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    const body = {
      id: editing.id, name: editing.name, slug: editing.slug || editing.id,
      icon_url: (editing.icon_url || "").trim() || null,
      description: editing.description || "", description_en: editing.description_en || null,
      active: !!editing.active, sort_order: Number(editing.sort_order || 0),
    };
    try {
      if (editing._existing) await api.put(`/admin/games/${editing.id}`, body);
      else await api.post("/admin/games", body);
      toast.success(t("admin.save")); setEditing(null); load();
    } catch (err) { toast.error(errorMessage(err)); }
  };

  const toggleActive = async (g) => {
    try {
      await api.put(`/admin/games/${g.id}`, {
        id: g.id, name: g.name, slug: g.slug || g.id, icon_url: g.icon_url || null,
        description: g.description || "", description_en: g.description_en || null,
        active: !g.active, sort_order: Number(g.sort_order || 0),
      });
      load();
    } catch (err) { toast.error(errorMessage(err)); }
  };

  const field = (k, label, type = "text", disabled = false) => (
    <label className="text-sm font-semibold text-slate-700">{label}
      <Input data-testid={`game-field-${k}`} type={type} disabled={disabled} value={editing[k] ?? ""}
        onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} className="mt-1 h-10 rounded-xl" />
    </label>
  );

  return (
    <div data-testid="admin-games">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-foreground pb-3">
        <div>
          <p className="eyebrow">{t("admin.games")}</p>
          <h2 className="font-display text-2xl font-black uppercase tracking-tight">{t("admin.gamesTitle")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("admin.gamesHint")}</p>
        </div>
        <Button className="rounded-full font-bold" onClick={() => setEditing({ ...EMPTY })} data-testid="admin-new-game">
          <Plus className="mr-1 h-4 w-4" />{t("admin.newGame")}
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((g) => (
          <div key={g.id} data-testid={`admin-game-${g.slug || g.id}`}
            className={`flex min-w-0 items-center gap-3 rounded-2xl border bg-white p-3 sm:p-4 ${g.active ? "border-slate-100" : "border-dashed border-slate-300 opacity-60"}`}>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-[#0A0A0A]">
              {g.icon_url ? <img src={g.icon_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                : <Gamepad2 className="h-5 w-5" strokeWidth={2} aria-hidden="true" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words font-display text-sm font-bold leading-snug text-slate-900 sm:text-base">{g.name}</p>
              <p className="mt-0.5 break-words text-xs text-slate-500">{g.id} · {g.active ? t("admin.active") : t("admin.inactive")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Switch checked={!!g.active} onCheckedChange={() => toggleActive(g)} data-testid={`game-toggle-${g.slug || g.id}`} />
              <Button size="icon" variant="ghost" className="h-9 w-9 rounded-full"
                onClick={() => setEditing({ ...EMPTY, ...g, _existing: true })} data-testid={`admin-edit-game-${g.slug || g.id}`}>
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl" data-testid="game-dialog">
          <DialogHeader><DialogTitle className="font-display">{editing?._existing ? t("admin.edit") : t("admin.newGame")}</DialogTitle></DialogHeader>
          {editing && (
            <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
              {field("id", t("admin.gameId"), "text", !!editing._existing)}
              {field("name", t("admin.gameName"))}
              {field("slug", "Slug")}
              {field("sort_order", t("admin.sortOrder"), "number")}
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Logo URL
                <Input data-testid="game-field-icon_url" type="url" inputMode="url" placeholder="https://example.com/logo.png"
                  value={editing.icon_url ?? ""} onChange={(e) => setEditing({ ...editing, icon_url: e.target.value })} className="mt-1 h-10 rounded-xl" />
              </label>
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Description FR
                <Textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="mt-1 rounded-xl" data-testid="game-field-description" />
              </label>
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Description EN
                <Textarea value={editing.description_en ?? ""} onChange={(e) => setEditing({ ...editing, description_en: e.target.value })} className="mt-1 rounded-xl" data-testid="game-field-description_en" />
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold">
                <Switch checked={!!editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} data-testid="game-field-active" />{t("admin.active")}
              </label>
              <Button type="submit" className="rounded-full font-bold sm:col-span-2" data-testid="game-save">{t("admin.save")}</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
