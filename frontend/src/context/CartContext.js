import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const CartContext = createContext(null);
export const SUBSCRIPTION_TYPES = ["prime", "prime_plus"];
export const subscriptionLabel = (type) => (type === "prime_plus" ? "Prime+" : "Prime");

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mgs_cart") || "[]"); } catch (_) { return []; }
  });
  const [open, setOpen] = useState(false);

  useEffect(() => localStorage.setItem("mgs_cart", JSON.stringify(items)), [items]);

  // One Prime and one Prime+ max per cart (regardless of duration); evo offers max 1; UC unlimited.
  const add = useCallback((product, qty = 1) => {
    const single = SUBSCRIPTION_TYPES.includes(product.type) || product.type === "evo";
    if (SUBSCRIPTION_TYPES.includes(product.type)) {
      const existing = items.find((i) => i.type === product.type);
      if (existing) return { ok: false, reason: "duplicate_subscription", existing };
    }
    setItems((prev) => {
      const found = prev.find((i) => i.id === product.id);
      if (found) return prev.map((i) => (i.id === product.id ? { ...i, qty: single ? 1 : Math.min(20, i.qty + qty) } : i));
      return [...prev, { id: product.id, slug: product.slug, name: product.name, name_en: product.name_en, type: product.type, price: product.price, qty: single ? 1 : qty }];
    });
    return { ok: true };
  }, [items]);
  const setQty = useCallback((id, qty) => setItems((prev) => (qty <= 0 ? prev.filter((i) => i.id !== id) : prev.map((i) => (i.id === id ? { ...i, qty: SUBSCRIPTION_TYPES.includes(i.type) || i.type === "evo" ? 1 : qty } : i)))), []);
  const remove = useCallback((id) => setItems((prev) => prev.filter((i) => i.id !== id)), []);
  const clear = useCallback(() => setItems([]), []);

  const value = useMemo(() => ({
    items, add, setQty, remove, clear, open, setOpen,
    count: items.reduce((s, i) => s + i.qty, 0),
    total: items.reduce((s, i) => s + i.qty * i.price, 0),
  }), [items, add, setQty, remove, clear, open]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
