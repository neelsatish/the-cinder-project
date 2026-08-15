import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  compactPageRanges,
  difficultyPrompt,
  legacyPaperToSpec,
  paperTotalMarks,
  parseGeneratedPaperResponse,
  questionPaperText,
  answerKeyText,
  sanitizeDiagramSvg,
} from "../apps/teacher/src/paperLogic.ts";
import { createPaperPdf } from "../apps/teacher/src/paperExport.ts";

const metadata = {
  title: "Physics practice paper",
  subject: "AS Physics",
  board: "CIE",
  syllabusCode: "9702",
  year: "2026",
  session: "May/June",
  paperVariant: "22",
  durationMinutes: 60,
  sources: [{ name: "9702_s26_qp_22.pdf", pages: [2, 3, 4] }],
};

const paper = {
  instructions: ["Answer every question.", "Show all working."],
  questions: [
    {
      id: "q1",
      prompt: "A particle accelerates uniformly. Calculate its final speed.",
      marks: 4,
      answer: "Use v = u + at to obtain 14 m/s.",
      workingLines: 5,
      source: "9702_s26_qp_22.pdf, p. 2, Q1 (adapted)",
      subparts: [],
      diagram: null,
    },
  ],
};

test("parses and cleans a structured model response", () => {
  const parsed = parseGeneratedPaperResponse(`\`\`\`json
  {"instructions":["Show **working**"],"questions":[{"id":"q1","prompt":"[CINDER_QUESTIONS] Find the force.","marks":3,"answer":"6 N","working_lines":4,"source":"Paper.pdf, p. 2","subparts":[],"diagram":null}]}
  \`\`\``);
  assert.equal(parsed.questions.length, 1);
  assert.equal(parsed.questions[0].prompt, "Find the force.");
  assert.equal(parsed.instructions[0], "Show working");
  assert.equal(paperTotalMarks(parsed), 3);
});

test("rejects malformed free-form model output", () => {
  assert.throws(
    () => parseGeneratedPaperResponse("[CINDER_QUESTIONS]\n| 1 | 2 | Easy question |"),
    /malformed paper data/,
  );
});

test("repairs common model JSON mistakes without losing the paper", () => {
  const parsed = parseGeneratedPaperResponse(`{
    "instructions": ["Use the relation \\q = mc delta T",],
    "questions": [{
      "id": "q1",
      "prompt": "State the result.\nInclude units.",
      "marks": 2,
      "answer": "42 J",
      "working_lines": 2,
      "subparts": [],
      "diagram": null,
    }],
  }`);
  assert.equal(parsed.questions.length, 1);
  assert.match(parsed.questions[0].prompt, /Include units/);
  assert.match(parsed.instructions[0], /\\q/);
});

test("difficulty instructions scale materially", () => {
  assert.match(difficultyPrompt(1), /direct recall/i);
  assert.match(difficultyPrompt(3), /board-exam demand/i);
  assert.match(difficultyPrompt(5), /synthesis/i);
  assert.notEqual(difficultyPrompt(1), difficultyPrompt(5));
});

test("sanitizes diagrams and rejects active SVG content", () => {
  const safe = sanitizeDiagramSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><line x1="0" y1="0" x2="100" y2="50" stroke="black"/></svg>');
  assert.match(safe, /^<svg /);
  assert.match(safe, /width="720"/);
  assert.equal((safe.match(/xmlns=/g) ?? []).length, 1);
  assert.equal(sanitizeDiagramSvg('<svg><script>alert(1)</script></svg>'), "");
  assert.equal(sanitizeDiagramSvg('<svg><image href="https://example.com/a.png"/></svg>'), "");
});

test("migrates a legacy markdown-style paper without leaking table syntax", () => {
  const migrated = legacyPaperToSpec(
    "WS1\n| 1 | 4 | Explain momentum. |\n| 2 | 3 | Calculate the force. |",
    "1. Mass multiplied by velocity.\n2. 12 N.",
  );
  assert.equal(migrated.questions.length, 2);
  assert.equal(migrated.questions[0].marks, 4);
  assert.doesNotMatch(migrated.questions[0].prompt, /\|/);
});

test("keeps citations compact and question and answer content separate", () => {
  assert.equal(compactPageRanges([1, 2, 3, 5, 8, 9]), "pp. 1-3, 5, 8-9");
  const questions = questionPaperText(metadata, paper);
  const answers = answerKeyText(metadata, paper);
  assert.match(questions, /A particle accelerates uniformly/);
  assert.doesNotMatch(questions, /14 m\/s/);
  assert.match(answers, /14 m\/s/);
  assert.match(questions, /9702_s26_qp_22\.pdf \(pp\. 2-4\)/);
  assert.doesNotMatch(questions, /Cinder/i);
});

test("creates separate, unbranded PDF documents", async () => {
  const questionBytes = await createPaperPdf({ metadata, paper, kind: "question" });
  const answerBytes = await createPaperPdf({ metadata, paper, kind: "answer" });
  assert.ok(questionBytes.length > 500);
  assert.ok(answerBytes.length > 500);
  assert.equal(new TextDecoder().decode(questionBytes.slice(0, 5)), "%PDF-");
  assert.equal(new TextDecoder().decode(answerBytes.slice(0, 5)), "%PDF-");
  assert.doesNotMatch(new TextDecoder().decode(questionBytes), /Cinder/i);
  assert.doesNotMatch(new TextDecoder().decode(answerBytes), /Cinder/i);
});

test("paginates a long paper across A4 sheets", async () => {
  const longPaper = {
    ...paper,
    questions: Array.from({ length: 12 }, (_, index) => ({
      ...paper.questions[0],
      id: `q${index + 1}`,
      prompt: index % 3 === 0
        ? "Explain the measurements, calculation and one precaution needed for a reliable motion experiment."
        : "Calculate the result and include its unit.",
      workingLines: index % 3 === 0 ? 8 : 4,
    })),
  };
  const bytes = await createPaperPdf({ metadata, paper: longPaper, kind: "question" });
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 3);
});
