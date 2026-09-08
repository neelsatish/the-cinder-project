import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import {
  ApiError,
  cacheGet,
  cacheSet,
  forgeQuillHtmlToDocument,
  outboxEntries,
  queueOffline,
  removeOutbox,
  type Assignment,
  type CinderApi,
  type Classroom,
  type StudyNode,
  type Submission,
  type SubmissionComment,
} from "@cinder/ui";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { StudioNote } from "../forgeData";
import {
  belongsToClassroomScope,
  classroomCacheKey,
  classroomScope,
  formatAssignmentDue,
  shouldRetryOutboxFailure,
  submissionOutboxKey,
} from "./classroomState";
import "./classrooms.css";

type ClassroomSection = "overview" | "work" | "materials" | "marks";
type SubmissionPayload = {
  assignmentId: string;
  doc: Record<string, unknown>;
  text: string;
  note: string;
};

function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

function errorMessage(failure: unknown) {
  return failure instanceof Error ? failure.message : "That action could not be completed.";
}

function submissionLabel(submission: Submission | null | undefined, queued: boolean) {
  if (queued) return "Waiting to send";
  if (!submission || submission.status === "withdrawn") return "Not submitted";
  if (submission.grade?.published) return "Marked";
  return submission.status === "resubmitted" ? "Resubmitted" : "Submitted";
}

async function openMaterial(
  api: CinderApi,
  baseUrl: string,
  token: string,
  material: StudyNode,
) {
  if (isTauri()) {
    await invoke("open_material", {
      baseUrl,
      token,
      fileId: material.id,
      fileName: material.name,
    });
    return;
  }
  const blob = await api.materialBlob(material.id);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

export function StudentClassrooms({
  accountId,
  api,
  baseUrl,
  token,
  online,
  notes,
  onJoinLiveSession,
}: {
  accountId: string;
  api: CinderApi;
  baseUrl: string;
  token: string;
  online: boolean;
  notes: StudioNote[];
  onJoinLiveSession: (code: string) => Promise<void>;
}) {
  const scope = useMemo(() => classroomScope(baseUrl, accountId), [accountId, baseUrl]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, Submission | null>>({});
  const [nodes, setNodes] = useState<StudyNode[]>([]);
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const [selectedClassroomId, setSelectedClassroomId] = useState<string | null>(null);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [section, setSection] = useState<ClassroomSection>("overview");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const generation = useRef(0);

  const readQueued = useCallback(async () => {
    const entries = await outboxEntries();
    const ids = entries
      .filter((entry) => entry.kind === "submission" && belongsToClassroomScope(entry.key, scope))
      .map((entry) => (entry.payload as SubmissionPayload).assignmentId);
    setQueued(new Set(ids));
  }, [scope]);

  const flushCurrentStudent = useCallback(async () => {
    for (const entry of await outboxEntries()) {
      if (entry.kind !== "submission" || !belongsToClassroomScope(entry.key, scope)) continue;
      const payload = entry.payload as SubmissionPayload;
      try {
        await api.submitWork(payload.assignmentId, payload.doc, payload.text, payload.note);
        await removeOutbox(entry.key);
      } catch (failure) {
        if (!(failure instanceof ApiError)) break;
        if (shouldRetryOutboxFailure(failure.status, failure.offline)) {
          if (failure.offline) break;
          continue;
        }
        await removeOutbox(entry.key);
        setMessage("A waiting submission was rejected by the Host and was not sent. Your original note is still saved on this device.");
      }
    }
    await readQueued();
  }, [api, readQueued, scope]);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setMessage("");
    try {
      if (!online) throw new ApiError("offline", "Host unavailable", 0);
      await flushCurrentStudent();
      if (request !== generation.current) return;
      const [nextClassrooms, nextAssignments, tree] = await Promise.all([
        api.classrooms(),
        api.assignments(),
        api.tree(),
      ]);
      const nextSubmissions = Object.fromEntries(
        await Promise.all(
          nextAssignments.map(async (assignment) => [assignment.id, await api.mySubmission(assignment.id)] as const),
        ),
      );
      if (request !== generation.current) return;
      setClassrooms(nextClassrooms);
      setAssignments(nextAssignments);
      setSubmissions(nextSubmissions);
      setNodes(tree.nodes);
      await Promise.allSettled([
        cacheSet(classroomCacheKey(scope, "classrooms"), nextClassrooms),
        cacheSet(classroomCacheKey(scope, "assignments"), nextAssignments),
        cacheSet(classroomCacheKey(scope, "submissions"), nextSubmissions),
        cacheSet(classroomCacheKey(scope, "tree"), tree.nodes),
      ]);
    } catch (failure) {
      const [cachedClassrooms, cachedAssignments, cachedSubmissions, cachedTree] = await Promise.all([
        cacheGet<Classroom[]>(classroomCacheKey(scope, "classrooms")),
        cacheGet<Assignment[]>(classroomCacheKey(scope, "assignments")),
        cacheGet<Record<string, Submission | null>>(classroomCacheKey(scope, "submissions")),
        cacheGet<StudyNode[]>(classroomCacheKey(scope, "tree")),
      ]);
      if (request !== generation.current) return;
      setClassrooms(cachedClassrooms ?? []);
      setAssignments(cachedAssignments ?? []);
      setSubmissions(cachedSubmissions ?? {});
      setNodes(cachedTree ?? []);
      if (!(failure instanceof ApiError && failure.offline)) setMessage(errorMessage(failure));
    } finally {
      if (request === generation.current) setLoading(false);
      await readQueued().catch(() => undefined);
    }
  }, [api, flushCurrentStudent, online, readQueued, scope]);

  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  const selectedClassroom = classrooms.find((room) => room.id === selectedClassroomId) ?? null;
  const selectedAssignment = assignments.find((item) => item.id === selectedAssignmentId) ?? null;

  async function joinClassroom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const code = String(form.get("code") ?? "").trim();
    if (!code || !online) return;
    setBusy(true);
    setMessage("");
    try {
      const joined = await api.joinClassroom(code);
      formElement.reset();
      await load();
      setSelectedClassroomId(joined.id);
    } catch (failure) {
      setMessage(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function joinLiveSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const code = String(form.get("session-code") ?? "").trim();
    if (!code || !online) return;
    setBusy(true);
    setMessage("");
    try {
      await onJoinLiveSession(code);
      formElement.reset();
    } catch (failure) {
      setMessage(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  if (selectedAssignment) {
    return (
      <AssignmentDetail
        api={api}
        assignment={selectedAssignment}
        current={submissions[selectedAssignment.id]}
        queued={queued.has(selectedAssignment.id)}
        notes={notes}
        online={online}
        syncing={loading}
        scope={scope}
        onBack={() => setSelectedAssignmentId(null)}
        onChanged={load}
        onQueued={readQueued}
      />
    );
  }

  if (selectedClassroom) {
    const roomAssignments = assignments.filter((item) => item.classroom_id === selectedClassroom.id);
    const materials = nodes.filter((node) => node.classroom_id === selectedClassroom.id && node.kind === "pdf");
    return (
      <div className="forge-page classroom-page">
        <header className="classroom-header">
          <button className="forge-button secondary" type="button" onClick={() => setSelectedClassroomId(null)}>All classrooms</button>
          <span className="forge-kicker">{selectedClassroom.subject_code || "Classroom"}</span>
          <h1>{selectedClassroom.name}</h1>
          <p>{selectedClassroom.description || `Managed by ${selectedClassroom.owner_teacher_name}`}</p>
        </header>
        <nav className="classroom-sections" aria-label="Classroom sections">
          {(["overview", "work", "materials", "marks"] as ClassroomSection[]).map((item) => (
            <button className={section === item ? "active" : ""} key={item} type="button" onClick={() => setSection(item)}>{item}</button>
          ))}
        </nav>
        {section === "overview" ? (
          <div className="classroom-columns">
            <ClassroomList title="Work due" empty="No published work here.">
              {roomAssignments.filter((item) => item.status !== "closed").map((assignment) => (
                <AssignmentButton key={assignment.id} assignment={assignment} status={submissionLabel(submissions[assignment.id], queued.has(assignment.id))} onOpen={() => setSelectedAssignmentId(assignment.id)} />
              ))}
            </ClassroomList>
            <ClassroomList title="Latest materials" empty="No materials have been shared.">
              {materials.slice(0, 5).map((material) => <MaterialButton key={material.id} material={material} onOpen={() => openMaterial(api, baseUrl, token, material)} />)}
            </ClassroomList>
          </div>
        ) : null}
        {section === "work" ? (
          <ClassroomList title="Assignments" empty="No assignments have been published.">
            {roomAssignments.map((assignment) => (
              <AssignmentButton key={assignment.id} assignment={assignment} status={submissionLabel(submissions[assignment.id], queued.has(assignment.id))} onOpen={() => setSelectedAssignmentId(assignment.id)} />
            ))}
          </ClassroomList>
        ) : null}
        {section === "materials" ? (
          <ClassroomList title="Materials" empty="No materials have been shared.">
            {materials.map((material) => <MaterialButton key={material.id} material={material} onOpen={() => openMaterial(api, baseUrl, token, material)} />)}
          </ClassroomList>
        ) : null}
        {section === "marks" ? (
          <ClassroomList title="Marks and feedback" empty="No marked work yet.">
            {roomAssignments.filter((assignment) => submissions[assignment.id]?.grade?.published).map((assignment) => (
              <AssignmentButton key={assignment.id} assignment={assignment} status={submissionLabel(submissions[assignment.id], false)} onOpen={() => setSelectedAssignmentId(assignment.id)} />
            ))}
          </ClassroomList>
        ) : null}
      </div>
    );
  }

  return (
    <div className="forge-page classroom-page">
      <header className="page-header">
        <span className="forge-kicker">Classes</span>
        <h1>Your classrooms</h1>
        <p>Open class work, shared materials, marks, and feedback.</p>
      </header>
      <form className="classroom-join" onSubmit={joinClassroom}>
        <label htmlFor="classroom-code">Class code</label>
        <input id="classroom-code" name="code" inputMode="text" autoComplete="off" placeholder="Enter the code from your teacher" maxLength={32} required />
        <button className="forge-button primary" disabled={!online || busy} type="submit">{busy ? "Joining…" : "Join classroom"}</button>
        {!online ? <small>Connect to the Host to join a new classroom.</small> : null}
      </form>
      <form className="classroom-join" onSubmit={joinLiveSession}>
        <label htmlFor="live-session-code">Live class code</label>
        <input id="live-session-code" name="session-code" inputMode="text" autoComplete="off" placeholder="Enter the 10-character session code" minLength={10} maxLength={10} required />
        <button className="forge-button primary" disabled={!online || busy} type="submit">{busy ? "Joining…" : "Join live class"}</button>
        {!online ? <small>Connect to the Host to join a live class.</small> : null}
      </form>
      {message ? <p className="form-error" role="alert">{message}</p> : null}
      {loading ? <p className="classroom-muted">Loading classrooms…</p> : null}
      {!loading && !classrooms.length ? <p className="classroom-empty">No classrooms yet. Enter the code given by your teacher.</p> : null}
      <div className="classroom-grid">
        {classrooms.map((room) => {
          const work = assignments.filter((assignment) => assignment.classroom_id === room.id && assignment.status !== "closed");
          return (
            <button className="classroom-card" key={room.id} type="button" onClick={() => setSelectedClassroomId(room.id)}>
              <span className="classroom-card-color" style={{ backgroundColor: room.color }} />
              <span className="forge-kicker">{room.subject_code || "Classroom"}</span>
              <strong>{room.name}</strong>
              <span>{room.owner_teacher_name}</span>
              <small>{work.length} open assignment{work.length === 1 ? "" : "s"}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ClassroomList({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return <section className="forge-panel classroom-list"><h2>{title}</h2>{hasChildren ? children : <p className="classroom-muted">{empty}</p>}</section>;
}

function AssignmentButton({ assignment, status, onOpen }: { assignment: Assignment; status: string; onOpen: () => void }) {
  return (
    <button className="classroom-row" type="button" onClick={onOpen}>
      <span><strong>{assignment.title}</strong><small>{formatAssignmentDue(assignment.due_at)}</small></span>
      <span>{status}</span>
    </button>
  );
}

function MaterialButton({ material, onOpen }: { material: StudyNode; onOpen: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div>
      <button className="classroom-row" disabled={busy} type="button" onClick={async () => {
        setBusy(true);
        setError("");
        try { await onOpen(); }
        catch (failure) { setError(errorMessage(failure)); }
        finally { setBusy(false); }
      }}><span><strong>{material.name}</strong><small>Shared material</small></span><span>{busy ? "Opening…" : "Open"}</span></button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}

function AssignmentDetail({ api, assignment, current, queued, notes, online, syncing, scope, onBack, onChanged, onQueued }: {
  api: CinderApi;
  assignment: Assignment;
  current: Submission | null | undefined;
  queued: boolean;
  notes: StudioNote[];
  online: boolean;
  syncing: boolean;
  scope: string;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onQueued: () => Promise<void>;
}) {
  const availableNotes = notes.filter((note) => !note.deletedAt);
  const [noteId, setNoteId] = useState(availableNotes[0]?.id ?? "");
  const [comments, setComments] = useState<SubmissionComment[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const closed = assignment.status === "closed";

  useEffect(() => {
    let cancelled = false;
    if (!online || !current) { setComments([]); return; }
    void api.comments(current.id).then((next) => { if (!cancelled) setComments(next); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [api, current?.id, online]);

  async function submit() {
    const note = availableNotes.find((item) => item.id === noteId);
    if (!note || syncing) return;
    setBusy(true);
    setMessage("");
    try {
      const cleanHtml = DOMPurify.sanitize(note.bodyHtml);
      const doc = structuredClone(forgeQuillHtmlToDocument(cleanHtml));
      const text = new DOMParser().parseFromString(cleanHtml, "text/html").body.textContent?.trim() ?? "";
      if (!text) throw new Error("The selected note is empty.");
      if (new TextEncoder().encode(text).length > 1024 * 1024 || new TextEncoder().encode(JSON.stringify(doc)).length > 2 * 1024 * 1024) {
        throw new Error("This note is too large to submit.");
      }
      const changeNote = current ? `Resubmitted from “${note.title}”` : `Submitted from “${note.title}”`;
      const payload = { assignmentId: assignment.id, doc, text, note: changeNote } satisfies SubmissionPayload;
      if (online) {
        await removeOutbox(submissionOutboxKey(scope, assignment.id));
        try {
          await api.submitWork(assignment.id, doc, text, changeNote);
        } catch (failure) {
          if (!(failure instanceof ApiError && failure.offline)) throw failure;
          await queueOffline({ key: submissionOutboxKey(scope, assignment.id), kind: "submission", payload });
          setMessage("The Host went offline. This version will be sent when this account reconnects.");
          await onQueued();
          return;
        }
        setMessage("Work submitted. This saved version will not change when you edit the note.");
        await onChanged();
      } else {
        await queueOffline({
          key: submissionOutboxKey(scope, assignment.id),
          kind: "submission",
          payload,
        });
        setMessage("Saved on this device. It will be sent when this account reconnects.");
        await onQueued();
      }
    } catch (failure) {
      setMessage(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (syncing) return;
    if (queued) {
      setBusy(true);
      setMessage("");
      try {
        await removeOutbox(submissionOutboxKey(scope, assignment.id));
        await onQueued();
        setMessage("The waiting submission was cancelled.");
      } catch (failure) {
        setMessage(errorMessage(failure));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!online || !current || current.status === "withdrawn") return;
    if (!window.confirm("Take back this submission? You can submit a note again while the assignment stays open.")) return;
    setBusy(true);
    setMessage("");
    try {
      await api.withdrawWork(assignment.id);
      setMessage("Submission taken back.");
      await onChanged();
    } catch (failure) {
      setMessage(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="forge-page assignment-detail">
      <button className="forge-button secondary" type="button" onClick={onBack}>Back to classroom</button>
      <header className="page-header">
        <span className="forge-kicker">{assignment.classroom_name}</span>
        <h1>{assignment.title}</h1>
        <p>{assignment.instructions || "Your teacher has not added instructions."}</p>
        <small>{formatAssignmentDue(assignment.due_at)} · {assignment.max_points} points</small>
      </header>
      <section className="forge-panel assignment-submit-panel">
        <h2>Hand in a saved note</h2>
        <p>The current contents become a fixed submission. Later edits to your note do not change it.</p>
        <label htmlFor="submission-note">Note</label>
        <select id="submission-note" value={noteId} onChange={(event) => setNoteId(event.target.value)} disabled={closed || busy}>
          {!availableNotes.length ? <option value="">No saved notes available</option> : null}
          {availableNotes.map((note) => <option key={note.id} value={note.id}>{note.title}</option>)}
        </select>
        <div className="panel-actions">
          <button className="forge-button primary" disabled={closed || busy || syncing || !noteId} type="button" onClick={() => void submit()}>{busy || syncing ? "Saving…" : current && current.status !== "withdrawn" ? "Resubmit note" : "Submit note"}</button>
          {queued || (current && current.status !== "withdrawn") ? <button className="forge-button secondary" disabled={busy || syncing || (!queued && (closed || !online))} type="button" onClick={() => void withdraw()}>{queued ? "Cancel waiting work" : "Take back"}</button> : null}
        </div>
        <p className="classroom-muted">Status: {submissionLabel(current, queued)}</p>
        {message ? <p role="status">{message}</p> : null}
      </section>
      {current?.grade?.published ? (
        <section className="forge-panel assignment-feedback">
          <h2>Mark and feedback</h2>
          <strong>{current.grade.points ?? "—"} / {assignment.max_points}{current.grade.grade_label ? ` · ${current.grade.grade_label}` : ""}</strong>
          <p>{current.grade.feedback || "No written feedback."}</p>
          {comments.map((comment) => <blockquote key={comment.id}><strong>{comment.author_name}</strong><p>{comment.body}</p></blockquote>)}
        </section>
      ) : null}
    </div>
  );
}
