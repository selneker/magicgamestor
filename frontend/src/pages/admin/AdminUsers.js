import { useCallback, useEffect, useState } from "react";
import { Ban, Check, Loader2, Search, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, formatAr } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const PERMISSION_LABELS = {
  "users.manage": "Users",
  "orders.manage": "Orders",
  "loyalty.manage": "Loyalty",
  "catalog.manage": "Catalogue",
  "events.manage": "Events",
  "chat.manage": "Chat",
};
const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS);
const ROLE_LABEL = { customer: "User", admin: "Admin", super_admin: "Super admin" };

const Badge = ({ children, tone = "muted", testid }) => (
  <span data-testid={testid} className={`inline-flex items-center border border-foreground px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] ${tone === "primary" ? "bg-primary text-[#0A0A0A]" : tone === "danger" ? "bg-rose-500 text-white" : "bg-card text-muted-foreground"}`}>{children}</span>
);

export default function AdminUsers() {
  const { user: me } = useAuth();
  const isSuper = me?.role === "super_admin";
  const [data, setData] = useState({ items: [], total: 0, page: 1, page_size: 20 });
  const [filters, setFilters] = useState({ search: "", role: "", status: "", email_verified: "" });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [grant, setGrant] = useState(null);
  const [grantPerms, setGrantPerms] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: 20 };
      if (filters.search) params.search = filters.search;
      if (filters.role) params.role = filters.role;
      if (filters.status) params.status = filters.status;
      if (filters.email_verified) params.email_verified = filters.email_verified === "yes";
      const { data: res } = await api.get("/admin/users", { params });
      setData(res);
    } catch (e) { toast.error(errorMessage(e)); } finally { setLoading(false); }
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (u) => {
    try { const { data: d } = await api.get(`/admin/users/${u.user_id}`); setDetail(d); }
    catch (e) { toast.error(errorMessage(e)); }
  };

  const setStatus = async (u, blocked) => {
    setBusy(true);
    try {
      await api.patch(`/admin/users/${u.user_id}/status`, { blocked });
      toast.success(blocked ? "Utilisateur bloqué." : "Utilisateur débloqué.");
      if (detail?.user_id === u.user_id) openDetail(u);
      load();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const confirmGrant = async () => {
    setBusy(true);
    try {
      await api.patch(`/admin/users/${grant.user_id}/role`, { role: "admin", permissions: grantPerms });
      toast.success("Accès administration accordé.");
      setGrant(null); setGrantPerms([]); load();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const revoke = async (u) => {
    if (!window.confirm("Retirer l'accès administration à cet utilisateur ?")) return;
    setBusy(true);
    try { await api.patch(`/admin/users/${u.user_id}/role`, { role: "customer" }); toast.success("Accès retiré."); setDetail(null); load(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const togglePermission = async (u, perm, enabled) => {
    const next = enabled ? [...(u.permissions || []), perm] : (u.permissions || []).filter((p) => p !== perm);
    if (!window.confirm(`Enregistrer les permissions de ${u.name || u.email} ?`)) return;
    setBusy(true);
    try {
      const { data: updated } = await api.patch(`/admin/users/${u.user_id}/permissions`, { permissions: next });
      setDetail((d) => (d ? { ...d, permissions: updated.permissions } : d));
      toast.success("Permissions enregistrées.");
      load();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const remove = async (u) => {
    if (!window.confirm("Supprimer / anonymiser ce compte ? L'historique financier est conservé.")) return;
    setBusy(true);
    try { await api.delete(`/admin/users/${u.user_id}`); toast.success("Compte anonymisé."); setDetail(null); load(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const pages = Math.max(1, Math.ceil(data.total / (data.page_size || 20)));

  return (
    <div className="space-y-4" data-testid="admin-users">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
          <Input data-testid="users-search" value={filters.search} placeholder="Nom, email, téléphone, PUBG ID"
            onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, search: e.target.value })); }} className="h-11 rounded-xl pl-9" />
        </div>
        <select data-testid="users-filter-role" value={filters.role} onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, role: e.target.value })); }} className="h-11 border border-foreground bg-card px-3 text-sm font-semibold">
          <option value="">Tous les rôles</option>
          <option value="customer">User</option>
          <option value="admin">Admin</option>
          <option value="super_admin">Super admin</option>
        </select>
        <select data-testid="users-filter-status" value={filters.status} onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, status: e.target.value })); }} className="h-11 border border-foreground bg-card px-3 text-sm font-semibold">
          <option value="">Tous les statuts</option>
          <option value="active">Actif</option>
          <option value="blocked">Bloqué</option>
        </select>
        <select data-testid="users-filter-verified" value={filters.email_verified} onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, email_verified: e.target.value })); }} className="h-11 border border-foreground bg-card px-3 text-sm font-semibold">
          <option value="">Email : tous</option>
          <option value="yes">Email vérifié</option>
          <option value="no">Email non vérifié</option>
        </select>
      </div>

      {loading ? <p className="py-8 text-center text-sm text-muted-foreground" data-testid="users-loading"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Chargement…</p> : (
        <div className="space-y-2" data-testid="users-list">
          {data.items.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground" data-testid="users-empty">Aucun utilisateur.</p>}
          {data.items.map((u) => (
            <div key={u.user_id} data-testid={`user-row-${u.user_id}`} className="flex flex-wrap items-center gap-3 border border-foreground bg-card p-3">
              <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                <p className="truncate font-bold text-foreground">{u.name || "—"}</p>
                <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <Badge tone={u.role === "super_admin" ? "primary" : u.role === "admin" ? "primary" : "muted"} testid={`user-role-${u.user_id}`}>{ROLE_LABEL[u.role] || "User"}</Badge>
                  <Badge tone={u.blocked ? "danger" : "muted"} testid={`user-status-${u.user_id}`}>{u.blocked ? "Bloqué" : "Actif"}</Badge>
                  <Badge>{u.auth_provider === "google" ? "Google" : "Email"}</Badge>
                  <Badge>{u.email_verified ? "Email vérifié" : "Non vérifié"}</Badge>
                  <Badge>{(u.loyalty?.balance ?? 0)} pts</Badge>
                  {u.phone && <Badge>{u.phone}</Badge>}
                  {(u.saved_pubg_ids || []).slice(0, 2).map((id) => <Badge key={id}>PUBG {id}</Badge>)}
                </div>
              </div>
              <div className="flex w-full shrink-0 flex-wrap items-center gap-1 sm:w-auto">
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => openDetail(u)} data-testid={`user-view-${u.user_id}`}>Voir</Button>
                {u.role !== "super_admin" && (u.blocked
                  ? <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => setStatus(u, false)} data-testid={`user-unblock-${u.user_id}`}><Check className="mr-1 h-3.5 w-3.5" />Débloquer</Button>
                  : <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => setStatus(u, true)} data-testid={`user-block-${u.user_id}`}><Ban className="mr-1 h-3.5 w-3.5" />Bloquer</Button>)}
                {isSuper && u.role === "customer" && (
                  <Button size="sm" className="rounded-full" disabled={busy} onClick={() => { setGrant(u); setGrantPerms([]); }} data-testid={`user-grant-${u.user_id}`}><ShieldCheck className="mr-1 h-3.5 w-3.5" />Donner accès admin</Button>
                )}
                {isSuper && u.role === "admin" && (
                  <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => revoke(u)} data-testid={`user-revoke-${u.user_id}`}><UserCog className="mr-1 h-3.5 w-3.5" />Retirer admin</Button>
                )}
                {u.role !== "super_admin" && (
                  <Button size="icon" variant="ghost" className="rounded-full text-muted-foreground hover:text-rose-600" disabled={busy} onClick={() => remove(u)} data-testid={`user-delete-${u.user_id}`}><Trash2 className="h-4 w-4" /></Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" data-testid="users-total">{data.total} utilisateur(s)</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="rounded-full" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="users-prev">Précédent</Button>
          <span className="text-xs font-bold" data-testid="users-page">{page} / {pages}</span>
          <Button size="sm" variant="outline" className="rounded-full" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} data-testid="users-next">Suivant</Button>
        </div>
      </div>

      {/* Grant admin confirmation + permissions */}
      <Dialog open={!!grant} onOpenChange={(v) => !v && setGrant(null)}>
        <DialogContent className="border-2 border-foreground bg-background sm:max-w-md" data-testid="grant-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold">Donner accès à l'administration à cet utilisateur ?</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">{grant?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {ALL_PERMISSIONS.map((perm) => (
              <label key={perm} className="flex items-center justify-between border border-foreground bg-card px-3 py-2 text-sm font-semibold">
                {PERMISSION_LABELS[perm]}
                <Switch checked={grantPerms.includes(perm)} data-testid={`grant-perm-${perm}`}
                  onCheckedChange={(v) => setGrantPerms((cur) => (v ? [...cur, perm] : cur.filter((p) => p !== perm)))} />
              </label>
            ))}
            <p className="border border-foreground bg-primary/15 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em]" data-testid="grant-delete-note">Suppression des commandes · Super admin uniquement</p>
          </div>
          <Button className="mt-2 h-11 w-full rounded-full font-bold" disabled={busy} onClick={confirmGrant} data-testid="grant-confirm">Confirmer</Button>
        </DialogContent>
      </Dialog>

      {/* User detail */}
      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto border-2 border-foreground bg-background sm:w-full sm:max-w-lg" data-testid="user-detail">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold">{detail?.name || "—"}</DialogTitle>
            <DialogDescription className="break-all text-xs text-muted-foreground">{detail?.email}</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="border border-foreground bg-card p-3">
                <p className="eyebrow">Profil</p>
                <p>Provider : <b>{detail.auth_provider === "google" ? "Google" : "Email"}</b></p>
                <p>Téléphone : <b>{detail.phone || "—"}</b></p>
                <p>Email vérifié : <b>{detail.email_verified ? "Oui" : "Non"}</b></p>
                <p>Statut : <b data-testid="detail-status">{detail.blocked ? "Bloqué" : "Actif"}</b></p>
                <p>Rôle : <b data-testid="detail-role">{ROLE_LABEL[detail.role] || "User"}</b></p>
                <p>Inscription : <b>{(detail.created_at || "").slice(0, 10)}</b></p>
              </div>
              <div className="border border-foreground bg-card p-3">
                <p className="eyebrow">PUBG</p>
                <p>ID : <b>{(detail.saved_pubg_ids || []).join(", ") || "—"}</b></p>
                <p>Pseudo : <b>{detail.pubg_pseudo || "—"}</b></p>
              </div>
              <div className="border border-foreground bg-card p-3">
                <p className="eyebrow">Loyalty</p>
                <p>Earned : <b>{detail.loyalty?.earned ?? 0}</b> · Promo : <b>{detail.loyalty?.promo ?? 0}</b> · Balance : <b data-testid="detail-balance">{detail.loyalty?.balance ?? 0}</b></p>
              </div>
              <div className="border border-foreground bg-card p-3">
                <p className="eyebrow">Commandes</p>
                <p><b data-testid="detail-orders-count">{detail.orders_count}</b> commande(s)</p>
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {(detail.recent_orders || []).map((o) => <li key={o.order_number}>{o.order_number} · {o.status} · {formatAr(o.total || 0)}</li>)}
                </ul>
              </div>
              <div className="border border-foreground bg-card p-3">
                <p className="eyebrow">Sécurité / permissions</p>
                {detail.role === "super_admin" && <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em]">Accès complet (super admin)</p>}
                {detail.role === "customer" && <p className="mt-1 text-xs text-muted-foreground">Aucune permission administrateur.</p>}
                {detail.role === "admin" && (
                  <div className="mt-2 space-y-2">
                    {ALL_PERMISSIONS.map((perm) => (
                      <label key={perm} className="flex items-center justify-between border border-foreground bg-background px-3 py-2 text-sm font-semibold">
                        {PERMISSION_LABELS[perm]}
                        <Switch checked={(detail.permissions || []).includes(perm)} disabled={!isSuper || busy} data-testid={`perm-${perm}`}
                          onCheckedChange={(v) => togglePermission(detail, perm, v)} />
                      </label>
                    ))}
                    <p className="border border-foreground bg-primary/15 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em]" data-testid="detail-delete-note">Suppression des commandes · Super admin uniquement</p>
                    {!isSuper && <p className="text-xs text-muted-foreground">Seul le super admin peut modifier ces permissions.</p>}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
