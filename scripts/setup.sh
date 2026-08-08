#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

. /etc/os-release
case "${ID:-}${ID_LIKE:-}" in
  *debian*|*ubuntu*) ;;
  *) echo "This setup script supports Linux Mint, Ubuntu and Debian." >&2; exit 1 ;;
esac

$SUDO apt-get update
$SUDO apt-get install -y \
  build-essential curl file pkg-config libssl-dev libgtk-3-dev librsvg2-dev \
  libayatana-appindicator3-dev libwebkit2gtk-4.1-dev patchelf nodejs npm

if ! command -v rustc >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/lumina-rustup.sh
  sh /tmp/lumina-rustup.sh -y --profile minimal
  # shellcheck disable=SC1090
  . "${HOME}/.cargo/env"
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"
npm install --no-audit --no-fund
cargo fmt --all -- --check
npm run typecheck

echo "Lumina development setup is ready."
