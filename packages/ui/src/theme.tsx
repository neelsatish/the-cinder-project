import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { setTheme as setNativeTheme } from "@tauri-apps/api/app";
import { normaliseCinderTheme, type CinderTheme } from "./themeState";

export { normaliseCinderTheme } from "./themeState";
export type { CinderTheme } from "./themeState";

const THEME_KEY = "cinder.appearance.theme";
const THEME_COLOURS: Record<CinderTheme, string> = {
  light: "#F4F6F2",
  dark: "#0E1210",
  paper: "#F1EEE7",
};

function savedTheme() {
  try {
    return normaliseCinderTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return "light" as const;
  }
}

function applyTheme(theme: CinderTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme === "dark" ? "dark" : "light";
  root.removeAttribute("data-glass");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOURS[theme]);
}

applyTheme(savedTheme());

type ThemeContextValue = { theme: CinderTheme; setTheme: (theme: CinderTheme) => void };
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<CinderTheme>(savedTheme);
  const setTheme = useCallback((next: CinderTheme) => setThemeState(next), []);
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
      localStorage.removeItem("cinder.glassCapability");
      localStorage.removeItem("cinder.effectsOverride");
    } catch {
      // The selected theme still applies for this session.
    }
    if ("__TAURI_INTERNALS__" in window) void setNativeTheme(theme === "dark" ? "dark" : "light").catch(() => undefined);
  }, [theme]);
  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme }), [setTheme, theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider.");
  return context;
}
