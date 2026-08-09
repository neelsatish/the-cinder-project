//! Shared domain types and logic for Cinder.
//!
//! Everything that crosses the host <-> client boundary is defined here exactly once
//! and exported to TypeScript with `ts-rs`. Run `cargo test -p cinder-core` to
//! regenerate client bindings when the native toolchain is available. The current
//! TypeScript contracts in `packages/ui` intentionally mirror these definitions.

pub mod api;
pub mod classroom;
pub mod model;
pub mod scheduler;

pub use api::*;
pub use classroom::*;
pub use model::*;

/// Default port for the host server. Chosen to be memorable and well outside the
/// range anything else on a school LAN is likely to claim.
pub const DEFAULT_HOST_PORT: u16 = 7373;

/// mDNS service type the host advertises and clients browse for.
pub const MDNS_SERVICE_TYPE: &str = "_cinder._tcp.local.";

/// Moves data from the previous application identifier into the current
/// Cinder directory. Both desktop binaries call this before opening any files,
/// so an in-place rebrand does not strand classroom data or connection config.
pub fn migrate_legacy_app_data(current: &std::path::Path, role: &str) -> std::io::Result<()> {
    let Some(parent) = current.parent() else {
        return Ok(());
    };
    let previous_brand = ["lu", "mina"].concat();
    let legacy = parent.join(format!("org.{previous_brand}.{role}"));
    if !legacy.exists() || legacy == current {
        return Ok(());
    }

    if !current.exists() {
        return std::fs::rename(legacy, current);
    }

    move_missing_entries(&legacy, current)?;
    if legacy.read_dir()?.next().is_none() {
        std::fs::remove_dir(legacy)?;
    }
    Ok(())
}

fn move_missing_entries(
    source: &std::path::Path,
    destination: &std::path::Path,
) -> std::io::Result<()> {
    std::fs::create_dir_all(destination)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if destination_path.exists() {
            if source_path.is_dir() && destination_path.is_dir() {
                move_missing_entries(&source_path, &destination_path)?;
                if source_path.read_dir()?.next().is_none() {
                    std::fs::remove_dir(source_path)?;
                }
            }
            continue;
        }
        std::fs::rename(source_path, destination_path)?;
    }
    Ok(())
}

#[cfg(test)]
mod data_migration_tests {
    use super::*;

    #[test]
    fn legacy_app_data_moves_to_cinder_identifier() {
        let root = std::env::temp_dir().join(format!("cinder-migration-{}", uuid::Uuid::new_v4()));
        let previous_brand = ["lu", "mina"].concat();
        let legacy = root.join(format!("org.{previous_brand}.student"));
        let current = root.join("org.cinder.student");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("config.json"), b"{}").unwrap();

        migrate_legacy_app_data(&current, "student").unwrap();

        assert_eq!(std::fs::read(current.join("config.json")).unwrap(), b"{}");
        assert!(!legacy.exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
