// Pastille de points compacte (PL-BRAND-1) : affichage complet jusqu'à 9 999,
// puis forme abrégée selon la langue du site (fr : « 12,5 k », « 1,2 M » ;
// en : « 12.5K », « 1.2M ») via Intl.NumberFormat — aucun séparateur inventé.
// roundingMode "trunc" : 1 250 000 → « 1,2 M » (jamais « 1,3 M », qui
// sur-estimerait le solde) ; les navigateurs sans cette option restent corrects.
const LOCALES = { fr: "fr-FR", en: "en-US" };

export function formatPointsCount(total, lang = "fr") {
  const locale = LOCALES[lang] || LOCALES.fr;
  if (total <= 9999) return new Intl.NumberFormat(locale).format(total);
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
    roundingMode: "trunc",
  }).format(total);
}
