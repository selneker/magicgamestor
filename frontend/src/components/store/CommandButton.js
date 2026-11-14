// Command button, by DesignBookmark (https://designbookmark.com/motion#db-command-button). MIT.
// PL-005-FE-02 — composant fourni par le propriétaire (ANNEXE A), adapté aux
// conventions du projet : React (JSX, pas de TS), `framer-motion` (déjà
// dépendance 11.18 — le paquet `motion` est son renommage, même API), pas de
// directive "use client" (CRA). Les variables `--cb-*` du THEME sont posées
// dans index.css (`.command-btn`, valeurs d'origine) et REMAPPÉES sur les
// tokens du site en thème clair pour garder un contraste AA — le thème sombre
// garde les valeurs du composant. Le style inline ne porte plus les couleurs :
// un mapping CSS ne pourrait pas surcharger un style inline.
//
// Un bouton discret qui porte son raccourci clavier. Clic ou ⌘K/Ctrl+K
// n'importe où sur la page et la pilule s'ouvre en champ de recherche, les
// touches s'allument à l'enfoncement. Échap, clic dehors ou champ vide
// referment. Aucune ombre, aucune bordure.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring } from "framer-motion";

// prefers-reduced-motion lu DIRECTEMENT (jamais framer-motion `useReducedMotion`,
// dont l'initialisation du listener plante dans jsdom et casse les tests) —
// même convention que Header.js / GameSelector.js / CartDrawer.js.
const prefersReducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- Look and motion: everything worth tuning lives here. -----------------
// (Les valeurs vivent dans index.css sous `.command-btn` — voir ce fichier.)

// The press: settles in about 200ms with no overshoot.
const PRESS = { stiffness: 520, damping: 34, mass: 0.6 };
// The open: bounce 0 = no overshoot, 100 = clearly springy.
const openSpring = (bounce) => ({
  type: "spring",
  stiffness: 300,
  damping: 34 - (Math.min(100, Math.max(0, bounce)) / 100) * 20,
});
const SWAP = { duration: 0.18, ease: [0.23, 1, 0.32, 1] };

// ---- Shortcut parsing. ----------------------------------------------------

const MODIFIERS = ["mod", "ctrl", "alt", "shift"];
const MAC = { mod: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" };
const PC = { mod: "Ctrl", ctrl: "Ctrl", alt: "Alt", shift: "Shift" };

function parse(shortcut) {
  const parts = shortcut.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
  const modifiers = parts.filter((p) => MODIFIERS.includes(p));
  const key = parts.find((p) => !MODIFIERS.includes(p)) ?? "k";
  return { modifiers, key };
}

// By physical key too: Option on a Mac changes event.key (Option+K types "˚").
const isKey = (e, key) =>
  e.key.toLowerCase() === key || e.code === `Key${key.toUpperCase()}` || e.code === `Digit${key}`;

const noSubscribe = () => () => {};
function readIsMac() {
  const nav = navigator;
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform ?? navigator.platform);
}

function isDown(m, e, mac) {
  if (m === "mod") return mac ? e.metaKey : e.ctrlKey;
  if (m === "ctrl") return e.ctrlKey;
  if (m === "alt") return e.altKey;
  return e.shiftKey;
}

const typing = (t) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

// ---- Parts. ---------------------------------------------------------------

function Key({ label, on = false }) {
  return (
    <kbd
      data-on={on || undefined}
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] bg-[color:var(--cb-key)] px-1.5 font-sans text-[11px] font-medium leading-none text-[color:var(--cb-muted)] transition-colors duration-150 data-[on]:bg-[color:var(--cb-key-on)] data-[on]:text-[color:var(--cb-strong)] data-[on]:duration-75"
    >
      {label}
    </kbd>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-[color:var(--cb-muted)]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export default function CommandButton({
  children = "Search",
  shortcut = "mod+k",
  placeholder = "Search tools...",
  onSearch,
  width = 300,
  bounce = 30,
  autoClose,
  className = "",
  style,
}) {
  const root = useRef(null);
  const input = useRef(null);
  const reduce = prefersReducedMotion();
  // null on the server and in the first client render, so the markup matches; then the real answer.
  const mac = useSyncExternalStore(noSubscribe, readIsMac, () => null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Which keys are down: this one IS state, the caps need to re-render.
  const [held, setHeld] = useState({ mods: [], key: false });

  // The press is a motion value with a spring on it: no re-render per frame.
  const pressTarget = useMotionValue(1);
  const scale = useSpring(pressTarget, PRESS);
  const press = (down) => pressTarget.set(down && !reduce ? 0.97 : 1);

  const { modifiers, key } = parse(shortcut);
  const live = useRef({ modifiers, key, open });
  useLayoutEffect(() => {
    live.current = { modifiers, key, open };
  });
  // Only a real person's press takes the focus; a scripted one (a demo
  // playing by itself) must not pull focus.
  const takeFocus = useRef(false);

  const openWith = (trusted) => {
    takeFocus.current = trusted;
    setOpen(true);
  };
  const close = () => {
    if (!live.current.open) return;
    setOpen(false);
    setQuery("");
    input.current?.blur();
  };

  useEffect(() => {
    if (mac === null) return;
    const sync = (e, down) => {
      const { modifiers, key } = live.current;
      const next = { mods: modifiers.filter((m) => isDown(m, e, mac)), key: down && isKey(e, key) };
      setHeld((cur) => (cur.key === next.key && cur.mods.join() === next.mods.join() ? cur : next));
      press(next.key || next.mods.length > 0);
    };
    const onDown = (e) => {
      const { modifiers, key, open } = live.current;
      if (open) return;
      if (!modifiers.some((m) => m !== "shift") && typing(e.target)) return;
      sync(e, true);
      if (!e.repeat && modifiers.every((m) => isDown(m, e, mac)) && isKey(e, key)) {
        e.preventDefault();
        openWith(e.isTrusted);
      }
    };
    const onUp = (e) => sync(e, false);
    const release = () => {
      setHeld({ mods: [], key: false });
      press(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", release);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mac]);

  // A click outside folds it back.
  useEffect(() => {
    if (!open) return;
    const away = (e) => {
      if (!root.current?.contains(e.target)) close();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  useEffect(() => {
    if (!open || !autoClose || query) return;
    const t = setTimeout(() => close(), autoClose);
    return () => clearTimeout(t);
  }, [open, autoClose, query]);

  const labels = mac === false ? PC : MAC;

  return (
    <motion.div
      ref={root}
      layout
      transition={{ layout: reduce ? { duration: 0 } : openSpring(bounce) }}
      style={{ ...style, scale, borderRadius: 20, width: open ? width : "auto" }}
      data-testid="command-button"
      onPointerDown={(e) => {
        if (open) return;
        press(true);
      }}
      onPointerUp={() => press(false)}
      onPointerLeave={() => press(false)}
      className={`command-btn relative flex h-10 items-center overflow-hidden bg-[color:var(--cb-bg)] text-sm font-medium text-[color:var(--cb-text)] transition-colors duration-150 ${open ? "" : "hover:bg-[color:var(--cb-bg-hover)]"} ${className}`}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {open ? (
          <motion.div
            key="field"
            className="flex w-full items-center gap-2.5 pl-3.5 pr-2.5"
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)", transition: { ...SWAP, delay: 0.06 } }}
            exit={{ opacity: 0, filter: "blur(4px)", transition: SWAP }}
            onAnimationStart={() => takeFocus.current && input.current?.focus({ preventScroll: true })}
          >
            <SearchIcon />
            <input
              ref={input}
              data-testid="command-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
                if (e.key === "Enter" && query.trim()) onSearch?.(query.trim());
              }}
              onBlur={() => !query && close()}
              placeholder={placeholder}
              aria-label={placeholder}
              className="min-w-0 flex-1 bg-transparent text-[color:var(--cb-strong)] outline-none placeholder:text-[color:var(--cb-placeholder)]"
            />
            <Key label="Esc" />
          </motion.div>
        ) : (
          <motion.button
            key="button"
            type="button"
            data-testid="command-button-trigger"
            aria-keyshortcuts={[...modifiers.map((m) => (m === "mod" ? (mac ? "Meta" : "Control") : m[0].toUpperCase() + m.slice(1))), key.toUpperCase()].join("+")}
            aria-expanded={false}
            onClick={(e) => openWith(e.isTrusted)}
            className="flex h-10 cursor-pointer select-none items-center gap-3 whitespace-nowrap pl-4 pr-2.5 outline-none"
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)", transition: { ...SWAP, delay: 0.06 } }}
            exit={{ opacity: 0, filter: "blur(4px)", transition: SWAP }}
          >
            {children}
            <span aria-hidden="true" className={`flex items-center gap-1 transition-opacity duration-200 ${mac === null ? "opacity-0" : ""}`}>
              {modifiers.map((m) => (
                <Key key={m} label={labels[m]} on={held.mods.includes(m)} />
              ))}
              <Key label={key.length === 1 ? key.toUpperCase() : key} on={held.key} />
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
