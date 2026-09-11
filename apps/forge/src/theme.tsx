import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

const ASSET_DB_NAME = "cinder-forge-appearance";
const ASSET_STORE = "assets";
const LEGACY_BACKGROUND_IMAGE_KEY = "custom-background";

/* One blob store for every large binary the app owns. The historical name
   stays so existing PDFs remain available after this appearance cleanup. */
export function openAssetDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(ASSET_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ASSET_STORE)) request.result.createObjectStore(ASSET_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local file storage could not be opened."));
  });
}

export async function readAsset(key: string) {
  const database = await openAssetDatabase();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const request = database.transaction(ASSET_STORE, "readonly").objectStore(ASSET_STORE).get(key);
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
      const transaction = database.transaction(ASSET_STORE, "readwrite");
      const store = transaction.objectStore(ASSET_STORE);
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

export async function clearAssets(prefixes: string[]) {
  if (!prefixes.length) return;
  const database = await openAssetDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(ASSET_STORE, "readwrite");
      const store = transaction.objectStore(ASSET_STORE);
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

type ThemeContextValue = { clearBackgroundImage: () => Promise<void> };
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ForgeThemeProvider({ children }: { children: ReactNode }) {
  const value = useMemo<ThemeContextValue>(() => ({
    clearBackgroundImage: () => writeAsset(LEGACY_BACKGROUND_IMAGE_KEY, null),
  }), []);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useForgeTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useForgeTheme must be used inside ForgeThemeProvider.");
  return context;
}
