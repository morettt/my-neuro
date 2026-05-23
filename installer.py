import tkinter as tk
from tkinter import ttk, scrolledtext
import threading, os, sys, subprocess, tarfile, re, urllib.request, traceback
from datetime import datetime

CONDA_ENV_MODEL = "morelle/my-neuro-env"
CONDA_ENV_FILE  = "my-neuro-env.tar.gz"
BATCH_SCRIPT    = "full-hub/Batch_Download.py"
INSTALL_DIR     = os.path.dirname(os.path.abspath(sys.argv[0]))

BG     = "#1c1c1e"
SIDE   = "#111113"
CARD   = "#2c2c2e"
ACCENT = "#7c6af7"
GREEN  = "#30d158"
GRAY   = "#636366"
FG     = "#ffffff"
FG2    = "#8e8e93"
RED    = "#ff453a"
SEP    = "#38383a"
A2     = "#6a58d4"

PAGE_ORDER = ["welcome", "components", "confirm", "installing", "done"]
STEP_INFO  = [
    ("components", "选择组件"),
    ("confirm",    "确认安装"),
    ("installing", "安装中"),
]


class InstallerApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("My-Neuro Installer")
        self.configure(bg=BG)
        self.resizable(False, False)
        self.checks   = {}
        self._vram_ok = True
        self._log_path = os.path.join(INSTALL_DIR, "installer.log")
        self._log_file = open(self._log_path, "w", encoding="utf-8", buffering=1)
        self._build_ui()
        self._build_pages()
        self._show("welcome")
        w, h = 700, 460
        sw, sh = self.winfo_screenwidth(), self.winfo_screenheight()
        self.geometry(f"{w}x{h}+{(sw-w)//2}+{(sh-h)//2}")

    # ── 外壳 ──────────────────────────────────────────────
    def _build_ui(self):
        sidebar = tk.Frame(self, bg=SIDE, width=190)
        sidebar.pack(side="left", fill="y")
        sidebar.pack_propagate(False)

        inner = tk.Frame(sidebar, bg=SIDE)
        inner.pack(fill="both", expand=True, padx=22, pady=28)

        tk.Label(inner, text="My-Neuro", bg=SIDE, fg=FG,
                 font=("Segoe UI", 14, "bold")).pack(anchor="w")
        tk.Label(inner, text="AI 虚拟伴侣", bg=SIDE, fg=GRAY,
                 font=("Segoe UI", 9)).pack(anchor="w", pady=(2, 0))

        tk.Frame(inner, bg=SEP, height=1).pack(fill="x", pady=24)

        self._step_frames = {}
        for page, label in STEP_INFO:
            row = tk.Frame(inner, bg=SIDE)
            row.pack(fill="x", pady=5)
            dot = tk.Label(row, text="○", bg=SIDE, fg=GRAY,
                           font=("Segoe UI", 10))
            dot.pack(side="left")
            lbl = tk.Label(row, text=label, bg=SIDE, fg=GRAY,
                           font=("Segoe UI", 9))
            lbl.pack(side="left", padx=10)
            self._step_frames[page] = (dot, lbl)

        right = tk.Frame(self, bg=BG)
        right.pack(side="left", fill="both", expand=True)

        self._content = tk.Frame(right, bg=BG)
        self._content.pack(fill="both", expand=True)

        tk.Frame(right, bg=SEP, height=1).pack(fill="x")
        self._nav = tk.Frame(right, bg=BG, height=52)
        self._nav.pack(fill="x")
        self._nav.pack_propagate(False)

        self._btn_back = tk.Button(
            self._nav, text="上一步", bg=BG, fg=FG2,
            relief="flat", cursor="hand2", bd=0, padx=14, pady=6,
            font=("Segoe UI", 9),
            activebackground=CARD, activeforeground=FG,
            command=self._back)
        self._btn_next = tk.Button(
            self._nav, text="下一步", bg=ACCENT, fg=FG,
            relief="flat", cursor="hand2", bd=0, padx=20, pady=6,
            font=("Segoe UI", 9, "bold"),
            activebackground=A2, activeforeground=FG,
            command=self._next)

    def _update_steps(self, current):
        pages = [p for p, _ in STEP_INFO]
        cur = pages.index(current) if current in pages else -1
        for i, (page, _) in enumerate(STEP_INFO):
            dot, lbl = self._step_frames[page]
            if i < cur:
                dot.configure(text="●", fg=GREEN)
                lbl.configure(fg=FG2, font=("Segoe UI", 9))
            elif i == cur:
                dot.configure(text="●", fg=ACCENT)
                lbl.configure(fg=FG, font=("Segoe UI", 9, "bold"))
            else:
                dot.configure(text="○", fg=GRAY)
                lbl.configure(fg=GRAY, font=("Segoe UI", 9))

    # ── 页面管理 ───────────────────────────────────────────
    def _build_pages(self):
        self._pages   = {}
        self._current = None
        for name in PAGE_ORDER:
            self._pages[name] = getattr(self, f"_page_{name}")()

    def _show(self, name):
        if self._current:
            self._pages[self._current].pack_forget()
        self._current = name
        self._pages[name].pack(fill="both", expand=True)
        self._update_steps(name)

        self._btn_back.pack_forget()
        self._btn_next.pack_forget()

        if name == "welcome":
            self._btn_next.configure(
                text="开始", bg=ACCENT, fg=FG,
                activebackground=A2, state="normal", command=self._next)
            self._btn_next.pack(side="right", padx=18, pady=10)

        elif name == "components":
            self._btn_back.pack(side="left", padx=18, pady=10)
            self._btn_next.configure(
                text="下一步", bg=ACCENT, fg=FG,
                activebackground=A2, state="normal", command=self._next)
            self._btn_next.pack(side="right", padx=18, pady=10)

        elif name == "confirm":
            self._refresh_confirm()
            self._btn_back.pack(side="left", padx=18, pady=10)
            if self._vram_ok:
                self._btn_next.configure(
                    text="开始安装", bg=GREEN, fg=BG,
                    activebackground="#27b84d", state="normal",
                    command=self._start)
            else:
                self._btn_next.configure(
                    text="显存不足", bg=CARD, fg=GRAY,
                    activebackground=CARD, state="disabled")
            self._btn_next.pack(side="right", padx=18, pady=10)

        elif name == "done":
            self._btn_next.configure(
                text="关闭", bg=CARD, fg=FG2,
                activebackground=SEP, state="normal",
                command=self.destroy)
            self._btn_next.pack(side="right", padx=18, pady=10)

    def _next(self):
        idx = PAGE_ORDER.index(self._current)
        if idx < len(PAGE_ORDER) - 1:
            self._show(PAGE_ORDER[idx + 1])

    def _back(self):
        idx = PAGE_ORDER.index(self._current)
        if idx > 0:
            self._show(PAGE_ORDER[idx - 1])

    # ── 欢迎页 ────────────────────────────────────────────
    def _page_welcome(self):
        f = tk.Frame(self._content, bg=BG)
        tk.Label(f, bg=BG).pack(expand=True)
        tk.Label(f, text="My-Neuro", bg=BG, fg=FG,
                 font=("Segoe UI", 32, "bold")).pack()
        tk.Label(f, text="AI 虚拟伴侣", bg=BG, fg=ACCENT,
                 font=("Segoe UI", 11)).pack(pady=(4, 0))
        tk.Label(f, text="向导将自动下载并配置所有必要组件",
                 bg=BG, fg=GRAY, font=("Segoe UI", 9)).pack(pady=(16, 0))
        tk.Label(f, bg=BG).pack(expand=True)
        return f

    # ── 组件选择页 ────────────────────────────────────────
    def _page_components(self):
        f = tk.Frame(self._content, bg=BG)

        tk.Label(f, text="选择组件", bg=BG, fg=FG,
                 font=("Segoe UI", 14, "bold")).pack(anchor="w", padx=30, pady=(26, 4))
        tk.Label(f, text="选择需要安装的功能模块",
                 bg=BG, fg=FG2, font=("Segoe UI", 9)).pack(anchor="w", padx=30)

        items = [
            ("asr",    "ASR",    "语音识别",  "~2 GB",   True,  False),
            ("bert",   "BERT",   "语言理解",  "~1 GB",   True,  False),
            ("tts",    "TTS",    "语音合成",  "~4 GB",   True,  False),
            ("live2d", "Live2D", "立绘模型",  "~200 MB", True,  False),
            ("rag",    "RAG",    "长期记忆",  "~2 GB",   False, True),
        ]

        box = tk.Frame(f, bg=CARD)
        box.pack(fill="x", padx=30, pady=18)

        header = tk.Frame(box, bg=CARD)
        header.pack(fill="x", padx=12, pady=(8, 0))
        tk.Label(header, text="组件", bg=CARD, fg=GRAY,
                 font=("Segoe UI", 7), width=20, anchor="w").pack(side="left")
        tk.Label(header, text="下载大小", bg=CARD, fg=GRAY,
                 font=("Segoe UI", 7)).pack(side="right")
        tk.Frame(box, bg=SEP, height=1).pack(fill="x")

        for idx, (key, tag, desc, size, default, optional) in enumerate(items):
            var = tk.BooleanVar(value=default)
            self.checks[key] = var
            if idx > 0:
                tk.Frame(box, bg=SEP, height=1).pack(fill="x")
            row = tk.Frame(box, bg=CARD)
            row.pack(fill="x")
            tk.Checkbutton(row, variable=var, bg=CARD, fg=FG,
                           selectcolor=CARD, activebackground=CARD,
                           activeforeground=ACCENT, cursor="hand2",
                           relief="flat", bd=0).pack(side="left", padx=(12, 4), pady=10)
            tk.Label(row, text=tag, bg=CARD, fg=FG,
                     font=("Segoe UI", 9, "bold"), width=6, anchor="w").pack(side="left")
            tk.Label(row, text=desc, bg=CARD, fg=FG2,
                     font=("Segoe UI", 9)).pack(side="left")
            rf = tk.Frame(row, bg=CARD)
            rf.pack(side="right", padx=14)
            if optional:
                tk.Label(rf, text="可选", bg=CARD, fg=GRAY,
                         font=("Segoe UI", 7)).pack(side="right", padx=(4, 0))
            tk.Label(rf, text=size, bg=CARD, fg=GRAY,
                     font=("Consolas", 8)).pack(side="right")

        return f

    # ── 确认页 ────────────────────────────────────────────
    def _page_confirm(self):
        f = tk.Frame(self._content, bg=BG)
        tk.Label(f, text="确认安装", bg=BG, fg=FG,
                 font=("Segoe UI", 14, "bold")).pack(anchor="w", padx=30, pady=(26, 4))
        tk.Label(f, text="请核对以下信息",
                 bg=BG, fg=FG2, font=("Segoe UI", 9)).pack(anchor="w", padx=30)
        self._confirm_box = tk.Frame(f, bg=CARD)
        self._confirm_box.pack(fill="x", padx=30, pady=18)
        return f

    def _detect_gpu(self):
        try:
            r = subprocess.run(
                ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW)
            name = r.stdout.strip().splitlines()[0].strip()
            if r.returncode == 0 and name:
                return name
        except Exception:
            pass
        try:
            cmd = ("(Get-CimInstance Win32_VideoController"
                   " | Where-Object { $_.Name -notlike 'Microsoft*' }"
                   " | Select-Object -First 1).Name")
            r = subprocess.run(
                ["powershell", "-NoProfile", "-Command", cmd],
                capture_output=True, text=True, timeout=5, encoding="utf-8",
                creationflags=subprocess.CREATE_NO_WINDOW)
            name = r.stdout.strip()
            if r.returncode == 0 and name:
                return name
        except Exception:
            pass
        return "未检测到显卡"

    def _detect_vram_free_mb(self):
        try:
            r = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW)
            if r.returncode == 0:
                return int(r.stdout.strip().splitlines()[0].strip())
        except Exception:
            pass
        return None

    def _refresh_confirm(self):
        for w in self._confirm_box.winfo_children():
            w.destroy()
        labels = {"asr": "ASR", "bert": "BERT", "tts": "TTS",
                  "live2d": "Live2D", "rag": "RAG"}
        sizes  = {"asr": 2.0, "bert": 1.0, "tts": 4.0, "live2d": 0.2, "rag": 2.0}
        selected  = [k for k, v in self.checks.items() if v.get()]
        total_gb  = 3.6 + sum(sizes.get(k, 0) for k in selected)
        comp_text = "  ".join(labels[k] for k in selected) or "（未选择）"
        gpu_name  = self._detect_gpu()
        free_mb   = self._detect_vram_free_mb()

        if free_mb is None:
            vram_text, vram_color = "无法检测（需要 NVIDIA 驱动）", GRAY
            self._vram_ok = False
        elif free_mb < 5120:
            vram_text  = f"{free_mb/1024:.1f} GB 可用  —  至少需要 5 GB"
            vram_color = RED
            self._vram_ok = False
        else:
            vram_text, vram_color = f"{free_mb/1024:.1f} GB 可用", GREEN
            self._vram_ok = True

        rows = [
            ("安装组件", comp_text,              FG),
            ("显卡",    gpu_name,                FG),
            ("显存",    vram_text,               vram_color),
            ("需下载", f"约 {total_gb:.1f} GB", FG),
        ]
        for i, (k, v, color) in enumerate(rows):
            if i > 0:
                tk.Frame(self._confirm_box, bg=SEP, height=1).pack(fill="x")
            row = tk.Frame(self._confirm_box, bg=CARD)
            row.pack(fill="x", padx=16, pady=10)
            tk.Label(row, text=k, bg=CARD, fg=GRAY, font=("Segoe UI", 8),
                     width=8, anchor="w").pack(side="left")
            tk.Label(row, text=v, bg=CARD, fg=color, font=("Segoe UI", 9),
                     anchor="w", wraplength=320, justify="left").pack(side="left", padx=10)

    # ── 安装中页 ──────────────────────────────────────────
    def _page_installing(self):
        f = tk.Frame(self._content, bg=BG)

        tk.Label(f, text="正在安装", bg=BG, fg=FG,
                 font=("Segoe UI", 14, "bold")).pack(anchor="w", padx=30, pady=(26, 4))

        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("main.Horizontal.TProgressbar",
                        troughcolor=CARD, background=ACCENT,
                        bordercolor=CARD, lightcolor=ACCENT, darkcolor=ACCENT,
                        thickness=4)
        style.configure("file.Horizontal.TProgressbar",
                        troughcolor=CARD, background=GREEN,
                        bordercolor=CARD, lightcolor=GREEN, darkcolor=GREEN,
                        thickness=2)

        prog = tk.Frame(f, bg=BG)
        prog.pack(fill="x", padx=30, pady=(8, 0))

        row1 = tk.Frame(prog, bg=BG)
        row1.pack(fill="x", pady=(0, 4))
        tk.Label(row1, text="总进度", bg=BG, fg=GRAY,
                 font=("Segoe UI", 8)).pack(side="left")
        self.pct_label = tk.Label(row1, text="0%", bg=BG, fg=ACCENT,
                                  font=("Segoe UI", 8, "bold"))
        self.pct_label.pack(side="right")

        self.progress = ttk.Progressbar(prog, style="main.Horizontal.TProgressbar",
                                        mode="determinate")
        self.progress.pack(fill="x", pady=(0, 12))

        row2 = tk.Frame(prog, bg=BG)
        row2.pack(fill="x", pady=(0, 4))
        tk.Label(row2, text="当前文件", bg=BG, fg=GRAY,
                 font=("Segoe UI", 8)).pack(side="left")
        self.file_label = tk.Label(row2, text="准备中...", bg=BG, fg=FG2,
                                   font=("Segoe UI", 8), anchor="e")
        self.file_label.pack(side="right")

        self.file_progress = ttk.Progressbar(prog, style="file.Horizontal.TProgressbar",
                                             mode="determinate")
        self.file_progress.pack(fill="x")

        tk.Frame(f, bg=SEP, height=1).pack(fill="x", padx=30, pady=(18, 0))
        self.log = scrolledtext.ScrolledText(
            f, bg=CARD, fg=FG2, font=("Consolas", 8),
            relief="flat", state="disabled", wrap="word",
            insertbackground=FG,
            highlightthickness=0)
        self.log.pack(fill="both", expand=True, padx=30, pady=(0, 0))
        return f

    # ── 完成页 ────────────────────────────────────────────
    def _page_done(self):
        f = tk.Frame(self._content, bg=BG)
        tk.Label(f, bg=BG).pack(expand=True)
        self._done_icon  = tk.Label(f, text="✓", bg=BG, fg=GREEN,
                                    font=("Segoe UI", 48))
        self._done_icon.pack()
        self._done_title = tk.Label(f, text="安装完成", bg=BG, fg=FG,
                                    font=("Segoe UI", 14, "bold"))
        self._done_title.pack(pady=(8, 0))
        self._done_sub   = tk.Label(f, text="",
                                    bg=BG, fg=FG2, font=("Segoe UI", 9))
        self._done_sub.pack(pady=(6, 0))
        tk.Label(f, bg=BG).pack(expand=True)
        return f

    # ── 日志 / 进度（线程安全）────────────────────────────
    def log_msg(self, msg):
        ts = datetime.now().strftime("%H:%M:%S")
        line = f"[{ts}] {msg}\n"
        try:
            self._log_file.write(line)
            self._log_file.flush()
        except Exception:
            pass
        def _u():
            self.log.configure(state="normal")
            self.log.insert("end", line)
            self.log.see("end")
            self.log.configure(state="disabled")
        self.after(0, _u)

    def set_progress(self, val, label=""):
        def _u():
            self.progress["value"] = val
            self.pct_label.configure(text=f"{int(val)}%")
            if label:
                self.file_label.configure(text=label)
        self.after(0, _u)

    def set_file_progress(self, pct, label=""):
        def _u():
            self.file_progress["value"] = pct
            if label:
                self.file_label.configure(text=label)
        self.after(0, _u)

    _DL_PAT = re.compile(
        r"Downloading\s+\[(.+?)\].*?(\d+)%.*?([\d.]+[GMKB]+)/([\d.]+[GMKB]+)"
    )

    def _handle_line(self, raw, base_progress):
        line = raw.split("\r")[-1].strip()
        if not line:
            return
        m = self._DL_PAT.search(line)
        if m:
            filename, pct_s, downloaded, total = m.groups()
            self.set_file_progress(int(pct_s),
                                   f"下载  {filename}   {downloaded} / {total}")
        else:
            self.log_msg(line)
            self.set_file_progress(0, line[:80])

    # ── 安装流程 ──────────────────────────────────────────
    def _start(self):
        self._show("installing")
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        install_dir  = INSTALL_DIR
        env_dir      = os.path.join(install_dir, "env")
        env_python   = os.path.join(env_dir, "python.exe")
        tar_path     = os.path.join(install_dir, CONDA_ENV_FILE)
        batch_script = os.path.join(install_dir, BATCH_SCRIPT)

        try:
            if os.path.exists(env_python):
                self.log_msg("env/ 已存在，跳过下载和解压")
                self.set_progress(58, "env 环境已就绪")
            else:
                self.set_progress(5, "下载 Python 环境包（~3.6 GB）...")
                self.log_msg("开始下载 Python 环境包...")

                url = (f"https://modelscope.cn/models/{CONDA_ENV_MODEL}"
                       f"/resolve/master/{CONDA_ENV_FILE}")

                req = urllib.request.Request(
                    url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=60) as resp, \
                     open(tar_path, "wb") as out:
                    total_bytes = int(resp.headers.get("Content-Length", 0))
                    done = 0
                    while True:
                        chunk = resp.read(65536)
                        if not chunk:
                            break
                        out.write(chunk)
                        done += len(chunk)
                        mb_done  = done / 1024 / 1024
                        mb_total = total_bytes / 1024 / 1024 if total_bytes else 3600
                        pct = int(done / total_bytes * 100) if total_bytes else 0
                        self.set_file_progress(
                            pct,
                            f"下载  my-neuro-env.tar.gz   "
                            f"{mb_done:.0f} MB / {mb_total:.0f} MB")
                        self.set_progress(
                            max(5, min(43, int(done / total_bytes * 38) + 5))
                            if total_bytes else 5)

                if not os.path.exists(tar_path):
                    raise RuntimeError("环境包下载失败，文件不存在")
                self.log_msg("环境包下载完成")

                self.set_progress(45, "正在解压环境包...")
                self.log_msg("开始解压...")
                with tarfile.open(tar_path, "r:gz") as tar:
                    members = tar.getmembers()
                    total   = len(members)
                    for i, m in enumerate(members):
                        tar.extract(m, path=env_dir)
                        if i % 300 == 0:
                            p = int(i / total * 10) + 45
                            self.set_progress(p)
                            self.set_file_progress(
                                int(i / total * 100),
                                f"解压中...  {i} / {total} 文件")
                os.remove(tar_path)
                self.log_msg("解压完成")
                self.set_progress(58, "环境就绪")

            self.set_progress(60, "开始下载模型...")
            self.log_msg("开始下载所选模型...")

            flags = []
            if self.checks["asr"].get():    flags.append("--asr")
            if self.checks["bert"].get():   flags.append("--bert")
            if self.checks["tts"].get():    flags.append("--tts")
            if self.checks["rag"].get():    flags.append("--rag")
            if self.checks["live2d"].get(): flags.append("--live2d")

            if flags:
                cmd = [env_python, batch_script] + flags
                proc = subprocess.Popen(
                    cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    encoding="utf-8", errors="replace", bufsize=1,
                    cwd=install_dir,
                    creationflags=subprocess.CREATE_NO_WINDOW)
                step = 60.0
                for line in proc.stdout:
                    self._handle_line(line, step)
                    if step < 95:
                        step += 0.2
                    self.set_progress(int(step))
                proc.wait()
                if proc.returncode != 0:
                    raise RuntimeError("模型下载失败")

            self.set_progress(100, "安装完成")
            self.set_file_progress(100, "")
            self.log_msg("安装成功")
            self._done_icon.configure(text="✓", fg=GREEN)
            self._done_title.configure(text="安装完成")
            self._done_sub.configure(text="")
            self._show("done")

        except Exception as e:
            tb = traceback.format_exc()
            self.log_msg(f"[错误] {e}")
            try:
                self._log_file.write(tb)
                self._log_file.flush()
            except Exception:
                pass
            self.set_progress(0, "安装失败")
            self._done_icon.configure(text="✗", fg=RED)
            self._done_title.configure(text="安装失败")
            self._done_sub.configure(text=f"{e}\n日志: {self._log_path}")
            self._show("done")


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    app = InstallerApp()
    app.mainloop()
