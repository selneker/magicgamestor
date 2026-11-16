import { useCallback, useEffect, useState } from "react";
import { Ban, Check, Loader2, Search, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, formatAr } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/context/LanguageContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ALL_PERMISSIONS = [
  "users.manage",
  "orders.manage",
  "loyalty.manage",
  "catalog.manage",
  "events.manage",
  "chat.manage",
];

export default function AdminUsers() {
  const { user: me } = useAuth();
  const { t, lang } = useLang();
  const isSuper = me?.role === "super_admin";
  const [data, setData] = useState({ items: [], total: 0, page: 1, page_size: 20 });
  const [filters, setFilters] = useState({ search: "", role: "", status: "", email_verified: "" });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [grant, setGrant] = useState(null);
  const [grantPerms, setGrantPerms] = useState([]);
  const [busy, setBusy] = useState(false);

  const permLabel = (key) => t(`admin.userMgmt.perm.${key}`);
  const roleLabel = (key) => t(`admin.userMgmt.role.${key}`) || t("admin.userMgmt.role.customer");

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
      toast.success(blocked ? t("admin.userMgmt.blocked") : t("admin.userMgmt.unblocked"));
      if (detail?.user_id === u.user_id) openDetail(u);
      load();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const confirmGrant = async () => {
    setBusy(true);
    try {
      await api.patch(`/admin/users/${grant.user_id}/role`, { role: "admin", permissions: grantPerms });
      toast.success(t("admin.userMgmt.accessGranted"));
      setGrant(null); setGrantPerms([]); load();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const revoke = async (u) => {
    if (!window.confirm(t("admin.userMgmt.revokeConfirm"))) return;
    setBusy(true);
    try { await api.patch(`/admin/users/${u.user_id}/role`, { role: "customer" }); toast.success(t("admin.userMgmt.accessRevoked")); setDetail(null); load(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const togglePermission = async (u, perm, enabled) => {
    const next = enabled ? [...(u.permissions || []), perm] : (u.permissions || []).filter((p) => p !== perm);
    if (!window.confirm(t("admin.userMgmt.permissionsConfirm", { name: u.name || u.email }))) return;
    setBusy(true);
    try {
      const { data: updated } = await api.patch(`/admin/users/${u.user_id}/permissions`, { permissions: next });
      setDetail((d) => (d ? { ...d, permissions: updated.permissions } : d));
      toast.success(t("admin.userMgmt.permissionsSaved"));
      load();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const remove = async (u) => {
    if (!window.confirm(t("admin.userMgmt.deleteConfirm"))) return;
    setBusy(true);
    try { await api.delete(`/admin/users/${u.user_id}`); toast.success(t("admin.userMgmt.accountAnonymized")); setDetail(null); load(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const pages = Math.max(1, Math.ceil(data.total / (data.page_size || 20)));

  return (
    <div className="space-y-4" data-testid="admin-users">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
          <Input data-testid="users-search" value={filters.search} placeholder={t("admin.userMgmt.searchPlaceholder")}
            onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, search: e.target.value })); }} className="h-11 rounded-xl pl-9" />
        </div>
        <select data-testid="users-filter-role" value={filters.role} onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, role: e.target.value })); }} className="h-11 border border-foreground bg-card px-3 text-sm font-semibold">
          <option value="">{t("admin.userMgmt.filterRoleAll")}</option>
          <option value="customer">{t("admin.userMgmt.filterRoleCustomer")}</option>
          <option value="admin">{t("admin.userMgmt.filterRoleAdmin")}</option>
          <option value="super_admin">{t("admin.userMgmt.filterRoleSuperAdmin")}</option>
        </select>
        <select data-testid="users-filter-status" value={filters.status} onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, status: e.target.value })); }} className="h-11 border border-foreground bg-card px-3 text-sm font-semibold">
          <option value="">{t("admin.userMgmt.filterStatusAll")}</option>
          <option value="active">{t("admin.userMgmt.filterStatusActive")}</option>
          <option value="blocked">{t("admin.userMgmt.filterStatusBlocked")}</option>
        </select>
        <select data-testid="users-filter-verified" value={filters.email_verified} onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, email_verified: e.target.value })); }} className="h-11 border border-foreground bg-card px-3 text-sm font-semibold">
          <option value="">{t("admin.userMgmt.filterVerifiedAll")}</option>
          <option value="yes">{t("admin.userMgmt.filterVerifiedYes")}</option>
          <option value="no">{t("admin.userMgmt.filterVerifiedNo")}</option>
        </select>
      </div>

      {loading ? <p className="py-8 text-center text-sm text-muted-foreground" data-testid="users-loading"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />{t("common.loading")}</p> : (
        <div className="space-y-2" data-testid="users-list">
          {data.items.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground" data-testid="users-empty">{t("admin.userMgmt.empty")}</p>}
          {data.items.map((u) => (
            <div key={u.user_id} data-testid={`user-row-${u.user_id}`} className="flex flex-wrap items-center gap-3 border border-foreground bg-card p-3">
              <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                <p className="truncate font-bold text-foreground">{u.name || t("account.pubgCard.placeholder")}</p>
                <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <Badge tone={u.role === "super_admin" ? "primary" : u.role === "admin" ? "primary" : "muted"} testid={`user-role-${u.user_id}`}>{roleLabel(u.role)}</Badge>
                  <Badge tone={u.blocked ? "danger" : "muted"} testid={`user-status-${u.user_id}`}>{u.blocked ? t("admin.userMgmt.filterStatusBlocked") : t("admin.userMgmt.filterStatusActive")}</Badge>
                  <Badge>{u.auth_provider === "google" ? t("admin.userMgmt.detailProvider") : t("admin.userMgmt.detailPhone")}</Badge>
                  <Badge>{u.email_verified ? t("admin.userMgmt.filterVerifiedYes") : t("admin.userMgmt.filterVerifiedNo")}</Badge>
                  <Badge>{(u.loyalty?.balance ?? 0)} pts</Badge>
                  {u.phone && <Badge>{u.phone}</Badge>}
                  {(u.saved_pubg_ids || []).slice(0, 2).map((id) => <Badge key={id}>PUBG {id}</Badge>)}
                </div>
              </div>
              <div className="flex w-full shrink-0 flex-wrap items-center gap-1 sm:w-auto">
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => openDetail(u)} data-testid={`user-view-${u.user_id}`}>{t("admin.userMgmt.view")}</Button>
                {u.role !== "super_admin" && (u.blocked
                  ? <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => setStatus(u, false)} data-testid={`user-unblock-${u.user_id}`}><Check className="mr-1 h-3.5 w-3.5" />{t("admin.userMgmt.unblock")}</Button>
                  : <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => setStatus(u, true)} data-testid={`user-block-${u.user_id}`}><Ban className="mr-1 h-3.5 w-3.5" />{t("admin.userMgmt.block")}</Button>)}
                {isSuper && u.role === "customer" && (
                  <Button size="sm" className="rounded-full" disabled={busy} onClick={() => { setGrant(u); setGrantPerms([]); }} data-testid={`user-grant-${u.user_id}`}><ShieldCheck className="mr-1 h-3.5 w-3.5" />{t("admin.userMgmt.grantAccess")}</Button>
                )}
                {isSuper && u.role === "admin" && (
                  <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => revoke(u)} data-testid={`user-revoke-${u.user_id}`}><UserCog className="mr-1 h-3.5 w-3.5" />{t("admin.userMgmt.revokeAccess")}</Button>
                )}
                {u.role !== "super_admin" && (
                  <Button size="icon" variant="ghost" className="rounded-full text-muted-foreground hover:text-rose-600" disabled={busy} aria-label={t("admin.delete")} onClick={() => remove(u)} data-testid={`user-delete-${u.user_id}`}><Trash2 className="h-4 w-4" /></Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" data-testid="users-total">{t("admin.userMgmt.total", { count: data.total })}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="rounded-full" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="users-prev">{t("common.previous")}</Button>
          <span className="text-xs font-bold" data-testid="users-page">{page} / {pages}</span>
          <Button size="sm" variant="outline" className="rounded-full" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} data-testid="users-next">{t("common.next")}</Button>
        </div>
      </div>

      {/* Grant admin confirmation + permissions */}
      <Dialog open={!!grant} onOpenChange={(v) => !v && setGrant(null)}>
        <DialogContent className="border-2 border-foreground bg-background sm:max-w-md" data-testid="grant-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold">{t("admin.userMgmt.grantDialogTitle")}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">{grant?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {ALL_PERMISSIONS.map((perm) => (
              <label key={perm} className="flex items-center justify-between border border-foreground bg-card px-3 py-2 text-sm font-semibold">
                {permLabel(perm)}
                <Switch checked={grantPerms.includes(perm)} data-testid={`grant-perm-${perm}`}
                  onCheckedChange={(v) => setGrantPerms((cur) => (v ? [...cur, perm] : cur.filter((p) => p !== perm)))} />
              </label>
            ))}
            <p className="border border-foreground bg-primary/15 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em]" data-testid="grant-delete-note">{t("admin.userMgmt.grantDeleteNote")}</p>
          </div>
          <Button className="mt-2 h-11 w-full rounded-full font-bold" disabled={busy} onClick={confirmGrant} data-testid="grant-confirm">{t("common.confirm")}</Button>
        </DialogContent>
      </Dialog>

      {/* User detail */}
      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto border-2 border-foreground bg-background sm:w-full sm:max-w-lg" data-testid="user-detail">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold">{detail?.name || t("account.pubgCard.placeholder")}</DialogTitle>
            <DialogDescription className="break-all text-xs text-muted-foreground">{detail?.email}</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="border border-foreground bg-card p-3">
                <p className="eyebrow">{t("admin.userMgmt.detailProvider")}</p>
                <p>{t("admin.userMgmt.detailProvider")} : <b>{detail.auth_provider === "google" ? t("admin.userMgmt.detailProvider") : t("admin.userMgmt.detailPhone")}</b></p>
                <p>{t("admin.userMgmt.detailPhone")} : <b>{detail.phone || t("account.pubgCard.placeholder")}</b></p>
                <p>{t("admin.userMgmt.detailEmailVerified")} : <b>{detail.email_verified ? t("admin.userMgmt.filterVerifiedYes") : t("admin.userMgmt.filterVerifiedNo")}</b></p>
                <p>{t("admin.userMgmt.detailStatus")} : <b data-testid="detail-status">{detail.blocked ? t("admin.userMgmt.filterStatusBlocked") : t("admin.userMgmt.filterStatusActive")}</b></p>
                <p>{t("admin.userMgmt.detailRole")} : <b data-testid="detail-role">{roleLabel(detail.role)}</b></p>
                <p>{t("admin.userMgmt.detailRegistered")} : <b>{(detail.created_at || "").slice(0, 10)}</b></p>
              </div>
              <div className="border border-foreground bg-card p-3">
                <p className="eyebrow">PUBG</p>
                <p>{t("admin.userMgmt.detailPubgId")} : <b>{(detail.saved_pubg_ids || []).join(", ") || t("account.pubgCard.placeholder")}</b></p>
                <p>{t("admin.userMgmt.detailPubgPseudo")} : <b>{detail.pubg_pseudo || t("account.pubgCard.placeholder")}</b></p>
              </div>
              <div className="border border-foreground bg-card p-3">
                <p className="eyebrow">{t("admin.userMgmt.detailOrders")}</p>
                <p>{t("admin.userMgmt.detailEarned")} : <b>{detail.loyalty?.earned ?? 0}</b> · {t("admin.userMgmt.detailPromo")} : <b>{detail.loyalty?.promo ?? 0}</b> · {t("admin.userMgmt.detailBalance")} : <b data-testid="detail-balance">{detail.loyalty?.balance ?? 0}</b></p>
              </div>
              <div className="border border-foreground bg-card p-3">
                <p className="eyebrow">{t("admin.userMgmt.detailOrders")}</p>
                <p><b data-testid="detail-orders-count">{detail.orders_count}</b> {t("admin.userMgmt.detailOrdersCount", { count: detail.orders_count })}</p>
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {(detail.recent_orders || []).map((o) => <li key={o.order_number}>{o.order_number} · {o.status} · {formatAr(o.total || 0, lang)}</li>)}
                </ul>
              </div>
              <div className="border border-foreground bg-card p-3">
                <p className="eyebrow">{t("admin.userMgmt.detailOrders")}</p>
                {detail.role === "super_admin" && <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em]">{t("admin.userMgmt.detailFullAccess")}</p>}
                {detail.role === "customer" && <p className="mt-1 text-xs text-muted-foreground">{t("admin.userMgmt.detailNoPermissions")}</p>}
                {detail.role === "admin" && (
                  <div className="mt-2 space-y-2">
                    {ALL_PERMISSIONS.map((perm) => (
                      <label key={perm} className="flex items-center justify-between border border-foreground bg-background px-3 py-2 text-sm font-semibold">
                        {permLabel(perm)}
                        <Switch checked={(detail.permissions || []).includes(perm)} disabled={!isSuper || busy} data-testid={`perm-${perm}`}
                          onCheckedChange={(v) => togglePermission(detail, perm, v)} />
                      </label>
                    ))}
                    <p className="border border-foreground bg-primary/15 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em]" data-testid="detail-delete-note">{t("admin.userMgmt.grantDeleteNote")}</p>
                    {!isSuper && <p className="text-xs text-muted-foreground">{t("admin.userMgmt.detailOnlySuperAdmin")}</p>}
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
