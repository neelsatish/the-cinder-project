//! SQLite connection pool and migration runner.

use std::path::Path;

use anyhow::{Context, Result};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;

pub type Pool = r2d2::Pool<SqliteConnectionManager>;
pub type PooledConn = r2d2::PooledConnection<SqliteConnectionManager>;

/// Migrations are compiled into the binary so a host machine with no network and
/// no source tree can still initialise itself from a bare `.deb` install.
const MIGRATIONS: &[(&str, &str)] = &[
    ("0001_init", include_str!("../migrations/0001_init.sql")),
    (
        "0002_cinder_classrooms",
        include_str!("../migrations/0002_cinder_classrooms.sql"),
    ),
    (
        "0003_student_recovery",
        include_str!("../migrations/0003_student_recovery.sql"),
    ),
    (
        "0004_reliability_and_editing",
        include_str!("../migrations/0004_reliability_and_editing.sql"),
    ),
    (
        "0005_school_and_classroom_ownership",
        include_str!("../migrations/0005_school_and_classroom_ownership.sql"),
    ),
    (
        "0006_classroom_attendance",
        include_str!("../migrations/0006_classroom_attendance.sql"),
    ),
    (
        "0007_live_module_sessions",
        include_str!("../migrations/0007_live_module_sessions.sql"),
    ),
];

/// Opens (creating if needed) the database at `path` and brings it up to date.
pub fn open(path: &Path) -> Result<Pool> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating data directory {}", parent.display()))?;
    }

    let manager = SqliteConnectionManager::file(path).with_init(|conn| {
        // WAL lets the teacher's dashboard read while thirty clients write.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        // NORMAL is the right trade for a lab PC that can lose power: it risks
        // the last transaction on an OS crash, never database corruption.
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        // Without this a second writer fails instantly instead of waiting.
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(())
    });

    let pool = r2d2::Pool::builder()
        .max_size(8)
        .build(manager)
        .context("building sqlite pool")?;

    let mut conn = pool.get().context("taking a connection to migrate")?;
    migrate(&mut conn).context("running migrations")?;

    Ok(pool)
}

/// An in-memory database for tests. Pool size is 1 because each `:memory:`
/// connection would otherwise get its own empty database.
#[cfg(test)]
pub fn open_in_memory() -> Result<Pool> {
    let manager = SqliteConnectionManager::memory().with_init(|conn| {
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(())
    });
    let pool = r2d2::Pool::builder().max_size(1).build(manager)?;
    let mut conn = pool.get()?;
    migrate(&mut conn)?;
    Ok(pool)
}

fn migrate(conn: &mut Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
             name        TEXT PRIMARY KEY NOT NULL,
             applied_at  TEXT NOT NULL
         );",
    )?;

    // Keep databases created before the Cinder rebrand compatible without
    // re-running the classroom migration against tables that already exist.
    let legacy_name = format!("0002_{}_classrooms", cinder_core::previous_product_name());
    conn.execute(
        "DELETE FROM schema_migrations
          WHERE name = ?1
            AND EXISTS (SELECT 1 FROM schema_migrations WHERE name = ?2)",
        rusqlite::params![legacy_name, "0002_cinder_classrooms"],
    )?;
    conn.execute(
        "UPDATE schema_migrations SET name = ?1 WHERE name = ?2",
        rusqlite::params!["0002_cinder_classrooms", legacy_name],
    )?;

    for (name, sql) in MIGRATIONS {
        let already: bool = conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = ?1)",
            [name],
            |row| row.get(0),
        )?;
        if already {
            continue;
        }

        let tx = conn.transaction()?;
        tx.execute_batch(sql)
            .with_context(|| format!("applying migration {name}"))?;
        tx.execute(
            "INSERT INTO schema_migrations (name, applied_at) VALUES (?1, ?2)",
            rusqlite::params![name, chrono::Utc::now().to_rfc3339()],
        )?;
        tx.commit()?;
        tracing::info!(migration = name, "applied migration");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_and_are_idempotent() {
        let pool = open_in_memory().unwrap();
        let mut conn = pool.get().unwrap();

        // Running again must be a no-op, not an error.
        migrate(&mut conn).unwrap();

        let applied: i64 = conn
            .query_row("SELECT count(*) FROM schema_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(applied, MIGRATIONS.len() as i64);
    }

    #[test]
    fn fts5_is_available() {
        // If libsqlite3-sys was built without FTS5 this fails loudly here rather
        // than the first time a student searches their notes in a classroom.
        let pool = open_in_memory().unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "CREATE VIRTUAL TABLE probe USING fts5(body);
             INSERT INTO probe (body) VALUES ('refraction of light');",
        )
        .expect("FTS5 must be compiled in");

        let hits: i64 = conn
            .query_row(
                "SELECT count(*) FROM probe WHERE probe MATCH 'refraction'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1);
    }

    #[test]
    fn foreign_keys_cascade_from_users_to_nodes() {
        let pool = open_in_memory().unwrap();
        let conn = pool.get().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO users (id, username, display_name, pw_hash, role, created_at)
             VALUES ('u1', 'priya', 'Priya', 'x', 'student', ?1)",
            [&now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO nodes (id, owner_id, parent_id, name, kind, position, created_at, updated_at)
             VALUES ('n1', 'u1', NULL, 'Physics', 'folder', 0, ?1, ?1)",
            [&now],
        )
        .unwrap();

        conn.execute("DELETE FROM users WHERE id = 'u1'", [])
            .unwrap();

        let left: i64 = conn
            .query_row("SELECT count(*) FROM nodes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0, "deleting a user must remove their tree");
    }

    #[test]
    fn note_search_index_follows_note_bodies() {
        let pool = open_in_memory().unwrap();
        let conn = pool.get().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO users (id, username, display_name, pw_hash, role, created_at)
             VALUES ('u1', 'priya', 'Priya', 'x', 'student', ?1)",
            [&now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO nodes (id, owner_id, parent_id, name, kind, position, created_at, updated_at)
             VALUES ('n1', 'u1', NULL, 'Optics', 'note', 0, ?1, ?1)",
            [&now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO note_bodies (node_id, doc_json, plaintext, updated_at)
             VALUES ('n1', '{}', 'light bends when it enters glass', ?1)",
            [&now],
        )
        .unwrap();

        let hits: i64 = conn
            .query_row(
                "SELECT count(*) FROM note_search WHERE note_search MATCH 'bends'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1, "insert trigger should populate the index");

        conn.execute(
            "UPDATE note_bodies SET plaintext = 'a prism splits white light' WHERE node_id = 'n1'",
            [],
        )
        .unwrap();

        let stale: i64 = conn
            .query_row(
                "SELECT count(*) FROM note_search WHERE note_search MATCH 'bends'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            stale, 0,
            "update trigger must replace the old row, not add to it"
        );

        let fresh: i64 = conn
            .query_row(
                "SELECT count(*) FROM note_search WHERE note_search MATCH 'prism'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fresh, 1);
    }

    #[test]
    fn legacy_classrooms_are_preserved_and_get_a_deterministic_owner() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE schema_migrations (
                name TEXT PRIMARY KEY NOT NULL,
                applied_at TEXT NOT NULL
             );",
        )
        .unwrap();
        for (name, sql) in MIGRATIONS.iter().take(4) {
            conn.execute_batch(sql).unwrap();
            conn.execute(
                "INSERT INTO schema_migrations (name, applied_at) VALUES (?1, 'now')",
                [name],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO users (id, username, display_name, pw_hash, role, created_at)
             VALUES ('teacher-later', 'later', 'Later', 'hash', 'teacher', '2026-02-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO users (id, username, display_name, pw_hash, role, created_at)
             VALUES ('teacher-first', 'first', 'First', 'hash', 'teacher', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO classrooms (id, name, description, color, created_at)
             VALUES ('legacy-class', 'Legacy Science', '', '#BEC2FF', '2026-03-01T00:00:00Z')",
            [],
        )
        .unwrap();

        migrate(&mut conn).unwrap();

        let (name, owner, code): (String, String, String) = conn
            .query_row(
                "SELECT name, owner_teacher_id, enrolment_code FROM classrooms
                  WHERE id = 'legacy-class'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(name, "Legacy Science");
        assert_eq!(owner, "teacher-first");
        assert_eq!(code.len(), 8);
        let co_teachers: i64 = conn
            .query_row(
                "SELECT count(*) FROM classroom_teachers
                  WHERE classroom_id = 'legacy-class' AND teacher_id = 'teacher-later'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(co_teachers, 1);
    }

    #[test]
    fn migration_preserves_data_when_no_active_teacher_exists() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE schema_migrations (
                name TEXT PRIMARY KEY NOT NULL,
                applied_at TEXT NOT NULL
             );",
        )
        .unwrap();
        for (name, sql) in MIGRATIONS.iter().take(4) {
            conn.execute_batch(sql).unwrap();
            conn.execute(
                "INSERT INTO schema_migrations (name, applied_at) VALUES (?1, 'now')",
                [name],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO users (id, username, display_name, pw_hash, role, created_at)
             VALUES ('student', 'student', 'Student', 'hash', 'student', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO classrooms (id, name, description, color, created_at)
             VALUES ('legacy-class', 'Legacy', '', '#BEC2FF', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO classroom_enrolments (classroom_id, student_id, created_at)
             VALUES ('legacy-class', 'student', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO attendance_days (id, day, created_at)
             VALUES ('day', '2026-01-01', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO attendance_records
                (day_id, student_id, status, note, marked_by, updated_at)
             VALUES ('day', 'student', 'present', '', 'student', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();

        migrate(&mut conn).unwrap();

        let owner: Option<String> = conn
            .query_row(
                "SELECT owner_teacher_id FROM classrooms WHERE id = 'legacy-class'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(owner, None);
        let attendance_classroom: Option<String> = conn
            .query_row(
                "SELECT classroom_id FROM attendance_records
                  WHERE day_id = 'day' AND student_id = 'student'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(attendance_classroom.as_deref(), Some("legacy-class"));
    }

    #[test]
    fn attendance_migration_repairs_only_invalid_owners() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE schema_migrations (
                name TEXT PRIMARY KEY NOT NULL,
                applied_at TEXT NOT NULL
             );",
        )
        .unwrap();
        for (name, sql) in MIGRATIONS.iter().take(5) {
            conn.execute_batch(sql).unwrap();
            conn.execute(
                "INSERT INTO schema_migrations (name, applied_at) VALUES (?1, 'now')",
                [name],
            )
            .unwrap();
        }
        conn.execute_batch(
            "INSERT INTO users
                (id, username, display_name, pw_hash, role, created_at)
             VALUES
                ('active-first', 'first', 'First', 'hash', 'teacher', '2026-01-01T00:00:00Z'),
                ('active-owner', 'owner', 'Owner', 'hash', 'teacher', '2026-02-01T00:00:00Z');
             INSERT INTO users
                (id, username, display_name, pw_hash, role, created_at, disabled_at)
             VALUES
                ('disabled-owner', 'disabled', 'Disabled', 'hash', 'teacher',
                 '2025-01-01T00:00:00Z', '2026-03-01T00:00:00Z');
             INSERT INTO classrooms
                (id, name, description, color, created_at, owner_teacher_id, enrolment_code)
             VALUES
                ('healthy-class', 'Healthy', '', '#BEC2FF', '2026-03-01T00:00:00Z',
                 'active-owner', 'HEALTHY1'),
                ('repair-class', 'Repair', '', '#BEC2FF', '2026-03-01T00:00:00Z',
                 'disabled-owner', 'REPAIR01');",
        )
        .unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             INSERT INTO classrooms
                (id, name, description, color, created_at, owner_teacher_id, enrolment_code)
             VALUES ('missing-owner-class', 'Missing', '', '#BEC2FF',
                     '2026-03-01T00:00:00Z', 'missing-owner', 'MISSING1');
             PRAGMA foreign_keys = ON;",
        )
        .unwrap();

        migrate(&mut conn).unwrap();

        let healthy_owner: String = conn
            .query_row(
                "SELECT owner_teacher_id FROM classrooms WHERE id = 'healthy-class'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let repaired_owner: String = conn
            .query_row(
                "SELECT owner_teacher_id FROM classrooms WHERE id = 'repair-class'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let missing_owner: String = conn
            .query_row(
                "SELECT owner_teacher_id FROM classrooms WHERE id = 'missing-owner-class'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let widened: i64 = conn
            .query_row(
                "SELECT count(*) FROM classroom_teachers
                  WHERE classroom_id = 'healthy-class'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(healthy_owner, "active-owner");
        assert_eq!(repaired_owner, "active-first");
        assert_eq!(missing_owner, "active-first");
        assert_eq!(widened, 0, "0006 must not grant unrelated teacher access");
    }
}
