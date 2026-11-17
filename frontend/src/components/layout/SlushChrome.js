import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import {
  applyCaptureState,
  initCursor,
  initLenis,
  initNavDirection,
  navArrive,
  prefersReduced,
  registerSlush,
  runPageLoad,
  isCaptureMode,
  gsapReady,
  initCardReveals,
  initSlantedText,
  initHeadingReveal,
  initMarquee,
  initGlobalParallax,
  getLenis,
} from "@/lib/slush";

/* ── PL-005-FE-03 (refonte Slush) — chrome global du design system ────────
   Porte les éléments que la maquette pose autour du contenu :
   - .global > .cursor (curseur personnalisé data-cursor, bureau) ;
   - Lenis (smooth scroll), direction de scroll → nav, easings ;
   - body[data-page] (l'accueil pose son fond encre via ce marqueur).
   Les transitions de page en volets 3D ont été supprimées (PL-005-FE-07) :
   la navigation est désormais instantanée et gérée par React Router. */

let booted = false; // une seule intro de chargement par rechargement complet

export function SlushChrome() {
  const location = useLocation();
  // PL-005-FE-08c : le premier montage de la route est couvert par le boot
  // (runPageLoad y est lancé) — les suivants peuvent avoir besoin d'un
  // rejou d'intro (voir l'effet de route).
  const firstRoute = useRef(true);

  // Boot global : classes, easings, Lenis, curseur, direction, capture.
  useEffect(() => {
    document.documentElement.classList.add("has-js");
    if (prefersReduced()) document.documentElement.classList.add("reduced-motion");
    const gsap = registerSlush();
    if (!gsap) {
      // Sans GSAP : la CSS no-gsap rétablit les états opaques, la nav est
      // replacée inline (même secours que la maquette, design-system.js:252).
      document.documentElement.classList.add("no-gsap");
      const nav = document.getElementById("navContainer");
      if (nav) nav.style.transform = "translate(0,0)";
      document.body.setAttribute("data-scrolling-started", "false");
      return;
    }
    document.body.setAttribute("data-scrolling-started", "false");
    if (applyCaptureState()) return; // capture : états finaux, c'est tout
    initLenis();
    initNavDirection();
    initCursor();
    if (!booted) {
      booted = true;
      navArrive();
      const main = document.querySelector(".main-w");
      // Chargement initial — intro de la page (fondu doux via runPageLoad),
      // plus de volet 3D. (PL-005-FE-07 : transitions de page supprimées.)
      if (main) runPageLoad(main, 0.15);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // data-page + reveals / marquee / parallaxe de la page courante (cartes 3D,
  // titres slant, headings SplitText, marquee lié au scroll, parallaxe) :
  // relancés à chaque changement de route, nettoyés à la suivante — en SPA le
  // contenu change sans rechargement, contrairement à la maquette.
  useEffect(() => {
    document.body.setAttribute(
      "data-page",
      location.pathname === "/" ? "home" : "site"
    );
    // PL-005-FE-08f (G3-3, chasse glitches) — reset de scroll. Course
    // critique vérifiée par trappe du setter scrollTop : au commit, le
    // document rétrécit, le navigateur clampe la position (2000→972) et
    // Lenis re-synchronise sa cible APRÈS notre écriture — le reset immédiat
    // est écrasé et l'utilisateur atterrit en pleine page. On écrit donc
    // deux fois : tout de suite (moins de flash), puis un frame plus tard
    // (une fois le clamp et la re-synchronisation Lenis passés) — vérifié :
    // seul le reset différé tient.
    const resetScroll = () => {
      const l = getLenis();
      if (l) l.scrollTo(0, { immediate: true });
      else window.scrollTo(0, 0);
    };
    resetScroll();
    requestAnimationFrame(resetScroll);
    if (!gsapReady() || isCaptureMode()) return undefined;
    const cleanups = [
      initCardReveals(document),
      initSlantedText(document),
      initHeadingReveal(document),
      initMarquee(document),
      initGlobalParallax(document),
    ];
    window.ScrollTrigger && window.ScrollTrigger.refresh();
    // PL-005-FE-08c (G1, propriétaire) — retour SPA sur une page à héros
    // (logo, lien) : le héros est un NOUVEAU nœud DOM, la règle
    // `html.has-js [data-hero-content] { opacity: 0 }`
    // (design-system.css:6664) s'y réapplique, et `runPageLoad` — la seule
    // chose qui repasse l'opacité à 1 — ne tournait qu'au boot (drapeau
    // `booted`). Résultat observé (sonde) : opacité calculée 0, fond blanc
    // seul. On rejoue l'intro quand la vue montée en porte un ; les gardes
    // reduced-motion/capture sont dans runPageLoad. Le drapeau ci-dessous
    // évite de la rejouer AU PREMIER montage (le boot l'a déjà lancée).
    if (!firstRoute.current) {
      const main = document.querySelector(".main-w");
      if (main?.querySelector("[data-hero-content]")) runPageLoad(main, 0.15);
    }
    firstRoute.current = false;
    return () => cleanups.forEach((fn) => fn && fn());
  }, [location.pathname]);

  return (
    <>
      <div className="global" aria-hidden="true">
        <div className="cursor"><p className="cursor-paragraph"></p></div>
      </div>
    </>
  );
}
