-- Versioned teacher-assigned work for live classroom sessions.

ALTER TABLE live_module_participants ADD COLUMN last_seen_at TEXT;
ALTER TABLE live_module_results ADD COLUMN task_revision INTEGER;

CREATE TABLE live_session_tasks (
    id          TEXT PRIMARY KEY NOT NULL,
    session_id  TEXT NOT NULL REFERENCES live_module_sessions(id) ON DELETE CASCADE,
    revision    INTEGER NOT NULL CHECK (revision > 0),
    kind        TEXT NOT NULL CHECK (kind IN ('instruction','assignment','material','quiz')),
    target_id   TEXT,
    title       TEXT NOT NULL,
    instructions TEXT NOT NULL DEFAULT '',
    assigned_by TEXT NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL,
    UNIQUE (session_id, revision)
);

CREATE INDEX live_session_tasks_latest
    ON live_session_tasks(session_id, revision DESC);

CREATE TABLE live_session_task_acknowledgements (
    session_id   TEXT NOT NULL REFERENCES live_module_sessions(id) ON DELETE CASCADE,
    task_revision INTEGER NOT NULL,
    student_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state        TEXT NOT NULL CHECK (state IN ('opened','in_progress','completed','failed')),
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (session_id, task_revision, student_id),
    FOREIGN KEY (session_id, task_revision)
        REFERENCES live_session_tasks(session_id, revision) ON DELETE CASCADE
);

CREATE INDEX live_session_task_ack_student
    ON live_session_task_acknowledgements(student_id, session_id);

CREATE TABLE live_session_task_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT NOT NULL REFERENCES live_module_sessions(id) ON DELETE CASCADE,
    task_revision INTEGER NOT NULL,
    student_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state         TEXT NOT NULL CHECK (state IN ('opened','in_progress','completed','failed')),
    created_at    TEXT NOT NULL,
    FOREIGN KEY (session_id, task_revision)
        REFERENCES live_session_tasks(session_id, revision) ON DELETE CASCADE
);

CREATE INDEX live_session_task_events_timeline
    ON live_session_task_events(session_id, task_revision, student_id, id);
