import { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/context/LanguageContext";

// PL-CHK-2 — compte à rebours mm:ss calculé depuis `payment_deadline_at`
// (ISO UTC, ou null ⇒ rien n'est rendu). Le chiffre courant a role="timer"
// (annoncé UNE fois à l'entrée dans la région, jamais à chaque seconde) :
// les annonces parlées vivent dans une région sr-only qui ne change son
// texte qu'aux paliers 5 min, 1 min et à l'expiration.
const pad = (n) => String(n).padStart(2, "0");

export function PaymentCountdown({ order, onZero }) {
  const { t } = useLang();
  // Memoïsé : la dépendance de l'effet d'intervalle doit être la VALEUR de
  // l'échéance, pas un nouvel objet Date à chaque rendu.
  const deadline = useMemo(() => (order?.payment_deadline_at ? new Date(order.payment_deadline_at) : null), [order?.payment_deadline_at]);
  const [now, setNow] = useState(() => Date.now());
  const [announce, setAnnounce] = useState("");
  const fired = useRef(null); // palier déjà annoncé (0 | 1 | 5 min)

  useEffect(() => {
    if (!deadline) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const remaining = deadline ? Math.max(0, Math.floor((deadline.getTime() - now) / 1000)) : null;

  useEffect(() => {
    if (remaining === null) return;
    const mins = Math.floor(remaining / 60);
    const say = (text) => setAnnounce(text);
    if (remaining === 0 && fired.current !== 0) { fired.current = 0; say(t("checkout.countdownExpired")); onZero?.(); return; }
    if (mins === 5 && fired.current === null) { fired.current = 5; say(t("checkout.minutes", { n: 5 })); return; }
    if (mins === 1 && fired.current !== 1) { fired.current = 1; say(t("checkout.minute")); }
  }, [remaining, t, onZero]);

  if (!deadline) return null;
  const text = `${pad(Math.floor(remaining / 60))}:${pad(remaining % 60)}`;
  // PL-CHK-5 — UNE seule ligne, comme Binance (maquette) : « Payer sous » en
  // couleur de texte normale, le temps en couleur d'avertissement, 16 px gras,
  // séparés de 8 px. La grande carte grise « Temps restant pour payer » est
  // supprimée. role="timer" + annonces sr-only aux paliers inchangés.
  return (
    <div className="flex items-baseline gap-2 py-1" data-testid="payment-countdown">
      <p className="text-[16px] leading-6 text-foreground">{t("checkout.countdownLabel")}</p>
      <p className={`num font-display text-[16px] font-extrabold leading-6 text-amber-700 dark:text-amber-400`} role="timer" data-testid="payment-countdown-value">{text}</p>
      <span role="status" className="sr-only" data-testid="payment-countdown-announce">{announce}</span>
    </div>
  );
}
