import { type CinderApi, type QuizAttempt, type QuizDelivery } from "@cinder/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function StudentQuizzes({ api, classroomId, online, focusDeliveryId }: { api: CinderApi; classroomId: string; online: boolean; focusDeliveryId?: string | null }) {
  const [deliveries, setDeliveries] = useState<QuizDelivery[]>([]);
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const dirty = useRef(new Map<string, unknown>());
  const pendingSave = useRef<Promise<void>>(Promise.resolve());
  const refresh = useCallback(async () => setDeliveries(await api.quizDeliveries(classroomId)), [api, classroomId]);
  useEffect(() => { void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Quizzes could not be loaded.")); }, [refresh]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { const delivery = deliveries.find((item) => item.id === focusDeliveryId); if (delivery) void open(delivery); }, [focusDeliveryId, deliveries]);

  async function open(delivery: QuizDelivery) {
    if (!online && !delivery.attempt_id) { setMessage("Connect to the Host to start this quiz."); return; }
    try { const next = delivery.attempt_id ? await api.quizAttempt(delivery.attempt_id) : await api.startQuizAttempt(delivery.id); dirty.current.clear(); setAttempt(next); setClockOffsetMs(Date.parse(next.server_now) - Date.now()); setAnswers(Object.fromEntries(next.responses.map((response) => [response.question_id, response.answer]))); setIndex(0); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The quiz could not be opened."); }
  }
  async function save(questionId: string, answer: unknown) {
    setAnswers((current) => ({ ...current, [questionId]: answer }));
    dirty.current.set(questionId, answer);
    if (!attempt || !online) return;
    const attemptId = attempt.id;
    pendingSave.current = pendingSave.current.catch(() => undefined).then(async () => {
      if (!dirty.current.has(questionId)) return;
      const latest = dirty.current.get(questionId);
      await api.saveQuizResponse(attemptId, questionId, latest);
      if (dirty.current.get(questionId) === latest) dirty.current.delete(questionId);
    });
    try { await pendingSave.current; setMessage("Answer saved."); } catch (error) { setMessage(error instanceof Error ? error.message : "Answer will retry when connected."); }
  }
  useEffect(() => {
    if (!online || !attempt || attempt.submitted_at || !dirty.current.size) return;
    for (const [questionId, answer] of dirty.current) void save(questionId, answer);
  }, [online, attempt?.id, attempt?.submitted_at]);
  async function submit() {
    if (!attempt || !window.confirm("Submit this quiz? You cannot change answers afterwards.")) return;
    try { for (const [questionId, answer] of Object.entries(answers)) if (dirty.current.has(questionId)) await save(questionId, answer); await pendingSave.current; if (dirty.current.size) throw new Error("Some answers are not saved yet. Check the Host connection and try again."); setAttempt(await api.submitQuizAttempt(attempt.id)); await refresh(); setMessage("Quiz submitted."); } catch (error) { setMessage(error instanceof Error ? error.message : "Quiz could not be submitted."); }
  }
  const remaining = useMemo(() => attempt?.expires_at ? Math.max(0, Math.ceil((Date.parse(attempt.expires_at) - now - clockOffsetMs) / 1000)) : null, [attempt?.expires_at, clockOffsetMs, now]);

  if (attempt) {
    const question = attempt.questions[index];
    return <section className="forge-panel quiz-runner"><div className="panel-heading"><div><span className="forge-kicker">Quiz</span><h2>{attempt.delivery.title}</h2></div><strong>{index + 1}/{attempt.questions.length}{remaining !== null ? ` · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : ""}</strong></div>
      {attempt.submitted_at ? <><p>{attempt.released ? `Result: ${attempt.score ?? 0}/${attempt.max_points}` : "Submitted. Your result will appear after your teacher releases it."}</p>{attempt.released ? attempt.questions.map((q) => { const r = attempt.responses.find((item) => item.question_id === q.id); return <div className="quiz-result" key={q.id}><strong>{q.prompt}</strong><p>Your answer: {String(r?.answer ?? "Not answered")}</p><p>{r?.correct === true ? "Correct" : r?.correct === false ? "Incorrect" : "Reviewed"} · {r?.points ?? 0}/{q.max_points}</p>{r?.canonical_answer !== null && q.kind !== "short_answer" ? <p>Correct answer: {String(r?.canonical_answer)}</p> : null}{r?.feedback ? <p>{r.feedback}</p> : null}</div>; }) : null}<button className="forge-button secondary" type="button" onClick={() => setAttempt(null)}>Back to quizzes</button></> : question ? <><div className="quiz-question"><span className="forge-kicker">{question.max_points} point{question.max_points === 1 ? "" : "s"}</span><h3>{question.prompt}</h3>{question.kind === "single_choice" ? question.options.map((option) => <label className="quiz-option" key={option}><input type="radio" name={question.id} checked={answers[question.id] === option} onChange={() => void save(question.id, option)} />{option}</label>) : question.kind === "true_false" ? [true, false].map((value) => <label className="quiz-option" key={String(value)}><input type="radio" name={question.id} checked={answers[question.id] === value} onChange={() => void save(question.id, value)} />{value ? "True" : "False"}</label>) : <textarea value={String(answers[question.id] ?? "")} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} onBlur={() => void save(question.id, answers[question.id] ?? "")} />}</div><div className="panel-actions"><button className="forge-button secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>Previous</button>{index < attempt.questions.length - 1 ? <button className="forge-button primary" onClick={() => setIndex(index + 1)}>Next</button> : <button className="forge-button primary" disabled={!online || remaining === 0} onClick={() => void submit()}>Submit quiz</button>}</div></> : null}{message ? <p className="form-hint" role="status">{message}</p> : null}</section>;
  }
  const nowDate = new Date();
  return <section className="forge-panel"><div className="panel-heading"><h2>Quizzes</h2></div>{deliveries.length ? deliveries.map((delivery) => {
    const notOpen = Boolean(delivery.opens_at && new Date(delivery.opens_at) > nowDate);
    const closed = Boolean(delivery.due_at && new Date(delivery.due_at) <= nowDate);
    const releasedWithoutSubmission = Boolean(delivery.results_released_at && delivery.attempt_state !== "submitted");
    const state = delivery.attempt_state === "submitted" ? delivery.results_released_at ? "View result" : "Submitted" : releasedWithoutSubmission ? "Closed" : delivery.attempt_id ? "Resume" : notOpen ? "Not open" : closed ? "Closed" : "Start";
    return <button className="classroom-row" type="button" key={delivery.id} disabled={notOpen || closed || releasedWithoutSubmission} onClick={() => void open(delivery)}><span><strong>{delivery.title}</strong><small>{delivery.kind === "live" ? "Live quiz" : delivery.due_at ? `Due ${new Date(delivery.due_at).toLocaleString()}` : "Homework"}</small></span><span>{state}</span></button>;
  }) : <p className="classroom-muted">No quizzes have been assigned.</p>}{message ? <p className="form-error" role="alert">{message}</p> : null}</section>;
}
