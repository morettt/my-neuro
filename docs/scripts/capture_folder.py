"""Render a directory listing image from the real upstream clone root."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(r"K:\neruo\my-neuro-docs")
OUT = Path(__file__).resolve().parents[1] / "public" / "images"
OUT.mkdir(parents=True, exist_ok=True)

KEEP = {
    "1.ASR.bat",
    "2.TTS.bat",
    "3.bert.bat",
    "4.MEMOS-API.bat",
    "installer.py",
    "live-2d",
    "README.md",
    "RAG.bat",
    "update.py",
}


def main():
    names = []
    for p in sorted(ROOT.iterdir(), key=lambda x: (x.is_file(), x.name.lower())):
        if p.name.startswith("."):
            continue
        if p.name in KEEP or p.suffix.lower() in {".bat", ".md", ".py"} or p.is_dir():
            mark = "[DIR] " if p.is_dir() else "      "
            names.append(mark + p.name)
    names = names[:28]

    img = Image.new("RGB", (980, 62 + 28 * len(names) + 40), "#1c1c1e")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("segoeui.ttf", 18)
        title_font = ImageFont.truetype("segoeuib.ttf", 22)
    except OSError:
        font = ImageFont.load_default()
        title_font = font
    draw.text((24, 18), "安装目录（上游克隆实机列出）", fill="#ffffff", font=title_font)
    y = 58
    for line in names:
        color = "#7c6af7" if line.startswith("[DIR]") else "#e8e8ed"
        draw.text((28, y), line, fill=color, font=font)
        y += 28
    path = OUT / "install-folder.png"
    img.save(path)
    print("wrote", path)


if __name__ == "__main__":
    main()
