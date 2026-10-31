#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root/live-2d"
if [[ ! -x node_modules/electron/dist/electron ]]; then
    echo 'Electron is missing. Run ./scripts/setup-linux.sh first.' >&2; exit 1
fi
# Keep desktop-session variables (Wayland, D-Bus, PipeWire) from the caller.
unset ELECTRON_RUN_AS_NODE
exec node scripts/launch.cjs control "$@"
