/* ── PL-005-FE-03 (refonte Slush) — port de maquettes/design-system.js ─────
   Easings CustomEase (slush / slush-bounce), Lenis, direction de scroll →
   nav, menu pilule, curseur data-cursor, marquee lié au scroll, reveals
   (SplitText 3D), parallaxe, chargement de page et transition en volets.
   Toutes les durées, courbes et couleurs sont CELLES DE LA MAQUETTE.

   Deux adaptations obligatoires pour une application React (SPA) :
   - la transition de page ne fait PAS window.location.href : l'outro se
     termine par un callback (le routeur navigue), l'intro rejoue au
     changement de route ; le remballage de .main-w est défait avant le
     paint (unwrapMain) pour ne jamais laisser la page dans le wrapper ;
   - tout est réinitialisable (cleanup) : l'application ne se recharge pas
     entre les pages, chaque montage de page relance ses reveals.

   Modes dégradés, comme la maquette :
   - sans GSAP (tests, échec de chargement) : html.no-gsap + la CSS de
     secours rétablit les états opaques ; la nav est replacée inline ;
   - prefers-reduced-motion : pas d'intro 3D ni de Lenis ;
   - ?capture dans l'URL : états finaux posés SANS tweens (captures
     d'écran et audit de contraste déterministes). */

export const TILE_COLORS = ["#4da2ff", "#ffd731", "#e9ccff", "#55db9c", "#fb4903", "#5c4ade"];

export const isCaptureMode = () =>
  typeof window !== "undefined" && /[?&]capture/.test(window.location.search);

export const prefersReduced = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function gsapReady() {
  return typeof window !== "undefined" &&
    window.gsap && window.ScrollTrigger && window.SplitText && window.CustomEase
    ? window.gsap
    : null;
}

let registered = false;
export function registerSlush() {
  const gsap = gsapReady();
  if (!gsap || registered) return gsap;
  registered = true;
  gsap.registerPlugin(window.ScrollTrigger, window.SplitText, window.CustomEase);
  /* ——— easings exacts de la référence (design-system.js:266-268) ——— */
  window.CustomEase.create("slush", "0.65, 0.05, 0, 1");
  window.CustomEase.create("slush-bounce",
    "M0,0 L0.076,0.5737 L0.1187,0.8382 L0.1419,0.9463 L0.1654,1.0292 L0.1897,1.0886 L0.2153,1.1258 L0.2297,1.137 L0.2448,1.1424 L0.261,1.1423 L0.2786,1.1366 L0.3101,1.1165 L0.3862,1.0507 L0.4257,1.0219 L0.4699,0.9995 L0.5163,0.9872 L0.5877,0.9842 L0.8126,1.0011 L1,1");
  gsap.defaults({ ease: "slush", duration: 0.525 });
  return gsap;
}

/* ------------------------- Lenis (design-system.js:278-284) ---------------- */

let lenis = null;
export const getLenis = () => lenis;
export function initLenis() {
  if (lenis || isCaptureMode() || prefersReduced()) return null;
  const gsap = registerSlush();
  if (!gsap || !window.Lenis) return null;
  lenis = new window.Lenis({ lerp: 0.12 });
  lenis.on("scroll", window.ScrollTrigger.update);
  gsap.ticker.add((time) => { lenis.raf(1000 * time); });
  gsap.ticker.lagSmoothing(0);
  return lenis;
}

/* --------------------- Sens de scroll → nav (JS:288-307) ------------------ */

let directionHandler = null;
export function initNavDirection() {
  if (directionHandler || !gsapReady()) return;
  let lastY = window.scrollY;
  directionHandler = () => {
    const y = window.scrollY;
    if (Math.abs(y - lastY) < 10) return;
    const direction = y > lastY ? "down" : "up";
    const started = y > 50;
    lastY = y;
    document.body.setAttribute("data-scrolling-direction", direction);
    document.body.setAttribute("data-scrolling-started", String(started));
    const gsap = gsapReady();
    if (!gsap) return;
    if (direction === "down" && started && window.innerWidth >= 992) {
      gsap.to(document.querySelectorAll(".nav-inner-li"), { yPercent: -300, duration: 0.75, ease: "slush-bounce", stagger: { each: 0.03, from: "start" } });
    } else if (direction === "up" && window.innerWidth >= 992) {
      gsap.to(document.querySelectorAll(".nav-inner-li"), { yPercent: 0, duration: 0.75, ease: "slush-bounce", stagger: { each: 0.03, from: "end" } });
    }
  };
  window.addEventListener("scroll", directionHandler, { passive: true });
}

/* ------------------------- Menu (JS:311-354) ------------------------------ */
/* Desktop (≥992) : survol du burger → les pilules réapparaissent (elles
   sont parties en yPercent -300 au scroll) ; sortie de la zone → hide.
   Mobile (<992) : le burger bascule les pilules (xPercent 300 ⇄ 0),
   rotation 90° et la ligne horizontale s'efface, comme la maquette. */

export function initMenu(btn) {
  const gsap = gsapReady();
  if (!btn || !gsap) return () => {};
  let menuOpen = false;
  const hLine = btn.querySelector(".nav-btn-menu__line.is--h");
  const items = () => document.querySelectorAll(".nav-inner-li");
  const right = btn.closest(".nav-inner-right");
  const mq = window.matchMedia("(min-width: 992px)");

  const show = () => gsap.to(items(), { yPercent: 0, duration: 0.75, ease: "slush-bounce", stagger: { each: 0.03, from: "end" } });
  const hide = () => gsap.to(items(), { yPercent: -300, duration: 0.75, ease: "slush-bounce", stagger: { each: 0.03, from: "start" } });
  const toggleMobile = () => {
    if (menuOpen) {
      gsap.to(items(), { xPercent: 300, duration: 0.75, ease: "slush-bounce", stagger: { each: 0.03, from: "start" } });
      btn.style.transform = "rotate(0deg)";
      if (hLine) hLine.style.transform = "scaleX(1)";
      menuOpen = false;
      btn.setAttribute("aria-expanded", "false");
    } else {
      gsap.to(items(), { xPercent: 0, duration: 0.75, ease: "slush-bounce", stagger: { each: 0.03, from: "end" } });
      btn.style.transform = "rotate(90deg)";
      if (hLine) hLine.style.transform = "scaleX(0)";
      menuOpen = true;
      btn.setAttribute("aria-expanded", "true");
    }
  };

  const onMouseEnter = () => show();
  const onMouseLeave = () => hide();
  btn.addEventListener("mouseenter", onMouseEnter, { passive: true });
  if (right) right.addEventListener("mouseleave", onMouseLeave, { passive: true });
  // Le toggle burger n'a de sens qu'en mobile (desktop = hover) :
  // un clic desktop ne doit pas déclencher le slide xPercent.
  const onToggle = () => { if (!mq.matches) toggleMobile(); };
  btn.addEventListener("click", onToggle);

  const applyMode = () => {
    if (mq.matches) {
      gsap.set(items(), { xPercent: 0, yPercent: 0 });
      menuOpen = false;
      btn.setAttribute("aria-expanded", "false");
    } else {
      gsap.set(items(), { xPercent: 300, yPercent: 0 });
    }
  };
  applyMode();
  mq.addEventListener("change", applyMode);

  return () => {
    btn.removeEventListener("mouseenter", onMouseEnter);
    if (right) right.removeEventListener("mouseleave", onMouseLeave);
    btn.removeEventListener("click", onToggle);
    mq.removeEventListener("change", applyMode);
  };
}

/* --------------------- Curseur personnalisé (JS:358-391) ------------------ */

export function initCursor() {
  const gsap = gsapReady();
  if (!gsap || prefersReduced()) return;
  const cursor = document.querySelector(".cursor");
  if (!cursor) return;
  gsap.set(cursor, { xPercent: 6, yPercent: 50 });
  const toX = gsap.quickTo(cursor, "x", { ease: "power3" });
  const toY = gsap.quickTo(cursor, "y", { ease: "power3" });
  const onMove = (e) => {
    const vw = window.innerWidth, vh = window.innerHeight, scrollY = window.scrollY;
    const x = e.clientX, y = e.clientY + scrollY;
    let xp = 6, yp = 50;
    if (x > vw - (cursor.offsetWidth + 16)) xp = -100;
    if (y > scrollY + 0.9 * vh) yp = -120;
    gsap.to(cursor, { xPercent: xp, yPercent: yp, duration: 0.9, ease: "power3" });
    toX(x); toY(y - scrollY);
  };
  window.addEventListener("mousemove", onMove);
}

export function initCursorTargets(scope) {
  const cursor = document.querySelector(".cursor");
  const targets = scope ? scope.querySelectorAll("[data-cursor]") : [];
  if (!cursor || !targets.length) return () => {};
  const label = cursor.querySelector("p");
  const listeners = [];
  let current = "";
  targets.forEach((el) => {
    const onEnter = () => {
      const text = el.getAttribute("data-cursor");
      if (text !== current) {
        if (label) label.innerHTML = text;
        current = text;
        void cursor.offsetWidth;
      }
    };
    el.addEventListener("mouseenter", onEnter);
    listeners.push([el, onEnter]);
  });
  return () => listeners.forEach(([el, fn]) => el.removeEventListener("mouseenter", fn));
}

/* --------------- Marquee lié au scroll (JS:395-440) ----------------------- */
/* Le port React rend la collection 3 fois dans le JSX (original + N
   clones) : on ne duplique donc plus le DOM ici — on anime toutes les
   collections trouvées, comme le faisait la maquette après duplication. */

export function initMarquee(scope) {
  const gsap = gsapReady();
  if (!gsap || !window.ScrollTrigger) return () => {};
  const els = scope ? Array.from(scope.querySelectorAll("[data-marquee-scroll-direction-target]")) : [];
  const cleanups = [];
  els.forEach((el) => {
    const collections = el.querySelectorAll("[data-marquee-collection-target]");
    const scrollEl = el.querySelector("[data-marquee-scroll-target]");
    if (!collections.length || !scrollEl) return;
    const speed = parseFloat(el.dataset.marqueeSpeed);
    const dir = el.dataset.marqueeDirection === "right" ? 1 : -1;
    const scrollSpeed = parseFloat(el.dataset.marqueeScrollSpeed);

    let factor = window.innerWidth < 479 ? 0.25 : window.innerWidth < 991 ? 0.5 : 1;
    let duration = speed * (collections[0].offsetWidth / window.innerWidth) * factor;
    if (prefersReduced()) { duration = 100; factor = 0; }

    scrollEl.style.marginLeft = -1 * scrollSpeed + "%";
    scrollEl.style.width = 2 * scrollSpeed + 100 + "%";

    const tween = gsap.to(collections, { xPercent: -100, repeat: -1, duration: duration, ease: "linear" }).totalProgress(0.5);
    gsap.set(collections, { xPercent: dir === 1 ? 100 : -100 });
    tween.timeScale(dir);
    tween.play();
    el.setAttribute("data-marquee-status", "normal");

    const st = window.ScrollTrigger.create({
      trigger: el, start: "top bottom", end: "bottom top",
      onUpdate: (self) => {
        const down = self.direction === 1;
        tween.timeScale(down ? -dir : dir);
        el.setAttribute("data-marquee-status", down ? "normal" : "inverted");
      },
    });

    // Défilement horizontal lié au scroll vertical.
    const from = dir === -1 ? scrollSpeed : -scrollSpeed;
    const to = -from;
    const tl = gsap.timeline({ scrollTrigger: { trigger: el, start: "0% 100%", end: "100% 0%", scrub: 0 } })
      .fromTo(scrollEl, { x: from + "vw" }, { x: to + "vw", ease: "none" });

    cleanups.push(() => { tween.kill(); st.kill(); tl.scrollTrigger && tl.scrollTrigger.kill(); tl.kill(); });
  });
  return () => cleanups.forEach((fn) => fn());
}

/* --------------- Reveals : cartes / slant / heading (JS:442-514) ---------- */

const BREAKPOINT = 768;

function matchMediaConditions() {
  return {
    isDesktop: window.matchMedia(`(min-width: ${BREAKPOINT}px)`).matches,
    isMobile: window.matchMedia(`(max-width: ${BREAKPOINT - 1}px)`).matches,
    reduceMotion: prefersReduced(),
  };
}

function revealCards(trigger, cards) {
  const gsap = gsapReady();
  if (!gsap || !cards.length) return () => {};
  const { reduceMotion } = matchMediaConditions();
  if (!reduceMotion) gsap.set(cards, { x: "5em", z: "20em", rotateY: -30, autoAlpha: 0, scale: 0.75 });
  const st = window.ScrollTrigger.create({
    trigger, start: "top 80%", once: true,
    onEnter: () => {
      gsap.to(cards, { x: "0em", z: "0em", rotateY: 0, scale: 1, autoAlpha: 1, ease: "slush-bounce", stagger: { amount: 0.2 }, duration: reduceMotion ? 0 : 0.85 });
    },
  });
  return () => st.kill();
}

export function initCardReveals(scope) {
  if (!gsapReady() || isCaptureMode()) return () => {};
  const cleanups = [];
  const wraps = scope.querySelectorAll('[data-card-reveal="wrap"]');
  if (!wraps.length) {
    scope.querySelectorAll('[data-card-reveal="card"]').forEach((card) => cleanups.push(revealCards(card, [card])));
  } else {
    wraps.forEach((wrap) => cleanups.push(revealCards(wrap, wrap.querySelectorAll('[data-card-reveal="card"]'))));
  }
  return () => cleanups.forEach((fn) => fn());
}

export function initSlantedText(scope) {
  const gsap = gsapReady();
  if (!gsap || isCaptureMode()) return () => {};
  const cleanups = [];
  scope.querySelectorAll("[data-anim-slant]").forEach((el) => {
    const { reduceMotion } = matchMediaConditions();
    if (reduceMotion) return;
    const split = new window.SplitText(el, { type: "words, chars", charsClass: "char", tag: "span" });
    el.setAttribute("aria-label", el.textContent);
    split.words.forEach((w) => w.setAttribute("aria-hidden", "true"));
    gsap.set(split.chars, { x: "-0.25em", autoAlpha: 0 });
    const st = window.ScrollTrigger.create({
      trigger: el, start: "top 80%", once: true,
      onEnter: () => {
        gsap.to(split.chars, { ease: "slush-bounce", x: "0em", duration: 0.65, autoAlpha: 1, stagger: { each: 0.015, from: "end" } });
      },
    });
    cleanups.push(() => { st.kill(); split.revert && split.revert(); });
  });
  return () => cleanups.forEach((fn) => fn());
}

export function initHeadingReveal(scope) {
  const gsap = gsapReady();
  if (!gsap || isCaptureMode()) return () => {};
  const cleanups = [];
  scope.querySelectorAll("[data-heading-reveal]").forEach((el) => {
    const { reduceMotion } = matchMediaConditions();
    if (reduceMotion) return;
    const split = new window.SplitText(el, { type: "lines, words" });
    el.setAttribute("aria-label", el.textContent);
    gsap.set(el, { position: "relative", perspective: 1000 });
    gsap.set(split.lines, { z: "5em", rotateY: -45, autoAlpha: 0 });
    const st = window.ScrollTrigger.create({
      trigger: el, start: "top 80%", once: true,
      onEnter: () => {
        gsap.to(split.lines, { ease: "slush-bounce", z: "0em", rotateY: 0, duration: 0.85, autoAlpha: 1, stagger: 0.15 });
      },
    });
    cleanups.push(() => { st.kill(); split.revert && split.revert(); });
  });
  return () => cleanups.forEach((fn) => fn());
}

/* --------------------- Parallaxe globale (JS:518-547) --------------------- */

export function initGlobalParallax(scope) {
  const gsap = gsapReady();
  if (!gsap || isCaptureMode()) return () => {};
  const cleanups = [];
  (scope || document).querySelectorAll('[data-parallax="trigger"]').forEach((el) => {
    const target = el.querySelector('[data-parallax="target"]') || el;
    const prop = el.getAttribute("data-parallax-direction") === "horizontal" ? "xPercent" : "yPercent";
    const scrub = el.getAttribute("data-parallax-scrub");
    const scrubVal = !scrub || parseFloat(scrub);
    const startAttr = el.getAttribute("data-parallax-start");
    const from = startAttr !== null ? parseFloat(startAttr) : 20;
    const endAttr = el.getAttribute("data-parallax-end");
    const to = endAttr !== null ? parseFloat(endAttr) : -20;
    const sStart = "clamp(" + (el.getAttribute("data-parallax-scroll-start") || "top bottom") + ")";
    const sEnd = "clamp(" + (el.getAttribute("data-parallax-scroll-end") || "bottom top") + ")";
    const tween = gsap.fromTo(target,
      { [prop]: from },
      { [prop]: to, ease: "none", scrollTrigger: { trigger: el, start: sStart, end: sEnd, scrub: scrubVal } });
    cleanups.push(() => { tween.scrollTrigger && tween.scrollTrigger.kill(); tween.kill(); });
  });
  return () => cleanups.forEach((fn) => fn());
}

/* ----------------- Chargement de page (runPageLoad, JS:551-579) ----------- */

export function runPageLoad(container, delay) {
  const gsap = gsapReady();
  if (!gsap || isCaptureMode()) return;
  const heroContent = container.querySelector("[data-hero-content]");
  const scope = heroContent || container.querySelector(".section") || container;
  const staggered = scope.querySelectorAll("[data-load-stagger]");
  const heroTitle = container.querySelector("[data-anim-hero]");
  const heroFade = container.querySelector("[data-hero-fade]");

  const d = delay || 0.1;
  let split = null;
  if (heroTitle) {
    split = new window.SplitText(heroTitle, { type: "words, chars", charsClass: "char" });
    heroTitle.setAttribute("aria-label", split.textContent || heroTitle.textContent);
    gsap.set(split.chars, { x: "-0.25em", autoAlpha: 0 });
  }
  const tl = gsap.timeline({
    defaults: {
      ease: "slush-bounce",
      onStart: () => {
        if (lenis) lenis.start();
        gsap.set(container, { height: "auto", overflow: "clip" });
      },
    },
    delay: d,
  });
  if (heroContent) tl.to(heroContent, { opacity: 1, duration: 0.1, ease: "power1" }, 0);
  if (split && split.chars.length) tl.to(split.chars, { x: "0em", duration: 0.65, autoAlpha: 1, stagger: { each: 0.015, from: "end" } }, 0);
  if (staggered.length) tl.fromTo(staggered, { y: "3em", autoAlpha: 0 }, { y: "0em", autoAlpha: 1, stagger: 0.1, duration: 1, ease: "slush-bounce" }, "<+=0.5");
  if (heroFade) tl.fromTo(heroFade, { autoAlpha: 0 }, { autoAlpha: 1 }, "<");
}

/* ------------- Transition de page (volets 3D, JS:583-679) ----------------- */

function paintTiles() {
  const gsap = gsapReady();
  const tiles = gsap.utils.shuffle(TILE_COLORS.slice());
  document.querySelectorAll(".page-transition-el").forEach((el, i) => {
    if (i < tiles.length) gsap.set(el, { backgroundColor: tiles[i] });
  });
  return document.querySelectorAll(".page-transition-el");
}

/* Défait le remballage posé par l'outro : remet .main-w à sa place dans
   .page-w et supprime le wrapper — indispensable en SPA, la maquette ne
   connaissait pas ce problème (navigation = rechargement complet). */
export function unwrapMain() {
  const main = document.querySelector(".main-w");
  if (!main) return;
  const wrapper = main.closest(".mgs-transition-wrapper");
  if (wrapper && wrapper.parentNode) {
    wrapper.parentNode.insertBefore(main, wrapper);
    wrapper.remove();
  }
}

/* Moitié 1 — au clic sur un lien interne : la page s'envole, puis `done`
   (le routeur navigue). Transcription de runTransitionOut (JS:594-631). */
export function runTransitionOut(done) {
  const gsap = gsapReady();
  const main = document.querySelector(".main-w");
  if (!gsap || !main) { done(); return; }
  const pageW = main.parentElement;
  const wrapper = document.createElement("div");
  wrapper.className = "mgs-transition-wrapper";
  const tiles = paintTiles();
  const scrollY = window.scrollY; // capturé AVANT le scrollTo(0,0)
  // Un clic peut partir pendant que l'INTRO de la page courante anime
  // encore .main-w / les volets : on tue ces tweens avant de poser les
  // états de l'outro (sinon les deux timelines se battent sur les mêmes
  // propriétés et la page arrive dans un état moitié intro moitié outro).
  gsap.killTweensOf(main);
  gsap.killTweensOf(tiles);
  // Un clic durant l'intro l'a interrompue : killTweens fige les transforms
  // à leurs valeurs intermédiaires. On les réinitialise avant de poser l'état
  // de sortie (position: absolute, top: -scrollY) pour éviter que .main-w
  // reste tourné/décalé dans le volet de sortie.
  gsap.set(main, { clearProps: "transform" });

  gsap.set(wrapper, {
    width: "100%", height: "100vh", overflow: "hidden",
    position: "fixed", left: 0, top: 0, zIndex: 2,
    clipPath: "inset(0px round 2em)",
  });
  pageW.insertBefore(wrapper, main);
  wrapper.appendChild(main);
  window.scrollTo(0, 0);
  document.body.setAttribute("data-scrolling-direction", "down");
  document.body.setAttribute("data-scrolling-started", "false");

  const D = 1.25, C = 0.8;
  gsap.timeline({
    defaults: { ease: "slush-bounce" },
    onComplete: done,
  })
    .set([pageW, main], { height: "100vh", overflow: "hidden", perspective: 1000 })
    .set(tiles[0], { display: "block", z: "-50vw", rotateY: 45, xPercent: -200 })
    .set(tiles[1], { display: "block", z: "-50vw", rotateY: -45, xPercent: 200 })
    .set(tiles[2], { display: "block", z: "-25vw", rotateY: -45, xPercent: 200 })
    .set(main, { left: "0", right: "0", zIndex: 2, position: "absolute", top: -scrollY + "px" })
    .to(main, { "--overlay": "0", duration: 0.15, ease: "power1" })
    .to(wrapper, { z: "-100vw", duration: C }, "<")
    .to(tiles[0], { xPercent: -100, rotateY: 22.5, z: "-85vw", duration: C }, "<")
    .to(tiles[1], { xPercent: 100, rotateY: -22.5, z: "-85vw", duration: C }, "<")
    .to(wrapper, { rotateY: 45, xPercent: -200, z: "-50vw", duration: D }, ">-=0.25")
    .to(tiles[0], { xPercent: -300, rotateY: 67.5, z: "-25vw", duration: D }, "<")
    .to(tiles[1], { xPercent: -100, rotateY: 22.5, z: "-85vw", duration: D }, "<")
    .to(tiles[2], { xPercent: 100, rotateY: -22.5, z: "-85vw", duration: D }, "<");
}

/* Version reduced-motion de l'outro (JS:633-650). */
export function runReducedTransitionOut(done) {
  const gsap = gsapReady();
  const main = document.querySelector(".main-w");
  if (!gsap || !main) { done(); return; }
  const pageW = main.parentElement;
  const wrapper = document.createElement("div");
  wrapper.className = "mgs-transition-wrapper";
  gsap.set(wrapper, {
    width: "100%", height: "100vh", overflow: "hidden",
    position: "fixed", left: 0, top: 0, zIndex: 2,
    clipPath: "inset(0px round 2em)",
  });
  pageW.insertBefore(wrapper, main);
  wrapper.appendChild(main);
  window.scrollTo(0, 0);
  gsap.timeline({ defaults: { ease: "slush" }, onComplete: done })
    .to(wrapper, { autoAlpha: 0, duration: 0.4 });
}

/* Moitié 2 — arrivée de la nouvelle page en 3D (JS:653-679). Le wrapper
   éventuel de l'outro est défait AVANT toute pose d'état. */
export function runTransitionIn(onIntroEnd) {
  const gsap = gsapReady();
  if (!gsap) return;
  unwrapMain();
  const main = document.querySelector(".main-w");
  const tiles = paintTiles();
  const heroFade = main && main.querySelector("[data-hero-fade]");
  const D = 1.25, C = 0.8, U = 45;

  const tl = gsap.timeline({
    defaults: { ease: "slush-bounce" },
    onComplete: () => {
      if (lenis) lenis.start();
      window.ScrollTrigger.refresh();
      gsap.set([main && main.parentElement, main], { clearProps: true });
      gsap.set(tiles, { display: "none" });
      if (onIntroEnd) onIntroEnd();
    },
  })
    .set([main && main.parentElement, main], { height: "100vh", overflow: "hidden", perspective: 1000 })
    .set(tiles[0], { display: "block", z: "-50vw", rotateY: 45, xPercent: -200 })
    .set(tiles[1], { display: "block", z: "-50vw", rotateY: -45, xPercent: 200 })
    .set(tiles[2], { display: "block", z: "-25vw", rotateY: -45, xPercent: 200 })
    .set(main, { rotateY: -45, xPercent: 200, z: "-50vw", "--overlay": "0", borderRadius: "2em" })
    .set(heroFade, { autoAlpha: 0 })
    .to(main, { rotateY: 0, xPercent: 0, z: "-100vw", duration: D })
    .to(main, { "--overlay": "0", z: "0vw", borderRadius: "0em", ease: "slush", duration: C }, ">-=0.5")
    .to(tiles[1], { xPercent: -200, rotateY: U, z: "-25vw", duration: 1.875 }, "<+=0.2")
    .to(tiles[2], { xPercent: 200, rotateY: -45, z: "-25vw", duration: 1.875, onStart: () => { runPageLoad(main, 0.15); } }, "<")
    .set(tiles, { display: "none" });
}

/* Arrivée de la nav pilule au chargement (JS:757). */
export function navArrive() {
  const gsap = gsapReady();
  if (!gsap || isCaptureMode()) return;
  gsap.to("#navContainer", { y: "0%", ease: "slush", duration: 0.8, delay: 0.6 });
}

/* Mode capture : états finaux posés SANS tweens (JS:706-719). */
export function applyCaptureState() {
  if (!isCaptureMode()) return false;
  document.documentElement.classList.add("capture");
  const nav = document.getElementById("navContainer");
  const gsap = gsapReady();
  if (nav) {
    if (gsap) gsap.set(nav, { y: "0%" });
    else nav.style.transform = "translate(0,0)";
  }
  if (gsap) {
    document.querySelectorAll(".page-transition-el").forEach((el) => gsap.set(el, { display: "none" }));
    const main = document.querySelector(".main-w");
    if (main) gsap.set(main, { clearProps: true });
    gsap.set('[data-load-stagger], [data-hero-fade], [data-card-reveal="card"]', { clearProps: true });
  }
  document.body.setAttribute("data-scrolling-started", "false");
  return true;
}
