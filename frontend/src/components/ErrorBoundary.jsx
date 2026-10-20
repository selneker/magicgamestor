import { Component } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { translations } from "@/i18n/translations";

const LANG_KEY = "mgs_lang";

// The boundary can fire before the LanguageProvider is usable (or because of
// it), so it reads the stored language directly instead of using useLang().
// Anything other than an exact "en" falls back to French.
function readLang() {
  try {
    return localStorage.getItem(LANG_KEY) === "en" ? "en" : "fr";
  } catch (_) {
    return "fr";
  }
}

/**
 * Last line of defence: catches a render error anywhere in the app (including
 * the providers) and shows a readable screen instead of a white page.
 *
 * - The error and its stack go to the console, never to the screen.
 * - The message follows the stored language, French by default.
 * - "Recharger" reloads the page.
 *
 * Mounted in src/index.js, outside every provider, on purpose.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // The stack trace stays in the console: it is not shown to the customer.
    console.error("[MagicGameStore] Erreur de rendu", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const lang = readLang();
    const t = translations[lang]?.error || translations.fr.error;

    return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-6 text-center text-foreground">
        <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden="true" />
        <h1 className="font-display text-2xl font-bold">{t.title}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t.body}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex h-12 items-center gap-2 rounded-full border border-[color:var(--rule-strong)] bg-primary px-6 text-sm font-bold text-primary-foreground shadow-[var(--shadow-brut)] transition-[background-color,color] hover:bg-foreground hover:text-background"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t.reload}
        </button>
      </div>
    );
  }
}
