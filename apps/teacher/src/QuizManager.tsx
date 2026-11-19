import {
  Badge,
  Button,
  EmptyState,
  Field,
  Icon,
  Metric,
  Modal,
  Panel,
  PromptDialog,
  type CinderApi,
  type Quiz,
  type QuizAttempt,
  type QuizDelivery,
  type QuizQuestionInput,
  type QuizStatistics,
} from "@cinder/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, formatDate } from "./teacherFiles";

const blankQuestion = (): QuizQuestionInput => ({ kind: "single_choice", prompt: "", options: ["", ""], canonical_answer: "", max_points: 1, required: true });
const KIND_LABEL: Record<QuizQuestionInput["kind"], string> = { single_choice: "Multiple choice", true_false: "True or false", short_answer: "Written answer" };

type View = { kind: "list" } | { kind: "edit"; quiz: Quiz | null } | { kind: "results"; delivery: QuizDelivery };

export function QuizManager({ api, classroomId }: { api: CinderApi; classroomId: string }) {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [deliveries, setDeliveries] = useState<QuizDelivery[]>([]);
  const [view, setView] = useState<View>({ kind: "list" });
  const [assigning, setAssigning] = useState<Quiz | null>(null);
  const [archiving, setArchiving] = useState<Quiz | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const [nextQuizzes, nextDeliveries] = await Promise.all([api.quizzes(classroomId), api.quizDeliveries(classroomId)]);
    setQuizzes(nextQuizzes);
    setDeliveries(nextDeliveries);
  }, [api, classroomId]);
  useEffect(() => { void refresh().catch((failure) => setError(errorText(failure, "Quizzes could not be loaded."))); }, [refresh]);

  if (view.kind === "edit") {
    return (
      <QuizEditor
        api={api}
        classroomId={classroomId}
        quiz={view.quiz}
        onDone={async (saved) => { setView({ kind: "list" }); await refresh(); if (saved) setMessage(`“${saved}” saved.`); }}
        onDuplicate={async (quiz) => { await api.duplicateQuiz(quiz.id); setView({ kind: "list" }); await refresh(); setMessage(`A copy of “${quiz.title}” was added.`); }}
      />
    );
  }
  if (view.kind === "results") {
    return <QuizResults api={api} delivery={view.delivery} onBack={async () => { setView({ kind: "list" }); await refresh(); }} />;
  }

  const timesAssigned = (quiz: Quiz) => deliveries.filter((delivery) => delivery.quiz_id === quiz.id).length;
  return (
    <>
      <div className="section-toolbar">
        <Button variant="primary" icon="plus" onClick={() => setView({ kind: "edit", quiz: null })}>New quiz</Button>
      </div>
      {message ? <p className="form-success" role="status">{message}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Panel title="Quizzes" className="panel-flush">
        {quizzes.length ? (
          <div className="list">
            {quizzes.map((quiz) => {
              const count = timesAssigned(quiz);
              return (
                <div className="list-item" key={quiz.id}>
                  <span className="list-icon"><Icon name="check" /></span>
                  <button type="button" className="list-copy list-open" onClick={() => setView({ kind: "edit", quiz })}>
                    <strong>{quiz.title}</strong>
                    <span>{quiz.questions.length} {quiz.questions.length === 1 ? "question" : "questions"}{quiz.time_limit_minutes ? ` · ${quiz.time_limit_minutes} minutes` : ""}{count ? ` · Set ${count === 1 ? "once" : `${count} times`}` : ""}</span>
                  </button>
                  <div className="list-actions">
                    <Button size="small" onClick={() => setAssigning(quiz)}>Set as homework</Button>
                    <button type="button" className="icon-button" title="Archive" aria-label={`Archive ${quiz.title}`} onClick={() => setArchiving(quiz)}><Icon name="trash" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <EmptyState icon="check" title="No quizzes yet" description="Write a short quiz once and set it as often as you like." />}
      </Panel>
      <Panel title="Set quizzes" className="panel-flush">
        {deliveries.length ? (
          <div className="list">
            {deliveries.map((delivery) => (
              <button className="list-item" type="button" key={delivery.id} onClick={() => setView({ kind: "results", delivery })}>
                <span className="list-copy">
                  <strong>{delivery.title}</strong>
                  <span>{delivery.kind === "live" ? "Live class" : delivery.due_at ? `Due ${formatDate(delivery.due_at)}` : "Homework, no due date"}</span>
                </span>
                <Badge tone={delivery.results_released_at ? "good" : "neutral"}>{delivery.results_released_at ? "Results released" : "Results private"}</Badge>
              </button>
            ))}
          </div>
        ) : <p className="panel-note">No quizzes have been set yet.</p>}
      </Panel>
      {assigning ? (
        <AssignDialog
          quiz={assigning}
          onClose={() => setAssigning(null)}
          onAssign={async (opensAt, dueAt) => {
            // Publishing first freezes exactly what the class will see.
            await api.publishQuiz(assigning.id);
            await api.deliverQuiz(assigning.id, { kind: "homework", opens_at: opensAt, due_at: dueAt });
            setAssigning(null);
            await refresh();
            setMessage(`“${assigning.title}” was set.`);
          }}
        />
      ) : null}
      {archiving ? (
        <PromptDialog
          title={`Archive ${archiving.title}?`}
          description="It disappears from this list. Quizzes already set, and their results, are kept."
          fields={[]}
          submitLabel="Archive"
          danger
          onSubmit={async () => { await api.archiveQuiz(archiving.id); await refresh(); }}
          onClose={() => setArchiving(null)}
        />
      ) : null}
    </>
  );
}

function AssignDialog({ quiz, onClose, onAssign }: { quiz: Quiz; onClose: () => void; onAssign: (opensAt: string | null, dueAt: string | null) => Promise<void> }) {
  const [opens, setOpens] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={`Set “${quiz.title}”`} description="Every student in this classroom can take it once." onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onAssign(opens ? new Date(opens).toISOString() : null, due ? new Date(due).toISOString() : null);
          } catch (failure) {
            setError(errorText(failure, "The quiz could not be set."));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-row">
          <Field label="Opens" hint="Optional; leave empty to open now"><input type="datetime-local" value={opens} onChange={(event) => setOpens(event.target.value)} /></Field>
          <Field label="Due" hint="Optional"><input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} /></Field>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || !quiz.questions.length}>{busy ? "Setting…" : "Set quiz"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function QuizEditor({ api, classroomId, quiz, onDone, onDuplicate }: {
  api: CinderApi;
  classroomId: string;
  quiz: Quiz | null;
  onDone: (savedTitle: string | null) => Promise<void>;
  onDuplicate: (quiz: Quiz) => Promise<void>;
}) {
  const [form, setForm] = useState(() => quiz ? {
    title: quiz.title,
    instructions: quiz.instructions,
    time_limit_minutes: quiz.time_limit_minutes?.toString() ?? "",
    questions: quiz.questions.map(({ id, kind, prompt, options, canonical_answer, max_points, required }) => ({ id, kind, prompt, options, canonical_answer, max_points, required })),
  } : { title: "", instructions: "", time_limit_minutes: "", questions: [blankQuestion()] as QuizQuestionInput[] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Duplicate copies the saved quiz, so it waits until the edits on screen are saved.
  const opened = useRef(form);
  const edited = form !== opened.current;

  function updateQuestion(index: number, patch: Partial<QuizQuestionInput>) {
    setForm((value) => ({ ...value, questions: value.questions.map((question, questionIndex) => questionIndex === index ? { ...question, ...patch } : question) }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const input = { classroom_id: classroomId, title: form.title.trim(), instructions: form.instructions, time_limit_minutes: form.time_limit_minutes ? Number(form.time_limit_minutes) : null, questions: form.questions };
      if (quiz) await api.updateQuiz(quiz.id, input); else await api.createQuiz(input);
      await onDone(input.title);
    } catch (failure) {
      setError(errorText(failure, "The quiz could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="quiz-editor" onSubmit={save}>
      <div className="subpage-header">
        <div>
          <button type="button" className="back-link" onClick={() => void onDone(null)}><Icon name="chevron" />All quizzes</button>
          <h2>{quiz ? "Edit quiz" : "New quiz"}</h2>
          <p className="page-description">Changes apply the next time you set the quiz. Quizzes already set keep the version students saw.</p>
        </div>
        <div className="page-action">
          {quiz ? <Button disabled={busy || edited} title={edited ? "Save your changes first" : undefined} onClick={() => void onDuplicate(quiz).catch((failure) => setError(errorText(failure, "The quiz could not be duplicated.")))}>Duplicate</Button> : null}
          <Button variant="primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Panel>
        <div className="form-stack">
          <div className="form-row">
            <Field label="Title"><input required maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} autoFocus={!quiz} /></Field>
            <Field label="Time limit in minutes" hint="Optional"><input type="number" min="1" max="180" value={form.time_limit_minutes} onChange={(event) => setForm({ ...form, time_limit_minutes: event.target.value })} /></Field>
          </div>
          <Field label="Instructions" hint="Optional"><textarea rows={2} value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} /></Field>
        </div>
      </Panel>
      {form.questions.map((question, index) => (
        <Panel
          key={question.id ?? index}
          title={`Question ${index + 1}`}
          action={
            <span className="list-actions">
              <Button size="small" variant="ghost" disabled={index === 0} onClick={() => setForm((value) => { const questions = [...value.questions]; [questions[index - 1], questions[index]] = [questions[index], questions[index - 1]]; return { ...value, questions }; })}>Move up</Button>
              <button type="button" className="icon-button" title="Remove question" aria-label={`Remove question ${index + 1}`} disabled={form.questions.length === 1} onClick={() => setForm((value) => ({ ...value, questions: value.questions.filter((_, questionIndex) => questionIndex !== index) }))}><Icon name="trash" /></button>
            </span>
          }
        >
          <div className="form-stack">
            <div className="form-row">
              <Field label="Type">
                <select value={question.kind} onChange={(event) => { const kind = event.target.value as QuizQuestionInput["kind"]; updateQuestion(index, { kind, options: kind === "single_choice" ? ["", ""] : [], canonical_answer: kind === "true_false" ? true : "" }); }}>
                  {(Object.keys(KIND_LABEL) as QuizQuestionInput["kind"][]).map((kind) => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}
                </select>
              </Field>
              <Field label="Marks"><input type="number" min="0.5" step="0.5" max="1000" value={question.max_points} onChange={(event) => updateQuestion(index, { max_points: Number(event.target.value) })} /></Field>
            </div>
            <Field label="Question"><textarea rows={2} required value={question.prompt} onChange={(event) => updateQuestion(index, { prompt: event.target.value })} /></Field>
            {question.kind === "single_choice" ? (
              <div className="quiz-options">
                {question.options.map((option, optionIndex) => (
                  <label className="quiz-option-edit" key={optionIndex}>
                    <input type="radio" name={`correct-${index}`} checked={Boolean(option) && question.canonical_answer === option} disabled={!option} onChange={() => updateQuestion(index, { canonical_answer: option })} aria-label={`Option ${optionIndex + 1} is correct`} />
                    <input required value={option} placeholder={`Option ${optionIndex + 1}`} onChange={(event) => { const options = [...question.options]; const wasCorrect = option !== "" && question.canonical_answer === option; options[optionIndex] = event.target.value; updateQuestion(index, { options, ...(wasCorrect ? { canonical_answer: event.target.value } : {}) }); }} />
                  </label>
                ))}
                <div className="panel-actions">
                  <Button size="small" variant="ghost" icon="plus" onClick={() => updateQuestion(index, { options: [...question.options, ""] })}>Add option</Button>
                  <span className="form-hint">{question.canonical_answer ? "The selected option is the correct answer." : "Select the correct answer."}</span>
                </div>
              </div>
            ) : null}
            {question.kind === "true_false" ? (
              <div className="segmented" role="radiogroup" aria-label="Correct answer">
                {[true, false].map((value) => <button type="button" key={String(value)} role="radio" aria-checked={question.canonical_answer === value} className={question.canonical_answer === value ? "is-selected" : ""} onClick={() => updateQuestion(index, { canonical_answer: value })}>{value ? "True" : "False"}</button>)}
              </div>
            ) : null}
            {question.kind === "short_answer" ? <p className="form-hint">You mark written answers yourself after students hand in.</p> : null}
          </div>
        </Panel>
      ))}
      <div className="section-toolbar">
        <Button icon="plus" onClick={() => setForm((value) => ({ ...value, questions: [...value.questions, blankQuestion()] }))}>Add question</Button>
      </div>
    </form>
  );
}

function QuizResults({ api, delivery, onBack }: { api: CinderApi; delivery: QuizDelivery; onBack: () => void }) {
  const [data, setData] = useState<{ attempts: QuizAttempt[]; stats: QuizStatistics; delivery: QuizDelivery } | null>(null);
  const [error, setError] = useState("");
  const [releasing, setReleasing] = useState(false);
  const load = useCallback(async () => {
    try {
      const [attempts, stats, deliveries] = await Promise.all([api.quizAttempts(delivery.id), api.quizStatistics(delivery.id), api.quizDeliveries(delivery.classroom_id)]);
      setData({ attempts, stats, delivery: deliveries.find((item) => item.id === delivery.id) ?? delivery });
    } catch (failure) {
      setError(errorText(failure, "Results could not be loaded."));
    }
  }, [api, delivery]);
  useEffect(() => { void load(); }, [load]);
  const current = data?.delivery ?? delivery;
  const number = (value: number | null) => value === null ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(1);

  return (
    <>
      <div className="subpage-header">
        <div>
          <button type="button" className="back-link" onClick={onBack}><Icon name="chevron" />All quizzes</button>
          <h2>{current.title}</h2>
          <p className="page-description">{current.due_at ? `Due ${formatDate(current.due_at)}` : current.kind === "live" ? "Live class" : "No due date"} · {current.total_points} marks</p>
        </div>
        <div className="page-action">
          {current.results_released_at ? <Badge tone="good">Results released</Badge> : (
            <Button variant="primary" disabled={releasing || !data} onClick={async () => { setReleasing(true); try { await api.releaseQuizResults(delivery.id); await load(); } catch (failure) { setError(errorText(failure, "Results could not be released.")); } finally { setReleasing(false); } }}>
              Release results to students
            </Button>
          )}
        </div>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {!data ? <p className="loading-line">Loading…</p> : (
        <>
          <div className="metrics">
            <Metric label="Handed in" value={`${data.stats.submitted_count} of ${data.stats.assigned_count}`} />
            <Metric label="Average" value={number(data.stats.mean)} />
            <Metric label="Median" value={number(data.stats.median)} />
            <Metric label="Range" value={data.stats.lowest === null ? "—" : `${number(data.stats.lowest)}–${number(data.stats.highest)}`} />
          </div>
          {data.stats.questions.length ? (
            <details className="disclosure">
              <summary>By question</summary>
              <Panel className="panel-flush">
                <div className="list">
                  {data.stats.questions.map((stat) => (
                    <div className="list-item" key={stat.question_id}>
                      <span className="list-copy"><strong>{stat.prompt}</strong><span>{stat.graded_count} marked</span></span>
                      <span className="list-meta">{stat.correct_percent.toFixed(0)}% correct{stat.partial_percent ? ` · ${stat.partial_percent.toFixed(0)}% partly` : ""}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            </details>
          ) : null}
          <Panel title="Students" className="panel-flush">
            {data.attempts.length ? (
              <div className="list">
                {data.attempts.map((attempt) => <AttemptRow key={attempt.id} api={api} attempt={attempt} released={Boolean(current.results_released_at)} onChanged={load} />)}
              </div>
            ) : <EmptyState icon="students" title="No one has started yet" />}
          </Panel>
        </>
      )}
    </>
  );
}

function AttemptRow({ api, attempt, released, onChanged }: { api: CinderApi; attempt: QuizAttempt; released: boolean; onChanged: () => Promise<void> }) {
  const written = attempt.questions.filter((question) => question.kind === "short_answer" && attempt.responses.some((response) => response.question_id === question.id));
  const needsMarking = Boolean(attempt.submitted_at) && !attempt.manual_grading_complete;
  const [error, setError] = useState("");
  return (
    <div className="attempt-row">
      <div className="attempt-head">
        <span className="list-copy">
          <strong>{attempt.student_name}</strong>
          <span>{attempt.submitted_at ? `Handed in ${formatDate(attempt.submitted_at)}` : "Started, not handed in"}</span>
        </span>
        {attempt.submitted_at ? (
          needsMarking ? <Badge tone="accent">Needs marking</Badge> : <Badge tone="good">{attempt.score ?? 0}/{attempt.max_points}</Badge>
        ) : null}
        {attempt.submitted_at && !released ? (
          <Button size="small" variant="ghost" onClick={async () => { try { await api.reopenQuizAttempt(attempt.id); await onChanged(); } catch (failure) { setError(errorText(failure, "The attempt could not be reopened.")); } }}>Let them change answers</Button>
        ) : null}
      </div>
      {attempt.submitted_at ? written.map((question) => {
        const response = attempt.responses.find((item) => item.question_id === question.id);
        return <WrittenAnswer key={question.id} api={api} attemptId={attempt.id} questionId={question.id} prompt={question.prompt} maxPoints={question.max_points} answer={String(response?.answer ?? "")} points={response?.points ?? null} feedback={response?.feedback ?? ""} onSaved={onChanged} />;
      }) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}

function WrittenAnswer({ api, attemptId, questionId, prompt, maxPoints, answer, points, feedback, onSaved }: {
  api: CinderApi;
  attemptId: string;
  questionId: string;
  prompt: string;
  maxPoints: number;
  answer: string;
  points: number | null;
  feedback: string;
  onSaved: () => Promise<void>;
}) {
  const [mark, setMark] = useState(points === null ? "" : String(points));
  const [note, setNote] = useState(feedback);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="written-answer"
      onSubmit={async (event) => {
        event.preventDefault();
        const value = Number(mark);
        if (mark === "" || !Number.isFinite(value) || value < 0 || value > maxPoints) { setError(`Enter a mark from 0 to ${maxPoints}.`); return; }
        setBusy(true);
        setError("");
        try { await api.gradeQuizResponse(attemptId, questionId, value, note.trim()); await onSaved(); }
        catch (failure) { setError(errorText(failure, "The mark could not be saved.")); }
        finally { setBusy(false); }
      }}
    >
      <p className="written-prompt">{prompt}</p>
      <p className="written-text">{answer || "No answer"}</p>
      <div className="inline-form">
        <input type="number" aria-label={`Mark out of ${maxPoints}`} min={0} max={maxPoints} step={0.5} placeholder={`/ ${maxPoints}`} value={mark} onChange={(event) => setMark(event.target.value)} />
        <input aria-label="Feedback" placeholder="Feedback (optional)" value={note} onChange={(event) => setNote(event.target.value)} />
        <Button type="submit" disabled={busy}>{points === null ? "Save mark" : "Update"}</Button>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </form>
  );
}
