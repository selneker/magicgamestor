/* ============================================================
   Magic Game Store — design system (maquette PL-DS-003, refonte fidèle)
   Port du bundle d'animations Osmo de la référence « Defi — Slush App » :
   easings CustomEase (slush / slush-bounce), Lenis, menu, curseur,
   marquee, reveals (SplitText), parallaxe, chargement et transition 3D.
   Adaptations (sans Barba/jQuery, indisponible en file://) :
   - la transition de page est portée en DEUX moitiés : outro au clic
     sur un lien interne puis navigation, intro au chargement ;
   - les Lottie sont ignorés (aucun fichier .json embarqué) ;
   - runHomeLoad / initSlideShows / initTabSystem écartés (pas de
     markup correspondant dans les pages Magic Game).
   Sans GSAP, la classe no-gsap rétablit la visibilité (CSS de secours).
   ============================================================ */
(function () {
  "use strict";

  var docEl = document.documentElement;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  docEl.classList.add("has-js");
  if (reduced) docEl.classList.add("reduced-motion");

  /* ============================================================
     LOGIQUE MAGIC GAME (indépendante de GSAP)
     Icônes : pop à l'entrée, pause hors écran, hover lock/launch.
     ============================================================ */

  function initIcons() {
    var pops = document.querySelectorAll(".ic-anim-pop");
    if (pops.length && "IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("is--popped");
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.2 });
      pops.forEach(function (p) { io.observe(p); });
    } else {
      pops.forEach(function (p) { p.classList.add("is--popped"); });
    }

    // Pause des boucles hors écran (économie CPU).
    if ("IntersectionObserver" in window) {
      var zones = document.querySelectorAll(".ic-anim-float, .ic-anim-coin, .ic-anim-gear, .ic-anim-twinkle");
      var io2 = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          e.target.classList.toggle("ic-paused", !e.isIntersecting);
        });
      }, { threshold: 0 });
      zones.forEach(function (z) { io2.observe(z); });
    }

    // Survol lock / launch : piloté par JS (:hover ne traverse pas <use>).
    if (window.matchMedia("(hover: hover)").matches) {
      document.querySelectorAll(".ic-anim-lock, .ic-anim-launch").forEach(function (svg) {
        svg.addEventListener("mouseenter", function () {
          svg.classList.remove("is--hover");
          void svg.offsetWidth;
          svg.classList.add("is--hover");
        });
        svg.addEventListener("mouseleave", function () { svg.classList.remove("is--hover"); });
      });
    }
  }

  /* ------------------------- Vitrine : rejouer une animation ------------------------- */

  function initReplay() {
    document.querySelectorAll("[data-replay]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var cell = btn.closest(".icon-cell");
        var use = cell && cell.querySelector("use");
        if (!use) return;
        var clone = use.cloneNode(true);
        use.parentNode.replaceChild(clone, use);
        var svg = cell.querySelector("svg");
        if (svg) {
          svg.classList.remove("is--popped");
          void svg.offsetWidth;
          svg.classList.add("is--popped");
        }
      });
    });
  }

  /* ------------------------- Slider (data-slideshow, vitrine) ------------------------- */

  function initSliders() {
    document.querySelectorAll("[data-slideshow]").forEach(function (slider) {
      var slides = Array.prototype.slice.call(slider.querySelectorAll('[data-slideshow="slide"]'));
      if (!slides.length) return;

      var barsWrap = slider.querySelector(".img-slider__progress");
      var prev = slider.querySelector("[data-slideshow-prev]");
      var next = slider.querySelector("[data-slideshow-next]");
      var duration = 5000, timer = null, index = 0;

      if (barsWrap && !barsWrap.children.length) {
        slides.forEach(function () {
          var bar = document.createElement("div");
          bar.className = "img-slider__bar";
          bar.innerHTML = '<div class="img-slider__bar-fill"></div>';
          barsWrap.appendChild(bar);
        });
      }
      var bars = barsWrap ? Array.prototype.slice.call(barsWrap.children) : [];

      function show(i) {
        index = (i + slides.length) % slides.length;
        slides.forEach(function (s, k) { s.classList.toggle("is--current", k === index); });
        bars.forEach(function (b, k) {
          b.classList.remove("is--current");
          if (k === index) { void b.offsetWidth; b.classList.add("is--current"); }
        });
        schedule();
      }
      function schedule() {
        clearTimeout(timer);
        timer = setTimeout(function () { show(index + 1); }, duration);
      }
      if (prev) prev.addEventListener("click", function () { show(index - 1); });
      if (next) next.addEventListener("click", function () { show(index + 1); });
      slider.addEventListener("mouseenter", function () { clearTimeout(timer); });
      slider.addEventListener("mouseleave", schedule);
      if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (entries) {
          entries.forEach(function (e) { if (!e.isIntersecting) clearTimeout(timer); else schedule(); });
        }).observe(slider);
      }
      show(0);
    });
  }

  /* ------------------------- Bascules génériques (data-toggle) ------------------------- */

  function initToggles() {
    document.querySelectorAll("[data-toggle]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = document.querySelector(btn.getAttribute("data-toggle"));
        if (!target) return;
        var open = target.classList.toggle("is--open");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });
    document.addEventListener("click", function (e) {
      document.querySelectorAll(".game-popup.is--open").forEach(function (p) {
        if (!p.contains(e.target) && !e.target.closest('[data-toggle="#' + p.id + '"]')) {
          p.classList.remove("is--open");
          var btn = document.querySelector('[data-toggle="#' + p.id + '"]');
          if (btn) btn.setAttribute("aria-expanded", "false");
        }
      });
    });
  }

  /* ------------------------- Simulation « ajout au panier » -------------------------
     Le « + » devient un coche (is--added), la pilule de prix rebondit, un
     point volant rejoint la surface panier (pastille flottante ≥992,
     barre d'achat en dessous). Compteur + total réels, annoncés en
     aria-live. reduced-motion : pas de vol, juste les retours d'état. */

  function initCartSim() {
    var adds = document.querySelectorAll(".product-card__add");
    if (!adds.length) return;
    var pill = document.querySelector(".cart-pill");
    var bar = document.querySelector(".buy-bar");
    var barPrice = bar ? bar.querySelector(".price") : null;
    var count = 0, total = 0;
    var timers = new WeakMap();

    // Région vive pour les lecteurs d'écran
    var live = document.createElement("div");
    live.setAttribute("aria-live", "polite");
    live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap";
    document.body.appendChild(live);

    function fmt(n) { return n.toLocaleString("fr-FR").replace(/[\u202f\u00a0,]/g, " ") + " Ar"; }
    function bump(el) {
      if (!el) return;
      el.classList.remove("is--bump", "is--bumped");
      void el.offsetWidth;
      el.classList.add(el === pill ? "is--bump" : "is--bumped");
    }
    function targetEl(btn) {
      if (window.innerWidth >= 992 && pill) return pill;
      return bar ? bar.querySelector(".button-main") : null;
    }
    function fly(fromEl, toEl, done) {
      if (reduced || !toEl || typeof fromEl.animate !== "function") { done(); return; }
      var a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
      var d = document.createElement("div");
      d.className = "cart-fly";
      var x0 = a.left + a.width / 2 - 7, y0 = a.top + a.height / 2 - 7;
      var x1 = b.left + b.width / 2 - 7, y1 = b.top + b.height / 2 - 7;
      var xm = (x0 + x1) / 2, ym = Math.min(y0, y1) - 60;
      d.style.left = x0 + "px";
      d.style.top = y0 + "px";
      document.body.appendChild(d);
      var anim = d.animate([
        { transform: "translate(0,0) scale(1)", offset: 0 },
        { transform: "translate(" + (xm - x0) + "px," + (ym - y0) + "px) scale(.9)", offset: .55 },
        { transform: "translate(" + (x1 - x0) + "px," + (y1 - y0) + "px) scale(.4)", offset: 1 }
      ], { duration: 550, easing: "cubic-bezier(.32,.72,0,1)" });
      anim.onfinish = function () { d.remove(); done(); };
      anim.oncancel = function () { d.remove(); done(); };
    }

    adds.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var card = btn.closest(".product-card");
        var priceTxt = card ? card.querySelector(".product-card__price") : null;
        var price = priceTxt ? parseInt(priceTxt.textContent.replace(/[^\d]/g, ""), 10) || 0 : 0;
        count += 1;
        total += price;
        var label = btn.getAttribute("aria-label") || "Article";

        // coche + rebond de pilule (retimer si double-clic)
        var t = timers.get(btn);
        if (t) clearTimeout(t);
        btn.classList.add("is--added");
        timers.set(btn, setTimeout(function () { btn.classList.remove("is--added"); }, 1200));
        bump(card ? card.querySelector(".product-card__pill") : null);

        // mise à jour des surfaces panier
        if (pill) {
          pill.querySelector(".cart-count").textContent = count;
          pill.querySelector(".cart-total").textContent = fmt(total);
          if (!pill.classList.contains("is--visible")) pill.classList.add("is--visible");
        }
        if (barPrice) {
          barPrice.childNodes[0].nodeValue = fmt(total);
          var small = barPrice.querySelector("small");
          if (small) small.textContent = count + (count > 1 ? " articles" : " article") + " dans le panier";
        }

        fly(btn, targetEl(btn), function () { bump(pill); if (window.innerWidth < 992 && bar) bump(bar); });
        live.textContent = label.replace(/^Ajouter au panier : /, "") + " ajouté — " + count +
          (count > 1 ? " articles" : " article") + ", " + fmt(total);
      });
    });
  }

  /* ============================================================
     PORT OSMO (GSAP requis)
     ============================================================ */

  if (!window.gsap || !window.ScrollTrigger || !window.SplitText || !window.CustomEase) {
    // Fallback : sans GSAP, réaffiche la nav et laisse le CSS no-gsap
    // rétablir les états opaques. La logique MG reste active.
    docEl.classList.add("no-gsap");
    var nav = document.getElementById("navContainer");
    if (nav) nav.style.transform = "translate(0,0)";
    document.addEventListener("DOMContentLoaded", function () {
      document.body.setAttribute("data-scrolling-started", "false");
      initIcons(); initSliders(); initReplay(); initToggles(); initCartSim();
    });
    return;
  }

  var gsap = window.gsap, ScrollTrigger = window.ScrollTrigger;
  gsap.registerPlugin(ScrollTrigger, window.SplitText, window.CustomEase);

  /* ——— easings exacts de la référence ——— */
  window.CustomEase.create("slush", "0.65, 0.05, 0, 1");
  window.CustomEase.create("slush-bounce",
    "M0,0 L0.076,0.5737 L0.1187,0.8382 L0.1419,0.9463 L0.1654,1.0292 L0.1897,1.0886 L0.2153,1.1258 L0.2297,1.137 L0.2448,1.1424 L0.261,1.1423 L0.2786,1.1366 L0.3101,1.1165 L0.3862,1.0507 L0.4257,1.0219 L0.4699,0.9995 L0.5163,0.9872 L0.5877,0.9842 L0.8126,1.0011 L1,1");
  gsap.defaults({ ease: "slush", duration: 0.525 });

  var lenis = null;
  var MM = gsap.matchMedia();
  var BREAKPOINT = 768;
  var menuState = false; // false = fermé

  /* ------------------------- Lenis ------------------------- */

  function initLenis() {
    if (!window.Lenis) return;
    lenis = new Lenis({ lerp: 0.12 });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(function (time) { lenis.raf(1000 * time); });
    gsap.ticker.lagSmoothing(0);
  }

  /* ------------------------- Détection du sens de scroll -> nav ------------------------- */

  function initDetectScrollingDirection() {
    var lastY = 0;
    var items = document.querySelectorAll(".nav-inner-li");
    MM.add({ isDesktop: "(min-width: 992px)", isMobile: "(max-width: 991px)" }, function (ctx) {
      window.addEventListener("scroll", function () {
        var y = window.scrollY;
        if (Math.abs(y - lastY) < 10) return;
        var direction = y > lastY ? "down" : "up";
        var started = y > 50;
        lastY = y;
        document.body.setAttribute("data-scrolling-direction", direction);
        document.body.setAttribute("data-scrolling-started", started);
        if (direction === "down" && started) {
          if (ctx.conditions.isDesktop) gsap.to(items, { yPercent: -300, duration: 0.75, ease: "slush-bounce", stagger: { each: 0.03, from: "start" } });
        } else if (direction === "up") {
          if (ctx.conditions.isDesktop) gsap.to(items, { yPercent: 0, duration: 0.75, ease: "slush-bounce", stagger: { each: 0.03, from: "end" } });
        }
      }, { passive: true });
    });
  }

  /* ------------------------- Menu (desktop hover / mobile burger) ------------------------- */

  function initMenu() {
    var btn = document.getElementById("menuButton");
    if (!btn) return;
    var items = document.querySelectorAll(".nav-inner-li");
    var right = document.querySelector(".nav-inner-right");
    var hLine = btn.querySelector(".nav-btn-menu__line.is--h");
    var mm = gsap.matchMedia();

    mm.add("(min-width: 992px)", function () {
      var show = function () {
        gsap.to(items, { yPercent: 0, duration: 0.75, ease: "slush-bounce", stagger: { each: 0.03, from: "end" } });
      };
      var hide = function () {
        gsap.to(items, { yPercent: -300, duration: 0.75, ease: "slush-bounce", stagger: { each: 0.03, from: "start" } });
      };
      btn.addEventListener("mouseenter", show, { passive: true });
      if (right) right.addEventListener("mouseleave", hide, { passive: true });
      return function () {
        btn.removeEventListener("mouseenter", show, { passive: true });
        if (right) right.removeEventListener("mouseleave", hide, { passive: true });
      };
    });

    mm.add("(max-width: 991px)", function () {
      gsap.set(items, { xPercent: 300, yPercent: 0 });
      var toggle = function () {
        if (menuState) {
          gsap.to(items, { xPercent: 300, duration: 0.75, ease: "slush-bounce", stagger: { each: 0.03, from: "start" } });
          btn.style.transform = "rotate(0deg)";
          if (hLine) hLine.style.transform = "scaleX(1)";
          menuState = false;
          btn.setAttribute("aria-expanded", "false");
        } else {
          gsap.to(items, { xPercent: 0, duration: 0.75, ease: "slush-bounce", stagger: { each: 0.03, from: "end" } });
          btn.style.transform = "rotate(90deg)";
          if (hLine) hLine.style.transform = "scaleX(0)";
          menuState = true;
          btn.setAttribute("aria-expanded", "true");
        }
      };
      btn.addEventListener("click", toggle);
      return function () { btn.removeEventListener("click", toggle); };
    });
  }

  /* ------------------------- Curseur personnalisé (quickTo) ------------------------- */

  function initCursor() {
    var cursor = document.querySelector(".cursor");
    if (!cursor) return;
    gsap.set(cursor, { xPercent: 6, yPercent: 50 });
    var toX = gsap.quickTo(cursor, "x", { ease: "power3" });
    var toY = gsap.quickTo(cursor, "y", { ease: "power3" });
    window.addEventListener("mousemove", function (e) {
      var vw = window.innerWidth, vh = window.innerHeight, scrollY = window.scrollY;
      var x = e.clientX, y = e.clientY + scrollY;
      var xp = 6, yp = 50;
      if (x > vw - (cursor.offsetWidth + 16)) xp = -100;
      if (y > scrollY + 0.9 * vh) yp = -120;
      gsap.to(cursor, { xPercent: xp, yPercent: yp, duration: 0.9, ease: "power3" });
      toX(x); toY(y - scrollY);
    });
  }

  function initCursorTargets(scope) {
    var targets = scope.querySelectorAll("[data-cursor]");
    var cursor = document.querySelector(".cursor");
    if (!cursor || !targets.length) return;
    var label = cursor.querySelector("p");
    var current = "";
    targets.forEach(function (el) {
      el.addEventListener("mouseenter", function () {
        var text = el.getAttribute("data-cursor");
        if (text !== current) {
          if (label) label.innerHTML = text;
          current = text;
          void cursor.offsetWidth;
        }
      });
    });
  }

  /* ------------------------- Marquee (direction liée au scroll) ------------------------- */

  function initMarqueeScrollDirection(scope) {
    scope.querySelectorAll("[data-marquee-scroll-direction-target]").forEach(function (el) {
      var collection = el.querySelector("[data-marquee-collection-target]");
      var scrollEl = el.querySelector("[data-marquee-scroll-target]");
      if (!collection || !scrollEl) return;
      var speed = parseFloat(el.dataset.marqueeSpeed);
      var dir = el.dataset.marqueeDirection === "right" ? 1 : -1;
      var duplicate = parseInt(el.dataset.marqueeDuplicate || 0, 10);
      var scrollSpeed = parseFloat(el.dataset.marqueeScrollSpeed);

      var factor = window.innerWidth < 479 ? 0.25 : window.innerWidth < 991 ? 0.5 : 1;
      var duration = speed * (collection.offsetWidth / window.innerWidth) * factor;
      if (reduced) { duration = 100; factor = 0; }

      scrollEl.style.marginLeft = -1 * scrollSpeed + "%";
      scrollEl.style.width = 2 * scrollSpeed + 100 + "%";

      if (duplicate > 0) {
        var frag = document.createDocumentFragment();
        for (var i = 0; i < duplicate; i++) frag.appendChild(collection.cloneNode(true));
        scrollEl.appendChild(frag);
      }

      var collections = el.querySelectorAll("[data-marquee-collection-target]");
      var tween = gsap.to(collections, { xPercent: -100, repeat: -1, duration: duration, ease: "linear" }).totalProgress(0.5);
      gsap.set(collections, { xPercent: dir === 1 ? 100 : -100 });
      tween.timeScale(dir);
      tween.play();
      el.setAttribute("data-marquee-status", "normal");

      ScrollTrigger.create({
        trigger: el, start: "top bottom", end: "bottom top",
        onUpdate: function (self) {
          var down = self.direction === 1;
          tween.timeScale(down ? -dir : dir);
          el.setAttribute("data-marquee-status", down ? "normal" : "inverted");
        }
      });

      // Défilement horizontal lié au scroll vertical.
      var from = dir === -1 ? scrollSpeed : -scrollSpeed;
      var to = -from;
      gsap.timeline({ scrollTrigger: { trigger: el, start: "0% 100%", end: "100% 0%", scrub: 0 } })
        .fromTo(scrollEl, { x: from + "vw" }, { x: to + "vw", ease: "none" });
    });
  }

  /* ------------------------- Reveals (cartes / slant / heading) ------------------------- */

  function initCardReveals(scope) {
    var wraps = scope.querySelectorAll('[data-card-reveal="wrap"]');
    if (!wraps.length) {
      // Sans wrap dédié : chaque carte est son propre déclencheur.
      scope.querySelectorAll('[data-card-reveal="card"]').forEach(function (card) { revealCards(card, [card]); });
      return;
    }
    wraps.forEach(function (wrap) { revealCards(wrap, wrap.querySelectorAll('[data-card-reveal="card"]')); });
  }

  function revealCards(trigger, cards) {
    if (!cards.length) return;
    MM.add({
      isDesktop: "(min-width: " + BREAKPOINT + "px)",
      isMobile: "(max-width: " + (BREAKPOINT - 1) + "px)",
      reduceMotion: "(prefers-reduced-motion: reduce)"
    }, function (ctx) {
      var rm = ctx.conditions.reduceMotion;
      if (!rm) gsap.set(cards, { x: "5em", z: "20em", rotateY: -30, autoAlpha: 0, scale: 0.75 });
      ScrollTrigger.create({
        trigger: trigger, start: "top 80%", once: true,
        onEnter: function () {
          gsap.to(cards, { x: "0em", z: "0em", rotateY: 0, scale: 1, autoAlpha: 1, ease: "slush-bounce", stagger: { amount: 0.2 }, duration: rm ? 0 : 0.85 });
        }
      });
    });
  }

  function initSlantedText(scope) {
    scope.querySelectorAll("[data-anim-slant]").forEach(function (el) {
      MM.add({
        isDesktop: "(min-width: " + BREAKPOINT + "px)",
        isMobile: "(max-width: " + (BREAKPOINT - 1) + "px)",
        reduceMotion: "(prefers-reduced-motion: reduce)"
      }, function (ctx) {
        if (ctx.conditions.reduceMotion) return;
        var split = new window.SplitText(el, { type: "words, chars", charsClass: "char", tag: "span" });
        el.setAttribute("aria-label", el.textContent);
        split.words.forEach(function (w) { w.setAttribute("aria-hidden", "true"); });
        gsap.set(split.chars, { x: "-0.25em", autoAlpha: 0 });
        ScrollTrigger.create({
          trigger: el, start: "top 80%", once: true,
          onEnter: function () {
            gsap.to(split.chars, { ease: "slush-bounce", x: "0em", duration: 0.65, autoAlpha: 1, stagger: { each: 0.015, from: "end" } });
          }
        });
      });
    });
  }

  function initHeadingReveal(scope) {
    scope.querySelectorAll("[data-heading-reveal]").forEach(function (el) {
      MM.add({
        isDesktop: "(min-width: " + BREAKPOINT + "px)",
        isMobile: "(max-width: " + (BREAKPOINT - 1) + "px)",
        reduceMotion: "(prefers-reduced-motion: reduce)"
      }, function (ctx) {
        if (ctx.conditions.reduceMotion) return;
        var split = new window.SplitText(el, { type: "lines, words" });
        el.setAttribute("aria-label", el.textContent);
        gsap.set(el, { position: "relative", perspective: 1000 });
        gsap.set(split.lines, { z: "5em", rotateY: -45, autoAlpha: 0 });
        ScrollTrigger.create({
          trigger: el, start: "top 80%", once: true,
          onEnter: function () {
            gsap.to(split.lines, { ease: "slush-bounce", z: "0em", rotateY: 0, duration: 0.85, autoAlpha: 1, stagger: 0.15 });
          }
        });
      });
    });
  }

  /* ------------------------- Parallaxe globale ------------------------- */

  function initGlobalParallax() {
    gsap.matchMedia().add({
      isMobile: "(max-width:479px)",
      isMobileLandscape: "(max-width:767px)",
      isTablet: "(max-width:991px)",
      isDesktop: "(min-width:992px)"
    }, function (ctx) {
      var c = ctx.conditions;
      var context = gsap.context(function () {
        document.querySelectorAll('[data-parallax="trigger"]').forEach(function (el) {
          var disable = el.getAttribute("data-parallax-disable");
          if (disable === "mobile" && c.isMobile) return;
          if (disable === "mobileLandscape" && c.isMobileLandscape) return;
          if (disable === "tablet" && c.isTablet) return;
          var target = el.querySelector('[data-parallax="target"]') || el;
          var prop = el.getAttribute("data-parallax-direction") === "horizontal" ? "xPercent" : "yPercent";
          var scrub = el.getAttribute("data-parallax-scrub");
          var scrubVal = !scrub || parseFloat(scrub);
          var startAttr = el.getAttribute("data-parallax-start");
          var from = startAttr !== null ? parseFloat(startAttr) : 20;
          var endAttr = el.getAttribute("data-parallax-end");
          var to = endAttr !== null ? parseFloat(endAttr) : -20;
          var sStart = "clamp(" + (el.getAttribute("data-parallax-scroll-start") || "top bottom") + ")";
          var sEnd = "clamp(" + (el.getAttribute("data-parallax-scroll-end") || "bottom top") + ")";
          gsap.fromTo(target, (function () { var o = {}; o[prop] = from; return o; })(), (function () { var o = {}; o[prop] = to; o.ease = "none"; o.scrollTrigger = { trigger: el, start: sStart, end: sEnd, scrub: scrubVal }; return o; })());
        });
      });
      return function () { context.revert(); };
    });
  }

  /* ------------------------- Chargement de page (runPageLoad) ------------------------- */

  function runPageLoad(container, delay) {
    // Scope : le hero ([data-hero-content]) sinon la première section sinon le conteneur.
    var heroContent = container.querySelector("[data-hero-content]");
    var scope = heroContent || container.querySelector(".section") || container;
    var staggered = scope.querySelectorAll("[data-load-stagger]");
    var heroTitle = container.querySelector("[data-anim-hero]");
    var heroFade = container.querySelector("[data-hero-fade]");

    var d = delay || 0.1;
    var split = heroTitle ? new window.SplitText(heroTitle, { type: "words, chars", charsClass: "char" }) : null;
    if (heroTitle && split) {
      heroTitle.setAttribute("aria-label", split.textContent || heroTitle.textContent);
      gsap.set(split.chars, { x: "-0.25em", autoAlpha: 0 });
    }
    var tl = gsap.timeline({
      defaults: {
        ease: "slush-bounce",
        onStart: function () {
          if (lenis) lenis.start();
          gsap.set(container, { height: "auto", overflow: "clip" });
        }
      },
      delay: d
    });
    if (heroContent) tl.to(heroContent, { opacity: 1, duration: 0.1, ease: "power1" }, 0);
    if (split && split.chars.length) tl.to(split.chars, { x: "0em", duration: 0.65, autoAlpha: 1, stagger: { each: 0.015, from: "end" } }, 0);
    if (staggered.length) tl.fromTo(staggered, { y: "3em", autoAlpha: 0 }, { y: "0em", autoAlpha: 1, stagger: 0.1, duration: 1, ease: "slush-bounce" }, "<+=0.5");
    if (heroFade) tl.fromTo(heroFade, { autoAlpha: 0 }, { autoAlpha: 1 }, "<");
  }

  /* ------------------------- Transition de page (2 moitiés, sans Barba) ------------------------- */

  var TILE_COLORS = ["#4da2ff", "#ffd731", "#e9ccff", "#55db9c", "#fb4903", "#5c4ade"];

  function paintTiles() {
    var tiles = gsap.utils.shuffle(TILE_COLORS.slice());
    document.querySelectorAll(".page-transition-el").forEach(function (el, i) {
      if (i < tiles.length) gsap.set(el, { backgroundColor: tiles[i] });
    });
    return document.querySelectorAll(".page-transition-el");
  }

  // Moitié 1 — au clic sur un lien interne : la page s'envole, puis navigation.
  function runTransitionOut(url) {
    var main = document.querySelector(".main-w");
    if (!main) { window.location.href = url; return; }
    var scrollY = window.scrollY; // capturé AVANT le scrollTo(0,0)
    var pageW = main.parentElement;
    var wrapper = document.createElement("div");
    var tiles = paintTiles();

    gsap.set(wrapper, {
      width: "100%", height: "100vh", overflow: "hidden",
      position: "fixed", left: 0, top: 0, zIndex: 2,
      clipPath: "inset(0px round 2em)"
    });
    pageW.insertBefore(wrapper, main);
    wrapper.appendChild(main);
    window.scrollTo(0, 0);
    document.body.setAttribute("data-scrolling-direction", "down");
    document.body.setAttribute("data-scrolling-started", "false");

    var D = 1.25, C = 0.8;
    gsap.timeline({
      defaults: { ease: "slush-bounce" },
      onComplete: function () { window.location.href = url; }
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

  function runReducedTransitionOut(url) {
    var main = document.querySelector(".main-w");
    if (!main) { window.location.href = url; return; }
    var pageW = main.parentElement;
    var wrapper = document.createElement("div");
    gsap.set(wrapper, {
      width: "100%", height: "100vh", overflow: "hidden",
      position: "fixed", left: 0, top: 0, zIndex: 2,
      clipPath: "inset(0px round 2em)"
    });
    pageW.insertBefore(wrapper, main);
    wrapper.appendChild(main);
    window.scrollTo(0, 0);
    gsap.timeline({
      defaults: { ease: "slush" },
      onComplete: function () { window.location.href = url; }
    }).to(wrapper, { autoAlpha: 0, duration: 0.4 });
  }

  // Moitié 2 — au chargement : la nouvelle page arrive en 3D.
  function runTransitionIn() {
    var main = document.querySelector(".main-w");
    var tiles = paintTiles();
    var heroFade = main && main.querySelector("[data-hero-fade]");
    var D = 1.25, C = 0.8, U = 45;

    var tl = gsap.timeline({
      defaults: { ease: "slush-bounce" },
      onComplete: function () {
        if (lenis) lenis.start();
        ScrollTrigger.refresh();
        gsap.set([main && main.parentElement, main], { clearProps: true });
        gsap.set(tiles, { display: "none" });
      }
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
      .to(tiles[2], { xPercent: 200, rotateY: -45, z: "-25vw", duration: 1.875, onStart: function () { runPageLoad(main, 0.15); } }, "<")
      .set(tiles, { display: "none" });
  }

  /* ------------------------- Interception des liens internes ------------------------- */

  function initLinkTransitions() {
    document.addEventListener("click", function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest("a[href]");
      if (!a) return;
      if (a.hasAttribute("data-barba-prevent") || a.target === "_blank" || a.hasAttribute("download")) return;
      var href = a.getAttribute("href");
      if (!href || href.charAt(0) === "#") return;
      var url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
      e.preventDefault();
      if (reduced) runReducedTransitionOut(url.href); else runTransitionOut(url.href);
    });
  }

  /* ============================================================
     BOOT (ordre initGeneral de la référence, élagué)
     Mode capture (?capture dans l'URL) : pose les états finaux
     SANS tweens — pour des captures d'écran déterministes
     (sous virtual-time, rAF ne tourne pas de façon fiable).
     ============================================================ */

  var CAPTURE = /[?&]capture/.test(location.search);

  function applyCaptureState(main) {
    docEl.classList.add("capture");
    var nav = document.getElementById("navContainer");
    if (nav) gsap.set(nav, { y: "0%" });
    document.querySelectorAll(".page-transition-el").forEach(function (el) {
      gsap.set(el, { display: "none" });
    });
    if (main) gsap.set(main, { clearProps: true });
    // reveals posés par ScrollTrigger : tout visible, sans split
    gsap.set('[data-load-stagger], [data-hero-fade], [data-card-reveal="card"]', { clearProps: true });
    document.body.setAttribute("data-scrolling-started", "false");
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.body.setAttribute("data-scrolling-started", "false");
    var main = document.querySelector(".main-w");

    if (CAPTURE) {
      initMenu();
      initLenis();
      initSliders();
      initIcons();
      initReplay();
      initToggles();
      initCartSim();
      applyCaptureState(main);
      return;
    }

    initMenu();
    initCursor();
    initLenis();

    initDetectScrollingDirection();
    initSlantedText(main || document);
    initHeadingReveal(main || document);
    initCardReveals(main || document);
    initMarqueeScrollDirection(main || document);
    initGlobalParallax();
    initCursorTargets(main || document);

    initIcons();
    initSliders();
    initReplay();
    initToggles();
    initCartSim();
    initLinkTransitions();

    // Arrivée de la nav pilule + chargement de la page.
    gsap.to("#navContainer", { y: "0%", ease: "slush", duration: 0.8, delay: 0.6 });
    if (reduced) {
      // Pas d'intro 3D : fondu doux via runPageLoad seul.
      if (main) runPageLoad(main, 0.15);
    } else {
      runTransitionIn();
    }
  });
})();
