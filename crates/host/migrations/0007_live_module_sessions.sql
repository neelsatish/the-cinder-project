-- Temporary, teacher-started module sessions. Classroom enrolment codes remain
-- separate and continue to control permanent classroom membership.

CREATE TABLE live_module_sessions (
    id               TEXT PRIMARY KEY NOT NULL,
    classroom_id     TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    started_by       TEXT NOT NULL REFERENCES users(id),
    module_id        TEXT NOT NULL,
    module_name      TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 5 AND 30),
    join_code        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    starts_at        TEXT NOT NULL,
    ends_at          TEXT NOT NULL,
    ended_at         TEXT
);

-- A classroom can have only one session that has not been explicitly or
-- naturally closed. The start route closes expired rows before inserting.
CREATE UNIQUE INDEX live_module_sessions_one_open_per_classroom
    ON live_module_sessions(classroom_id) WHERE ended_at IS NULL;
CREATE INDEX live_module_sessions_join_code
    ON live_module_sessions(join_code, ends_at);

CREATE TABLE live_module_participants (
    session_id TEXT NOT NULL REFERENCES live_module_sessions(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at  TEXT NOT NULL,
    PRIMARY KEY (session_id, student_id)
);

CREATE TABLE live_module_results (
    session_id      TEXT NOT NULL,
    student_id      TEXT NOT NULL,
    score           REAL NOT NULL CHECK (score >= 0 AND score <= 100),
    elapsed_seconds INTEGER NOT NULL CHECK (elapsed_seconds >= 0),
    submitted_at    TEXT NOT NULL,
    PRIMARY KEY (session_id, student_id),
    FOREIGN KEY (session_id, student_id)
        REFERENCES live_module_participants(session_id, student_id) ON DELETE CASCADE
);
