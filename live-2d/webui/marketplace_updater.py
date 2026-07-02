#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""插件市场更新辅助函数。

这里尽量只放纯逻辑和文件操作，Flask 路由留在 marketplace.py。
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path

try:
    from packaging.specifiers import InvalidSpecifier, SpecifierSet
    from packaging.version import InvalidVersion, Version
except ImportError:  # pragma: no cover - packaging 通常由依赖链提供
    InvalidSpecifier = ValueError
    InvalidVersion = ValueError
    SpecifierSet = None
    Version = None

GITHUB_REPO_RE = re.compile(
    r"^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)"
    r"(?:\.git)?(?:/tree/([A-Za-z0-9_.\-/]+))?/?$"
)

DEFAULT_TIMEOUT = 12


def parse_github_repo(repo_url):
    """解析 GitHub 仓库 URL，返回 (owner, repo)。"""
    if not repo_url:
        raise ValueError("插件仓库地址为空")

    match = GITHUB_REPO_RE.match(repo_url.strip())
    if not match:
        raise ValueError(f"无效的 GitHub 仓库地址：{repo_url}")

    owner, repo = match.group(1), match.group(2)
    return owner, repo.removesuffix(".git")


def _read_url_bytes(url, timeout=DEFAULT_TIMEOUT):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "my-neuro-plugin-market/1.0",
            "Accept": "application/json,*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def _read_json_url(url, timeout=DEFAULT_TIMEOUT):
    return json.loads(_read_url_bytes(url, timeout=timeout).decode("utf-8-sig"))


def fetch_remote_metadata(repo_url, timeout=8):
    """从插件仓库抓取远程 metadata.json。

    优先尝试 raw.githubusercontent.com 的 HEAD 伪分支，然后回退 main/master。
    若仍失败，再通过 GitHub API 查询默认分支。
    """
    owner, repo = parse_github_repo(repo_url)
    tried = []

    for branch in ["HEAD", "main", "master"]:
        url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/metadata.json"
        tried.append(url)
        try:
            return _read_json_url(url, timeout=timeout)
        except Exception:
            continue

    try:
        info = _read_json_url(
            f"https://api.github.com/repos/{owner}/{repo}",
            timeout=timeout,
        )
        default_branch = info.get("default_branch")
        if default_branch and default_branch not in {"HEAD", "main", "master"}:
            url = (
                f"https://raw.githubusercontent.com/"
                f"{owner}/{repo}/{default_branch}/metadata.json"
            )
            tried.append(url)
            return _read_json_url(url, timeout=timeout)
    except Exception as exc:
        raise RuntimeError(
            f"无法读取远程 metadata.json，已尝试 {len(tried)} 个地址"
        ) from exc

    raise RuntimeError(f"无法读取远程 metadata.json，已尝试 {len(tried)} 个地址")


def _normalize_version(version):
    return str(version or "").strip().lstrip("vV")


def compare_versions(local_version, remote_version):
    """比较版本号：local < remote 返回 -1，等于返回 0，大于返回 1。"""
    local = _normalize_version(local_version)
    remote = _normalize_version(remote_version)
    if not local and not remote:
        return 0
    if not local:
        return -1
    if not remote:
        return 1

    if Version is not None:
        try:
            local_parsed = Version(local)
            remote_parsed = Version(remote)
            return (local_parsed > remote_parsed) - (local_parsed < remote_parsed)
        except InvalidVersion:
            pass

    return (local > remote) - (local < remote)


def get_local_metadata(plugin_dir):
    metadata_path = Path(plugin_dir) / "metadata.json"
    if not metadata_path.exists():
        return {}
    with metadata_path.open("r", encoding="utf-8-sig") as file:
        return json.load(file)


def build_update_info(plugin, fetch_metadata=fetch_remote_metadata):
    """构建单个插件的更新信息。"""
    name = plugin.get("name") or plugin.get("display_name") or ""
    repo_url = plugin.get("repo") or ""
    local_version = plugin.get("version") or plugin.get("local_version") or ""
    result = {
        "name": name,
        "repo": repo_url,
        "version": local_version,
        "local_version": local_version,
        "latest_version": "",
        "has_update": False,
        "remote_metadata": None,
        "update_error": "",
    }

    if not repo_url:
        result["update_error"] = "插件未配置 repo"
        return result

    try:
        remote_metadata = fetch_metadata(repo_url) or {}
        latest_version = remote_metadata.get("version", "")
        result["remote_metadata"] = remote_metadata
        result["latest_version"] = latest_version
        result["has_update"] = compare_versions(local_version, latest_version) < 0
    except Exception as exc:
        result["update_error"] = str(exc)

    return result


def check_updates_for_plugins(
    plugins,
    fetch_metadata=fetch_remote_metadata,
    max_workers=5,
):
    """并发检查插件更新，返回以插件 name 为 key 的字典。"""
    plugin_list = list(plugins or [])
    if not plugin_list:
        return {}

    results = {}
    workers = max(1, min(max_workers, len(plugin_list)))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_map = {
            executor.submit(build_update_info, plugin, fetch_metadata): plugin
            for plugin in plugin_list
        }
        for future in as_completed(future_map):
            plugin = future_map[future]
            name = plugin.get("name") or plugin.get("display_name")
            try:
                info = future.result()
            except Exception as exc:
                info = {
                    "name": name,
                    "repo": plugin.get("repo", ""),
                    "version": plugin.get("version", ""),
                    "local_version": plugin.get("version", ""),
                    "latest_version": "",
                    "has_update": False,
                    "remote_metadata": None,
                    "update_error": str(exc),
                }
            if name:
                results[name] = info
    return results


def _download_first_available(urls, timeout=120):
    last_error = None
    for url in urls:
        try:
            return _read_url_bytes(url, timeout=timeout)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            last_error = exc
            continue
    if last_error:
        raise last_error
    raise RuntimeError("没有可用的下载地址")


def get_default_branch(repo_url, timeout=DEFAULT_TIMEOUT):
    owner, repo = parse_github_repo(repo_url)
    info = _read_json_url(f"https://api.github.com/repos/{owner}/{repo}", timeout=timeout)
    return info.get("default_branch") or "main"


def download_archive(repo_url, timeout=120):
    """下载插件源码压缩包，自动处理 main/master/default_branch。"""
    owner, repo = parse_github_repo(repo_url)
    urls = [
        f"https://github.com/{owner}/{repo}/archive/refs/heads/main.zip",
        f"https://github.com/{owner}/{repo}/archive/refs/heads/master.zip",
    ]

    try:
        default_branch = get_default_branch(repo_url, timeout=DEFAULT_TIMEOUT)
        default_url = (
            f"https://github.com/{owner}/{repo}/archive/refs/heads/{default_branch}.zip"
        )
        if default_url not in urls:
            urls.append(default_url)
    except Exception:
        pass

    return _download_first_available(urls, timeout=timeout)


def _safe_destination(base_dir, relative_path):
    destination = (base_dir / relative_path).resolve()
    base_resolved = base_dir.resolve()
    if os.path.commonpath([str(base_resolved), str(destination)]) != str(base_resolved):
        raise ValueError(f"压缩包包含不安全路径：{relative_path}")
    return destination


def _strip_archive_root(names):
    clean_names = [name for name in names if name and not name.endswith("/")]
    if not clean_names:
        return False, ""
    first_parts = [Path(name).parts[0] for name in clean_names if Path(name).parts]
    if first_parts and len(set(first_parts)) == 1:
        return True, first_parts[0]
    return False, ""


def extract_archive_strip_root(archive_bytes, target_dir):
    """解压 zip，并移除 GitHub archive 里的顶层目录壳。"""
    target_path = Path(target_dir)
    target_path.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(BytesIO(archive_bytes), "r") as archive:
        names = archive.namelist()
        should_strip, root_name = _strip_archive_root(names)
        for info in archive.infolist():
            if info.is_dir():
                continue
            raw_path = Path(info.filename)
            parts = raw_path.parts
            if should_strip and parts and parts[0] == root_name:
                parts = parts[1:]
            if not parts:
                continue
            relative_path = Path(*parts)
            destination = _safe_destination(target_path, relative_path)
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info, "r") as source, destination.open("wb") as target:
                shutil.copyfileobj(source, target)


def install_requirements_if_present(plugin_dir):
    requirements_path = Path(plugin_dir) / "requirements.txt"
    if not requirements_path.exists():
        return
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "-r", str(requirements_path)],
        check=True,
        capture_output=True,
        text=True,
        timeout=300,
    )


def _unique_backup_path(plugin_dir, plugin_name):
    timestamp = time.strftime("%Y%m%d%H%M%S")
    parent = Path(plugin_dir).parent
    for index in range(100):
        suffix = f"{timestamp}-{index}" if index else timestamp
        backup_path = parent / f".{plugin_name}.backup-{suffix}"
        if not backup_path.exists():
            return backup_path
    raise RuntimeError("无法创建唯一备份目录")


def update_plugin_safe(
    plugin_dir,
    plugin_name,
    repo_url,
    archive_downloader=download_archive,
    requirements_installer=install_requirements_if_present,
):
    """原子更新插件：失败时恢复旧目录，成功时保留 plugin_config.json。"""
    plugin_path = Path(plugin_dir)
    if not plugin_path.exists():
        raise FileNotFoundError(f"插件目录不存在：{plugin_path}")

    backup_path = _unique_backup_path(plugin_path, plugin_name)
    config_path = plugin_path / "plugin_config.json"
    config_bytes = config_path.read_bytes() if config_path.exists() else None

    archive_bytes = None
    plugin_path.rename(backup_path)
    try:
        archive_bytes = archive_downloader(repo_url)
        if not archive_bytes:
            raise RuntimeError("下载到的插件压缩包为空")

        extract_archive_strip_root(archive_bytes, plugin_path)
        if config_bytes is not None:
            (plugin_path / "plugin_config.json").write_bytes(config_bytes)

        requirements_installer(plugin_path)
        metadata = get_local_metadata(plugin_path)
        shutil.rmtree(backup_path, ignore_errors=True)
        return {
            "name": metadata.get("name", plugin_name),
            "version": metadata.get("version", ""),
            "plugin_dir": str(plugin_path),
        }
    except Exception:
        shutil.rmtree(plugin_path, ignore_errors=True)
        if backup_path.exists():
            backup_path.rename(plugin_path)
        raise


def install_plugin_from_archive(
    plugin_dir,
    repo_url,
    archive_downloader=download_archive,
    requirements_installer=install_requirements_if_present,
):
    """安装新插件，失败时不留下空目录。"""
    plugin_path = Path(plugin_dir)
    if plugin_path.exists() and any(plugin_path.iterdir()):
        raise FileExistsError(f"插件目录已存在：{plugin_path}")

    archive_bytes = archive_downloader(repo_url)
    temp_dir = Path(
        tempfile.mkdtemp(prefix=f".{plugin_path.name}.install-", dir=str(plugin_path.parent))
    )
    try:
        extract_archive_strip_root(archive_bytes, temp_dir)
        requirements_installer(temp_dir)
        if plugin_path.exists():
            shutil.rmtree(plugin_path)
        temp_dir.rename(plugin_path)
        metadata = get_local_metadata(plugin_path)
        return {
            "name": metadata.get("name", plugin_path.name),
            "version": metadata.get("version", ""),
            "plugin_dir": str(plugin_path),
        }
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        if plugin_path.exists() and not any(plugin_path.iterdir()):
            shutil.rmtree(plugin_path, ignore_errors=True)
        raise


def check_framework_compatibility(version_spec, current_version="1.0.0"):
    """检查插件 framework_version 是否兼容当前框架版本。"""
    if not version_spec:
        return True, ""
    if SpecifierSet is None or Version is None:
        return True, ""

    try:
        specifier = SpecifierSet(str(version_spec).strip())
        version = Version(str(current_version).strip().lstrip("vV"))
    except (InvalidSpecifier, InvalidVersion) as exc:
        return False, f"framework_version 格式无效：{exc}"

    if not specifier.contains(version, prereleases=True):
        return False, f"当前插件框架版本 {current_version} 不满足 {version_spec}"
    return True, ""
