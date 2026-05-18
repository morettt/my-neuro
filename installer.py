import tkinter as tk
from tkinter import ttk, filedialog, messagebox, scrolledtext
import threading
import os
import sys
import subprocess
import tarfile
import time
import re
from datetime import datetime

CONDA_ENV_MODEL = "morelle/my-neuro-env"
CONDA_ENV_FILE  = "my-neuro-env.tar.gz"
BATCH_SCRIPT    = "full-hub/Batch_Download.py"
INSTALL_DIR     = os.path.dirname(os.path.abspath(sys.argv[0]))

BG    = "#0f0f17"
BG2   = "#1a1a2e"
CARD  = "#16213e"
ACC   = "#0f3460"
BLUE  = "#4fc3f7"
GREEN = "#69f0ae"
GRAY  = "#607d8b"
FG    = "#eceff1"
FG2   = "#90a4ae"
RED   = "#ef5350"


class InstallerApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("My-Neuro Installer")
        self.configure(bg=BG)
        self.resizable(False, False)
        self._build_ui()
        w, h = 700, 680
        sw, sh = self.winfo_screenwidth(), self.winfo_screenheight()
        self.geometry(f"{w}x{h}+{(sw-w)//2}+{(sh-h)//2}")

    # ── UI ──────────────────────────────────────────────
    def _build_ui(self):
        # 顶部标题栏
        header = tk.Frame(self, bg=ACC, height=64)
        header.pack(fill="x")
        header.pack_propagate(False)
        tk.Label(header, text="My-Neuro  Installer",
                 bg=ACC, fg=FG, font=("Segoe UI", 16, "bold")).pack(side="left", padx=20)
        tk.Label(header, text="AI 虚拟伴侣一键安装",
                 bg=ACC, fg=FG2, font=("Segoe UI", 9)).pack(side="left")

        body = tk.Frame(self, bg=BG)
        body.pack(fill="both", expand=True, padx=20, pady=14)

        # 安装目录
        self._section(body, "安装目录")
        dir_row = tk.Frame(body, bg=BG)
        dir_row.pack(fill="x", pady=(0, 12))
        self.dir_var = tk.StringVar(value=INSTALL_DIR)
        tk.Entry(dir_row, textvariable=self.dir_var,
                 bg=CARD, fg=FG, insertbackground=FG,
                 relief="flat", font=("Consolas", 9),
                 highlightthickness=1, highlightbackground=GRAY,
                 highlightcolor=BLUE).pack(side="left", fill="x", expand=True, ipady=5)
        tk.Button(dir_row, text="  浏览  ", bg=ACC, fg=FG,
                  relief="flat", cursor="hand2", font=("Segoe UI", 9),
                  activebackground=BLUE, activeforeground=BG,
                  command=self._browse).pack(side="left", padx=(6, 0), ipady=5)

        # 组件选择
        self._section(body, "组件选择")
        self.checks = {}
        items = [
            ("asr",    "ASR    语音识别",   "~2 GB",   True,  False),
            ("bert",   "BERT   语言理解",   "~1 GB",   True,  False),
            ("tts",    "TTS    语音合成",   "~4 GB",   True,  False),
            ("live2d", "Live2D 立绘模型",   "~200 MB", True,  False),
            ("rag",    "RAG    长期记忆",   "~2 GB",   False, True),
        ]
        grid = tk.Frame(body, bg=BG)
        grid.pack(fill="x", pady=(0, 12))
        for i, (key, label, size, default, optional) in enumerate(items):
            var = tk.BooleanVar(value=default)
            self.checks[key] = var
            card = tk.Frame(grid, bg=CARD, pady=6, padx=10)
            card.grid(row=i//2, column=i%2, sticky="ew", padx=(0,6) if i%2==0 else (0,0), pady=3)
            grid.columnconfigure(0, weight=1)
            grid.columnconfigure(1, weight=1)
            cb = tk.Checkbutton(card, variable=var, bg=CARD,
                                fg=FG, selectcolor=CARD,
                                activebackground=CARD, activeforeground=BLUE,
                                cursor="hand2")
            cb.pack(side="left")
            tk.Label(card, text=label, bg=CARD, fg=FG,
                     font=("Segoe UI", 9), anchor="w").pack(side="left")
            tag = "可选" if optional else ""
            tk.Label(card, text=f"{size}  {tag}", bg=CARD,
                     fg=GRAY, font=("Consolas", 8)).pack(side="right")

        # 显卡类型
        self._section(body, "显卡类型")
        gpu_row = tk.Frame(body, bg=BG)
        gpu_row.pack(fill="x", pady=(0, 12))
        self.gpu_var = tk.StringVar(value="non-50")
        for val, label in [("non-50", "标准版（GTX / RTX 10~40系）"),
                            ("50",    "RTX 50 系专属")]:
            tk.Radiobutton(gpu_row, text=label, variable=self.gpu_var,
                           value=val, bg=BG, fg=FG2,
                           selectcolor=BG, activebackground=BG,
                           activeforeground=BLUE,
                           font=("Segoe UI", 9)).pack(side="left", padx=(0, 20))

        # 进度区域
        tk.Frame(body, bg=GRAY, height=1).pack(fill="x", pady=8)

        prog_frame = tk.Frame(body, bg=BG)
        prog_frame.pack(fill="x")

        # 总进度
        top_row = tk.Frame(prog_frame, bg=BG)
        top_row.pack(fill="x", pady=(0, 4))
        tk.Label(top_row, text="总进度", bg=BG, fg=FG2,
                 font=("Segoe UI", 8)).pack(side="left")
        self.pct_label = tk.Label(top_row, text="0%", bg=BG,
                                  fg=BLUE, font=("Segoe UI", 8, "bold"))
        self.pct_label.pack(side="right")

        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("main.Horizontal.TProgressbar",
                        troughcolor=CARD, background=BLUE, thickness=10)
        self.progress = ttk.Progressbar(prog_frame,
                                        style="main.Horizontal.TProgressbar",
                                        mode="determinate", length=660)
        self.progress.pack(fill="x", pady=(0, 6))

        # 当前文件进度（用于替代刷屏的 tqdm 输出）
        style.configure("file.Horizontal.TProgressbar",
                        troughcolor=CARD, background=GREEN, thickness=6)
        self.file_label = tk.Label(prog_frame, text="等待开始...",
                                   bg=BG, fg=FG2, font=("Consolas", 8),
                                   anchor="w")
        self.file_label.pack(fill="x")
        self.file_progress = ttk.Progressbar(prog_frame,
                                             style="file.Horizontal.TProgressbar",
                                             mode="determinate", length=660)
        self.file_progress.pack(fill="x", pady=(2, 8))

        # 日志
        self._section(body, "安装日志")
        self.log = scrolledtext.ScrolledText(
            body, height=6, bg=CARD, fg=FG2,
            font=("Consolas", 8), relief="flat",
            state="disabled", wrap="word",
            insertbackground=FG)
        self.log.pack(fill="x")

        # 底部按钮
        btn_row = tk.Frame(self, bg=BG)
        btn_row.pack(pady=14)
        self.btn = tk.Button(
            btn_row, text="  开始安装  ",
            bg=BLUE, fg=BG, font=("Segoe UI", 10, "bold"),
            relief="flat", cursor="hand2", padx=16, pady=8,
            activebackground=GREEN, activeforeground=BG,
            command=self._start)
        self.btn.pack(side="left", padx=8)
        tk.Button(btn_row, text="  退出  ",
                  bg=CARD, fg=FG2, relief="flat",
                  cursor="hand2", padx=16, pady=8,
                  command=self.destroy).pack(side="left")

    def _section(self, parent, title):
        row = tk.Frame(parent, bg=BG)
        row.pack(fill="x", pady=(4, 6))
        tk.Label(row, text=title, bg=BG, fg=BLUE,
                 font=("Segoe UI", 9, "bold")).pack(side="left")
        tk.Frame(row, bg=ACC, height=1).pack(side="left", fill="x",
                                              expand=True, padx=(8, 0))

    def _browse(self):
        d = filedialog.askdirectory(initialdir=self.dir_var.get())
        if d:
            self.dir_var.set(d)

    # ── 日志 / 进度更新 ─────────────────────────────────
    def log_msg(self, msg):
        ts = datetime.now().strftime("%H:%M:%S")
        self.log.configure(state="normal")
        self.log.insert("end", f"[{ts}] {msg}\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def set_progress(self, val, label=""):
        self.progress["value"] = val
        self.pct_label.configure(text=f"{int(val)}%")
        if label:
            self.file_label.configure(text=label)

    def set_file_progress(self, pct, label=""):
        self.file_progress["value"] = pct
        if label:
            self.file_label.configure(text=label)

    # ── 解析 modelscope tqdm 输出 ────────────────────────
    _DL_PAT = re.compile(
        r"Downloading\s+\[(.+?)\].*?(\d+)%.*?([\d.]+[GMKB]+)/([\d.]+[GMKB]+)"
    )

    def _handle_line(self, raw, base_progress):
        """处理一行输出，区分进度条行和普通日志行"""
        # 取最后一个 \r 之后的内容（tqdm 刷新）
        line = raw.split("\r")[-1].strip()
        if not line:
            return

        m = self._DL_PAT.search(line)
        if m:
            filename, pct_s, downloaded, total = m.groups()
            pct = int(pct_s)
            self.set_file_progress(pct, f"下载  {filename}   {downloaded} / {total}")
        else:
            self.log_msg(line)
            self.file_progress["value"] = 0
            self.file_label.configure(text=line[:80])

    # ── 安装流程 ─────────────────────────────────────────
    def _start(self):
        self.btn.configure(state="disabled")
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        install_dir  = self.dir_var.get()
        env_dir      = os.path.join(install_dir, "env")
        env_python   = os.path.join(env_dir, "python.exe")
        tar_path     = os.path.join(install_dir, CONDA_ENV_FILE)
        batch_script = os.path.join(install_dir, BATCH_SCRIPT)

        try:
            # 1. 检查 modelscope
            self.set_progress(2, "检查 modelscope...")
            try:
                import modelscope
            except ImportError:
                self.log_msg("正在安装 modelscope...")
                subprocess.run([sys.executable, "-m", "pip", "install",
                                "modelscope", "-q"], check=True)

            # 2. 下载 conda 环境包
            if os.path.exists(env_python):
                self.log_msg("env/ 已存在，跳过下载和解压")
                self.set_progress(58, "env 环境已就绪")
            else:
                self.set_progress(5, "下载 Python 环境包（~3.6 GB）...")
                self.log_msg("开始下载 Python 环境包...")

                cmd = [sys.executable, "-m", "modelscope.cli.cli",
                       "download", "--model", CONDA_ENV_MODEL,
                       "--local_dir", install_dir]
                proc = subprocess.Popen(cmd,
                                        stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT,
                                        encoding="utf-8", errors="replace",
                                        bufsize=1)

                def _watch():
                    total = 3_600 * 1024 * 1024
                    while proc.poll() is None:
                        if os.path.exists(tar_path):
                            size = os.path.getsize(tar_path)
                            pct  = min(int(size / total * 38) + 5, 43)
                            mb   = size / 1024 / 1024
                            self.set_progress(pct)
                            self.set_file_progress(
                                min(int(size / total * 100), 99),
                                f"下载  my-neuro-env.tar.gz   {mb:.0f} MB / 3600 MB")
                        time.sleep(1)

                threading.Thread(target=_watch, daemon=True).start()
                for line in proc.stdout:
                    self._handle_line(line, 5)
                proc.wait()
                if proc.returncode != 0:
                    raise RuntimeError("环境包下载失败")
                self.log_msg("环境包下载完成")

                # 3. 解压
                self.set_progress(45, "正在解压环境包...")
                self.log_msg("开始解压...")
                with tarfile.open(tar_path, "r:gz") as tar:
                    members = tar.getmembers()
                    total   = len(members)
                    for i, m in enumerate(members):
                        tar.extract(m, path=env_dir, filter="data")
                        if i % 300 == 0:
                            p = int(i / total * 10) + 45
                            self.set_progress(p)
                            self.set_file_progress(
                                int(i / total * 100),
                                f"解压中...  {i} / {total} 文件")
                os.remove(tar_path)
                self.log_msg("解压完成，已删除压缩包")

                # 4. conda-unpack
                self.set_progress(56, "修复环境路径...")
                unpack = os.path.join(env_dir, "Scripts", "conda-unpack.exe")
                if os.path.exists(unpack):
                    subprocess.run([unpack], check=True)
                    self.log_msg("路径修复完成")

                # 4b. 修复 huggingface_hub SyntaxError bug
                hf_file = os.path.join(env_dir, "Lib", "site-packages",
                                       "huggingface_hub", "file_download.py")
                if os.path.exists(hf_file):
                    with open(hf_file, "r", encoding="utf-8", errors="replace") as f:
                        src = f.read()
                    fixed = src.replace('startswith("\\\\\\"")', 'startswith("\\\\\\\\")')
                    if fixed != src:
                        with open(hf_file, "w", encoding="utf-8") as f:
                            f.write(fixed)
                        self.log_msg("已修复 huggingface_hub 兼容性问题")

            # 5. 下载模型
            self.set_progress(60, "开始下载模型...")
            self.log_msg("开始下载所选模型...")

            flags = []
            if self.checks["asr"].get():    flags.append("--asr")
            if self.checks["bert"].get():   flags.append("--bert")
            if self.checks["tts"].get():
                flags.extend(["--tts", "--gpu", self.gpu_var.get()])
            if self.checks["rag"].get():    flags.append("--rag")
            if self.checks["live2d"].get(): flags.append("--live2d")

            if flags:
                cmd = [env_python, batch_script] + flags
                proc = subprocess.Popen(cmd,
                                        stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT,
                                        encoding="utf-8", errors="replace",
                                        bufsize=1, cwd=install_dir)
                step = 60.0
                for line in proc.stdout:
                    self._handle_line(line, step)
                    if step < 95:
                        step += 0.2
                    self.set_progress(int(step))
                proc.wait()
                if proc.returncode != 0:
                    raise RuntimeError("模型下载失败")

            # 完成
            self.set_progress(100, "安装完成！")
            self.set_file_progress(100, "")
            self.log_msg("=" * 36)
            self.log_msg("安装成功！双击 launch.bat 启动")
            self.log_msg("=" * 36)
            messagebox.showinfo("完成", "安装成功！\n\n双击 launch.bat 即可启动所有服务。")

        except Exception as e:
            self.log_msg(f"[错误] {e}")
            self.set_progress(0, "安装失败")
            messagebox.showerror("安装失败", str(e))
        finally:
            self.btn.configure(state="normal")


if __name__ == "__main__":
    app = InstallerApp()
    app.mainloop()
