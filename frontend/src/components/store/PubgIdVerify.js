import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";

// `checkout` = 4-step checkout presentation (same FazerCards call, same states).
export const PubgIdVerify = ({ pubgId, onVerified, autoTrigger = 0, checkout = false, initial = null }) => {
  const { t } = useLang();
  const [state, setState] = useState(initial ? { status: "valid", name: initial.name } : { status: "idle" });
  const first = useRef(!!initial);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setState({ status: "idle" }); onVerified(null);
  }, [pubgId, onVerified]);

  const verify = async () => {
    const id = (pubgId || "").trim();
    if (!/^\d{9,13}$/.test(id)) return setState({ status: "invalid" });
    setState({ status: "loading" });
    try {
      const { data } = await api.post("/fazercards/pubg/validate-id", { player_id: id });
      if (data.valid) {
        setState({ status: "valid", name: data.player_name });
        onVerified({ name: data.player_name || null });
      } else {
        setState({ status: "invalid" });
      }
    } catch (e) {
      const code = e?.response?.status;
      const kind = !e?.response || code === 504 || code === 429 ? "temporary" : "provider";
      setState({ status: "error", kind, message: errorMessage(e, t("checkout.verifyError")) });
    }
  };

  // ID mémorisé sélectionné → revalidation FazerCards immédiate (jamais considéré comme définitivement vérifié).
  useEffect(() => {
    if (autoTrigger > 0) verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTrigger]);

  const btn = checkout
    ? "mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 text-sm font-bold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
    : "inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-50";

  return (
    <div className="mt-2">
      {!(checkout && state.status === "valid") && (
        <button type="button" data-testid="pubg-verify-btn" onClick={verify} disabled={state.status === "loading" || !pubgId} className={btn}>
          {state.status === "loading" ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" data-testid="pubg-verify-loading" />{t("checkout.verifying")}</>) : t("checkout.verify")}
        </button>
      )}
      {state.status === "valid" && !checkout && (
        <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm" data-testid="pubg-verify-valid">
          <p className="flex items-center gap-1.5 font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />{t("checkout.verified")}
            {state.name && <span className="font-bold" data-testid="pubg-verify-player-name">· {state.name}</span>}
          </p>
          <p className="mt-0.5 text-xs text-emerald-600" data-testid="pubg-verify-confirm">{t("checkout.verifyConfirm")}</p>
        </div>
      )}
      {state.status === "valid" && checkout && (
        <div className="mt-3 rounded-[18px] border-2 border-foreground bg-primary/15 p-4" data-testid="pubg-verify-valid">
          <p className="flex items-center gap-2 font-display text-lg font-bold"><CheckCircle2 className="h-5 w-5 text-emerald-600" />{t("checkout.verified")}</p>
          <p className="mt-1.5 pl-7 text-base font-bold" data-testid="pubg-verify-player-name">Pseudo: {state.name || "—"}</p>
          <p className="mt-2 text-xs text-muted-foreground" data-testid="pubg-verify-confirm">{t("checkout.verifyConfirm")}</p>
        </div>
      )}
      {state.status === "invalid" && (
        <p className="mt-2 flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-600" data-testid="pubg-verify-invalid">
          <XCircle className="h-4 w-4" />{t("checkout.verifyInvalid")}
        </p>
      )}
      {state.status === "error" && (
        <div className="mt-2 flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700" data-testid="pubg-verify-error">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {checkout && <p className="font-bold" data-testid={`pubg-verify-error-${state.kind}`}>{state.kind === "temporary" ? t("checkout.errTemporary") : t("checkout.errProvider")}</p>}
            <p>{state.message}</p>
          </div>
        </div>
      )}
    </div>
  );
};
