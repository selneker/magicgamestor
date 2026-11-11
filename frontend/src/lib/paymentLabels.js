// PL-PAYLABEL-1 — point de vérité unique pour l'affichage du moyen de paiement
// d'une commande existante (`order.payment_method` : mvola | orange | manual |
// binance). Les noms de marque ne se traduisent pas ; seule la valeur de repli
// « Autre » passe par t(). La SÉLECTION d'une méthode côté client ne passe PAS
// par ici : l'écran 1 du tunnel (Checkout.js) a ses propres libellés traduits.
export const PAYMENT_METHOD_LABELS = {
  mvola: "MVola",
  orange: "Orange Money",
  manual: "USSD",
  binance: "Binance USDT",
};

// PL-UX-3 — opérateur du paiement manuel (`order.manual_operator` :
// mvola | orange). Les commandes créées depuis PL-ORDER-CLIENT-1 portent
// `payment_method: "manual"` + l'opérateur ; les plus anciennes portent
// encore `payment_method: "mvola" | "orange"`.
export const MANUAL_OPERATOR_LABELS = {
  mvola: "MVola",
  orange: "Orange Money",
};

// Couleurs : jetons CSS existants uniquement (valeurs pleines, utilisables
// dans style={{ background }}). Binance et les valeurs inconnues reçoivent un
// neutre — le sable de marque — jamais la couleur Orange.
const COLORS = {
  mvola: "var(--mvola)",
  orange: "var(--orange)",
  manual: "var(--brand-sand)",
  binance: "var(--brand-sand)",
};

const NEUTRAL = "var(--brand-sand)";

const keyOf = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");

// Libellé d'affichage. `t` (optionnel) ne sert qu'au repli « Autre » ; une
// valeur inconnue non vide est affichée telle quelle (nettoyée des espaces),
// jamais remplacée par un autre moyen de paiement.
export function paymentLabel(value, t) {
  const key = keyOf(value);
  if (PAYMENT_METHOD_LABELS[key]) return PAYMENT_METHOD_LABELS[key];
  if (key) return value.trim();
  return t ? t("order.methodOther") : "Autre";
}

// Couleur d'accent du moyen de paiement.
export function paymentColor(value) {
  return COLORS[keyOf(value)] || NEUTRAL;
}

// Libellé de l'opérateur manuel (MVola / Orange Money). Valeur inconnue :
// affichée telle quelle (jamais remplacée par un autre moyen de paiement).
export function paymentOperatorLabel(value, t) {
  const key = keyOf(value);
  if (MANUAL_OPERATOR_LABELS[key]) return MANUAL_OPERATOR_LABELS[key];
  if (key) return value.trim();
  return t ? t("order.methodOther") : "Autre";
}
