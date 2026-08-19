#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname -s)" != "Linux" ]; then
  echo "Linux .deb and AppImage bundles must be built on Linux." >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

npm run typecheck
npm run test:gradebook-intent
npm run audit:dependencies
npm run build:student
npm run build:teacher
cargo fmt --all -- --check
cargo test --workspace --locked
npm run bundle:student
npm run bundle:teacher

echo "Cinder Student and Teacher installers are ready under target/release/bundle/."
