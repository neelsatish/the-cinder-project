-- Generated question papers, owned by the teacher who made them.
--
-- The marking scheme is a separate column from the paper spec so a student-
-- facing export can never pick it up by serialising one row.
CREATE TABLE question_papers (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    classroom_id TEXT REFERENCES classrooms(id) ON DELETE SET NULL,
    title TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '',
    board TEXT NOT NULL DEFAULT '', syllabus_code TEXT NOT NULL DEFAULT '',
    difficulty INTEGER NOT NULL DEFAULT 3 CHECK(difficulty BETWEEN 1 AND 5),
    source_mode TEXT NOT NULL DEFAULT 'adapt' CHECK(source_mode IN ('adapt','excerpt','full_page')),
    -- Recorded when the teacher confirms they may reproduce exact questions or
    -- whole pages from the source. Boards permit classroom use on terms the
    -- school, not Cinder, accepts.
    rights_confirmed INTEGER NOT NULL DEFAULT 0,
    spec_json TEXT NOT NULL, scheme_json TEXT NOT NULL DEFAULT '{}',
    sources_json TEXT NOT NULL DEFAULT '[]', advanced_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX question_papers_owner ON question_papers(owner_id, updated_at DESC);
