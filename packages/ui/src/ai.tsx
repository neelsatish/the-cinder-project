import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type ReactNode,
} from "react";
import { ApiError, type CinderApi } from "./api";
import { Modal } from "./components";
import { fitWithin, imageFilesFromClipboard } from "./imageFit";
import type { ChatImage, StudentAiStatus } from "./types";

/** A photo ready to send, with a small preview for the screen. */
export type Attachment = ChatImage & { id: string; preview: string };

// A photo this size always fits the Host's 5 MB limit; noisy ones step down.
const QUALITY_STEPS = [0.88, 0.7, 0.5];
const MAX_BASE64_CHARS = 6_000_000;

/**
 * Shrinks a camera frame, screenshot or file to a JPEG the Host accepts.
 * Everything becomes JPEG on a white ground, so a transparent PNG screenshot
 * does not turn black and the Host only ever sees one format.
 */
export async function toAttachment(blob: Blob): Promise<Attachment> {
  if (!blob.type.startsWith("image/")) throw new Error("That file is not a photo.");
  let source: CanvasImageSource;
  let width: number;
  let height: number;
  let release = () => {};
  try {
    const bitmap = await createImageBitmap(blob);
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
    release = () => bitmap.close();
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      source = image;
      width = image.naturalWidth;
      height = image.naturalHeight;
    } catch {
      URL.revokeObjectURL(url);
      throw new Error("That photo could not be opened.");
    }
    release = () => URL.revokeObjectURL(url);
  }
  try {
    const size = fitWithin(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("That photo could not be prepared.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(source, 0, 0, size.width, size.height);
    for (const quality of QUALITY_STEPS) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
      if (data.length <= MAX_BASE64_CHARS || quality === QUALITY_STEPS[QUALITY_STEPS.length - 1]) {
        if (data.length > MAX_BASE64_CHARS) throw new Error("That photo is too large.");
        return { id: crypto.randomUUID(), media_type: "image/jpeg", data, preview: dataUrl };
      }
    }
    throw new Error("That photo could not be prepared.");
  } finally {
    release();
  }
}

export type Attachments = ReturnType<typeof useImageAttachments>;

/** Photos waiting to go with the next question. */
export function useImageAttachments(max: number) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [error, setError] = useState("");
  const count = useRef(0);
  count.current = items.length;

  const add = useCallback(
    async (blobs: Blob[]) => {
      const photos = blobs.filter((blob) => blob.type.startsWith("image/"));
      if (!photos.length) {
        if (blobs.length) setError("Only photos can be added.");
        return;
      }
      setError("");
      const room = Math.max(0, max - count.current);
      if (photos.length > room) {
        setError(`You can add up to ${max} photo${max === 1 ? "" : "s"} to one question.`);
      }
      const prepared: Attachment[] = [];
      for (const photo of photos.slice(0, room)) {
        try {
          prepared.push(await toAttachment(photo));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "That photo could not be added.");
        }
      }
      if (prepared.length) setItems((current) => [...current, ...prepared].slice(0, max));
    },
    [max],
  );

  return {
    items,
    error,
    max,
    full: items.length >= max,
    /** What to send to the Host. */
    images: items.map(({ media_type, data }): ChatImage => ({ media_type, data })),
    add,
    remove: (id: string) => setItems((current) => current.filter((item) => item.id !== id)),
    clear: () => {
      setItems([]);
      setError("");
    },
  };
}

/** Add to a form's `onPaste` so Ctrl+V of a screenshot or copied picture attaches it. */
export function pasteHandler(attachments: Attachments) {
  return (event: ClipboardEvent) => {
    const files = imageFilesFromClipboard(event.clipboardData);
    if (!files.length) return; // plain text pastes as normal
    event.preventDefault();
    void attachments.add(files);
  };
}

function CameraCapture({
  onCapture,
  onClose,
}: {
  onCapture: (photo: Blob) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("The camera cannot be used from this app on this computer. Add a photo instead.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } },
        audio: false,
      })
      .then((opened) => {
        if (cancelled) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;
        const element = video.current;
        if (element) {
          element.srcObject = opened;
          void element.play().catch(() => {});
        }
      })
      .catch(() =>
        setError("The camera could not be opened. Allow camera access, or add a photo instead."),
      );
    return () => {
      cancelled = true;
      // The light stays on until every track is stopped.
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function capture() {
    const element = video.current;
    if (!element?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    canvas.getContext("2d")?.drawImage(element, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(blob);
        onClose();
      },
      "image/jpeg",
      0.92,
    );
  }

  return (
    <Modal
      title="Take a photo"
      description="Hold the page flat and steady, with the writing filling the picture."
      onClose={onClose}
    >
      <div className="ai-camera">
        {error ? (
          <p className="ai-error" role="alert">
            {error}
          </p>
        ) : (
          <video
            ref={video}
            muted
            playsInline
            onLoadedData={() => setReady(true)}
            aria-label="Live camera view"
          />
        )}
        <div className="ai-camera-actions">
          <button type="button" className="ai-button" onClick={onClose}>
            Cancel
          </button>
          {!error ? (
            <button type="button" className="ai-button ai-button-primary" disabled={!ready} onClick={capture}>
              Take photo
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

/** Thumbnails of what is attached, plus the ways to add more: file, camera, paste. */
export function ImageAttachments({
  attachments,
  disabled = false,
}: {
  attachments: Attachments;
  disabled?: boolean;
}) {
  const [camera, setCamera] = useState(false);
  const blocked = disabled || attachments.full;
  return (
    <div className="ai-attach">
      {attachments.items.length ? (
        <ul className="ai-thumbs" aria-label="Attached photos">
          {attachments.items.map((item, index) => (
            <li key={item.id}>
              <img src={item.preview} alt={`Attached photo ${index + 1}`} />
              <button
                type="button"
                aria-label={`Remove photo ${index + 1}`}
                disabled={disabled}
                onClick={() => attachments.remove(item.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="ai-attach-actions">
        <label className={`ai-button${blocked ? " is-disabled" : ""}`}>
          Add a photo
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            disabled={blocked}
            onChange={(event) => {
              void attachments.add(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </label>
        <button type="button" className="ai-button" disabled={blocked} onClick={() => setCamera(true)}>
          Use the camera
        </button>
        <span className="ai-hint">or paste a picture with Ctrl+V</span>
      </div>
      {attachments.error ? (
        <p className="ai-error" role="alert">
          {attachments.error}
        </p>
      ) : null}
      {camera ? (
        <CameraCapture onCapture={(photo) => void attachments.add([photo])} onClose={() => setCamera(false)} />
      ) : null}
    </div>
  );
}

/** An AI answer as plain text: line breaks kept, nothing interpreted as markup. */
export function AiText({ children }: { children: ReactNode }) {
  return <div className="ai-answer">{children}</div>;
}

type Exchange = { id: number; question: string; answer: string; photos: number };

/**
 * The student study helper. It shows what it is (an AI), how many questions
 * are left, and when they run out, asks a teacher rather than a model.
 */
export function StudentAiHelper({ api }: { api: CinderApi }) {
  const [status, setStatus] = useState<StudentAiStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [thread, setThread] = useState<Exchange[]>([]);
  const photos = useImageAttachments(2);
  const wasPending = useRef(false);
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const next = await api.studentAiStatus();
      setStatus(next);
      setUnavailable(false);
    } catch (cause) {
      // An older Host has no study helper at all.
      if (cause instanceof ApiError && cause.status === 404) setUnavailable(true);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While a teacher is deciding, look again every few seconds.
  const pending = status?.request_pending ?? false;
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => void refresh(), 6_000);
    return () => window.clearInterval(timer);
  }, [pending, refresh]);

  useEffect(() => {
    if (wasPending.current && status && !status.request_pending) {
      setNotice(
        status.remaining > 0
          ? `Your teacher said yes. You have ${status.remaining} more question${status.remaining === 1 ? "" : "s"}.`
          : "Your teacher said not this time.",
      );
    }
    wasPending.current = status?.request_pending ?? false;
  }, [status]);

  async function ask() {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const reply = await api.studentAiAsk(text, photos.images);
      sequence.current += 1;
      setThread((current) => [
        { id: sequence.current, question: text, answer: reply.answer, photos: photos.items.length },
        ...current,
      ]);
      setQuestion("");
      photos.clear();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The study helper could not answer just now.");
      if (cause instanceof ApiError && cause.code === "student_ai_limit") void refresh();
    } finally {
      setBusy(false);
    }
  }

  async function requestMore() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setStatus(await api.studentAiRequestMore());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your request could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  if (unavailable || (status && !status.enabled)) {
    return (
      <section className="ai-panel">
        <h1>Study helper</h1>
        <p className="ai-note">
          {unavailable
            ? "This school's Cinder Host needs updating before the study helper can work."
            : "Your school has not switched the study helper on."}
        </p>
      </section>
    );
  }

  const outOfQuestions = status ? status.remaining === 0 : false;
  return (
    <section className="ai-panel" onPaste={pasteHandler(photos)}>
      <header>
        <h1>Study helper</h1>
        <p className="ai-note">
          You are talking to an AI, not a person. It can be wrong, so check anything important with
          your teacher or a book. Your teacher can read your questions and its answers. Please do not
          type personal details such as your address or phone number.
        </p>
      </header>

      {status ? (
        <p className="ai-count" aria-live="polite">
          {outOfQuestions
            ? "You have used all your questions."
            : `${status.remaining} of ${status.limit} question${status.limit === 1 ? "" : "s"} left`}
        </p>
      ) : null}

      {outOfQuestions ? (
        <div className="ai-limit">
          {pending ? (
            <p>Your teacher has been asked. This page will update when they decide.</p>
          ) : (
            <>
              <p>Your teacher decides whether you can ask more.</p>
              <button type="button" className="ai-button ai-button-primary" disabled={busy} onClick={() => void requestMore()}>
                Ask my teacher for more
              </button>
            </>
          )}
        </div>
      ) : (
        <form
          className="ai-form"
          onSubmit={(event) => {
            event.preventDefault();
            void ask();
          }}
        >
          <label>
            <span>Your question</span>
            <textarea
              value={question}
              maxLength={1500}
              rows={4}
              disabled={busy}
              placeholder="Type a question, or add a photo of the page you are stuck on"
              onChange={(event) => setQuestion(event.target.value)}
            />
          </label>
          <ImageAttachments attachments={photos} disabled={busy} />
          <button type="submit" className="ai-button ai-button-primary" disabled={busy || !question.trim() || !status}>
            {busy ? "Thinking…" : "Ask"}
          </button>
        </form>
      )}

      {notice ? <p className="ai-notice" role="status">{notice}</p> : null}
      {error ? (
        <p className="ai-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="ai-thread">
        {thread.map((exchange) => (
          <article key={exchange.id}>
            <p className="ai-question">
              {exchange.question}
              {exchange.photos ? <small> · {exchange.photos} photo{exchange.photos === 1 ? "" : "s"}</small> : null}
            </p>
            <AiText>{exchange.answer}</AiText>
          </article>
        ))}
      </div>
    </section>
  );
}
