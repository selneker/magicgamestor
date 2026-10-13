import { useEffect } from "react";

export const DEFAULT_GAME = "pubg-mobile";
export const gameOf = (p) => p?.game_id || DEFAULT_GAME;

// Game-configured MGS product type label (falls back to the raw key, never to a PUBG list).
export const typeLabel = (game, type, lang) => {
  const def = (game?.product_types || []).find((t) => t.key === type);
  if (!def) return type;
  return (lang === "en" && def.label_en) || def.label;
};

export const currencyOf = (game) => game?.currency_label || (game?.id === DEFAULT_GAME ? "UC" : "");

// Headline figure of a product card: currency amount, subscription months, or the type label.
export const productFigure = (p, game, lang) => {
  if (p.uc_amount) return { value: p.uc_amount, unit: currencyOf(game) || typeLabel(game, p.type, lang) };
  if (p.duration_months) return { value: p.duration_months, unit: lang === "en" ? "months" : "mois" };
  return { value: typeLabel(game, p.type, lang), unit: "" };
};

export function usePageMeta(title, description) {
  useEffect(() => {
    document.title = title ? `${title} · Magic Game Store` : "Magic Game Store — Recharges de jeux à Madagascar";
    if (description) document.querySelector('meta[name="description"]')?.setAttribute("content", description);
  }, [title, description]);
}
