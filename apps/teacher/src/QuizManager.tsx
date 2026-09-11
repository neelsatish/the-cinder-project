import { Button, EmptyState, Field, PageHeader, Panel, type CinderApi, type Classroom, type Quiz, type QuizAttempt, type QuizDelivery, type QuizQuestionInput, type QuizStatistics } from "@cinder/ui";
import { useCallback, useEffect, useState } from "react";

const blankQuestion = (): QuizQuestionInput => ({ kind: "single_choice", prompt: "", options: ["", ""], canonical_answer: "", max_points: 1, required: true });

export function QuizManager({ api, classrooms }: { api: CinderApi; classrooms: Classroom[] }) {
  const [classroomId, setClassroomId] = useState(classrooms[0]?.id ?? "");
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [deliveries, setDeliveries] = useState<QuizDelivery[]>([]);
  const [editing, setEditing] = useState<Quiz | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState({ title: "", instructions: "", time_limit_minutes: "", questions: [blankQuestion()] as QuizQuestionInput[] });
  const [review, setReview] = useState<{ delivery: QuizDelivery; attempts: QuizAttempt[]; stats: QuizStatistics } | null>(null);
  const [preview, setPreview] = useState(false);
  const [schedule, setSchedule] = useState({ opens_at: "", due_at: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!classroomId) { setQuizzes([]); setDeliveries([]); return; }
    const [nextQuizzes, nextDeliveries] = await Promise.all([api.quizzes(classroomId), api.quizDeliveries(classroomId)]);
    setQuizzes(nextQuizzes); setDeliveries(nextDeliveries);
  }, [api, classroomId]);
  useEffect(() => { void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Quizzes could not be loaded.")); }, [refresh]);
  useEffect(() => { if (!classrooms.some((room) => room.id === classroomId)) setClassroomId(classrooms[0]?.id ?? ""); }, [classroomId, classrooms]);

  function edit(quiz?: Quiz) {
    setEditorOpen(true);
    setEditing(quiz ?? null);
    setForm(quiz ? { title: quiz.title, instructions: quiz.instructions, time_limit_minutes: quiz.time_limit_minutes?.toString() ?? "", questions: quiz.questions.map(({ id, kind, prompt, options, canonical_answer, max_points, required }) => ({ id, kind, prompt, options, canonical_answer, max_points, required })) } : { title: "", instructions: "", time_limit_minutes: "", questions: [blankQuestion()] });
  }
  function updateQuestion(index: number, patch: Partial<QuizQuestionInput>) { setForm((value) => ({ ...value, questions: value.questions.map((question, i) => i === index ? { ...question, ...patch } : question) })); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const input = { classroom_id: classroomId, title: form.title, instructions: form.instructions, time_limit_minutes: form.time_limit_minutes ? Number(form.time_limit_minutes) : null, questions: form.questions };
      if (editing) await api.updateQuiz(editing.id, input); else await api.createQuiz(input);
      setEditing(null); setEditorOpen(false); await refresh(); setMessage("Quiz draft saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Quiz could not be saved."); } finally { setBusy(false); }
  }
  async function reviewDelivery(delivery: QuizDelivery) {
    setBusy(true); try { const [attempts, stats] = await Promise.all([api.quizAttempts(delivery.id), api.quizStatistics(delivery.id)]); setReview({ delivery, attempts, stats }); } catch (error) { setMessage(error instanceof Error ? error.message : "Results could not be loaded."); } finally { setBusy(false); }
  }

  return <div className="page quiz-manager">
    <PageHeader eyebrow="Assessment" title="Quizzes" description="Author once, publish an immutable version, then assign it as homework or in a live class." action={<Button variant="primary" onClick={() => edit()}>New quiz</Button>} />
    <Panel title="Classroom"><Field label="Classroom"><select value={classroomId} onChange={(event) => setClassroomId(event.target.value)}>{classrooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></Field></Panel>
    {message ? <p className="form-hint" role="status">{message}</p> : null}
    {editorOpen ? <Panel title={editing ? "Edit quiz draft" : "New quiz draft"}>
      <form className="form-stack" onSubmit={save}><Field label="Title"><input required maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field><Field label="Instructions"><textarea value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} /></Field><Field label="Time limit (minutes, optional)"><input type="number" min="1" max="180" value={form.time_limit_minutes} onChange={(event) => setForm({ ...form, time_limit_minutes: event.target.value })} /></Field>
        {form.questions.map((question, index) => <fieldset className="panel quiz-question-editor" key={question.id ?? index}><legend>Question {index + 1}</legend><Field label="Type"><select value={question.kind} onChange={(event) => { const kind = event.target.value as QuizQuestionInput["kind"]; updateQuestion(index, { kind, options: kind === "single_choice" ? ["", ""] : [], canonical_answer: kind === "true_false" ? true : "" }); }}><option value="single_choice">Single choice</option><option value="true_false">True / false</option><option value="short_answer">Short answer</option></select></Field><Field label="Prompt"><textarea required value={question.prompt} onChange={(event) => updateQuestion(index, { prompt: event.target.value })} /></Field>
          {question.kind === "single_choice" ? <>{question.options.map((option, optionIndex) => <Field key={optionIndex} label={`Option ${optionIndex + 1}`}><input required value={option} onChange={(event) => { const options = [...question.options]; options[optionIndex] = event.target.value; updateQuestion(index, { options }); }} /></Field>)}<Button type="button" onClick={() => updateQuestion(index, { options: [...question.options, ""] })}>Add option</Button><Field label="Correct option"><select required value={String(question.canonical_answer)} onChange={(event) => updateQuestion(index, { canonical_answer: event.target.value })}><option value="">Choose…</option>{question.options.filter(Boolean).map((option) => <option key={option} value={option}>{option}</option>)}</select></Field></> : null}
          {question.kind === "true_false" ? <Field label="Correct answer"><select value={String(question.canonical_answer)} onChange={(event) => updateQuestion(index, { canonical_answer: event.target.value === "true" })}><option value="true">True</option><option value="false">False</option></select></Field> : null}
          <Field label="Points"><input type="number" min="0.5" step="0.5" max="1000" value={question.max_points} onChange={(event) => updateQuestion(index, { max_points: Number(event.target.value) })} /></Field><div className="panel-actions"><Button type="button" disabled={index === 0} onClick={() => setForm((value) => { const questions = [...value.questions]; [questions[index - 1], questions[index]] = [questions[index], questions[index - 1]]; return { ...value, questions }; })}>Move up</Button><Button variant="danger" type="button" disabled={form.questions.length === 1} onClick={() => setForm((value) => ({ ...value, questions: value.questions.filter((_, i) => i !== index) }))}>Remove</Button></div></fieldset>)}
        <div className="panel-actions"><Button type="button" onClick={() => setForm((value) => ({ ...value, questions: [...value.questions, blankQuestion()] }))}>Add question</Button><Button type="button" onClick={() => setPreview((value) => !value)}>{preview ? "Hide preview" : "Preview"}</Button><Button variant="primary" type="submit" disabled={busy}>Save draft</Button><Button type="button" onClick={() => { setEditorOpen(false); setEditing(null); setPreview(false); setForm({ title: "", instructions: "", time_limit_minutes: "", questions: [blankQuestion()] }); }}>Cancel</Button></div>
        {preview ? <div className="panel"><h3>{form.title || "Untitled quiz"}</h3><p>{form.instructions}</p>{form.questions.map((question, index) => <p key={index}><strong>{index + 1}. {question.prompt || "Untitled question"}</strong> · {question.kind.replace("_", " ")} · {question.max_points} point{question.max_points === 1 ? "" : "s"}</p>)}</div> : null}
      </form></Panel> : null}
    <Panel title="Quiz drafts"><div className="panel-actions"><Field label="Opens (optional)"><input type="datetime-local" value={schedule.opens_at} onChange={(event) => setSchedule({ ...schedule, opens_at: event.target.value })} /></Field><Field label="Due (optional)"><input type="datetime-local" value={schedule.due_at} onChange={(event) => setSchedule({ ...schedule, due_at: event.target.value })} /></Field></div>{quizzes.length ? <div className="teacher-account-list">{quizzes.map((quiz) => <div className="list-item" key={quiz.id}><span className="list-copy"><strong>{quiz.title}</strong><small>{quiz.questions.length} questions · {quiz.published_version ? `published v${quiz.published_version}` : "not published"}</small></span><div className="panel-actions"><Button onClick={() => { setEditing(quiz); edit(quiz); }}>Edit</Button><Button onClick={() => void api.duplicateQuiz(quiz.id).then(refresh)}>Duplicate</Button><Button variant="primary" onClick={() => void api.publishQuiz(quiz.id).then(refresh)}>Publish</Button><Button disabled={!quiz.published_version} onClick={() => void api.deliverQuiz(quiz.id, { kind: "homework", opens_at: schedule.opens_at ? new Date(schedule.opens_at).toISOString() : null, due_at: schedule.due_at ? new Date(schedule.due_at).toISOString() : null }).then(refresh)}>Assign homework</Button><Button variant="danger" onClick={() => void api.archiveQuiz(quiz.id).then(refresh)}>Archive</Button></div></div>)}</div> : <EmptyState icon="assignments" title="No quizzes yet" description="Create a short reusable assessment for this classroom." />}</Panel>
    <Panel title="Deliveries">{deliveries.length ? <div className="teacher-account-list">{deliveries.map((delivery) => <button className="list-item" type="button" key={delivery.id} onClick={() => void reviewDelivery(delivery)}><span className="list-copy"><strong>{delivery.title}</strong><small>{delivery.kind} · {delivery.results_released_at ? "results released" : "results private"}</small></span><span>Review</span></button>)}</div> : <p className="muted">No assigned quizzes.</p>}</Panel>
    {review ? <Panel title={`Results · ${review.delivery.title}`}>
      <div className="metric-grid"><span>Submitted: {review.stats.submitted_count}/{review.stats.assigned_count}</span><span>Mean: {review.stats.mean?.toFixed(1) ?? "—"}</span><span>Median: {review.stats.median?.toFixed(1) ?? "—"}</span><span>Range: {review.stats.lowest?.toFixed(1) ?? "—"}–{review.stats.highest?.toFixed(1) ?? "—"}</span><span>Quartiles: {review.stats.lower_quartile?.toFixed(1) ?? "—"} / {review.stats.upper_quartile?.toFixed(1) ?? "—"}</span></div>
      <p>Score distribution, from 0–9% through 90–100%: {review.stats.distribution.join(" · ")}</p>
      {review.stats.questions.map((stat) => <p key={stat.question_id}><strong>{stat.prompt}</strong> · {stat.correct_percent.toFixed(0)}% correct · {stat.partial_percent.toFixed(0)}% partial{review.stats.most_correct_question_id === stat.question_id ? " · most correct" : ""}{review.stats.most_incorrect_question_id === stat.question_id ? " · most incorrect" : ""}</p>)}
      {review.attempts.map((attempt) => <div className="list-item" key={attempt.id}><span className="list-copy"><strong>{attempt.student_name}</strong><small>{attempt.submitted_at ? "Submitted" : "In progress"} · {attempt.score ?? 0}/{attempt.max_points}</small>{attempt.questions.filter((q) => q.kind === "short_answer").map((q) => { const response = attempt.responses.find((item) => item.question_id === q.id); return <span key={q.id}><strong>{q.prompt}</strong><small>Answer: {String(response?.answer ?? "Not answered")}{response?.feedback ? ` · Feedback: ${response.feedback}` : ""}</small></span>; })}</span><div className="panel-actions"><Button disabled={Boolean(review.delivery.results_released_at)} onClick={() => void api.reopenQuizAttempt(attempt.id).then(() => reviewDelivery(review.delivery))}>Reopen</Button>{attempt.submitted_at ? attempt.questions.filter((q) => q.kind === "short_answer" && attempt.responses.some((item) => item.question_id === q.id)).map((q) => <Button key={q.id} onClick={() => { const response = attempt.responses.find((item) => item.question_id === q.id); const points = Number(window.prompt(`Points for: ${q.prompt} (max ${q.max_points})`, String(response?.points ?? 0))); if (!Number.isFinite(points)) return; const feedback = window.prompt("Feedback (optional)", response?.feedback ?? "") ?? response?.feedback ?? ""; void api.gradeQuizResponse(attempt.id, q.id, points, feedback).then(() => reviewDelivery(review.delivery)); }}>Grade short answer</Button>) : null}</div></div>)}
      <div className="panel-actions"><Button variant="primary" disabled={review.delivery.results_released_at !== null} onClick={() => void api.releaseQuizResults(review.delivery.id).then(() => reviewDelivery(review.delivery))}>Release results</Button><Button onClick={() => setReview(null)}>Close</Button></div>
    </Panel> : null}
  </div>;
}
