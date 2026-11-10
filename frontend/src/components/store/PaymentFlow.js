import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLang } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";

// PL-CHK-4 — PaymentFlow (cartes d'étape 2 de l'ancien tunnel) est supprimé :
// le nouveau tunnel n'a plus d'étape « Méthode » séparée. Ce module garde
// UNIQUEMENT les briques partagées : logos, codes USSD, frais, sélecteur
// réseau Binance et sélecteur d'opérateur manuel (reprise PL-CHK-3).

export const PAYMENT_LOGOS = {
  mvola: "/payment-logos/mvola.svg",
  orange: "/payment-logos/orange-money.svg",
  binance: "/payment-logos/binance.svg",
};

export const USSD = {
  mvola: (phone, amount) => `#111*1*2*${phone}*${amount}*1*0#`,
  orange: (phone, amount) => `#144*1*1*${phone}*${phone}*${amount}*1#`,
};
export const pretty = (p) => p.replace(/(\d{3})(\d{2})(\d{3})(\d{2})/, "$1 $2 $3 $4");

export function paymentFee(config, method, subtotal) {
  if (!method || method === "binance") return 0;
  const rule = config?.payment_fees?.[method === "manual" ? "manual" : config?.gateway === "fiveone" ? "fiveone" : "papi"];
  return rule ? Math.min(Math.max(Math.round((subtotal * rule.percent) / 100), rule.min), rule.max) : 0;
}

// Réseaux USDT (source GET /crypto/config) — utilisé par l'écran 1 du nouveau
// tunnel : la ligne Binance y expose le choix du réseau, requis par
// POST /crypto/initiate { order_id, network }.
export function NetworkPicker({ crypto, network, setNetwork }) {
  const { t } = useLang();
  return (
    <div>
      <p className="text-sm font-semibold">{t("checkout.chooseNetwork")}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {crypto.networks.map((n) => {
          const on = network === n.key;
          return (
            <button key={n.key} type="button" data-testid={`binance-network-${n.key}`} aria-pressed={on} onClick={() => setNetwork(n.key)} className={`flex items-center gap-2.5 rounded-[12px] border p-3 text-left transition-colors motion-reduce:transition-none ${on ? "border-[color:var(--brand-lime)] bg-primary/10" : "border-[color:var(--rule)] hover:border-foreground"}`}>
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-primary" : "border-[color:var(--rule-strong)]"}`}>{on && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}</span>
              <span className="min-w-0"><span className="block text-sm font-black">{n.key}</span><span className="block truncate text-[11px] text-muted-foreground">{n.label}</span></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// PL-CHK-3 / PL-CHK-4 — la pastille « opérateur » des commandes USSD :
// partagée par l'écran 2 (commande ancienne sans `manual_operator` persisté) —
// le client (re)choisit explicitement MVola ou Orange Money avant de payer.
export function ManualProviderPicker({ provider, onSelect }) {
  const { t } = useLang();
  const PROVIDERS = [
    { key: "mvola", label: "MVola", color: "var(--mvola)" },
    { key: "orange", label: "Orange Money", color: "var(--orange)" },
  ];
  return (
    <>
      <p className="text-sm font-semibold">{t("checkout.chooseOperator")}</p>
      <div className="flex gap-2">
        {PROVIDERS.map((p) => (
          <button key={p.key} type="button" data-testid={`manual-provider-${p.key}`} aria-pressed={provider === p.key} onClick={() => onSelect(p.key)} className={`rounded-full px-4 py-1.5 text-xs font-bold transition-opacity ${provider === p.key ? "text-ink" : "border bg-card text-muted-foreground hover:opacity-80"}`} style={provider === p.key ? { background: p.color } : undefined}>{p.label}</button>
        ))}
      </div>
    </>
  );
}

// Bouton de copie partagé (écran 2) : retour visuel « Copié » + annonce
// lecteur d'écran polie (rôle status), cible tactile ≥ 44 px.
export function CopyButton({ value, label, testId }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    let ok = false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(String(value)); ok = true; } } catch (_) { /* repli */ }
    if (!ok) {
      try {
        const area = document.createElement("textarea");
        area.value = String(value); area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
        document.body.appendChild(area); area.select();
        ok = document.execCommand("copy");
        document.body.removeChild(area);
      } catch (_) { ok = false; }
    }
    if (!ok) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button type="button" onClick={copy} data-testid={testId} aria-label={copied ? t("checkout.copiedLabel") : label} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border border-[color:var(--rule-strong)] text-muted-foreground transition-colors hover:border-foreground hover:text-foreground">
      {copied ? <Check className="h-4 w-4 text-foreground" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      <span role="status" className="sr-only">{copied ? t("checkout.copiedLabel") : ""}</span>
    </button>
  );
}

// Bouton plein (écrans fixes en bas) — le même couple jetons clair/sombre
// que l'ancien tunnel (fond primaire, texte encre).
export function PrimaryCta({ children, ...props }) {
  return <Button {...props} className={`h-[52px] w-full rounded-full text-[15px] font-extrabold ${props.className || ""}`}>{children}</Button>;
}
