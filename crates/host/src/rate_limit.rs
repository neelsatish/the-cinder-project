//! A per-computer limit on sign-in and recovery requests.
//!
//! Accounts already lock after repeated wrong passwords. This stops one
//! computer from trying a few passwords against every account instead, and
//! from hammering PIN and recovery endpoints.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{ConnectInfo, Request};
use axum::http::Method;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::error::HostError;

const WINDOW: Duration = Duration::from_secs(60);
/// A classroom signs in once per student per computer; 30 a minute leaves room
/// for typos and a shared teacher machine without allowing guessing at scale.
const MAX_PER_WINDOW: u32 = 30;
/// Above this many tracked computers, expired entries are swept.
const SWEEP_AT: usize = 4_096;

#[derive(Clone, Default)]
pub struct AuthLimiter(Arc<Mutex<HashMap<IpAddr, (Instant, u32)>>>);

impl AuthLimiter {
    // ponytail: fixed one-minute window per address; a sliding window only if
    // bursts at the boundary ever matter.
    fn allow(&self, ip: IpAddr, now: Instant) -> bool {
        let mut seen = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if seen.len() >= SWEEP_AT {
            seen.retain(|_, (start, _)| now.duration_since(*start) < WINDOW);
        }
        let entry = seen.entry(ip).or_insert((now, 0));
        if now.duration_since(entry.0) >= WINDOW {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= MAX_PER_WINDOW
    }
}

/// Middleware: limits POSTs under `/api/auth/` per client address. Requests
/// without a peer address (in-process tests) are not limited.
pub async fn limit_auth(limiter: AuthLimiter, request: Request, next: Next) -> Response {
    let peer = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ConnectInfo(peer)| peer.ip());
    if request.method() == Method::POST && request.uri().path().starts_with("/api/auth/") {
        if let Some(ip) = peer {
            if !limiter.allow(ip, Instant::now()) {
                return HostError::RateLimited.into_response();
            }
        }
    }
    next.run(request).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_computer_gets_its_own_budget_that_refills() {
        let limiter = AuthLimiter::default();
        let (one, two): (IpAddr, IpAddr) = (
            "192.168.1.10".parse().unwrap(),
            "192.168.1.11".parse().unwrap(),
        );
        let start = Instant::now();
        for _ in 0..MAX_PER_WINDOW {
            assert!(limiter.allow(one, start));
        }
        assert!(!limiter.allow(one, start));
        assert!(limiter.allow(two, start), "another computer is unaffected");
        assert!(limiter.allow(one, start + WINDOW), "the budget refills");
    }
}
