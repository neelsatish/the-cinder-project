import type { CinderApi, QuestionPaper, SaveQuestionPaperInput } from "@cinder/ui";
import type {
  DifficultyLevel,
  ExamBoard,
  GeneratedPaper,
  PaperSourceMode,
} from "./paperLogic";

export type PaperSourceCitation = {
  name: string;
  pages: number[];
};

export type PaperAdvancedOptions = {
  year: string;
  session: string;
  paperVariant: string;
  durationMinutes: number;
  topics: string;
  includeDiagrams: boolean;
  headerText?: string;
  footerText?: string;
  repeatHeader?: boolean;
  repeatFooter?: boolean;
  maxOutputTokens?: number;
};

export type SavedQuestionPaper = {
  id: string;
  title: string;
  subject: string;
  questionText: string;
  questionDocument: Record<string, unknown>;
  answerKeyText: string;
  answerKeyDocument: Record<string, unknown>;
  sources: PaperSourceCitation[];
  classroomId?: string;
  board?: ExamBoard;
  syllabusCode?: string;
  difficulty?: DifficultyLevel;
  sourceMode?: PaperSourceMode;
  rightsConfirmed?: boolean;
  advanced?: PaperAdvancedOptions;
  paperSpec?: GeneratedPaper;
  createdAt: string;
  updatedAt: string;
};

const DATABASE = "cinder-teacher-library";
const VERSION = 1;
const STORE = "question-papers";
const MIGRATED_KEY = "cinder.teacher.papers-moved-to-host";

const BOARDS: ExamBoard[] = ["CIE", "IGCSE", "CBSE", "ICSE"];
const SOURCE_MODES: PaperSourceMode[] = ["adapt", "excerpt", "full_page"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asSources(value: unknown): PaperSourceCitation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): PaperSourceCitation[] => {
    const source = asRecord(item);
    if (typeof source.name !== "string") return [];
    const pages = Array.isArray(source.pages)
      ? source.pages.filter(
          (page): page is number => Number.isInteger(page) && page > 0 && page <= 10_000,
        )
      : [];
    return [{ name: source.name, pages }];
  });
}

function fromRow(row: QuestionPaper): SavedQuestionPaper {
  const spec = asRecord(row.spec);
  const scheme = asRecord(row.scheme);
  const advanced = asRecord(row.advanced) as Partial<PaperAdvancedOptions>;
  return {
    id: row.id,
    title: row.title,
    subject: row.subject,
    questionText: typeof spec.questionText === "string" ? spec.questionText : "",
    questionDocument: asRecord(spec.questionDocument),
    answerKeyText: typeof scheme.answerKeyText === "string" ? scheme.answerKeyText : "",
    answerKeyDocument: asRecord(scheme.answerKeyDocument),
    sources: asSources(row.sources),
    classroomId: row.classroom_id ?? undefined,
    board: BOARDS.includes(row.board as ExamBoard) ? (row.board as ExamBoard) : undefined,
    syllabusCode: row.syllabus_code || undefined,
    difficulty: [1, 2, 3, 4, 5].includes(row.difficulty)
      ? (row.difficulty as DifficultyLevel)
      : undefined,
    sourceMode: SOURCE_MODES.includes(row.source_mode) ? row.source_mode : "adapt",
    rightsConfirmed: row.rights_confirmed,
    advanced: advanced.year === undefined ? undefined : (advanced as PaperAdvancedOptions),
    paperSpec: (spec.paper as GeneratedPaper | undefined) ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toInput(paper: SavedQuestionPaper): SaveQuestionPaperInput {
  return {
    classroom_id: paper.classroomId ?? null,
    title: paper.title,
    subject: paper.subject,
    board: paper.board ?? "",
    syllabus_code: paper.syllabusCode ?? "",
    difficulty: paper.difficulty ?? 3,
    source_mode: paper.sourceMode ?? "adapt",
    rights_confirmed: paper.rightsConfirmed ?? false,
    spec: {
      paper: paper.paperSpec ?? null,
      questionText: paper.questionText,
      questionDocument: paper.questionDocument,
    },
    // The marking scheme travels in its own column, which is what keeps it out
    // of anything built from the question paper alone.
    scheme: {
      answerKeyText: paper.answerKeyText,
      answerKeyDocument: paper.answerKeyDocument,
    },
    sources: paper.sources,
    advanced: paper.advanced ?? {},
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readLocalPapers(): Promise<SavedQuestionPaper[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).getAll();
    const records = await new Promise<unknown[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error);
    });
    return records.flatMap((record): SavedQuestionPaper[] => {
      const paper = asRecord(record) as Partial<SavedQuestionPaper>;
      return typeof paper.id === "string" && typeof paper.title === "string"
        ? [paper as SavedQuestionPaper]
        : [];
    });
  } finally {
    database.close();
  }
}

/// Papers made before the library moved to the Host are copied up once. The
/// local database is left untouched afterwards, so a failed move loses nothing.
async function migrateLocalPapers(api: CinderApi) {
  if (localStorage.getItem(MIGRATED_KEY)) return;
  let local: SavedQuestionPaper[] = [];
  try {
    local = await readLocalPapers();
  } catch {
    localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
    return;
  }
  for (const paper of local) {
    // Host ids are UUIDs; the old library used its own id format.
    const id = /^[0-9a-f-]{36}$/i.test(paper.id) ? paper.id : crypto.randomUUID();
    try {
      await api.saveQuestionPaper(id, toInput(paper));
    } catch {
      // One unreadable paper must not block the rest, and the local copy stays.
    }
  }
  localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
}

export async function listSavedQuestionPapers(api: CinderApi) {
  await migrateLocalPapers(api);
  const rows = await api.questionPapers();
  return rows.map(fromRow);
}

export async function saveQuestionPaper(api: CinderApi, paper: SavedQuestionPaper) {
  await api.saveQuestionPaper(paper.id, toInput(paper));
}

export async function deleteQuestionPaper(api: CinderApi, id: string) {
  await api.deleteQuestionPaper(id);
}
