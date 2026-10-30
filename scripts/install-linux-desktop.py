#!/usr/bin/env python3
"""Install a per-user launcher and the identity required by Wayland portals."""
import os
from pathlib import Path

root = Path(__file__).resolve().parent.parent
launcher = str(root / "scripts/start-linux.sh")
# Desktop Entry Exec quoting is not shell quoting.
quoted = '"' + launcher.replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$').replace('%', '%%') + '"'
if os.environ.get('MY_NEURO_SOFTWARE_RENDERING') == '1':
    quoted += ' --software-rendering'
applications = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share')) / 'applications'
applications.mkdir(parents=True, exist_ok=True)
entry = applications / 'io.github.morettt.MyNeuro.desktop'
entry.write_text(
    '[Desktop Entry]\nType=Application\nName=My-Neuro\n'
    f'Exec={quoted}\nIcon=applications-games\nTerminal=false\nCategories=Utility;\n',
    encoding='utf-8',
)
print(f'Installed launcher: {entry}')
