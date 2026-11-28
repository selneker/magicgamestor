---
name: mgs-design-system
description: Magic Game Store frontend styling rules — load before editing any CSS, Tailwind class, colour, border, radius, font or theme (light/dark) in frontend/.
---

# Magic Game Store — design system

## The trap: an unlayered remap overrides Tailwind
`src/index.css` has three parts: `@layer base` (tokens: shadcn HSL set, `--rule`, `--cream`, `--font-display/body`…),
`@layer utilities` (`.panel`, `.eyebrow`, `.num`, `.panel-black`…), then an **unlayered block at the end that remaps
Tailwind utilities with `!important`**. Unlayered CSS beats every layered rule, including all shadcn primitives in
`src/components/ui/`. Also `* { border-color: var(--rule) }` gives every element a soft border.

| Written in markup | Actually renders as |
|---|---|
| `text-primary` | body-text colour in light, neon in dark |
| `border-foreground` / `border-slate-900` / `border-black` | `var(--rule)`, soft hairline, **not black** |
| `rounded-full` | 10px — except `span.rounded-full` and `h-1..3`/`w-1..3` → 9999px |
| `rounded-none` | 8px · `rounded-2xl/3xl` → 14px · `rounded-xl/lg` → 12px |
| `bg-white*` | `hsl(var(--card))` · `bg-slate-50/100/200` → `hsl(var(--muted))` |
| `bg-amber-50`, `-orange-`, `-emerald-`, `-sky-`, `-blue-`, `-violet-`, `-rose-50` | one grey: status colours are indistinguishable |
| `bg-emerald-600/500`, `bg-orange-500` | foreground background (the "green" button is black) |
| `hover:bg-slate-50/100/200` | full neon flash |
| `bg-slate-900/950` | foreground background (+ `text-background`) |

Not remapped, so they ship raw and clash with the cream+neon palette: `text-rose-600/700`, `bg-rose-500/100`,
`bg-amber-100`, `bg-slate-700/800`, `text-slate-100/200`, `bg-sky-100`, `bg-emerald-100`, `bg-red-50`, `border-amber-200`.

**Real hard border: `border-ink`** (`#111111`), as `ProductCard` does.

## Fixed surfaces keep fixed foregrounds
- A static colour paired with a theme-relative token is the recurring bug (product names once fell to 1.04:1 in dark mode).
  On a fixed surface (`bg-neo`, `bg-ink`), the text colour must be fixed too (`text-ink` on neon, cream on ink).
- Ink surfaces (`.panel-black`, cart bar, game selector) are `bg-ink` with cream text (`--cream`, never overridden in `.dark`)
  in both themes. Neon is allowed **only** on ink, via `.text-neo-on-ink`; neon on cream is unreadable.
- On ink, `text-background/xx` becomes `text-[color:hsl(var(--cream)/.7)]`, and `text-primary` becomes `text-neo-on-ink`.
- Product cards: never change the card style, only adapt colours per theme.

## Fonts
Onest + Bricolage Grotesque, loaded in the HTML head, exposed as `--font-display` / `--font-body`. In `tailwind.config.js`
the `display`/`body` families list the **literal family name first** — keep that order. `font-mono` is not monospace.
Adding a family = HTML head **and** `:root`.

After any colour change: run the `mgs-contrast-audit` skill.
