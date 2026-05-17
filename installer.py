import tkinter as tk
from tkinter import ttk, filedialog, messagebox, scrolledtext
import threading
import os
import sys
import subprocess
import tarfile
import time
from datetime import datetime


# ─── 配置 ───────────────────────────────────────
CONDA_ENV_MODEL   = "morelle/my-neuro-env"
CONDA_ENV_FILE    = "my-neuro-env.tar.gz"
BATCH_SCRIPT      = "full-hub/Batch_Download.py"
INSTALL_DIR       = os.path.dirname(os.path.abspath(sys.argv[0]))


# ─── 主窗口 ──────────────────────────────────────
class InstallerApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("My-Neuro Installer")
        self.resizable(False, False)
        self.configure(bg="#1e1e2e")

        self._build_ui()
        self._center_window(680, 620)

    def _center_window(self, w, h):
        sw = self.winfo_screenwidth()
        sh = self.winfo_screenheight()
        self.geometry(f"{w}x{h}+{(sw-w)//2}+{(sh-h)//2}")

    def _build_ui(self):
        PAD  = 16
        BG   = "#1e1e2e"
        FG   = "#cdd6f4"
        ACC  = "#89b4fa"
        BOX  = "#313244"
        RED  = "#f38ba8"
        GRN  = "#a6e3a1"

        # 标题
        tk.Label(self, text="My-Neuro  Installer",
                 bg=BG, fg=ACC, font=("Segoe UI", 18, "bold")).pack(pady=(20, 4))
        tk.Label(self, text="一键安装 AI 虚拟伴侣",
                 bg=BG, fg=FG, font=("Segoe UI", 10)).pack(pady=(0, 16))

        # 安装目录
        dir_frame = tk.Frame(self, bg=BG)
        dir_frame.pack(fill="x", padx=PAD, pady=(0, 10))
        tk.Label(dir_frame, text="安装目录:", bg=BG, fg=FG,
                 font=("Segoe UI", 9)).pack(side="left")
        self.dir_var = tk.StringVar(value=INSTALL_DIR)
        tk.Entry(dir_frame, textvariable=self.dir_var, width=48,
                 bg=BOX, fg=FG, insertbackground=FG,
                 relief="flat", font=("Consolas", 9)).pack(side="left", padx=6)
        tk.Button(dir_frame, text="浏览", bg=BOX, fg=FG, relief="flat",
                  activebackground=ACC, cursor="hand2",
                  command=self._browse).pack(side="left")

        # 分隔线
        tk.Frame(self, bg=BOX, height=1).pack(fill="x", padx=PAD, pady=4)

        # 模型选择
        tk.Label(self, text="选择要下载的模型组件:",
                 bg=BG, fg=FG, font=("Segoe UI", 9, "bold")).pack(
                 anchor="w", padx=PAD, pady=(6, 4))

        self.checks = {}
        models = [
            ("asr",    "ASR  语音识别",      "~2 GB",  True),
            ("tts",    "TTS  语音合成",      "~4 GB",  True),
            ("bert",   "BERT 语言理解",      "~1 GB",  True),
            ("live2d", "Live2D 立绘模型",    "~200 MB", True),
            ("rag",    "RAG  长期记忆（可选）","~2 GB", False),
        ]
        for key, label, size, default in models:
            var = tk.BooleanVar(value=default)
            self.checks[key] = var
            row = tk.Frame(self, bg=BOX)
            row.pack(fill="x", padx=PAD, pady=2)
            tk.Checkbutton(row, variable=var, bg=BOX, fg=FG,
                           selectcolor=BOX, activebackground=BOX,
                           activeforeground=ACC).pack(side="left")
            tk.Label(row, text=label, bg=BOX, fg=FG,
                     font=("Segoe UI", 9), width=24, anchor="w").pack(side="left")
            tk.Label(row, text=size, bg=BOX, fg="#6c7086",
                     font=("Consolas", 8)).pack(side="left")

        # 显卡类型
        tk.Frame(self, bg=BOX, height=1).pack(fill="x", padx=PAD, pady=8)
        gpu_frame = tk.Frame(self, bg=BG)
        gpu_frame.pack(fill="x", padx=PAD, pady=(0, 8))
        tk.Label(gpu_frame, text="显卡类型:", bg=BG, fg=FG,
                 font=("Segoe UI", 9)).pack(side="left")
        self.gpu_var = tk.StringVar(value="non-50")
        tk.Radiobutton(gpu_frame, text="标准版（非50系）", variable=self.gpu_var,
                       value="non-50", bg=BG, fg=FG, selectcolor=BG,
                       activebackground=BG, activeforeground=ACC).pack(side="left", padx=8)
        tk.Radiobutton(gpu_frame, text="50系专属（RTX 5000系列）",
                       variable=self.gpu_var, value="50",
                       bg=BG, fg=FG, selectcolor=BG,
                       activebackground=BG, activeforeground=ACC).pack(side="left")

        # 进度条
        tk.Frame(self, bg=BOX, height=1).pack(fill="x", padx=PAD, pady=4)
        self.progress_label = tk.Label(self, text="等待开始...",
                                       bg=BG, fg=FG, font=("Segoe UI", 9))
        self.progress_label.pack(anchor="w", padx=PAD, pady=(6, 2))

        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("blue.Horizontal.TProgressbar",
                        troughcolor=BOX, background=ACC, thickness=12)
        self.progress = ttk.Progressbar(self, style="blue.Horizontal.TProgressbar",
                                        mode="determinate", length=648)
        self.progress.pack(padx=PAD, pady=(0, 6))

        # 日志
        self.log = scrolledtext.ScrolledText(
            self, height=8, bg=BOX, fg=FG,
            font=("Consolas", 8), relief="flat",
            state="disabled", wrap="word")
        self.log.pack(fill="x", padx=PAD, pady=(0, 10))

        # 按钮
        btn_frame = tk.Frame(self, bg=BG)
        btn_frame.pack(pady=(0, 16))
        self.btn_install = tk.Button(
            btn_frame, text="  开始安装  ",
            bg=ACC, fg="#1e1e2e", font=("Segoe UI", 10, "bold"),
            relief="flat", cursor="hand2", padx=12, pady=6,
            command=self._start_install)
        self.btn_install.pack(side="left", padx=8)
        tk.Button(btn_frame, text="  退出  ",
                  bg=BOX, fg=FG, relief="flat", cursor="hand2",
                  padx=12, pady=6,
                  command=self.destroy).pack(side="left")

    def _browse(self):
        d = filedialog.askdirectory(initialdir=self.dir_var.get())
        if d:
            self.dir_var.set(d)

    def log_msg(self, msg):
        ts = datetime.now().strftime("%H:%M:%S")
        self.log.configure(state="normal")
        self.log.insert("end", f"[{ts}] {msg}\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def set_progress(self, val, label=""):
        self.progress["value"] = val
        if label:
            self.progress_label.configure(text=label)

    def _start_install(self):
        self.btn_install.configure(state="disabled")
        t = threading.Thread(target=self._run_install, daemon=True)
        t.start()

    def _run_install(self):
        install_dir = self.dir_var.get()
        env_dir     = os.path.join(install_dir, "env")
        env_python  = os.path.join(env_dir, "python.exe")
        tar_path    = os.path.join(install_dir, CONDA_ENV_FILE)
        batch_script = os.path.join(install_dir, BATCH_SCRIPT)

        try:
            # ── 步骤1：检查/安装 modelscope ──────────────────────
            self.set_progress(2, "检查 modelscope...")
            self.log_msg("检查 modelscope 是否可用...")
            try:
                import modelscope
                self.log_msg("modelscope 已就绪")
            except ImportError:
                self.log_msg("正在安装 modelscope...")
                subprocess.run([sys.executable, "-m", "pip", "install",
                                "modelscope", "-q"], check=True)
                self.log_msg("modelscope 安装完成")

            # ── 步骤2：下载 conda 环境包 ─────────────────────────
            if os.path.exists(env_python):
                self.log_msg("检测到 env/ 已存在，跳过下载和解压")
                self.set_progress(50, "env 环境已存在，跳过...")
            else:
                self.set_progress(5, "正在下载 Python 环境包（~3.6GB）...")
                self.log_msg(f"开始下载 {CONDA_ENV_MODEL}...")

                cmd = [sys.executable, "-m", "modelscope.cli.cli",
                       "download", "--model", CONDA_ENV_MODEL,
                       "--local_dir", install_dir]
                proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT,
                                        text=True, bufsize=1,
                                        encoding="utf-8", errors="replace")

                # 监控下载进度（通过文件大小增长）
                def _watch_download():
                    target = os.path.join(install_dir, CONDA_ENV_FILE)
                    total = 3_600 * 1024 * 1024  # 约3.6GB
                    while proc.poll() is None:
                        if os.path.exists(target):
                            size = os.path.getsize(target)
                            pct  = min(int(size / total * 40) + 5, 44)
                            mb   = size / 1024 / 1024
                            self.set_progress(pct, f"下载中... {mb:.0f} MB / 3600 MB")
                        time.sleep(1)

                watcher = threading.Thread(target=_watch_download, daemon=True)
                watcher.start()

                for line in proc.stdout:
                    line = line.strip()
                    if line:
                        self.log_msg(line)
                proc.wait()
                if proc.returncode != 0:
                    raise RuntimeError("conda 环境包下载失败")
                self.log_msg("下载完成！")

                # ── 步骤3：解压 ──────────────────────────────────
                self.set_progress(45, "正在解压环境包...")
                self.log_msg(f"解压 {CONDA_ENV_FILE} 到 env/...")

                with tarfile.open(tar_path, "r:gz") as tar:
                    members = tar.getmembers()
                    total   = len(members)
                    for i, member in enumerate(members):
                        tar.extract(member, path=env_dir, filter="data")
                        if i % 200 == 0:
                            pct = int(i / total * 10) + 45
                            self.set_progress(pct, f"解压中... {i}/{total} 文件")
                self.log_msg("解压完成！")

                # 删除 tar 包节省空间
                os.remove(tar_path)
                self.log_msg("已删除压缩包")

                # ── 步骤4：conda-unpack 修复路径 ─────────────────
                self.set_progress(56, "修复环境路径...")
                self.log_msg("运行 conda-unpack...")
                unpack_exe = os.path.join(env_dir, "Scripts", "conda-unpack.exe")
                if os.path.exists(unpack_exe):
                    subprocess.run([unpack_exe], check=True)
                    self.log_msg("路径修复完成")
                else:
                    self.log_msg("警告: 未找到 conda-unpack，跳过")

            # ── 步骤5：下载所选模型 ──────────────────────────────
            self.set_progress(60, "开始下载模型...")
            self.log_msg("开始下载所选模型...")

            flags = []
            if self.checks["asr"].get():    flags.append("--asr")
            if self.checks["bert"].get():   flags.append("--bert")
            if self.checks["tts"].get():
                flags.append("--tts")
                flags += ["--gpu", self.gpu_var.get()]
            if self.checks["rag"].get():    flags.append("--rag")
            if self.checks["live2d"].get(): flags.append("--live2d")

            if flags:
                cmd = [env_python, batch_script] + flags
                self.log_msg(f"执行: {' '.join(cmd)}")
                proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT,
                                        text=True, bufsize=1,
                                        cwd=install_dir)
                step = 60
                for line in proc.stdout:
                    line = line.strip()
                    if line:
                        self.log_msg(line)
                        if step < 95:
                            step += 0.3
                        self.set_progress(int(step), "下载模型中...")
                proc.wait()
                if proc.returncode != 0:
                    raise RuntimeError("模型下载失败")

            # ── 完成 ─────────────────────────────────────────────
            self.set_progress(100, "安装完成！")
            self.log_msg("=" * 40)
            self.log_msg("安装成功！双击 launch.bat 启动所有服务")
            self.log_msg("=" * 40)
            messagebox.showinfo("完成", "安装成功！\n双击 launch.bat 启动所有服务。")

        except Exception as e:
            self.log_msg(f"[错误] {e}")
            self.set_progress(0, "安装失败")
            messagebox.showerror("安装失败", str(e))
        finally:
            self.btn_install.configure(state="normal")


if __name__ == "__main__":
    app = InstallerApp()
    app.mainloop()
