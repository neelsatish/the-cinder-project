#!/usr/bin/env bash
set -euo pipefail

ROLE="${1:-teacher}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

case "$ROLE" in
  teacher) npm run app:dev --workspace @cinder/teacher ;;
  student) npm run app:dev --workspace @cinder/student ;;
  *) echo "Usage: $0 teacher|student" >&2; exit 2 ;;
esac
