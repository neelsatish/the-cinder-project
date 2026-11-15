import { Badge, Button, EmptyState, formatWhen, Icon, Panel, type CinderApi, type QuizAttempt, type QuizDelivery } from "@cinder/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function StudentQuizzes({ api, classroomId, online, focusDeliveryId }: { api: CinderApi; classroomId: string; online: boolean; focusDeliveryId?: string | null }) {
  const [deliveries, setDeliveries] = useState<QuizDelivery[]>([]);
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const dirty = useRef(new Map<string, unknown>());
  const pendingSave = useRef<Promise<void>>(Promise.resolve());
  const refresh = useCallback(async () => setDeliveries(await api.quizDeliveries(classroomId)), [api, classroomId]);

  useEffect(() => { void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Quizzes could not be loaded.")); }, [refresh]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { const delivery = deliveries.find((item) => item.id === focusDeliveryId); if (delivery) void open(delivery); }, [focusDeliveryId, deliveries]);

  async function open(delivery: QuizDelivery) {
    if (!online && !delivery.attempt_id) { setMessage("Connect to the Host to start this quiz."); return; }
    try {
      const next = delivery.attempt_id ? await api.quizAttempt(delivery.attempt_id) : await api.startQuizAttempt(delivery.id);
      dirty.current.clear();
      setAttempt(next);
      setClockOffsetMs(Date.parse(next.server_now) - Date.now());
      setAnswers(Object.fromEntries(next.responses.map((response) => [response.question_id, response.answer])));
      setIndex(0);
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The quiz could not be opened."); }
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
    try { await pendingSave.current; setMessage("Answer saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Answer will retry when connected."); }
  }

  useEffect(() => {
    if (!online || !attempt || attempt.submitted_at || !dirty.current.size) return;
    for (const [questionId, answer] of dirty.current) void save(questionId, answer);
  }, [online, attempt?.id, attempt?.submitted_at]);

  async function submit() {
    setConfirmSubmit(false);
    if (!attempt) return;
    try {
      for (const [questionId, answer] of Object.entries(answers)) if (dirty.current.has(questionId)) await save(questionId, answer);
      await pendingSave.current;
      if (dirty.current.size) throw new Error("Some answers are not saved yet. Check the Host connection and try again.");
      setAttempt(await api.submitQuizAttempt(attempt.id));
      await refresh();
      setMessage("Quiz submitted.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Quiz could not be submitted."); }
  }

  const remaining = useMemo(() => attempt?.expires_at ? Math.max(0, Math.ceil((Date.parse(attempt.expires_at) - now - clockOffsetMs) / 1000)) : null, [attempt?.expires_at, clockOffsetMs, now]);

  if (attempt) {
    const question = attempt.questions[index];
    const progress = attempt.questions.length ? ((index + 1) / attempt.questions.length) * 100 : 0;
    return (
      <Panel
        title={attempt.delivery.title}
        action={attempt.submitted_at ? null : <span className="list-meta">Question {index + 1} of {attempt.questions.length}{remaining !== null ? ` · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} left` : ""}</span>}
      >
        <div className="quiz-runner">
          {!attempt.submitted_at ? <div className="quiz-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div> : null}
          {attempt.delivery.instructions && !attempt.submitted_at ? <p className="muted">{attempt.delivery.instructions}</p> : null}
          {attempt.submitted_at ? (
            <div className="form-stack">
              <p className="mark-line">{attempt.released ? `${attempt.score ?? 0} / ${attempt.max_points}` : "Handed in"}</p>
              <p className="muted">{attempt.released ? "Your marked answers are below." : "Your result appears here when your teacher releases it."}</p>
              {attempt.released ? (
                <ol className="quiz-results">
                  {attempt.questions.map((item) => {
                    const response = attempt.responses.find((entry) => entry.question_id === item.id);
                    return (
                      <li key={item.id}>
                        <strong>{item.prompt}</strong>
                        <p>Your answer: {String(response?.answer ?? "Not answered")}</p>
                        <p className={response?.correct === true ? "quiz-correct" : response?.correct === false ? "quiz-incorrect" : ""}>
                          {response?.correct === true ? "Correct" : response?.correct === false ? "Incorrect" : "Marked"} · {response?.points ?? 0}/{item.max_points}
                        </p>
                        {response?.canonical_answer !== null && item.kind !== "short_answer" ? <p className="muted">Correct answer: {String(response?.canonical_answer)}</p> : null}
                        {response?.feedback ? <p>{response.feedback}</p> : null}
                      </li>
                    );
                  })}
                </ol>
              ) : null}
              <div className="panel-actions"><Button onClick={() => setAttempt(null)}>Back to quizzes</Button></div>
            </div>
          ) : question ? (
            <>
              <fieldset className="quiz-question">
                <legend>{question.prompt}</legend>
                <small className="muted">{question.max_points} mark{question.max_points === 1 ? "" : "s"}</small>
                {question.kind === "single_choice" ? question.options.map((option) => <label className="quiz-option" key={option}><input type="radio" name={question.id} checked={answers[question.id] === option} onChange={() => void save(question.id, option)} /><span>{option}</span></label>) : null}
                {question.kind === "true_false" ? [true, false].map((value) => <label className="quiz-option" key={String(value)}><input type="radio" name={question.id} checked={answers[question.id] === value} onChange={() => void save(question.id, value)} /><span>{value ? "True" : "False"}</span></label>) : null}
                {question.kind === "short_answer" ? <textarea rows={6} placeholder="Write your answer" value={String(answers[question.id] ?? "")} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} onBlur={() => void save(question.id, answers[question.id] ?? "")} /> : null}
              </fieldset>
              <footer className="quiz-actions">
                <Button disabled={index === 0} onClick={() => setIndex(index - 1)}>Previous</Button>
                <span className="form-hint">{message || (!online ? "Offline: answers will be sent when you reconnect" : "Answers save as you go")}</span>
                {index < attempt.questions.length - 1 ? (
                  <Button variant="primary" onClick={() => setIndex(index + 1)}>Next</Button>
                ) : confirmSubmit ? (
                  <span className="panel-actions">
                    <Button variant="ghost" onClick={() => setConfirmSubmit(false)}>Keep working</Button>
                    <Button variant="primary" disabled={!online || remaining === 0} onClick={() => void submit()}>Hand in now</Button>
                  </span>
                ) : (
                  <Button variant="primary" disabled={!online || remaining === 0} onClick={() => setConfirmSubmit(true)}>Hand in…</Button>
                )}
              </footer>
            </>
          ) : null}
        </div>
      </Panel>
    );
  }

  const nowDate = new Date();
  return (
    <>
      <Panel className="panel-flush">
        {deliveries.length ? (
          <div className="list">
            {deliveries.map((delivery) => {
              const submitted = delivery.attempt_state === "submitted";
              const notOpen = Boolean(delivery.opens_at && new Date(delivery.opens_at) > nowDate);
              const closed = Boolean(delivery.due_at && new Date(delivery.due_at) <= nowDate);
              const missed = Boolean(delivery.results_released_at && !submitted);
              // A handed-in quiz always opens, so the result stays readable after the due date.
              const locked = !submitted && (notOpen || closed || missed);
              const state = submitted ? (delivery.results_released_at ? "Result ready" : "Handed in") : missed || closed ? "Closed" : delivery.attempt_id ? "In progress" : notOpen ? "Not open yet" : "Start";
              const tone = submitted ? (delivery.results_released_at ? "good" : "accent") : delivery.attempt_id ? "warning" : "neutral";
              return (
                <button className="list-item" type="button" key={delivery.id} disabled={locked} onClick={() => void open(delivery)}>
                  <span className="list-icon"><Icon name="check" /></span>
                  <span className="list-copy">
                    <strong>{delivery.title}</strong>
                    <span>{delivery.kind === "live" ? "Live quiz" : delivery.due_at ? `Due ${formatWhen(delivery.due_at)}` : "No due date"}{delivery.time_limit_minutes ? ` · ${delivery.time_limit_minutes} minutes` : ""}</span>
                  </span>
                  <Badge tone={tone}>{state}</Badge>
                </button>
              );
            })}
          </div>
        ) : <EmptyState icon="check" title="No quizzes yet" />}
      </Panel>
      {message ? <p className="form-hint" role="status">{message}</p> : null}
    </>
  );
}
