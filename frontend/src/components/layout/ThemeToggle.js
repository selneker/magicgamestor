import { useEffect } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/context/LanguageContext";

export const ThemeToggle = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const { lang } = useLang();
  const dark = resolvedTheme === "dark";
  const label = lang === "en" ? (dark ? "Light mode" : "Dark mode") : (dark ? "Mode clair" : "Mode sombre");
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0A0A0A" : "#F4F3EE");
  }, [dark]);
  return <Button type="button" variant="ghost" size="icon" data-testid="theme-toggle" aria-label={label} title={label} aria-pressed={dark} className="shrink-0 rounded-none" onClick={() => setTheme(dark ? "light" : "dark")}>
    <Sun className="hidden h-5 w-5 dark:block" strokeWidth={1.75} /><Moon className="h-5 w-5 dark:hidden" strokeWidth={1.75} />
  </Button>;
};
