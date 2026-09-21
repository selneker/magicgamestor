import { useState } from "react";
import { Copy, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/context/LanguageContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const Row = ({ label, value, sub, onCopy, testid, copyTestid }) => {
  const { t } = useLang();
  return (
    <div className="flex items-center justify-between gap-3 border border-foreground bg-card p-3">
      <div className="min-w-0">
        <p className="eyebrow">{label}</p>
        <p className="num mt-1 truncate text-lg text-foreground" data-testid={testid}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      {onCopy && (
        <button type="button" onClick={onCopy} data-testid={copyTestid} className="inline-flex shrink-0 items-center gap-1 border border-foreground bg-primary px-3 py-1.5 text-xs font-bold text-[#0A0A0A] transition-transform hover:-translate-y-0.5">
          <Copy className="h-3.5 w-3.5" />{t("checkout.copy")}
        </button>
      )}
    </div>
  );
};

/** In-site USSD payment dialog: never navigates away (no tel:, no window.location, no Papi). */
export function UssdDialog({ open, onOpenChange, providerLabel, color, merchant, merchantName, ussdCode, total, reference, setReference, onSubmit, busy }) {
  const { t } = useLang();
  const [step, setStep] = useState("instructions");
  const amount = `${total.toLocaleString("fr-FR")} Ar`;
  const copy = async (value) => { try { await navigator.clipboard.writeText(value); toast.success(t("common.copied")); } catch { toast.error(t("common.error")); } };

  const change = (next) => { if (!next) setStep("instructions"); onOpenChange(next); };

  const send = () => {
    if (!(reference.value || "").trim()) return toast.error(t("checkout.refRequired"));
    onSubmit();
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto border-2 border-foreground bg-background p-0 sm:max-w-lg" data-testid="ussd-dialog">
        <DialogHeader className="border-b border-foreground px-5 py-4 text-left">
          <DialogTitle className="font-display text-lg font-bold" data-testid="ussd-dialog-title">
            {step === "instructions" ? t("checkout.ussdTitle") : t("checkout.confirmTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: color }} />
            <span className="text-sm font-bold" data-testid="ussd-provider">{providerLabel}</span>
          </div>
          <Row label={t("checkout.ussdAmount")} value={amount} onCopy={() => copy(String(total))} testid="ussd-amount" copyTestid="ussd-copy-amount" />
          <Row label={t("checkout.ussdNumber")} value={merchant} sub={merchantName} onCopy={() => copy(merchant)} testid="ussd-merchant" copyTestid="ussd-copy-merchant" />
          {ussdCode && <Row label={t("checkout.ussdCode")} value={ussdCode} onCopy={() => copy(ussdCode)} testid="ussd-code" copyTestid="ussd-copy-code" />}

          {step === "instructions" ? (
            <>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground" data-testid="ussd-steps">
                {t("checkout.ussdSteps").map((s) => <li key={s}>{s}</li>)}
              </ol>
              <p className="border border-foreground bg-primary/15 p-3 text-xs font-semibold" data-testid="ussd-notice">{t("checkout.ussdNote")}</p>
              <Button type="button" onClick={() => setStep("confirm")} data-testid="ussd-next" className="h-12 w-full rounded-full text-base font-bold">
                <Smartphone className="mr-2 h-4 w-4" />{t("checkout.ussdNext")}
              </Button>
            </>
          ) : (
            <>
              <div>
                <label className="text-sm font-semibold" htmlFor="ussd-reference">{t("checkout.reference")}</label>
                <Input id="ussd-reference" data-testid="ussd-reference-input" value={reference.value || ""} onChange={(e) => setReference({ ...reference, value: e.target.value })} placeholder="Ex : Ref 1148190***" className="mt-1 h-12 rounded-xl" />
                <p className="mt-1 text-xs text-muted-foreground">{t("checkout.refHint")}</p>
              </div>
              <Button type="button" onClick={send} disabled={busy} data-testid="ussd-submit-order" className="h-12 w-full rounded-full text-base font-bold">
                {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checkout.processing")}</> : t("checkout.send")}
              </Button>
              <button type="button" onClick={() => setStep("instructions")} data-testid="ussd-back" className="w-full text-xs font-semibold text-muted-foreground underline">{t("common.back")}</button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
