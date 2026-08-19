-- Reliability and reversible management updates.

-- Assignments are archived rather than physically deleted so submitted work,
-- grades, and their audit history remain recoverable.
ALTER TABLE assignments ADD COLUMN archived_at TEXT;
CREATE INDEX assignments_active_classroom ON assignments(classroom_id, archived_at, due_at);

-- A four-digit temporary PIN is usable on classroom keyboards, but must be
-- protected against repeated guessing. Successful login resets both fields.
ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN login_blocked_until TEXT;
