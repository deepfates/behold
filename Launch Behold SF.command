#!/bin/zsh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

if ! command -v npm >/dev/null 2>&1; then
  echo "Behold requires Node.js 22 or newer on PATH."
  read -k 1
  exit 1
fi

mkdir -p "$ROOT/.behold-runtime"
LOG="$ROOT/.behold-runtime/native-launch.log"
exec > >(tee "$LOG") 2>&1

echo "Starting Behold's San Francisco world…"
npm run play
STATUS=$?

if [[ $STATUS -ne 0 ]]; then
  echo
  echo "Launch failed. Press any key to close this window."
  read -k 1
fi

exit $STATUS
