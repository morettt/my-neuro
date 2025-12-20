import tkinter as tk
import pkg_resources
import subprocess
import logging
import platform
import os
import importlib.util

# 设置日志，显式指定 UTF_ws-8 编码
logging.basicConfig(
    filename='diagnostic.log',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    encoding='utf-8'
)

class DiagnosticTool:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("My-Neuro 诊断工具")
        self.root.geometry("600x400")
        self.results = []
        self.setup_ui()
        self.logger = logging.getLogger()

    def check_python_version(self):
        """检查 Python 版本"""
        required_version = "3.11"
        current_version = platform.python_version()
        if current_version.startswith(required_version):
            self.results.append(("Python 版本", "通过", f"当前版本: {current_version}"))
        else:
            self.results.append(("Python 版本", "失败", f"需要 Python {required_version}, 当前: {current_version}"))

    def check_dependencies(self):
        """检查 requirements.txt 中的依赖"""
        try:
            with open("requirements.txt", "r", encoding='utf-8') as f:
                required = [line.strip() for line in f if line.strip() and not line.startswith("#")]
            for req in required:
                try:
                    pkg_resources.require(req)
                    self.results.append((f"依赖: {req}", "通过", ""))
                except pkg_resources.DistributionNotFound:
                    self.results.append((f"依赖: {req}", "失败", f"未安装 {req}"))
                except pkg_resources.VersionConflict:
                    self.results.append((f"依赖: {req}", "失败", f"版本冲突"))
        except FileNotFoundError:
            self.results.append(("依赖检查", "失败", "未找到 requirements.txt 文件"))
        except UnicodeDecodeError:
            self.results.append(("依赖检查", "失败", "无法读取 requirements.txt，文件编码错误，请确保使用 UTF-8 编码"))

    def check_conda_env(self):
        """检查是否处于 my-neuro Conda 虚拟环境"""
        required_env = "my-neuro"
        conda_env = os.environ.get("CONDA_DEFAULT_ENV")
        if conda_env == required_env:
            self.results.append(("Conda 环境", "通过", f"当前环境: {conda_env}"))
        elif conda_env is None:
            self.results.append(("Conda 环境", "失败", "未激活任何 Conda 环境，请运行 'conda activate my-neuro'"))
        else:
            self.results.append(("Conda 环境", "失败", f"当前环境: {conda_env}，需要切换到 'my-neuro'，请运行 'conda activate my-neuro'"))

    def check_bert_model(self):
        """检查 bert-model 文件夹是否包含模型文件"""
        bert_model_dir = "bert-model"
        try:
            files = os.listdir(bert_model_dir)
            model_files = [f for f in files if f != "占位符.txt"]
            if model_files:
                self.results.append(("BERT 模型", "通过", f"已检测到模型文件: {', '.join(model_files)}"))
            else:
                self.results.append(("BERT 模型", "失败", "未检测到模型文件，请运行 python Batch_Download.py 下载"))
        except FileNotFoundError:
            self.results.append(("BERT 模型", "失败", "未找到 bert-model 文件夹，请确保项目目录完整"))

    def check_nltk_data(self):
        """检查 nltk_data 文件夹是否存在（动态路径）"""
        nltk_data_path = os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "nltk_data")
        if os.path.exists(nltk_data_path):
            self.results.append(("NLTK 数据", "通过", f"已找到 nltk_data 文件夹: {nltk_data_path}"))
        else:
            self.results.append(("NLTK 数据", "失败", f"未找到 nltk_data 文件夹，请前往官方 QQ 群下载 zip 文件并解压到 {nltk_data_path}"))

    def check_pytorch_cuda(self):
        """检查是否安装了 CUDA 版本的 PyTorch"""
        try:
            import torch
            current_version = torch.__version__
            if torch.cuda.is_available() and "cu" in current_version:
                cuda_version = torch.version.cuda
                self.results.append(("PyTorch CUDA", "通过", f"已安装 PyTorch CUDA 版本: {current_version}, CUDA: {cuda_version}"))
            else:
                self.results.append(("PyTorch CUDA", "失败", "未检测到 CUDA 支持的 PyTorch，请安装 PyTorch CUDA 12.8 版本"))
        except ImportError:
            self.results.append(("PyTorch CUDA", "失败", "未安装 PyTorch，请安装 PyTorch CUDA 12.8 版本"))

    def check_nvidia_50_series(self):
        """检查是否为 NVIDIA 50 系显卡并验证 PyTorch 版本"""
        try:
            result = subprocess.run("nvidia-smi --query-gpu=name --format=csv,noheader", shell=True, capture_output=True, text=True)
            gpu_name = result.stdout.strip().lower()
            if "5060" in gpu_name or "5070" in gpu_name or "5080" in gpu_name or "5090" in gpu_name:
                import torch
                current_version = torch.__version__
                if "cu128" not in current_version:
                    self.results.append(("PyTorch 版本", "失败", "检测到 NVIDIA 50 系显卡，需要安装 PyTorch CUDA 12.8 版本"))
                else:
                    self.results.append(("PyTorch 版本", "通过", f"已安装 PyTorch CUDA 12.8: {current_version}"))
            else:
                self.results.append(("PyTorch 版本", "通过", f"非 NVIDIA 50 系显卡: {gpu_name}，无需更新 PyTorch"))
        except subprocess.CalledProcessError:
            self.results.append(("PyTorch 版本", "失败", "无法检测显卡型号，请确保安装 NVIDIA 驱动"))

    def check_jieba(self):
        """检查 jieba 库是否安装"""
        if importlib.util.find_spec("jieba") is not None:
            try:
                import jieba
                self.results.append(("Jieba 库", "通过", f"已安装 jieba 库，版本: {jieba.__version__}"))
            except ImportError:
                self.results.append(("Jieba 库", "失败", "无法加载 jieba 库，请运行 python jieba_fast-0.53-cp311-cp311-win_amd64.whl"))
        else:
            self.results.append(("Jieba 库", "失败", "未安装 jieba 库，请运行 python jieba_fast-0.53-cp311-cp311-win_amd64.whl"))

    def check_ffmpeg(self):
        """检查 ffmpeg 是否安装"""
        try:
            result = subprocess.run("ffmpeg -version", shell=True, capture_output=True, text=True)
            if result.returncode == 0:
                version = result.stdout.splitlines()[0]
                self.results.append(("FFmpeg", "通过", f"已安装 FFmpeg: {version}"))
            else:
                self.results.append(("FFmpeg", "失败", "未安装 FFmpeg，请使用 'conda install ffmpeg -y' 安装"))
        except FileNotFoundError:
            self.results.append(("FFmpeg", "失败", "未安装 FFmpeg，请使用 'conda install ffmpeg -y' 安装"))

    def run_diagnostic(self):
        """运行所有诊断"""
        self.results.clear()
        self.logger.info("开始诊断...")
        self.check_conda_env()
        self.check_python_version()
        self.check_dependencies()
        self.check_jieba()
        self.check_ffmpeg()
        self.check_bert_model()
        self.check_nltk_data()
        self.check_pytorch_cuda()
        self.check_nvidia_50_series()
        self.logger.info("诊断完成")
        self.update_ui()

    def fix_all_dependencies(self):
        """批量安装 requirements.txt 中的所有依赖"""
        self.logger.info("尝试批量安装所有缺失依赖")
        try:
            result = subprocess.run("call conda activate my-neuro && pip install -r requirements.txt", shell=True, capture_output=True, text=True, check=True)
            self.results.append(("依赖检查", "修复成功", "已根据 requirements.txt 安装所有依赖"))
            self.logger.info("修复成功: 已安装 requirements.txt 中的所有依赖")
            self.logger.info(f"安装输出: {result.stdout}")
        except subprocess.CalledProcessError as e:
            self.results.append(("依赖检查", "修复失败", "安装 requirements.txt 中的依赖失败，请检查 requirements.txt 或手动运行 'pip install -r requirements.txt'"))
            self.logger.error(f"修复失败: 安装 requirements.txt 失败，错误信息: {e.stderr}")
        except FileNotFoundError:
            self.results.append(("依赖检查", "修复失败", "未找到 requirements.txt 文件，请确保文件存在于项目根目录"))
            self.logger.error("修复失败: 未找到 requirements.txt 文件")
        self.update_ui()

    def fix_issue(self, issue):
        """尝试自动修复特定问题（除依赖外）"""
        self.logger.info(f"尝试修复: {issue}")
        if "Conda 环境" in issue:
            try:
                subprocess.run("conda activate my-neuro", shell=True, check=True)
                self.results.append(("Conda 环境", "修复成功", "已激活 my-neuro 环境"))
                self.logger.info("修复成功: 已激活 my-neuro 环境")
            except subprocess.CalledProcessError:
                self.results.append(("Conda 环境", "修复失败", "无法自动激活 my-neuro 环境，请按照README.md文档手动激活"))
                self.logger.error("修复失败: 无法自动激活 my-neuro 环境")
        elif "BERT 模型" in issue:
            try:
                subprocess.run("call conda activate my-neuro && python Batch_Download.py", shell=True, check=True)
                self.results.append(("BERT 模型", "修复成功", "已运行 python Batch_Download.py 下载模型"))
                self.logger.info("修复成功: 已下载 BERT 模型")
            except subprocess.CalledProcessError:
                self.results.append(("BERT 模型", "修复失败", "运行 python Batch_Download.py 失败，请手动运行"))
                self.logger.error("修复失败: Batch_Download.py")
        elif "PyTorch 版本" in issue:
            try:
                subprocess.run("call conda activate my-neuro && pip uninstall -y torch torchvision torchaudio", shell=True, check=True)
                subprocess.run("call conda activate my-neuro && pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128",
                              shell=True, check=True)
                self.results.append(("PyTorch 版本", "修复成功", "已安装 PyTorch CUDA 12.8"))
                self.logger.info("修复成功: 已安装 PyTorch CUDA 12.8")
            except subprocess.CalledProcessError:
                self.results.append(("PyTorch 版本", "修复失败", "安装 PyTorch CUDA 12.8 失败，请手动安装"))
                self.logger.error("修复失败: PyTorch CUDA 12.8")
        elif "PyTorch CUDA" in issue:
            try:
                subprocess.run("call conda activate my-neuro && pip uninstall -y torch torchvision torchaudio", shell=True, check=True)
                subprocess.run("call conda activate my-neuro && pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128",
                              shell=True, check=True)
                self.results.append(("PyTorch CUDA", "修复成功", "已安装 PyTorch CUDA 12.8"))
                self.logger.info("修复成功: 已安装 PyTorch CUDA 12.8")
            except subprocess.CalledProcessError:
                self.results.append(("PyTorch CUDA", "修复失败", "安装 PyTorch CUDA 12.8 失败，请手动运行 'pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118'"))
                self.logger.error("修复失败: PyTorch CUDA 12.8")
        elif "Jieba 库" in issue:
            try:
                wheel_file = "jieba_fast-0.53-cp311-cp311-win_amd64.whl"
                if os.path.exists(wheel_file):
                    subprocess.run(f"call conda activate my-neuro && pip install {wheel_file}", shell=True, check=True)
                    self.results.append(("Jieba 库", "修复成功", "已安装 jieba_fast-0.53"))
                    self.logger.info("修复成功: 已安装 jieba_fast")
                else:
                    self.results.append(("Jieba 库", "修复失败", f"未找到 {wheel_file}，请下载并放置到项目根目录"))
                    self.logger.error(f"修复失败: 未找到 {wheel_file}")
            except subprocess.CalledProcessError:
                self.results.append(("Jieba 库", "修复失败", "安装 jieba_fast 失败，请手动运行 'pip install jieba_fast-0.53-cp311-cp311-win_amd64.whl'"))
                self.logger.error("修复失败: jieba_fast")
        elif "FFmpeg" in issue:
            try:
                subprocess.run("call conda activate my-neuro && conda install ffmpeg -y", shell=True, check=True)
                self.results.append(("FFmpeg", "修复成功", "已安装 FFmpeg"))
                self.logger.info("修复成功: 已安装 FFmpeg")
            except subprocess.CalledProcessError:
                self.results.append(("FFmpeg", "修复失败", "安装 FFmpeg 失败，请手动运行 'conda install ffmpeg -y'"))
                self.logger.error("修复失败: FFmpeg")
        self.update_ui()

    def setup_ui(self):
        """设置 GUI 界面"""
        tk.Button(self.root, text="运行诊断", command=self.run_diagnostic).pack(pady=10)
        self.result_text = tk.Text(self.root, height=15, width=60)
        self.result_text.pack(pady=10)
        self.fix_button = tk.Button(self.root, text="安装缺失库", command=self.fix_all_dependencies, state='disabled')
        self.fix_button.pack(pady=5)
        tk.Button(self.root, text="退出", command=self.root.quit).pack(pady=5)

    def update_ui(self):
        """更新诊断结果显示"""
        self.result_text.delete(1.0, tk.END)
        has_dependency_issue = False
        for issue, status, detail in self.results:
            self.result_text.insert(tk.END, f"{issue}: {status}\n{detail}\n\n")
            if "依赖" in issue and status != "通过":
                has_dependency_issue = True
            if status != "通过" and "依赖" not in issue:
                tk.Button(self.root, text=f"修复 {issue}",
                         command=lambda x=issue: self.fix_issue(x)).pack()
        self.fix_button.config(state='normal' if has_dependency_issue else 'disabled')

    def run(self):
        self.root.mainloop()

if __name__ == "__main__":
    tool = DiagnosticTool()
    tool.run()
