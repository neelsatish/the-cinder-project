import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import {
  ApiError,
  Badge,
  Button,
  EmptyState,
  Field,
  formatDateTime,
  Icon,
  PageHeader,
  Panel,
  Tabs,
  cacheGet,
  cacheSet,
  forgeQuillHtmlToDocument,
  outboxEntries,
  queueOffline,
  removeOutbox,
  type Assignment,
  type CinderApi,
  type Classroom,
  type LiveSessionTask,
  type LiveSessionTaskState,
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
import { StudentQuizzes } from "./StudentQuizzes";

type ClassroomSection = "work" | "quizzes" | "materials" | "marks";
type SubmissionPayload = {
  assignmentId: string;
  doc: Record<string, unknown>;
  text: string;
  note: string;
};
type StartNote = (input: { title: string; topic: string; bodyHtml: string; assignmentId: string }) => void;

/** Where to land when another page sends the student here. */
export type ClassroomFocus = { assignmentId?: string; classroomId?: string; deliveryId?: string };

function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

function errorMessage(failure: unknown) {
  return failure instanceof Error ? failure.message : "That action could not be completed.";
}

function submissionLabel(submission: Submission | null | undefined, queued: boolean, maxPoints?: number) {
  if (queued) return "Waiting to send";
  if (!submission || submission.status === "withdrawn") return "Not handed in";
  if (submission.grade?.published) {
    const { points, grade_label: label } = submission.grade;
    const mark = points !== null && maxPoints ? `${points}/${maxPoints}` : "";
    return [mark, label].filter(Boolean).join(" · ") || "Marked";
  }
  return submission.status === "resubmitted" ? "Handed in again" : "Handed in";
}

function statusTone(submission: Submission | null | undefined, queued: boolean) {
  if (queued) return "warning" as const;
  if (!submission || submission.status === "withdrawn") return "neutral" as const;
  return submission.grade?.published ? ("good" as const) : ("accent" as const);
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
  focus,
  liveTask,
  onLiveTaskState,
  onOpenNote,
  onStartNote,
}: {
  accountId: string;
  api: CinderApi;
  baseUrl: string;
  token: string;
  online: boolean;
  notes: StudioNote[];
  focus?: ClassroomFocus | null;
  liveTask: LiveSessionTask | null;
  onLiveTaskState: (state: LiveSessionTaskState) => Promise<void>;
  onOpenNote: (id: string) => void;
  onStartNote: StartNote;
}) {
  const scope = useMemo(() => classroomScope(baseUrl, accountId), [accountId, baseUrl]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, Submission | null>>({});
  const [nodes, setNodes] = useState<StudyNode[]>([]);
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const [selectedClassroomId, setSelectedClassroomId] = useState<string | null>(focus?.classroomId ?? null);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(focus?.assignmentId ?? null);
  const [section, setSection] = useState<ClassroomSection>(focus?.deliveryId ? "quizzes" : "work");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const generation = useRef(0);

  useEffect(() => {
    if (liveTask?.kind !== "quiz" || !liveTask.target_id) return;
    void api.quizDeliveries().then((items) => {
      const delivery = items.find((item) => item.id === liveTask.target_id);
      if (delivery) { setSelectedClassroomId(delivery.classroom_id); setSection("quizzes"); }
    });
  }, [api, liveTask?.kind, liveTask?.target_id]);

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
        setMessage("Work waiting to be sent was rejected by Cinder Host. Your note is still saved on this computer.");
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

  useEffect(() => {
    if (!liveTask?.target_id || loading) return;
    if (liveTask.kind === "assignment") {
      const assignment = assignments.find((item) => item.id === liveTask.target_id);
      if (assignment) { setSelectedClassroomId(assignment.classroom_id); setSelectedAssignmentId(assignment.id); }
    } else if (liveTask.kind === "material") {
      const material = nodes.find((item) => item.id === liveTask.target_id);
      if (material) void openMaterial(api, baseUrl, token, material)
        .then(() => onLiveTaskState("completed"))
        .catch(async (failure) => { setMessage(errorMessage(failure)); await onLiveTaskState("failed").catch(() => undefined); });
    } else if (liveTask.kind === "quiz") {
      setSection("quizzes");
    }
  }, [api, assignments, baseUrl, liveTask?.id, loading, nodes, token]);

  useEffect(() => {
    // A focused assignment also opens its classroom, so Back lands somewhere useful.
    if (!focus?.assignmentId || loading) return;
    const assignment = assignments.find((item) => item.id === focus.assignmentId);
    if (assignment) setSelectedClassroomId(assignment.classroom_id);
  }, [assignments, focus?.assignmentId, loading]);

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
        liveTask={liveTask}
        onLiveTaskState={onLiveTaskState}
        onOpenNote={onOpenNote}
        onStartNote={onStartNote}
      />
    );
  }

  if (selectedClassroom) {
    const roomAssignments = assignments.filter((item) => item.classroom_id === selectedClassroom.id);
    const materials = nodes.filter((node) => node.classroom_id === selectedClassroom.id && node.kind === "pdf");
    const marked = roomAssignments.filter((assignment) => submissions[assignment.id]?.grade?.published);
    return (
      <div className="workspace">
        <div className="page">
          <PageHeader
            back={{ label: "Classrooms", onClick: () => setSelectedClassroomId(null) }}
            title={selectedClassroom.name}
            description={[selectedClassroom.owner_teacher_name, selectedClassroom.description].filter(Boolean).join(" · ")}
          />
          <Tabs
            label="Classroom sections"
            active={section}
            onChange={setSection}
            tabs={[
              { id: "work", label: "Work", count: roomAssignments.length },
              { id: "quizzes", label: "Quizzes" },
              { id: "materials", label: "Materials", count: materials.length },
              { id: "marks", label: "Marks", count: marked.length },
            ]}
          />
          {message ? <p className="form-error" role="alert">{message}</p> : null}
          {section === "work" ? (
            <ClassroomList empty="No work has been set yet." icon="assignments">
              {roomAssignments.map((assignment) => (
                <AssignmentButton key={assignment.id} assignment={assignment} submission={submissions[assignment.id]} queued={queued.has(assignment.id)} onOpen={() => setSelectedAssignmentId(assignment.id)} />
              ))}
            </ClassroomList>
          ) : null}
          {section === "quizzes" ? <StudentQuizzes api={api} classroomId={selectedClassroom.id} online={online} focusDeliveryId={liveTask?.kind === "quiz" ? liveTask.target_id : focus?.deliveryId ?? null} /> : null}
          {section === "materials" ? (
            <ClassroomList empty="No materials have been shared yet." icon="pdf">
              {materials.map((material) => <MaterialButton key={material.id} material={material} onOpen={() => openMaterial(api, baseUrl, token, material)} />)}
            </ClassroomList>
          ) : null}
          {section === "marks" ? (
            <ClassroomList empty="No marked work yet." icon="check">
              {marked.map((assignment) => (
                <AssignmentButton key={assignment.id} assignment={assignment} submission={submissions[assignment.id]} queued={false} onOpen={() => setSelectedAssignmentId(assignment.id)} />
              ))}
            </ClassroomList>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="workspace">
      <div className="page">
        <PageHeader title="Classrooms" />
        {message ? <p className="form-error" role="alert">{message}</p> : null}
        {loading && !classrooms.length ? <p className="loading-line">Loading…</p> : null}
        {!loading && !classrooms.length ? (
          <Panel><EmptyState icon="classrooms" title="No classrooms yet" description="Enter the class code your teacher gives you below." /></Panel>
        ) : null}
        <div className="card-grid">
          {classrooms.map((room) => {
            const open = assignments.filter((assignment) => assignment.classroom_id === room.id && assignment.status === "published" && (!submissions[assignment.id] || submissions[assignment.id]?.status === "withdrawn"));
            return (
              <button className="subject-card" key={room.id} type="button" style={{ ["--subject-color" as string]: room.color }} onClick={() => setSelectedClassroomId(room.id)}>
                <h3>{room.name}</h3>
                <p>{room.owner_teacher_name}</p>
                <footer>{open.length ? `${open.length} to hand in` : "Nothing to hand in"}</footer>
              </button>
            );
          })}
        </div>
        <form className="join-row" onSubmit={joinClassroom}>
          <label className="field">
            <span>Join a classroom</span>
            <input name="code" inputMode="text" autoComplete="off" placeholder="Class code from your teacher" maxLength={32} required />
          </label>
          <Button type="submit" disabled={!online || busy}>{busy ? "Joining…" : "Join"}</Button>
        </form>
        {!online ? <p className="form-hint">Connect to Cinder Host to join a classroom.</p> : null}
      </div>
    </div>
  );
}

function ClassroomList({ empty, icon, children }: { empty: string; icon: "assignments" | "pdf" | "check"; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return <Panel className="panel-flush">{hasChildren ? <div className="list">{children}</div> : <EmptyState icon={icon} title={empty} />}</Panel>;
}

function AssignmentButton({ assignment, submission, queued, onOpen }: { assignment: Assignment; submission: Submission | null | undefined; queued: boolean; onOpen: () => void }) {
  return (
    <button className="list-item" type="button" onClick={onOpen}>
      <span className="list-icon"><Icon name="assignments" /></span>
      <span className="list-copy"><strong>{assignment.title}</strong><span>{assignment.status === "closed" ? "Closed" : formatAssignmentDue(assignment.due_at)}</span></span>
      <Badge tone={statusTone(submission, queued)}>{submissionLabel(submission, queued, assignment.max_points)}</Badge>
    </button>
  );
}

function MaterialButton({ material, onOpen }: { material: StudyNode; onOpen: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button className="list-item" disabled={busy} type="button" onClick={async () => {
        setBusy(true);
        setError("");
        try { await onOpen(); }
        catch (failure) { setError(errorMessage(failure)); }
        finally { setBusy(false); }
      }}>
        <span className="list-icon"><Icon name="pdf" /></span>
        <span className="list-copy"><strong>{material.name}</strong></span>
        <span className="list-meta">{busy ? "Opening…" : "Open"}</span>
      </button>
      {error ? <p className="form-error panel-message" role="alert">{error}</p> : null}
    </>
  );
}

/** Text with one line per paragraph; textContent alone runs paragraphs together. */
function htmlToText(html: string) {
  const body = new DOMParser().parseFromString(DOMPurify.sanitize(html), "text/html").body;
  const blocks = [...body.children].map((block) => block.textContent ?? "");
  return (blocks.length ? blocks.join("\n") : body.textContent ?? "").trim();
}

function plainPreview(html: string) {
  return htmlToText(html).replace(/\s+/g, " ");
}

function AssignmentDetail({ api, assignment, current, queued, notes, online, syncing, scope, onBack, onChanged, onQueued, liveTask, onLiveTaskState, onOpenNote, onStartNote }: {
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
  liveTask: LiveSessionTask | null;
  onLiveTaskState: (state: LiveSessionTaskState) => Promise<void>;
  onOpenNote: (id: string) => void;
  onStartNote: StartNote;
}) {
  const availableNotes = notes.filter((note) => !note.deletedAt);
  const linked = availableNotes.find((note) => note.assignmentId === assignment.id) ?? null;
  const [choosing, setChoosing] = useState(false);
  const [noteId, setNoteId] = useState(linked?.id ?? availableNotes[0]?.id ?? "");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [comments, setComments] = useState<SubmissionComment[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const closed = assignment.status === "closed";
  const graded = current?.status === "graded" || current?.grade?.published === true;
  const handedIn = Boolean(current && current.status !== "withdrawn");
  const chosen = choosing ? availableNotes.find((note) => note.id === noteId) ?? null : linked;

  useEffect(() => {
    let cancelled = false;
    if (!online || !current) { setComments([]); return; }
    void api.comments(current.id).then((next) => { if (!cancelled) setComments(next); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [api, current?.id, online]);

  async function submit() {
    const note = chosen;
    if (!note || syncing || graded) return;
    setBusy(true);
    setMessage("");
    try {
      const cleanHtml = DOMPurify.sanitize(note.bodyHtml);
      const doc = structuredClone(forgeQuillHtmlToDocument(cleanHtml));
      const text = htmlToText(cleanHtml);
      if (!text) throw new Error("That note is empty. Write your answer first.");
      if (new TextEncoder().encode(text).length > 1024 * 1024 || new TextEncoder().encode(JSON.stringify(doc)).length > 2 * 1024 * 1024) {
        throw new Error("This note is too large to hand in.");
      }
      const changeNote = current ? `Handed in again from “${note.title}”` : `Handed in from “${note.title}”`;
      const payload = { assignmentId: assignment.id, doc, text, note: changeNote } satisfies SubmissionPayload;
      if (online) {
        await removeOutbox(submissionOutboxKey(scope, assignment.id));
        try {
          await api.submitWork(assignment.id, doc, text, changeNote);
        } catch (failure) {
          if (!(failure instanceof ApiError && failure.offline)) throw failure;
          await queueOffline({ key: submissionOutboxKey(scope, assignment.id), kind: "submission", payload });
          setMessage("Cinder Host went offline. Your work will be sent when you reconnect.");
          await onQueued();
          return;
        }
        setMessage("Handed in. Later changes to the note do not change what your teacher sees.");
        setChoosing(false);
        if (liveTask?.kind === "assignment" && liveTask.target_id === assignment.id) await onLiveTaskState("completed").catch(() => undefined);
        await onChanged();
      } else {
        await queueOffline({ key: submissionOutboxKey(scope, assignment.id), kind: "submission", payload });
        setMessage("Saved on this computer. It will be sent when you reconnect.");
        await onQueued();
      }
    } catch (failure) {
      setMessage(errorMessage(failure));
      if (liveTask?.kind === "assignment" && liveTask.target_id === assignment.id) await onLiveTaskState("failed").catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (syncing) return;
    setConfirmWithdraw(false);
    if (queued) {
      setBusy(true);
      setMessage("");
      try {
        await removeOutbox(submissionOutboxKey(scope, assignment.id));
        await onQueued();
        setMessage("The waiting work was cancelled.");
      } catch (failure) {
        setMessage(errorMessage(failure));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!online || !current || current.status === "withdrawn" || graded) return;
    setBusy(true);
    setMessage("");
    try {
      await api.withdrawWork(assignment.id);
      setMessage("Taken back. You can hand in again while the assignment is open.");
      await onChanged();
    } catch (failure) {
      setMessage(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const canHandIn = !closed && !graded && !busy && !syncing && Boolean(chosen);

  return (
    <div className="workspace">
      <div className="page">
        <PageHeader
          back={{ label: assignment.classroom_name, onClick: onBack }}
          title={assignment.title}
          description={`${closed ? "Closed" : formatAssignmentDue(assignment.due_at)} · ${assignment.max_points} points`}
          action={<Badge tone={statusTone(current, queued)}>{submissionLabel(current, queued, assignment.max_points)}</Badge>}
        />
        <p className="assignment-instructions">{assignment.instructions || "No instructions were added."}</p>

        {current?.grade?.published ? (
          <Panel title="Mark and feedback">
            <div className="form-stack">
              <p className="mark-line">{current.grade.points ?? "—"} / {assignment.max_points}{current.grade.grade_label ? ` · ${current.grade.grade_label}` : ""}</p>
              <p>{current.grade.feedback || "No written feedback."}</p>
              {comments.map((comment) => <blockquote className="comment" key={comment.id}><strong>{comment.author_name}</strong><p>{comment.body}</p></blockquote>)}
            </div>
          </Panel>
        ) : null}

        {!graded && !(closed && !handedIn) ? (
          <Panel title="Your answer">
            <div className="form-stack">
              {chosen && !choosing ? (
                <div className="answer-note">
                  <span className="list-icon"><Icon name="notes" /></span>
                  <span className="list-copy"><strong>{chosen.title}</strong><span>{plainPreview(chosen.bodyHtml).slice(0, 140) || "Empty note"}</span></span>
                  <Button size="small" onClick={() => onOpenNote(chosen.id)}>Open note</Button>
                </div>
              ) : null}
              {!chosen && !choosing ? <p className="muted">{handedIn ? "To change your answer, write a new version in a note and hand it in again." : "Write your answer in a note, then come back here to hand it in."}</p> : null}
              {choosing ? (
                <Field label="Hand in this note">
                  <select value={noteId} onChange={(event) => setNoteId(event.target.value)} disabled={busy}>
                    {!availableNotes.length ? <option value="">No notes yet</option> : null}
                    {availableNotes.map((note) => <option key={note.id} value={note.id}>{note.title}</option>)}
                  </select>
                </Field>
              ) : null}
              {!closed ? (
                <div className="panel-actions">
                  {!chosen && !choosing ? (
                    <Button variant="primary" icon="edit" onClick={() => onStartNote({ title: assignment.title, topic: assignment.classroom_name, bodyHtml: "", assignmentId: assignment.id })}>Start writing</Button>
                  ) : (
                    <Button variant="primary" disabled={!canHandIn} onClick={() => void submit()}>{busy || syncing ? "Sending…" : handedIn ? "Hand in again" : "Hand in"}</Button>
                  )}
                  {availableNotes.length && !choosing ? <Button variant="ghost" onClick={() => setChoosing(true)}>Use a different note</Button> : null}
                  {choosing ? <Button variant="ghost" onClick={() => setChoosing(false)}>Cancel</Button> : null}
                  {queued || handedIn ? (
                    confirmWithdraw ? (
                      <>
                        <Button variant="danger" disabled={busy || syncing} onClick={() => void withdraw()}>{queued ? "Cancel sending" : "Take it back"}</Button>
                        <Button variant="ghost" onClick={() => setConfirmWithdraw(false)}>Keep it</Button>
                      </>
                    ) : (
                      <Button variant="ghost" disabled={busy || syncing || (!queued && !online)} onClick={() => setConfirmWithdraw(true)}>{queued ? "Cancel sending…" : "Take back…"}</Button>
                    )
                  ) : null}
                </div>
              ) : null}
              {message ? <p role="status" className="form-hint">{message}</p> : null}
            </div>
          </Panel>
        ) : null}
        {closed && !handedIn ? <p className="muted">This assignment is closed.</p> : null}

        {handedIn && current?.version ? (
          <Panel title="What you handed in" action={<span className="list-meta">{formatDateTime(current.version.created_at)}{current.version.late ? " · After the due date" : ""}</span>}>
            <p className="handed-in-text">{current.version.plaintext}</p>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
