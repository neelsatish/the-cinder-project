import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  applyGlassAttribute,
  clearGlassCache,
  initialGlassState,
  measureGlassCapability,
  readGlassMode,
  writeGlassMode,
  type GlassMode,
  type GlassState,
} from "@cinder/ui";

// Forge's own theme system — deliberately separate from Matchbox's
// packages/ui ThemeProvider (light/cinder/dark). Three directions built
// from design/brand/BRAND.md tokens: Ember Glass and Nightdesk (both dark,
// liquid-glass panels, differing only in palette and background photo) and
// Forge Brutalist (light, hard borders, flat fills — the one theme that
// never glasses). Switchable at runtime, not a one-off pick.
export type ForgeTheme = "ember-glass" | "forge-brutalist" | "nightdesk";
export type BackgroundMode = "theme" | "image" | "solid" | "pattern";
export type BackgroundPattern = "grid" | "dots" | "diagonal";

type BackgroundSettings = {
  mode: BackgroundMode;
  color: string;
  pattern: BackgroundPattern;
  imageName: string;
};

const FORGE_THEMES: readonly ForgeTheme[] = ["ember-glass", "nightdesk", "forge-brutalist"];
const THEME_LABELS: Record<ForgeTheme, string> = {
  "ember-glass": "Ember Glass",
  "nightdesk": "Nightdesk",
  "forge-brutalist": "Paper",
};

const THEME_STORAGE_KEY = "cinder.forge.theme";
const BACKGROUND_STORAGE_KEY = "cinder.forge.background";
const BACKGROUND_DB_NAME = "cinder-forge-appearance";
const BACKGROUND_STORE = "assets";
const BACKGROUND_IMAGE_KEY = "custom-background";
const DEFAULT_BACKGROUND: BackgroundSettings = { mode: "theme", color: "#101820", pattern: "grid", imageName: "" };

function isForgeTheme(value: string | null): value is ForgeTheme {
  return value !== null && (FORGE_THEMES as string[]).includes(value);
}

function storedTheme(): ForgeTheme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isForgeTheme(stored) ? stored : "ember-glass";
  } catch {
    return "ember-glass";
  }
}

function applyDocumentTheme(theme: ForgeTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "forge-brutalist" ? "light" : "dark";
}

function readBackgroundSettings(): BackgroundSettings {
  try {
    const raw = localStorage.getItem(BACKGROUND_STORAGE_KEY);
    if (!raw) return DEFAULT_BACKGROUND;
    const saved = JSON.parse(raw) as Partial<BackgroundSettings>;
    const mode: BackgroundMode = ["theme", "image", "solid", "pattern"].includes(saved.mode ?? "") ? saved.mode as BackgroundMode : "theme";
    const pattern: BackgroundPattern = ["grid", "dots", "diagonal"].includes(saved.pattern ?? "") ? saved.pattern as BackgroundPattern : "grid";
    const color = typeof saved.color === "string" && /^#[0-9a-f]{6}$/i.test(saved.color) ? saved.color : DEFAULT_BACKGROUND.color;
    return { mode, pattern, color, imageName: typeof saved.imageName === "string" ? saved.imageName : "" };
  } catch {
    return DEFAULT_BACKGROUND;
  }
}

function writeBackgroundSettings(settings: BackgroundSettings) {
  try {
    localStorage.setItem(BACKGROUND_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Appearance preferences are optional; the interface still works without storage.
  }
}

function applyDocumentBackground(settings: BackgroundSettings, imageUrl: string | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.background = settings.mode;
  root.dataset.pattern = settings.pattern;
  root.style.setProperty("--forge-custom-background-color", settings.color);
  if (imageUrl) root.style.setProperty("--forge-custom-background-image", `url("${imageUrl}")`);
  else root.style.removeProperty("--forge-custom-background-image");
}

/* One blob store for every large binary the app owns — the custom
   background and, since reference files landed, each uploaded PDF under
   `pdf:<id>`. Blobs cannot live in the workspace's localStorage record:
   that record is rewritten on every keystroke against a ~5MB quota.
   Same database name, store and version as when this held only the
   background, so no upgrade path is needed. */
export function openAssetDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(BACKGROUND_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BACKGROUND_STORE)) request.result.createObjectStore(BACKGROUND_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local file storage could not be opened."));
  });
}

export async function readAsset(key: string) {
  const database = await openAssetDatabase();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const request = database.transaction(BACKGROUND_STORE, "readonly").objectStore(BACKGROUND_STORE).get(key);
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
      request.onerror = () => reject(request.error ?? new Error("That file could not be read."));
    });
  } finally {
    database.close();
  }
}

export async function writeAsset(key: string, blob: Blob | null) {
  const database = await openAssetDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(BACKGROUND_STORE, "readwrite");
      const store = transaction.objectStore(BACKGROUND_STORE);
      if (blob) store.put(blob, key);
      else store.delete(key);
      transaction.onabort = () => reject(transaction.error ?? new Error("Local file operation was cancelled."));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("That file could not be saved."));
    });
  } finally {
    database.close();
  }
}

/** Deletes every blob whose key starts with one of `prefixes`. "Clear
 *  everything" in Settings has always left the background image behind; with
 *  textbooks in here too that is a real leak on a shared school device. It
 *  deletes by prefix rather than emptying the store because the store is
 *  shared by every account on the device, and one student clearing their
 *  workspace must not delete another's textbooks. */
export async function clearAssets(prefixes: string[]) {
  if (!prefixes.length) return;
  const database = await openAssetDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(BACKGROUND_STORE, "readwrite");
      const store = transaction.objectStore(BACKGROUND_STORE);
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        for (const key of keys.result) {
          if (typeof key === "string" && prefixes.some((prefix) => key.startsWith(prefix))) store.delete(key);
        }
      };
      transaction.onabort = () => reject(transaction.error ?? new Error("Local file operation was cancelled."));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Local files could not be cleared."));
    });
  } finally {
    database.close();
  }
}

const readBackgroundImage = () => readAsset(BACKGROUND_IMAGE_KEY);
const writeBackgroundImage = (image: Blob | null) => writeAsset(BACKGROUND_IMAGE_KEY, image);

const initialTheme = storedTheme();
applyDocumentTheme(initialTheme);
const initialBackground = readBackgroundSettings();
applyDocumentBackground(initialBackground, null);

// Both glass themes reuse Matchbox's runtime blur-capability probe
// (packages/ui/src/glassProbe.ts) instead of reinventing donated-hardware
// blur detection. Forge Brutalist never blurs, so the probe result only
// matters while a glass theme is active.
const initialGlass = initialGlassState(readGlassMode());
applyGlassAttribute(initialGlass);

type ThemeContextValue = {
  theme: ForgeTheme;
  setTheme: (theme: ForgeTheme) => void;
  toggleTheme: () => void;
  themeLabel: (theme: ForgeTheme) => string;
  glass: GlassState;
  glassMode: GlassMode;
  setGlassMode: (mode: GlassMode) => void;
  background: BackgroundSettings;
  setBackgroundMode: (mode: BackgroundMode) => void;
  setBackgroundColor: (color: string) => void;
  setBackgroundPattern: (pattern: BackgroundPattern) => void;
  setBackgroundImage: (file: File) => Promise<void>;
  clearBackgroundImage: () => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ForgeThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ForgeTheme>(initialTheme);
  const [glass, setGlass] = useState<GlassState>(initialGlass);
  const [glassMode, setGlassModeState] = useState<GlassMode>(readGlassMode());
  const [background, setBackground] = useState<BackgroundSettings>(initialBackground);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void readBackgroundImage().then((blob) => {
      if (!active || !blob) return;
      setBackgroundImageUrl(URL.createObjectURL(blob));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    applyDocumentBackground(background, backgroundImageUrl);
    writeBackgroundSettings(background);
  }, [background, backgroundImageUrl]);

  useEffect(() => () => {
    if (backgroundImageUrl) URL.revokeObjectURL(backgroundImageUrl);
  }, [backgroundImageUrl]);

  useEffect(() => {
    applyDocumentTheme(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // A theme preference is optional; the interface still works without storage.
    }
  }, [theme]);

  useEffect(() => {
    if (theme === "forge-brutalist") return;
    let cancelled = false;
    void measureGlassCapability(glassMode).then((result) => {
      if (!cancelled) {
        setGlass(result);
        applyGlassAttribute(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [theme, glassMode]);

  function setGlassMode(mode: GlassMode) {
    writeGlassMode(mode);
    clearGlassCache();
    setGlassModeState(mode);
  }

  function updateBackground(patch: Partial<BackgroundSettings>) {
    setBackground((current) => ({ ...current, ...patch }));
  }

  async function setBackgroundImage(file: File) {
    if (!file.type.startsWith("image/")) throw new Error("Choose a PNG, JPG, WebP, GIF or another image file.");
    if (file.size > 20 * 1024 * 1024) throw new Error("Choose an image smaller than 20 MB.");
    await writeBackgroundImage(file);
    setBackgroundImageUrl(URL.createObjectURL(file));
    updateBackground({ mode: "image", imageName: file.name });
  }

  async function clearBackgroundImage() {
    await writeBackgroundImage(null);
    setBackgroundImageUrl(null);
    updateBackground({ mode: "theme", imageName: "" });
  }

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () =>
        setTheme((current) => FORGE_THEMES[(FORGE_THEMES.indexOf(current) + 1) % FORGE_THEMES.length]),
      themeLabel: (target) => THEME_LABELS[target],
      glass,
      glassMode,
      setGlassMode,
      background,
      setBackgroundMode: (mode) => updateBackground({ mode }),
      setBackgroundColor: (color) => updateBackground({ color }),
      setBackgroundPattern: (pattern) => updateBackground({ pattern }),
      setBackgroundImage,
      clearBackgroundImage,
    }),
    [theme, glass, glassMode, background, backgroundImageUrl],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useForgeTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useForgeTheme must be used inside ForgeThemeProvider.");
  return context;
}
