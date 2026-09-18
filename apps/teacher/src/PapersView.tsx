import { invoke } from "@tauri-apps/api/core";
import { save as showSaveDialog } from "@tauri-apps/plugin-dialog";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  Field,
  Icon,
  CinderApi,
  PageHeader,
  openExternalUrl,
  type Classroom,
  type PaperCandidate,
  type StudyNode,
} from "@cinder/ui";
import { createPaperPdf } from "./paperExport";
import { formatDate, isTauri, safeFilename, saveTextExport } from "./teacherFiles";
import { FigurePicker, type FigureSource } from "./FigurePicker";
import {
  answerKeyText,
  boardName,
  DEFAULT_PAPER_OUTPUT_TOKENS,
  difficultyName,
  difficultyPrompt,
  EMPTY_SCHEME,
  normalizePaperOutputTokens,
  PAPER_SOURCE_MODES,
  legacyPaperToSpec,
  normalizeGeneratedPaper,
  paperTotalMarks,
  parseGeneratedPaperResponse,
  questionPaperText,
  schemeLines,
  sourceSummary,
  type DifficultyLevel,
  type ExamBoard,
  type GeneratedPaper,
  type PaperDiagram,
  type PaperMetadata,
  type PaperQuestion,
  type PaperSourceMode,
} from "./paperLogic";
import {
  deleteQuestionPaper,
  listSavedQuestionPapers,
  saveQuestionPaper,
  type PaperAdvancedOptions,
  type PaperSourceCitation,
  type SavedQuestionPaper,
} from "./paperLibrary";

const EMPTY_DOCUMENT: Record<string, unknown> = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

const EMPTY_GENERATED_PAPER: GeneratedPaper = {
  instructions: [],
  questions: [],
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readDiagramFile(file: File): Promise<string> {
  if (!["image/png", "image/jpeg"].includes(file.type)) {
    return Promise.reject(new Error("Choose a PNG or JPEG image."));
  }
  if (file.size > 5 * 1024 * 1024) {
    return Promise.reject(new Error("Diagram images must be 5 MB or smaller."));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("The diagram image could not be read."));
    reader.onerror = () => reject(new Error("The diagram image could not be read."));
    reader.readAsDataURL(file);
  });
}

function diagramDataUrl(diagram: PaperDiagram) {
  return diagram.imageDataUrl;
}

function paperHtml(metadata: PaperMetadata, paper: GeneratedPaper, kind: "question" | "answer") {
  const title = kind === "answer" ? `${metadata.title} - Marking scheme` : metadata.title;
  const details = [
    boardName(metadata.board),
    metadata.syllabusCode ? `Syllabus ${metadata.syllabusCode}` : "",
    metadata.year,
    metadata.session,
    metadata.paperVariant ? `Paper ${metadata.paperVariant}` : "",
  ].filter(Boolean);
  const questions = paper.questions
    .map((question, index) => {
      const diagram = question.diagram
        ? `<figure><img src="${escapeHtml(diagramDataUrl(question.diagram))}" alt="${escapeHtml(question.diagram.alt)}">${question.diagram.caption ? `<figcaption>${escapeHtml(question.diagram.caption)}</figcaption>` : ""}</figure>`
        : "";
      const subparts = question.subparts
        .map(
          (part) => `<div class="subpart"><span>(${escapeHtml(part.label)})</span><div><p>${escapeHtml(part.prompt)}</p>${kind === "answer" ? `<p class="answer">${escapeHtml(part.answer || "No answer supplied.")}</p>` : ""}</div><b>[${part.marks}]</b></div>${
            kind === "question"
              ? `<div class="working">${'<i></i>'.repeat(part.workingLines)}</div>`
              : ""
          }`,
        )
        .join("");
      return `<section class="question"><div class="question-row"><strong>${index + 1}.</strong><p>${escapeHtml(question.prompt)}</p><b>[${question.marks}]</b></div>${diagram}${kind === "answer" && !question.subparts.length ? `<p class="answer">${escapeHtml(question.answer || "No answer supplied.")}</p>` : ""}${subparts}${
        kind === "question" && !question.subparts.length
          ? `<div class="working">${'<i></i>'.repeat(question.workingLines)}</div>`
          : ""
      }${kind === "answer" && question.source ? `<small>Source note: ${escapeHtml(question.source)}</small>` : ""}</section>`;
    })
    .join("");
  const instructions =
    kind === "question" && paper.instructions.length
      ? `<section class="instructions"><h2>Instructions</h2><ul>${paper.instructions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`
      : "";
  const sources = metadata.sources.length
    ? `<p class="sources"><strong>Sources:</strong> ${escapeHtml(sourceSummary(metadata.sources))}</p>`
    : "";
  const customHeader = metadata.headerText ? `<p class="custom">${escapeHtml(metadata.headerText)}</p>` : "";
  const customFooter = metadata.footerText ? `<footer>${escapeHtml(metadata.footerText)}</footer>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{size:A4;margin:16mm 18mm}*{box-sizing:border-box}body{max-width:174mm;margin:0 auto;color:#171717;font:11pt/1.48 Arial,"Liberation Sans",sans-serif}header{padding-bottom:12pt;border-bottom:1px solid #999}h1{margin:0 0 5pt;font-size:20pt}header p{margin:2pt 0}.custom{font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.05em}.meta,.sources,footer{font-size:8.5pt;color:#444}footer{margin-top:18pt;padding-top:7pt;border-top:1px solid #bbb}.instructions{margin:12pt 0}.instructions h2{font-size:10pt;margin:0 0 4pt}.instructions ul{margin:0;padding-left:18pt}.question{margin:14pt 0;break-inside:avoid}.question-row,.subpart{display:grid;grid-template-columns:24pt 1fr 32pt;gap:5pt;align-items:start}.question-row p,.subpart p{margin:0;white-space:pre-wrap}.question-row>b,.subpart>b{text-align:right}.answer{margin:6pt 0 0 24pt!important;color:#26382b}.subpart .answer{margin-left:0!important}.subpart{margin:8pt 0 0 24pt}.working{margin:7pt 0 0 24pt}.working i{display:block;height:18pt;border-bottom:1px solid #bbb}figure{max-width:130mm;margin:10pt auto;text-align:center}figure img{display:block;max-width:100%;max-height:62mm;margin:auto}figcaption{margin-top:4pt;color:#555;font-size:8.5pt}.question small{display:block;margin:6pt 0 0 24pt;color:#555}</style></head><body><header>${customHeader}<h1>${escapeHtml(title)}</h1><p><strong>${escapeHtml(metadata.subject)}</strong></p><p class="meta">${escapeHtml(details.join(" | "))}${metadata.durationMinutes > 0 && kind === "question" ? ` | Time: ${metadata.durationMinutes} minutes` : ""}</p>${sources}</header>${instructions}${questions}${customFooter}</body></html>`;
}

type ExtractedPdf = {
  text: string;
  pages: number[];
};

async function extractPdfText(blob: Blob, name: string): Promise<ExtractedPdf> {
  if (blob.size > 25 * 1024 * 1024) {
    throw new Error(`${name} is larger than the 25 MB reference limit.`);
  }
  if (blob.type && blob.type !== "application/pdf") {
    throw new Error(`${name} is an image, not a text PDF.`);
  }
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const task = pdfjs.getDocument({
    data: await blob.arrayBuffer(),
  });
  const pdf = await task.promise;
  const pages: string[] = [];
  const includedPages: number[] = [];
  try {
    const pageLimit = Math.min(pdf.numPages, 40);
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) {
        pages.push(`[Page ${pageNumber}] ${text}`);
        includedPages.push(pageNumber);
      }
      if (pages.join("\n").length >= 24_000) break;
    }
  } finally {
    await task.destroy();
  }
  const text = pages.join("\n").slice(0, 24_000);
  if (!text) {
    throw new Error(
      `${name} has no selectable text. Scanned PDFs need OCR before the AI can use them.`,
    );
  }
  return { text, pages: includedPages };
}

const ACTIVE_PAPER_KEY = "cinder.teacher.active-question-paper";

/// A UUID, because the school server stores papers keyed by the id the teacher
/// app generates.
function createPaperId() {
  return crypto.randomUUID();
}

async function savePdfExport(defaultName: string, contents: Uint8Array) {
  const filename = `${safeFilename(defaultName)}.pdf`;
  if (isTauri()) {
    const path = await showSaveDialog({
      defaultPath: filename,
      filters: [{ name: "PDF document", extensions: ["pdf"] }],
    });
    if (!path) return false;
    await invoke("write_binary_export", {
      path,
      contents: Array.from(contents),
    });
    return true;
  }
  const blob = new Blob([contents as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

function PaperDocumentView({
  metadata,
  paper,
  kind,
  editable = false,
  onChange,
}: {
  metadata: PaperMetadata;
  paper: GeneratedPaper;
  kind: "question" | "answer";
  editable?: boolean;
  onChange?: (paper: GeneratedPaper) => void;
}) {
  const details = [
    boardName(metadata.board),
    metadata.syllabusCode ? `Syllabus ${metadata.syllabusCode}` : "",
    metadata.year,
    metadata.session,
    metadata.paperVariant ? `Paper ${metadata.paperVariant}` : "",
  ].filter(Boolean);
  const replaceQuestion = (index: number, question: PaperQuestion) => {
    onChange?.({
      ...paper,
      questions: paper.questions.map((current, questionIndex) =>
        questionIndex === index ? question : current,
      ),
    });
  };

  return (
    <article className={`worksheet-page worksheet-${kind}`}>
      <header className="worksheet-header">
        {metadata.headerText ? <p className="worksheet-custom-header">{metadata.headerText}</p> : null}
        <h1>{kind === "answer" ? `${metadata.title} - Marking scheme` : metadata.title}</h1>
        <strong>{metadata.subject}</strong>
        <p>{details.join(" | ")}</p>
        {kind === "question" && metadata.durationMinutes > 0 ? (
          <p>Time allowed: {metadata.durationMinutes} minutes</p>
        ) : null}
        {metadata.sources.length ? (
          <p className="worksheet-sources">
            <b>Sources:</b> {sourceSummary(metadata.sources)}
          </p>
        ) : null}
      </header>

      {kind === "question" && paper.instructions.length ? (
        <section className="worksheet-instructions">
          <h2>Instructions</h2>
          <ul>
            {paper.instructions.map((instruction, index) => (
              <li key={`${instruction}-${index}`}>{instruction}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="worksheet-questions">
        {paper.questions.map((question, questionIndex) => (
          <section className="worksheet-question" key={question.id}>
            <div className="worksheet-question-row">
              <b className="worksheet-number">{questionIndex + 1}.</b>
              {editable && kind === "question" ? (
                <textarea
                  aria-label={`Question ${questionIndex + 1}`}
                  maxLength={8000}
                  value={question.prompt}
                  onChange={(event) =>
                    replaceQuestion(questionIndex, {
                      ...question,
                      prompt: event.target.value,
                    })
                  }
                />
              ) : (
                <p>{question.prompt}</p>
              )}
              <span className="worksheet-marks">[{question.marks}]</span>
            </div>

            {question.diagram ? (
              <figure className="worksheet-diagram">
                <img src={diagramDataUrl(question.diagram)} alt={question.diagram.alt} />
                {question.diagram.caption ? <figcaption>{question.diagram.caption}</figcaption> : null}
              </figure>
            ) : null}

            {editable && kind === "answer" && !question.subparts.length ? (
              <textarea
                className="worksheet-answer-edit"
                aria-label={`Answer ${questionIndex + 1}`}
                maxLength={12000}
                value={question.answer}
                onChange={(event) =>
                  replaceQuestion(questionIndex, {
                    ...question,
                    answer: event.target.value,
                  })
                }
              />
            ) : kind === "answer" && !question.subparts.length ? (
              <p className="worksheet-answer">{question.answer || "No answer supplied."}</p>
            ) : null}

            {question.subparts.map((part, partIndex) => (
              <div className="worksheet-subpart" key={`${question.id}-${part.label}-${partIndex}`}>
                <span>({part.label})</span>
                {kind === "answer" ? (
                  <div className="worksheet-subpart-answer">
                    <p>{part.prompt}</p>
                    {editable ? (
                      <textarea
                        aria-label={`Answer ${questionIndex + 1}(${part.label})`}
                        maxLength={8000}
                        value={part.answer}
                        onChange={(event) => {
                          const subparts = question.subparts.map((current, index) =>
                            index === partIndex ? { ...current, answer: event.target.value } : current,
                          );
                          replaceQuestion(questionIndex, { ...question, subparts });
                        }}
                      />
                    ) : (
                      <p className="worksheet-answer">{part.answer || "No answer supplied."}</p>
                    )}
                  </div>
                ) : editable ? (
                  <textarea
                    aria-label={`Question ${questionIndex + 1}(${part.label})`}
                    maxLength={4000}
                    value={part.prompt}
                    onChange={(event) => {
                      const subparts = question.subparts.map((current, index) =>
                        index === partIndex ? { ...current, prompt: event.target.value } : current,
                      );
                      replaceQuestion(questionIndex, { ...question, subparts });
                    }}
                  />
                ) : (
                  <p>{part.prompt}</p>
                )}
                {editable && kind === "question" ? (
                  <input
                    className="worksheet-inline-number"
                    type="number"
                    min={1}
                    max={50}
                    aria-label={`Marks for question ${questionIndex + 1}(${part.label})`}
                    value={part.marks}
                    onChange={(event) => {
                      const subparts = question.subparts.map((current, index) =>
                        index === partIndex
                          ? { ...current, marks: Math.max(1, Math.min(50, Number(event.target.value) || 1)) }
                          : current,
                      );
                      replaceQuestion(questionIndex, {
                        ...question,
                        subparts,
                        marks: subparts.reduce((total, current) => total + current.marks, 0),
                      });
                    }}
                  />
                ) : (
                  <span className="worksheet-marks">[{part.marks}]</span>
                )}
                {kind === "question" ? (
                  <div className="worksheet-working-lines">
                    {Array.from({ length: part.workingLines }, (_, index) => (
                      <i key={index} />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}

            {kind === "question" && !question.subparts.length ? (
              <div className="worksheet-working-lines">
                {Array.from({ length: question.workingLines }, (_, index) => (
                  <i key={index} />
                ))}
              </div>
            ) : null}

            {kind === "answer" ? (
              <>
                {schemeLines(question.scheme, "").map((line, index) => (
                  <small className="worksheet-scheme-line" key={`scheme-${index}`}>{line}</small>
                ))}
                {question.subparts.flatMap((part) =>
                  schemeLines(part.scheme, "").map((line, index) => (
                    <small className="worksheet-scheme-line indented" key={`${part.label}-scheme-${index}`}>
                      ({part.label}) {line}
                    </small>
                  )),
                )}
              </>
            ) : null}

            {kind === "answer" && question.source ? (
              <small className="worksheet-source-note">Source note: {question.source}</small>
            ) : null}

            {editable ? (
              <div className="worksheet-edit-meta">
                {kind === "question" ? (
                  <>
                    <label>
                      Marks
                      <input
                        type="number"
                        min={1}
                        max={100}
                        disabled={question.subparts.length > 0}
                        value={question.marks}
                        onChange={(event) =>
                          replaceQuestion(questionIndex, {
                            ...question,
                            marks: Math.max(1, Math.min(100, Number(event.target.value) || 1)),
                          })
                        }
                      />
                    </label>
                    {!question.subparts.length ? (
                      <label>
                        Working lines
                        <input
                          type="number"
                          min={0}
                          max={14}
                          value={question.workingLines}
                          onChange={(event) =>
                            replaceQuestion(questionIndex, {
                              ...question,
                              workingLines: Math.max(0, Math.min(14, Number(event.target.value) || 0)),
                            })
                          }
                        />
                      </label>
                    ) : null}
                    <label className="worksheet-diagram-upload">
                      <span>{question.diagram ? "Replace source diagram" : "Attach source diagram"}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg"
                        aria-label={`Attach source diagram for question ${questionIndex + 1}`}
                        onChange={(event) => {
                          const input = event.currentTarget;
                          const file = input.files?.[0];
                          input.value = "";
                          if (!file) return;
                          void readDiagramFile(file)
                            .then((imageDataUrl) =>
                              replaceQuestion(questionIndex, {
                                ...question,
                                diagram: {
                                  imageDataUrl,
                                  caption: "",
                                  alt: `Source diagram for question ${questionIndex + 1}`,
                                },
                              }),
                            )
                            .catch((failure) =>
                              window.alert(
                                failure instanceof Error
                                  ? failure.message
                                  : "The diagram image could not be attached.",
                              ),
                            );
                        }}
                      />
                    </label>
                    {question.diagram ? (
                      <button
                        type="button"
                        className="worksheet-remove-diagram"
                        onClick={() => replaceQuestion(questionIndex, { ...question, diagram: null })}
                      >
                        Remove diagram
                      </button>
                    ) : null}
                  </>
                ) : null}
                <button
                  type="button"
                  className="worksheet-remove-question"
                  onClick={() =>
                    onChange?.({
                      ...paper,
                      questions: paper.questions.filter((_, index) => index !== questionIndex),
                    })
                  }
                >
                  Remove question
                </button>
              </div>
            ) : null}
          </section>
        ))}
      </div>
      {metadata.footerText ? <footer className="worksheet-custom-footer">{metadata.footerText}</footer> : null}
    </article>
  );
}

function PrintablePaper({
  metadata,
  paper,
  kind,
}: {
  metadata: PaperMetadata;
  paper: GeneratedPaper;
  kind: "question" | "answer";
}) {
  return (
    <div className={`paper-print-copy paper-print-${kind}`}>
      <PaperDocumentView metadata={metadata} paper={paper} kind={kind} />
    </div>
  );
}
/// The papers workspace: a library rail on the left, the paper being worked on
/// beside it. Master-detail rather than a mode switch, so a teacher can move
/// between saved papers without losing their place.
export function PapersView({
  api,
  classrooms,
}: {
  api: CinderApi;
  classrooms: Classroom[];
}) {
  const [savedPapers, setSavedPapers] = useState<SavedQuestionPaper[]>([]);
  const [papersLoading, setPapersLoading] = useState(true);
  const [papersError, setPapersError] = useState("");
  const [activePaperId, setActivePaperId] = useState(() =>
    localStorage.getItem(ACTIVE_PAPER_KEY),
  );
  const [newPaperVersion, setNewPaperVersion] = useState(0);
  const [libraryFilter, setLibraryFilter] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listSavedQuestionPapers(api)
      .then((papers) => {
        if (cancelled) return;
        setSavedPapers(papers);
        setPapersError("");
        const remembered = localStorage.getItem(ACTIVE_PAPER_KEY);
        if (remembered && !papers.some((paper) => paper.id === remembered)) {
          localStorage.removeItem(ACTIVE_PAPER_KEY);
          setActivePaperId(null);
        }
      })
      .catch((failure) => {
        if (cancelled) return;
        setSavedPapers([]);
        setPapersError(
          failure instanceof Error
            ? `Saved papers could not be opened: ${failure.message}`
            : "Saved papers could not be opened from the school server.",
        );
      })
      .finally(() => {
        if (!cancelled) setPapersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const savePaperRecord = useCallback(
    async (paper: SavedQuestionPaper) => {
      await saveQuestionPaper(api, paper);
      localStorage.setItem(ACTIVE_PAPER_KEY, paper.id);
      if (!mountedRef.current) return;
      setSavedPapers((current) =>
        [paper, ...current.filter((item) => item.id !== paper.id)].sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        ),
      );
      setActivePaperId(paper.id);
    },
    [api],
  );

  const startNewPaper = useCallback(() => {
    setActivePaperId(null);
    localStorage.removeItem(ACTIVE_PAPER_KEY);
    setNewPaperVersion((version) => version + 1);
  }, []);

  const openPaper = useCallback((id: string) => {
    setActivePaperId(id);
    localStorage.setItem(ACTIVE_PAPER_KEY, id);
  }, []);

  const removePaper = useCallback(
    async (id: string) => {
      await deleteQuestionPaper(api, id);
      setSavedPapers((current) => current.filter((paper) => paper.id !== id));
      if (activePaperId === id) {
        setActivePaperId(null);
        localStorage.removeItem(ACTIVE_PAPER_KEY);
      }
    },
    [activePaperId, api],
  );

  const activePaper = savedPapers.find((paper) => paper.id === activePaperId) ?? null;
  const filter = libraryFilter.trim().toLowerCase();
  const visiblePapers = filter
    ? savedPapers.filter((paper) =>
        `${paper.title} ${paper.subject} ${paper.syllabusCode ?? ""}`.toLowerCase().includes(filter),
      )
    : savedPapers;

  return (
    <div className="page papers-page">
      <PageHeader
        eyebrow="Assessment"
        title="Question papers"
        description="Build a paper from official past papers, keep its marking scheme private, then publish it to a classroom."
        action={<Button variant="primary" icon="plus" onClick={startNewPaper}>New paper</Button>}
      />
      <div className="papers-workspace">
        <aside className="papers-library" aria-label="Saved question papers">
          <div className="papers-library-head">
            <h2>Library</h2>
            <span className="papers-library-count">
              {papersLoading ? "Loading" : `${savedPapers.length} saved`}
            </span>
          </div>
          <input
            className="papers-library-filter"
            type="search"
            value={libraryFilter}
            placeholder="Filter by title or subject"
            aria-label="Filter saved papers"
            onChange={(event) => setLibraryFilter(event.target.value)}
          />
          {papersError ? <p className="form-error">{papersError}</p> : null}
          <div className="papers-library-list">
            {papersLoading ? (
              <p className="papers-library-empty">Opening saved papers…</p>
            ) : visiblePapers.length ? (
              visiblePapers.map((paper) => (
                <div
                  className={`papers-library-row${paper.id === activePaperId ? " is-active" : ""}`}
                  key={paper.id}
                >
                  <button type="button" onClick={() => openPaper(paper.id)}>
                    <strong>{paper.title}</strong>
                    <small>
                      {[paper.subject || "General", paper.board, paper.syllabusCode]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                    <small>Updated {formatDate(paper.updatedAt)}</small>
                  </button>
                  <button
                    type="button"
                    className="papers-library-delete"
                    aria-label={`Delete ${paper.title}`}
                    onClick={() => {
                      if (window.confirm(`Delete “${paper.title}” from the school server?`)) {
                        void removePaper(paper.id);
                      }
                    }}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              ))
            ) : (
              <p className="papers-library-empty">
                {savedPapers.length
                  ? "No paper matches that filter."
                  : "Papers you create are saved here on the school server."}
              </p>
            )}
          </div>
        </aside>

        {/* The studio reads its fields from the paper it mounts with, so it must
            not mount before the library has resolved the remembered paper. */}
        {papersLoading ? (
          <div className="papers-editor-loading">Opening the paper library…</div>
        ) : (
          <QuestionPaperStudio
            key={activePaperId ?? `new-${newPaperVersion}`}
            api={api}
            classrooms={classrooms}
            activePaper={activePaper}
            onSave={savePaperRecord}
            onDelete={removePaper}
            onCreateNew={startNewPaper}
          />
        )}
      </div>
    </div>
  );
}



function initialPaperSpec(paper: SavedQuestionPaper | null): GeneratedPaper {
  if (!paper) return EMPTY_GENERATED_PAPER;
  try {
    return paper.paperSpec
      ? normalizeGeneratedPaper(paper.paperSpec)
      : legacyPaperToSpec(paper.questionText, paper.answerKeyText);
  } catch {
    return EMPTY_GENERATED_PAPER;
  }
}

const DEFAULT_PAPER_ADVANCED: PaperAdvancedOptions = {
  year: String(new Date().getFullYear()),
  session: "",
  paperVariant: "",
  durationMinutes: 60,
  topics: "",
  includeDiagrams: true,
  headerText: "",
  footerText: "",
  repeatHeader: false,
  repeatFooter: true,
  maxOutputTokens: DEFAULT_PAPER_OUTPUT_TOKENS,
};

function QuestionPaperStudio({
  api,
  classrooms,
  activePaper,
  onSave,
  onDelete,
  onCreateNew,
}: {
  api: CinderApi;
  classrooms: Classroom[];
  activePaper: SavedQuestionPaper | null;
  onSave: (paper: SavedQuestionPaper) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreateNew: () => void;
}) {
  const [materials, setMaterials] = useState<StudyNode[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const [paperId, setPaperId] = useState(activePaper?.id ?? "");
  const [createdAt, setCreatedAt] = useState(
    activePaper?.createdAt ?? new Date().toISOString(),
  );
  const [title, setTitle] = useState(activePaper?.title ?? "Practice question paper");
  const [classroomId, setClassroomId] = useState(
    activePaper?.classroomId ??
      classrooms.find((classroom) => classroom.name === activePaper?.subject)?.id ??
      classrooms[0]?.id ??
      "",
  );
  const [board, setBoard] = useState<ExamBoard>(activePaper?.board ?? "CIE");
  const [syllabusCode, setSyllabusCode] = useState(
    activePaper?.syllabusCode ??
      classrooms.find((classroom) => classroom.id === activePaper?.classroomId)?.subject_code ??
      classrooms[0]?.subject_code ??
      "",
  );
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(
    activePaper?.difficulty ?? 3,
  );
  const [sourceMode, setSourceMode] = useState<PaperSourceMode>(
    activePaper?.sourceMode ?? "adapt",
  );
  const [rightsConfirmed, setRightsConfirmed] = useState(activePaper?.rightsConfirmed ?? false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PaperCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [showFigurePicker, setShowFigurePicker] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [questionCount, setQuestionCount] = useState(
    activePaper?.paperSpec?.questions.length ?? 10,
  );
  const [totalMarks, setTotalMarks] = useState(
    activePaper?.paperSpec ? paperTotalMarks(activePaper.paperSpec) : 50,
  );
  const [teacherBrief, setTeacherBrief] = useState("");
  const [advanced, setAdvanced] = useState<PaperAdvancedOptions>(() => ({
    ...DEFAULT_PAPER_ADVANCED,
    ...activePaper?.advanced,
    durationMinutes: Math.max(
      10,
      Math.min(360, activePaper?.advanced?.durationMinutes ?? DEFAULT_PAPER_ADVANCED.durationMinutes),
    ),
    maxOutputTokens: normalizePaperOutputTokens(activePaper?.advanced?.maxOutputTokens),
  }));
  const [paper, setPaper] = useState<GeneratedPaper>(() => initialPaperSpec(activePaper));
  const [sources, setSources] = useState<PaperSourceCitation[]>(activePaper?.sources ?? []);
  const [editorView, setEditorView] = useState<"question" | "answer">("question");
  const [workspaceSection, setWorkspaceSection] = useState<"options" | "feed" | "editing">(
    activePaper ? "editing" : "options",
  );
  const [status, setStatus] = useState(activePaper ? "Saved paper opened." : "");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [generationStage, setGenerationStage] = useState("");
  const [previewRevision, setPreviewRevision] = useState(0);
  const latestPaperRef = useRef<SavedQuestionPaper | null>(activePaper);
  const discardingPaperRef = useRef(false);

  const classroom = classrooms.find((item) => item.id === classroomId) ?? null;
  const maxOutputTokens = normalizePaperOutputTokens(advanced.maxOutputTokens);
  const subject = classroom?.name ?? activePaper?.subject ?? "General";
  // A reference can be a class material or a paper the teacher downloaded into
  // their own tree; both are usable as a source, only the first is visible to
  // students.
  const classroomMaterials = materials.filter(
    (material) =>
      !classroomId || material.classroom_id === classroomId || !material.classroom_id,
  );
  const metadata = useMemo<PaperMetadata>(
    () => ({
      title: title.trim().slice(0, 120) || "Untitled question paper",
      subject,
      board,
      syllabusCode: syllabusCode.trim().slice(0, 40),
      year: advanced.year.trim().slice(0, 20),
      session: advanced.session.trim().slice(0, 40),
      paperVariant: advanced.paperVariant.trim().slice(0, 40),
      durationMinutes: advanced.durationMinutes,
      sources,
      headerText: advanced.headerText?.trim().slice(0, 160) || "",
      footerText: advanced.footerText?.trim().slice(0, 160) || "",
      repeatHeader: Boolean(advanced.repeatHeader),
      repeatFooter: advanced.repeatFooter !== false,
    }),
    [advanced, board, sources, subject, syllabusCode, title],
  );

  useEffect(() => {
    void api
      .tree()
      .then((result) => setMaterials(result.nodes.filter((node) => node.kind === "pdf")))
      .catch(() => setMaterials([]));
  }, [api]);

  useEffect(() => {
    if (!classroomId && classrooms[0]) setClassroomId(classrooms[0].id);
  }, [classroomId, classrooms]);

  const buildSavedPaper = useCallback(
    (id: string, created: string): SavedQuestionPaper => {
      const questionText = questionPaperText(metadata, paper);
      const keyText = answerKeyText(metadata, paper);
      return {
        id,
        title: metadata.title,
        subject,
        questionText,
        questionDocument: EMPTY_DOCUMENT,
        answerKeyText: keyText,
        answerKeyDocument: EMPTY_DOCUMENT,
        sources,
        classroomId,
        board,
        syllabusCode: metadata.syllabusCode,
        difficulty,
        sourceMode,
        rightsConfirmed,
        advanced,
        paperSpec: paper,
        createdAt: created,
        updatedAt: new Date().toISOString(),
      };
    },
    [
      advanced,
      board,
      classroomId,
      difficulty,
      metadata,
      paper,
      rightsConfirmed,
      sourceMode,
      sources,
      subject,
    ],
  );

  latestPaperRef.current = paperId && paper.questions.length
    ? buildSavedPaper(paperId, createdAt)
    : null;

  useEffect(() => {
    const current = latestPaperRef.current;
    if (!current) return;
    const timer = window.setTimeout(() => {
      if (discardingPaperRef.current) return;
      void onSave(current)
        .then(() => setStatus("Saved to the school server."))
        .catch((failure) =>
          setStatus(
            failure instanceof Error
              ? `The paper could not be saved: ${failure.message}`
              : "The paper could not be saved.",
          ),
        );
    }, 700);
    return () => window.clearTimeout(timer);
  }, [buildSavedPaper, createdAt, onSave, paperId]);

  useEffect(
    () => () => {
      if (!discardingPaperRef.current && latestPaperRef.current) {
        void onSave(latestPaperRef.current);
      }
    },
    [onSave],
  );

  const collectReferences = async () => {
    if (selected.length + localFiles.length > 8) {
      throw new Error("Select no more than eight PDF references for one paper.");
    }
    if (localFiles.reduce((total, file) => total + file.size, 0) > 100 * 1024 * 1024) {
      throw new Error("Local PDF references must be 100 MB or less in total.");
    }
    const references: string[] = [];
    const nextSources: PaperSourceCitation[] = [];
    const warnings: string[] = [];
    for (const id of selected) {
      const material = materials.find((item) => item.id === id);
      if (!material) continue;
      try {
        const extracted = await extractPdfText(await api.materialBlob(id), material.name);
        references.push(`REFERENCE: ${material.name}\n${extracted.text}`);
        nextSources.push({ name: material.name, pages: extracted.pages });
      } catch (failure) {
        warnings.push(failure instanceof Error ? failure.message : `${material.name} could not be read.`);
      }
    }
    for (const file of localFiles) {
      try {
        const extracted = await extractPdfText(file, file.name);
        references.push(`REFERENCE: ${file.name}\n${extracted.text}`);
        nextSources.push({ name: file.name, pages: extracted.pages });
      } catch (failure) {
        warnings.push(failure instanceof Error ? failure.message : `${file.name} could not be read.`);
      }
    }
    if ((selected.length || localFiles.length) && !references.length) {
      throw new Error(warnings.join(" ") || "None of the selected references could be read.");
    }
    // Shuffle so repeated generations draw from every attached past paper rather than
    // always favouring whichever source happens to sort first (and survives truncation below).
    for (let i = references.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [references[i], references[j]] = [references[j], references[i]];
    }
    const perReferenceLimit = Math.max(2_400, Math.floor(19_000 / Math.max(1, references.length)));
    return {
      context: references.map((reference) => reference.slice(0, perReferenceLimit)).join("\n\n").slice(0, 19_500),
      sources: nextSources,
      warnings,
    };
  };

  const makeGenerationPrompt = (repair = false) => `
${repair ? "Repair the supplied draft and return a complete replacement." : "Create a new classroom-ready examination paper."}
Return ONLY valid JSON. Do not use Markdown fences or explanatory text.
Schema: {"instructions":["string"],"questions":[{"id":"q1","prompt":"string","marks":4,"answer":"string","working_lines":4,"source":"filename, p. 2, Q3 (adapted)","scheme":{"marking_points":[{"text":"string","marks":2}],"accepted_alternatives":["string"],"guidance":"string"},"subparts":[{"label":"a","prompt":"string","marks":2,"answer":"string","working_lines":2,"scheme":{"marking_points":[{"text":"string","marks":1}],"accepted_alternatives":["string"],"guidance":"string"}}],"diagram":null}]}
Always set diagram to null. Never redraw, infer or approximate an examination diagram. If a question depends on a figure, choose a different self-contained question; the teacher can attach the exact PNG or JPEG from the cited official source afterwards.
Every question needs a marking scheme. Marking points must sum to that question's marks, or to each subpart's marks where subparts exist. State the creditable point, not the whole answer. List accepted alternative wordings a student could reasonably write, and use guidance for partial credit and common errors. The marking scheme is for the teacher only; never repeat it in a prompt.

Paper specification:
- Board: ${boardName(board)}.
- Subject: ${subject}.
- Syllabus code: ${syllabusCode.trim() || "not provided"}.
- Difficulty: ${difficultyName(difficulty)}. ${difficultyPrompt(difficulty)}
- Exactly ${questionCount} top-level questions and exactly ${totalMarks} marks in total. A parent question's marks must equal the sum of its subpart marks.
- Year: ${advanced.year.trim() || "current syllabus"}; session: ${advanced.session.trim() || "not specified"}; paper or variant: ${advanced.paperVariant.trim() || "not specified"}.
- Topics: ${advanced.topics.trim() || "balanced coverage of the selected subject"}.
- Teacher brief: ${teacherBrief.trim().slice(0, 2_000) || "No additional brief"}.
- ${advanced.includeDiagrams ? "You may select questions that use official source diagrams only when a self-contained alternative is unavailable, but still set diagram to null for exact teacher attachment." : "Choose only self-contained questions that do not require diagrams."}
- Use board-appropriate command words, mathematical notation and mark allocation. Do not create elementary recall questions at an advanced setting.
- ${sourceMode === "adapt"
  ? "References are evidence, not a licence to copy. Write original questions in the source's style and difficulty; adapt rather than reproduce long passages."
  : sourceMode === "excerpt"
    ? "The teacher has confirmed the school may reproduce this material, so exact question wording from a reference is permitted where it is the best question. Cite the filename, page and question number for every reused question."
    : "The teacher has confirmed the school may reproduce whole pages of this material. Still write the question text out in full; whole pages are attached as images by the teacher, not described by you."}
- Never invent a filename, page or question number.
${selected.length + localFiles.length > 1 ? "- Multiple REFERENCE blocks are supplied. Draw questions across all of them, not just the first, weighted by the teacher brief and topics rather than by block order." : ""}
- Put answers only in answer fields. Never put an answer key in a prompt.
- Give enough working_lines for a student to solve each question.
- Keep prompts and answers concise enough for the complete JSON response to finish.
- Fit the complete JSON response within ${maxOutputTokens.toLocaleString()} output tokens. Prefer concise wording over an incomplete response.
- Use neutral, grammatical language when a person's pronouns are unknown.
`.trim();

  const generate = async () => {
    if (!classroom) {
      setStatus("Choose a classroom before creating a paper.");
      return;
    }
    if (totalMarks < questionCount) {
      setStatus("Total marks must be at least the number of questions.");
      return;
    }
    if (sourceMode !== "adapt" && !rightsConfirmed) {
      setStatus(
        "Confirm your school may reproduce this board's material, or switch back to adapted questions.",
      );
      return;
    }
    setBusy(true);
    setGenerationStage("Reading reference PDFs");
    setStatus("");
    try {
      const references = await collectReferences();
      setGenerationStage("Building the paper");
      const result = await api.chat(
        [{ role: "user", content: makeGenerationPrompt() }],
        references.context || undefined,
        maxOutputTokens,
      );
      if (!result.content.trim()) throw new Error("The AI returned an empty paper.");
      setGenerationStage("Checking questions and marks");
      let nextPaper: GeneratedPaper;
      const repairOutputTokens = Math.max(maxOutputTokens, 8_192);
      try {
        nextPaper = parseGeneratedPaperResponse(result.content);
      } catch {
        const repair = await api.chat(
          [{ role: "user", content: makeGenerationPrompt(true) }],
          `DRAFT TO REPAIR:\n${result.content}`.slice(0, 19_500),
          repairOutputTokens,
        );
        nextPaper = parseGeneratedPaperResponse(repair.content);
      }
      if (nextPaper.questions.length !== questionCount || paperTotalMarks(nextPaper) !== totalMarks) {
        const repair = await api.chat(
          [
            {
              role: "user",
              content: `${makeGenerationPrompt(true)}\nThe draft has ${nextPaper.questions.length} questions and ${paperTotalMarks(nextPaper)} marks. Correct both counts exactly.`,
            },
          ],
          JSON.stringify(nextPaper).slice(0, 19_500),
          repairOutputTokens,
        );
        nextPaper = parseGeneratedPaperResponse(repair.content);
      }
      if (nextPaper.questions.length !== questionCount || paperTotalMarks(nextPaper) !== totalMarks) {
        throw new Error(
          `The AI could not meet the requested structure (${questionCount} questions, ${totalMarks} marks). No incomplete paper was saved.`,
        );
      }
      const id = paperId || createPaperId();
      const now = new Date().toISOString();
      const nextMetadata = { ...metadata, sources: references.sources };
      const saved: SavedQuestionPaper = {
        id,
        title: nextMetadata.title,
        subject,
        questionText: questionPaperText(nextMetadata, nextPaper),
        questionDocument: EMPTY_DOCUMENT,
        answerKeyText: answerKeyText(nextMetadata, nextPaper),
        answerKeyDocument: EMPTY_DOCUMENT,
        sources: references.sources,
        classroomId,
        board,
        syllabusCode: nextMetadata.syllabusCode,
        difficulty,
        sourceMode,
        rightsConfirmed,
        advanced,
        paperSpec: nextPaper,
        createdAt: paperId ? createdAt : now,
        updatedAt: now,
      };
      setPaperId(id);
      if (!paperId) setCreatedAt(now);
      setSources(references.sources);
      setPaper(nextPaper);
      setPreviewRevision((revision) => revision + 1);
      setEditorView("question");
      await onSave(saved);
      setWorkspaceSection("editing");
      setStatus(
        references.warnings.length
          ? `Paper saved. Some references were skipped: ${references.warnings.join(" ")}`
          : "Paper and separate answer key saved. Review before printing.",
      );
    } catch (failure) {
      const message = failure instanceof Error
        ? failure.message
        : "The question paper could not be created.";
      setStatus(
        paper.questions.length
          ? `${message} The current preview was left unchanged.`
          : message,
      );
    } finally {
      setBusy(false);
      setGenerationStage("");
    }
  };

  const searchOfficialPapers = async () => {
    const query = searchQuery.trim()
      || [boardName(board), syllabusCode.trim(), subject, advanced.year.trim(), advanced.session.trim(), "past paper"]
        .filter(Boolean)
        .join(" ");
    setSearching(true);
    setStatus("");
    try {
      const results = await api.searchPapers(query);
      setSearchResults(results);
      if (!results.length) {
        setStatus("No official papers were found. Try naming the syllabus code and year.");
      }
    } catch (failure) {
      setSearchResults([]);
      setStatus(failure instanceof Error ? failure.message : "The search could not be run.");
    } finally {
      setSearching(false);
    }
  };

  const addOnlinePaper = async (candidate: PaperCandidate) => {
    setSearching(true);
    try {
      const node = await api.fetchPaperSource(candidate.url);
      const result = await api.tree();
      setMaterials(result.nodes.filter((item) => item.kind === "pdf"));
      setSelected((current) => [...new Set([...current, node.id])].slice(0, 8));
      setStatus(`${node.name} added as a reference.`);
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : "That paper could not be downloaded.");
    } finally {
      setSearching(false);
    }
  };

  const figureSources = useMemo<FigureSource[]>(
    () => [
      ...selected.flatMap((id) => {
        const material = materials.find((item) => item.id === id);
        return material
          ? [{ id, name: material.name, load: () => api.materialBlob(id) }]
          : [];
      }),
      ...localFiles.map((file, index) => ({
        id: `local-${index}`,
        name: file.name,
        load: async () => file as Blob,
      })),
    ],
    [api, localFiles, materials, selected],
  );

  const attachFigure = (questionId: string, diagram: PaperDiagram) => {
    setPaper((current) => ({
      ...current,
      questions: current.questions.map((question) =>
        question.id === questionId ? { ...question, diagram } : question,
      ),
    }));
    setPreviewRevision((revision) => revision + 1);
  };

  const publishAsAssignment = async () => {
    if (!classroomId) {
      setStatus("Choose a classroom before publishing.");
      return;
    }
    setPublishing(true);
    try {
      // Only the question paper is uploaded. The marking scheme stays with the
      // teacher's copy of the paper.
      const pdf = await createPaperPdf({ metadata, paper, kind: "question" });
      const file = new File([pdf as BlobPart], `${safeFilename(metadata.title)}.pdf`, {
        type: "application/pdf",
      });
      await api.uploadMaterial(classroomId, file);
      await api.createAssignment({
        classroom_id: classroomId,
        title: metadata.title,
        instructions: `${metadata.title} is in the class materials. ${paper.questions.length} questions, ${paperTotalMarks(paper)} marks.`,
        due_at: null,
        max_points: paperTotalMarks(paper),
        grading_scheme: { kind: "points", max_points: paperTotalMarks(paper) },
        publish: true,
      });
      setStatus("Published as an assignment, with the paper in class materials.");
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : "The paper could not be published.");
    } finally {
      setPublishing(false);
    }
  };

  const convertToQuiz = async () => {
    if (!classroomId) {
      setStatus("Choose a classroom before making a quiz.");
      return;
    }
    setPublishing(true);
    try {
      // Only plain, single-answer questions map onto the quiz engine's three
      // kinds. Anything with subparts or a figure is left for the teacher.
      const convertible = paper.questions.filter(
        (question) => !question.subparts.length && !question.diagram && question.answer.trim(),
      );
      if (!convertible.length) {
        setStatus(
          "None of these questions convert automatically. Quizzes take single-answer questions without figures.",
        );
        return;
      }
      const quiz = await api.createQuiz({
        classroom_id: classroomId,
        title: metadata.title,
        instructions: paper.instructions.join(" "),
        time_limit_minutes: advanced.durationMinutes || null,
        questions: convertible.map((question) => ({
          id: null,
          kind: "short_answer" as const,
          prompt: question.prompt,
          options: [],
          canonical_answer: question.answer,
          max_points: question.marks,
          required: true,
        })),
      });
      const skipped = paper.questions.length - convertible.length;
      setStatus(
        `Quiz “${quiz.title}” created with ${convertible.length} question${convertible.length === 1 ? "" : "s"}.`
        + (skipped
          ? ` ${skipped} question${skipped === 1 ? "" : "s"} with subparts or figures need${skipped === 1 ? "s" : ""} to be added by hand.`
          : "")
        + " Marking guidance stays in this paper's marking scheme.",
      );
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : "The quiz could not be created.");
    } finally {
      setPublishing(false);
    }
  };

  const activeLabel = editorView === "question" ? "Question paper" : "Marking scheme";
  const activeFilename = `${metadata.title}${editorView === "answer" ? " answer key" : ""}`;

  const exportPaper = async (extension: "doc" | "html" | "txt") => {
    try {
      const contents = extension === "txt"
        ? editorView === "question"
          ? questionPaperText(metadata, paper)
          : answerKeyText(metadata, paper)
        : paperHtml(metadata, paper, editorView);
      const saved = await saveTextExport(
        activeFilename,
        contents,
        extension,
        extension === "txt" ? "Plain text" : extension === "doc" ? "LibreOffice / Word document" : "HTML document",
      );
      if (saved) setStatus(`${activeLabel} exported.`);
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : "The paper could not be exported.");
    }
  };

  const downloadPdf = async () => {
    try {
      setStatus(`Creating ${activeLabel.toLowerCase()} PDF...`);
      const contents = await createPaperPdf({ metadata, paper, kind: editorView });
      if (await savePdfExport(activeFilename, contents)) setStatus(`${activeLabel} PDF saved.`);
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : "The PDF could not be created.");
    }
  };

  const printPaper = () => {
    window.document.body.dataset.cinderPaperPrint = editorView;
    const cleanup = () => {
      delete window.document.body.dataset.cinderPaperPrint;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    window.requestAnimationFrame(() => window.print());
    window.setTimeout(cleanup, 60_000);
  };

  const addBlankQuestion = () => {
    const next: PaperQuestion = {
      id: createPaperId(),
      prompt: "New question",
      marks: 1,
      answer: "",
      workingLines: 3,
      subparts: [],
      diagram: null,
      source: "",
      scheme: { ...EMPTY_SCHEME },
    };
    setPaper((current) => ({ ...current, questions: [...current.questions, next] }));
  };

  const deleteCurrentPaper = async () => {
    if (!paperId || deleting) return;
    if (!window.confirm(`Delete “${metadata.title}” from the school server? This cannot be undone.`)) {
      return;
    }
    discardingPaperRef.current = true;
    setDeleting(true);
    try {
      await onDelete(paperId);
    } catch (failure) {
      discardingPaperRef.current = false;
      setDeleting(false);
      setStatus(
        failure instanceof Error
          ? `The paper could not be deleted: ${failure.message}`
          : "The paper could not be deleted.",
      );
    }
  };

  const sourceModeCopy = PAPER_SOURCE_MODES.find((mode) => mode.value === sourceMode);
  const referenceCount = selected.length + localFiles.length;

  return (
    <div className="papers-editor">
      <nav className="paper-workflow-tabs" aria-label="Paper creator sections">
        {(["options", "feed", "editing"] as const).map((item, index) => (
          <button
            type="button"
            key={item}
            className={workspaceSection === item ? "is-active" : ""}
            aria-current={workspaceSection === item ? "step" : undefined}
            onClick={() => setWorkspaceSection(item)}
          >
            <span>{index + 1}</span>
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>

      {workspaceSection === "options" ? <section className="paper-section paper-workflow-section" aria-labelledby="paper-options-heading">
        <div className="paper-section-head">
          <div><span className="eyebrow">Step 1</span><h2 id="paper-options-heading">Options</h2></div>
          <span className="paper-section-note">Set the shape of the paper.</span>
        </div>
        <div className="paper-grid paper-options-grid">
          <Field label="Classroom">
            <select
              value={classroomId}
              onChange={(event) => {
                const id = event.target.value;
                setClassroomId(id);
                setSelected([]);
                setSyllabusCode(classrooms.find((item) => item.id === id)?.subject_code ?? "");
              }}
            >
              <option value="">Choose a classroom</option>
              {classrooms.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label="Syllabus">
            <select value={board} onChange={(event) => setBoard(event.target.value as ExamBoard)}>
              <option value="CIE">Cambridge International AS &amp; A Level</option>
              <option value="IGCSE">Cambridge IGCSE</option>
              <option value="CBSE">CBSE</option>
              <option value="ICSE">CISCE / ICSE</option>
            </select>
          </Field>
          <Field label="Syllabus code">
            <input maxLength={40} value={syllabusCode} placeholder="9702" onChange={(event) => setSyllabusCode(event.target.value)} />
          </Field>
          <Field label="Difficulty">
            <select value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value) as DifficultyLevel)}>
              {[1, 2, 3, 4, 5].map((level) => (
                <option value={level} key={level}>{level} - {difficultyName(level as DifficultyLevel)}</option>
              ))}
            </select>
          </Field>
          <Field label="Questions">
            <input type="number" min={1} max={30} value={questionCount} onChange={(event) => setQuestionCount(Math.max(1, Math.min(30, Number(event.target.value) || 1)))} />
          </Field>
          <Field label="Total marks">
            <input type="number" min={1} max={300} value={totalMarks} onChange={(event) => setTotalMarks(Math.max(1, Math.min(300, Number(event.target.value) || 1)))} />
          </Field>
          <Field label="Topics">
            <input maxLength={400} value={advanced.topics} placeholder="Mechanics, electricity" onChange={(event) => setAdvanced((current) => ({ ...current, topics: event.target.value }))} />
          </Field>
        </div>
        <div className="paper-section-actions">
          <Button variant="primary" onClick={() => setWorkspaceSection("feed")}>Continue to feed</Button>
        </div>
      </section> : null}

      {workspaceSection === "feed" ? <><section className="paper-section paper-workflow-section" aria-labelledby="paper-feed-heading">
        <div className="paper-section-head">
          <div><span className="eyebrow">Step 2</span><h2 id="paper-feed-heading">Feed</h2></div>
          <span className="paper-section-note">
            {referenceCount
              ? `${referenceCount} reference${referenceCount === 1 ? "" : "s"} selected`
              : "AI can work from your options alone"}
          </span>
        </div>

        <Field label="What should the paper focus on?" hint="Question types, learning goals, accommodations or anything the options do not cover.">
          <textarea maxLength={2000} value={teacherBrief} placeholder="For example: include one data-response question and avoid logarithms." onChange={(event) => setTeacherBrief(event.target.value)} />
        </Field>
        <Field label="How should AI use the feed?">
          <select
            value={sourceMode}
            onChange={(event) => {
              setSourceMode(event.target.value as PaperSourceMode);
              setRightsConfirmed(false);
            }}
          >
            {PAPER_SOURCE_MODES.map((mode) => (
              <option value={mode.value} key={mode.value}>{mode.label}</option>
            ))}
          </select>
        </Field>
        <p className="paper-help">{sourceModeCopy?.description}</p>
        {sourceMode === "adapt" ? null : (
          <label className="check-field paper-rights">
            <input
              type="checkbox"
              checked={rightsConfirmed}
              onChange={(event) => setRightsConfirmed(event.target.checked)}
            />
            <span>
              My school may reproduce this board's material for its own classes. Boards restrict
              electronic reproduction; this confirmation is recorded with the paper.
            </span>
          </label>
        )}
        <label className="check-field paper-rights">
          <input
            type="checkbox"
            checked={advanced.includeDiagrams}
            onChange={(event) => setAdvanced((current) => ({ ...current, includeDiagrams: event.target.checked }))}
          />
          <span>Allow questions that need a figure. You can attach the exact image in Editing.</span>
        </label>

        <div className="paper-search">
          <Field label="Find an official paper online">
            <input
              maxLength={400}
              value={searchQuery}
              placeholder={`${boardName(board)} ${syllabusCode.trim() || subject} past paper`}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (!searching) void searchOfficialPapers();
                }
              }}
            />
          </Field>
          <Button
            variant="secondary"
            disabled={searching}
            onClick={() => void searchOfficialPapers()}
          >
            {searching ? "Searching…" : "Search"}
          </Button>
        </div>
        <p className="paper-help">
          Only an examination board's own site is searched, and only the paper you choose is downloaded.
        </p>

        {searchResults.length ? (
          <div className="paper-search-results">
            {searchResults.map((candidate) => (
              <div className="paper-search-result" key={candidate.url}>
                <div>
                  <strong>{candidate.title || candidate.url}</strong>
                  <small>
                    {[candidate.board, candidate.year, candidate.session, candidate.variant]
                      .filter(Boolean)
                      .join(" · ") || candidate.snippet}
                  </small>
                  <button type="button" className="link-button" onClick={() => void openExternalUrl(candidate.url)}>
                    View on the board's site
                  </button>
                </div>
                <Button variant="secondary" disabled={searching} onClick={() => void addOnlinePaper(candidate)}>
                  Use this paper
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="paper-reference-columns">
          <div>
            <h3>Classroom materials</h3>
            <div className="reference-list">
              {classroomMaterials.length ? classroomMaterials.map((material) => (
                <label className="check-field" key={material.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(material.id)}
                    onChange={(event) => setSelected((current) => event.target.checked
                      ? [...new Set([...current, material.id])].slice(0, 8)
                      : current.filter((id) => id !== material.id))}
                  />
                  <span>{material.name}</span>
                </label>
              )) : <p className="paper-help">No PDF materials in this classroom yet.</p>}
            </div>
          </div>
          <div>
            <h3>From this computer</h3>
            {localFiles.length ? (
              <div className="reference-chips">
                {localFiles.map((file, index) => (
                  <button
                    type="button"
                    key={`${file.name}-${index}`}
                    onClick={() => setLocalFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
                  >
                    {file.name} ×
                  </button>
                ))}
              </div>
            ) : <p className="paper-help">Nothing added from this computer.</p>}
            <label className="button button-secondary upload-button">
              Add PDF references
              <input type="file" accept="application/pdf,.pdf" multiple onChange={(event) => {
                setLocalFiles((current) => [...current, ...Array.from(event.target.files ?? [])].slice(0, 8));
                event.target.value = "";
              }} />
            </label>
          </div>
        </div>

      </section>

      <div className="paper-action-bar">
        <Button
          variant="primary"
          onClick={() => void generate()}
          disabled={busy || !title.trim() || !classroomId}
        >
          {busy ? "Creating paper…" : paper.questions.length ? "Create paper again" : "Create paper"}
        </Button>
        <Button variant="secondary" onClick={() => setWorkspaceSection("editing")}>Open editing</Button>
        {paperId ? (
          <Button variant="ghost" disabled={busy || deleting} onClick={() => void deleteCurrentPaper()}>
            {deleting ? "Deleting…" : "Delete this paper"}
          </Button>
        ) : null}
        {status ? (
          <p className={/could not|must|unavailable|incomplete|confirm/i.test(status) ? "form-error" : "form-hint"}>
            {status}
          </p>
        ) : null}
      </div>
      </> : null}

      {workspaceSection === "editing" ? <section className="paper-section paper-preview-section paper-workflow-section" aria-labelledby="paper-preview-heading">
        <div className="paper-section-head">
          <div><span className="eyebrow">Step 3</span><h2 id="paper-preview-heading">Editing</h2></div>
          <span className="paper-section-note">
            {paperId ? "Saved to the school server as you work." : "Draft not saved yet."}
          </span>
        </div>

        <div className="paper-editing-settings">
          <Field label="Paper title">
            <input maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Total marks" hint={paper.questions.length ? `Questions currently add up to ${paperTotalMarks(paper)}.` : "Used when AI creates the paper."}>
            <input type="number" min={1} max={300} value={totalMarks} onChange={(event) => setTotalMarks(Math.max(1, Math.min(300, Number(event.target.value) || 1)))} />
          </Field>
          <Field label="Page header" hint="Optional text above the paper title.">
            <input maxLength={160} value={advanced.headerText ?? ""} placeholder="School name or examination series" onChange={(event) => setAdvanced((current) => ({ ...current, headerText: event.target.value }))} />
          </Field>
          <label className="check-field paper-repeat-setting">
            <input type="checkbox" checked={Boolean(advanced.repeatHeader)} onChange={(event) => setAdvanced((current) => ({ ...current, repeatHeader: event.target.checked }))} />
            <span>Repeat header on every page</span>
          </label>
          <Field label="Page footer" hint="Optional text beside the page number.">
            <input maxLength={160} value={advanced.footerText ?? ""} placeholder="Confidential · Return to teacher" onChange={(event) => setAdvanced((current) => ({ ...current, footerText: event.target.value }))} />
          </Field>
          <label className="check-field paper-repeat-setting">
            <input type="checkbox" checked={advanced.repeatFooter !== false} onChange={(event) => setAdvanced((current) => ({ ...current, repeatFooter: event.target.checked }))} />
            <span>Repeat footer on every page</span>
          </label>
        </div>
        {status ? <p className={/could not|must|unavailable|incomplete|confirm/i.test(status) ? "form-error" : "form-hint"}>{status}</p> : null}

        {paper.questions.length ? (
          <>
            <div className="paper-export-bar">
              <div className="paper-document-switch" role="tablist" aria-label="Paper document">
                <Button variant={editorView === "question" ? "primary" : "secondary"} onClick={() => setEditorView("question")}>Question paper</Button>
                <Button variant={editorView === "answer" ? "primary" : "secondary"} onClick={() => setEditorView("answer")}>Marking scheme</Button>
              </div>
              <Button variant="primary" icon="download" onClick={() => void downloadPdf()}>Download PDF</Button>
              <Button onClick={printPaper}>Print</Button>
              <Button onClick={() => setShowFigurePicker(true)}>Add a figure</Button>
              <Button
                disabled={publishing || !classroomId}
                onClick={() => void publishAsAssignment()}
              >
                Publish as assignment
              </Button>
              <Button
                disabled={publishing || !classroomId}
                onClick={() => void convertToQuiz()}
              >
                Make a quiz
              </Button>
              <details className="paper-more-actions">
                <summary>More</summary>
                <div className="paper-more-menu">
                  <button type="button" onClick={() => void exportPaper("doc")}>Export .doc</button>
                  <button type="button" onClick={() => void exportPaper("txt")}>Export text</button>
                </div>
              </details>
            </div>
            {editorView === "answer" ? (
              <p className="paper-help paper-scheme-warning">
                Teacher copy. The marking scheme is never published with an assignment or quiz.
              </p>
            ) : null}
            <div className="worksheet-canvas">
              <PaperDocumentView
                key={`paper-preview-${previewRevision}`}
                metadata={metadata}
                paper={paper}
                kind={editorView}
                editable
                onChange={setPaper}
              />
              <Button className="worksheet-add-question" variant="secondary" icon="plus" onClick={addBlankQuestion}>Add question</Button>
            </div>
            <PrintablePaper metadata={metadata} paper={paper} kind="question" />
            <PrintablePaper metadata={metadata} paper={paper} kind="answer" />
            {showFigurePicker ? (
              <FigurePicker
                api={api}
                sources={figureSources}
                questions={paper.questions.map((question, index) => ({
                  id: question.id,
                  label: `${index + 1}. ${question.prompt.slice(0, 60)}`,
                }))}
                onAttach={attachFigure}
                onClose={() => setShowFigurePicker(false)}
              />
            ) : null}
          </>
        ) : (
          <div className="worksheet-canvas">
            <article className="worksheet-page worksheet-blank">
              <header className="worksheet-header">
                {metadata.headerText ? <p className="worksheet-custom-header">{metadata.headerText}</p> : null}
                <h1>{metadata.title}</h1>
                <strong>{metadata.subject}</strong>
                <p>{boardName(metadata.board)}{metadata.syllabusCode ? ` | Syllabus ${metadata.syllabusCode}` : ""}</p>
              </header>
              <div className="paper-blank-message">
                <span className="eyebrow">Blank paper</span>
                <h3>Your questions will appear here.</h3>
                <p>Choose what the AI should use in Feed, or add a question by hand.</p>
                <div>
                  <Button variant="primary" onClick={() => setWorkspaceSection("feed")}>Open feed</Button>
                  <Button variant="secondary" icon="plus" onClick={addBlankQuestion}>Add question</Button>
                </div>
              </div>
              {metadata.footerText ? <footer className="worksheet-custom-footer">{metadata.footerText}</footer> : null}
            </article>
          </div>
        )}
        {busy ? (
          <div className="paper-generation-overlay" role="status" aria-live="polite">
            <span className="paper-loading-spinner" />
            <strong>{generationStage || "Creating paper"}</strong>
            <small>This may take a minute. The paper is checked before it is saved.</small>
          </div>
        ) : null}
      </section> : null}
    </div>
  );
}
