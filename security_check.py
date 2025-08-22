"""
My-Neuro 安全检查工具
检测项目中的安全问题并提供修复建议
"""

import os
import re
import json
import logging
from pathlib import Path
from typing import List, Dict, Any
import hashlib

class SecurityChecker:
    """安全检查器"""
    
    def __init__(self):
        self.issues = []
        self.critical_issues = []
        self.warnings = []
        
        # 敏感模式
        self.sensitive_patterns = {
            'api_key': r'sk-[a-zA-Z0-9]{20,}',
            'password': r'password["\']?\s*[:=]\s*["\'][^"\']+["\']',
            'secret': r'secret["\']?\s*[:=]\s*["\'][^"\']+["\']',
            'token': r'token["\']?\s*[:=]\s*["\'][^"\']+["\']',
            'private_key': r'private_key["\']?\s*[:=]\s*["\'][^"\']+["\']',
        }
        
        # 危险函数模式
        self.dangerous_patterns = {
            'eval': r'eval\s*\(',
            'exec': r'exec\s*\(',
            'shell_true': r'shell\s*=\s*True',
            'subprocess_shell': r'subprocess\.(run|Popen|call)\s*\([^)]*shell\s*=\s*True',
        }
        
        # 文件扩展名
        self.code_extensions = {'.py', '.js', '.html', '.css', '.json', '.yaml', '.yml', '.bat', '.ps1'}
        
    def scan_file(self, file_path: Path) -> List[Dict[str, Any]]:
        """扫描单个文件的安全问题"""
        issues = []
        
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                lines = content.split('\n')
                
            # 检查敏感信息
            for line_num, line in enumerate(lines, 1):
                for pattern_name, pattern in self.sensitive_patterns.items():
                    if re.search(pattern, line, re.IGNORECASE):
                        issues.append({
                            'type': 'sensitive_info',
                            'severity': 'critical',
                            'pattern': pattern_name,
                            'line': line_num,
                            'content': line.strip(),
                            'file': str(file_path),
                            'description': f'发现敏感信息: {pattern_name}'
                        })
                
                # 检查危险函数
                for pattern_name, pattern in self.dangerous_patterns.items():
                    if re.search(pattern, line, re.IGNORECASE):
                        issues.append({
                            'type': 'dangerous_function',
                            'severity': 'high',
                            'pattern': pattern_name,
                            'line': line_num,
                            'content': line.strip(),
                            'file': str(file_path),
                            'description': f'发现危险函数: {pattern_name}'
                        })
                
                # 检查硬编码的URL
                if re.search(r'https?://[^\s"\']+', line):
                    if 'api' in line.lower() or 'key' in line.lower():
                        issues.append({
                            'type': 'hardcoded_url',
                            'severity': 'medium',
                            'line': line_num,
                            'content': line.strip(),
                            'file': str(file_path),
                            'description': '发现硬编码的API URL'
                        })
                        
        except Exception as e:
            issues.append({
                'type': 'file_error',
                'severity': 'low',
                'file': str(file_path),
                'description': f'无法读取文件: {e}'
            })
            
        return issues
    
    def scan_directory(self, directory: Path, exclude_dirs: set = None) -> List[Dict[str, Any]]:
        """扫描目录中的所有文件"""
        if exclude_dirs is None:
            exclude_dirs = {'.git', '__pycache__', 'node_modules', '.venv', 'venv'}
        
        all_issues = []
        
        for root, dirs, files in os.walk(directory):
            # 排除不需要扫描的目录
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            
            for file in files:
                file_path = Path(root) / file
                
                # 只扫描代码文件
                if file_path.suffix in self.code_extensions:
                    issues = self.scan_file(file_path)
                    all_issues.extend(issues)
        
        return all_issues
    
    def check_file_permissions(self, directory: Path) -> List[Dict[str, Any]]:
        """检查文件权限"""
        issues = []
        
        sensitive_files = [
            'config.json',
            'config_mod/config.json',
            '.env',
            'secrets.json'
        ]
        
        for file_path in sensitive_files:
            full_path = directory / file_path
            if full_path.exists():
                # 检查文件权限（在Windows上可能不适用）
                try:
                    stat = full_path.stat()
                    if stat.st_mode & 0o777 != 0o600:  # 检查是否为600权限
                        issues.append({
                            'type': 'file_permission',
                            'severity': 'medium',
                            'file': str(full_path),
                            'description': '敏感文件权限过于开放，建议设置为600'
                        })
                except Exception:
                    pass  # Windows系统可能不支持
                    
        return issues
    
    def check_dependencies(self, requirements_file: Path) -> List[Dict[str, Any]]:
        """检查依赖包的安全问题"""
        issues = []
        
        if not requirements_file.exists():
            return issues
        
        # 已知有安全漏洞的包版本
        vulnerable_packages = {
            'requests': '<2.28.0',
            'urllib3': '<1.26.0',
            'cryptography': '<3.4.0',
        }
        
        try:
            with open(requirements_file, 'r', encoding='utf-8') as f:
                content = f.read()
                
            for line in content.split('\n'):
                line = line.strip()
                if line and not line.startswith('#'):
                    for package, min_version in vulnerable_packages.items():
                        if package in line and '<' in min_version:
                            version_spec = min_version.split('<')[1]
                            if version_spec in line:
                                issues.append({
                                    'type': 'vulnerable_dependency',
                                    'severity': 'high',
                                    'package': package,
                                    'version': line,
                                    'description': f'发现可能有安全漏洞的依赖包: {package}'
                                })
                                
        except Exception as e:
            issues.append({
                'type': 'dependency_check_error',
                'severity': 'low',
                'description': f'检查依赖时出错: {e}'
            })
            
        return issues
    
    def generate_report(self, issues: List[Dict[str, Any]]) -> str:
        """生成安全检查报告"""
        if not issues:
            return "✅ 安全检查完成，未发现安全问题！"
        
        # 按严重程度分类
        critical = [i for i in issues if i['severity'] == 'critical']
        high = [i for i in issues if i['severity'] == 'high']
        medium = [i for i in issues if i['severity'] == 'medium']
        low = [i for i in issues if i['severity'] == 'low']
        
        report = []
        report.append("🔍 My-Neuro 安全检查报告")
        report.append("=" * 50)
        report.append(f"总计发现问题: {len(issues)}")
        report.append(f"严重问题: {len(critical)}")
        report.append(f"高危问题: {len(high)}")
        report.append(f"中危问题: {len(medium)}")
        report.append(f"低危问题: {len(low)}")
        report.append("")
        
        # 严重问题
        if critical:
            report.append("🚨 严重问题 (必须立即修复):")
            for i, issue in enumerate(critical, 1):
                report.append(f"  {i}. {issue['description']}")
                report.append(f"     文件: {issue.get('file', 'N/A')}")
                if 'line' in issue:
                    report.append(f"     行号: {issue['line']}")
                report.append("")
        
        # 高危问题
        if high:
            report.append("⚠️ 高危问题 (建议尽快修复):")
            for i, issue in enumerate(high, 1):
                report.append(f"  {i}. {issue['description']}")
                report.append(f"     文件: {issue.get('file', 'N/A')}")
                if 'line' in issue:
                    report.append(f"     行号: {issue['line']}")
                report.append("")
        
        # 中危问题
        if medium:
            report.append("⚠️ 中危问题 (建议修复):")
            for i, issue in enumerate(medium, 1):
                report.append(f"  {i}. {issue['description']}")
                report.append(f"     文件: {issue.get('file', 'N/A')}")
                report.append("")
        
        # 修复建议
        report.append("🔧 修复建议:")
        report.append("1. 立即移除所有硬编码的API密钥")
        report.append("2. 使用环境变量或安全的配置文件存储敏感信息")
        report.append("3. 避免使用shell=True，改用参数列表")
        report.append("4. 定期更新依赖包到最新版本")
        report.append("5. 对用户输入进行严格验证")
        report.append("6. 使用HTTPS进行所有网络通信")
        
        return "\n".join(report)
    
    def run_full_scan(self, project_path: str = ".") -> str:
        """运行完整的安全检查"""
        project_dir = Path(project_path)
        
        print("🔍 开始安全检查...")
        
        # 扫描代码文件
        print("📁 扫描代码文件...")
        code_issues = self.scan_directory(project_dir)
        
        # 检查文件权限
        print("🔐 检查文件权限...")
        permission_issues = self.check_file_permissions(project_dir)
        
        # 检查依赖
        print("📦 检查依赖包...")
        requirements_file = project_dir / "requirements.txt"
        dependency_issues = self.check_dependencies(requirements_file)
        
        # 合并所有问题
        all_issues = code_issues + permission_issues + dependency_issues
        
        # 生成报告
        report = self.generate_report(all_issues)
        
        return report

def main():
    """主函数"""
    checker = SecurityChecker()
    report = checker.run_full_scan()
    print(report)
    
    # 保存报告到文件
    with open('security_report.txt', 'w', encoding='utf-8') as f:
        f.write(report)
    
    print("\n📄 详细报告已保存到 security_report.txt")

if __name__ == "__main__":
    main()