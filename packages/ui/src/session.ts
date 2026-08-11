import { invoke } from "@tauri-apps/api/core";

export function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}

function removeWebValues(keys: readonly string[]) {
  keys.forEach((key) => localStorage.removeItem(key));
}

/**
 * Loads a native encrypted session and migrates one legacy WebView value when
 * needed. The caller still validates the JSON shape and role before using it.
 */
export async function loadSessionValue(keys: readonly string[]) {
  if (isTauriRuntime()) {
    try {
      const native = await invoke<string | null>("load_secure_session");
      if (native) {
        removeWebValues(keys);
        return native;
      }
    } catch {
      // A damaged native value is handled by the caller as a signed-out state.
    }
  }

  const legacy = keys
    .map((key) => localStorage.getItem(key))
    .find((value): value is string => Boolean(value));
  if (!legacy) return null;

  if (isTauriRuntime()) {
    try {
      await invoke("save_secure_session", { session: legacy });
      removeWebValues(keys);
    } catch {
      // Keep the legacy value for one more launch rather than destroying the
      // only valid session when native storage is temporarily unavailable.
    }
  }
  return legacy;
}

/** Saves installed-app sessions natively. Browser development keeps its value locally. */
export async function saveSessionValue(
  keys: readonly string[],
  value: string,
) {
  if (isTauriRuntime()) {
    try {
      await invoke("save_secure_session", { session: value });
      removeWebValues(keys);
      return true;
    } catch {
      // Do not fall back to plaintext localStorage in an installed app.
      return false;
    }
  }
  localStorage.setItem(keys[0], value);
  keys.slice(1).forEach((key) => localStorage.removeItem(key));
  return true;
}

export async function clearSessionValue(keys: readonly string[]) {
  if (isTauriRuntime()) {
    try {
      await invoke("clear_secure_session");
    } catch {
      // Server-side logout invalidates the token even if local cleanup fails.
    }
  }
  removeWebValues(keys);
}
