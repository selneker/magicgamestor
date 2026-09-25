import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";

export const PubgIdVerify = ({ pubgId }) => {
  const { t } = useLang();
  const [state, setState] = useState({ status: "idle" });

  useEffect(() => { setState({ status: "idle" }); }, [pubgId]);

  const verify = async () => {
    const id = (pubgId || "").trim();
    if (!/^\d{9,13}$/.test(id)) return setState({ status: "invalid" });
    setState({ status: "loading" });
    try {
      const { data } = await api.post("/fazercards/pubg/validate-id", { player_id: id });
      setState(data.valid
        ? { status: "valid", name: data.player_name, region: data.region }
        : { status: "invalid" });
    } catch (e) {
      setState({ status: "error", message: errorMessage(e, t("checkout.verifyError")) });
    }
  };

  return (
    <div className="mt-2">
      <button type="button" data-testid="pubg-verify-btn" onClick={verify} disabled={state.status === "loading" || !pubgId}
        className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-50">
        {state.status === "loading" ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" data-testid="pubg-verify-loading" />{t("checkout.verifying")}</>) : t("checkout.verify")}
      </button>
      {state.status === "valid" && (
        <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm" data-testid="pubg-verify-valid">
          <p className="flex items-center gap-1.5 font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" />{t("checkout.verifyValid")} — {t("checkout.verifyFound")}</p>
          {state.name && <p className="mt-1 text-emerald-800">{t("checkout.verifyPlayerName")} : <span className="font-bold" data-testid="pubg-verify-player-name">{state.name}</span></p>}
          {state.region && <p className="text-emerald-800">{t("checkout.verifyRegion")} : <span data-testid="pubg-verify-region">{state.region}</span></p>}
          <p className="mt-1 text-xs text-emerald-600" data-testid="pubg-verify-confirm">{t("checkout.verifyConfirm")}</p>
        </div>
      )}
      {state.status === "invalid" && (
        <p className="mt-2 flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-600" data-testid="pubg-verify-invalid">
          <XCircle className="h-4 w-4" />{t("checkout.verifyInvalid")}
        </p>
      )}
      {state.status === "error" && (
        <p className="mt-2 flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700" data-testid="pubg-verify-error">
          <AlertTriangle className="h-4 w-4 shrink-0" />{state.message}
        </p>
      )}
    </div>
  );
};
