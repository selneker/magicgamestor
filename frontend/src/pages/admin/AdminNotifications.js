import { AdminPushPage } from "@/components/admin/AdminPush";
import { useLang } from "@/context/LanguageContext";

// Page admin « Notifications » (PL-NOTIF-2B) : toute la configuration push
// vit ici ; le tableau de bord n'affiche plus que la pastille conditionnelle.
export default function AdminNotifications() {
  const { t } = useLang();
  return (
    <section data-testid="admin-notifications-page">
      <h2 className="mb-4 font-display text-lg font-bold">{t("admin.push.title")}</h2>
      <AdminPushPage />
    </section>
  );
}
