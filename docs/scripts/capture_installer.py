"""Screenshot the upstream installer wizard pages without starting a real install."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from PIL import ImageGrab

ROOT = Path(r"K:\neruo\my-neuro-docs")
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

OUT = Path(__file__).resolve().parents[1] / "public" / "images"
OUT.mkdir(parents=True, exist_ok=True)

import tkinter as tk
import installer as inst  # noqa: E402


def grab(app, name):
    app.update()
    app.update_idletasks()
    app.lift()
    app.attributes("-topmost", True)
    time.sleep(0.45)
    x = app.winfo_rootx()
    y = app.winfo_rooty()
    w = app.winfo_width()
    h = app.winfo_height()
    img = ImageGrab.grab(bbox=(x, y, x + w, y + h))
    path = OUT / name
    img.save(path)
    print("wrote", path, img.size)


def main():
    backdrop = tk.Tk()
    backdrop.overrideredirect(True)
    backdrop.configure(bg="#111113")
    backdrop.geometry(f"{backdrop.winfo_screenwidth()}x{backdrop.winfo_screenheight()}+0+0")
    backdrop.attributes("-topmost", True)
    backdrop.update()

    app = inst.InstallerApp()
    app.attributes("-topmost", True)
    app.geometry("700x460+200+160")
    grab(app, "installer-welcome.png")
    app._show("components")
    grab(app, "installer-components.png")
    app._show("confirm")
    try:
        app._refresh_confirm()
    except Exception as exc:
        print("confirm refresh:", exc)
    grab(app, "installer-confirm.png")
    app.destroy()
    backdrop.destroy()


if __name__ == "__main__":
    main()
