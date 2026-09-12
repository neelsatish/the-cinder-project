import { useEffect, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button, Field, type CinderApi, type PaperFigure } from "@cinder/ui";
import type { PaperDiagram } from "./paperLogic";

export type FigureSource = {
  id: string;
  name: string;
  load: () => Promise<Blob>;
};

type Props = {
  api: CinderApi;
  sources: FigureSource[];
  questions: { id: string; label: string }[];
  /** False when no Google key is configured; whole-page capture still works. */
  canDetect: boolean;
  onAttach: (questionId: string, diagram: PaperDiagram) => void;
  onClose: () => void;
};

type Candidate = {
  imageDataUrl: string;
  caption: string;
  alt: string;
};

/** Pages are sent to the model as JPEG; a crop keeps PNG so lines stay sharp. */
const RENDER_SCALE = 2;
const MAX_DIAGRAM_CHARS = 7_000_000;

async function renderPage(blob: Blob, pageNumber: number) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const task = pdfjs.getDocument({ data: await blob.arrayBuffer() });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(Math.min(Math.max(1, pageNumber), pdf.numPages));
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This computer could not render the page.");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return { canvas, pageCount: pdf.numPages };
  } finally {
    await task.destroy();
  }
}

function cropFromCanvas(canvas: HTMLCanvasElement, box: PaperFigure["box_2d"]) {
  const [top, left, bottom, right] = box;
  const x = Math.round((left / 1000) * canvas.width);
  const y = Math.round((top / 1000) * canvas.height);
  const width = Math.max(8, Math.round(((right - left) / 1000) * canvas.width));
  const height = Math.max(8, Math.round(((bottom - top) / 1000) * canvas.height));
  const crop = document.createElement("canvas");
  crop.width = width;
  crop.height = height;
  const context = crop.getContext("2d");
  if (!context) return "";
  context.drawImage(canvas, x, y, width, height, 0, 0, width, height);
  const png = crop.toDataURL("image/png");
  return png.length <= MAX_DIAGRAM_CHARS ? png : crop.toDataURL("image/jpeg", 0.85);
}

export function FigurePicker({ api, sources, questions, canDetect, onAttach, onClose }: Props) {
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [questionId, setQuestionId] = useState(questions[0]?.id ?? "");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const pageCanvas = useRef<HTMLCanvasElement | null>(null);
  const preview = useRef<HTMLDivElement>(null);

  const source = sources.find((item) => item.id === sourceId) ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!source) return;
    setBusy(true);
    setStatus("");
    setCandidates([]);
    void source
      .load()
      .then((blob) => renderPage(blob, pageNumber))
      .then(({ canvas, pageCount: total }) => {
        if (cancelled) return;
        pageCanvas.current = canvas;
        setPageCount(total);
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        preview.current?.replaceChildren(canvas);
      })
      .catch((failure) => {
        if (cancelled) return;
        pageCanvas.current = null;
        preview.current?.replaceChildren();
        setStatus(
          failure instanceof Error ? failure.message : "That page could not be opened.",
        );
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pageNumber, source]);

  const detect = async () => {
    const canvas = pageCanvas.current;
    if (!canvas) return;
    setBusy(true);
    setStatus("Looking for figures on this page...");
    try {
      const jpeg = canvas.toDataURL("image/jpeg", 0.8).split(",")[1] ?? "";
      const figures = await api.findPaperFigures([{ page: pageNumber, jpeg_base64: jpeg }]);
      const found = figures
        .map((figure) => ({
          imageDataUrl: cropFromCanvas(canvas, figure.box_2d),
          caption: figure.caption,
          alt: figure.alt || figure.caption || "Figure from the source paper",
        }))
        .filter((candidate) => candidate.imageDataUrl);
      setCandidates(found);
      setStatus(
        found.length
          ? `${found.length} figure${found.length === 1 ? "" : "s"} found. Check each one before attaching it.`
          : "No figures were found on this page.",
      );
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : "The page could not be examined.");
    } finally {
      setBusy(false);
    }
  };

  const useWholePage = () => {
    const canvas = pageCanvas.current;
    if (!canvas) return;
    const jpeg = canvas.toDataURL("image/jpeg", 0.82);
    if (jpeg.length > MAX_DIAGRAM_CHARS) {
      setStatus("That page is too large to attach. Crop a figure from it instead.");
      return;
    }
    setCandidates([
      {
        imageDataUrl: jpeg,
        caption: `${source?.name ?? "Source"}, page ${pageNumber}`,
        alt: `Page ${pageNumber} of ${source?.name ?? "the source paper"}`,
      },
    ]);
    setStatus("Whole page ready. Attaching a complete page needs your school's rights to it.");
  };

  const attach = (candidate: Candidate) => {
    if (!questionId) {
      setStatus("Choose which question this figure belongs to.");
      return;
    }
    onAttach(questionId, {
      imageDataUrl: candidate.imageDataUrl,
      caption: candidate.caption
        ? `${candidate.caption} (${source?.name ?? "source"}, p. ${pageNumber})`
        : `${source?.name ?? "Source"}, p. ${pageNumber}`,
      alt: candidate.alt,
    });
    setStatus("Figure attached.");
  };

  return (
    <div className="figure-picker-backdrop" role="dialog" aria-label="Add a figure from a source paper">
      <div className="figure-picker">
        <div className="figure-picker-head">
          <h2>Add a figure from a source paper</h2>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>

        {sources.length ? (
          <>
            <div className="figure-picker-controls">
              <Field label="Source paper">
                <select value={sourceId} onChange={(event) => { setSourceId(event.target.value); setPageNumber(1); }}>
                  {sources.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                </select>
              </Field>
              <Field label={pageCount ? `Page (of ${pageCount})` : "Page"}>
                <input
                  type="number"
                  min={1}
                  max={pageCount || undefined}
                  value={pageNumber}
                  onChange={(event) => setPageNumber(Math.max(1, Number(event.target.value) || 1))}
                />
              </Field>
              <Field label="Attach to question">
                <select value={questionId} onChange={(event) => setQuestionId(event.target.value)}>
                  {questions.map((question) => (
                    <option value={question.id} key={question.id}>{question.label}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="figure-picker-actions">
              <Button variant="primary" onClick={() => void detect()} disabled={busy || !canDetect}>
                {busy ? "Working..." : "Find figures on this page"}
              </Button>
              <Button variant="secondary" onClick={useWholePage} disabled={busy}>Use the whole page</Button>
            </div>
            {canDetect ? null : (
              <p className="form-hint">
                Add a Google key in Settings to find figures automatically. You can still attach a
                whole page.
              </p>
            )}

            <div className="figure-picker-body">
              <div className="figure-picker-page" ref={preview} />
              <div className="figure-picker-results">
                {candidates.length ? candidates.map((candidate, index) => (
                  <figure key={`${candidate.caption}-${index}`}>
                    <img src={candidate.imageDataUrl} alt={candidate.alt} />
                    <figcaption>{candidate.caption || "Untitled figure"}</figcaption>
                    <Button variant="secondary" onClick={() => attach(candidate)}>Attach</Button>
                  </figure>
                )) : <p className="form-hint">Nothing selected yet.</p>}
              </div>
            </div>
          </>
        ) : (
          <p className="form-hint">
            Add a past paper as a reference first, then its pages can be used here.
          </p>
        )}

        {status ? (
          <p className={/could not|too large|no figures/i.test(status) ? "form-error" : "form-hint"}>{status}</p>
        ) : null}
      </div>
    </div>
  );
}
