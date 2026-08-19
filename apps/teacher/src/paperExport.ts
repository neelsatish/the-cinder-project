import type { GeneratedPaper, PaperDiagram, PaperMetadata, PaperQuestion } from "./paperLogic.ts";
import { boardName, sourceSummary } from "./paperLogic.ts";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PAGE_MARGIN = 52;
const CONTENT_BOTTOM = 48;

type PdfOptions = {
  metadata: PaperMetadata;
  paper: GeneratedPaper;
  kind: "question" | "answer";
};

const CHARACTER_REPLACEMENTS: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2026": "...",
  "\u2022": "-",
  "\u00d7": "x",
  "\u00f7": "/",
  "\u2264": "<=",
  "\u2265": ">=",
  "\u2260": "!=",
  "\u00b1": "+/-",
  "\u20b9": "Rs.",
  "\u03a9": "ohm",
  "\u03b1": "alpha",
  "\u03b2": "beta",
  "\u03b3": "gamma",
  "\u03b4": "delta",
  "\u03b8": "theta",
  "\u03bb": "lambda",
  "\u03bc": "mu",
  "\u03c0": "pi",
  "\u03c3": "sigma",
  "\u03c6": "phi",
  "\u03c9": "omega",
  "\u00b2": "^2",
  "\u00b3": "^3",
};

function pdfSafeText(value: string) {
  const replaced = Array.from(value, (character) =>
    CHARACTER_REPLACEMENTS[character] ?? character,
  ).join("");
  return replaced
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e\u00b0]/g, "?");
}

function wrapLine(
  value: string,
  maxWidth: number,
  font: { widthOfTextAtSize: (text: string, size: number) => number },
  size: number,
) {
  const words = pdfSafeText(value).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      continue;
    }
    let fragment = "";
    for (const character of word) {
      const candidateFragment = fragment + character;
      if (font.widthOfTextAtSize(candidateFragment, size) > maxWidth && fragment) {
        lines.push(fragment);
        fragment = character;
      } else {
        fragment = candidateFragment;
      }
    }
    line = fragment;
  }
  if (line) lines.push(line);
  return lines;
}

async function diagramToPng(diagram: PaperDiagram) {
  if (typeof document === "undefined") return null;
  const image = new Image();
  image.decoding = "sync";
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("The source diagram could not be rendered."));
  });
  image.src = diagram.imageDataUrl;
  await loaded;
  const naturalWidth = Math.max(1, image.naturalWidth || image.width);
  const naturalHeight = Math.max(1, image.naturalHeight || image.height);
  const scale = Math.min(2, 1440 / naturalWidth, 1440 / naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

export async function createPaperPdf({ metadata, paper, kind }: PdfOptions) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(pdfSafeText(kind === "answer" ? `${metadata.title} - Answer key` : metadata.title));
  pdf.setSubject(pdfSafeText(kind === "answer" ? "Answer key" : "Question paper"));
  pdf.setCreator("Teacher worksheet");

  let page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - PAGE_MARGIN;
  const contentWidth = A4_WIDTH - PAGE_MARGIN * 2;

  const newPage = () => {
    page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
    y = A4_HEIGHT - PAGE_MARGIN;
  };

  const ensureSpace = (height: number) => {
    if (y - height < CONTENT_BOTTOM) newPage();
  };

  const drawWrapped = (
    value: string,
    options: {
      x?: number;
      width?: number;
      size?: number;
      lineHeight?: number;
      strong?: boolean;
      color?: ReturnType<typeof rgb>;
      gapAfter?: number;
    } = {},
  ) => {
    const x = options.x ?? PAGE_MARGIN;
    const width = options.width ?? contentWidth;
    const size = options.size ?? 10.5;
    const lineHeight = options.lineHeight ?? size * 1.42;
    const font = options.strong ? bold : regular;
    const lines = wrapLine(value, width, font, size);
    ensureSpace(lines.length * lineHeight + (options.gapAfter ?? 0));
    lines.forEach((line) => {
      page.drawText(line, {
        x,
        y,
        size,
        font,
        color: options.color ?? rgb(0.08, 0.08, 0.08),
      });
      y -= lineHeight;
    });
    y -= options.gapAfter ?? 0;
  };

  const wrappedHeight = (
    value: string,
    options: {
      width?: number;
      size?: number;
      lineHeight?: number;
      strong?: boolean;
      gapAfter?: number;
    } = {},
  ) => {
    const size = options.size ?? 10.5;
    const lineHeight = options.lineHeight ?? size * 1.42;
    const font = options.strong ? bold : regular;
    return (
      wrapLine(value, options.width ?? contentWidth, font, size).length * lineHeight
      + (options.gapAfter ?? 0)
    );
  };

  const title = kind === "answer" ? `${metadata.title} - Answer key` : metadata.title;
  drawWrapped(title || "Question paper", { size: 19, lineHeight: 23, strong: true, gapAfter: 5 });
  drawWrapped(metadata.subject, { size: 11, strong: true, gapAfter: 2 });
  const boardDetails = [
    boardName(metadata.board),
    metadata.syllabusCode ? `Syllabus ${metadata.syllabusCode}` : "",
    metadata.year,
    metadata.session,
    metadata.paperVariant ? `Paper ${metadata.paperVariant}` : "",
  ].filter(Boolean);
  drawWrapped(boardDetails.join(" | "), { size: 8.8, color: rgb(0.28, 0.28, 0.28) });
  if (kind === "question" && metadata.durationMinutes > 0) {
    drawWrapped(`Time allowed: ${metadata.durationMinutes} minutes`, { size: 8.8 });
  }
  if (metadata.sources.length) {
    drawWrapped(`Sources: ${sourceSummary(metadata.sources)}`, {
      size: 8,
      lineHeight: 11,
      color: rgb(0.3, 0.3, 0.3),
      gapAfter: 6,
    });
  } else {
    y -= 7;
  }
  page.drawLine({
    start: { x: PAGE_MARGIN, y },
    end: { x: A4_WIDTH - PAGE_MARGIN, y },
    thickness: 0.75,
    color: rgb(0.7, 0.7, 0.7),
  });
  y -= 15;

  if (kind === "question" && paper.instructions.length) {
    drawWrapped("Instructions", { size: 10, strong: true, gapAfter: 2 });
    paper.instructions.forEach((instruction) =>
      drawWrapped(`- ${instruction}`, { x: PAGE_MARGIN + 8, width: contentWidth - 8, size: 9.3 }),
    );
    y -= 8;
  }

  const drawMark = (marks: number, baseline: number) => {
    const label = `[${marks}]`;
    const size = 9.5;
    page.drawText(label, {
      x: A4_WIDTH - PAGE_MARGIN - bold.widthOfTextAtSize(label, size),
      y: baseline,
      size,
      font: bold,
      color: rgb(0.08, 0.08, 0.08),
    });
  };

  const drawQuestion = async (question: PaperQuestion, index: number) => {
    const promptHeight = wrappedHeight(question.prompt, {
      width: contentWidth - 70,
      size: 10.5,
      lineHeight: 15,
      gapAfter: 5,
    });
    let estimatedHeight = promptHeight + 9;
    if (question.diagram) {
      estimatedHeight += 215;
      if (question.diagram.caption) {
        estimatedHeight += wrappedHeight(question.diagram.caption, {
          width: contentWidth - 60,
          size: 8,
          lineHeight: 10,
          gapAfter: 4,
        });
      }
    }
    if (kind === "answer" && !question.subparts.length) {
      estimatedHeight += wrappedHeight(question.answer || "No answer supplied.", {
        width: contentWidth - 24,
        size: 9.8,
        gapAfter: 4,
      });
    }
    for (const part of question.subparts) {
      estimatedHeight += wrappedHeight(
        kind === "answer" ? part.answer || "No answer supplied." : part.prompt,
        {
          width: contentWidth - 96,
          size: 10,
          lineHeight: 14.2,
          gapAfter: 4,
        },
      );
      if (kind === "question") estimatedHeight += part.workingLines * 18;
    }
    if (!question.subparts.length && kind === "question") {
      estimatedHeight += question.workingLines * 18;
    }
    if (kind === "answer" && question.source) {
      estimatedHeight += wrappedHeight(`Source note: ${question.source}`, {
        width: contentWidth - 24,
        size: 8,
      });
    }
    const pageCapacity = A4_HEIGHT - PAGE_MARGIN - CONTENT_BOTTOM;
    ensureSpace(
      estimatedHeight <= pageCapacity
        ? estimatedHeight
        : Math.max(80, promptHeight + 20),
    );
    const startY = y;
    const label = `${index + 1}.`;
    page.drawText(label, { x: PAGE_MARGIN, y, size: 11, font: bold });
    drawMark(question.marks, y);
    drawWrapped(question.prompt, {
      x: PAGE_MARGIN + 24,
      width: contentWidth - 70,
      size: 10.5,
      lineHeight: 15,
      gapAfter: 5,
    });
    if (question.diagram) {
      try {
        const png = await diagramToPng(question.diagram);
        if (png) {
          const image = await pdf.embedPng(png);
          const dimensions = image.scaleToFit(Math.min(370, contentWidth - 40), 185);
          ensureSpace(dimensions.height + 26);
          const x = PAGE_MARGIN + (contentWidth - dimensions.width) / 2;
          page.drawImage(image, {
            x,
            y: y - dimensions.height,
            width: dimensions.width,
            height: dimensions.height,
          });
          y -= dimensions.height + 5;
          if (question.diagram.caption) {
            drawWrapped(question.diagram.caption, {
              x: PAGE_MARGIN + 30,
              width: contentWidth - 60,
              size: 8,
              lineHeight: 10,
              color: rgb(0.3, 0.3, 0.3),
              gapAfter: 4,
            });
          }
        }
      } catch {
        drawWrapped(`Diagram: ${question.diagram.alt}`, { size: 8.5, gapAfter: 4 });
      }
    }

    if (kind === "answer" && !question.subparts.length) {
      drawWrapped(question.answer || "No answer supplied.", {
        x: PAGE_MARGIN + 24,
        width: contentWidth - 24,
        size: 9.8,
        gapAfter: 4,
      });
    }

    for (const part of question.subparts) {
      const partText = kind === "answer" ? part.answer || "No answer supplied." : part.prompt;
      ensureSpace(
        wrappedHeight(partText, {
          width: contentWidth - 96,
          size: 10,
          lineHeight: 14.2,
          gapAfter: 4,
        }) + (kind === "question" && part.workingLines ? 18 : 0),
      );
      const partY = y;
      page.drawText(`(${pdfSafeText(part.label)})`, {
        x: PAGE_MARGIN + 24,
        y,
        size: 10,
        font: regular,
      });
      drawMark(part.marks, partY);
      drawWrapped(partText, {
        x: PAGE_MARGIN + 50,
        width: contentWidth - 96,
        size: 10,
        lineHeight: 14.2,
        gapAfter: 4,
      });
      if (kind === "question") {
        for (let line = 0; line < part.workingLines; line += 1) {
          ensureSpace(18);
          y -= 12;
          page.drawLine({
            start: { x: PAGE_MARGIN + 50, y },
            end: { x: A4_WIDTH - PAGE_MARGIN, y },
            thickness: 0.35,
            color: rgb(0.78, 0.78, 0.78),
          });
          y -= 6;
        }
      }
    }

    if (!question.subparts.length && kind === "question") {
      for (let line = 0; line < question.workingLines; line += 1) {
        ensureSpace(18);
        y -= 12;
        page.drawLine({
          start: { x: PAGE_MARGIN + 24, y },
          end: { x: A4_WIDTH - PAGE_MARGIN, y },
          thickness: 0.35,
          color: rgb(0.78, 0.78, 0.78),
        });
        y -= 6;
      }
    }
    if (kind === "answer" && question.source) {
      drawWrapped(`Source note: ${question.source}`, {
        x: PAGE_MARGIN + 24,
        width: contentWidth - 24,
        size: 8,
        color: rgb(0.35, 0.35, 0.35),
      });
    }
    y -= startY === y ? 14 : 9;
  };

  for (const [index, question] of paper.questions.entries()) {
    await drawQuestion(question, index);
  }

  const pages = pdf.getPages();
  pages.forEach((pdfPage, index) => {
    const footer = `${index + 1} of ${pages.length}`;
    pdfPage.drawText(footer, {
      x: A4_WIDTH - PAGE_MARGIN - regular.widthOfTextAtSize(footer, 8),
      y: 24,
      size: 8,
      font: regular,
      color: rgb(0.42, 0.42, 0.42),
    });
  });

  return pdf.save();
}
