import type { Assignment, Submission, User } from "@cinder/ui";
import type {
  GradebookAction,
  GradebookAiContext,
  WorkbookCellValue,
} from "./UniverGradebook";

type IntentInput = {
  prompt: string;
  roster: User[];
  assignments: Assignment[];
  workbook: GradebookAiContext | null;
  submissionFor: (
    studentId: string,
    assignmentId: string,
  ) => Submission | undefined;
};

export type GradebookIntent = {
  message: string;
  actions: GradebookAction[];
};

export type GradebookCellTarget =
  | { kind: "identity"; address: string }
  | { kind: "assignment_header"; address: string; assignment: Assignment }
  | {
      kind: "grade";
      address: string;
      assignment: Assignment;
      student: User;
    }
  | { kind: "custom"; address: string };

const normalizeWords = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function normalizeCellAddress(value: string) {
  const compact = value.replace(/[$\s]/g, "").toUpperCase();
  const standard = /^([A-Z]{1,3})([1-9]\d{0,3})$/.exec(compact);
  if (standard) return `${standard[1]}${standard[2]}`;
  const reversed = /^([1-9]\d{0,3})([A-Z]{1,3})$/.exec(compact);
  return reversed ? `${reversed[2]}${reversed[1]}` : null;
}

export function parseCellAddress(value: string) {
  const address = normalizeCellAddress(value);
  if (!address) return null;
  const match = /^([A-Z]{1,3})([1-9]\d{0,3})$/.exec(address)!;
  let column = 0;
  for (const character of match[1]) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  return { address, column: column - 1, row: Number(match[2]) - 1 };
}

export function columnName(column: number) {
  let value = column + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function gradebookValues(workbook: GradebookAiContext | null) {
  return workbook?.sheets.find((sheet) => sheet.name === "Gradebook")?.values;
}

function parseAssignmentHeader(value: unknown) {
  const text = String(value ?? "").trim();
  const match = /^(.*?)\s*\/\s*(\d+(?:\.\d+)?)\s*(?:points?)?$/i.exec(text);
  return match
    ? { title: match[1].trim(), maxPoints: Number(match[2]) }
    : { title: text, maxPoints: null };
}

export function assignmentForHeader(
  value: unknown,
  assignments: Assignment[],
) {
  const parsed = parseAssignmentHeader(value);
  if (!parsed.title) return null;
  const title = normalizeWords(parsed.title);
  const titleMatches = assignments.filter(
    (assignment) => normalizeWords(assignment.title) === title,
  );
  if (titleMatches.length === 1) return titleMatches[0];
  return (
    titleMatches.find(
      (assignment) => assignment.max_points === parsed.maxPoints,
    ) ?? null
  );
}

export function findGradebookAssignmentColumn(
  assignment: Assignment,
  assignments: Assignment[],
  workbook: GradebookAiContext | null,
) {
  const headers = gradebookValues(workbook)?.[0] ?? [];
  const exact = headers.findIndex(
    (header) => assignmentForHeader(header, assignments)?.id === assignment.id,
  );
  if (exact >= 0) return exact;
  return assignments.findIndex((item) => item.id === assignment.id) + 2;
}

export function resolveGradebookCellTarget(
  cell: string,
  roster: User[],
  assignments: Assignment[],
  workbook: GradebookAiContext | null,
): GradebookCellTarget | null {
  const location = parseCellAddress(cell);
  if (!location) return null;
  const values = gradebookValues(workbook) ?? [];
  const header = values[0]?.[location.column];
  let assignment = assignmentForHeader(header, assignments);
  if (!assignment && location.column >= 2) {
    const canonical = assignments[location.column - 2];
    if (canonical && String(header ?? "").trim() === "") assignment = canonical;
  }
  if (location.column <= 1) {
    return { kind: "identity", address: location.address };
  }
  if (location.row === 0 && assignment) {
    return {
      kind: "assignment_header",
      address: location.address,
      assignment,
    };
  }
  if (location.row > 0 && assignment) {
    const username = String(values[location.row]?.[1] ?? "").trim();
    const student =
      roster.find(
        (item) => item.username.toLocaleLowerCase() === username.toLocaleLowerCase(),
      ) ?? roster[location.row - 1];
    if (student) {
      return {
        kind: "grade",
        address: location.address,
        assignment,
        student,
      };
    }
  }
  return { kind: "custom", address: location.address };
}

export function buildGradebookCellMap(
  roster: User[],
  assignments: Assignment[],
  workbook: GradebookAiContext | null,
  includeNames: boolean,
) {
  return {
    coordinate_format: "A1 (column letters first; 1F is normalized to F1)",
    assignment_columns: assignments.map((assignment) => {
      const column = findGradebookAssignmentColumn(
        assignment,
        assignments,
        workbook,
      );
      return {
        assignment_id: assignment.id,
        header_cell: `${columnName(column)}1`,
        title: assignment.title,
        max_points: assignment.max_points,
      };
    }),
    student_rows: roster.map((student, index) => ({
      student_id: student.id,
      row: index + 2,
      name: includeNames ? student.display_name : `Student ${index + 1}`,
      username: includeNames ? student.username : undefined,
    })),
  };
}

function parseCellEdit(prompt: string) {
  const compact = prompt.trim().replace(/\s+/g, " ");
  const match = /\b(?:change|edit|rename|set|update|make|put)\s+(?:the\s+)?(?:cell\s+)?(?:gradebook!)?([a-z]{1,3}\s*\d{1,4}|\d{1,4}\s*[a-z]{1,3})\s+(?:to(?:\s+be)?|as|=)\s+(.+?)\s*[.!]?$/i.exec(
    compact,
  );
  if (!match) return null;
  const cell = normalizeCellAddress(match[1]);
  if (!cell) return null;
  const rawValue = match[2]
    .trim()
    .replace(/^(?:["'“”‘’])|(?:["'“”‘’])$/g, "")
    .trim();
  return rawValue ? { cell, rawValue } : null;
}

function parseWorkbookValue(value: string): WorkbookCellValue {
  if (/^(?:blank|empty|null)$/i.test(value)) return null;
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function pointsForGrade(value: string, assignment: Assignment) {
  if (/^(?:full\s+marks?|maximum|max)$/i.test(value.trim())) {
    return { points: assignment.max_points, interpretation: "full marks" };
  }
  const match = /^(-?\d+(?:\.\d+)?)\s*(%|percent|points?|pts?)?$/i.exec(
    value.trim(),
  );
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (match[2] === "%" || match[2]?.toLocaleLowerCase() === "percent") {
    if (amount > 100) return null;
    return {
      points: Math.round(assignment.max_points * amount) / 100,
      interpretation: `${amount}%`,
    };
  }
  if (amount > assignment.max_points) return null;
  return { points: amount, interpretation: `${amount} points` };
}

function findMentionedStudents(prompt: string, roster: User[]) {
  const normalizedPrompt = ` ${normalizeWords(prompt)} `;
  const matches = roster
    .flatMap((student) =>
      [student.display_name, student.username].map((label) => ({
        student,
        label: normalizeWords(label),
      })),
    )
    .filter(
      ({ label }) =>
        label &&
        new RegExp(`(?:^| )${escapeRegExp(label)}(?: |$)`, "i").test(
          normalizedPrompt,
        ),
    )
    .sort((left, right) => right.label.length - left.label.length);
  return [
    ...new Map(matches.map(({ student }) => [student.id, student])).values(),
  ];
}

function resolveBulkGrades(input: IntentInput): GradebookIntent | null {
  const normalized = normalizeWords(input.prompt);
  const fullMarks = /\b(?:full\s+marks?|maximum|max)\b/.test(normalized);
  if (
    !/\b(?:grades?|scores?|assignments?)\b/.test(normalized) ||
    (!/\b(?:all|every|everything)\b/.test(normalized) && !fullMarks)
  ) {
    return null;
  }
  const mentionedStudents = findMentionedStudents(input.prompt, input.roster);
  if (mentionedStudents.length !== 1) {
    return {
      message:
        mentionedStudents.length > 1
          ? "I recognized a bulk-grade request, but it mentions more than one student. Please make one reviewed request per student."
          : "I recognized a request to change several grades, but I could not match the student name or username to this classroom.",
      actions: [],
    };
  }
  const student = mentionedStudents[0];
  const scoreMatch =
    /\b(?:to(?:\s+be)?|at|with|as)\s+(-?\d+(?:\.\d+)?)\s*(%|percent|points?|pts?)?/i.exec(
      input.prompt,
    ) ??
    /(-?\d+(?:\.\d+)?)\s*(%|percent|points?|pts?)?\s*[.!]?$/i.exec(
      input.prompt.trim(),
    );
  if (!fullMarks && !scoreMatch) return null;
  const submittedAssignments = input.assignments.filter((assignment) =>
    Boolean(input.submissionFor(student.id, assignment.id)),
  );
  if (!submittedAssignments.length) {
    return {
      message: `${student.display_name} has no submitted assignments that can be graded.`,
      actions: [],
    };
  }

  let interpretedAsFullMarks = fullMarks;
  const amount = scoreMatch ? Number(scoreMatch[1]) : 100;
  const unit = scoreMatch?.[2]?.toLocaleLowerCase() ?? "";
  const percent = unit === "%" || unit === "percent";
  if (!fullMarks && !percent && amount === 100) {
    interpretedAsFullMarks = submittedAssignments.some(
      (assignment) => assignment.max_points < amount,
    );
  }
  if (!Number.isFinite(amount) || amount < 0 || (percent && amount > 100)) {
    return {
      message: "That score is outside the allowed range.",
      actions: [],
    };
  }
  if (
    !interpretedAsFullMarks &&
    !percent &&
    submittedAssignments.some((assignment) => amount > assignment.max_points)
  ) {
    const smallestMaximum = Math.min(
      ...submittedAssignments.map((assignment) => assignment.max_points),
    );
    return {
      message: `That request would exceed an assignment maximum of ${smallestMaximum}. Use a percentage or say “full marks” instead.`,
      actions: [],
    };
  }

  const actions: GradebookAction[] = submittedAssignments.map((assignment) => ({
    type: "set_grade",
    student_id: student.id,
    assignment_id: assignment.id,
    points: interpretedAsFullMarks
      ? assignment.max_points
      : percent
        ? Math.round(assignment.max_points * amount) / 100
        : amount,
  }));
  const skipped = input.assignments.length - submittedAssignments.length;
  const interpretation = interpretedAsFullMarks
    ? scoreMatch && !fullMarks
      ? `I interpreted “${amount} points for every grade” as 100% because these assignments have different maximums.`
      : "I interpreted the request as full marks on each assignment."
    : percent
      ? `I converted ${amount}% to each assignment’s point scale.`
      : `I used ${amount} points for each assignment.`;
  return {
    message: `${interpretation} Prepared ${actions.length} submitted grade(s) for ${student.display_name}.${skipped ? ` Skipped ${skipped} assignment(s) without a submission.` : ""}`,
    actions,
  };
}

function resolveCellEdit(input: IntentInput): GradebookIntent | null {
  const edit = parseCellEdit(input.prompt);
  if (!edit) return null;
  const target = resolveGradebookCellTarget(
    edit.cell,
    input.roster,
    input.assignments,
    input.workbook,
  );
  if (!target) {
    return { message: `I could not find cell ${edit.cell}.`, actions: [] };
  }
  if (target.kind === "identity") {
    return {
      message: `${target.address} contains protected student identity data and cannot be edited from the Gradebook assistant.`,
      actions: [],
    };
  }
  if (target.kind === "assignment_header") {
    const parsed = parseAssignmentHeader(edit.rawValue);
    const title =
      normalizeWords(parsed.title) === normalizeWords(target.assignment.title)
        ? target.assignment.title
        : parsed.title;
    const maxPoints = parsed.maxPoints ?? target.assignment.max_points;
    if (!title || !Number.isFinite(maxPoints) || maxPoints <= 0 || maxPoints > 10_000) {
      return {
        message: `Use a heading such as “Story Writing / 20” for ${target.address}.`,
        actions: [],
      };
    }
    const conflictingGrade = input.roster
      .map((student) => input.submissionFor(student.id, target.assignment.id))
      .find((submission) => (submission?.grade?.points ?? 0) > maxPoints);
    if (conflictingGrade) {
      return {
        message: `I cannot reduce ${target.assignment.title} to ${maxPoints} points because an existing grade is higher. Adjust that grade first.`,
        actions: [],
      };
    }
    if (
      title === target.assignment.title &&
      maxPoints === target.assignment.max_points
    ) {
      return {
        message: `${target.address} already shows ${target.assignment.title} / ${target.assignment.max_points}.`,
        actions: [],
      };
    }
    return {
      message: `${target.address} is the authoritative header for ${target.assignment.title}. I will update the assignment itself so the change persists everywhere.`,
      actions: [
        {
          type: "update_assignment",
          assignment_id: target.assignment.id,
          title,
          max_points: maxPoints,
        },
      ],
    };
  }
  if (target.kind === "grade") {
    if (!input.submissionFor(target.student.id, target.assignment.id)) {
      return {
        message: `${target.address} cannot be graded because ${target.student.display_name} has not submitted ${target.assignment.title}.`,
        actions: [],
      };
    }
    const score = pointsForGrade(edit.rawValue, target.assignment);
    if (!score) {
      return {
        message: `${target.address} is ${target.student.display_name}’s ${target.assignment.title} grade. Enter 0–${target.assignment.max_points}, a percentage, or “full marks”.`,
        actions: [],
      };
    }
    return {
      message: `${target.address} is ${target.student.display_name}’s ${target.assignment.title} grade (${score.interpretation}).`,
      actions: [
        {
          type: "set_grade",
          student_id: target.student.id,
          assignment_id: target.assignment.id,
          points: score.points,
        },
      ],
    };
  }
  return {
    message: `${target.address} is a local custom Gradebook cell.`,
    actions: [
      {
        type: "set_cell",
        sheet: "Gradebook",
        cell: target.address,
        value: parseWorkbookValue(edit.rawValue),
      },
    ],
  };
}

export function resolveGradebookIntent(input: IntentInput) {
  return resolveCellEdit(input) ?? resolveBulkGrades(input);
}
