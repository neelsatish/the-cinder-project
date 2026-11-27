-- The student study helper. Every question is kept so a teacher can see what
-- was asked and what the AI answered; a question that failed is marked
-- 'failed' and stops counting against the student's allowance.
CREATE TABLE student_ai_questions (
    id         TEXT PRIMARY KEY NOT NULL,
    student_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    question   TEXT NOT NULL,
    answer     TEXT,
    had_image  INTEGER NOT NULL DEFAULT 0,
    status     TEXT NOT NULL CHECK (status IN ('pending', 'answered', 'failed')),
    created_at TEXT NOT NULL
);

CREATE INDEX student_ai_questions_student ON student_ai_questions (student_id, created_at);

-- Questions a teacher has granted beyond the first five. Never decreases.
CREATE TABLE student_ai_allowance (
    student_id TEXT PRIMARY KEY NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    extra      INTEGER NOT NULL DEFAULT 0 CHECK (extra >= 0)
);

CREATE TABLE student_ai_requests (
    id         TEXT PRIMARY KEY NOT NULL,
    student_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status     TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'declined')),
    decided_by TEXT REFERENCES users (id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    decided_at TEXT
);

-- One open request per student, enforced by the database.
CREATE UNIQUE INDEX student_ai_requests_one_open
    ON student_ai_requests (student_id) WHERE status = 'pending';
