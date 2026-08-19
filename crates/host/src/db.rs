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
}
