/** @type {import('tailwindcss').Config} */
module.exports = {
    // `overline` is a Tailwind utility; without this an app's own eyebrow-label class draws a line above the text.
    blocklist: ["overline"],
    darkMode: ["class"],
    content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-body)'],
        serif: ['var(--font-body)'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        display: ['"Bricolage Grotesque"', 'var(--font-display)', 'system-ui', 'sans-serif'],
        body: ['Onest', 'var(--font-body)', 'system-ui', 'sans-serif']
      },
      boxShadow: {},
      borderRadius: {
        lg: '12px',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: '12px',
        '2xl': '14px',
        '3xl': '14px'
      },
      colors: {
        ink: '#111111',
        neo: '#D4FF00',
        paper: '#F8F8F8',
        /* Marque (PL-BRAND-1) : renvoi vers les jetons CSS de src/index.css.
           brand-lime : accents et boutons secondaires sur surface d'encre
           uniquement (~15:1 sur #0A0A0A, ~1,1:1 sur fond clair → jamais en
           texte sur fond clair). brand-sand : fonds de marque. */
        brand: {
          lime: 'var(--brand-lime)',
          sand: 'var(--brand-sand)'
        },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0'
          },
          to: {
            height: 'var(--radix-accordion-content-height)'
          }
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)'
          },
          to: {
            height: '0'
          }
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out'
      }
    }
  },
  plugins: [require("tailwindcss-animate")],
};
