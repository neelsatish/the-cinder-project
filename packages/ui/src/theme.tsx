import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { setTheme as setNativeTheme } from "@tauri-apps/api/app";

import { Icon } from "./icons";
import {
  applyGlassAttribute,
  clearGlassCache,
  initialGlassState,
  measureGlassCapability,
  readGlassMode,
  writeGlassMode,
  type GlassMode,
  type GlassState,
} from "./glassProbe";

export type CinderTheme = "light" | "cinder" | "dark";
export type { GlassMode, GlassState };

const THEME_STORAGE_KEY = "cinder.appearance.theme";
const THEME_COLORS: Record<CinderTheme, string> = {
  light: "#F7F1E7",
  cinder: "#221309",
  dark: "#000000",
};

function storedTheme(): CinderTheme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "cinder" || stored === "dark"
      ? stored
      : "cinder";
  } catch {
    return "cinder";
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

const initialGlassMode = readGlassMode();
applyGlassAttribute(initialGlassState(initialGlassMode));

type ThemeContextValue = {
  theme: CinderTheme;
  setTheme: (theme: CinderTheme) => void;
  toggleTheme: () => void;
  glass: GlassState;
  glassMode: GlassMode;
  setGlassMode: (mode: GlassMode) => void;
  recheckGlass: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<CinderTheme>(initialTheme);
  const [glassMode, setGlassModeState] = useState<GlassMode>(initialGlassMode);
  const [glass, setGlass] = useState<GlassState>(() => initialGlassState(initialGlassMode));

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

  useEffect(() => {
    applyGlassAttribute(glass);
  }, [glass]);

  useEffect(() => {
    let cancelled = false;
    void measureGlassCapability(glassMode).then((result) => {
      if (!cancelled) setGlass(result);
    });
    return () => {
      cancelled = true;
    };
  }, [glassMode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () =>
        setTheme((current) =>
          current === "light" ? "cinder" : current === "cinder" ? "dark" : "light",
        ),
      glass,
      glassMode,
      setGlassMode: (mode) => {
        writeGlassMode(mode);
        setGlassModeState(mode);
      },
      recheckGlass: () => {
        clearGlassCache();
        void measureGlassCapability(glassMode).then(setGlass);
      },
    }),
    [theme, glass, glassMode],
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
        <option value="cinder">Ember</option>
        <option value="dark">Black</option>
      </select>
    </label>
  );
}
