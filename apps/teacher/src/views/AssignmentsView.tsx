import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  DocumentEditor,
  EmptyState,
  Field,
  Icon,
  Modal,
  Panel,
  PromptDialog,
  type Assignment,
  type CinderApi,
  type Classroom,
  type GradeChange,
  type Submission,
  type SubmissionComment,
  type User,
} from "@cinder/ui";
import { dateTimeInput, errorText, formatDate } from "../teacherFiles";

type AssignmentInput = { title: string; instructions: string; due_at: string | null; max_points: number };

function markLabel(submission: Submission, maxPoints: number) {
  const grade = submission.grade;
  if (!grade) return null;
  const mark = grade.points !== null ? `${grade.points}/${maxPoints}` : grade.grade_label ?? "Marked";
  return grade.published ? mark : `${mark} · not returned`;
}

export function AssignmentsView({
  api,
  classroom,
  roster,
  assignments,
  focusAssignmentId,
  onUpdated,
}: {
  api: CinderApi;
  classroom: Classroom;
  roster: User[];
  assignments: Assignment[];
  focusAssignmentId?: string;
  onUpdated: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(focusAssignmentId ?? null);
  const [creating, setCreating] = useState(false);
  const [counts, setCounts] = useState<Record<string, { handedIn: number; toMark: number }>>({});
  const selected = assignments.find((item) => item.id === selectedId) ?? null;
  const open = assignments.filter((item) => item.status !== "closed");
  const completed = assignments.filter((item) => item.status === "closed");

  useEffect(() => {
    if (selectedId) return;
    let alive = true;
    void Promise.all(open.map(async (item) => {
      const list = await api.submissions(item.id);
      const live = list.filter((submission) => submission.status !== "withdrawn");
      return [item.id, { handedIn: live.length, toMark: live.filter((submission) => !submission.grade?.published).length }] as const;
    })).then((entries) => { if (alive) setCounts(Object.fromEntries(entries)); }).catch(() => undefined);
    return () => { alive = false; };
    // Recount when the set of assignments changes or the teacher comes back from marking one, not on every render.
  }, [api, selectedId, assignments.map((item) => item.id + item.status).join()]);

  if (selected) {
    return <AssignmentDetail api={api} assignment={selected} roster={roster} onBack={() => setSelectedId(null)} onUpdated={onUpdated} />;
  }

  const row = (item: Assignment) => {
    const count = counts[item.id];
    return (
      <button type="button" className="list-item" key={item.id} onClick={() => setSelectedId(item.id)}>
        <span className="list-icon"><Icon name="assignments" /></span>
        <span className="list-copy">
          <strong>{item.title}</strong>
          <span>{item.due_at ? `Due ${formatDate(item.due_at)}` : "No due date"} · {item.max_points} points</span>
        </span>
        {item.status === "draft" ? <Badge>Draft</Badge> : null}
        {item.status !== "draft" && count ? (
          <span className="list-meta">
            {count.handedIn} of {roster.length} handed in{count.toMark ? ` · ${count.toMark} to mark` : ""}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <>
      <div className="section-toolbar">
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New assignment</Button>
      </div>
      <Panel className="panel-flush">
        {open.length ? <div className="list">{open.map(row)}</div> : <EmptyState icon="assignments" title="No open assignments" />}
      </Panel>
      {completed.length ? (
        <details className="disclosure">
          <summary>Completed ({completed.length})</summary>
          <Panel className="panel-flush"><div className="list">{completed.map(row)}</div></Panel>
        </details>
      ) : null}
      {creating ? (
        <AssignmentFormModal
          title="New assignment"
          onClose={() => setCreating(false)}
          onSave={async (input, publish) => {
            const created = await api.createAssignment({ ...input, classroom_id: classroom.id, grading_scheme: { type: "points" }, publish });
            setCreating(false);
            await onUpdated();
            setSelectedId(created.id);
          }}
        />
      ) : null}
    </>
  );
}

function AssignmentDetail({
  api,
  assignment,
  roster,
  onBack,
  onUpdated,
}: {
  api: CinderApi;
  assignment: Assignment;
  roster: User[];
  onBack: () => void;
  onUpdated: () => Promise<void>;
}) {
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setSubmissions((await api.submissions(assignment.id)).filter((item) => item.status !== "withdrawn"));
    } catch (failure) {
      setError(errorText(failure, "Handed-in work could not be loaded."));
    }
  }, [api, assignment.id]);
  useEffect(() => { void load(); }, [load]);

  const handedIn = useMemo(() => new Set((submissions ?? []).map((item) => item.student_id)), [submissions]);
  const missing = roster.filter((student) => !handedIn.has(student.id));

  async function setStatus(status: Assignment["status"]) {
    setError("");
    try {
      await api.updateAssignment(assignment.id, {
        classroom_id: assignment.classroom_id,
        title: assignment.title,
        instructions: assignment.instructions,
        due_at: assignment.due_at,
        max_points: assignment.max_points,
        grading_scheme: assignment.grading_scheme,
        status,
      });
      await onUpdated();
    } catch (failure) {
      setError(errorText(failure, "The assignment could not be updated."));
    }
  }

  return (
    <>
      <div className="subpage-header">
        <div>
          <button type="button" className="back-link" onClick={onBack}><Icon name="chevron" />All assignments</button>
          <h2>{assignment.title}</h2>
          <p className="page-description">
            {assignment.due_at ? `Due ${formatDate(assignment.due_at)}` : "No due date"} · {assignment.max_points} points
            {assignment.status === "draft" ? " · Draft, not visible to students" : assignment.status === "closed" ? " · Completed" : ""}
          </p>
        </div>
        <div className="page-action">
          <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>
          {assignment.status === "draft" ? <Button variant="primary" onClick={() => void setStatus("published")}>Publish</Button> : null}
          {assignment.status === "published" ? <Button onClick={() => void setStatus("closed")}>Mark completed</Button> : null}
          {assignment.status === "closed" ? <Button onClick={() => void setStatus("published")}>Reopen</Button> : null}
          <button type="button" className="icon-button" title="Delete" aria-label="Delete assignment" onClick={() => setConfirmDelete(true)}><Icon name="trash" /></button>
        </div>
      </div>
      {assignment.instructions ? <p className="assignment-instructions">{assignment.instructions}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Panel title={`Handed in${submissions ? ` (${submissions.length})` : ""}`} className="panel-flush">
        {!submissions ? <p className="loading-line">Loading…</p> : submissions.length ? (
          <div className="list">
            {submissions.map((submission, index) => {
              const mark = markLabel(submission, assignment.max_points);
              return (
                <button type="button" className="list-item" key={submission.id} onClick={() => setReviewIndex(index)}>
                  <span className="account-initial" aria-hidden="true">{submission.student_name.slice(0, 1).toUpperCase()}</span>
                  <span className="list-copy">
                    <strong>{submission.student_name}</strong>
                    <span>
                      {formatDate(submission.submitted_at, "Not dated")}
                      {submission.version && submission.version.version_number > 1 ? ` · Version ${submission.version.version_number}` : ""}
                      {submission.version?.late ? " · After the due date" : ""}
                    </span>
                  </span>
                  {mark ? <Badge tone={submission.grade?.published ? "good" : "neutral"}>{mark}</Badge> : <Badge tone="accent">To mark</Badge>}
                </button>
              );
            })}
          </div>
        ) : <EmptyState icon="assignments" title="Nothing handed in yet" />}
      </Panel>
      {assignment.status !== "draft" && submissions ? (
        <Panel title={`Not handed in (${missing.length})`} className="panel-flush">
          {missing.length ? (
            <div className="list">
              {missing.map((student) => (
                <div className="list-item" key={student.id}>
                  <span className="account-initial" aria-hidden="true">{student.display_name.slice(0, 1).toUpperCase()}</span>
                  <span className="list-copy"><strong>{student.display_name}</strong></span>
                </div>
              ))}
            </div>
          ) : <p className="panel-note">Everyone in this classroom has handed in.</p>}
        </Panel>
      ) : null}
      {reviewIndex !== null && submissions?.[reviewIndex] ? (
        <ReviewModal
          key={submissions[reviewIndex].id}
          api={api}
          assignment={assignment}
          submission={submissions[reviewIndex]}
          position={`${reviewIndex + 1} of ${submissions.length}`}
          onPrevious={reviewIndex > 0 ? () => setReviewIndex(reviewIndex - 1) : undefined}
          onNext={reviewIndex < submissions.length - 1 ? () => setReviewIndex(reviewIndex + 1) : undefined}
          onClose={() => setReviewIndex(null)}
          onSaved={async () => { await load(); await onUpdated(); }}
        />
      ) : null}
      {editing ? (
        <AssignmentFormModal
          title="Edit assignment"
          assignment={assignment}
          onClose={() => setEditing(false)}
          onSave={async (input) => {
            await api.updateAssignment(assignment.id, { ...input, classroom_id: assignment.classroom_id, grading_scheme: assignment.grading_scheme, status: assignment.status });
            setEditing(false);
            await onUpdated();
          }}
        />
      ) : null}
      {confirmDelete ? (
        <PromptDialog
          title={`Delete ${assignment.title}?`}
          description="Students will no longer see it. Handed-in work and marks are kept in the archive."
          fields={[]}
          submitLabel="Delete"
          danger
          onSubmit={async () => { await api.deleteAssignment(assignment.id); await onUpdated(); onBack(); }}
          onClose={() => setConfirmDelete(false)}
        />
      ) : null}
    </>
  );
}

function AssignmentFormModal({
  title,
  assignment,
  onClose,
  onSave,
}: {
  title: string;
  assignment?: Assignment;
  onClose: () => void;
  onSave: (input: AssignmentInput, publish: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(assignment?.title ?? "");
  const [instructions, setInstructions] = useState(assignment?.instructions ?? "");
  const [due, setDue] = useState(dateTimeInput(assignment?.due_at ?? null));
  const [points, setPoints] = useState(String(assignment?.max_points ?? 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(publish: boolean) {
    setBusy(true);
    setError("");
    try {
      await onSave({ title: name.trim(), instructions: instructions.trim(), due_at: due ? new Date(due).toISOString() : null, max_points: Number(points) }, publish);
    } catch (failure) {
      setError(errorText(failure, "The assignment could not be saved."));
    } finally {
      setBusy(false);
    }
  }
  const valid = Boolean(name.trim()) && Number(points) > 0;
  return (
    <Modal title={title} onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void submit(true); }}>
        <Field label="Title"><input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></Field>
        <Field label="Instructions"><textarea rows={4} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></Field>
        <div className="form-row">
          <Field label="Due" hint="Optional"><input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} /></Field>
          <Field label="Points"><input type="number" min="0.5" step="0.5" value={points} onChange={(event) => setPoints(event.target.value)} /></Field>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="form-actions">
          {assignment ? (
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={busy || !valid}>{busy ? "Saving…" : "Save"}</Button>
            </>
          ) : (
            <>
              <Button disabled={busy || !valid} onClick={() => void submit(false)}>Save as draft</Button>
              <Button variant="primary" type="submit" disabled={busy || !valid}>{busy ? "Saving…" : "Publish"}</Button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}

function ReviewModal({
  api,
  assignment,
  submission,
  position,
  onPrevious,
  onNext,
  onClose,
  onSaved,
}: {
  api: CinderApi;
  assignment: Assignment;
  submission: Submission;
  position: string;
  onPrevious?: () => void;
  onNext?: () => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [points, setPoints] = useState(submission.grade?.points?.toString() ?? "");
  const [label, setLabel] = useState(submission.grade?.grade_label ?? "");
  const [feedback, setFeedback] = useState(submission.grade?.feedback ?? "");
  const [comment, setComment] = useState("");
  const [comments, setComments] = useState<SubmissionComment[]>([]);
  const [history, setHistory] = useState<GradeChange[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // Saving with publish false hides the mark from the student, so on a returned mark it is offered only as an explicit Take back.
  const returned = Boolean(submission.grade?.published);
  useEffect(() => {
    void Promise.all([
      api.comments(submission.id).then(setComments),
      api.gradeHistory(submission.id).then(setHistory),
    ]).catch(() => undefined);
  }, [api, submission.id]);

  async function save(publish: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (points !== "" && (Number(points) < 0 || Number(points) > assignment.max_points)) throw new Error(`Enter a mark from 0 to ${assignment.max_points}.`);
      await api.saveGrade(submission.id, { points: points === "" ? null : Number(points), grade_label: label.trim() || null, feedback: feedback.trim(), publish });
      await onSaved();
      setMessage(publish ? "Returned to the student." : returned ? "Taken back. The student no longer sees this mark." : "Saved. Not returned yet.");
    } catch (failure) {
      setError(errorText(failure, "The mark could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function addComment() {
    if (!comment.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.addComment(submission.id, comment.trim());
      setComment("");
      setComments(await api.comments(submission.id));
    } catch (failure) {
      setError(errorText(failure, "The comment could not be added."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={submission.student_name} description={`${assignment.title} · ${position}`} onClose={onClose} wide>
      <div className="review-layout">
        <div className="review-document">
          <DocumentEditor value={submission.version?.doc_json ?? { type: "doc", content: [{ type: "paragraph" }] }} readOnly />
        </div>
        <form className="review-form form-stack" onSubmit={(event) => { event.preventDefault(); void save(true); }}>
          <div className="form-row">
            <Field label={`Mark out of ${assignment.max_points}`}>
              <input type="number" min="0" max={assignment.max_points} step="0.5" value={points} onChange={(event) => setPoints(event.target.value)} autoFocus />
            </Field>
            <Field label="Grade" hint="Optional">
              <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="B" />
            </Field>
          </div>
          <Field label="Feedback">
            <textarea rows={4} value={feedback} onChange={(event) => setFeedback(event.target.value)} />
          </Field>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {message ? <p className="form-success" role="status">{message}</p> : null}
          <div className="form-actions">
            <Button disabled={busy} onClick={() => void save(false)}>{returned ? "Take back" : "Save draft"}</Button>
            <Button variant="primary" type="submit" disabled={busy}>{busy ? "Saving…" : returned ? "Update returned mark" : "Return to student"}</Button>
          </div>
          <div className="review-comments">
            <strong>Comments</strong>
            {comments.map((item) => <blockquote className="comment" key={item.id}><strong>{item.author_name}</strong><p>{item.body}</p></blockquote>)}
            <div className="inline-form">
              <input aria-label="New comment" placeholder="Add a comment" value={comment} onChange={(event) => setComment(event.target.value)} />
              <Button disabled={busy || !comment.trim()} onClick={() => void addComment()}>Add</Button>
            </div>
          </div>
          {history.length ? (
            <details className="disclosure">
              <summary>Mark changes ({history.length})</summary>
              <ul className="plain-list">{history.map((item) => <li key={item.id}>{formatDate(item.changed_at)}</li>)}</ul>
            </details>
          ) : null}
          <div className="review-nav">
            <Button variant="ghost" disabled={!onPrevious} onClick={onPrevious}>Previous</Button>
            <Button variant="ghost" disabled={!onNext} onClick={onNext}>Next</Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
