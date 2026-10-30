#!/usr/bin/env python3
"""Install a per-user launcher and the identity required by Wayland portals."""
import json
import os
import shutil
from pathlib import Path

root = Path(__file__).resolve().parent.parent
node = shutil.which('node')
if not node:
    raise SystemExit('Node.js not found; run the Linux setup script from your Node.js environment.')

# Use the absolute Node executable: desktop menus need not inherit nvm's PATH.
# Desktop Entry Exec quoting is not shell quoting.
def quote_exec(value):
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$').replace('%', '%%') + '"'

quoted = f"{quote_exec(node)} {quote_exec(root / 'live-2d/scripts/launch.cjs')} control"
if os.environ.get('MY_NEURO_SOFTWARE_RENDERING') == '1':
    quoted += ' --software-rendering'
    settings = root / 'live-2d/.runtime/linux-settings.json'
    settings.parent.mkdir(parents=True, exist_ok=True)
    existing = json.loads(settings.read_text()) if settings.exists() else {}
    settings.write_text(json.dumps({**existing, 'softwareRendering': True}, indent=2) + '\n')
applications = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share')) / 'applications'
applications.mkdir(parents=True, exist_ok=True)
entry = applications / 'io.github.morettt.MyNeuro.desktop'
entry.write_text(
    '[Desktop Entry]\nType=Application\nName=My-Neuro\n'
    f'Exec={quoted}\nIcon=applications-games\nTerminal=false\nCategories=Utility;\n',
    encoding='utf-8',
)
print(f'Installed launcher: {entry}')
