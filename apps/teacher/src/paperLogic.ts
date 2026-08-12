import type { PaperSourceCitation } from "./paperLibrary";

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
    ranges.push(start === end ? `${start}` : `${start}–${end}`);
    start = page;
    end = page;
  }
  ranges.push(start === end ? `${start}` : `${start}–${end}`);
  return `${sorted.length === 1 ? "p." : "pp."} ${ranges.join(", ")}`;
}

export function sourceSummary(sources: PaperSourceCitation[]) {
  if (!sources.length) {
    return "No reference PDF selected; questions may use the teacher brief and the model's general knowledge.";
  }
  return sources
    .map((source) => {
      const pages = compactPageRanges(source.pages);
      return pages ? `${source.name} (${pages})` : source.name;
    })
    .join("; ");
}

function stripPaperMarker(value: string) {
  return value
    .replace(/^```(?:text|markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function splitPaperResponse(value: string) {
  const cleaned = stripPaperMarker(value);
  const answerMarker =
    /(?:^|\n)\s*(?:\[CINDER_ANSWER_KEY\]|#{0,3}\s*ANSWER\s+KEY\s*:?)\s*(?:\n|$)/i;
  const match = answerMarker.exec(cleaned);
  const questionText = stripPaperMarker(
    (match ? cleaned.slice(0, match.index) : cleaned).replace(
      /^\s*(?:\[CINDER_QUESTIONS\]|#{0,3}\s*QUESTION\s+PAPER\s*:?)\s*/i,
      "",
    ),
  );
  const answerKeyText = match
    ? stripPaperMarker(cleaned.slice(match.index + match[0].length))
    : "";
  return { questionText, answerKeyText };
}

export function addWorkingSpace(value: string) {
  if (/\[WORKING_SPACE\]/i.test(value)) {
    return value
      .replace(/\s*\[WORKING_SPACE\]\s*/gi, "\n\n\n\n")
      .trimStart();
  }
  const result: string[] = [];
  let foundQuestion = false;
  for (const line of value.split(/\r?\n/)) {
    const startsQuestion = /^\s*(?:question\s*)?\d{1,3}[).:\-]\s+/i.test(line);
    if (startsQuestion && foundQuestion) {
      while (result.length && !result[result.length - 1].trim()) result.pop();
      result.push("", "", "");
    }
    if (startsQuestion) foundQuestion = true;
    result.push(line.trimEnd());
  }
  if (foundQuestion) result.push("", "", "");
  return result.join("\n").trimStart();
}

export function composeQuestionPaper(
  title: string,
  subject: string,
  sources: PaperSourceCitation[],
  questions: string,
) {
  return [
    title.trim(),
    subject.trim() ? `Subject: ${subject.trim()}` : "",
    `Sources: ${sourceSummary(sources)}`,
    "",
    addWorkingSpace(questions),
  ]
    .filter((line, index) => Boolean(line) || index >= 3)
    .join("\n")
    .trimStart();
}

export function composeAnswerKey(title: string, answers: string) {
  return [
    `${title.trim()} — Answer key`,
    "Teacher copy — keep separate from the question paper",
    "",
    answers.trim(),
  ].join("\n");
}
