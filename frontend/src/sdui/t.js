// Résolution locale des clés i18n du contrat aluu-admin v0 (FE-005).
//
// Le t() de LanguageContext résout par dot-walk strict : il ne peut pas porter,
// dans un même objet, une clé parente (chaîne) ET une clé fille à point
// littéral. Le contrat en exige trois paires :
//   admin.provider.section.game / admin.provider.section.game.hint
//   admin.aluu_mapping.preview / admin.aluu_mapping.preview.empty
//   admin.aluu_mapping.apply  / admin.aluu_mapping.apply.confirm
// Décision FE-005 : ces clés sont stockées telles quelles dans translations.js
// (clés littérales à point) et résolues ICI — LanguageContext.js reste intact.
//
// makeT(t, lang) tente D'ABORD le t() du contexte (toutes les clés non
// ambiguës suivent le chemin habituel, et les moqueries des tests restent
// autoritaires), puis redescend l'arbre en testant, à chaque niveau, la suite
// du chemin comme clé littérale avant de descendre.

import { translations } from "@/i18n/translations";

/** Redescend `root` le long de `path` en testant, à chaque niveau, la suite
 * du chemin comme clé littérale (ex. « game.hint ») avant de descendre.
 * Renvoie la chaîne trouvée, sinon undefined. */
export function resolveFlat(root, path) {
  if (!root || typeof root !== "object" || typeof path !== "string") return undefined;
  const parts = path.split(".");
  let acc = root;
  for (let i = 0; i < parts.length; i++) {
    if (acc === null || typeof acc !== "object") return undefined;
    const rest = parts.slice(i).join(".");
    const literal = acc[rest];
    if (typeof literal === "string") return literal;
    acc = acc[parts[i]];
  }
  return undefined;
}

const interpolate = (value, vars) =>
  typeof value === "string" && vars
    ? value.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`))
    : value;

/** Enrobe le t() du contexte : mêmes arguments, même repli (le chemin brut)
 * en cas d'échec total. Clé ambiguë du contrat résolue via resolveFlat. */
export function makeT(t, lang) {
  return (path, vars) => {
    const direct = t(path, vars);
    if (typeof direct === "string" && direct !== path) return direct;
    const flat = resolveFlat(translations[lang], path);
    if (flat === undefined) return direct;
    return interpolate(flat, vars);
  };
}
