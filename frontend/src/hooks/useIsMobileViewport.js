import { useEffect, useState } from "react";

// PL-UI-BOTTOM-1 — True only under 1024 px : le changement rapide de jeu est
// réservé au mobile ; au-dessus de 1024 px le composant n'est simplement pas
// monté (pas un masquage CSS). window.innerWidth (et non matchMedia) pour
// rester pilotable depuis jsdom : Object.defineProperty + un événement
// `resize` suffisent.
export function useIsMobileViewport() {
  const [narrow, setNarrow] = useState(() => typeof window === "undefined" || window.innerWidth < 1024);
  useEffect(() => {
    const update = () => setNarrow(window.innerWidth < 1024);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return narrow;
}
