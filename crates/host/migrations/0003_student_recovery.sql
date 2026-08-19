-- Student recovery uses a separate, hashed, rotating code. It is not a second password.
CREATE TABLE student_recovery (
    user_id       TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recovery_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    rotated_at    TEXT
);
