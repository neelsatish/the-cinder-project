use std::ffi::OsString;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::path::PathBuf;

use anyhow::{bail, Context, Result};
use cinder_ai::Ai;
use cinder_core::DEFAULT_HOST_PORT;
use cinder_host::{discovery, AppState};

struct Options {
    data_dir: PathBuf,
    bind: IpAddr,
    port: u16,
    name: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,cinder_host=debug".into()),
        )
        .init();

    let options = parse_options(std::env::args_os().skip(1))?;
    let state = AppState::open(&options.data_dir, Ai::disabled())?;
    let bootstrap_pin = cinder_host::routes::auth::prepare_bootstrap_pin(&state.pool)?;
    let listener = cinder_host::bind(SocketAddr::new(options.bind, options.port))?;
    let port = listener.local_addr()?.port();
    let advertised = discovery::advertise(port, &options.name)
        .map_err(|error| tracing::warn!(?error, "mDNS unavailable; use the LAN URL shown below"))
        .ok();

    println!("Cinder Host data: {}", options.data_dir.display());
    match lan_ip(options.bind) {
        Some(ip) => println!("Cinder Host LAN URL: http://{ip}:{port}"),
        None => println!("Cinder Host LAN URL: http://<this-computer-ip>:{port}"),
    }
    if let Some(pin) = bootstrap_pin {
        println!("First-school setup PIN (expires in 15 minutes): {pin}");
    }

    let result = cinder_host::serve_on(state, listener).await;
    if let Some(daemon) = advertised {
        let _ = daemon.shutdown();
    }
    result
}

fn parse_options(args: impl Iterator<Item = OsString>) -> Result<Options> {
    let mut data_dir = None;
    let mut bind = IpAddr::V4(Ipv4Addr::UNSPECIFIED);
    let mut port = DEFAULT_HOST_PORT;
    let mut name = "Cinder Host".to_owned();
    let mut args = args.peekable();
    while let Some(argument) = args.next() {
        let argument = argument.to_string_lossy();
        match argument.as_ref() {
            "--data-dir" => {
                data_dir = Some(PathBuf::from(
                    args.next().context("--data-dir requires a path")?,
                ));
            }
            "--bind" => {
                bind = args
                    .next()
                    .context("--bind requires an IP address")?
                    .to_string_lossy()
                    .parse()
                    .context("invalid --bind IP address")?;
            }
            "--port" => {
                port = args
                    .next()
                    .context("--port requires a number")?
                    .to_string_lossy()
                    .parse()
                    .context("invalid --port")?;
            }
            "--name" => {
                name = args
                    .next()
                    .context("--name requires text")?
                    .to_string_lossy()
                    .trim()
                    .to_owned();
                if name.is_empty() {
                    bail!("--name cannot be empty");
                }
            }
            "--help" | "-h" => {
                println!(
                    "Usage: cinder-host --data-dir <path> [--bind <ip>] [--port <port>] [--name <discovery name>]"
                );
                std::process::exit(0);
            }
            other => bail!("unknown option: {other}"),
        }
    }
    Ok(Options {
        data_dir: data_dir.context("--data-dir is required; choose where school data is stored")?,
        bind,
        port,
        name,
    })
}

fn lan_ip(bind: IpAddr) -> Option<IpAddr> {
    if !bind.is_unspecified() {
        return Some(bind);
    }
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    let ip = socket.local_addr().ok()?.ip();
    (!ip.is_loopback() && !ip.is_unspecified()).then_some(ip)
}

#[cfg(test)]
mod tests {
    use super::parse_options;
    use std::ffi::OsString;

    #[test]
    fn standalone_host_requires_an_explicit_data_directory() {
        assert!(parse_options(std::iter::empty()).is_err());
        let options = parse_options(
            ["--data-dir", "school-data", "--port", "7474"]
                .into_iter()
                .map(OsString::from),
        )
        .unwrap();
        assert_eq!(options.data_dir, std::path::PathBuf::from("school-data"));
        assert_eq!(options.port, 7474);
    }
}
