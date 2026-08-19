import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCellAddress,
  resolveGradebookIntent,
} from "../apps/teacher/src/gradebookIntent.ts";

const roster = [
  { id: "s1", display_name: "Ayaan", username: "Thomas" },
  { id: "s2", display_name: "Daksh Ashu Jain", username: "Daksh" },
];
const assignments = [
  { id: "a1", title: "Poem Submission", max_points: 20 },
  { id: "a2", title: "Essay on Poem", max_points: 100 },
  { id: "a3", title: "Story Writing", max_points: 50 },
];
const workbook = {
  active_sheet: "Gradebook",
  sheets: [
    {
      name: "Gradebook",
      range: "A1:G3",
      values: [
        [
          "Student",
          "Username",
          "Poem Submission / 20",
          "Essay on Poem / 100",
          "Teacher note",
          "Story Writing / 50",
          null,
        ],
        ["Ayaan", "Thomas", 10, null, "", null, null],
        ["Daksh Ashu Jain", "Daksh", 19, 0, "", null, null],
      ],
    },
  ],
};

function fixture(overrides = {}) {
  const grades = new Map([
    ["s1:a1", 10],
    ["s1:a2", null],
    ["s1:a3", null],
    ["s2:a1", 19],
    ["s2:a2", 0],
  ]);
  const submissionFor = (studentId, assignmentId) =>
    grades.has(`${studentId}:${assignmentId}`)
      ? { grade: { points: grades.get(`${studentId}:${assignmentId}`) } }
      : undefined;
  return {
    input: { roster, assignments, workbook, submissionFor, ...overrides },
    grades,
  };
}

test("normalizes reversed spreadsheet coordinates", () => {
  assert.equal(normalizeCellAddress("1F"), "F1");
  assert.equal(normalizeCellAddress(" 2 c "), "C2");
});

test("maps a visible assignment header cell to an assignment update", () => {
  const { input } = fixture();
  const result = resolveGradebookIntent({
    ...input,
    prompt: "CHANGE CELL 1F TO BE STORY WRITING /20",
  });
  assert.deepEqual(result.actions[0], {
    type: "update_assignment",
    assignment_id: "a3",
    title: "Story Writing",
    max_points: 20,
  });
});

test("maps grade cells and percentages to audited points", () => {
  const { input } = fixture();
  const result = resolveGradebookIntent({
    ...input,
    prompt: "set cell 2C to be 75%",
  });
  assert.deepEqual(result.actions[0], {
    type: "set_grade",
    student_id: "s1",
    assignment_id: "a1",
    points: 15,
  });
});

test("interprets 100 points across mixed scales as full marks", () => {
  const { input } = fixture();
  const result = resolveGradebookIntent({
    ...input,
    prompt: "fill in all of Ayaan's grades with 100 points",
  });
  assert.deepEqual(
    result.actions.map((action) => action.points),
    [20, 100, 50],
  );
  assert.match(result.message, /interpreted/i);
});

test("matches a locally known username without cloud interpretation", () => {
  const { input } = fixture();
  const result = resolveGradebookIntent({
    ...input,
    prompt: "give Thomas full marks on every assignment",
  });
  assert.equal(result.actions.length, 3);
});

test("allows explicit custom cells but protects assignment cells", () => {
  const { input } = fixture();
  const result = resolveGradebookIntent({
    ...input,
    prompt: "set E2 to Needs revision",
  });
  assert.deepEqual(result.actions[0], {
    type: "set_cell",
    sheet: "Gradebook",
    cell: "E2",
    value: "Needs revision",
  });
});

test("refuses a new maximum below an existing grade", () => {
  const { input, grades } = fixture();
  grades.set("s1:a3", 30);
  const result = resolveGradebookIntent({
    ...input,
    prompt: "change F1 to Story Writing / 20",
  });
  assert.equal(result.actions.length, 0);
  assert.match(result.message, /existing grade/i);
});
