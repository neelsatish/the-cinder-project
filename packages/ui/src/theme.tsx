import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { setTheme as setNativeTheme } from "@tauri-apps/api/app";

import { Icon } from "./icons";

export type CinderTheme = "light" | "cinder" | "dark";

const THEME_STORAGE_KEY = "cinder.appearance.theme";
const THEME_COLORS: Record<CinderTheme, string> = {
  light: "#F7F1E7",
  cinder: "#221309",
  dark: "#15171A",
};

function storedTheme(): CinderTheme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "cinder" || stored === "dark" ? stored : "light";
  } catch {
    return "light";
  }
}

function applyDocumentTheme(theme: CinderTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
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
      void setNativeTheme(theme === "light" ? "light" : "dark").catch(() => undefined);
    }
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () =>
        setTheme((current) =>
          current === "light" ? "cinder" : current === "cinder" ? "dark" : "light",
        ),
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
  const { theme, setTheme } = useTheme();

  return (
    <label
      className={`theme-toggle ${className}`.trim()}
      title="Appearance"
    >
      <Icon name={theme === "light" ? "sun" : "moon"} />
      <select
        value={theme}
        onChange={(event) => setTheme(event.target.value as CinderTheme)}
        aria-label="Appearance"
      >
        <option value="light">Light</option>
        <option value="cinder">Cinder original</option>
        <option value="dark">Plain dark</option>
      </select>
    </label>
  );
}
