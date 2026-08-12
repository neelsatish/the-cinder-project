import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { setTheme as setNativeTheme } from "@tauri-apps/api/app";

import { Icon } from "./icons";

export type CinderTheme = "light" | "dark";

const THEME_STORAGE_KEY = "cinder.appearance.theme";
const THEME_COLORS: Record<CinderTheme, string> = {
  light: "#F7F1E7",
  dark: "#221309",
};

function storedTheme(): CinderTheme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyDocumentTheme(theme: CinderTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[theme]);
}

const initialTheme = storedTheme();
applyDocumentTheme(initialTheme);

type ThemeContextValue = {
  theme: CinderTheme;
  setTheme: (theme: CinderTheme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<CinderTheme>(initialTheme);

  useEffect(() => {
    applyDocumentTheme(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // A theme preference is optional; the interface still works without storage.
    }

    if ("__TAURI_INTERNALS__" in window) {
      void setNativeTheme(theme).catch(() => undefined);
    }
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => setTheme((current) => (current === "light" ? "dark" : "light")),
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider.");
  return context;
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const nextTheme = theme === "light" ? "dark" : "light";
  const label = `${nextTheme === "dark" ? "Dark" : "Light"} mode`;

  return (
    <button
      className={`theme-toggle ${className}`.trim()}
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${label.toLowerCase()}`}
      title={`Switch to ${label.toLowerCase()}`}
    >
      <Icon name={nextTheme === "dark" ? "moon" : "sun"} />
      <span className="theme-toggle-label">{label}</span>
    </button>
  );
}
