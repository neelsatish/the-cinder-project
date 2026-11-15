import type { Assignment } from "@cinder/ui";

const normalizeWords = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function parseAssignmentHeader(value: unknown) {
  const text = String(value ?? "").trim();
  const match = /^(.*?)\s*(?:-\s*)?\/\s*(\d+(?:\.\d+)?)\s*(?:points?)?$/i.exec(text);
  const title = match?.[1].trim().replace(/^["“](.*)["”]$/, "$1") ?? text;
  return match
    ? { title, maxPoints: Number(match[2]) }
    : { title: text, maxPoints: null };
}

export function formatAssignmentHeader(assignment: Pick<Assignment, "title" | "max_points">) {
  return `"${assignment.title}"  -/${assignment.max_points}`;
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
