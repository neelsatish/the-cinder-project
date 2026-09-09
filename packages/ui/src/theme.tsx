import { createContext, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { setTheme as setNativeTheme } from "@tauri-apps/api/app";

export type CinderTheme = "light";

function applyPaperTheme() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = "light";
  root.style.colorScheme = "light";
  root.removeAttribute("data-glass");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#F7F1E7");
  try {
    localStorage.removeItem("cinder.appearance.theme");
    localStorage.removeItem("cinder.glassCapability");
    localStorage.removeItem("cinder.effectsOverride");
  } catch {
    // Paper still applies when old appearance preferences cannot be cleared.
  }
}

applyPaperTheme();

type ThemeContextValue = { theme: CinderTheme };
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    applyPaperTheme();
    if ("__TAURI_INTERNALS__" in window) void setNativeTheme("light").catch(() => undefined);
  }, []);
  const value = useMemo<ThemeContextValue>(() => ({ theme: "light" }), []);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider.");
  return context;
}
