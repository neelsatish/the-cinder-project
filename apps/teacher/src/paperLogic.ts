import type { PaperSourceCitation } from "./paperLibrary";

export type ExamBoard = "CIE" | "IGCSE" | "CBSE" | "ICSE";
export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

export const PAPER_OUTPUT_TOKEN_OPTIONS = [
  { value: 512, label: "512 - Smoke test" },
  { value: 1_024, label: "1,024 - Small test" },
  { value: 2_048, label: "2,048 - Economy" },
  { value: 4_096, label: "4,096 - Balanced" },
  { value: 8_192, label: "8,192 - Full paper" },
] as const;

export const DEFAULT_PAPER_OUTPUT_TOKENS = 4_096;

export function normalizePaperOutputTokens(value: unknown) {
  const numeric = Number(value);
  return PAPER_OUTPUT_TOKEN_OPTIONS.some((option) => option.value === numeric)
    ? numeric
    : DEFAULT_PAPER_OUTPUT_TOKENS;
}

export type PaperDiagram = {
  imageDataUrl: string;
  caption: string;
  alt: string;
};

export type PaperSubpart = {
  label: string;
  prompt: string;
  marks: number;
  answer: string;
  workingLines: number;
};

export type PaperQuestion = {
  id: string;
  prompt: string;
  marks: number;
  answer: string;
  workingLines: number;
  subparts: PaperSubpart[];
  diagram: PaperDiagram | null;
  source: string;
};

export type GeneratedPaper = {
  instructions: string[];
  questions: PaperQuestion[];
};

export type PaperMetadata = {
  title: string;
  subject: string;
  board: ExamBoard;
  syllabusCode: string;
  year: string;
  session: string;
  paperVariant: string;
  durationMinutes: number;
  sources: PaperSourceCitation[];
};

const BOARD_NAMES: Record<ExamBoard, string> = {
  CIE: "Cambridge International AS & A Level (CIE)",
  IGCSE: "Cambridge IGCSE",
  CBSE: "CBSE",
  ICSE: "CISCE / ICSE",
};

const DIFFICULTY_NAMES: Record<DifficultyLevel, string> = {
  1: "Foundation",
  2: "Developing",
  3: "Exam standard",
  4: "Advanced",
  5: "Stretch",
};

export function boardName(board: ExamBoard) {
  return BOARD_NAMES[board];
}

export function difficultyName(level: DifficultyLevel) {
  return DIFFICULTY_NAMES[level];
}

export function compactPageRanges(pages: number[]) {
  const sorted = [...new Set(pages)].sort((left, right) => left - right);
  if (!sorted.length) return "";
  const ranges: string[] = [];
  let start = sorted[0];
  let end = sorted[0];
  for (const page of sorted.slice(1)) {
    if (page === end + 1) {
      end = page;
      continue;
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    start = page;
    end = page;
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return `${sorted.length === 1 ? "p." : "pp."} ${ranges.join(", ")}`;
}

export function sourceSummary(sources: PaperSourceCitation[]) {
  return sources
    .map((source) => {
      const pages = compactPageRanges(source.pages);
      return pages ? `${source.name} (${pages})` : source.name;
    })
    .join("; ");
}

function cleanModelText(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value
    .replace(/\[(?:CINDER_QUESTIONS|CINDER_ANSWER_KEY|WORKING_SPACE)\]/gi, "")
    .replace(/^```(?:json|text|markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/__+/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function numeric(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function safeId(index: number) {
  return `question-${index + 1}`;
}

const ALLOWED_SVG_TAGS = new Set([
  "svg",
  "g",
  "line",
  "rect",
  "circle",
  "ellipse",
  "polyline",
  "polygon",
  "path",
  "text",
]);

export function sanitizeDiagramSvg(value: unknown) {
  if (typeof value !== "string") return "";
  let svg = value.trim().slice(0, 24_000);
  if (!/^<svg\b/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) return "";
  if (/<!doctype|<\?xml|<script|<style|<foreignObject|<image|<use|<a\b|<iframe|<object|<embed/i.test(svg)) {
    return "";
  }
  const tags = [...svg.matchAll(/<\/?\s*([a-zA-Z][\w:-]*)\b/g)].map((match) =>
    match[1].toLowerCase(),
  );
  if (tags.some((tag) => !ALLOWED_SVG_TAGS.has(tag))) return "";
  if (/\bon[a-z]+\s*=|\b(?:href|xlink:href|src|style)\s*=|url\s*\(|javascript:|data:/i.test(svg)) {
    return "";
  }
  svg = svg
    .replace(/<!--[^]*?-->/g, "")
    .replace(/\s(?:width|height|xmlns)\s*=\s*["'][^"']*["']/gi, "")
    .replace(
      /^<svg\b/i,
      '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="360"',
    );
  if (!/\bviewBox\s*=/.test(svg.slice(0, svg.indexOf(">") + 1))) {
    svg = svg.replace(/^<svg\b/i, '<svg viewBox="0 0 720 360"');
  }
  return svg;
}

export function sanitizeDiagramImageDataUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 7_000_000) return "";
  const dataUrl = value.trim();
  if (!/^data:image\/(?:png|jpeg);base64,[a-z0-9+/]+={0,2}$/i.test(dataUrl)) return "";
  return dataUrl;
}

function normalizeSubparts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((item, index): PaperSubpart[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    const prompt = cleanModelText(candidate.prompt ?? candidate.question).slice(0, 4_000);
    if (!prompt) return [];
    return [
      {
        label: cleanModelText(candidate.label, String.fromCharCode(97 + index)).slice(0, 5),
        prompt,
        marks: numeric(candidate.marks, 1, 1, 50),
        answer: cleanModelText(candidate.answer).slice(0, 8_000),
        workingLines: numeric(candidate.working_lines ?? candidate.workingLines, 3, 0, 12),
      },
    ];
  });
}

function normalizeDiagram(value: unknown): PaperDiagram | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const imageDataUrl = sanitizeDiagramImageDataUrl(
    candidate.imageDataUrl ?? candidate.image_data_url,
  );
  if (!imageDataUrl) return null;
  return {
    imageDataUrl,
    caption: cleanModelText(candidate.caption).slice(0, 240),
    alt: cleanModelText(candidate.alt, "Question diagram").slice(0, 240),
  };
}

export function normalizeGeneratedPaper(value: unknown): GeneratedPaper {
  if (Array.isArray(value)) value = { questions: value };
  if (!value || typeof value !== "object") {
    throw new Error("The AI response did not contain a paper specification.");
  }
  const root = value as Record<string, unknown>;
  const nested = root.paper ?? root.question_paper ?? root.questionPaper ?? root.data;
  const candidate = nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : root;
  if (!Array.isArray(candidate.questions)) {
    throw new Error("The AI response did not contain a questions list.");
  }
  const questions = candidate.questions.slice(0, 50).flatMap((item, index): PaperQuestion[] => {
    if (!item || typeof item !== "object") return [];
    const question = item as Record<string, unknown>;
    const prompt = cleanModelText(question.prompt ?? question.question).slice(0, 8_000);
    if (!prompt) return [];
    const subparts = normalizeSubparts(question.subparts ?? question.parts);
    const marks = subparts.length
      ? subparts.reduce((total, part) => total + part.marks, 0)
      : numeric(question.marks, 1, 1, 100);
    return [
      {
        id: cleanModelText(question.id, safeId(index)).slice(0, 80) || safeId(index),
        prompt,
        marks,
        answer: cleanModelText(question.answer).slice(0, 12_000),
        workingLines: numeric(
          question.working_lines ?? question.workingLines,
          marks >= 5 ? 6 : marks >= 3 ? 4 : 2,
          0,
          14,
        ),
        subparts,
        diagram: normalizeDiagram(question.diagram),
        source: cleanModelText(question.source).slice(0, 300),
      },
    ];
  });
  if (!questions.length) throw new Error("The AI response did not contain usable questions.");
  const instructions = Array.isArray(candidate.instructions)
    ? candidate.instructions
        .map((item) => cleanModelText(item).slice(0, 1_000))
        .filter(Boolean)
        .slice(0, 12)
    : [];
  return { instructions, questions };
}

function extractJsonObject(value: string) {
  const cleaned = value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The AI did not return structured paper data.");
  return cleaned.slice(start, end + 1);
}

function repairCommonJsonIssues(value: string) {
  let repaired = "";
  let inString = false;
  let escaped = false;
  for (const character of value) {
    if (!inString) {
      if (character === '"') inString = true;
      repaired += character;
      continue;
    }
    if (escaped) {
      if ('"\\/bfnrtu'.includes(character)) {
        repaired += `\\${character}`;
      } else {
        repaired += `\\\\${character}`;
      }
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = false;
      repaired += character;
      continue;
    }
    if (character === "\n") repaired += "\\n";
    else if (character === "\r") repaired += "\\r";
    else if (character === "\t") repaired += "\\t";
    else repaired += character;
  }
  if (escaped) repaired += "\\\\";
  return repaired.replace(/,\s*([}\]])/g, "$1");
}

export function parseGeneratedPaperResponse(value: string) {
  let json: string;
  try {
    json = extractJsonObject(value);
  } catch {
    throw new Error("The AI returned malformed paper data. Try creating the paper again.");
  }
  try {
    return normalizeGeneratedPaper(JSON.parse(json));
  } catch (failure) {
    if (failure instanceof Error && /AI response|questions|paper specification/.test(failure.message)) {
      throw failure;
    }
    try {
      return normalizeGeneratedPaper(JSON.parse(repairCommonJsonIssues(json)));
    } catch {
      throw new Error("The AI returned malformed paper data. Try creating the paper again.");
    }
  }
}

export function paperTotalMarks(paper: GeneratedPaper) {
  return paper.questions.reduce((total, question) => total + question.marks, 0);
}

function metadataLines(metadata: PaperMetadata) {
  const details = [
    boardName(metadata.board),
    metadata.syllabusCode ? `Syllabus ${metadata.syllabusCode}` : "",
    metadata.year ? metadata.year : "",
    metadata.session ? metadata.session : "",
    metadata.paperVariant ? `Paper ${metadata.paperVariant}` : "",
  ].filter(Boolean);
  return [
    metadata.title.trim() || "Question paper",
    metadata.subject.trim(),
    details.join(" | "),
    metadata.durationMinutes > 0 ? `Time allowed: ${metadata.durationMinutes} minutes` : "",
    metadata.sources.length ? `Sources: ${sourceSummary(metadata.sources)}` : "",
  ].filter(Boolean);
}

export function questionPaperText(metadata: PaperMetadata, paper: GeneratedPaper) {
  const lines = [...metadataLines(metadata)];
  if (paper.instructions.length) {
    lines.push("", "Instructions", ...paper.instructions.map((item) => `- ${item}`));
  }
  paper.questions.forEach((question, index) => {
    lines.push("", `${index + 1}. ${question.prompt} [${question.marks}]`);
    if (question.diagram) {
      lines.push(`[Diagram: ${question.diagram.caption || question.diagram.alt}]`);
    }
    question.subparts.forEach((part) => {
      lines.push(`   (${part.label}) ${part.prompt} [${part.marks}]`);
      for (let line = 0; line < part.workingLines; line += 1) lines.push("");
    });
    if (!question.subparts.length) {
      for (let line = 0; line < question.workingLines; line += 1) lines.push("");
    }
  });
  return lines.join("\n").trim();
}

export function answerKeyText(metadata: PaperMetadata, paper: GeneratedPaper) {
  const lines = [
    `${metadata.title.trim() || "Question paper"} - Answer key`,
    metadata.subject.trim(),
    boardName(metadata.board),
  ].filter(Boolean);
  paper.questions.forEach((question, index) => {
    lines.push(
      "",
      question.subparts.length
        ? `${index + 1}. ${question.prompt} [${question.marks}]`
        : `${index + 1}. ${question.answer || "No answer supplied."} [${question.marks}]`,
    );
    question.subparts.forEach((part) => {
      lines.push(`   (${part.label}) ${part.answer || "No answer supplied."} [${part.marks}]`);
    });
    if (question.source) lines.push(`   Source note: ${question.source}`);
  });
  return lines.join("\n").trim();
}

export function legacyPaperToSpec(questionText: string, answerText: string): GeneratedPaper {
  const answerLines = answerText.split(/\r?\n/);
  const answers = new Map<number, string>();
  answerLines.forEach((line) => {
    const match = /^\s*(\d{1,3})[).:\-|]\s*(.+?)\s*$/.exec(line);
    if (match) answers.set(Number(match[1]), cleanModelText(match[2]));
  });
  const questions: PaperQuestion[] = [];
  questionText.split(/\r?\n/).forEach((line) => {
    const table = /^\s*\|?\s*(\d{1,3})\s*\|\s*(\d{1,3})\s*\|\s*(.+?)\s*\|?\s*$/.exec(line);
    const plain = /^\s*(?:question\s*)?(\d{1,3})[).:]\s*(.+?)(?:\s*\[(\d{1,3})\])?\s*$/.exec(line);
    const match = table ?? plain;
    if (!match) return;
    const number = Number(match[1]);
    const marks = table ? Number(match[2]) : numeric(match[3], 1, 1, 100);
    const prompt = cleanModelText(table ? match[3] : match[2]);
    if (!prompt || /^marks|question$/i.test(prompt)) return;
    questions.push({
      id: safeId(questions.length),
      prompt,
      marks,
      answer: answers.get(number) ?? "",
      workingLines: marks >= 5 ? 6 : marks >= 3 ? 4 : 2,
      subparts: [],
      diagram: null,
      source: "",
    });
  });
  if (questions.length) return { instructions: [], questions };
  const cleaned = cleanModelText(questionText)
    .split(/\r?\n/)
    .filter((line) => line.trim() && !/^sources?:|^subject:|^student section/i.test(line))
    .join(" ")
    .slice(0, 8_000);
  return {
    instructions: [],
    questions: cleaned
      ? [{
          id: safeId(0),
          prompt: cleaned,
          marks: 1,
          answer: cleanModelText(answerText),
          workingLines: 3,
          subparts: [],
          diagram: null,
          source: "",
        }]
      : [],
  };
}

export function officialSourceUrl(
  board: ExamBoard,
  syllabusCode: string,
  subject: string,
  year: string,
) {
  const query = encodeURIComponent(
    [syllabusCode, subject, year, "past papers specimen"].filter(Boolean).join(" "),
  );
  if (board === "CIE" || board === "IGCSE") {
    return `https://www.cambridgeinternational.org/search-results/?query=${query}`;
  }
  if (board === "CBSE") return "https://cbseacademic.nic.in/sqp_archive.html";
  return `https://cisce.org/?s=${query}`;
}

export function difficultyPrompt(level: DifficultyLevel) {
  if (level === 1) return "Use direct recall and one-step applications, but avoid trivial arithmetic repetition.";
  if (level === 2) return "Use familiar contexts with two-step reasoning and a balanced mix of knowledge and application.";
  if (level === 3) return "Match real board-exam demand: multi-step application, data interpretation and precise command words; keep pure recall below 30 percent.";
  if (level === 4) return "Use unfamiliar contexts, linked concepts, explanation and evaluation at the upper end of the selected board's normal demand.";
  return "Create stretch questions above routine exam demand, requiring synthesis, assumptions, justification and error analysis while remaining inside the syllabus.";
}
