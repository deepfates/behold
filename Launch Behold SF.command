#!/bin/zsh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export PATH="/Users/deepfates/.nvm/versions/node/v22.14.0/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

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
