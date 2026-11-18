import type { Assignment } from "@cinder/ui";

const normalizeWords = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Shown in a gradebook cell when the student has not handed the work in. A blank cell was handed in but not marked yet. */
export const NOT_HANDED_IN = "—";

function parseAssignmentHeader(value: unknown) {
  const text = String(value ?? "").trim();
  // Current form: Title (out of 5). Older sheets saved on this computer use "Title"  -/5, Title /5 or Title /5 points.
  const match =
    /^(.*?)\s*\(out of\s*(\d+(?:\.\d+)?)\)$/i.exec(text) ??
    /^(.*?)\s*(?:-\s*)?\/\s*(\d+(?:\.\d+)?)\s*(?:points?)?$/i.exec(text);
  const title = match?.[1].trim().replace(/^["“](.*)["”]$/, "$1") ?? text;
  return match
    ? { title, maxPoints: Number(match[2]) }
    : { title: text, maxPoints: null };
}

export function formatAssignmentHeader(assignment: Pick<Assignment, "title" | "max_points">) {
  return `${assignment.title} (out of ${assignment.max_points})`;
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
