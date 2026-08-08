//! Shared domain types and logic for Lumina.
//!
//! Everything that crosses the host <-> client boundary is defined here exactly once
//! and exported to TypeScript with `ts-rs`. Run `cargo test -p lumina-core` to
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
pub const MDNS_SERVICE_TYPE: &str = "_lumina._tcp.local.";
