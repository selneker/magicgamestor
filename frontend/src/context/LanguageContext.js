import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { translations } from "@/i18n/translations";

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem("mgs_lang") || "fr");
  const setLang = useCallback((l) => {
    localStorage.setItem("mgs_lang", l);
    setLangState(l);
    document.documentElement.lang = l;
  }, []);
  const t = useCallback(
    (path, vars) => {
      const value = path.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), translations[lang]) ?? path;
      return vars && typeof value === "string" ? value.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`)) : value;
    },
    [lang]
  );
  const value = useMemo(() => ({ lang, setLang, t, toggle: () => setLang(lang === "fr" ? "en" : "fr") }), [lang, setLang, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export const useLang = () => useContext(LanguageContext);

export const localized = (obj, field, lang) => (lang === "en" && obj?.[`${field}_en`]) || obj?.[`${field}_fr`] || obj?.[field] || "";
