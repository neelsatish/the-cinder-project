-- Lumina host schema.
--
-- Runs inside one transaction. Migrations are applied in filename order and
-- recorded in `schema_migrations`; never edit a migration that has shipped to a
-- school, add a new one.

PRAGMA foreign_keys = ON;

CREATE TABLE users (
    id            TEXT PRIMARY KEY NOT NULL,
    username      TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    pw_hash       TEXT NOT NULL,           -- PHC string from argon2id
    role          TEXT NOT NULL CHECK (role IN ('student', 'teacher')),
    created_at    TEXT NOT NULL,
    disabled_at   TEXT
);

-- Usernames are matched case-insensitively: students type them on a keyboard
-- they are still learning, and "Priya" vs "priya" must not be two accounts.
CREATE UNIQUE INDEX users_username_unique ON users (lower(username));

CREATE TABLE sessions (
    token        TEXT PRIMARY KEY NOT NULL,   -- sha256 of the bearer token, never the token itself
    user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    device_label TEXT,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL
);

CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);

-- The subject organizer. Folders are subjects/topics; notes, PDFs and decks are
-- leaves. `owner_id IS NULL` marks the shared class library the teacher curates.
CREATE TABLE nodes (
    id          TEXT PRIMARY KEY NOT NULL,
    owner_id    TEXT REFERENCES users (id) ON DELETE CASCADE,
    parent_id   TEXT REFERENCES nodes (id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('folder', 'note', 'pdf', 'deck')),
    position    INTEGER NOT NULL DEFAULT 0,
    icon        TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX nodes_owner ON nodes (owner_id);
CREATE INDEX nodes_parent ON nodes (parent_id, position);

CREATE TABLE note_bodies (
    node_id     TEXT PRIMARY KEY NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
    doc_json    TEXT NOT NULL,   -- ProseMirror document, the render source of truth
    plaintext   TEXT NOT NULL,   -- flattened text for search and for the local model
    updated_at  TEXT NOT NULL
);

-- Standalone (not external-content) FTS index. `node_id` is UNINDEXED so it is
-- stored and returned but not tokenized.
CREATE VIRTUAL TABLE note_search USING fts5 (
    node_id UNINDEXED,
    plaintext,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER note_bodies_after_insert AFTER INSERT ON note_bodies BEGIN
    INSERT INTO note_search (node_id, plaintext) VALUES (new.node_id, new.plaintext);
END;

CREATE TRIGGER note_bodies_after_update AFTER UPDATE ON note_bodies BEGIN
    DELETE FROM note_search WHERE node_id = old.node_id;
    INSERT INTO note_search (node_id, plaintext) VALUES (new.node_id, new.plaintext);
END;

CREATE TRIGGER note_bodies_after_delete AFTER DELETE ON note_bodies BEGIN
    DELETE FROM note_search WHERE node_id = old.node_id;
END;

-- Uploaded files. Blobs live on disk at files/<sha256[0:2]>/<sha256>, so the
-- same PDF handed to thirty students costs one copy.
CREATE TABLE files (
    node_id     TEXT PRIMARY KEY NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
    sha256      TEXT NOT NULL,
    orig_name   TEXT NOT NULL,
    bytes       INTEGER NOT NULL,
    mime        TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE INDEX files_sha ON files (sha256);

-- The impact-evidence table. Every logged minute is attributed to a subject.
CREATE TABLE study_sessions (
    id               TEXT PRIMARY KEY NOT NULL,
    user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    node_id          TEXT REFERENCES nodes (id) ON DELETE SET NULL,
    started_at       TEXT NOT NULL,
    ended_at         TEXT NOT NULL,
    planned_seconds  INTEGER NOT NULL,
    actual_seconds   INTEGER NOT NULL,
    kind             TEXT NOT NULL CHECK (kind IN ('focus', 'break')),
    interrupted      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX study_user_time ON study_sessions (user_id, started_at);

CREATE TABLE cards (
    id               TEXT PRIMARY KEY NOT NULL,
    deck_node_id     TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
    front            TEXT NOT NULL,
    back             TEXT NOT NULL,
    source_node_id   TEXT REFERENCES nodes (id) ON DELETE SET NULL,
    source_excerpt   TEXT,
    generated_by     TEXT NOT NULL CHECK (generated_by IN ('manual', 'ai')),
    created_at       TEXT NOT NULL
);

CREATE INDEX cards_deck ON cards (deck_node_id);

CREATE TABLE card_reviews (
    card_id      TEXT NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    due          TEXT NOT NULL,
    stability    REAL NOT NULL,
    difficulty   REAL NOT NULL,
    reps         INTEGER NOT NULL DEFAULT 0,
    lapses       INTEGER NOT NULL DEFAULT 0,
    last_review  TEXT,
    PRIMARY KEY (card_id, user_id)
);

CREATE INDEX card_reviews_due ON card_reviews (user_id, due);

-- Optional cloud-AI credentials, used only if the school ever gets internet.
-- Ciphertext only; the key is derived from the host passphrase and never stored.
CREATE TABLE api_keys (
    id          TEXT PRIMARY KEY NOT NULL,
    provider    TEXT NOT NULL,
    ciphertext  BLOB NOT NULL,
    nonce       BLOB NOT NULL,
    created_by  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL
);

CREATE TABLE settings (
    key    TEXT PRIMARY KEY NOT NULL,
    value  TEXT NOT NULL
);
