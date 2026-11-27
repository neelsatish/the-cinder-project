import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppShell,
  AppUpdater,
  Badge,
  Button,
  cacheGet,
  EmptyState,
  formatDate,
  formatWhen,
  hostAddressLabel,
  Icon,
  outboxEntries,
  PageHeader,
  Panel,
  StudentAiHelper,
  ThemePicker,
  type Assignment,
  type CinderApi,
  type NavigationItem,
  type QuizDelivery,
  type Submission,
} from "@cinder/ui";

import { MatchboxSessionGate, type MatchboxSession } from "./matchboxSession";
import { useCountdown, SidebarTimer } from "./components/Countdown";
import { useForgeData, type ForgeData, type ReferenceFile, type StudioNote } from "./forgeData";
import { clearAssets, useForgeTheme, writeAsset } from "./theme";
import { StudentClassrooms, type ClassroomFocus } from "./classrooms/StudentClassrooms";
import { belongsToClassroomScope, classroomCacheKey, classroomScope } from "./classrooms/classroomState";
import { LiveSessionBar, useStudentLiveSession } from "./classrooms/LiveSession";
import { REJECTED_HAND_IN, sendQueuedHandIns } from "./classrooms/outbox";
import "./studio/documents.css";

// The editor pulls in Quill and KaTeX, and the PDF pane pdf.js; loading them on
// first use keeps the student app quick to open on modest school machines.
const DocumentEditor = lazy(() => import("./studio/DocumentEditor").then((module) => ({ default: module.DocumentEditor })));
const PdfPane = lazy(() => import("./studio/PdfPane").then((module) => ({ default: module.PdfPane })));

type Page = "home" | "classrooms" | "live" | "notes" | "library" | "helper" | "settings";
type NoteInput = { title: string; topic: string; bodyHtml: string; assignmentId?: string };

function pdfAssetKey(accountId: string, fileId: string) {
  return `account:${accountId}:pdf:${fileId}`;
}

export function App() {
  return <MatchboxSessionGate>{(session) => <MatchboxWorkspace key={session.user.id} session={session} />}</MatchboxSessionGate>;
}

function MatchboxWorkspace({ session }: { session: MatchboxSession }) {
  const forge = useForgeData(session.user.id, session.user.display_name);
  const { clearBackgroundImage } = useForgeTheme();
  const [page, setPage] = useState<Page>("home");
  const [focus, setFocus] = useState<ClassroomFocus | null>(null);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [classroomsVisit, setClassroomsVisit] = useState(0);
  const [helperOn, setHelperOn] = useState(false);
  const timer = useCountdown(session.user.id);
  const live = useStudentLiveSession({ api: session.api, baseUrl: session.baseUrl, accountId: session.user.id, online: session.online });
  const liveNow = Boolean(live.session && live.remainingSeconds > 0 && live.resultState === "active");

  // The study helper is off until the school turns it on, and an older Host
  // does not have it at all; either way the nav item stays hidden.
  useEffect(() => {
    let current = true;
    session.api.studentAiStatus().then(
      (status) => { if (current) setHelperOn(status.enabled); },
      () => { if (current) setHelperOn(false); },
    );
    return () => { current = false; };
  }, [session.api, session.online, refreshKey]);
  useEffect(() => { if (!helperOn && page === "helper") setPage("home"); }, [helperOn, page]);

  useEffect(() => {
    if (!toast) return;
    const handle = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(handle);
  }, [toast]);

  // Work handed in offline goes as soon as the Host answers, whichever page is open.
  const scope = classroomScope(session.baseUrl, session.user.id);
  useEffect(() => {
    if (!session.online) return;
    void sendQueuedHandIns(session.api, scope)
      .then(({ rejected }) => { if (rejected) setToast(REJECTED_HAND_IN); })
      .catch(() => undefined);
  }, [scope, session.api, session.online]);

  // Only when a running timer finishes: a timer saved as finished must not announce itself on every launch.
  const timerStatus = useRef(timer.status);
  useEffect(() => {
    if (timer.status === "done" && timerStatus.current === "running") setToast("Time is up");
    timerStatus.current = timer.status;
  }, [timer.status]);

  const navItems: NavigationItem<Page>[] = [
    { id: "home", label: "Home", icon: "home" },
    { id: "classrooms", label: "Classrooms", icon: "classrooms" },
    { id: "live", label: "Live class", icon: "live", badge: liveNow && !live.joined ? 1 : undefined },
    { id: "notes", label: "Notes", icon: "notes" },
    { id: "library", label: "Library", icon: "library" },
    // Shown only once the school has switched the study helper on in Cinder Host.
    ...(helperOn ? [{ id: "helper", label: "Study helper", icon: "assistant" } as NavigationItem<Page>] : []),
    { id: "settings", label: "Settings", icon: "settings" },
  ];

  function go(next: Page) {
    setQuery("");
    setPage(next);
    if (next !== "classrooms") setFocus(null);
  }

  function openAssignment(assignmentId: string) {
    setFocus({ assignmentId });
    go("classrooms");
  }

  function openNote(id: string) {
    setOpenNoteId(id);
    go("notes");
  }

  function newNote(input: NoteInput = { title: "Untitled note", topic: "", bodyHtml: "" }) {
    openNote(forge.addStudioNote(input).id);
  }

  async function refreshWorkspace() {
    const connected = await session.refresh();
    if (!connected) {
      setToast("Cinder Host is not reachable");
      return;
    }
    // A rebuilt Classrooms page starts at the list, not at an item Home opened earlier.
    setFocus(null);
    setRefreshKey((value) => value + 1);
    setToast("Up to date");
  }

  function openLiveTask() {
    const kind = live.session?.current_task?.kind;
    go(kind === "instruction" || !kind ? "live" : "classrooms");
    if (kind) void live.acknowledgeTask(kind === "instruction" ? "opened" : "in_progress");
  }

  async function clearWorkspace() {
    // IndexedDB is async and resetWorkspace is not, so the blobs go first —
    // otherwise "Clear" leaves every uploaded textbook on a shared device.
    // Clearing by prefix also catches orphans whose metadata is already gone;
    // `pdf:` is the pre-account-scoping key shape.
    try {
      await clearAssets([`account:${session.user.id}:`, "pdf:"]);
      await clearBackgroundImage();
    } catch {
      setToast("Files on this device could not be cleared");
      return;
    }
    setToast(forge.resetWorkspace() ? "Notes and files cleared from this device" : "Some data could not be cleared");
  }

  async function addReferenceFile(file: File) {
    const id = crypto.randomUUID();
    await writeAsset(pdfAssetKey(session.user.id, id), file);
    forge.addReferenceFile({ id, name: file.name, size: file.size });
    setToast("Added to Library");
  }

  function removeReferenceFile(id: string) {
    // Blob first: a failure leaves a file you can still see and retry.
    void writeAsset(pdfAssetKey(session.user.id, id), null)
      .then(() => forge.removeReferenceFile(id))
      .catch(() => setToast("That file could not be removed"));
  }

  return (
    <>
      <AppShell
        roleLabel="Student"
        user={session.user}
        items={navItems}
        active={page}
        onNavigate={(next) => {
          // Choosing Classrooms from inside a classroom goes back to the list.
          if (next === "classrooms" && page === "classrooms") { setFocus(null); setClassroomsVisit((value) => value + 1); }
          go(next);
        }}
        onLogout={() => void session.switchAccount()}
        online={session.online}
        onRefresh={() => void refreshWorkspace()}
        search={
          <label className="sidebar-search">
            <Icon name="search" />
            <input
              type="search"
              aria-label="Search notes and files"
              placeholder="Search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }}
            />
          </label>
        }
        footer={<SidebarTimer timer={timer} />}
      >
        <LiveSessionBar live={live} online={session.online} onOpen={openLiveTask} />
        {forge.saveError ? <p role="alert" className="notice notice-error app-alert">{forge.saveError}</p> : null}
        {query.trim() ? (
          <SearchResults query={query.trim()} data={forge.data} onOpenNote={openNote} onOpenLibrary={() => go("library")} />
        ) : page === "home" ? (
          <HomePage
            api={session.api}
            scope={scope}
            online={session.online}
            refreshKey={refreshKey}
            notes={forge.data.studioNotes}
            liveNow={liveNow && !live.joined}
            liveClassroom={live.session?.classroom_name ?? ""}
            onJoinLive={() => void live.joinDiscovered().then(() => go("live"))}
            onOpenAssignment={openAssignment}
            onOpenQuiz={(delivery) => { setFocus({ classroomId: delivery.classroom_id, deliveryId: delivery.id }); go("classrooms"); }}
            onOpenNote={openNote}
            onNewNote={() => newNote()}
          />
        ) : page === "classrooms" ? (
          <StudentClassrooms
            key={`${refreshKey}-${classroomsVisit}`}
            accountId={session.user.id}
            api={session.api}
            baseUrl={session.baseUrl}
            token={session.token}
            online={session.online}
            notes={forge.data.studioNotes}
            focus={focus}
            liveTask={live.session?.current_task ?? null}
            onLiveTaskState={live.acknowledgeTask}
            onOpenNote={openNote}
            onStartNote={(input) => newNote(input)}
          />
        ) : page === "live" ? (
          <StudentLiveClassroom live={live} online={session.online} onOpenTask={openLiveTask} />
        ) : page === "notes" ? (
          <NotesPage
            accountId={session.user.id}
            data={forge.data}
            openNoteId={openNoteId}
            onSelect={setOpenNoteId}
            onAdd={forge.addStudioNote}
            onUpdate={forge.updateStudioNote}
            onRemove={forge.removeStudioNote}
            onRestore={forge.restoreStudioNote}
            onOpenAssignment={openAssignment}
          />
        ) : page === "library" ? (
          <LibraryPage accountId={session.user.id} data={forge.data} onAddFile={addReferenceFile} onRemoveFile={removeReferenceFile} />
        ) : page === "helper" && helperOn ? (
          <div className="workspace"><div className="page"><StudentAiHelper api={session.api} /></div></div>
        ) : (
          <SettingsPage
            name={session.user.display_name}
            baseUrl={session.baseUrl}
            onOpenConnection={session.openConnection}
            onSignOut={() => void session.switchAccount()}
            onReset={clearWorkspace}
          />
        )}
      </AppShell>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </>
  );
}

function HomePage({ api, scope, online, refreshKey, notes, liveNow, liveClassroom, onJoinLive, onOpenAssignment, onOpenQuiz, onOpenNote, onNewNote }: {
  api: CinderApi;
  scope: string;
  online: boolean;
  refreshKey: number;
  notes: StudioNote[];
  liveNow: boolean;
  liveClassroom: string;
  onJoinLive: () => void;
  onOpenAssignment: (assignmentId: string) => void;
  onOpenQuiz: (delivery: QuizDelivery) => void;
  onOpenNote: (id: string) => void;
  onNewNote: () => void;
}) {
  const [work, setWork] = useState<{ assignments: Assignment[]; submissions: Record<string, Submission | null>; quizzes: QuizDelivery[] } | null>(null);
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const [unreachable, setUnreachable] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Send work handed in offline first, so To do shows what is really still waiting.
      if (online) await sendQueuedHandIns(api, scope).catch(() => undefined);
      // The classroom pages keep these cached; reading them first means Home
      // has something to show when the Host is unreachable.
      const [cachedAssignments, cachedSubmissions, outbox] = await Promise.all([
        cacheGet<Assignment[]>(classroomCacheKey(scope, "assignments")),
        cacheGet<Record<string, Submission | null>>(classroomCacheKey(scope, "submissions")),
        outboxEntries(),
      ]);
      if (cancelled) return;
      // Hand-ins made offline wait in the outbox until the Host answers.
      setQueued(new Set(outbox
        .filter((entry) => entry.kind === "submission" && belongsToClassroomScope(entry.key, scope))
        .map((entry) => (entry.payload as { assignmentId: string }).assignmentId)));
      if (cachedAssignments) setWork({ assignments: cachedAssignments, submissions: cachedSubmissions ?? {}, quizzes: [] });
      setUnreachable(!online && !cachedAssignments);
      if (!online) return;
      const [assignments, quizzes] = await Promise.all([api.assignments(), api.quizDeliveries()]);
      const open = assignments.filter((item) => item.status === "published");
      const submissions = Object.fromEntries(await Promise.all(open.map(async (item) => [item.id, await api.mySubmission(item.id)] as const)));
      if (!cancelled) { setWork({ assignments, submissions, quizzes }); setError(""); }
    }
    load().catch((failure) => { if (!cancelled) setError(failure instanceof Error ? failure.message : "Work could not be loaded."); });
    return () => { cancelled = true; };
  }, [api, online, refreshKey, scope]);

  const now = Date.now();
  const due = (work?.assignments ?? [])
    .filter((item) => item.status === "published")
    .filter((item) => { const submission = work?.submissions[item.id]; return !submission || submission.status === "withdrawn"; })
    .sort((left, right) => (left.due_at ? Date.parse(left.due_at) : Infinity) - (right.due_at ? Date.parse(right.due_at) : Infinity));
  // Live-class quizzes are reached through the live class and close with it.
  const quizzes = (work?.quizzes ?? []).filter((delivery) =>
    delivery.kind === "homework" && delivery.attempt_state !== "submitted" && delivery.attempt_state !== "expired" && !delivery.results_released_at
    && (!delivery.opens_at || Date.parse(delivery.opens_at) <= now)
    && (!delivery.due_at || Date.parse(delivery.due_at) > now));
  const recent = notes.filter((note) => !note.deletedAt).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)).slice(0, 5);

  return (
    <div className="workspace">
      <div className="page">
        <PageHeader title="Home" />
        {liveNow ? (
          <div className="live-callout">
            <Icon name="live" />
            <span><strong>{liveClassroom} is live</strong><small>Your teacher has started a live class.</small></span>
            <Button variant="primary" onClick={onJoinLive}>Join</Button>
          </div>
        ) : null}
        <Panel title="To do" className="panel-flush">
          {error ? <p className="form-error panel-message" role="alert">{error}</p> : null}
          {!work && !error && unreachable ? (
            <EmptyState icon="assignments" title="Not connected" description="Your work and quizzes appear here once this computer reaches Cinder Host." />
          ) : null}
          {!work && !error && !unreachable ? <p className="loading-line">Loading…</p> : null}
          {work && !due.length && !quizzes.length ? (
            <EmptyState icon="check" title="Nothing due" description="Work and quizzes from your classrooms appear here." />
          ) : null}
          <div className="list">
            {quizzes.map((delivery) => (
              <button key={delivery.id} type="button" className="list-item" onClick={() => onOpenQuiz(delivery)}>
                <span className="list-icon"><Icon name="check" /></span>
                <span className="list-copy"><strong>{delivery.title}</strong><span>{delivery.classroom_name} · Quiz{delivery.due_at ? ` · Due ${formatWhen(delivery.due_at)}` : ""}</span></span>
                {delivery.attempt_id ? <Badge tone="accent">In progress</Badge> : null}
              </button>
            ))}
            {due.map((assignment) => {
              const late = assignment.due_at ? Date.parse(assignment.due_at) < now : false;
              return (
                <button key={assignment.id} type="button" className="list-item" onClick={() => onOpenAssignment(assignment.id)}>
                  <span className="list-icon"><Icon name="assignments" /></span>
                  <span className="list-copy"><strong>{assignment.title}</strong><span>{assignment.classroom_name}{assignment.due_at ? ` · Due ${formatWhen(assignment.due_at)}` : ""}</span></span>
                  {queued.has(assignment.id) ? <Badge>Waiting to send</Badge> : late ? <Badge tone="warning">Past due date</Badge> : null}
                </button>
              );
            })}
          </div>
        </Panel>
        <Panel title="Recent notes" className="panel-flush" action={<Button size="small" icon="plus" onClick={onNewNote}>New note</Button>}>
          {recent.length ? (
            <div className="list">
              {recent.map((note) => (
                <button key={note.id} type="button" className="list-item" onClick={() => onOpenNote(note.id)}>
                  <span className="list-icon"><Icon name="notes" /></span>
                  <span className="list-copy"><strong>{note.title || "Untitled note"}</strong><span>{note.topic ? `${note.topic} · ` : ""}Edited {formatWhen(note.updatedAt)}</span></span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon="notes" title="No notes yet" description="Notes are saved on this computer." />
          )}
        </Panel>
      </div>
    </div>
  );
}

function StudentLiveClassroom({ live, online, onOpenTask }: { live: ReturnType<typeof useStudentLiveSession>; online: boolean; onOpenTask: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const task = live.session?.current_task;
  const running = live.session && live.resultState !== "ended" && live.resultState !== "expired";
  return (
    <div className="workspace">
      <div className="page">
        <PageHeader title="Live class" />
        {live.sessions.length > 1 ? (
          <Panel title="Live now" className="panel-flush">
            <div className="list">
              {live.sessions.map((session) => (
                <button className="list-item" type="button" key={session.id} onClick={() => live.selectSession(session.id)}>
                  <span className="list-copy"><strong>{session.classroom_name}</strong><span>{session.current_task?.title ?? "Waiting for a task"}</span></span>
                  {session.id === live.session?.id ? <Badge tone="accent">Selected</Badge> : null}
                </button>
              ))}
            </div>
          </Panel>
        ) : null}
        {running && !live.joined ? (
          <Panel title={`${live.session!.classroom_name} is live`}>
            <div className="stack-row">
              <p className="muted">Join to see the task your teacher sets.</p>
              <Button variant="primary" disabled={!online || live.resultState !== "active"} onClick={() => void live.joinDiscovered()}>Join live class</Button>
            </div>
          </Panel>
        ) : null}
        {running && live.joined ? (
          <Panel title={task?.title ?? "Waiting for a task"}>
            <div className="form-stack">
              <p>{task?.instructions || "Your teacher has not set a task yet."}</p>
              {task ? (
                <div className="panel-actions">
                  <Button variant="primary" disabled={live.resultState !== "active"} onClick={onOpenTask}>{task.kind === "instruction" ? "View task" : "Open task"}</Button>
                  {task.kind === "instruction" && live.session!.student_task_state?.state !== "completed" ? (
                    <Button disabled={!online || live.resultState !== "active"} onClick={() => void live.acknowledgeTask("completed")}>Mark as done</Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Panel>
        ) : null}
        {!running ? (
          <Panel>
            <form className="join-row" onSubmit={async (event) => {
              event.preventDefault();
              setError("");
              try { await live.join(code); setCode(""); }
              catch (failure) { setError(failure instanceof Error ? failure.message : "The live class could not be joined."); }
            }}>
              <label className="field">
                <span>No live class right now. Have a code from your teacher?</span>
                <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 10))} minLength={10} maxLength={10} required placeholder="10-character code" />
              </label>
              <Button variant="primary" type="submit" disabled={!online}>Join</Button>
            </form>
          </Panel>
        ) : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
    </div>
  );
}

const MAX_REFERENCE_BYTES = 75 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) { const mb = bytes / (1024 * 1024); return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`; }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function LibraryPage({ accountId, data, onAddFile, onRemoveFile }: {
  accountId: string;
  data: ForgeData;
  onAddFile: (file: File) => Promise<void>;
  onRemoveFile: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = data.files.find((file) => file.id === openId) ?? null;

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
          ? "There is not enough space on this computer for that file."
          : `“${file.name}” could not be saved.`);
      }
    }
    setBusy(false);
  }

  if (opened) {
    return (
      <div className="reader-page">
        <Suspense fallback={<p className="loading-line">Opening…</p>}>
          <PdfPane key={opened.id} fileId={opened.id} storageKey={pdfAssetKey(accountId, opened.id)} name={opened.name} onClose={() => setOpenId(null)} />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="workspace">
      <div className="page">
        <PageHeader
          title="Library"
          description="PDFs kept on this computer, to read on their own or beside a note."
          action={<Button variant="primary" icon="plus" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "Adding…" : "Add PDF"}</Button>}
        />
        <input hidden ref={inputRef} type="file" accept="application/pdf,.pdf" multiple onChange={(event) => { void accept(event.target.files); event.target.value = ""; }} />
        {message ? <p className="form-error" role="alert">{message}</p> : null}
        <Panel className="panel-flush">
          {data.files.length ? (
            <div className="list">
              {data.files.map((file) => (
                <div className="list-item" key={file.id}>
                  <span className="list-icon"><Icon name="pdf" /></span>
                  <button type="button" className="list-copy list-open" onClick={() => setOpenId(file.id)}>
                    <strong>{file.name}</strong>
                    <span>{formatBytes(file.size)} · Added {formatDate(file.addedAt)}</span>
                  </button>
                  <button type="button" className="icon-button" aria-label={`Remove ${file.name}`} title="Remove" onClick={() => onRemoveFile(file.id)}><Icon name="trash" /></button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="library" title="No PDFs yet" description={`Add a textbook or worksheet, up to ${formatBytes(MAX_REFERENCE_BYTES)} each.`} />
          )}
        </Panel>
      </div>
    </div>
  );
}

/** Right-click menu for a note in the list. */
function NoteMenu({ at, onClose, items }: {
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
  return (
    <div ref={ref} className="menu" role="menu" style={{ left: Math.max(8, Math.min(at.x, window.innerWidth - 200)), top: Math.max(8, Math.min(at.y, window.innerHeight - 120)) }}>
      {items.map((item) => (
        <button type="button" role="menuitem" key={item.label} className={item.danger ? "danger" : ""} onClick={() => { item.run(); onClose(); }}>{item.label}</button>
      ))}
    </div>
  );
}

function NotesPage({ accountId, data, openNoteId, onSelect, onAdd, onUpdate, onRemove, onRestore, onOpenAssignment }: {
  accountId: string;
  data: ForgeData;
  openNoteId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (input: NoteInput) => StudioNote;
  onUpdate: (id: string, input: { title: string; topic: string; bodyHtml: string }) => void;
  onRemove: (id: string) => void;
  onRestore: (id: string) => void;
  onOpenAssignment: (assignmentId: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const notes = data.studioNotes;
  const live = useMemo(() => notes.filter((note) => !note.deletedAt).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)), [notes]);
  const shown = live.filter((note) => `${note.title} ${note.topic}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const deleted = notes.filter((note) => note.deletedAt);
  const selected = live.find((note) => note.id === openNoteId) ?? null;
  const reference = data.files.find((file) => file.id === referenceId) ?? null;
  const closeMenu = useCallback(() => setMenu(null), []);

  function create() {
    onSelect(onAdd({ title: "Untitled note", topic: "", bodyHtml: "" }).id);
  }

  return (
    <div className="notes-layout" data-reference={reference ? "open" : undefined}>
      <aside className="notes-list" aria-label="Notes">
        <div className="notes-list-head">
          <h1>Notes</h1>
          <button type="button" className="icon-button" onClick={create} aria-label="New note" title="New note"><Icon name="plus" /></button>
        </div>
        <input type="search" aria-label="Filter notes" placeholder="Filter" value={filter} onChange={(event) => setFilter(event.target.value)} />
        <div className="notes-list-items">
          {shown.map((note) => (
            <button
              type="button"
              key={note.id}
              className={`note-row${note.id === selected?.id ? " is-active" : ""}`}
              onClick={() => onSelect(note.id)}
              onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, id: note.id }); }}
            >
              <strong>{note.title || "Untitled note"}</strong>
              <small>{note.topic ? `${note.topic} · ` : ""}{formatDate(note.updatedAt)}</small>
            </button>
          ))}
          {!shown.length ? <p className="notes-list-empty">{live.length ? "No notes match." : "No notes yet."}</p> : null}
        </div>
        {deleted.length ? (
          <details className="notes-trash">
            <summary>Recently deleted ({deleted.length})</summary>
            {deleted.map((note) => <button type="button" key={note.id} onClick={() => onRestore(note.id)}>Restore “{note.title}”</button>)}
          </details>
        ) : null}
      </aside>
      <section className="notes-editor">
        {selected ? (
          <>
            <div className="editor-bar">
              {selected.assignmentId ? (
                <Button size="small" variant="ghost" icon="assignments" onClick={() => onOpenAssignment(selected.assignmentId!)}>Go to assignment</Button>
              ) : <span />}
              <label className="editor-reference">
                <span>Read beside</span>
                <select value={referenceId ?? ""} onChange={(event) => setReferenceId(event.target.value || null)} aria-label="PDF to read beside this note">
                  <option value="">Nothing</option>
                  {data.files.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
                </select>
              </label>
            </div>
            <Suspense fallback={<p className="loading-line" role="status">Opening the editor…</p>}>
              <DocumentEditor key={selected.id} accountId={accountId} note={selected} onUpdate={onUpdate} onRemove={() => { onRemove(selected.id); onSelect(null); }} />
            </Suspense>
          </>
        ) : (
          <EmptyState
            icon="notes"
            title={live.length ? "No note open" : "No notes yet"}
            description={live.length ? "Choose a note from the list." : "Notes are saved on this computer."}
            action={<Button variant="primary" icon="plus" onClick={create}>New note</Button>}
          />
        )}
      </section>
      {reference ? (
        <Suspense fallback={null}>
          <PdfPane key={reference.id} fileId={reference.id} storageKey={pdfAssetKey(accountId, reference.id)} name={reference.name} onClose={() => setReferenceId(null)} />
        </Suspense>
      ) : null}
      {menu ? (() => {
        const note = notes.find((item) => item.id === menu.id);
        if (!note) return null;
        return <NoteMenu at={menu} onClose={closeMenu} items={[
          { label: "Duplicate", run: () => onSelect(onAdd({ title: `${note.title} copy`, topic: note.topic, bodyHtml: note.bodyHtml }).id) },
          { label: "Delete", danger: true, run: () => { onRemove(note.id); if (note.id === selected?.id) onSelect(null); } },
        ]} />;
      })() : null}
    </div>
  );
}

function SettingsPage({ name, baseUrl, onOpenConnection, onSignOut, onReset }: {
  name: string;
  baseUrl: string;
  onOpenConnection: () => void;
  onSignOut: () => void;
  onReset: () => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <div className="workspace">
      <div className="page">
        <PageHeader title="Settings" />
        <Panel title="Account" className="panel-flush">
          <div className="settings-list">
            <div className="settings-row"><div><strong>{name}</strong><small>Your teacher manages your name.</small></div><Button onClick={onSignOut}>Sign out</Button></div>
            <div className="settings-row"><div><strong>School connection</strong><small>{hostAddressLabel(baseUrl)}</small></div><Button onClick={onOpenConnection}>Change</Button></div>
          </div>
        </Panel>
        <Panel title="Appearance" className="panel-flush">
          <div className="settings-list">
            <div className="settings-row"><div><strong>Theme</strong></div><ThemePicker /></div>
          </div>
        </Panel>
        <AppUpdater appName="Cinder Student" />
        <Panel title="This computer" className="panel-flush">
          <div className="settings-list">
            <div className="settings-row">
              <div><strong>Clear notes and files</strong><small>Removes this account’s notes and Library PDFs from this computer. Work handed in to teachers is kept on the Host.</small></div>
              {confirmReset ? (
                <span className="panel-actions">
                  <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
                  <Button variant="danger" onClick={() => { onReset(); setConfirmReset(false); }}>Clear everything</Button>
                </span>
              ) : <Button onClick={() => setConfirmReset(true)}>Clear…</Button>}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function SearchResults({ query, data, onOpenNote, onOpenLibrary }: { query: string; data: ForgeData; onOpenNote: (id: string) => void; onOpenLibrary: () => void }) {
  const lower = query.toLocaleLowerCase();
  const notes = data.studioNotes.filter((note) => !note.deletedAt && [note.title, note.topic, new DOMParser().parseFromString(note.bodyHtml, "text/html").body.textContent || ""].some((value) => value.toLocaleLowerCase().includes(lower)));
  const files: ReferenceFile[] = data.files.filter((file) => file.name.toLocaleLowerCase().includes(lower));
  return (
    <div className="workspace">
      <div className="page">
        <PageHeader title={`Results for “${query}”`} description="Searches the notes and PDFs on this computer." />
        <Panel className="panel-flush">
          {notes.length || files.length ? (
            <div className="list">
              {notes.map((note) => (
                <button type="button" className="list-item" key={note.id} onClick={() => onOpenNote(note.id)}>
                  <span className="list-icon"><Icon name="notes" /></span>
                  <span className="list-copy"><strong>{note.title || "Untitled note"}</strong><span>Note{note.topic ? ` · ${note.topic}` : ""}</span></span>
                </button>
              ))}
              {files.map((file) => (
                <button type="button" className="list-item" key={file.id} onClick={onOpenLibrary}>
                  <span className="list-icon"><Icon name="pdf" /></span>
                  <span className="list-copy"><strong>{file.name}</strong><span>Library</span></span>
                </button>
              ))}
            </div>
          ) : <EmptyState icon="search" title="No matches" />}
        </Panel>
      </div>
    </div>
  );
}
