import assert from "node:assert/strict";
import test from "node:test";
import {
  addWorkingSpace,
  compactPageRanges,
  composeAnswerKey,
  composeQuestionPaper,
  splitPaperResponse,
} from "../apps/teacher/src/paperLogic.ts";
import { createPaperPdf } from "../apps/teacher/src/paperExport.ts";

test("separates student questions from the teacher answer key", () => {
  const result = splitPaperResponse(`
[CINDER_QUESTIONS]
1. Explain photosynthesis. [4 marks]
[WORKING_SPACE]
[CINDER_ANSWER_KEY]
1. Plants convert light energy into chemical energy.
`);
  assert.match(result.questionText, /Explain photosynthesis/);
  assert.doesNotMatch(result.questionText, /convert light energy/);
  assert.match(result.answerKeyText, /convert light energy/);
});

test("accepts a conventional answer-key heading as a fallback", () => {
  const result = splitPaperResponse(`Question Paper\n1. Add 2 + 2.\n\nAnswer Key\n1. 4`);
  assert.match(result.questionText, /Add 2 \+ 2/);
  assert.equal(result.answerKeyText, "1. 4");
});

test("adds printable working space between questions", () => {
  const spaced = addWorkingSpace("1. First question\n2. Second question");
  assert.match(spaced, /First question\n\n\n\n2\. Second question/);
  assert.match(spaced, /Second question\n\n\n$/);
});

test("keeps source page citations compact and visible at the top", () => {
  assert.equal(compactPageRanges([1, 2, 3, 5, 8, 9]), "pp. 1–3, 5, 8–9");
  const paper = composeQuestionPaper(
    "Science assessment",
    "Grade 8 Science",
    [{ name: "Plants.pdf", pages: [2, 3, 4] }],
    "1. Explain transpiration.\n[WORKING_SPACE]",
  );
  assert.match(paper, /^Science assessment\nSubject: Grade 8 Science\nSources: Plants\.pdf \(pp\. 2–4\)/);
});

test("labels the answer key as a separate teacher copy", () => {
  const key = composeAnswerKey("Science assessment", "1. Stomata.");
  assert.match(key, /^Science assessment — Answer key/);
  assert.match(key, /Teacher copy/);
});

test("creates a real downloadable PDF document", async () => {
  const bytes = await createPaperPdf({
    title: "Science assessment",
    documentLabel: "Question paper",
    text: "Science assessment\nSources: Plants.pdf (pp. 2–4)\n\n1. Explain transpiration.\n\n\n",
  });
  assert.ok(bytes.length > 500);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
});
