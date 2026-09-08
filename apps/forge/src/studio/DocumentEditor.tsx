import { useEffect, useRef, useState, type CSSProperties } from "react";
import type Quill from "quill";
import type Table from "quill/modules/table";
import DOMPurify from "dompurify";
import { QuillEditor } from "./QuillEditor";
import { documentKeyPrefix, type StudioNote } from "../forgeData";
import { downloadFile, exportWord, importWord, portableHtml, insertEquation } from "./documentFiles";

type Settings = { paper: "A4" | "Letter"; landscape: boolean; margin: number; continuous: boolean; spacing: string; header: string; footer: string };
type Version = { title: string; topic: string; bodyHtml: string; savedAt: string; settings: Settings };
const defaults: Settings = { paper: "A4", landscape: false, margin: 20, continuous: false, spacing: "1.5", header: "", footer: "" };
type Extras = { settings: Settings; versions: Version[]; loadError?: string };
function readExtras(accountId: string, id: string): Extras {
  try {
    const raw = JSON.parse(localStorage.getItem(`${documentKeyPrefix(accountId)}${id}`) || "null");
    if (!raw) return { settings: defaults, versions: [] };
    const s = raw.settings || {};
    return { settings: {
      paper: s.paper === "Letter" ? "Letter" : "A4", landscape: s.landscape === true,
      margin: [12, 20, 25].includes(s.margin) ? s.margin : 20, continuous: s.continuous === true,
      spacing: ["1", "1.15", "1.5", "2"].includes(s.spacing) ? s.spacing : "1.5",
      header: typeof s.header === "string" ? s.header : "", footer: typeof s.footer === "string" ? s.footer : "",
    }, versions: Array.isArray(raw.versions) ? raw.versions.filter((v: Version) => v && typeof v.bodyHtml === "string" && typeof v.title === "string" && typeof v.topic === "string" && typeof v.savedAt === "string").slice(0, 10) : [] };
  } catch {
    return {
      settings: defaults,
      versions: [],
      loadError: "Saved page settings or version history could not be read. The original record has been preserved.",
    };
  }
}

export function DocumentEditor({ accountId, note, onUpdate, onRemove }: {
  accountId: string;
  note: StudioNote;
  onUpdate: (id: string, input: { title: string; topic: string; bodyHtml: string }) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState({ title: note.title, topic: note.topic, bodyHtml: note.bodyHtml });
  const draftRef = useRef(draft);
  const editor = useRef<Quill | null>(null);
  const [extras, setExtras] = useState(() => readExtras(accountId, note.id));
  const [panel, setPanel] = useState<"" | "page" | "find" | "history" | "insert">("");
  const [message, setMessage] = useState(extras.loadError ?? "");
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const [words, setWords] = useState(0);
  const [busy, setBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const selection = useRef(0);
  const settings = extras.settings;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  function update(partial: Partial<typeof draft>) {
    const next = { ...draftRef.current, ...partial };
    draftRef.current = next;
    setDraft(next);
    onUpdate(note.id, next);
  }
  function saveExtras(next: Extras) {
    if (extras.loadError) {
      setMessage("Page settings and history are locked because their saved record could not be read. Export this document before repairing its local data.");
      return false;
    }
    try {
      localStorage.setItem(`${documentKeyPrefix(accountId)}${note.id}`, JSON.stringify(next));
      setExtras(next);
      return true;
    } catch {
      setMessage("Document settings or history could not be saved. Export your document before closing.");
      return false;
    }
  }
  function configure(partial: Partial<Settings>) { saveExtras({ ...extras, settings: { ...settings, ...partial } }); }
  function snapshot() {
    const version: Version = { ...draftRef.current, savedAt: new Date().toISOString(), settings: { ...settings } };
    const saved = saveExtras({ ...extras, versions: [version, ...extras.versions].slice(0, 10) });
    if (saved) setMessage("Version saved on this device. The most recent 10 versions are kept.");
    return saved;
  }
  function restore(version: Version) {
    const current: Version = { ...draftRef.current, savedAt: new Date().toISOString(), settings: { ...settings } };
    if (!saveExtras({ settings: version.settings || defaults, versions: [current, ...extras.versions].slice(0, 10) })) return;
    editor.current?.clipboard.dangerouslyPasteHTML(DOMPurify.sanitize(version.bodyHtml));
    update({ title: version.title, topic: version.topic, bodyHtml: editor.current?.root.innerHTML || version.bodyHtml });
    setMessage("Version restored. Your previous draft is in history.");
  }
  function findNext(replace = false) {
    const q = editor.current;
    if (!q || !find) return;
    const range = q.getSelection(true);
    if (replace && range && q.getText(range.index, range.length).toLocaleLowerCase() === find.toLocaleLowerCase()) {
      q.history.cutoff();
      q.deleteText(range.index, range.length, "user");
      q.insertText(range.index, replacement, "user");
      selection.current = range.index + replacement.length;
      q.history.cutoff();
    }
    const text = q.getText().toLocaleLowerCase();
    let index = text.indexOf(find.toLocaleLowerCase(), selection.current);
    if (index < 0) index = text.indexOf(find.toLocaleLowerCase());
    if (index < 0) { setMessage("No matches found."); return; }
    q.setSelection(index, find.length);
    selection.current = index + find.length;
    setMessage("Match selected in the document.");
  }
  function table(action: keyof Table) {
    const q = editor.current;
    if (!q) return;
    q.focus();
    const module = q.getModule("table") as Table;
    if (action === "insertTable") module.insertTable(3, 3);
    else {
      if (!module.getTable()[0]) { setMessage("Place the cursor in a table first."); return; }
      (module[action] as () => void).call(module);
    }
  }
  async function exportDocx() {
    if (!editor.current) return;
    setBusy(true);
    try { await exportWord(draftRef.current.title, editor.current, settings); }
    catch { if (alive.current) setMessage("Word export failed. Try HTML export to keep your formatting."); }
    finally { if (alive.current) setBusy(false); }
  }
  async function importFile(file?: File) {
    if (!file || !editor.current) return;
    if (file.size > 10 * 1024 * 1024) { setMessage("Choose a document smaller than 10 MB."); return; }
    const originalDraft = draftRef.current;
    if (!snapshot()) return;
    setBusy(true);
    try {
      let html: string;
      if (/\.docx$/i.test(file.name)) html = await importWord(file);
      else if (/\.txt$/i.test(file.name)) {
        const text = await file.text();
        const container = document.createElement("div"); container.textContent = text;
        html = `<p>${container.innerHTML.replace(/\n/g, "</p><p>")}</p>`;
      } else { setMessage("Choose a .docx or .txt file."); return; }
      if (!alive.current || !editor.current) return;
      if (draftRef.current !== originalDraft) { setMessage("Import cancelled because this draft changed while the file was opening. Your writing has been kept."); return; }
      editor.current.clipboard.dangerouslyPasteHTML(html);
      update({ title: file.name.replace(/\.[^.]+$/, ""), bodyHtml: editor.current.root.innerHTML });
      setMessage("Imported. Check the layout: advanced Word features may not transfer. Previous draft saved in history.");
    } catch { if (alive.current) setMessage("Could not import this document. Your previous draft is in history."); }
    finally { if (alive.current) setBusy(false); }
  }
  async function insertImage(file?: File) {
    if (!file || !editor.current) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 1024 * 1024) {
      setMessage("Choose a PNG, JPEG, WebP or GIF smaller than 1 MB."); return;
    }
    const index = editor.current.getSelection()?.index ?? editor.current.getLength() - 1;
    const reader = new FileReader();
    reader.onload = () => {
      if (alive.current && editor.current && typeof reader.result === "string") {
        editor.current.insertEmbed(index, "image", reader.result, "user");
        editor.current.setSelection(index + 1);
      }
    };
    reader.onerror = () => { if (alive.current) setMessage("The image could not be read."); };
    reader.readAsDataURL(file);
  }
  const width = settings.paper === "A4" ? (settings.landscape ? 297 : 210) : (settings.landscape ? 279.4 : 215.9);
  const height = settings.paper === "A4" ? (settings.landscape ? 210 : 297) : (settings.landscape ? 215.9 : 279.4);
  return <section className={`document-workspace${settings.continuous ? " continuous" : ""}`} aria-label="Document editor"
    style={{ "--document-width": `${width}mm`, "--document-height": `${height}mm`, "--document-margin": `${settings.margin}mm`, "--document-spacing": settings.spacing } as CSSProperties}>
    <div className="document-heading">
      <input aria-label="Document title" className="document-title" placeholder="Untitled document" value={draft.title} onChange={(e) => update({ title: e.target.value })} />
      <input aria-label="Document subject" className="document-subject" placeholder="Subject or folder" value={draft.topic} onChange={(e) => update({ topic: e.target.value })} />
    </div>
    <nav className="document-actions" aria-label="Document actions">
      <button onClick={() => editor.current?.history.undo()} title="Undo (Ctrl+Z)">↶ Undo</button>
      <button onClick={() => editor.current?.history.redo()} title="Redo (Ctrl+Shift+Z)">↷ Redo</button>
      {([['insert', 'Insert'], ['page', 'Page setup'], ['find', 'Find'], ['history', 'History']] as const).map(([id, label]) => <button key={id} aria-expanded={panel === id} onClick={() => setPanel(panel === id ? "" : id)}>{label}</button>)}
      <details className="document-file-menu"><summary>File</summary><div>
        <button disabled={busy} onClick={() => importRef.current?.click()}>Import Word / text…</button>
        <button disabled={busy} onClick={exportDocx}>Export Word (.docx)</button>
        <button onClick={() => { if (editor.current) downloadFile(`${draft.title || "Document"}.html`, portableHtml(draft.title, editor.current, settings), "text/html"); }}>Export HTML</button>
        <button onClick={() => downloadFile(`${draft.title || "Document"}.txt`, editor.current?.getText() || "", "text/plain")}>Export text</button>
        <button onClick={() => window.print()}>Print / save as PDF</button>
        <button onClick={onRemove}>Move to recently deleted</button>
      </div></details>
    </nav>
    <input hidden ref={importRef} type="file" accept=".docx,.txt" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
    <input hidden ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { void insertImage(e.target.files?.[0]); e.target.value = ""; }} />
    {panel === "page" && <div className="document-options">
      <label>Paper<select value={settings.paper} onChange={(e) => configure({ paper: e.target.value as Settings['paper'] })}><option>A4</option><option>Letter</option></select></label>
      <label>Orientation<select value={String(settings.landscape)} onChange={(e) => configure({ landscape: e.target.value === "true" })}><option value="false">Portrait</option><option value="true">Landscape</option></select></label>
      <label>Margins<select value={settings.margin} onChange={(e) => configure({ margin: Number(e.target.value) })}><option value="12">Narrow · 12 mm</option><option value="20">Normal · 20 mm</option><option value="25">Wide · 25 mm</option></select></label>
      <label>Line spacing<select value={settings.spacing} onChange={(e) => configure({ spacing: e.target.value })}>{["1", "1.15", "1.5", "2"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>View<select value={String(settings.continuous)} onChange={(e) => configure({ continuous: e.target.value === "true" })}><option value="false">Paper width</option><option value="true">Continuous</option></select></label>
      <label>Header<input value={settings.header} onChange={(e) => configure({ header: e.target.value })} /></label>
      <label>Footer<input value={settings.footer} onChange={(e) => configure({ footer: e.target.value })} /></label>
      <small>Pages flow automatically when printed or exported. Word exports include page numbers.</small>
    </div>}
    {panel === "find" && <div className="document-options"><input aria-label="Find text" placeholder="Find in document" value={find} onChange={(e) => { setFind(e.target.value); selection.current = 0; }} /><input aria-label="Replace with" placeholder="Replace with" value={replacement} onChange={(e) => setReplacement(e.target.value)} /><button onClick={() => findNext()}>Find next</button><button onClick={() => findNext(true)}>Replace / next</button></div>}
    {panel === "insert" && <div className="document-options">
      <button onClick={() => imageRef.current?.click()}>Image…</button>
      <button onClick={() => table("insertTable")}>3 × 3 table</button>
      <button onClick={() => table("insertRowBelow")}>Add row</button><button onClick={() => table("insertColumnRight")}>Add column</button>
      <button onClick={() => table("deleteRow")}>Delete row</button><button onClick={() => table("deleteColumn")}>Delete column</button><button onClick={() => table("deleteTable")}>Delete table</button>
      <button onClick={() => { const q = editor.current; if (q) { const index = q.getSelection(true)?.index ?? q.getLength() - 1; q.insertEmbed(index, "page-break", true, "user"); q.setSelection(index + 1); } }}>Page break</button>
      <label>Equation (LaTeX)<input placeholder="e.g. x^2 + y^2" onKeyDown={async (e) => { if (e.key !== "Enter" || !e.currentTarget.value.trim()) return; e.preventDefault(); const value = e.currentTarget.value; const q = editor.current; if (q) { try { if (alive.current) insertEquation(q, value); } catch { setMessage("Could not insert that equation. Check the LaTeX expression."); } } }} /></label>
    </div>}
    {panel === "history" && <div className="document-history"><button onClick={snapshot}>Save a version</button><p>Up to 10 saved versions on this device. Restoring preserves your current draft.</p>{extras.versions.map((version, index) => <button key={`${version.savedAt}-${index}`} onClick={() => restore(version)}>{version.title || "Untitled"} — {new Date(version.savedAt).toLocaleString()} · Restore</button>)}</div>}
    {message && <div className="document-message" role="status">{message}<button aria-label="Dismiss message" onClick={() => setMessage("")}>×</button></div>}
    <div className="document-paper">
      {settings.header && <div className="document-running-header">{settings.header}</div>}
      <QuillEditor noteId={note.id} initialHtml={note.bodyHtml} onReady={(q) => { editor.current = q; setWords(q?.getText().trim().split(/\s+/).filter(Boolean).length || 0); }} onChange={(html, text) => { update({ bodyHtml: html }); setWords(text.trim().split(/\s+/).filter(Boolean).length); }} />
      {settings.footer && <div className="document-running-footer">{settings.footer}</div>}
    </div>
    <footer className="document-status"><span>{words} {words === 1 ? "word" : "words"}</span><span>Private · autosaves on this device</span><span>{busy ? "Working…" : "Spellcheck enabled"}</span></footer>
    <style>{`@media print { @page { size: ${settings.paper} ${settings.landscape ? "landscape" : "portrait"}; margin: ${settings.margin}mm; } }`}</style>
  </section>;
}
