CREATE TABLE quizzes (
    id TEXT PRIMARY KEY NOT NULL,
    classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    title TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '',
    time_limit_minutes INTEGER, created_by TEXT NOT NULL REFERENCES users(id),
    archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX quizzes_classroom ON quizzes(classroom_id, archived_at, updated_at DESC);

CREATE TABLE quiz_draft_questions (
    id TEXT PRIMARY KEY NOT NULL, quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('single_choice','true_false','short_answer')),
    prompt TEXT NOT NULL, options_json TEXT NOT NULL, canonical_answer_json TEXT NOT NULL,
    max_points REAL NOT NULL CHECK(max_points > 0), required INTEGER NOT NULL DEFAULT 1,
    UNIQUE(quiz_id, position)
);
CREATE TABLE quiz_versions (
    id TEXT PRIMARY KEY NOT NULL, quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL, title TEXT NOT NULL, instructions TEXT NOT NULL,
    time_limit_minutes INTEGER, total_points REAL NOT NULL, published_at TEXT NOT NULL,
    UNIQUE(quiz_id, version_number)
);
CREATE TABLE quiz_version_questions (
    id TEXT PRIMARY KEY NOT NULL, version_id TEXT NOT NULL REFERENCES quiz_versions(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('single_choice','true_false','short_answer')),
    prompt TEXT NOT NULL, options_json TEXT NOT NULL, canonical_answer_json TEXT NOT NULL,
    max_points REAL NOT NULL CHECK(max_points > 0), required INTEGER NOT NULL,
    UNIQUE(version_id, position)
);
CREATE TABLE quiz_deliveries (
    id TEXT PRIMARY KEY NOT NULL, version_id TEXT NOT NULL REFERENCES quiz_versions(id),
    classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('homework','live')), live_session_id TEXT REFERENCES live_module_sessions(id) ON DELETE SET NULL,
    opens_at TEXT, due_at TEXT, results_released_at TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX quiz_deliveries_classroom ON quiz_deliveries(classroom_id, created_at DESC);
CREATE TABLE quiz_attempts (
    id TEXT PRIMARY KEY NOT NULL, delivery_id TEXT NOT NULL REFERENCES quiz_deliveries(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, started_at TEXT NOT NULL,
    expires_at TEXT, submitted_at TEXT, score REAL, max_points REAL NOT NULL, graded_at TEXT, reopened_at TEXT,
    UNIQUE(delivery_id, student_id)
);
CREATE TABLE quiz_responses (
    id TEXT PRIMARY KEY NOT NULL, attempt_id TEXT NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES quiz_version_questions(id) ON DELETE CASCADE,
    answer_json TEXT NOT NULL, points REAL, feedback TEXT NOT NULL DEFAULT '', auto_graded INTEGER NOT NULL DEFAULT 0,
    graded_at TEXT, updated_at TEXT NOT NULL, UNIQUE(attempt_id, question_id)
);
CREATE TABLE quiz_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
    quiz_id TEXT, delivery_id TEXT, attempt_id TEXT, detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
