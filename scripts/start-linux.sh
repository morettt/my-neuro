#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${1:-}" == --software-rendering ]]; then
    export MY_NEURO_SOFTWARE_RENDERING=1
    shift
fi
cd "$root/live-2d"
if [[ ! -x node_modules/electron/dist/electron ]]; then
    echo 'Electron is missing. Run ./scripts/setup-linux.sh first.' >&2; exit 1
fi
# Keep desktop-session variables (Wayland, D-Bus, PipeWire) from the caller.
unset ELECTRON_RUN_AS_NODE
exec node_modules/electron/dist/electron control-main.js "$@"
