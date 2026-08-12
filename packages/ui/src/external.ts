import { openUrl } from "@tauri-apps/plugin-opener";

export async function openExternalUrl(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("Only secure web links can be opened.");
  }
  if ("__TAURI_INTERNALS__" in window) {
    await openUrl(parsed.toString());
    return;
  }
  window.open(parsed.toString(), "_blank", "noopener,noreferrer");
}
