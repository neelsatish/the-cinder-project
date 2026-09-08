import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppUpdater, BrandMark } from "@cinder/ui";
import {
  ArrowLeft,
  ArrowRight,
  Books,
  ChalkboardTeacher,
  CaretLeft,
  CaretRight,
  Check,
  Clock,
  DotsThreeVertical,
  FilePdf,
  GearSix,
  House,
  NotePencil,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";

import { Atmosphere } from "./components/Atmosphere";
import { Topbar } from "./components/Topbar";
import { MatchboxSessionGate, type MatchboxSession } from "./matchboxSession";
import { useCountdown, TimerControls, FloatingTimer, type Countdown } from "./components/Countdown";
import {
  ALL_WIDGETS,
  relativeTime,
  useForgeData,
  type ForgeData,
  type ReferenceFile,
  type StudioNote,
  type WidgetId,
} from "./forgeData";
import { clearAssets, useForgeTheme, writeAsset } from "./theme";
import { DocumentEditor } from "./studio/DocumentEditor";
import { PdfPane } from "./studio/PdfPane";
import { StudentClassrooms } from "./classrooms/StudentClassrooms";
import { LiveSessionBar, useStudentLiveSession } from "./classrooms/LiveSession";
import "./studio/documents.css";

type PrimaryPage = "home" | "classrooms" | "library" | "studio";
type Page = PrimaryPage | "settings";

const NAV_ITEMS = [
  { id: "home", label: "Home", icon: House },
  { id: "classrooms", label: "Classrooms", icon: ChalkboardTeacher },
  { id: "library", label: "Library", icon: Books },
  { id: "studio", label: "Notes", icon: NotePencil },
] as const;

const SIDEBAR_KEY = "cinder.forge.sidebar.collapsed";

function pdfAssetKey(accountId: string, fileId: string) {
  return `account:${accountId}:pdf:${fileId}`;
}


export function App() {
  return <MatchboxSessionGate>{(session) => <MatchboxWorkspace key={session.user.id} session={session} />}</MatchboxSessionGate>;
}

function MatchboxWorkspace({ session }: { session: MatchboxSession }) {
  const [openDocumentId, setOpenDocumentId] = useState<string | null>(null);
  const forge = useForgeData(session.user.id, session.user.display_name);
  const { theme, clearBackgroundImage } = useForgeTheme();
  const [page, setPage] = useState<Page>("home");
  const [toast, setToast] = useState("");
  const timer = useCountdown(session.user.id);
  const live = useStudentLiveSession({ api: session.api, baseUrl: session.baseUrl, accountId: session.user.id, online: session.online });
  const [search, setSearch] = useState<{ query: string; ids: string[] } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === "true"; }
    catch { return false; }
  });




  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, String(sidebarCollapsed)); }
    catch { /* The layout still works for this session when storage is unavailable. */ }
  }, [sidebarCollapsed]);

  function selectPage(nextPage: Page) {
    setPage(nextPage);
    setSearch(null);
  }

  async function clearWorkspace() {
    // IndexedDB is async and resetWorkspace is not, so the blobs have to go
    // first — otherwise "Clear everything" leaves every uploaded textbook on
    // a shared device. Clearing by prefix rather than by the metadata list
    // also catches orphans: a file whose blob delete failed earlier is no
    // longer listed in `files`, so a metadata-driven pass would miss it.
    // `pdf:` is the pre-account-scoping key shape. The background image goes
    // through the theme provider, which also resets the mode — deleting its
    // blob directly would leave the appearance pointing at nothing.
    try {
      await clearAssets([`account:${session.user.id}:`, "pdf:"]);
      await clearBackgroundImage();
    } catch {
      setToast("Local files could not be cleared");
      return;
    }
    if (forge.resetWorkspace()) setToast("Workspace cleared");
    else setToast("Workspace could not be completely cleared");
  }

  async function addReferenceFile(file: File) {
    const id = crypto.randomUUID();
    await writeAsset(pdfAssetKey(session.user.id, id), file);
    forge.addReferenceFile({ id, name: file.name, size: file.size });
    setToast("Reference file added");
  }

  function removeReferenceFile(id: string) {
    // Blob first: a failure here leaves a file you can still see and retry,
    // rather than an invisible one silently eating disk.
    void writeAsset(pdfAssetKey(session.user.id, id), null)
      .then(() => forge.removeReferenceFile(id))
      .catch(() => setToast("That file could not be removed"));
  }

  function handleSearch(query: string) {
    if (!query) {
      setSearch({ query: "", ids: [] });
      return;
    }
    const lower = query.toLocaleLowerCase();
    const documentIds = forge.data.studioNotes
      .filter((note) => !note.deletedAt && [note.title, note.topic, new DOMParser().parseFromString(note.bodyHtml, "text/html").body.textContent || ""].some((value) => value.toLocaleLowerCase().includes(lower)))
      .map((note) => `document:${note.id}`);
    const fileIds = forge.data.files
      .filter((file) => file.name.toLocaleLowerCase().includes(lower))
      .map((file) => `file:${file.id}`);
    setSearch({ query, ids: [...documentIds, ...fileIds] });
  }

  return (
    <div className="forge-frame" data-page={page} data-sidebar-collapsed={sidebarCollapsed}>
      {theme !== "forge-brutalist" && <Atmosphere />}

      <aside className="forge-sidebar">
        <button type="button" className="forge-brand" onClick={() => selectPage("home")}>
          <BrandMark size={36} />
          <span className="forge-brand-copy"><strong>Cinder Student</strong></span>
        </button>
        <button type="button" className="forge-sidebar-toggle" aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!sidebarCollapsed}
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}>
          {sidebarCollapsed ? <CaretRight size={16} weight="bold" /> : <CaretLeft size={16} weight="bold" />}
        </button>

        <nav className="forge-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const NavIcon = item.icon;
            const active = page === item.id;
            return (
              <button key={item.id} aria-label={item.label} title={item.label} type="button" className={`forge-nav-item${active ? " active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => selectPage(item.id)}>
                <NavIcon size={19} weight={active ? "fill" : "regular"} /><span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="forge-sidebar-footer">
          <TimerControls timer={timer} compact />
          <button type="button" className={`forge-nav-item${page === "settings" ? " active" : ""}`} aria-label="Settings" title="Settings" onClick={() => selectPage("settings")}>
            <GearSix size={19} /><span>Settings</span>
          </button>
        </div>
      </aside>

      <section className="forge-workspace">
        <Topbar profileName={session.user.display_name} online={session.online} onSearch={handleSearch} onSwitchAccount={() => void session.switchAccount()} onOpenConnection={session.openConnection} />
        <main className="forge-main">
          <LiveSessionBar live={live} onOpen={() => undefined} />
          {forge.saveError && <p role="alert" className="form-error">{forge.saveError}</p>}
          {page === "home" && (
            <HomePage
              data={forge.data}
              timer={timer}
              onNavigate={selectPage}
            />
          )}
          {page === "classrooms" && <StudentClassrooms accountId={session.user.id} api={session.api} baseUrl={session.baseUrl} token={session.token} online={session.online} notes={forge.data.studioNotes} onJoinLiveSession={async (code) => { await live.join(code); }} />}
          {page === "library" && <LibraryPage data={forge.data} onAddFile={addReferenceFile} onRemoveFile={removeReferenceFile} />}
          {page === "studio" && (
            <StudioPage
              accountId={session.user.id}
              data={forge.data}
              openDocumentId={openDocumentId}
              saveError={forge.saveError}
              onAddNote={forge.addStudioNote}
              onUpdateNote={forge.updateStudioNote}
              onRestoreNote={forge.restoreStudioNote}
              onRemoveNote={forge.removeStudioNote}
            />
          )}
          {page === "settings" && <SettingsPage name={forge.data.profileName} onSaveName={forge.setProfileName} onReset={clearWorkspace} />}
        </main>
      </section>

      {timer.status !== "idle" && <FloatingTimer timer={timer} />}
      {search && <SearchPanel onOpenDocument={(id) => { setOpenDocumentId(id); selectPage("studio"); }} search={search} data={forge.data} onClose={() => setSearch(null)} onNavigate={selectPage} />}
      {toast && <div className="forge-toast" role="status">{toast}</div>}
    </div>
  );
}

function HomePage({ data, timer, onNavigate }: { data: ForgeData; timer: Countdown; onNavigate: (page: Page) => void }) {
  return <div className="forge-dashboard"><header className="forge-welcome forge-welcome-compact"><span className="forge-kicker">Home</span></header><div className="widget-grid">{ALL_WIDGETS.map(widget => <HomeWidget key={widget} widget={widget} data={data} timer={timer} onNavigate={onNavigate} />)}</div></div>;
}

function HomeWidget(props: {
  widget: WidgetId;
  data: ForgeData;
  timer: Countdown;
  onNavigate: (page: Page) => void;
}) {
  const { widget, data } = props;
  if (widget === "timer") {
    return (
      <article className="forge-panel widget-timer">
        <div className="panel-heading"><span className="forge-kicker">Timer</span><Clock size={19} /></div>
        <TimerControls timer={props.timer} />
      </article>
    );
  }

  if (widget === "library") {
    const latest = data.files[0];
    return (
      <article className="forge-panel widget-library">
        <div className="panel-heading"><span className="forge-kicker">Library</span><FilePdf size={19} /></div>
        <strong className="widget-number">{data.files.length}</strong>
        <p>{latest ? `Latest: ${latest.name}` : "No reference files yet."}</p>
        <button type="button" className="forge-button text" onClick={() => props.onNavigate("library")}>{latest ? "Open Library" : "Add a textbook"}<ArrowRight size={15} /></button>
      </article>
    );
  }

  if (widget === "studio") {
    const latest = data.studioNotes.find((note) => !note.deletedAt);
    return (
      <article className="forge-panel widget-studio">
        <div className="panel-heading"><span className="forge-kicker">Notes</span><NotePencil size={19} /></div>
        <strong className="widget-number">{data.studioNotes.filter((note) => !note.deletedAt).length}</strong>
        <p>{latest ? `Latest: ${latest.title}` : "No notes yet."}</p>
        <button type="button" className="forge-button text" onClick={() => props.onNavigate("studio")}>{latest ? "Open Notes" : "Start writing"}<ArrowRight size={15} /></button>
      </article>
    );
  }

  return (
    <article className="forge-panel widget-activity">
      <div className="panel-heading"><span className="forge-kicker">Recent activity</span><Check size={19} /></div>
      {data.activity.length ? (
        <div className="activity-list">
          {data.activity.slice(0, 4).map((item) => (
            <div className="activity-row" key={item.id}><span><strong>{item.label}</strong><small>{item.detail}</small></span><time>{relativeTime(item.createdAt)}</time></div>
          ))}
        </div>
      ) : <EmptyMessage title="Nothing recorded yet" detail="Notes and added reference files will appear here." />}
    </article>
  );
}

const MAX_REFERENCE_BYTES = 75 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function LibraryPage({ data, onAddFile, onRemoveFile }: {
  data: ForgeData;
  onAddFile: (file: File) => Promise<void>;
  onRemoveFile: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function accept(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setMessage("");
    for (const file of Array.from(list)) {
      // WebView2 sometimes hands over an empty MIME type, so trust the
      // extension as well before rejecting a genuine PDF.
      if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
        setMessage(`“${file.name}” is not a PDF.`);
        continue;
      }
      if (file.size > MAX_REFERENCE_BYTES) {
        setMessage(`“${file.name}” is larger than ${formatBytes(MAX_REFERENCE_BYTES)}.`);
        continue;
      }
      try {
        const signature = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
        if (!signature.includes("%PDF-")) { setMessage(`“${file.name}” does not contain a PDF document.`); continue; }
        await onAddFile(file);
      } catch (error) {
        setMessage(error instanceof DOMException && error.name === "QuotaExceededError"
          ? "There is not enough space on this device for that file."
          : `“${file.name}” could not be saved.`);
      }
    }
    setBusy(false);
  }

  return (
    <div className="forge-page">
      <PageHeader kicker="Your material" title="Library" detail="Reference files kept on this device. Open one beside your notes while you write." />
      <section className="forge-panel library-drop">
        <FilePdf size={26} />
        <div>
          <strong>Add a textbook or reference PDF</strong>
          <small>Stored on this device only. Up to {formatBytes(MAX_REFERENCE_BYTES)} per file.</small>
        </div>
        <button type="button" className="forge-button primary" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Plus size={15} />{busy ? "Adding…" : "Choose PDFs"}
        </button>
        <input hidden ref={inputRef} type="file" accept="application/pdf,.pdf" multiple
          onChange={(event) => { void accept(event.target.files); event.target.value = ""; }} />
      </section>
      {message && <p className="form-error" role="alert">{message}</p>}
      <section className="library-files" aria-label="Reference files">
        {data.files.length ? data.files.map((file) => (
          <article className="library-file" key={file.id}>
            <FilePdf size={20} />
            <div><strong>{file.name}</strong><small>{formatBytes(file.size)} · added {relativeTime(file.addedAt)}</small></div>
            <button type="button" className="danger-icon" aria-label={`Remove ${file.name}`} onClick={() => onRemoveFile(file.id)}><Trash size={17} /></button>
          </article>
        )) : <EmptyMessage title="No reference files yet" detail="Add a PDF and it will be available beside every note you write." />}
      </section>
    </div>
  );
}

function StudioPage({ accountId, data, openDocumentId, saveError, onAddNote, onUpdateNote, onRemoveNote, onRestoreNote }: {
  accountId: string;
  data: ForgeData;
  openDocumentId: string | null;
  saveError: string;
  onRestoreNote: (id: string) => void;
  onAddNote: (input: { title: string; topic: string; bodyHtml: string }) => StudioNote;
  onUpdateNote: (id: string, input: { title: string; topic: string; bodyHtml: string }) => void;
  onRemoveNote: (id: string) => void;
}) {
  return <div className="forge-page studio-documents">
    <StudioNotesTab accountId={accountId} openDocumentId={openDocumentId} notes={data.studioNotes} files={data.files} onAdd={onAddNote} onUpdate={onUpdateNote} onRemove={onRemoveNote} onRestore={onRestoreNote} />
  </div>;
}

/** One menu instance for the whole gallery, positioned from either a
 *  right-click or the card's ⋮ button — same code path, so keyboard users
 *  get the identical menu and the OS Menu key works for free. */
function CardMenu({ at, onClose, items }: {
  at: { x: number; y: number };
  onClose: () => void;
  items: Array<{ label: string; danger?: boolean; run: () => void }>;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const away = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  function arrows(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;
    buttons[(next + buttons.length) % buttons.length]?.focus();
  }

  return (
    <div ref={ref} className="card-menu" role="menu" onKeyDown={arrows}
      style={{ left: Math.max(8, Math.min(at.x, window.innerWidth - 210)), top: Math.max(8, Math.min(at.y, window.innerHeight - 190)) }}>
      {items.map((item) => (
        <button type="button" role="menuitem" key={item.label} className={item.danger ? "danger" : ""}
          onClick={() => { item.run(); onClose(); }}>{item.label}</button>
      ))}
    </div>
  );
}

function StudioNotesTab({ accountId, openDocumentId, notes, files, onAdd, onUpdate, onRemove, onRestore }: {
  accountId: string;
  notes: StudioNote[];
  openDocumentId: string | null;
  files: ReferenceFile[];
  onRestore: (id: string) => void;
  onAdd: (input: { title: string; topic: string; bodyHtml: string }) => StudioNote;
  onUpdate: (id: string, input: { title: string; topic: string; bodyHtml: string }) => void;
  onRemove: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(openDocumentId);
  useEffect(() => { if (openDocumentId) setSelectedId(openDocumentId); }, [openDocumentId]);
  const [filter, setFilter] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renameSettled = useRef(false);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const selected = notes.find((note) => note.id === selectedId && !note.deletedAt) ?? null;

  // One pass over the documents rather than a DOMPurify render per card:
  // a scaled HTML thumbnail re-runs on every keystroke and Quill's mm-based
  // widths don't shrink meaningfully anyway.
  // ponytail: text excerpt preview; swap to scaled HTML only if it reads badly.
  const previews = useMemo(() => {
    const map = new Map<string, string>();
    notes.forEach((note) => {
      // Joined per block, because textContent runs paragraphs together:
      // "…thylakoid membrane.Calvin cycle…".
      const body = new DOMParser().parseFromString(note.bodyHtml || "", "text/html").body;
      const text = [...body.children].map((block) => block.textContent || "").join(" ") || body.textContent || "";
      map.set(note.id, text.replace(/\s+/g, " ").trim().slice(0, 260));
    });
    return map;
  }, [notes]);

  const live = notes.filter((note) => !note.deletedAt);
  const shown = live.filter((note) => `${note.title} ${note.topic}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const deleted = notes.filter((note) => note.deletedAt);

  function createNote() {
    setSelectedId(onAdd({ title: "Untitled note", topic: "", bodyHtml: "" }).id);
  }

  if (!selected) {
    return (
      <>
        <PageHeader kicker="Your writing space" title="Notes" detail="Write, organise and keep your documents on this device." />
        <div className="notes-toolbar">
          <button type="button" className="forge-button primary" onClick={createNote}><Plus size={15} />New note</button>
          <input className="document-search" aria-label="Search notes" placeholder="Search notes" value={filter} onChange={(event) => setFilter(event.target.value)} />
        </div>

        {shown.length ? (
          <div className="notes-gallery">
            {shown.map((note) => (
              <article className="note-card" key={note.id}
                onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, id: note.id }); }}>
                <button type="button" className="note-card-open" onClick={() => setSelectedId(note.id)} aria-label={`Open ${note.title || "Untitled note"}`}>
                  <span className="note-card-preview" aria-hidden="true">{previews.get(note.id) || "Empty note"}</span>
                </button>
                <footer>
                  {renamingId === note.id ? (
                    <input className="note-card-rename" defaultValue={note.title} aria-label="Rename note"
                      // The menu unmounts in the same commit that mounts this
                      // input, and removing the focused menu item sends focus
                      // to the body. A ref callback re-takes it after that,
                      // and Enter commits directly rather than through blur,
                      // which is a no-op on an unfocused input.
                      ref={(element) => { if (element && document.activeElement !== element) element.focus(); }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          renameSettled.current = true;
                          onUpdate(note.id, { title: event.currentTarget.value, topic: note.topic, bodyHtml: note.bodyHtml });
                          setRenamingId(null);
                        }
                        if (event.key === "Escape") { renameSettled.current = true; setRenamingId(null); }
                      }}
                      onBlur={(event) => {
                        // Removing a focused input fires focusout, which React
                        // delivers as onBlur — without this, Escape would
                        // commit the value it just discarded.
                        if (renameSettled.current) { renameSettled.current = false; return; }
                        if (renamingId === note.id) onUpdate(note.id, { title: event.target.value, topic: note.topic, bodyHtml: note.bodyHtml });
                        setRenamingId(null);
                      }} />
                  ) : <strong>{note.title || "Untitled note"}</strong>}
                  <small>{note.topic ? `${note.topic} · ` : ""}Edited {new Date(note.updatedAt).toLocaleDateString()}</small>
                  <button type="button" className="note-card-more" aria-label={`Actions for ${note.title || "Untitled note"}`}
                    onClick={(event) => {
                      const box = event.currentTarget.getBoundingClientRect();
                      setMenu({ x: box.left, y: box.bottom + 4, id: note.id });
                    }}><DotsThreeVertical size={17} weight="bold" /></button>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <section className="forge-panel studio-notes-blank">
            <EmptyMessage title={live.length ? "No notes match that search" : "No notes yet"} detail={live.length ? "Try a different word." : "Start one with the New note button above."} />
          </section>
        )}

        {deleted.length > 0 && (
          <details className="document-trash"><summary>Recently deleted ({deleted.length})</summary>
            {deleted.map((note) => <button className="studio-notes-row" key={note.id} onClick={() => onRestore(note.id)}>Restore {note.title}</button>)}
          </details>
        )}

        {menu && (() => {
          const note = notes.find((item) => item.id === menu.id);
          if (!note) return null;
          return <CardMenu at={menu} onClose={() => setMenu(null)} items={[
            { label: "Open", run: () => setSelectedId(note.id) },
            { label: "Rename", run: () => setRenamingId(note.id) },
            { label: "Duplicate", run: () => onAdd({ title: `${note.title} copy`, topic: note.topic, bodyHtml: note.bodyHtml }) },
            { label: "Delete", danger: true, run: () => onRemove(note.id) },
          ]} />;
        })()}
      </>
    );
  }

  return (
    <section className="studio-notes-layout" data-view={referenceId ? "split" : "editor"}>
      <div className="editor-column">
        <div className="editor-bar">
          <button type="button" className="forge-button secondary" onClick={() => setSelectedId(null)}><ArrowLeft size={15} />All notes</button>
          <label className="editor-reference">
            <span>Reference</span>
            <select value={referenceId ?? ""} onChange={(event) => setReferenceId(event.target.value || null)} aria-label="Reference file">
              <option value="">None</option>
              {files.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
            </select>
          </label>
        </div>
        <DocumentEditor key={selected.id} accountId={accountId} note={selected} onUpdate={onUpdate} onRemove={() => { onRemove(selected.id); setSelectedId(null); }} />
      </div>
      {referenceId && <PdfPane key={referenceId} fileId={referenceId} storageKey={pdfAssetKey(accountId, referenceId)} name={files.find((file) => file.id === referenceId)?.name ?? "Reference"} onClose={() => setReferenceId(null)} />}
    </section>
  );
}


function SettingsPage({ name, onSaveName, onReset }: { name: string; onSaveName: (name: string) => void; onReset: () => void }) {
  const { theme, setTheme, glassMode, setGlassMode, background, setBackgroundMode, setBackgroundColor, setBackgroundPattern, setBackgroundImage, clearBackgroundImage } = useForgeTheme();
  const [draft, setDraft] = useState(name);
  const [confirmReset, setConfirmReset] = useState(false);
  const [backgroundError, setBackgroundError] = useState("");
  return (
    <div className="forge-page"><PageHeader kicker="This device" title="Settings" detail="Profile and appearance preferences stay local." />
      <div className="settings-grid"><form className="forge-panel settings-panel" onSubmit={(event) => { event.preventDefault(); onSaveName(draft); }}><h2>Profile</h2><label>Name<input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add your name" /></label><button type="submit" className="forge-button primary">Save name</button></form>
      <section className="forge-panel settings-panel">
        <h2>Appearance</h2>
        <div className="theme-options">
          <button type="button" className={theme === "ember-glass" ? "active" : ""} onClick={() => setTheme("ember-glass")}><span className="theme-swatch ember" /><strong>Ember Glass</strong><small>Warm liquid glass over glowing embers.</small></button>
          <button type="button" className={theme === "nightdesk" ? "active" : ""} onClick={() => setTheme("nightdesk")}><span className="theme-swatch night" /><strong>Nightdesk</strong><small>Cold liquid glass for late study.</small></button>
          <button type="button" className={theme === "forge-brutalist" ? "active" : ""} onClick={() => setTheme("forge-brutalist")}><span className="theme-swatch paper" /><strong>Paper</strong><small>Hard edges and warm print tones.</small></button>
        </div>
        {theme !== "forge-brutalist" && (
          <div className="appearance-controls">
            <div>
              <label>Glass &amp; motion<small>Auto checks this device once and remembers.</small></label>
              <div className="effects-options">
                <button type="button" className={glassMode === "auto" ? "active" : ""} onClick={() => setGlassMode("auto")}>Auto</button>
                <button type="button" className={glassMode === "on" ? "active" : ""} onClick={() => setGlassMode("on")}>On</button>
                <button type="button" className={glassMode === "off" ? "active" : ""} onClick={() => setGlassMode("off")}>Off</button>
              </div>
            </div>
            <div className="background-control">
              <label>Background<small>Use the theme artwork, your own image, a flat color or a quiet pattern.</small></label>
              <div className="effects-options background-mode-options" role="group" aria-label="Background style">
                {(["theme", "image", "solid", "pattern"] as const).map((mode) => <button type="button" key={mode} className={background.mode === mode ? "active" : ""} aria-pressed={background.mode === mode} onClick={() => { setBackgroundError(""); setBackgroundMode(mode); }}>{mode === "theme" ? "Theme" : mode === "image" ? "Image" : mode === "solid" ? "Color" : "Pattern"}</button>)}
              </div>
              {background.mode === "image" && <div className="background-detail">
                <input type="file" accept="image/*" aria-label="Choose a custom background image" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setBackgroundError("");
                  void setBackgroundImage(file).catch((error: unknown) => setBackgroundError(error instanceof Error ? error.message : "Background image could not be saved."));
                  event.currentTarget.value = "";
                }} />
                {background.imageName && <><small title={background.imageName}>{background.imageName}</small><button type="button" className="forge-button text" onClick={() => void clearBackgroundImage().catch(() => setBackgroundError("Background image could not be removed."))}>Remove image</button></>}
              </div>}
              {(background.mode === "solid" || background.mode === "pattern") && <div className="background-detail compact">
                <label className="background-color">Base color<input type="color" value={background.color} onChange={(event) => setBackgroundColor(event.target.value)} /></label>
                {background.mode === "pattern" && <label>Pattern<select value={background.pattern} onChange={(event) => setBackgroundPattern(event.target.value as "grid" | "dots" | "diagonal")}><option value="grid">Grid</option><option value="dots">Dots</option><option value="diagonal">Diagonal</option></select></label>}
              </div>}
              {backgroundError && <p className="form-error" role="alert">{backgroundError}</p>}
            </div>
          </div>
        )}
      </section>
      <section className="forge-panel settings-panel danger-zone"><h2>Local data</h2><p>Clear this account's notes, documents, reference files, background image and widget layout from this device.</p>{confirmReset ? <div className="panel-actions"><button type="button" className="forge-button danger-confirm" onClick={() => { onReset(); setDraft(""); setConfirmReset(false); }}>Clear everything</button><button type="button" className="forge-button secondary" onClick={() => setConfirmReset(false)}>Cancel</button></div> : <button type="button" className="forge-button secondary" onClick={() => setConfirmReset(true)}>Clear workspace…</button>}</section></div>
      <AppUpdater appName="Cinder Student" />
    </div>
  );
}

function SearchPanel({ search, data, onClose, onNavigate, onOpenDocument }: { onOpenDocument: (id: string) => void; search: { query: string; ids: string[] }; data: ForgeData; onClose: () => void; onNavigate: (page: Page) => void }) {
  return (
    <div className="search-backdrop" onMouseDown={onClose}><aside className="search-panel" role="dialog" aria-modal="true" aria-labelledby="search-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="forge-kicker">Search</span><h2 id="search-title">{search.query ? `Results for “${search.query}”` : "Search Matchbox"}</h2></div><button type="button" aria-label="Close search" onClick={onClose}><X size={20} /></button></header>
      {!search.query ? <EmptyMessage title="Type something to search" detail="Search your notes and reference files stored on this device." /> : search.ids.length ? <div className="search-results">{search.ids.map((entry) => {
        const [kind, id] = entry.split(":");
        if (kind === "file") {
          const file = data.files.find((item) => item.id === id);
          if (!file) return null;
          return <button type="button" key={entry} onClick={() => { onNavigate("library"); onClose(); }}><span>Reference file</span><strong>{file.name}</strong><small>Library</small><ArrowRight size={16} /></button>;
        }
        const item = data.studioNotes.find((note) => note.id === id && !note.deletedAt);
        if (!item) return null;
        return <button type="button" key={entry} onClick={() => { onOpenDocument(id); onClose(); }}><span>Note</span><strong>{item.title}</strong><small>{item.topic || "No topic"}</small><ArrowRight size={16} /></button>;
      })}</div> : <EmptyMessage title="No matches" detail="Nothing saved in Matchbox matches that search." />}
    </aside></div>
  );
}

function PageHeader({ kicker, title, detail }: { kicker: string; title: string; detail: string }) {
  return <header className="page-header"><span className="forge-kicker">{kicker}</span><h1>{title}</h1><p>{detail}</p></header>;
}

function EmptyMessage({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-message"><strong>{title}</strong><p>{detail}</p></div>;
}
