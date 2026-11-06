import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useLang } from "@/context/LanguageContext";

const supported = () => window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const keyBytes = (key) => Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - key.length % 4) % 4)), (c) => c.charCodeAt(0));

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

export const AdminPush = () => {
  const { t, lang } = useLang();
  const [status, setStatus] = useState(null); // GET /admin/notifications/status
  const [permission, setPermission] = useState(() => (supported() ? Notification.permission : null));
  const [deviceSynced, setDeviceSynced] = useState(null); // null = inconnu, true/false = dernière synchro
  const [syncFailed, setSyncFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testFailed, setTestFailed] = useState(false);
  const [actionError, setActionError] = useState(false);
  const publicKeyRef = useRef(null);

  const loadStatus = useCallback(async () => {
    const { data } = await api.get("/admin/notifications/status");
    setStatus(data);
    return data;
  }, []);

  // Synchronisation automatique (une seule par chargement, pas de boucle) :
  // - permission granted : (ré)abonne si nécessaire puis envoie TOUJOURS
  //   l'abonnement au serveur — l'inscription est idempotente côté serveur
  //   (upsert par endpoint) et la déconnexion supprime l'abonnement serveur,
  //   donc le navigateur seul ne suffit jamais à dire « activé » ;
  // - default / denied : aucun abonnement automatique (default exige un geste).
  const resync = useCallback(async (st) => {
    setPermission(Notification.permission);
    if (Notification.permission !== "granted") return;
    if (!st) st = await loadStatus();
    if (!st?.vapid_configured) return;
    const { data: cfg } = await api.get("/admin/push/config");
    if (!cfg?.configured || !cfg.public_key) return;
    publicKeyRef.current = cfg.public_key;
    const registration = await navigator.serviceWorker.register("/sw.js");
    let sub = await registration.pushManager.getSubscription();
    if (!sub) sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.public_key) });
    await api.post("/admin/push/subscriptions", sub.toJSON());
    setDeviceSynced(true);
  }, [loadStatus]);

  const sync = useCallback(async () => {
    setSyncFailed(false);
    try {
      await resync(await loadStatus());
    } catch (_) {
      // Échec silencieux : aucun détail technique, l'état « non synchronisé »
      // et le bouton de nouvel essai suffisent.
      if (Notification.permission === "granted") setDeviceSynced(false);
      setSyncFailed(true);
    }
  }, [loadStatus, resync]);

  useEffect(() => {
    if (!supported()) return;
    sync();
  }, [sync]);

  const enable = async () => {
    setBusy(true); setActionError(false);
    try {
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== "granted") return;
      const registration = await navigator.serviceWorker.ready;
      let sub = await registration.pushManager.getSubscription();
      const key = publicKeyRef.current ? keyBytes(publicKeyRef.current) : null;
      if (key && sub && sub.options.applicationServerKey && !Array.from(new Uint8Array(sub.options.applicationServerKey)).every((v, i) => v === key[i])) {
        await api.delete("/admin/push/subscriptions", { data: { endpoint: sub.endpoint } });
        await sub.unsubscribe(); sub = null;
      }
      if (!sub) {
        const pk = key || keyBytes((await api.get("/admin/push/config")).data.public_key);
        sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pk });
      }
      await api.post("/admin/push/subscriptions", sub.toJSON());
      setDeviceSynced(true);
      setSyncFailed(false);
      loadStatus().catch(() => {});
    } catch (_) { setActionError(true); }
    finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true); setActionError(false);
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) { await api.delete("/admin/push/subscriptions", { data: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
      setDeviceSynced(false);
      loadStatus().catch(() => {});
    } catch (_) { setActionError(true); }
    finally { setBusy(false); }
  };

  // Vrai test : passe par le même chemin que les vraies alertes (tous les
  // appareils admin abonnés), résultat traduit selon status+reason uniquement.
  const runTest = async () => {
    setBusy(true); setTestResult(null); setTestFailed(false);
    try {
      const { data } = await api.post("/admin/notifications/test");
      if (data && typeof data === "object") setTestResult(data);
      else setTestFailed(true);
      loadStatus().catch(() => {});
    } catch (_) { setTestFailed(true); }
    finally { setBusy(false); }
  };

  if (!supported()) {
    // iOS 16.4+ : PushManager n'existe que dans l'app installée (mode
    // standalone) — pas de détection fragile : doute = aide neutre.
    return <section data-testid="admin-push" className="mt-4 border border-foreground bg-card p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Bell className="h-4 w-4" strokeWidth={2} />
        <p className="text-[11px] font-black uppercase tracking-[0.12em]" data-testid="push-status">
          {t("admin.push.title")}
          <span className="ml-2 inline-block border border-foreground px-1.5 py-0.5 text-[color:var(--admin-ink-muted)]">{t("admin.push.unavailable")}</span>
        </p>
      </div>
      <p data-testid="push-unsupported-help" className="mt-2 text-xs text-muted-foreground">{t("admin.push.pwaHelp")}</p>
    </section>;
  }

  const permBadge = permission === "granted" ? t("admin.push.permGranted") : permission === "denied" ? t("admin.push.permDenied") : t("admin.push.permDefault");
  const deviceBadge = deviceSynced === true ? t("admin.push.deviceKnown") : deviceSynced === false ? t("admin.push.deviceUnknown") : t("admin.push.devicePending");
  const alerts = (status?.alerts || []).slice(0, 5);
  const vapidOk = status ? !!status.vapid_configured : null;

  return <section data-testid="admin-push" className="mt-4 border border-foreground bg-card p-3">
    <div className="flex flex-wrap items-center gap-3">
      <Bell className="h-4 w-4" strokeWidth={2} />
      <p className="text-[11px] font-black uppercase tracking-[0.12em]" data-testid="push-status" aria-live="polite">
        {t("admin.push.title")}
        <span className="ml-2 inline-block border border-foreground px-1.5 py-0.5">{permBadge}</span>
        <span data-testid="push-device" className={`ml-2 inline-block border border-foreground px-1.5 py-0.5 ${deviceSynced === true ? "bg-primary text-[#0A0A0A]" : "text-[color:var(--admin-ink-muted)]"}`}>{deviceBadge}</span>
      </p>
      {syncFailed && <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={sync} data-testid="push-retry">{t("admin.push.retry")}</Button>}
      {permission !== "granted" && permission !== "denied" && <Button type="button" size="sm" className="min-h-11" disabled={busy || vapidOk === false} onClick={enable} data-testid="push-enable">{t("admin.push.activate")}</Button>}
      <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={runTest} data-testid="push-test">{t("admin.push.test")}</Button>
      {permission === "granted" && <Button type="button" size="sm" variant="ghost" className="min-h-11" disabled={busy} onClick={disable} data-testid="push-disable"><BellOff className="mr-1 h-4 w-4" />{t("admin.push.disable")}</Button>}
    </div>
    {status && <p data-testid="push-devices-count" className="mt-2 text-xs text-muted-foreground">{t("admin.push.devices", { count: status.push_subscriptions })}</p>}
    {vapidOk === false && <p data-testid="push-not-configured" className="mt-2 text-xs text-muted-foreground">{t("admin.push.vapidHelp")}</p>}
    {permission === "denied" && <p data-testid="push-denied-help" className="mt-2 text-xs text-muted-foreground">{t("admin.push.deniedHelp")}</p>}
    {(testResult || testFailed) && (
      <p role="status" data-testid="push-test-result" className="mt-2 text-sm text-muted-foreground">
        {testFailed || !testResult ? t("admin.push.testGeneric") : t(`admin.push.${testResultKey(testResult)}`, { count: testResult.sent ?? 0 })}
      </p>
    )}
    {actionError && <p role="alert" data-testid="push-error" className="mt-2 text-sm text-destructive">{t("admin.push.errorGeneric")}</p>}
    <div className="mt-3 border-t border-[color:var(--rule)] pt-2">
      <div className="flex items-center gap-2">
        <p className="eyebrow">{t("admin.push.alertsTitle")}</p>
        <button
          type="button"
          data-testid="push-refresh"
          onClick={loadStatus}
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
  </section>;
};
