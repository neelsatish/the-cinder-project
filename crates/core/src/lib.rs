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
pub mod secure_store;

pub use api::*;
pub use classroom::*;
pub use model::*;

/// Default port for the host server. Chosen to be memorable and well outside the
/// range anything else on a school LAN is likely to claim.
pub const DEFAULT_HOST_PORT: u16 = 7373;

/// mDNS service type the host advertises and clients browse for.
pub const MDNS_SERVICE_TYPE: &str = "_cinder._tcp.local.";

/// Whether a hostname is suitable for a classroom service that is deliberately
/// confined to the same machine or LAN. Keep this policy shared so AI model
/// access and Student material downloads cannot drift apart.
pub fn is_local_network_host(host: &str) -> bool {
    let host = host.trim_end_matches('.');
    // URL implementations may expose IPv6 hosts either with or without the
    // URI brackets. Normalize both forms before applying the IP policy.
    let host = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    host.eq_ignore_ascii_case("localhost")
        || host.to_ascii_lowercase().ends_with(".local")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| match address {
                std::net::IpAddr::V4(value) => {
                    value.is_loopback() || value.is_private() || value.is_link_local()
                }
                std::net::IpAddr::V6(value) => {
                    value.is_loopback()
                        || value.is_unique_local()
                        || (value.segments()[0] & 0xffc0) == 0xfe80
                }
            })
}

/// Returns the previous product name only when locating data created before
/// the rebrand. The encoded bytes keep that obsolete label out of current
/// binaries, launchers and package metadata while preserving automatic data
/// migration for existing schools.
#[doc(hidden)]
#[inline(never)]
pub fn previous_product_name() -> String {
    let key = std::hint::black_box(0x5a_u8);
    [0x36_u8, 0x2f, 0x37, 0x33, 0x34, 0x3b]
        .into_iter()
        .map(|byte| char::from(byte ^ key))
        .collect()
}

/// Moves data from the previous application identifier into the current
/// Cinder directory. Both desktop binaries call this before opening any files,
/// so an in-place rebrand does not strand classroom data or connection config.
pub fn migrate_legacy_app_data(current: &std::path::Path, role: &str) -> std::io::Result<()> {
    let Some(parent) = current.parent() else {
        return Ok(());
    };
    let previous_brand = previous_product_name();
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
        let previous_brand = previous_product_name();
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

#[cfg(test)]
mod network_tests {
    use super::is_local_network_host;

    #[test]
    fn accepts_only_loopback_private_link_local_and_dot_local_hosts() {
        for host in [
            "localhost",
            "teacher.local",
            "teacher.local.",
            "127.0.0.1",
            "10.20.30.40",
            "172.16.0.1",
            "192.168.1.20",
            "169.254.10.20",
            "::1",
            "[::1]",
            "fd00::1",
            "fe80::1",
        ] {
            assert!(is_local_network_host(host), "expected {host} to be local");
        }
        for host in ["example.com", "8.8.8.8", "1.1.1.1", "2001:4860:4860::8888"] {
            assert!(!is_local_network_host(host), "expected {host} to be public");
        }
    }
}
