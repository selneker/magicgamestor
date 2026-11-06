import { useEffect, useState } from "react";
import { CalendarRange, Bell, Coins, Gamepad2, LayoutDashboard, MessageCircle, Package, PlugZap, ReceiptText, Users, Wallet } from "lucide-react";
import { api } from "@/lib/api";

// Source de vérité unique de la navigation admin (MGS-FE-ADMIN-20261105-01).
// La barre latérale desktop (AdminLayout) et la barre du bas mobile
// (AdminBottomNav) lisent toutes les deux cette liste — interdit de dupliquer
// les entrées ailleurs.
//
// Chaque entrée :
//   key           identifiant stable (testids, tests)
//   labelKey      libellé complet (sidebar desktop, menu Plus)
//   shortLabelKey libellé court minuscule (barre du bas mobile)
//   icon          composant lucide-react
//   path          route (celles de App.js — /admin[/…])
//   group         ops | shop | system (groupes de la sidebar desktop)
//   mobile        "bar" (barre du bas) | "more" (menu Plus)
//   moreOrder     ordre d'affichage dans le menu Plus
//   badgeKey      clé résolue par le consommateur ("chat" | "fzr")
//   permission    permission requise (filtrée via can())
//   end           NavLink end (correspondance exacte)
export const ADMIN_NAV = [
  { key: "dashboard", labelKey: "admin.dashboard", shortLabelKey: "admin.short.dashboard", icon: LayoutDashboard, path: "/admin", group: "ops", mobile: "bar", end: true },
  { key: "orders", labelKey: "admin.orders", shortLabelKey: "admin.short.orders", icon: ReceiptText, path: "/admin/commandes", group: "ops", mobile: "bar" },
  { key: "catalogue", labelKey: "admin.products", shortLabelKey: "admin.short.catalogue", icon: Package, path: "/admin/catalogue", group: "shop", mobile: "bar" },
  { key: "payments", labelKey: "admin.paymentsTitle", shortLabelKey: "admin.paymentsTitle", icon: Wallet, path: "/admin/paiements", group: "ops", mobile: "more", moreOrder: 3 },
  { key: "chat", labelKey: "admin.chat", shortLabelKey: "admin.short.chat", icon: MessageCircle, path: "/admin/messages", group: "ops", mobile: "bar", badgeKey: "chat" },
  { key: "games", labelKey: "admin.games", shortLabelKey: "admin.games", icon: Gamepad2, path: "/admin/jeux", group: "shop", mobile: "more", moreOrder: 1 },
  { key: "fournisseur", labelKey: "admin.fzr.tab", shortLabelKey: "admin.fzr.tab", icon: PlugZap, path: "/admin/fournisseur", group: "system", mobile: "more", moreOrder: 2, badgeKey: "fzr" },
  { key: "events", labelKey: "admin.events", shortLabelKey: "admin.events", icon: CalendarRange, path: "/admin/evenements", group: "shop", mobile: "more", moreOrder: 4 },
  { key: "loyalty", labelKey: "admin.loyalty", shortLabelKey: "admin.loyalty", icon: Coins, path: "/admin/fidelite", group: "shop", mobile: "more", moreOrder: 5 },
  { key: "users", labelKey: "admin.users", shortLabelKey: "admin.users", icon: Users, path: "/admin/utilisateurs", group: "system", mobile: "more", moreOrder: 6, permission: "users.manage" },
  { key: "notifications", labelKey: "admin.push.title", shortLabelKey: "admin.push.title", icon: Bell, path: "/admin/notifications", group: "system", mobile: "more", moreOrder: 7 },
];

// Groupes de la sidebar desktop, dans l'ordre d'affichage.
export const ADMIN_NAV_GROUPS = [
  { key: "ops", labelKey: "admin.group.ops" },
  { key: "shop", labelKey: "admin.group.shop" },
  { key: "system", labelKey: "admin.group.system" },
];

// Filtre selon les permissions (can() vient d'AuthContext).
export const adminNavVisible = (can) => ADMIN_NAV.filter((e) => !e.permission || can(e.permission));

// Barre du bas mobile : entrées mobile:"bar", dans l'ordre du tableau.
export const adminBarItems = (can) => adminNavVisible(can).filter((e) => e.mobile === "bar");

// Menu Plus : tout ce qui n'est pas dans la barre, ordonné par moreOrder.
export const adminMoreItems = (can) =>
  adminNavVisible(can)
    .filter((e) => e.mobile === "more")
    .sort((a, b) => (a.moreOrder ?? 99) - (b.moreOrder ?? 99));

// Sidebar desktop : groupes avec leurs entrées, dans l'ordre du tableau.
export const adminSidebarGroups = (can) =>
  ADMIN_NAV_GROUPS.map((g) => ({ ...g, items: adminNavVisible(can).filter((e) => e.group === g.key) }));

// Valeur de badge d'une entrée à partir des compteurs du consommateur.
export const adminBadge = (entry, counts = {}) => (entry.badgeKey ? counts[entry.badgeKey] || 0 : 0);

// Compteur d'alertes FazerCards (badge « Fournisseur »). AdminLayout et
// AdminBottomNav sont des composants frères : chacun appelle ce hook (un GET
// léger par montage, paramètre limit=1).
export function useFzrAlerts() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    api.get("/admin/fazercards/price-alerts", { params: { limit: 1 } })
      .then((r) => setCount(r.data.unacknowledged))
      .catch(() => {});
  }, []);
  return count;
}
