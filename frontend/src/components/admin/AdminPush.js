import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";

const supported = () => window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const keyBytes = (key) => Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - key.length % 4) % 4)), (c) => c.charCodeAt(0));

export const AdminPush = () => {
  const [config, setConfig] = useState(null);
  const [state, setState] = useState("non activées");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  useEffect(() => {
    if (!supported()) return;
    let active = true;
    const load = async () => {
      try {
        const { data } = await api.get("/admin/push/config");
        const registration = await navigator.serviceWorker.register("/sw.js");
        const sub = await registration.pushManager.getSubscription();
        const registered = sub ? (await api.post("/admin/push/status", { endpoint: sub.endpoint })).data.registered : false;
        if (active) {
          setConfig(data);
          setState(Notification.permission === "denied" ? "refusées" : registered && sub && Notification.permission === "granted" ? "activées" : "non activées");
          setError("");
        }
      } catch (e) { if (active) setError(errorMessage(e)); }
    };
    load();
    window.addEventListener("focus", load);
    return () => { active = false; window.removeEventListener("focus", load); };
  }, []);

  const enable = async () => {
    setBusy(true); setError(""); setInfo("");
    try {
      // Permission is requested only inside this explicit admin click, before network awaits.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "refusées" : "non activées"); return; }
      const registration = await navigator.serviceWorker.ready;
      let sub = await registration.pushManager.getSubscription();
      const key = keyBytes(config.public_key);
      if (sub && sub.options.applicationServerKey && !Array.from(new Uint8Array(sub.options.applicationServerKey)).every((v, i) => v === key[i])) {
        await api.delete("/admin/push/subscriptions", { data: { endpoint: sub.endpoint } });
        await sub.unsubscribe(); sub = null;
      }
      sub = sub || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api.post("/admin/push/subscriptions", sub.toJSON());
      setState("activées");
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setError(""); setInfo("");
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (!sub) { setState("non activées"); return; }
      await api.post("/admin/push/test", { endpoint: sub.endpoint });
      setInfo("Notification envoyée au service Push. Vérifiez les notifications de votre appareil.");
    } catch (e) { setError(errorMessage(e)); if ([404, 410].includes(e.response?.status)) setState("non activées"); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true); setError(""); setInfo("");
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) { await api.delete("/admin/push/subscriptions", { data: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
      setState("non activées");
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return <section data-testid="admin-push" className="mt-4 border border-foreground bg-card p-3">
    <div className="flex flex-wrap items-center gap-3">
      <Bell className="h-4 w-4" strokeWidth={2} />
      <p className="text-[11px] font-black uppercase tracking-[0.12em]" data-testid="push-status" aria-live="polite">
        Notifications
        <span className={`ml-2 inline-block border border-foreground px-1.5 py-0.5 ${state === "activées" ? "bg-primary text-[#0A0A0A]" : "text-muted-foreground"}`}>{supported() ? state : "non disponibles"}</span>
      </p>
      {supported() && state !== "activées" && <Button type="button" size="sm" disabled={busy || !config?.configured || state === "refusées"} onClick={enable} data-testid="push-enable">Activer</Button>}
      {state === "activées" && <>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={test} data-testid="push-test">Tester</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={disable} data-testid="push-disable"><BellOff className="mr-1 h-4 w-4" />Désactiver</Button>
      </>}
    </div>
    {config && !config.configured && <p data-testid="push-not-configured" className="mt-2 text-xs text-muted-foreground">Configuration VAPID requise sur le serveur.</p>}
    {state === "refusées" && <p data-testid="push-denied-help" className="mt-2 text-xs text-muted-foreground">Autorisez les notifications dans les réglages du site de votre navigateur, puis revenez ici.</p>}
    {!supported() && <p data-testid="push-unsupported-help" className="mt-2 text-xs text-muted-foreground">Utilisez un navigateur compatible en HTTPS. Sur iPhone/iPad (iOS 16.4+), ajoutez d’abord le site à l’écran d’accueil.</p>}
    {error && <p role="alert" data-testid="push-error" className="mt-2 text-sm text-rose-600">{error}</p>}
    {info && <p role="status" data-testid="push-info" className="mt-2 text-sm text-muted-foreground">{info}</p>}
  </section>;
};
