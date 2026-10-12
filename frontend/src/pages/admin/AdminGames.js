import { useEffect, useState } from "react";
import { CheckCircle2, Gamepad2, Pencil, Plus, Trash2, XCircle } from "lucide-react";
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
// Multi-jeux : `identity_fields` définit le contrat de saisie du joueur POUR CE JEU
// (clé, libellé, format). Aucune clé n'est imposée : `player_id` n'est pas une hypothèse globale.
const EMPTY = { id: "", name: "", slug: "", icon_url: "", currency_label: "", description: "", description_en: "", active: false, sort_order: 0, identity_fields: [], product_types: [] };
const TYPE_RE = /^[a-z][a-z0-9_]{0,31}$/;
const CHECK_LABELS = { identity: "Identité joueur", product_types: "Types de produit", provider_categories: "Catégories FazerCards", catalog: "Catalogue livrable", type_compat: "Types des produits", mapping_scope: "Périmètre des mappings" };

// Readiness checklist computed by the backend (GET /admin/games): explains why activation is refused.
function Readiness({ readiness, compact = false }) {
  if (!readiness) return null;
  if (compact) {
    const missing = readiness.checks.filter((c) => !c.ok).length;
    return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${readiness.ready ? "bg-primary text-[#0A0A0A]" : "border text-muted-foreground"}`}>{readiness.ready ? "Prêt à la vente" : `${missing} étape(s) manquante(s)`}</span>;
  }
  return (
    <ul className="space-y-1.5 rounded-2xl border p-3 sm:col-span-2" data-testid="game-readiness">
      <li className="text-sm font-bold">Préparation à la vente {readiness.ready ? "— complète" : "— incomplète"}</li>
      {readiness.checks.map((c) => (
        <li key={c.key} className="flex items-start gap-2 text-xs" data-testid={`readiness-${c.key}`}>
          {c.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />}
          <span><b>{CHECK_LABELS[c.key] || c.key}</b> — {c.detail}</span>
        </li>
      ))}
    </ul>
  );
}
const EMPTY_FIELD = { key: "", label: "", pattern: "", min_length: "", max_length: "", required: true };
const KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;

export default function AdminGames() {
  const { t } = useLang();
  const [games, setGames] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/admin/games").then((r) => setGames(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    const fields = (editing.identity_fields || EMPTY.identity_fields).map((f) => ({
      key: (f.key || "").trim(), label: (f.label || "").trim(),
      ...(f.pattern ? { pattern: f.pattern } : {}),
      ...(f.min_length !== "" && f.min_length != null ? { min_length: Number(f.min_length) } : {}),
      ...(f.max_length !== "" && f.max_length != null ? { max_length: Number(f.max_length) } : {}),
      required: f.required !== false, primary: !!f.primary,
    }));
    const bad = fields.find((f) => !KEY_RE.test(f.key) || !f.label);
    if (bad) return toast.error(`Champ d'identité invalide : clé (minuscules/chiffres/_) et libellé requis (${bad.key || "?"}).`);
    const types = (editing.product_types || []).map((pt) => ({ key: (pt.key || "").trim(), label: (pt.label || "").trim(), label_en: (pt.label_en || "").trim() || null }));
    const badType = types.find((pt) => !TYPE_RE.test(pt.key) || !pt.label);
    if (badType) return toast.error(`Type de produit invalide : clé (minuscules/chiffres/_) et libellé requis (${badType.key || "?"}).`);
    const body = {
      product_types: types,
      id: editing.id, name: editing.name, slug: editing.slug || editing.id,
      icon_url: (editing.icon_url || "").trim() || null,
      currency_label: (editing.currency_label || "").trim() || null,
      identity_fields: fields,
      description: editing.description || "", description_en: editing.description_en || null,
      active: !!editing.active, sort_order: Number(editing.sort_order || 0),
    };
    try {
      if (editing._existing) await api.put(`/admin/games/${editing.id}`, body);
      else await api.post("/admin/games", body);
      toast.success(t("admin.save")); setEditing(null); load();
    } catch (err) { toast.error(errorMessage(err)); }
  };

  const setFields = (fn) => setEditing((s) => ({ ...s, identity_fields: fn(s.identity_fields || []) }));
  const addField = () => setFields((l) => [...l, { ...EMPTY_FIELD, primary: l.length === 0 }]);
  const updField = (i, patch) => setFields((l) => l.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const delField = (i) => setFields((l) => l.filter((_, idx) => idx !== i));
  const makePrimary = (i) => setFields((l) => l.map((f, idx) => ({ ...f, primary: idx === i })));

  const setTypes = (fn) => setEditing((s) => ({ ...s, product_types: fn(s.product_types || []) }));

  const toggleActive = async (g) => {
    try {
      await api.put(`/admin/games/${g.id}`, {
        id: g.id, name: g.name, slug: g.slug || g.id, icon_url: g.icon_url || null,
        currency_label: g.currency_label || null,
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
              <div className="mt-1.5" data-testid={`game-readiness-badge-${g.id}`}><Readiness readiness={g.readiness} compact /></div>
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
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            Pour préparer un nouveau jeu : définissez ses champs d'identité joueur, son unité de monnaie,
            associez ses catégories FazerCards et liez chaque pack dans Admin → Fournisseur.
            Le jeu ne pourra être activé que lorsque sa configuration ET son catalogue livrable seront réels.
          </p>
          {editing && (
            <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
              {field("id", t("admin.gameId"), "text", !!editing._existing)}
              {field("name", t("admin.gameName"))}
              {field("slug", "Slug")}
              {field("sort_order", t("admin.sortOrder"), "number")}
              <label className="text-sm font-semibold text-slate-700">Unité de monnaie
                <Input data-testid="game-field-currency_label" maxLength={24} placeholder="UC, Diamants, Coins…"
                  value={editing.currency_label ?? ""} onChange={(e) => setEditing({ ...editing, currency_label: e.target.value })} className="mt-1 h-10 rounded-xl" />
                <span className="mt-1 block text-xs font-normal text-slate-500">Utilisée pour nommer la monnaie des packs dans la boutique (ex. UC, Diamants).</span>
              </label>
              <label className="text-sm font-semibold text-slate-700">Logo URL
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
              <div className="sm:col-span-2 rounded-2xl border-2 border-foreground/15 p-3" data-testid="game-identity-fields">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold">Champs d'identité joueur</p>
                  <Button type="button" size="sm" variant="outline" className="rounded-full font-bold" onClick={addField} data-testid="game-identity-add">
                    <Plus className="mr-1 h-3.5 w-3.5" />Ajouter un champ
                  </Button>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Exigés par le fournisseur pour ce jeu (ex. <code>player_id</code>, <code>zone_id</code>, <code>server</code>).
                  Le checkout affiche exactement ces champs. Aucune clé n'est imposée ; cochez « principale » pour la valeur de suivi.
                </p>
                <div className="mt-3 space-y-2">
                  {(editing.identity_fields || []).length === 0 && (
                    <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-2 text-xs text-amber-800" data-testid="game-identity-empty">
                      Aucun champ défini : l'activation publique de ce jeu sera refusée.
                    </p>
                  )}
                  {(editing.identity_fields || []).map((f, i) => (
                    <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-12" data-testid={`game-identity-row-${i}`}>
                      <Input aria-label="Clé" placeholder="player_id" value={f.key || ""} onChange={(e) => updField(i, { key: e.target.value })} className="col-span-1 h-9 rounded-lg sm:col-span-3" data-testid={`game-identity-key-${i}`} />
                      <Input aria-label="Libellé" placeholder="ID joueur" value={f.label || ""} onChange={(e) => updField(i, { label: e.target.value })} className="col-span-1 h-9 rounded-lg sm:col-span-3" data-testid={`game-identity-label-${i}`} />
                      <Input aria-label="Motif" placeholder="^[0-9]{6,12}$" value={f.pattern || ""} onChange={(e) => updField(i, { pattern: e.target.value })} className="col-span-1 h-9 rounded-lg sm:col-span-3" data-testid={`game-identity-pattern-${i}`} />
                      <Input aria-label="Longueur min" type="number" placeholder="min" value={f.min_length ?? ""} onChange={(e) => updField(i, { min_length: e.target.value })} className="col-span-1 h-9 rounded-lg sm:col-span-1" data-testid={`game-identity-min-${i}`} />
                      <Input aria-label="Longueur max" type="number" placeholder="max" value={f.max_length ?? ""} onChange={(e) => updField(i, { max_length: e.target.value })} className="col-span-1 h-9 rounded-lg sm:col-span-1" data-testid={`game-identity-max-${i}`} />
                      <label className="col-span-1 flex items-center gap-1 text-xs font-semibold sm:col-span-1">
                        <input type="radio" name="identity-primary" checked={!!f.primary} onChange={() => makePrimary(i)} data-testid={`game-identity-primary-${i}`} />principale
                      </label>
                      <Button type="button" size="icon" variant="ghost" className="col-span-1 h-9 w-9 rounded-full" onClick={() => delField(i)} data-testid={`game-identity-del-${i}`} aria-label="Supprimer">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2 rounded-2xl border-2 border-foreground/15 p-3" data-testid="game-product-types">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold">Types de produit (boutique MGS)</p>
                  <Button type="button" size="sm" variant="outline" className="rounded-full font-bold" onClick={() => setTypes((l) => [...l, { key: "", label: "", label_en: "" }])} data-testid="game-type-add">
                    <Plus className="mr-1 h-3.5 w-3.5" />Ajouter un type
                  </Button>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Classement interne des packs de ce jeu (ex. <code>cp</code> « CP », <code>battle_pass</code> « Battle Pass », <code>diamonds</code> « Diamants »).
                  Distinct des catégories FazerCards : chaque pack reste lié à une offre réelle dans Admin → Fournisseur.
                  {editing.id !== "pubg-mobile" && " Les clés prime, prime_plus et evo sont réservées à PUBG Mobile."}
                </p>
                <div className="mt-3 space-y-2">
                  {(editing.product_types || []).length === 0 && (
                    <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-2 text-xs text-amber-800" data-testid="game-types-empty">Aucun type : aucun pack ne pourra être créé pour ce jeu.</p>
                  )}
                  {(editing.product_types || []).map((pt, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2" data-testid={`game-type-row-${i}`}>
                      <Input aria-label="Clé" placeholder="cp" value={pt.key || ""} onChange={(e) => setTypes((l) => l.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} className="h-9 rounded-lg" data-testid={`game-type-key-${i}`} />
                      <Input aria-label="Libellé" placeholder="CP" value={pt.label || ""} onChange={(e) => setTypes((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="h-9 rounded-lg" data-testid={`game-type-label-${i}`} />
                      <Input aria-label="Label EN" placeholder="CP" value={pt.label_en || ""} onChange={(e) => setTypes((l) => l.map((x, j) => (j === i ? { ...x, label_en: e.target.value } : x)))} className="h-9 rounded-lg" data-testid={`game-type-label-en-${i}`} />
                      <Button type="button" size="icon" variant="ghost" className="h-9 w-9 rounded-full" onClick={() => setTypes((l) => l.filter((_, j) => j !== i))} data-testid={`game-type-del-${i}`} aria-label="Supprimer"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                </div>
              </div>
              {editing._existing && <Readiness readiness={editing.readiness} />}
              <Button type="submit" className="rounded-full font-bold sm:col-span-2" data-testid="game-save">{t("admin.save")}</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
