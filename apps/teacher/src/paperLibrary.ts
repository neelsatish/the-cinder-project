import type {
  DifficultyLevel,
  ExamBoard,
  GeneratedPaper,
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
  advanced?: PaperAdvancedOptions;
  paperSpec?: GeneratedPaper;
  createdAt: string;
  updatedAt: string;
};

const DATABASE = "cinder-teacher-library";
const VERSION = 1;
const STORE = "question-papers";

let writeQueue: Promise<void> = Promise.resolve();

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

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function isSavedQuestionPaper(value: unknown): value is SavedQuestionPaper {
  if (!value || typeof value !== "object") return false;
  const paper = value as Partial<SavedQuestionPaper>;
  return (
    typeof paper.id === "string" &&
    typeof paper.title === "string" &&
    typeof paper.subject === "string" &&
    typeof paper.questionText === "string" &&
    Boolean(paper.questionDocument && typeof paper.questionDocument === "object") &&
    typeof paper.answerKeyText === "string" &&
    Boolean(paper.answerKeyDocument && typeof paper.answerKeyDocument === "object") &&
    (paper.classroomId === undefined || typeof paper.classroomId === "string") &&
    (paper.board === undefined || ["CIE", "IGCSE", "CBSE", "ICSE"].includes(paper.board)) &&
    (paper.syllabusCode === undefined || typeof paper.syllabusCode === "string") &&
    (paper.difficulty === undefined || [1, 2, 3, 4, 5].includes(paper.difficulty)) &&
    (paper.advanced === undefined ||
      Boolean(
        paper.advanced &&
          typeof paper.advanced === "object" &&
          typeof paper.advanced.year === "string" &&
          typeof paper.advanced.session === "string" &&
          typeof paper.advanced.paperVariant === "string" &&
          Number.isFinite(paper.advanced.durationMinutes) &&
          typeof paper.advanced.topics === "string" &&
          typeof paper.advanced.includeDiagrams === "boolean" &&
          (paper.advanced.maxOutputTokens === undefined ||
            (Number.isInteger(paper.advanced.maxOutputTokens) &&
              paper.advanced.maxOutputTokens >= 256 &&
              paper.advanced.maxOutputTokens <= 8_192)),
      )) &&
    (paper.paperSpec === undefined || Boolean(paper.paperSpec && typeof paper.paperSpec === "object")) &&
    Array.isArray(paper.sources) &&
    paper.sources.every(
      (source) =>
        Boolean(source) &&
        typeof source.name === "string" &&
        Array.isArray(source.pages) &&
        source.pages.every(
          (page) => Number.isInteger(page) && page > 0 && page <= 10_000,
        ),
    ) &&
    typeof paper.createdAt === "string" &&
    typeof paper.updatedAt === "string"
  );
}

export async function listSavedQuestionPapers() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).getAll();
    const records = await new Promise<unknown[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error);
    });
    return records
      .filter(isSavedQuestionPaper)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } finally {
    database.close();
  }
}

export function saveQuestionPaper(paper: SavedQuestionPaper) {
  const operation = async () => {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(paper);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  };
  writeQueue = writeQueue.catch(() => undefined).then(operation);
  return writeQueue;
}

export function deleteQuestionPaper(id: string) {
  const operation = async () => {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(id);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  };
  writeQueue = writeQueue.catch(() => undefined).then(operation);
  return writeQueue;
}
