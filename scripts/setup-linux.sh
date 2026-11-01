#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
if [[ "$(uname -s)" != Linux ]]; then echo 'This setup script requires Linux.' >&2; exit 1; fi
command -v node >/dev/null
command -v npm >/dev/null
command -v python3 >/dev/null
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || major === 22 && minor < 12) { console.error("Node.js 22.12+ is required"); process.exit(1); }'
python3 -m venv env
env/bin/python -m pip install -r requirements-linux.txt
(cd live-2d && npm ci && node node_modules/electron/install.js)
python3 scripts/install-linux-desktop.py
echo 'Ready: ./scripts/start-linux.sh'
echo 'Configure your LLM and optional cloud voice provider in the control panel.'
echo 'Local ASR/BERT/TTS models and their inference dependencies are installed separately; see docs/deploy/linux.md.'
