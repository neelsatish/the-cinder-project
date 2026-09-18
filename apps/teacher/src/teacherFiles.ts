// Small helpers shared by the Teacher views for dates and saving exports.

import { invoke } from "@tauri-apps/api/core";
import { save as showSaveDialog } from "@tauri-apps/plugin-dialog";

export function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

export function safeFilename(value: string) {
  return (
    value
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 100) || "Cinder export"
  );
}

export async function saveTextExport(
  defaultName: string,
  contents: string,
  extension: "csv" | "html" | "doc" | "txt",
  label: string,
) {
  const filename = `${safeFilename(defaultName)}.${extension}`;
  if (isTauri()) {
    const path = await showSaveDialog({
      defaultPath: filename,
      filters: [{ name: label, extensions: [extension] }],
    });
    if (!path) return false;
    await invoke("write_text_export", { path, contents });
    return true;
  }
  const mime =
    extension === "csv"
      ? "text/csv;charset=utf-8"
      : extension === "html" || extension === "doc"
        ? "text/html;charset=utf-8"
        : "text/plain;charset=utf-8";
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

export function formatDate(value: string | null) {
  if (!value) return "No deadline";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
