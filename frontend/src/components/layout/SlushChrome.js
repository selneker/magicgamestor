import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  applyCaptureState,
  initCursor,
  initLenis,
  initNavDirection,
  navArrive,
  prefersReduced,
  registerSlush,
  runPageLoad,
  runReducedTransitionOut,
  runTransitionIn,
  runTransitionOut,
  isCaptureMode,
  gsapReady,
  unwrapMain,
  initCardReveals,
  initSlantedText,
  initHeadingReveal,
  initMarquee,
  initGlobalParallax,
} from "@/lib/slush";
import { isFocusedRoute } from "@/lib/bottomChrome";

/* ── PL-005-FE-03 (refonte Slush) — chrome global du design system ────────
   Porte les éléments que la maquette pose autour du contenu :
   - .global > .cursor (curseur personnalisé data-cursor, bureau) ;
   - 3 × .page-transition-el (volets colorés de la transition de page) ;
   - l'interception des liens internes → outro en volets → navigation
     React Router → intro 3D (SANS window.location.href, adapté SPA) ;
   - Lenis (smooth scroll), direction de scroll → nav, easings ;
   - body[data-page] (l'accueil pose son fond encre via ce marqueur).
   Les routes focalisées (PL-CHK-4, dont /commande) ne reçoivent jamais le
   volet 3D : fondu doux à l'aller, simple restauration au retour — leur
   mise en page épinglée doit rester intacte.
   En capture (?capture) : états finaux sans tweens, liens normaux. */

let booted = false; // une seule intro de chargement par rechargement complet

export function SlushChrome() {
  const navigate = useNavigate();
  const location = useLocation();
  const pending = useRef(false);
  const busy = useRef(false);

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
      // Chargement initial — maquette design-system.js:757-763 : arrivée de
      // la nav + intro en volets 3D ; reduced-motion = runPageLoad seul
      // (fondu doux), jamais de volet sur une route focalisée (/commande…).
      if (main) {
        if (!prefersReduced() && !isFocusedRoute(location.pathname)) {
          runTransitionIn();
        } else {
          runPageLoad(main, 0.15);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Changement de route : data-page + intro de la page suivante si une
  // outro vient de se terminer. useLayoutEffect : restaure .main-w AVANT
  // le paint (le wrapper de l'outro ne doit jamais apparaître à l'écran).
  useLayoutEffect(() => {
    document.body.setAttribute("data-page", location.pathname === "/" ? "home" : "site");
    if (isCaptureMode()) {
      unwrapMain();
      pending.current = false;
      busy.current = false;
      return;
    }
    if (pending.current) {
      pending.current = false;
      busy.current = false; // la navigation a eu lieu : de nouveaux clics sont permis
      if (!isFocusedRoute(location.pathname) && !prefersReduced() && gsapReady()) {
        runTransitionIn(); // défait lui-même le wrapper de l'outro
      } else {
        unwrapMain();
      }
    }
  }, [location.pathname]);

  // Reveals / marquee / parallaxe de la page courante (cartes 3D, titres
  // slant, headings SplitText, marquee lié au scroll, parallaxe) : relancés
  // à chaque changement de route, nettoyés à la suivante — en SPA le contenu
  // change sans rechargement, contrairement à la maquette.
  useEffect(() => {
    if (!gsapReady() || isCaptureMode()) return undefined;
    const cleanups = [
      initCardReveals(document),
      initSlantedText(document),
      initHeadingReveal(document),
      initMarquee(document),
      initGlobalParallax(document),
    ];
    window.ScrollTrigger && window.ScrollTrigger.refresh();
    return () => cleanups.forEach((fn) => fn && fn());
  }, [location.pathname]);

  // Interception des liens internes → outro → navigate (maquette
  // initLinkTransitions, adaptée : navigation par le routeur).
  useEffect(() => {
    if (isCaptureMode()) return;
    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      if (a.hasAttribute("data-barba-prevent") || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.charAt(0) === "#") return;
      let url;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
      if (busy.current) return;
      e.preventDefault();
      busy.current = true;
      pending.current = true;
      const go = () => navigate(url.pathname + url.search + url.hash, { state: { mgsTransition: true } });
      // Routes focalisées (checkout…) : fondu doux des deux côtés — la page
      // épinglée ne doit jamais être remballée dans le volet 3D.
      const focused = isFocusedRoute(url.pathname) || isFocusedRoute(window.location.pathname);
      if (prefersReduced() || focused) runReducedTransitionOut(go);
      else runTransitionOut(go);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [navigate]);

  return (
    <>
      <div className="global" aria-hidden="true">
        <div className="cursor"><p className="cursor-paragraph"></p></div>
      </div>
      <div className="page-transition-el" aria-hidden="true"></div>
      <div className="page-transition-el" aria-hidden="true"></div>
      <div className="page-transition-el" aria-hidden="true"></div>
    </>
  );
}
