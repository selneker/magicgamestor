import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const CartContext = createContext(null);
export const SUBSCRIPTION_TYPES = ["prime", "prime_plus"];
export const subscriptionLabel = (type) => (type === "prime_plus" ? "Prime+" : "Prime");
const gameOf = (p) => p.game_id || "pubg-mobile";

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mgs_cart") || "[]"); } catch (_) { return []; }
  });
  const [open, setOpen] = useState(false);

  useEffect(() => localStorage.setItem("mgs_cart", JSON.stringify(items)), [items]);

  // A cart (and therefore an order) belongs to ONE game: the backend rejects mixed carts.
  const gameId = items[0] ? gameOf(items[0]) : null;

  // One Prime and one Prime+ max per cart (regardless of duration); evo offers max 1; currency packs unlimited.
  const add = useCallback((product, qty = 1) => {
    if (items.length && gameOf(items[0]) !== gameOf(product)) return { ok: false, reason: "other_game", gameId: gameOf(items[0]) };
    const single = SUBSCRIPTION_TYPES.includes(product.type) || product.type === "evo";
    if (SUBSCRIPTION_TYPES.includes(product.type)) {
      const existing = items.find((i) => i.type === product.type);
      if (existing) return { ok: false, reason: "duplicate_subscription", existing };
    }
    setItems((prev) => {
      const found = prev.find((i) => i.id === product.id);
      if (found) return prev.map((i) => (i.id === product.id ? { ...i, qty: single ? 1 : Math.min(20, i.qty + qty) } : i));
      return [...prev, { id: product.id, slug: product.slug, name: product.name, name_en: product.name_en, type: product.type, price: product.price, game_id: gameOf(product), qty: single ? 1 : qty }];
    });
    return { ok: true };
  }, [items]);
  const setQty = useCallback((id, qty) => setItems((prev) => (qty <= 0 ? prev.filter((i) => i.id !== id) : prev.map((i) => (i.id === id ? { ...i, qty: SUBSCRIPTION_TYPES.includes(i.type) || i.type === "evo" ? 1 : qty } : i)))), []);
  const remove = useCallback((id) => setItems((prev) => prev.filter((i) => i.id !== id)), []);
  const clear = useCallback(() => setItems([]), []);

  const value = useMemo(() => ({
    items, add, setQty, remove, clear, open, setOpen, gameId,
    count: items.reduce((s, i) => s + i.qty, 0),
    total: items.reduce((s, i) => s + i.qty * i.price, 0),
  }), [items, add, setQty, remove, clear, open, gameId]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);

// Shared add-to-cart feedback so every entry point explains refusals the same way.
export const addFeedback = (r, t, toast, setOpen) => {
  if (r.ok) { toast.success(t("product.added"), { action: { label: t("nav.cart"), onClick: () => setOpen(true) } }); return true; }
  if (r.reason === "other_game") toast.error(t("cart.otherGame"));
  else toast.error(t("product.duplicateSub").replaceAll("{label}", subscriptionLabel(r.existing?.type)));
  return false;
};
