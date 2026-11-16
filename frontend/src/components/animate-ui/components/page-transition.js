import { useEffect, useRef, useState } from "react";
import { gsapReady, prefersReduced } from "@/lib/slush";

/* ── PL-005-FE-07 (remplacement) — transition de page "chop" ────────────────
   Remplace l'instantanéité de la navigation issue de PL-005-FE-07 (volets 3D
   supprimés) par un effet "chop" sec : la page courante est découpée vers la
   gauche en s'estompant, la nouvelle arrive depuis la droite et se pose.
   Dégradé sans GSAP ou en prefers-reduced-motion : changement instantané. */

export function PageTransition({ children, pageKey, effect = "chop", className }) {
  const wrapperRef = useRef(null);
  const [content, setContent] = useState(children);
  const [phase, setPhase] = useState("idle"); // idle | exiting | entering
  const prevKeyRef = useRef(pageKey);
  const tlRef = useRef(null);

  useEffect(() => {
    if (pageKey === prevKeyRef.current) return;
    const gsap = gsapReady();
    const wrapper = wrapperRef.current;
    prevKeyRef.current = pageKey;

    // Dégradé : pas de GSAP, pas de wrapper, ou mouvement réduit → instantané.
    if (!gsap || !wrapper || prefersReduced()) {
      setContent(children);
      setPhase("idle");
      return undefined;
    }
    if (tlRef.current) tlRef.current.kill();

    setPhase("exiting");

    const durationOut = 0.16;
    const durationIn = 0.35;

    tlRef.current = gsap.timeline({
      onComplete: () => {
        setContent(children);
        setPhase("entering");
        tlRef.current = gsap.fromTo(
          wrapper,
          { autoAlpha: 0, x: "30%", scale: 0.94 },
          {
            autoAlpha: 1,
            x: 0,
            scale: 1,
            duration: durationIn,
            ease: "slush",
            onComplete: () => setPhase("idle"),
          },
        );
      },
    });

    // Sortie : on "chop" la page courante vers la gauche.
    tlRef.current.to(wrapper, {
      autoAlpha: 0,
      x: "-30%",
      scale: 0.94,
      duration: durationOut,
      ease: "power2.in",
    });

    return () => {
      tlRef.current && tlRef.current.kill();
      setPhase("idle");
    };
  }, [pageKey, children]);

  return (
    <div className={className} ref={wrapperRef} style={{ position: "relative", minHeight: "1px" }}>
      {content}
    </div>
  );
}
