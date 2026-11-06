import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, BellOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useLang } from "@/context/LanguageContext";
import { usePushSync, pushSync, pushSupported } from "@/lib/pushSync";

// PL-NOTIF-2B : la logique (synchro, enable/disable, test) vit dans
// lib/pushSync.js. Ce fichier n'est que de la présentation, sous deux formes :
//  - AdminPushPage  : la page /admin/notifications (état complet + journal) ;
//  - AdminPushBadge : pastille discrète du tableau de bord, seulement s'il y a
//    un problème, qui renvoie vers la page.

// Traduction par branches : on ne lit que `status` + `reason` du serveur,
// jamais un texte serveur (affiché brut interdit).
const TEST_REASON_KEY = {
  no_subscription: "reasonNoSub",
  vapid_not_configured: "reasonVapid",
  subscription_gone: "reasonGone",
  send_error: "reasonSendError",
  timeout: "reasonTimeout",
  duplicate: "reasonDuplicate",
  unknown_event: "reasonUnknownEvent",
};
const EVENT_KEY = { order_created: "eventOrder", chat_message: "eventChat", test: "eventTest" };
const STATUS_KEY = { sent: "statusSent", failed: "statusFailed", skipped: "statusSkipped", pending: "statusPending" };

// Pure : clé de traduction du résultat du test selon status+reason.
// Toute forme inattendue → message générique.
export const testResultKey = (result) => {
  if (!result || typeof result !== "object") return "testGeneric";
  if (result.status === "sent") return "testSent";
  if (result.status === "skipped" && result.reason === "no_subscription") return "testNoSubscription";
  if (result.status === "skipped" && result.reason === "vapid_not_configured") return "testVapidMissing";
  if (result.status === "failed" && result.reason === "subscription_gone") return "testSubscriptionGone";
  if (result.status === "failed" && result.reason === "timeout") return "testTimeout";
  if (result.status === "failed") return "testSendError";
  return "testGeneric";
};

// Texte lisible du résultat de la dernière synchronisation (page seule).
const SYNC_CATS = ["vapid", "auth", "invalid", "network", "sw", "http", "none"];
export const syncResultText = (sync, t) => {
  if (!sync || sync.state === "idle") return t("admin.push.syncNone");
  if (sync.state === "ok") return t("admin.push.syncOk");
  const cause = t(`admin.push.cat_${SYNC_CATS.includes(sync.cat) ? sync.cat : "none"}`);
  return sync.code != null ? t("admin.push.syncFail", { cause, code: sync.code }) : t("admin.push.syncFailNoCode", { cause });
};

const Unsupported = ({ t }) => (
  // iOS 16.4+ : PushManager n'existe que dans l'app installée (mode
  // standalone) — pas de détection fragile : doute = aide neutre.
  <section data-testid="admin-push" className="border border-foreground bg-card p-3">
    <div className="flex flex-wrap items-center gap-3">
      <Bell className="h-4 w-4" strokeWidth={2} />
      <p className="text-[11px] font-black uppercase tracking-[0.12em]" data-testid="push-status">
        {t("admin.push.title")}
        <span className="ml-2 inline-block border border-foreground px-1.5 py-0.5 text-[color:var(--admin-ink-muted)]">{t("admin.push.unavailable")}</span>
      </p>
    </div>
    <p data-testid="push-unsupported-help" className="mt-2 text-xs text-muted-foreground">{t("admin.push.pwaHelp")}</p>
  </section>
);

export const AdminPushPage = () => {
  const { t, lang } = useLang();
  const s = usePushSync();
  const [alertsOpen, setAlertsOpen] = useState(false);
  useEffect(() => {
    pushSync.ensureStarted();
  }, []);

  if (!pushSupported()) return <Unsupported t={t} />;

  const permBadge = s.permission === "granted" ? t("admin.push.permGranted") : s.permission === "denied" ? t("admin.push.permDenied") : t("admin.push.permDefault");
  const deviceBadge = s.deviceSynced === true ? t("admin.push.deviceKnown") : s.deviceSynced === false ? t("admin.push.deviceUnknown") : t("admin.push.devicePending");
  const alerts = (s.status?.alerts || []).slice(0, 5);
  const vapidOk = s.status ? !!s.status.vapid_configured : null;
  const switchOn = s.permission === "granted" && s.deviceSynced === true && !s.off;

  return (
    <section data-testid="admin-push" className="border border-foreground bg-card p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Bell className="h-4 w-4" strokeWidth={2} />
        <p className="text-[11px] font-black uppercase tracking-[0.12em]" data-testid="push-status" aria-live="polite">
          {t("admin.push.title")}
          <span className="ml-2 inline-block border border-foreground px-1.5 py-0.5">{permBadge}</span>
          <span data-testid="push-device" className={`ml-2 inline-block border border-foreground px-1.5 py-0.5 ${s.deviceSynced === true ? "bg-primary text-ink" : "text-[color:var(--admin-ink-muted)]"}`}>{deviceBadge}</span>
        </p>
        {s.sync.state === "failed" && (
          <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={s.syncing || s.busy} onClick={pushSync.syncNow} data-testid="push-retry">
            {t("admin.push.retry")}
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={s.busy || s.syncing} onClick={pushSync.runTest} data-testid="push-test">
          {t("admin.push.test")}
        </Button>
      </div>

      {/* Interrupteur : activation = demande de permission + abonnement + envoi ;
          désactivation = suppression serveur + locale. `off` distingue le choix
          volontaire d'un appareil « non synchronisé ». */}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-[color:var(--rule)] pt-1">
        <label htmlFor="push-switch" className="flex min-h-11 flex-1 cursor-pointer items-center text-sm font-semibold">
          {switchOn ? t("admin.push.switchOn") : t("admin.push.switchOff")}
        </label>
        <Switch
          id="push-switch"
          data-testid="push-switch"
          checked={switchOn}
          disabled={s.busy}
          onCheckedChange={(v) => (v ? pushSync.enable() : pushSync.disable())}
        />
      </div>

      {/* Résultat de la dernière synchronisation : page seule, avec la catégorie
          en toutes lettres et le code HTTP quand il existe. */}
      <p data-testid="push-sync-result" aria-live="polite" className="mt-2 text-xs text-muted-foreground">
        <span className="font-semibold">{t("admin.push.syncTitle")}</span> : {syncResultText(s.sync, t)}
      </p>

      {s.status && <p data-testid="push-devices-count" className="mt-1 text-xs text-muted-foreground">{t("admin.push.devices", { count: s.status.push_subscriptions })}</p>}
      {vapidOk === false && <p data-testid="push-not-configured" className="mt-1 text-xs text-muted-foreground">{t("admin.push.vapidHelp")}</p>}
      {s.permission === "denied" && <p data-testid="push-denied-help" className="mt-1 text-xs text-muted-foreground">{t("admin.push.deniedHelp")}</p>}
      {(s.testResult || s.testFailed) && (
        <p role="status" data-testid="push-test-result" className="mt-2 text-sm text-muted-foreground">
          {s.testFailed || !s.testResult ? t("admin.push.testGeneric") : t(`admin.push.${testResultKey(s.testResult)}`, { count: s.testResult.sent ?? 0 })}
        </p>
      )}
      {s.actionError && <p role="alert" data-testid="push-error" className="mt-2 text-sm text-destructive">{t("admin.push.errorGeneric")}</p>}

      {/* Journal replié par défaut : la page reste sobre, les alertes se
          ouvrent à la demande avec leur bouton d'actualisation. */}
      <div className="mt-3 border-t border-[color:var(--rule)] pt-1">
        <button
          type="button"
          data-testid="push-alerts-toggle"
          aria-expanded={alertsOpen}
          onClick={() => setAlertsOpen((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground"
        >
          {alertsOpen ? t("admin.push.alertsHide") : t("admin.push.alertsShow")}
          <RefreshCw className={`h-3.5 w-3.5 transition-transform ${alertsOpen ? "rotate-180" : ""}`} strokeWidth={2} />
        </button>
        {alertsOpen && (
          <div className="mt-2">
            <div className="flex items-center gap-2">
              <p className="eyebrow">{t("admin.push.alertsTitle")}</p>
              <button
                type="button"
                data-testid="push-refresh"
                onClick={pushSync.refreshStatus}
                className="ml-auto flex min-h-11 items-center gap-1.5 rounded-[10px] px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
                {t("admin.push.refresh")}
              </button>
            </div>
            {alerts.length === 0
              ? <p data-testid="push-alerts-empty" className="text-xs text-muted-foreground">{t("admin.push.alertsEmpty")}</p>
              : <ul data-testid="push-alerts" className="mt-1 space-y-1">
                  {alerts.map((a, i) => (
                    <li key={a._id || i} data-testid="push-alert" className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span className="num text-muted-foreground">{new Date(a.created_at).toLocaleString(lang === "en" ? "en-GB" : "fr-FR")}</span>
                      <span className="font-semibold">{t(`admin.push.${EVENT_KEY[a.event] || "eventOther"}`)}</span>
                      <span>{t(`admin.push.${STATUS_KEY[a.status] || "statusFailed"}`)}</span>
                      <span className="text-muted-foreground">{a.reason ? t(`admin.push.${TEST_REASON_KEY[a.reason] || "reasonOther"}`) : t("admin.push.reasonNone")}</span>
                    </li>
                  ))}
                </ul>}
          </div>
        )}
      </div>
    </section>
  );
};

// Pastille du tableau de bord : rien quand tout va bien (ou quand l'admin a
// volontairement désactivé via l'interrupteur), sinon cloche + libellé court
// en couleur d'alerte (jeton --destructive), renvoyant vers la page.
export const AdminPushBadge = () => {
  const { t } = useLang();
  const s = usePushSync();
  useEffect(() => {
    pushSync.ensureStarted();
  }, []);

  const problem =
    pushSupported() &&
    !s.off &&
    (s.permission === "default" ||
      s.permission === "denied" ||
      s.deviceSynced === false ||
      s.sync.state === "failed" ||
      (s.deviceSynced === true && s.status?.push_subscriptions === 0));

  if (!problem) return null;
  return (
    <Link
      to="/admin/notifications"
      data-testid="admin-push-badge"
      aria-label={t("admin.push.badgeShort")}
      className="flex min-h-11 items-center gap-1.5 self-start rounded-[10px] border border-destructive px-3 text-[11px] font-black uppercase tracking-[0.12em] text-destructive transition-colors hover:bg-muted"
    >
      <Bell className="h-4 w-4 shrink-0" strokeWidth={2} />
      <span>{t("admin.push.badgeShort")}</span>
    </Link>
  );
};
