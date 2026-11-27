import { useCallback, useEffect, useState } from "react";
import {
  AiText,
  Button,
  EmptyState,
  ImageAttachments,
  PageHeader,
  Panel,
  pasteHandler,
  useImageAttachments,
  type ChatMessage,
  type ChatModel,
  type CinderApi,
  type StudentAiQuestion,
  type StudentAiRequest,
} from "@cinder/ui";

const PRESETS = [
  {
    label: "Transcribe handwriting",
    prompt:
      "Transcribe the handwriting in the attached photo exactly as written. Write maths as LaTeX. Mark anything you cannot read as [illegible].",
  },
  {
    label: "Convert to LaTeX",
    prompt: "Convert the working in the attached photo into LaTeX, one line per step.",
  },
  {
    label: "Check this working",
    prompt:
      "Check the student's working in the attached photo step by step. Say where the first mistake is and how many marks it deserves, with reasons. I will review the marks myself.",
  },
  {
    label: "Draw a diagram",
    prompt:
      "Draw this as a clear, labelled exam-style diagram. Reply with one complete LaTeX TikZ code block and nothing else: ",
  },
] as const;

// The Host refuses a conversation of more than 40 messages.
const MAX_HISTORY_TURNS = 8;

type Turn = { id: number; question: string; answer: string; model: ChatModel; photos: number };

function when(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

/** Ask Claude about text or photos. Haiku by default; Sonnet when it is worth the cost. */
function Assistant({ api }: { api: CinderApi }) {
  const [model, setModel] = useState<ChatModel>("haiku");
  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const photos = useImageAttachments(6);
  const [status, setStatus] = useState<{ drafting: boolean; sonnet?: boolean } | null>(null);
  useEffect(() => { void api.aiStatus().then(setStatus).catch(() => setStatus(null)); }, [api]);

  async function ask() {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      // Earlier answers give context. Photos go only with the question they
      // were attached to, so a follow-up about a photo needs it attached again.
      const history: ChatMessage[] = [...turns].slice(0, MAX_HISTORY_TURNS).reverse().flatMap((turn) => [
        { role: "user" as const, content: turn.question },
        { role: "assistant" as const, content: turn.answer },
      ]);
      const reply = await api.chat([...history, { role: "user", content: text }], undefined, 6_000, {
        model,
        images: photos.images,
      });
      setTurns((current) => [
        { id: Date.now(), question: text, answer: reply.content, model, photos: photos.items.length },
        ...current,
      ]);
      setPrompt("");
      photos.clear();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The AI could not answer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Ask the AI" eyebrow="Text and photos">
      <div className="ai-form" onPaste={pasteHandler(photos)}>
        {status?.drafting === false ? (
          <p className="notice">AI is not set up on Cinder Host. Whoever runs Cinder Host can turn it on in Settings.</p>
        ) : null}
        {status?.sonnet ? <fieldset className="ai-model-choice">
          <legend>Model</legend>
          <label>
            <input type="radio" name="ai-model" checked={model === "haiku"} onChange={() => setModel("haiku")} />
            <span>
              <strong>Haiku</strong>: fast and cheap. Right for most things.
            </span>
          </label>
          <label>
            <input type="radio" name="ai-model" checked={model === "sonnet"} onChange={() => setModel("sonnet")} />
            <span>
              <strong>Sonnet</strong>: stronger on hard marking, about 20 times the cost. Teachers only.
            </span>
          </label>
        </fieldset> : null}
        <div className="ai-presets">
          {PRESETS.map((preset) => (
            <button key={preset.label} type="button" className="ai-button" onClick={() => setPrompt(preset.prompt)}>
              {preset.label}
            </button>
          ))}
        </div>
        <label>
          <span>Your question</span>
          <textarea
            rows={5}
            value={prompt}
            disabled={busy}
            placeholder="Add a photo of a student's page, then say what you want done with it"
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <ImageAttachments attachments={photos} disabled={busy} />
        <div className="ai-attach-actions">
          <Button variant="primary" disabled={busy || !prompt.trim()} onClick={() => void ask()}>
            {busy ? "Working…" : "Ask"}
          </Button>
          {turns.length ? (
            <Button disabled={busy} onClick={() => setTurns([])}>
              New conversation
            </Button>
          ) : null}
        </div>
        {error ? <p className="ai-error" role="alert">{error}</p> : null}
        <p className="ai-note">
          Suggested marks are proposals for you to check. Do not send photos that show a student's
          name unless your school's rules allow it.
        </p>
      </div>
      <div className="ai-thread">
        {turns.map((turn) => (
          <article key={turn.id}>
            <p className="ai-question">
              {turn.question}
              <small>
                {" "}
                · {turn.model === "sonnet" ? "Sonnet" : "Haiku"}
                {turn.photos ? ` · ${turn.photos} photo${turn.photos === 1 ? "" : "s"}` : ""}
              </small>
            </p>
            <AiText>{turn.answer}</AiText>
          </article>
        ))}
      </div>
    </Panel>
  );
}

/** Students who have used their questions and are waiting, and what students have been asking. */
function StudentRequests({
  api,
  requests,
  onChanged,
}: {
  api: CinderApi;
  requests: StudentAiRequest[];
  onChanged: () => void;
}) {
  const [activity, setActivity] = useState<StudentAiQuestion[] | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState<string | null>(null);

  const loadActivity = useCallback(async () => {
    try {
      setActivity(await api.studentAiQuestions());
    } catch {
      setActivity([]);
    }
  }, [api]);
  useEffect(() => {
    void loadActivity();
  }, [loadActivity, requests.length]);

  async function decide(request: StudentAiRequest, approve: boolean) {
    setWorking(request.id);
    setError("");
    try {
      await api.decideStudentAiRequest(request.id, approve);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That could not be saved.");
    } finally {
      setWorking(null);
    }
  }

  return (
    <Panel title="Student study helper" eyebrow="Needs you">
      <p className="ai-note">
        Each student gets 5 questions. When they are used, they ask you. Saying yes gives 5 more.
        Students always get Haiku, and you can read everything they ask.
      </p>
      {error ? <p className="ai-error" role="alert">{error}</p> : null}
      {requests.length ? (
        <div className="ai-requests">
          {requests.map((request) => (
            <article className="ai-request" key={request.id}>
              <header>
                <strong>{request.student_name}</strong>
                <small>
                  used all {request.used} questions · asked {when(request.created_at)}
                </small>
              </header>
              {request.recent.length ? (
                <ul>
                  {request.recent.map((question) => (
                    <li key={question.id}>
                      {question.question}
                      {question.had_image ? " (with a photo)" : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="ai-request-actions">
                <Button variant="primary" disabled={working === request.id} onClick={() => void decide(request, true)}>
                  Allow 5 more
                </Button>
                <Button variant="secondary" disabled={working === request.id} onClick={() => void decide(request, false)}>
                  Not now
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="assistant"
          title="No requests"
          description="Nobody is waiting for more questions."
        />
      )}
      <details>
        <summary>Recent student questions{activity?.length ? ` (${activity.length})` : ""}</summary>
        <div className="ai-activity">
          {activity?.length ? (
            activity.map((item) => (
              <article key={item.id}>
                <strong>{item.student_name}</strong>
                <span>{item.question}{item.had_image ? " (with a photo)" : ""}</span>
                {item.answer ? <AiText>{item.answer}</AiText> : null}
                <small>{when(item.created_at)}</small>
              </article>
            ))
          ) : (
            <p className="ai-note">Nothing has been asked yet.</p>
          )}
        </div>
      </details>
    </Panel>
  );
}

export function AiView({
  api,
  requests,
  onRequestsChanged,
}: {
  api: CinderApi;
  requests: StudentAiRequest[];
  onRequestsChanged: () => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Teacher"
        title="AI"
        description="Read handwriting, convert working to LaTeX, check answers and draw diagrams. The Host's AI provider must be Anthropic."
      />
      <div className="ai-stack">
        <StudentRequests api={api} requests={requests} onChanged={onRequestsChanged} />
        <Assistant api={api} />
      </div>
    </>
  );
}
