-- Repair only classrooms whose owner can no longer manage them. Broad legacy
-- access was preserved in 0005; repeating it here would expose classrooms
-- created after 0005 to unrelated teachers.
UPDATE classrooms
   SET owner_teacher_id = (
       SELECT id FROM users
        WHERE role = 'teacher' AND disabled_at IS NULL
        ORDER BY created_at, id LIMIT 1
   )
 WHERE (
       owner_teacher_id IS NULL
       OR NOT EXISTS (
           SELECT 1 FROM users owner
            WHERE owner.id = classrooms.owner_teacher_id
              AND owner.role = 'teacher'
              AND owner.disabled_at IS NULL
       )
   )
   AND EXISTS (
       SELECT 1 FROM users
        WHERE role = 'teacher' AND disabled_at IS NULL
   );

-- Attendance used to have one row per day/student, so teachers sharing a
-- student could overwrite each other. Keep every legacy row and map it to the
-- student's earliest classroom when possible. Rows for students with no
-- classroom remain stored with a NULL classroom_id but are excluded from the
-- new classroom-scoped API.
ALTER TABLE attendance_records RENAME TO attendance_records_schoolwide;

CREATE TABLE attendance_records (
    day_id       TEXT NOT NULL REFERENCES attendance_days(id) ON DELETE CASCADE,
    classroom_id TEXT REFERENCES classrooms(id) ON DELETE CASCADE,
    student_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL CHECK (status IN ('present','absent','late','excused')),
    note         TEXT NOT NULL DEFAULT '',
    marked_by    TEXT NOT NULL REFERENCES users(id),
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (day_id, classroom_id, student_id)
);

INSERT INTO attendance_records
    (day_id, classroom_id, student_id, status, note, marked_by, updated_at)
SELECT legacy.day_id,
       (
           SELECT enrolment.classroom_id
             FROM classroom_enrolments enrolment
             JOIN classrooms classroom ON classroom.id = enrolment.classroom_id
            WHERE enrolment.student_id = legacy.student_id
            ORDER BY classroom.created_at, classroom.id
            LIMIT 1
       ),
       legacy.student_id,
       legacy.status,
       legacy.note,
       legacy.marked_by,
       legacy.updated_at
  FROM attendance_records_schoolwide legacy;

DROP TABLE attendance_records_schoolwide;

CREATE INDEX attendance_records_classroom_day
    ON attendance_records(classroom_id, day_id);
