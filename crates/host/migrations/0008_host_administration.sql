-- Local Host administration metadata. These tables are additive so older
-- Teacher and Student clients can continue using the same database.

CREATE TABLE school_settings (
    key        TEXT PRIMARY KEY NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE trashed_files (
    node_id     TEXT PRIMARY KEY NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    trashed_at  TEXT NOT NULL,
    trashed_by  TEXT NOT NULL
);

CREATE TABLE operator_audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    detail      TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);

CREATE INDEX operator_audit_created ON operator_audit(created_at DESC);
