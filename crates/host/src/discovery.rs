//! mDNS host advertisement and client-side browsing.
//!
//! Convenience only. Cheap school routers regularly drop multicast, so the UI
//! must always offer a manual `http://<ip>:7373` entry as well — never make
//! discovery the only way to reach the host.

use std::net::IpAddr;
use std::time::Duration;

use anyhow::{Context, Result};
use lumina_core::MDNS_SERVICE_TYPE;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};

/// Announces this machine as the lab host. The returned daemon must be kept
/// alive; dropping it withdraws the advertisement.
pub fn advertise(port: u16, instance_name: &str) -> Result<ServiceDaemon> {
    let daemon = ServiceDaemon::new().context("starting mDNS daemon")?;
    let hostname = format!("{}.local.", sanitize(instance_name));

    let service = ServiceInfo::new(MDNS_SERVICE_TYPE, instance_name, &hostname, (), port, None)
        .context("building mDNS service info")?
        // Fills in the machine's real addresses, so we do not have to guess which
        // NIC the lab switch is on.
        .enable_addr_auto();

    daemon
        .register(service)
        .context("registering mDNS service")?;
    tracing::info!(port, "advertising host over mDNS");
    Ok(daemon)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoundHost {
    pub name: String,
    pub addr: IpAddr,
    pub port: u16,
}

impl FoundHost {
    pub fn base_url(&self) -> String {
        format!("http://{}:{}", self.addr, self.port)
    }
}

/// Browses for hosts for `timeout`, returning everything seen.
///
/// Returns a list rather than the first hit: if someone has accidentally left
/// two hosts running, the student should be shown both instead of being
/// connected to whichever answered first.
pub async fn discover(timeout: Duration) -> Result<Vec<FoundHost>> {
    let daemon = ServiceDaemon::new().context("starting mDNS daemon")?;
    let receiver = daemon
        .browse(MDNS_SERVICE_TYPE)
        .context("browsing for hosts")?;

    let mut found: Vec<FoundHost> = Vec::new();
    let deadline = tokio::time::Instant::now() + timeout;

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }

        // `recv_async` is the mdns-sd future; racing it against the deadline
        // keeps this from blocking the runtime on a silent network.
        let event = match tokio::time::timeout(remaining, receiver.recv_async()).await {
            Ok(Ok(event)) => event,
            Ok(Err(_)) | Err(_) => break,
        };

        if let ServiceEvent::ServiceResolved(info) = event {
            let name = info.get_fullname().to_owned();
            let port = info.get_port();
            for addr in info.get_addresses() {
                let host = FoundHost {
                    name: name.clone(),
                    addr: *addr,
                    port,
                };
                if !found.contains(&host) {
                    found.push(host);
                }
            }
        }
    }

    let _ = daemon.shutdown();
    Ok(found)
}

/// mDNS hostnames allow only letters, digits and hyphens.
fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let trimmed = cleaned.trim_matches('-');
    if trimmed.is_empty() {
        "lumina-host".to_owned()
    } else {
        trimmed.to_lowercase()
    }
}

#[cfg(test)]
mod tests {
    use super::sanitize;

    #[test]
    fn sanitizes_hostnames() {
        assert_eq!(sanitize("Lab PC 1"), "lab-pc-1");
        assert_eq!(sanitize("शिक्षक"), "lumina-host", "non-ascii falls back");
        assert_eq!(sanitize("---"), "lumina-host");
    }
}
