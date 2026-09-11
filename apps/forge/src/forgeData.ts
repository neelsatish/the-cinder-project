import { useEffect, useMemo, useState } from "react";

export type WidgetId = "timer" | "library" | "studio" | "activity";

/** Legacy. Library notes were folded into StudioNote documents — see
 *  `migrateNotes` below. Kept typed so the raw array can still be read
 *  back off disk if a conversion ever needs auditing. */
export type ForgeNote = {
  id: string;
  title: string;
  body: string;
  topic: string;
  createdAt: string;
};

/** A reference document (a textbook, a paper) a student reads beside their
 *  own writing. Metadata only: the bytes live in IndexedDB under
 *  `pdf:<id>`, because this record is re-serialised into localStorage on
 *  every keystroke and a textbook would blow the ~5MB quota instantly. */
export type ReferenceFile = {
  id: string;
  name: string;
  size: number;
  addedAt: string;
};

export type StudioNote = {
  id: string;
  title: string;
  topic: string;
  bodyHtml: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type ForgeActivity = {
  id: string;
  label: string;
  detail: string;
  createdAt: string;
};

export type ForgeData = {
  version: 1;
  profileName: string;
  /** Legacy, no longer read by the UI. Left on disk after migration so a
   *  bad conversion stays recoverable — it costs a few KB. */
  notes: ForgeNote[];
  studioNotes: StudioNote[];
  files: ReferenceFile[];
  activity: ForgeActivity[];
  widgets: WidgetId[];
  notesMigratedAt?: string;
};

const LEGACY_STORAGE_KEY = "cinder.forge.workspace.v1";
const MIGRATION_OWNER_KEY = "cinder.matchbox.workspace.migration-owner";
// Owned by DocumentEditor, cleared by resetWorkspace — exported so the two
// can't drift apart and silently strand version history on the device.
export function documentKeyPrefix(accountId: string) {
  return `cinder.matchbox.${accountId}.document.`;
}

export function workspaceStorageKey(accountId: string) {
  return `cinder.matchbox.${accountId}.workspace.v1`;
}

export const ALL_WIDGETS: WidgetId[] = ["timer", "library", "studio", "activity"];

export const WIDGET_LABELS: Record<WidgetId, { title: string; description: string }> = {
  timer: { title: "Timer", description: "Start, pause or stop a simple stopwatch." },
  library: { title: "Library", description: "See the reference files on this device." },
  studio: { title: "Notes", description: "Continue your notes." },
  activity: { title: "Recent activity", description: "Show real actions from this workspace." },
};

const EMPTY_DATA: ForgeData = {
  version: 1,
  profileName: "",
  notes: [],
  studioNotes: [],
  files: [],
  activity: [],
  widgets: [...ALL_WIDGETS],
};

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Plain text becomes HTML, escaped via the DOM rather than a hand-rolled
 *  replace — a note containing `<script>` must read back as visible text,
 *  not execute once Quill renders it. */
export function textToHtml(text: string) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(/\r\n?/g, "\n").split("\n").map((line) => `<p>${line || "<br>"}</p>`).join("");
}

/** Folds legacy Library notes into documents. Reuses each note's original
 *  id, which makes this idempotent — React 18 StrictMode invokes the
 *  useState initialiser twice, and `note:`-prefixed search links keep
 *  resolving. Anything already present as a document wins. */
export function migrateNotes(notes: ForgeNote[], studioNotes: StudioNote[]): StudioNote[] {
  const existing = new Set(studioNotes.map((note) => note.id));
  const converted = notes
    .filter((note) => {
      if (!note || typeof note.id !== "string" || existing.has(note.id)) return false;
      existing.add(note.id);
      return true;
    })
    .map((note) => ({
      id: note.id,
      title: note.title || "Untitled note",
      topic: note.topic || "",
      bodyHtml: textToHtml(note.body || ""),
      createdAt: note.createdAt,
      updatedAt: note.createdAt,
    }));
  return [...studioNotes, ...converted]
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

export function decodeWorkspace(raw: string | null): ForgeData {
  try {
    if (!raw) return EMPTY_DATA;
    const parsed = JSON.parse(raw) as Partial<ForgeData>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (parsed.version !== undefined && parsed.version !== 1)) throw new Error("Unsupported workspace");
    const fields = { notes: ["id", "title", "body", "topic", "createdAt"], studioNotes: ["id", "title", "bodyHtml", "topic", "createdAt", "updatedAt"], files: ["id", "name", "addedAt"] };
    for (const [key, required] of Object.entries(fields)) {
      const items = parsed[key as keyof typeof fields];
      if (items !== undefined && (!Array.isArray(items) || !items.every((item) => item && required.every((field) => typeof (item as unknown as Record<string, unknown>)[field] === "string")))) throw new Error("Invalid workspace records");
    }
    const normalizedWidgets = Array.isArray(parsed.widgets)
      ? (parsed.widgets as unknown[]).map((widget) => widget === "focus" ? "timer" : widget)
      : [...ALL_WIDGETS];
    const widgets = normalizedWidgets.filter((widget, index): widget is WidgetId =>
      typeof widget === "string" && ALL_WIDGETS.includes(widget as WidgetId) && normalizedWidgets.indexOf(widget) === index)

    const notes = Array.isArray(parsed.notes) ? parsed.notes : [];
    const stored = Array.isArray(parsed.studioNotes) ? parsed.studioNotes : [];
    const pending = notes.length && !parsed.notesMigratedAt;

    return {
      version: 1,
      profileName: typeof parsed.profileName === "string" ? parsed.profileName : "",
      notes,
      studioNotes: pending ? migrateNotes(notes, stored) : stored,
      files: Array.isArray(parsed.files) ? parsed.files : [],
      activity: Array.isArray(parsed.activity) ? parsed.activity : [],
      widgets: widgets.length ? widgets : [...ALL_WIDGETS],
      notesMigratedAt: parsed.notesMigratedAt || (pending ? new Date().toISOString() : undefined),
    };
  } catch {
    throw new Error("Saved workspace could not be read. The original data has been preserved; changes will not overwrite it. Export any new writing before closing Cinder Student.");
  }
}

function activity(label: string, detail: string): ForgeActivity {
  return { id: makeId(), label, detail, createdAt: new Date().toISOString() };
}

function initialWorkspace(accountId: string, profileName: string) {
  const scopedKey = workspaceStorageKey(accountId);
  let raw = localStorage.getItem(scopedKey);
  if (!raw) {
    const migrationOwner = localStorage.getItem(MIGRATION_OWNER_KEY);
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy && (!migrationOwner || migrationOwner === accountId)) {
      localStorage.setItem(MIGRATION_OWNER_KEY, accountId);
      localStorage.setItem(scopedKey, legacy);
      raw = legacy;
    }
  }
  const data = decodeWorkspace(raw);
  return data.profileName || !profileName ? data : { ...data, profileName };
}

export function useForgeData(accountId: string, profileName = "") {
  const storageKey = workspaceStorageKey(accountId);
  const [initial] = useState(() => {
    try { return { data: initialWorkspace(accountId, profileName), error: "" }; }
    catch (error) { return { data: EMPTY_DATA, error: error instanceof Error ? error.message : "Storage unavailable" }; }
  });
  const [data, setData] = useState<ForgeData>(initial.data);
  const [readError, setReadError] = useState(initial.error);

  const [saveError, setSaveError] = useState("");
  useEffect(() => {
    if (readError) { setSaveError(readError); return; }
    try {
      localStorage.setItem(storageKey, JSON.stringify(data));
      setSaveError("");
    } catch {
      setSaveError("Changes could not be saved on this device. Export your open document before closing Cinder Student.");
    }
  }, [data, readError, storageKey]);

  return useMemo(() => ({
    data,
    saveError,
    setProfileName(name: string) {
      const clean = name.trim().slice(0, 80);
      setData((current) => ({
        ...current,
        profileName: clean,
        activity: clean && clean !== current.profileName
          ? [activity("Profile updated", "Name saved on this device"), ...current.activity].slice(0, 100)
          : current.activity,
      }));
    },
    addReferenceFile(input: { id: string; name: string; size: number }) {
      const file: ReferenceFile = {
        id: input.id,
        name: input.name.trim().slice(0, 160),
        size: input.size,
        addedAt: new Date().toISOString(),
      };
      setData((current) => ({
        ...current,
        files: [file, ...current.files],
        activity: [activity(`Added “${file.name}”`, "Reference file"), ...current.activity].slice(0, 100),
      }));
      return file;
    },
    removeReferenceFile(id: string) {
      setData((current) => ({ ...current, files: current.files.filter((file) => file.id !== id) }));
    },
    addStudioNote(input: { title: string; topic: string; bodyHtml: string }) {
      const now = new Date().toISOString();
      const note: StudioNote = {
        id: makeId(),
        title: input.title.trim() || "Untitled note",
        topic: input.topic.trim(),
        bodyHtml: input.bodyHtml,
        createdAt: now,
        updatedAt: now,
      };
      setData((current) => ({
        ...current,
        studioNotes: [note, ...current.studioNotes],
        activity: [activity(`Started “${note.title}”`, "Studio note"), ...current.activity].slice(0, 100),
      }));
      return note;
    },
    updateStudioNote(id: string, input: { title: string; topic: string; bodyHtml: string }) {
      setData((current) => ({
        ...current,
        studioNotes: current.studioNotes.map((note) => note.id === id
          ? { ...note, title: input.title.trim() || "Untitled note", topic: input.topic.trim(), bodyHtml: input.bodyHtml, updatedAt: new Date().toISOString() }
          : note),
      }));
    },
    removeStudioNote(id: string) {
      setData((current) => ({ ...current, studioNotes: current.studioNotes.map((note) => note.id === id ? { ...note, deletedAt: new Date().toISOString() } : note) }));
    },
    restoreStudioNote(id: string) {
      setData((current) => ({ ...current, studioNotes: current.studioNotes.map((note) => note.id === id ? { ...note, deletedAt: undefined } : note) }));
    },
    setWidgets(widgets: WidgetId[]) {
      const unique = widgets.filter((widget, index) => widgets.indexOf(widget) === index);
      setData((current) => ({ ...current, widgets: unique.length ? unique : ["timer"] }));
    },
    resetWorkspace() {
      // Document page settings and version history live in their own
      // `cinder.forge.document.<id>` keys, not in the workspace blob.
      // Version history holds full document text, so clearing the
      // workspace without these would leave the writing recoverable on a
      // shared device — "Clear everything" has to mean it.
      try {
        const prefix = documentKeyPrefix(accountId);
        const stale = Object.keys(localStorage).filter((key) => key.startsWith(prefix));
        stale.forEach((key) => localStorage.removeItem(key));
      } catch {
        setSaveError("Workspace could not be cleared. Some saved data remains on this device.");
        return false;
      }
      try { localStorage.setItem(storageKey, JSON.stringify(EMPTY_DATA)); }
      catch { setSaveError("Workspace could not be cleared. Saved data remains on this device."); return false; }
      setReadError("");
      setData({ ...EMPTY_DATA, widgets: [...ALL_WIDGETS] });
      return true;
    },
  }), [accountId, data, saveError, storageKey]);
}

export function relativeTime(iso: string) {
  const elapsed = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}
