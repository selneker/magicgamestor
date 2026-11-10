import { useEffect, useState } from "react";
import { ImageOff, Maximize2, ReceiptText } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// PL-CHK-2 — section « Preuves » du détail de commande admin : vignettes des
// captures envoyées par le client. Les images ne sont JAMAIS exposées par une
// URL publique : chaque vignette est un GET authentifié par cookies
// (l'instance `api` existante) vers /admin/orders/{id}/proofs/{index}, converti
// en URL d'objet locale (libérée au démontage), et l'agrandisseur re-télécharge
// une version pleine résolution dont l'URL d'objet est libérée à la fermeture.
// 410 = preuve purgée après 7 jours ; 404/503/502 = indisponible — la page ne
// casse pas : la vignette est remplacée par un état d'erreur explicite.

const errorKind = (status) => (status === 410 ? "gone" : "unavailable");

export function OrderProofs({ order }) {
  const { t, lang } = useLang();
  const proofs = order.payment_proofs || [];
  const [thumbs, setThumbs] = useState({}); // index -> { url | error }
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(null); // { url, error, loading }

  // Chargement des vignettes (séquentiel, ordre stable), libération au démontage.
  useEffect(() => {
    let stop = false;
    const urls = [];
    (async () => {
      for (let i = 0; i < proofs.length; i++) {
        try {
          const { data } = await api.get(`/admin/orders/${encodeURIComponent(order.id)}/proofs/${i}`, { responseType: "blob" });
          const url = URL.createObjectURL(data);
          urls.push(url);
          if (stop) { URL.revokeObjectURL(url); return; }
          setThumbs((s) => ({ ...s, [i]: { url } }));
        } catch (e) {
          if (stop) return;
          setThumbs((s) => ({ ...s, [i]: { error: errorKind(e?.response?.status) } }));
        }
      }
      if (!stop) setLoading(false);
    })();
    return () => { stop = true; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [order.id, proofs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (proofs.length === 0) return null;

  // Agrandisseur : blob dédié, libéré à la fermeture.
  const openZoom = async (i) => {
    setZoom({ loading: true });
    try {
      const { data } = await api.get(`/admin/orders/${encodeURIComponent(order.id)}/proofs/${i}`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      setZoom({ url }); // libéré dans closeZoom
    } catch (e) {
      setZoom({ error: errorKind(e?.response?.status) });
    }
  };
  const closeZoom = () => {
    if (zoom?.url) URL.revokeObjectURL(zoom.url);
    setZoom(null);
  };

  const sizeText = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} ${lang === "en" ? "MB" : "Mo"}` : `${Math.max(1, Math.round(bytes / 1024))} ${lang === "en" ? "KB" : "Ko"}`);

  return (
    <section className="lg:col-span-3" data-testid="admin-proofs">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground"><ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />{t("admin.proofs")}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {proofs.map((p, i) => {
          const th = thumbs[i];
          return (
            <li key={i} className="text-xs text-muted-foreground" data-testid={`admin-proof-${i}`}>
              {th?.url ? (
                <button
                  type="button"
                  onClick={() => openZoom(i)}
                  aria-label={t("admin.proofOpen")}
                  className="group relative block h-20 w-20 overflow-hidden rounded-[10px] border border-[color:var(--rule)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-foreground">
                  <img src={th.url} alt={t("admin.proofMeta", { date: new Date(p.uploaded_at).toLocaleString(lang === "en" ? "en-GB" : "fr-FR") })} className="h-full w-full object-cover" />
                  <span className="absolute inset-0 hidden items-center justify-center bg-black/40 group-hover:flex"><Maximize2 className="h-5 w-5 text-white" aria-hidden="true" /></span>
                </button>
              ) : (
                <span className={`flex h-20 w-20 items-center justify-center rounded-[10px] border border-[color:var(--rule)] bg-muted ${th?.error ? "text-muted-foreground" : ""}`}>
                  {loading && !th
                    ? <span className="h-4 w-4 animate-pulse rounded bg-card" aria-hidden="true" />
                    : <ImageOff className="h-5 w-5" aria-hidden="true" />}
                </span>
              )}
              <p className="mt-1 w-20 leading-tight">
                {th?.error ? (
                  th.error === "gone" ? <span data-testid={`admin-proof-gone-${i}`}>{t("admin.proofGone")}</span> : <span data-testid={`admin-proof-unavailable-${i}`}>{t("admin.proofUnavailableAdmin")}</span>
                ) : (
                  <span data-testid={`admin-proof-meta-${i}`}>{new Date(p.uploaded_at).toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR")} · {sizeText(p.size)}</span>
                )}
              </p>
            </li>
          );
        })}
      </ul>

      <Dialog open={!!zoom} onOpenChange={(o) => { if (!o) closeZoom(); }}>
        <DialogContent className="max-w-lg sm:max-w-2xl">
          <DialogTitle className="sr-only">{t("admin.proofOpen")}</DialogTitle>
          <div className="flex items-center justify-center" data-testid="admin-proof-zoom">
            {zoom?.loading && <span className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" aria-hidden="true" />}
            {zoom?.url && <img src={zoom.url} alt={t("admin.proofOpen")} className="max-h-[70svh] w-full rounded-[10px] object-contain" />}
            {zoom?.error && (
              <p className="py-10 text-center text-sm font-semibold text-muted-foreground" role="alert">
                {zoom.error === "gone" ? t("admin.proofGone") : t("admin.proofUnavailableAdmin")}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
