import { useEffect, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { readAsset, writeAsset } from "../theme";

const ZOOM_LEVELS = [.5, .75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

/** Each page owns its canvas and render task. A cancelled render can never
 * paint into a newer zoom level or a different reference document. */
function PdfPage({ doc, number, scroll, width, zoom }: {
  doc: PDFDocumentProxy; number: number; scroll: HTMLDivElement; width: number; zoom: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [ratio, setRatio] = useState(210 / 297);
  const [error, setError] = useState("");
  const displayedCanvas = useRef<HTMLCanvasElement | null>(null);
  const nearRef = useRef(near);
  nearRef.current = near;
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root: scroll, rootMargin: "400px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, [scroll]);
  useEffect(() => {
    const host = hostRef.current;
    if (!near || !host || width <= 0) return;
    let alive = true;
    let task: RenderTask | undefined;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `Reference page ${number}`);
    host.setAttribute("aria-busy", "true");
    setError("");
    void (async () => {
      try {
        const page = await doc.getPage(number);
        if (!alive) return;
        const base = page.getViewport({ scale: 1 });
        setRatio(base.width / base.height);
        const viewport = page.getViewport({ scale: width * zoom / base.width });
        // Keep at least one backing pixel per CSS pixel so zooming never
        // stretches a lower-resolution canvas. The normal split/stacked
        // layouts stay below this budget through the 300% zoom ceiling.
        const budgetRatio = Math.sqrt(12_000_000 / (viewport.width * viewport.height));
        const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.max(1, budgetRatio));
        canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        task = page.render({ canvas, canvasContext: context, viewport, transform: [dpr, 0, 0, dpr, 0, 0] });
        await task.promise;
        if (!alive) return;
        const previous = displayedCanvas.current;
        host.replaceChildren(canvas);
        displayedCanvas.current = canvas;
        host.removeAttribute("aria-busy");
        if (previous && previous !== canvas) { previous.width = 0; previous.height = 0; }
      } catch {
        if (alive) {
          host.removeAttribute("aria-busy");
          setError(`Page ${number} could not be rendered.`);
        }
      }
    })();
    return () => {
      alive = false;
      task?.cancel();
      host.removeAttribute("aria-busy");
      // A completed canvas remains visible until the replacement is ready;
      // pages scrolled well out of range and abandoned off-DOM renders can
      // release their backing store immediately.
      if (displayedCanvas.current === canvas && !nearRef.current) {
        displayedCanvas.current = null;
        canvas.remove();
        if (task) void task.promise.catch(() => {}).then(() => { canvas.width = 0; canvas.height = 0; });
        else { canvas.width = 0; canvas.height = 0; }
      } else if (displayedCanvas.current !== canvas) {
        if (task) void task.promise.catch(() => {}).then(() => { canvas.width = 0; canvas.height = 0; });
        else { canvas.width = 0; canvas.height = 0; }
      }
    };
  }, [doc, number, near, width, zoom]);
  return <div className="pdf-page-shell" data-page={number} style={{ width: width * zoom || "100%", aspectRatio: String(ratio) }}>
    <div ref={hostRef} className="pdf-page" />
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}

export function PdfPane({ fileId, storageKey, name, onClose }: { fileId: string; storageKey: string; name: string; onClose: () => void }) {
  const [scroll, setScroll] = useState<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(0);
  const [current, setCurrent] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    let task: PDFDocumentLoadingTask | undefined;
    setDoc(null); setError(""); setCurrent(1); setZoom(1);
    if (scroll) scroll.scrollTop = 0;
    void (async () => {
      try {
        let blob = await readAsset(storageKey);
        if (!blob) {
          blob = await readAsset(`pdf:${fileId}`);
          if (blob) await writeAsset(storageKey, blob);
        }
        if (!alive) return;
        if (!blob) throw new Error("missing");
        const [pdfjs, data] = await Promise.all([import("pdfjs-dist"), blob.arrayBuffer()]);
        if (!alive) return;
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        task = pdfjs.getDocument({ data });
        task.onPassword = () => {
          if (alive) setError("This PDF is password-protected. Add an unlocked copy to read it here.");
          void task?.destroy().catch(() => {});
        };
        const loaded = await task.promise;
        if (!alive) return;
        setDoc(loaded);
      } catch {
        if (alive) setError((previous) => previous || "That reference file could not be opened. Try another PDF.");
      }
    })();
    return () => { alive = false; void task?.destroy().catch(() => {}); };
  }, [fileId, storageKey]);
  useEffect(() => {
    if (!scroll) return;
    const measure = () => setWidth(Math.max(1, scroll.clientWidth - 28));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [scroll]);
  function trackCurrent() {
    if (!scroll) return;
    const top = scroll.getBoundingClientRect().top;
    const candidates = Array.from(scroll.querySelectorAll<HTMLElement>("[data-page]"));
    const first = candidates.find((page) => page.getBoundingClientRect().bottom > top + 20);
    if (first) setCurrent(Number(first.dataset.page));
  }
  function changeZoom(next: number) {
    if (next === zoom) return;
    const position = scroll && scroll.scrollHeight > 0
      ? (scroll.scrollTop + scroll.clientHeight / 2) / scroll.scrollHeight
      : null;
    setZoom(next);
    if (scroll && position !== null) requestAnimationFrame(() => requestAnimationFrame(() => {
      scroll.scrollTop = Math.max(0, position * scroll.scrollHeight - scroll.clientHeight / 2);
      trackCurrent();
    }));
  }
  function stepZoom(direction: -1 | 1) {
    const index = ZOOM_LEVELS.indexOf(zoom as typeof ZOOM_LEVELS[number]);
    const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index + direction));
    changeZoom(ZOOM_LEVELS[next]);
  }
  return <aside className="pdf-pane" aria-label={`Reference: ${name}`}>
    <header className="pdf-pane-bar"><strong title={name}>{name}</strong><div className="pdf-pane-tools">
      <button type="button" disabled={zoom === ZOOM_LEVELS[0]} onClick={() => stepZoom(-1)} aria-label="Zoom out">−</button>
      <select className="pdf-zoom-select" value={zoom} onChange={(event) => changeZoom(Number(event.target.value))} aria-label="Zoom percentage">
        {ZOOM_LEVELS.map((level) => <option key={level} value={level}>{Math.round(level * 100)}%</option>)}
      </select>
      <button type="button" disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]} onClick={() => stepZoom(1)} aria-label="Zoom in">+</button>
      <span aria-label="Reference page">{doc ? `${current} / ${doc.numPages}` : "…"}</span>
      <button type="button" onClick={onClose} aria-label="Close reference">×</button>
    </div></header>
    <div className="pdf-pane-scroll" ref={setScroll} onScroll={trackCurrent}>
      {error ? <p className="form-error" role="alert">{error}</p> : !doc ? <p role="status">Opening reference…</p> : scroll && Array.from({ length: doc.numPages }, (_, index) => <PdfPage key={`${fileId}:${index + 1}`} doc={doc} number={index + 1} scroll={scroll} width={width} zoom={zoom} />)}
    </div>
  </aside>;
}
