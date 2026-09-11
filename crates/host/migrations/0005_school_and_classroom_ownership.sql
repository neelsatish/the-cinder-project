-- Dedicated-host setup, one-time teacher invitations, and teacher-owned classrooms.

CREATE TABLE school_bootstrap_pin (
    singleton       INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
    pin_hash        TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    blocked_until   TEXT
);

CREATE TABLE teacher_invite_pin (
    singleton       INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
    pin_hash        TEXT NOT NULL,
    created_by      TEXT NOT NULL REFERENCES users(id),
    expires_at      TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    blocked_until   TEXT
);

ALTER TABLE classrooms ADD COLUMN owner_teacher_id TEXT REFERENCES users(id);
ALTER TABLE classrooms ADD COLUMN enrolment_code TEXT;

-- Legacy classrooms did not record an owner. Assign them to the earliest active
-- teacher (then UUID as a stable tie-breaker); the audit documents this limitation.
UPDATE classrooms
   SET owner_teacher_id = (
       SELECT id FROM users
        WHERE role = 'teacher' AND disabled_at IS NULL
        ORDER BY created_at, id LIMIT 1
   )
 WHERE owner_teacher_id IS NULL;

UPDATE classrooms
   SET enrolment_code = upper(substr(hex(randomblob(8)), 1, 8))
 WHERE enrolment_code IS NULL;

CREATE UNIQUE INDEX classrooms_enrolment_code_unique
    ON classrooms(enrolment_code COLLATE NOCASE);
CREATE INDEX classrooms_owner ON classrooms(owner_teacher_id, archived_at);

CREATE TABLE classroom_teachers (
    classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    teacher_id   TEXT NOT NULL REFERENCES users(id),
    added_by     TEXT NOT NULL REFERENCES users(id),
    created_at   TEXT NOT NULL,
    PRIMARY KEY (classroom_id, teacher_id)
);
CREATE INDEX classroom_teachers_teacher ON classroom_teachers(teacher_id, classroom_id);

-- Before ownership existed, every active teacher could manage every classroom.
-- Preserve that access by making every other active legacy teacher a co-teacher.
INSERT INTO classroom_teachers (classroom_id, teacher_id, added_by, created_at)
SELECT c.id, teacher.id, c.owner_teacher_id, c.created_at
  FROM classrooms c
  JOIN users teacher
    ON teacher.role = 'teacher'
   AND teacher.disabled_at IS NULL
   AND teacher.id <> c.owner_teacher_id
 WHERE c.owner_teacher_id IS NOT NULL;

CREATE TRIGGER classrooms_require_owner_insert
BEFORE INSERT ON classrooms
WHEN new.owner_teacher_id IS NULL OR new.enrolment_code IS NULL
BEGIN
    SELECT RAISE(ABORT, 'classroom owner and enrolment code are required');
END;

CREATE TRIGGER classrooms_require_owner_update
BEFORE UPDATE OF owner_teacher_id, enrolment_code ON classrooms
WHEN new.owner_teacher_id IS NULL OR new.enrolment_code IS NULL
BEGIN
    SELECT RAISE(ABORT, 'classroom owner and enrolment code are required');
END;
