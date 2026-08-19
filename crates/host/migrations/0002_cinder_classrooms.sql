-- Cinder classroom, assignment, grading, attendance, and account-recovery model.

ALTER TABLE users ADD COLUMN grade_level TEXT;
ALTER TABLE users ADD COLUMN section TEXT;
ALTER TABLE users ADD COLUMN roll_number TEXT;
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1));

CREATE TABLE teacher_recovery (
    user_id       TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recovery_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    rotated_at    TEXT
);

CREATE TABLE classrooms (
    id            TEXT PRIMARY KEY NOT NULL,
    name          TEXT NOT NULL,
    subject_code  TEXT,
    description   TEXT NOT NULL DEFAULT '',
    color         TEXT NOT NULL DEFAULT '#BEC2FF',
    created_at    TEXT NOT NULL,
    archived_at   TEXT
);

CREATE TABLE classroom_enrolments (
    classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    student_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL,
    PRIMARY KEY (classroom_id, student_id)
);

CREATE INDEX classroom_enrolments_student ON classroom_enrolments(student_id);

-- Personal notes can be associated with a classroom while remaining private.
ALTER TABLE nodes ADD COLUMN classroom_id TEXT REFERENCES classrooms(id) ON DELETE SET NULL;
CREATE INDEX nodes_classroom ON nodes(classroom_id);

CREATE TABLE assignments (
    id                  TEXT PRIMARY KEY NOT NULL,
    classroom_id        TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    instructions        TEXT NOT NULL DEFAULT '',
    due_at              TEXT,
    max_points          REAL NOT NULL DEFAULT 100 CHECK (max_points >= 0),
    grading_scheme_json TEXT NOT NULL DEFAULT '{"type":"points"}',
    status              TEXT NOT NULL CHECK (status IN ('draft','published','closed')),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE INDEX assignments_classroom_due ON assignments(classroom_id, due_at);

CREATE TABLE submissions (
    id                 TEXT PRIMARY KEY NOT NULL,
    assignment_id      TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    student_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status             TEXT NOT NULL CHECK (status IN ('draft','submitted','resubmitted','graded','withdrawn')),
    current_version_id TEXT,
    submitted_at       TEXT,
    updated_at         TEXT NOT NULL,
    UNIQUE (assignment_id, student_id)
);

CREATE TABLE submission_versions (
    id             TEXT PRIMARY KEY NOT NULL,
    submission_id  TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    doc_json       TEXT NOT NULL,
    plaintext      TEXT NOT NULL,
    change_note    TEXT,
    late           INTEGER NOT NULL DEFAULT 0 CHECK (late IN (0, 1)),
    created_at     TEXT NOT NULL,
    UNIQUE (submission_id, version_number)
);

CREATE INDEX submission_versions_submission ON submission_versions(submission_id, version_number DESC);

CREATE TABLE grades (
    id            TEXT PRIMARY KEY NOT NULL,
    submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
    points        REAL,
    grade_label   TEXT,
    feedback      TEXT NOT NULL DEFAULT '',
    published     INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
    graded_by     TEXT NOT NULL REFERENCES users(id),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE grade_changes (
    id            TEXT PRIMARY KEY NOT NULL,
    grade_id      TEXT NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
    changed_by    TEXT NOT NULL REFERENCES users(id),
    previous_json TEXT NOT NULL,
    current_json  TEXT NOT NULL,
    changed_at    TEXT NOT NULL
);

CREATE INDEX grade_changes_grade ON grade_changes(grade_id, changed_at DESC);

CREATE TABLE submission_comments (
    id                 TEXT PRIMARY KEY NOT NULL,
    submission_id      TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    author_id          TEXT NOT NULL REFERENCES users(id),
    body               TEXT NOT NULL,
    anchor_json        TEXT,
    visible_to_student INTEGER NOT NULL DEFAULT 1 CHECK (visible_to_student IN (0, 1)),
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);

CREATE INDEX submission_comments_submission ON submission_comments(submission_id, created_at);

CREATE TABLE attendance_days (
    id         TEXT PRIMARY KEY NOT NULL,
    day        TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE attendance_records (
    day_id     TEXT NOT NULL REFERENCES attendance_days(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status     TEXT NOT NULL CHECK (status IN ('present','absent','late','excused')),
    note       TEXT NOT NULL DEFAULT '',
    marked_by  TEXT NOT NULL REFERENCES users(id),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (day_id, student_id)
);

-- A compact, monotonic activity stream lets clients refresh only what changed
-- after reconnecting instead of downloading every classroom again.
CREATE TABLE change_events (
    sequence    INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    user_id     TEXT,
    changed_at  TEXT NOT NULL
);

CREATE INDEX change_events_user_sequence ON change_events(user_id, sequence);
