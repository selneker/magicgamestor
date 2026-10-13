import { useLocation, useOutlet } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";

// Ordered bottom-nav tabs — determines slide direction so pages travel left
// or right matching the pill motion. Any unlisted route uses index -1 and
// slides from the right by default.
const TAB_ORDER = [
  { match: (p) => p === "/" || p.startsWith("/boutique") || p.startsWith("/produit") || p.startsWith("/pack-evolutif") },
  { match: (p) => p.startsWith("/evenements") },
  { match: (p) => p.startsWith("/suivi") || p.startsWith("/commande") || p.startsWith("/compte") },
  { match: (p) => p.startsWith("/chat") || p.startsWith("/support") },
];

const tabIndex = (pathname) => {
  const i = TAB_ORDER.findIndex((t) => t.match(pathname));
  return i;
};

export function PageTransition() {
  const location = useLocation();
  const outlet = useOutlet();
  const prevIndex = useRef(tabIndex(location.pathname));

  // Determine slide direction before paint so animation picks up the right x.
  const current = tabIndex(location.pathname);
  const forward = current === -1 || prevIndex.current === -1 ? true : current >= prevIndex.current;

  useEffect(() => {
    prevIndex.current = current;
  }, [current]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        data-testid="page-transition"
        initial={{ x: forward ? 18 : -18, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: forward ? -18 : 18, opacity: 0 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        className="min-h-[60vh]"
      >
        {outlet}
      </motion.div>
    </AnimatePresence>
  );
}
