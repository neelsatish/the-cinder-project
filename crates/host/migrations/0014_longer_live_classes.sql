-- Live classes can last a full lesson, 5 to 60 minutes. SQLite cannot change a
-- CHECK constraint in place, so the table is rebuilt. The migration runner turns
-- foreign key enforcement off for this migration, so dropping the old table does
-- not cascade into participants, tasks, results or quiz deliveries.

CREATE TABLE live_module_sessions_new (
    id               TEXT PRIMARY KEY NOT NULL,
    classroom_id     TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    started_by       TEXT NOT NULL REFERENCES users(id),
    module_id        TEXT NOT NULL,
    module_name      TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 5 AND 60),
    join_code        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    starts_at        TEXT NOT NULL,
    ends_at          TEXT NOT NULL,
    ended_at         TEXT
);

INSERT INTO live_module_sessions_new
    (id, classroom_id, started_by, module_id, module_name, duration_minutes,
     join_code, starts_at, ends_at, ended_at)
SELECT id, classroom_id, started_by, module_id, module_name, duration_minutes,
       join_code, starts_at, ends_at, ended_at
  FROM live_module_sessions;

DROP TABLE live_module_sessions;
ALTER TABLE live_module_sessions_new RENAME TO live_module_sessions;

CREATE UNIQUE INDEX live_module_sessions_one_open_per_classroom
    ON live_module_sessions(classroom_id) WHERE ended_at IS NULL;
CREATE INDEX live_module_sessions_join_code
    ON live_module_sessions(join_code, ends_at);
