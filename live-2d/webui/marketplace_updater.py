#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""插件市场安装/更新辅助函数。

这里尽量只放纯逻辑和文件操作，Flask 路由留在 marketplace.py。

主要分四块：
1. 下载来源：GitHub 直连 / 镜像前缀、候选 URL、快速探测、大小上限。
2. 插件包校验：zip 或目录里必须有合法的 metadata.json 与入口文件。
3. 依赖安装：pip（预检只装缺失）+ npm（缺 node_modules 时自动装）。
4. 安装与更新：暂存目录、持久化数据保留、备份与回滚。
"""

import importlib.metadata
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path

try:
    from packaging.requirements import InvalidRequirement, Requirement
    from packaging.specifiers import InvalidSpecifier, SpecifierSet
    from packaging.utils import canonicalize_name
    from packaging.version import InvalidVersion, Version
except ImportError:  # pragma: no cover - packaging 通常由依赖链提供
    InvalidRequirement = ValueError
    Requirement = None
    InvalidSpecifier = ValueError
    SpecifierSet = None
    InvalidVersion = ValueError
    Version = None

    def canonicalize_name(name):
        return re.sub(r"[-_.]+", "-", str(name)).lower()

from .market_settings import BUILTIN_GITHUB_MIRRORS, DEFAULTS as DEFAULT_MARKET_SETTINGS, normalize_settings
from .utils import PROJECT_ROOT

GITHUB_REPO_RE = re.compile(
    r"^https://(?:www\.)?github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)"
    r"(?:\.git)?(?:/tree/([A-Za-z0-9_.\-/]+))?/?$"
)
# 镜像前缀只对 GitHub 自家域名有意义；api.github.com 镜像站普遍不代理，所以不在列。
MIRRORABLE_HOSTS = {
    "github.com",
    "www.github.com",
    "raw.githubusercontent.com",
    "codeload.github.com",
    "objects.githubusercontent.com",
}

USER_AGENT = "my-neuro-plugin-market/2.0"
DEFAULT_TIMEOUT = 12
METADATA_TIMEOUT = 8
API_TIMEOUT = 5
PROBE_TIMEOUT = 8
PROBE_TOTAL_BUDGET = 20
DOWNLOAD_TIMEOUT = 120
DOWNLOAD_CHUNK = 256 * 1024
DEPENDENCY_TIMEOUT = 600
MAX_PLUGIN_ARCHIVE_BYTES = 300 * 1024 * 1024

PLUGIN_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
ALLOWED_PLUGIN_LANGS = ("js", "python")

PERSISTENCE_MANIFEST_NAME = "plugin_persistence.json"
DEFAULT_PERSISTENT_PATHS = (
    "plugin_config.json",
    "data",
    "cache",
    ".cache",
    ".runtime",
    "storage",
    "state",
    "logs",
    "downloads",
    "media",
    "output",
    "generated",
)
PERSISTENT_FILE_SUFFIXES = {".db", ".sqlite", ".sqlite3"}
PERSISTENT_FILE_TOKENS = {
    "activity",
    "archive",
    "cache",
    "config",
    "context",
    "data",
    "database",
    "diary",
    "history",
    "memory",
    "profile",
    "record",
    "session",
    "snapshot",
    "state",
    "store",
}
MAX_RETAINED_UPDATE_BACKUPS = 3


class PluginValidationError(ValueError):
    """插件包 / 插件目录不符合肥牛插件格式。"""


class ArchiveTooLargeError(PluginValidationError):
    """插件压缩包超过大小上限。"""


class DownloadError(RuntimeError):
    """所有下载来源都失败。"""


class DependencyInstallError(RuntimeError):
    """pip / npm 依赖安装失败。"""


# ============ GitHub 地址解析 ============

def parse_github_repo_ref(repo_url):
    """解析 GitHub 仓库 URL，返回 (owner, repo, branch)；没有 /tree/<branch> 时 branch 为 None。"""
    if not repo_url:
        raise ValueError("插件仓库地址为空")

    match = GITHUB_REPO_RE.match(str(repo_url).strip())
    if not match:
        raise ValueError(f"无效的 GitHub 仓库地址：{repo_url}")

    owner, repo, branch = match.group(1), match.group(2), match.group(3)
    repo = repo.removesuffix(".git")
    branch = branch.strip("/") if branch else None
    return owner, repo, branch or None


def parse_github_repo(repo_url):
    """解析 GitHub 仓库 URL，返回 (owner, repo)。"""
    owner, repo, _branch = parse_github_repo_ref(repo_url)
    return owner, repo


def normalize_repo_url(repo_url):
    owner, repo, branch = parse_github_repo_ref(repo_url)
    base = f"https://github.com/{owner}/{repo}"
    return f"{base}/tree/{branch}" if branch else base


# ============ 下载来源：镜像与候选地址 ============

def apply_mirror(url, mirror):
    """给 GitHub 域名的 URL 加镜像前缀；mirror 为空或 URL 不是 GitHub 域名时原样返回。"""
    if not mirror:
        return url
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    if host not in MIRRORABLE_HOSTS:
        return url
    return f"{mirror.rstrip('/')}/{url}"


def source_label(mirror):
    if not mirror:
        return "direct"
    return urllib.parse.urlsplit(mirror).hostname or mirror


def _settings_or_default(settings):
    if settings is None:
        return dict(DEFAULT_MARKET_SETTINGS)
    return normalize_settings(settings)


def github_source_plan(settings=None):
    """按设置返回来源尝试顺序：None 表示直连，字符串表示镜像前缀。"""
    resolved = _settings_or_default(settings)
    mode = resolved.get("github_mirror_mode", "auto")
    mirror = resolved.get("github_mirror", "")

    if mode == "direct":
        return [None]
    if mode == "fixed":
        plan = [mirror or None, None]
    else:
        plan = [None, *BUILTIN_GITHUB_MIRRORS]

    ordered = []
    for item in plan:
        if item not in ordered:
            ordered.append(item)
    return ordered


def archive_candidates(repo_url):
    """zip 包候选地址。HEAD.zip 直接对应默认分支，不需要先查 API。"""
    owner, repo, branch = parse_github_repo_ref(repo_url)
    base = f"https://github.com/{owner}/{repo}/archive"
    if branch:
        return [f"{base}/refs/heads/{branch}.zip"]
    return [
        f"{base}/HEAD.zip",
        f"{base}/refs/heads/main.zip",
        f"{base}/refs/heads/master.zip",
    ]


def raw_metadata_candidates(repo_url):
    owner, repo, branch = parse_github_repo_ref(repo_url)
    refs = [branch] if branch else ["HEAD", "main", "master"]
    return [
        f"https://raw.githubusercontent.com/{owner}/{repo}/{ref}/metadata.json"
        for ref in refs
    ]


# ============ HTTP 层（opener 可注入，便于测试） ============

def _build_request(url, method="GET", headers=None):
    merged = {"User-Agent": USER_AGENT, "Accept": "application/json,*/*"}
    if headers:
        merged.update(headers)
    return urllib.request.Request(url, headers=merged, method=method)


def default_opener(request, timeout):
    return urllib.request.urlopen(request, timeout=timeout)


def _response_ok(response):
    status = getattr(response, "status", None)
    if status is None:
        return True
    return 200 <= int(status) < 400


def _read_url_bytes(url, timeout=DEFAULT_TIMEOUT, opener=None):
    opener = opener or default_opener
    with opener(_build_request(url), timeout) as response:
        return response.read()


def _read_json_url(url, timeout=DEFAULT_TIMEOUT, opener=None):
    return json.loads(_read_url_bytes(url, timeout=timeout, opener=opener).decode("utf-8-sig"))


def probe_url(url, opener=None, timeout=PROBE_TIMEOUT, total_budget=PROBE_TOTAL_BUDGET):
    """快速探测地址是否可达：先 HEAD，被拒绝时改用 Range GET。只返回 True/False。"""
    opener = opener or default_opener
    started = time.monotonic()
    try:
        with opener(_build_request(url, method="HEAD"), timeout) as response:
            return _response_ok(response)
    except urllib.error.HTTPError as exc:
        if exc.code not in (403, 405, 501):
            return False
    except (urllib.error.URLError, socket.timeout, OSError, ValueError):
        return False

    if time.monotonic() - started > total_budget:
        return False
    try:
        with opener(_build_request(url, headers={"Range": "bytes=0-0"}), timeout) as response:
            return _response_ok(response)
    except Exception:
        return False


def _download_bytes(url, opener, timeout, max_bytes, progress=None):
    with opener(_build_request(url), timeout) as response:
        headers = getattr(response, "headers", None)
        length_header = headers.get("Content-Length") if headers else None
        total = int(length_header) if length_header and str(length_header).isdigit() else None
        if total is not None and total > max_bytes:
            raise ArchiveTooLargeError(
                f"插件压缩包 {total / 1024 / 1024:.1f} MB，超过上限 {max_bytes // 1024 // 1024} MB"
            )

        buffer = BytesIO()
        downloaded = 0
        while True:
            chunk = response.read(DOWNLOAD_CHUNK)
            if not chunk:
                break
            downloaded += len(chunk)
            if downloaded > max_bytes:
                raise ArchiveTooLargeError(
                    f"插件压缩包超过上限 {max_bytes // 1024 // 1024} MB"
                )
            buffer.write(chunk)
            if progress:
                progress(downloaded, total)
        return buffer.getvalue()


def download_archive(
    repo_url,
    settings=None,
    timeout=DOWNLOAD_TIMEOUT,
    opener=None,
    progress=None,
    probe_timeout=PROBE_TIMEOUT,
    max_bytes=MAX_PLUGIN_ARCHIVE_BYTES,
):
    """下载插件源码 zip，返回 (字节, 来源标签)。

    按来源计划（直连 / 镜像）× 候选地址依次尝试；每个地址先用短超时探测，
    探测通过才用长超时正式下载，这样直连不通的用户能在几十秒内切到镜像。
    """
    opener = opener or default_opener
    candidates = archive_candidates(repo_url)
    errors = []

    for mirror in github_source_plan(settings):
        label = source_label(mirror)
        for candidate in candidates:
            url = apply_mirror(candidate, mirror)
            if not probe_url(url, opener=opener, timeout=probe_timeout):
                errors.append(f"[{label}] {candidate} 不可达")
                continue
            try:
                data = _download_bytes(url, opener, timeout, max_bytes, progress)
            except ArchiveTooLargeError:
                raise
            except (urllib.error.HTTPError, urllib.error.URLError, socket.timeout, OSError, ValueError) as exc:
                errors.append(f"[{label}] {candidate} 下载失败：{exc}")
                continue
            if not data:
                errors.append(f"[{label}] {candidate} 返回空内容")
                continue
            return data, label

    detail = errors[-1] if errors else "没有可用的下载地址"
    raise DownloadError(
        f"所有下载来源均失败（共尝试 {len(errors)} 次）。最后一次：{detail}。"
        "可在「下载设置」里切换镜像后重试。"
    )


def get_default_branch(repo_url, timeout=API_TIMEOUT, opener=None):
    owner, repo, _branch = parse_github_repo_ref(repo_url)
    info = _read_json_url(
        f"https://api.github.com/repos/{owner}/{repo}",
        timeout=timeout,
        opener=opener,
    )
    return info.get("default_branch") or "main"


def fetch_remote_metadata_with_source(repo_url, timeout=METADATA_TIMEOUT, settings=None, opener=None):
    """抓取远程 metadata.json，返回 (metadata, 来源标签)。

    先按来源计划遍历 raw 地址（HEAD/main/master 或指定分支），全部失败后才用
    api.github.com 查默认分支兜底（短超时，失败不影响错误信息）。
    """
    candidates = raw_metadata_candidates(repo_url)
    plan = github_source_plan(settings)
    tried = 0
    last_error = None

    for mirror in plan:
        for candidate in candidates:
            tried += 1
            try:
                return _read_json_url(apply_mirror(candidate, mirror), timeout=timeout, opener=opener), source_label(mirror)
            except Exception as exc:
                last_error = exc

    try:
        owner, repo, branch = parse_github_repo_ref(repo_url)
        if not branch:
            default_branch = get_default_branch(repo_url, timeout=API_TIMEOUT, opener=opener)
            if default_branch and default_branch not in {"HEAD", "main", "master"}:
                candidate = f"https://raw.githubusercontent.com/{owner}/{repo}/{default_branch}/metadata.json"
                for mirror in plan:
                    tried += 1
                    try:
                        return _read_json_url(apply_mirror(candidate, mirror), timeout=timeout, opener=opener), source_label(mirror)
                    except Exception as exc:
                        last_error = exc
    except Exception as exc:
        last_error = last_error or exc

    raise RuntimeError(f"无法读取远程 metadata.json，已尝试 {tried} 个地址（{last_error}）")


def fetch_remote_metadata(repo_url, timeout=METADATA_TIMEOUT, settings=None, opener=None):
    """从插件仓库抓取远程 metadata.json（兼容旧调用方，只返回字典）。"""
    metadata, _source = fetch_remote_metadata_with_source(
        repo_url, timeout=timeout, settings=settings, opener=opener
    )
    return metadata


# ============ 版本比较与更新检查 ============

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


# ============ 插件包校验 ============

def resolve_entry_file(metadata):
    """与 Electron 侧 plugin-manager.js 的入口解析规则保持一致。"""
    lang = metadata.get("lang") or "js"
    main = metadata.get("main") or "index.js"
    if main != "index.js":
        return main
    return "index.py" if lang == "python" else "index.js"


def validate_plugin_metadata(metadata):
    """校验 metadata.json 内容，返回归一化后的 {name, version, lang, entry}。"""
    if not isinstance(metadata, dict):
        raise PluginValidationError("metadata.json 必须是 JSON 对象")

    name = metadata.get("name")
    if not isinstance(name, str) or not name.strip():
        raise PluginValidationError("metadata.json 缺少 name，或 name 为空")
    name = name.strip()
    if not PLUGIN_NAME_RE.match(name):
        raise PluginValidationError(
            f'插件 name "{name}" 不合法：只能包含字母、数字、点、下划线、连字符，'
            "以字母或数字开头，最长 64 个字符"
        )

    version = metadata.get("version")
    if not isinstance(version, str) or not version.strip():
        raise PluginValidationError("metadata.json 缺少 version，或 version 为空")

    lang = metadata.get("lang")
    if lang is not None and lang not in ALLOWED_PLUGIN_LANGS:
        raise PluginValidationError(f"metadata.json 的 lang 只能是 js 或 python，当前为 {lang!r}")

    main = metadata.get("main")
    if main is not None:
        normalized_main = str(main).replace("\\", "/") if isinstance(main, str) else ""
        if (
            not normalized_main.strip()
            or normalized_main.startswith("/")
            or ".." in normalized_main.split("/")
            or re.match(r"^[A-Za-z]:", normalized_main)
        ):
            raise PluginValidationError("metadata.json 的 main 不合法：必须是插件目录内的相对路径")

    return {
        "name": name,
        "version": version.strip(),
        "lang": lang or "js",
        "entry": resolve_entry_file(metadata),
    }


def _strip_archive_root(names):
    clean_names = [name for name in names if name and not name.endswith("/")]
    if not clean_names:
        return False, ""
    first_parts = [Path(name).parts[0] for name in clean_names if Path(name).parts]
    if first_parts and len(set(first_parts)) == 1:
        return True, first_parts[0]
    return False, ""


def inspect_plugin_archive_bytes(archive_bytes, max_bytes=MAX_PLUGIN_ARCHIVE_BYTES):
    """校验 zip 是否为合法肥牛插件包，返回 {metadata, info, root}。"""
    if not archive_bytes:
        raise PluginValidationError("插件压缩包为空")
    if len(archive_bytes) > max_bytes:
        raise ArchiveTooLargeError(
            f"插件压缩包 {len(archive_bytes) / 1024 / 1024:.1f} MB，超过上限 {max_bytes // 1024 // 1024} MB"
        )

    try:
        archive = zipfile.ZipFile(BytesIO(archive_bytes), "r")
    except zipfile.BadZipFile as exc:
        raise PluginValidationError("文件不是合法的 zip 压缩包") from exc

    with archive:
        names = [name.replace("\\", "/") for name in archive.namelist()]
        should_strip, root_name = _strip_archive_root(names)
        prefix = f"{root_name}/" if should_strip else ""
        metadata_entry = f"{prefix}metadata.json"
        if metadata_entry not in names:
            raise PluginValidationError("压缩包根目录没有 metadata.json，这不是肥牛插件包")

        raw_entry = archive.namelist()[names.index(metadata_entry)]
        try:
            metadata = json.loads(archive.read(raw_entry).decode("utf-8-sig"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise PluginValidationError(f"metadata.json 无法解析：{exc}") from exc

        info = validate_plugin_metadata(metadata)
        entry_name = f"{prefix}{info['entry']}"
        if entry_name not in names:
            raise PluginValidationError(f"压缩包缺少入口文件 {info['entry']}")

    return {"metadata": metadata, "info": info, "root": root_name if should_strip else ""}


def validate_plugin_directory(plugin_dir):
    """校验解压后的插件目录，返回 {metadata, info}。"""
    plugin_path = Path(plugin_dir)
    metadata_path = plugin_path / "metadata.json"
    if not metadata_path.is_file():
        raise PluginValidationError("插件目录没有 metadata.json")
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise PluginValidationError(f"metadata.json 无法解析：{exc}") from exc

    info = validate_plugin_metadata(metadata)
    if not (plugin_path / info["entry"]).is_file():
        raise PluginValidationError(f"插件缺少入口文件 {info['entry']}")
    return {"metadata": metadata, "info": info}


def _safe_destination(base_dir, relative_path):
    destination = (base_dir / relative_path).resolve()
    base_resolved = base_dir.resolve()
    if os.path.commonpath([str(base_resolved), str(destination)]) != str(base_resolved):
        raise ValueError(f"压缩包包含不安全路径：{relative_path}")
    return destination


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


# ============ 依赖安装：Python（pip） ============

def resolve_plugin_python():
    """Python 插件桥（python-plugin-bridge.js）用的解释器：优先项目自带 env/python.exe。"""
    project_python = PROJECT_ROOT.parent / "env" / "python.exe"
    if os.name == "nt" and project_python.is_file():
        return str(project_python)
    return sys.executable


def _same_interpreter(python_exe):
    try:
        return Path(python_exe).resolve() == Path(sys.executable).resolve()
    except OSError:
        return False


_LIST_DISTRIBUTIONS_SCRIPT = (
    "import json,importlib.metadata as m;"
    "print(json.dumps({d.metadata['Name']:d.version for d in m.distributions() if d.metadata['Name']}))"
)


def list_installed_distributions(python_exe=None, runner=subprocess.run):
    """返回目标解释器已安装分发 {规范化名: 版本}；拿不到时返回 None（调用方退回全量安装）。"""
    python_exe = python_exe or resolve_plugin_python()
    try:
        if _same_interpreter(python_exe):
            installed = {}
            for dist in importlib.metadata.distributions():
                dist_name = dist.metadata["Name"] if dist.metadata else None
                if dist_name:
                    installed[canonicalize_name(dist_name)] = dist.version
            return installed

        result = runner(
            [python_exe, "-c", _LIST_DISTRIBUTIONS_SCRIPT],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None
        data = json.loads(result.stdout.strip().splitlines()[-1])
        return {canonicalize_name(name): version for name, version in data.items()}
    except Exception:
        return None


def _requirement_lines(text):
    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        # pip 把 " #" 视为行内注释起点
        yield stripped.split(" #", 1)[0].strip()


def plan_requirements_install(requirements_path, installed, python_is_current=True):
    """决定 requirements.txt 该怎么装：skip（都装好了）/ partial（只装缺的）/ full（全量）。

    任何解析不确定的情况都返回 full，只会多装不会少装。
    """
    path = Path(requirements_path)
    if not path.is_file():
        return {"mode": "skip", "missing": [], "lines": [], "reason": "no requirements.txt"}

    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError as exc:
        return {"mode": "full", "missing": [], "lines": [], "reason": f"read failed: {exc}"}
    lines = list(_requirement_lines(text))

    def full(reason):
        return {"mode": "full", "missing": list(lines), "lines": lines, "reason": reason}

    if not lines:
        return {"mode": "skip", "missing": [], "lines": [], "reason": "empty requirements"}
    if installed is None:
        return full("installed distributions unknown")
    if Requirement is None or Version is None:
        return full("packaging unavailable")

    missing = []
    for line in lines:
        if line.startswith("-") or "://" in line or "@" in line:
            return full(f"unsupported line: {line}")
        if line.endswith("\\") or line.startswith((".", "/", "\\")) or re.match(r"^[A-Za-z]:[\\/]", line):
            return full(f"unsupported line: {line}")
        try:
            requirement = Requirement(line)
        except InvalidRequirement:
            return full(f"unparseable line: {line}")
        if requirement.url:
            return full(f"direct reference: {line}")
        if requirement.marker is not None:
            if not python_is_current:
                return full(f"marker on foreign interpreter: {line}")
            try:
                if not requirement.marker.evaluate():
                    continue
            except Exception:
                return full(f"marker evaluation failed: {line}")
        if requirement.extras:
            return full(f"extras cannot be verified: {line}")

        current = installed.get(canonicalize_name(requirement.name))
        if current is None:
            missing.append(line)
            continue
        if not str(requirement.specifier):
            continue
        try:
            if requirement.specifier.contains(Version(current), prereleases=True):
                continue
        except InvalidVersion:
            return full(f"installed version unparseable: {requirement.name}={current}")
        missing.append(line)

    if not missing:
        return {"mode": "skip", "missing": [], "lines": lines, "reason": "all satisfied"}
    return {"mode": "partial", "missing": missing, "lines": lines, "reason": f"{len(missing)} missing"}


def pip_install_requirements_cmd(plugin_dir, settings=None, plan=None, python_exe=None, requirements_file=None):
    """构造安装插件 requirements 的 pip 命令行；没有可装的内容时返回 None。

    若插件目录下存在 ``vendor/*.whl``，则附加 ``--no-index --find-links=vendor``，
    优先仅从本地 wheel 安装（开箱离线、无需访问 PyPI）。此时不再附加 pip 镜像参数。
    """
    plugin_path = Path(plugin_dir)
    requirements_path = Path(requirements_file) if requirements_file else plugin_path / "requirements.txt"
    if not requirements_path.is_file():
        return None
    if plan and plan.get("mode") == "skip":
        return None

    cmd = [
        python_exe or resolve_plugin_python(),
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "-r",
        str(requirements_path),
    ]

    vendor_dir = plugin_path / "vendor"
    uses_vendor = False
    if vendor_dir.is_dir():
        has_wheel = any(
            p.is_file() and p.suffix.lower() == ".whl" and not p.name.startswith(".")
            for p in vendor_dir.iterdir()
        )
        if has_wheel:
            cmd.extend(["--no-index", "--find-links", str(vendor_dir)])
            uses_vendor = True

    resolved = _settings_or_default(settings)
    index_url = resolved.get("pip_index_url", "")
    if index_url and not uses_vendor:
        cmd.extend(["-i", index_url])
    return cmd


# ============ 依赖安装：Node（npm） ============

def npm_command_prefix():
    """找到 npm。优先 ``node npm-cli.js``（避开 .cmd 批处理的引号问题），否则用 npm/npm.cmd。"""
    candidates = ["npm.cmd", "npm"] if os.name == "nt" else ["npm"]
    npm_path = None
    for candidate in candidates:
        npm_path = shutil.which(candidate)
        if npm_path:
            break
    if not npm_path:
        return None

    npm_dir = Path(npm_path).parent
    node_name = "node.exe" if os.name == "nt" else "node"
    node_path = npm_dir / node_name
    cli_path = npm_dir / "node_modules" / "npm" / "bin" / "npm-cli.js"
    if node_path.is_file() and cli_path.is_file():
        return [str(node_path), str(cli_path)]
    return [npm_path]


def node_install_plan(plugin_dir):
    """判断插件是否需要 npm install：有 package.json、声明了 dependencies、且没有 node_modules。"""
    plugin_path = Path(plugin_dir)
    package_json = plugin_path / "package.json"
    if not package_json.is_file():
        return {"needed": False, "reason": "no package.json"}

    try:
        data = json.loads(package_json.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        return {"needed": False, "reason": f"package.json 无法解析：{exc}", "warning": True}

    dependencies = data.get("dependencies") if isinstance(data, dict) else None
    if not isinstance(dependencies, dict) or not dependencies:
        return {"needed": False, "reason": "no dependencies"}
    if (plugin_path / "node_modules").is_dir():
        return {"needed": False, "reason": "node_modules already present"}
    return {
        "needed": True,
        "reason": f"{len(dependencies)} dependencies declared",
        "dependencies": sorted(dependencies),
    }


def npm_install_cmd(plugin_dir, settings=None, npm_prefix=None):
    """构造 npm install 命令；找不到 npm 时返回 None。"""
    prefix = npm_prefix if npm_prefix is not None else npm_command_prefix()
    if not prefix:
        return None
    cmd = [*prefix, "install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"]
    resolved = _settings_or_default(settings)
    registry = resolved.get("npm_registry", "")
    if registry:
        cmd.extend(["--registry", registry])
    return cmd


# ============ 统一依赖安装器 ============

def _tail_text(text, limit=2000):
    text = (text or "").strip()
    return text[-limit:]


def _run_dependency_command(cmd, *, runner, timeout, label, cwd=None, env=None):
    try:
        result = runner(
            cmd,
            cwd=cwd,
            env=env,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise DependencyInstallError(f"{label} 安装超时（超过 {timeout} 秒）") from exc
    except OSError as exc:
        raise DependencyInstallError(f"{label} 安装命令无法启动：{exc}") from exc

    if result.returncode != 0:
        detail = _tail_text(result.stderr) or _tail_text(result.stdout) or f"退出码 {result.returncode}"
        raise DependencyInstallError(f"{label} 安装失败：{detail}")
    return result


def install_dependencies(
    plugin_dir,
    settings=None,
    report=None,
    runner=subprocess.run,
    python_exe=None,
    npm_prefix=None,
    installed_lookup=None,
    timeout=DEPENDENCY_TIMEOUT,
):
    """先装 Python 依赖再装 Node 依赖。返回警告列表；失败抛 DependencyInstallError。

    report(stage, detail) 可选，stage 取值：installing_deps / deps_skipped / installing_node_deps。
    规则：找不到 npm 只警告不失败；找到 npm 但安装失败按失败处理。
    """
    warnings = []
    notify = report or (lambda stage, detail=None: None)
    plugin_path = Path(plugin_dir)
    resolved = _settings_or_default(settings)

    requirements_path = plugin_path / "requirements.txt"
    if requirements_path.is_file():
        python_exe = python_exe or resolve_plugin_python()
        lookup = installed_lookup or list_installed_distributions
        installed = lookup(python_exe)
        plan = plan_requirements_install(
            requirements_path,
            installed,
            python_is_current=_same_interpreter(python_exe),
        )
        if plan["mode"] == "skip":
            notify("deps_skipped", plan.get("reason"))
        else:
            notify("installing_deps", plan.get("reason"))
            temp_requirements = None
            try:
                requirements_file = requirements_path
                if plan["mode"] == "partial":
                    with tempfile.NamedTemporaryFile(
                        "w", suffix="_plugin_requirements.txt", delete=False, encoding="utf-8"
                    ) as handle:
                        handle.write("\n".join(plan["missing"]) + "\n")
                        temp_requirements = Path(handle.name)
                    requirements_file = temp_requirements
                cmd = pip_install_requirements_cmd(
                    plugin_path,
                    settings=resolved,
                    plan=plan,
                    python_exe=python_exe,
                    requirements_file=requirements_file,
                )
                if cmd:
                    _run_dependency_command(cmd, runner=runner, timeout=timeout, label="Python 依赖（pip）")
            finally:
                if temp_requirements is not None:
                    try:
                        temp_requirements.unlink()
                    except OSError:
                        pass

    node_plan = node_install_plan(plugin_path)
    if node_plan.get("warning"):
        warnings.append(f"已跳过 Node 依赖安装：{node_plan['reason']}")
    if node_plan.get("needed"):
        cmd = npm_install_cmd(plugin_path, settings=resolved, npm_prefix=npm_prefix)
        if not cmd:
            warnings.append(
                "未找到 npm，已跳过 Node 依赖安装；若插件仓库未自带 node_modules，该插件可能无法运行。"
                "安装 Node.js 后重新安装插件即可补齐依赖。"
            )
        else:
            notify("installing_node_deps", node_plan.get("reason"))
            env = dict(os.environ)
            env["NO_UPDATE_NOTIFIER"] = "1"
            env["npm_config_update_notifier"] = "false"
            _run_dependency_command(
                cmd,
                runner=runner,
                timeout=timeout,
                label="Node 依赖（npm）",
                cwd=str(plugin_path),
                env=env,
            )
    return warnings


def install_requirements_if_present(plugin_dir, settings=None):
    """兼容旧名字的入口：现在等价于 install_dependencies（pip + npm）。"""
    return install_dependencies(plugin_dir, settings=settings)


# ============ 持久化数据保留、备份与回滚 ============

def _normalize_persistent_path(value):
    if not isinstance(value, str):
        return None
    text = value.strip().replace("\\", "/")
    if not text:
        return None
    relative = Path(text)
    if relative.is_absolute() or ".." in relative.parts or relative == Path("."):
        raise ValueError(f"Invalid persistent plugin path: {value}")
    return relative


def _declared_persistent_paths(plugin_dir):
    plugin_path = Path(plugin_dir)
    declared = set()

    metadata = get_local_metadata(plugin_path)
    metadata_paths = metadata.get("persistent_paths", []) if isinstance(metadata, dict) else []
    if metadata_paths and not isinstance(metadata_paths, list):
        raise ValueError("metadata.json persistent_paths must be an array")

    manifest_path = plugin_path / PERSISTENCE_MANIFEST_NAME
    manifest_paths = []
    if manifest_path.is_file():
        with manifest_path.open("r", encoding="utf-8-sig") as file:
            manifest = json.load(file)
        if isinstance(manifest, list):
            manifest_paths = manifest
        elif isinstance(manifest, dict):
            manifest_paths = manifest.get("paths", [])
        else:
            raise ValueError(f"{PERSISTENCE_MANIFEST_NAME} must be an object or array")
        if not isinstance(manifest_paths, list):
            raise ValueError(f"{PERSISTENCE_MANIFEST_NAME} paths must be an array")

    for value in [*metadata_paths, *manifest_paths]:
        normalized = _normalize_persistent_path(value)
        if normalized is not None:
            declared.add(normalized)
    return declared


def _discover_persistent_paths(old_plugin_dir, new_plugin_dir):
    old_path = Path(old_plugin_dir)
    paths = {Path(value) for value in DEFAULT_PERSISTENT_PATHS}
    paths.update(_declared_persistent_paths(old_path))
    paths.update(_declared_persistent_paths(new_plugin_dir))

    for child in old_path.iterdir():
        if not child.is_file() or child.is_symlink():
            continue
        lower_name = child.name.lower()
        stem_tokens = {
            token
            for token in re.split(r"[^a-z0-9]+", child.stem.lower())
            if token
        }
        if (
            child.suffix.lower() in PERSISTENT_FILE_SUFFIXES
            or stem_tokens.intersection(PERSISTENT_FILE_TOKENS)
            or any(token in lower_name for token in ("cache", "history", "state"))
        ):
            paths.add(Path(child.name))

    return sorted(paths, key=lambda value: value.as_posix())


def _copy_persistent_path(source_root, target_root, relative_path):
    source = Path(source_root) / relative_path
    target = Path(target_root) / relative_path
    if not source.exists() or source.is_symlink():
        return False

    if source.is_dir():
        if target.exists() and not target.is_dir():
            target.unlink()
        shutil.copytree(source, target, dirs_exist_ok=True, symlinks=True)
    elif source.is_file():
        if target.exists() and target.is_dir():
            shutil.rmtree(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    else:
        return False
    return True


def _unique_backup_path(plugin_dir, plugin_name):
    timestamp = time.strftime("%Y%m%d%H%M%S")
    plugin_path = Path(plugin_dir)
    backup_root = plugin_path.parent / ".plugin-update-backups"
    backup_root.mkdir(parents=True, exist_ok=True)
    safe_name = plugin_path.name
    for index in range(100):
        suffix = f"{timestamp}-{index}" if index else timestamp
        backup_path = backup_root / f"{safe_name}.backup-{suffix}"
        if not backup_path.exists():
            return backup_path
    raise RuntimeError("无法创建唯一备份目录")


def _prune_old_backups(backup_path, keep=MAX_RETAINED_UPDATE_BACKUPS):
    backup = Path(backup_path)
    prefix = backup.name.split(".backup-", 1)[0] + ".backup-"
    try:
        candidates = sorted(
            (
                path
                for path in backup.parent.iterdir()
                if path.is_dir() and path.name.startswith(prefix)
            ),
            key=lambda path: path.stat().st_mtime_ns,
            reverse=True,
        )
    except OSError:
        return
    for stale in candidates[max(1, keep):]:
        shutil.rmtree(stale, ignore_errors=True)


# ============ 安装与更新 ============

def _normalize_download_result(result):
    """注入的下载器可以返回 bytes 或 (bytes, 来源标签)。"""
    if isinstance(result, tuple) and len(result) == 2:
        data, source = result
    else:
        data, source = result, ""
    if not isinstance(data, (bytes, bytearray)) or not data:
        raise DownloadError("下载到的插件压缩包为空")
    return bytes(data), str(source or "")


def _resolve_dependency_installer(dependency_installer, requirements_installer):
    if dependency_installer is not None:
        return dependency_installer
    if requirements_installer is not None:
        return requirements_installer
    return install_dependencies


def _run_dependency_installer(installer, plugin_dir):
    result = installer(plugin_dir)
    if isinstance(result, (list, tuple)):
        return [str(item) for item in result if item]
    return []


def update_plugin_safe(
    plugin_dir,
    plugin_name,
    repo_url,
    archive_downloader=download_archive,
    requirements_installer=None,
    dependency_installer=None,
    on_stage=None,
):
    """Stage an update, preserve plugin-owned state, and retain rollback data."""
    plugin_path = Path(plugin_dir)
    if not plugin_path.exists():
        raise FileNotFoundError(f"插件目录不存在：{plugin_path}")

    stage = on_stage or (lambda name: None)
    installer = _resolve_dependency_installer(dependency_installer, requirements_installer)

    backup_path = None
    staged_path = Path(
        tempfile.mkdtemp(
            prefix=f".{plugin_path.name}.update-",
            dir=str(plugin_path.parent),
        )
    )
    old_directory_moved = False
    try:
        stage("downloading")
        archive_bytes, source_used = _normalize_download_result(archive_downloader(repo_url))

        stage("validating")
        inspect_plugin_archive_bytes(archive_bytes)

        stage("extracting")
        extract_archive_strip_root(archive_bytes, staged_path)
        validate_plugin_directory(staged_path)
        persistent_paths = _discover_persistent_paths(plugin_path, staged_path)
        preserved_paths = [
            relative.as_posix()
            for relative in persistent_paths
            if _copy_persistent_path(plugin_path, staged_path, relative)
        ]

        warnings = _run_dependency_installer(installer, staged_path)
        metadata = get_local_metadata(staged_path)

        backup_path = _unique_backup_path(plugin_path, plugin_name)
        plugin_path.rename(backup_path)
        old_directory_moved = True
        staged_path.rename(plugin_path)
        old_directory_moved = False
        _prune_old_backups(backup_path)
        return {
            "name": metadata.get("name", plugin_name),
            "version": metadata.get("version", ""),
            "plugin_dir": str(plugin_path),
            "preserved_paths": preserved_paths,
            "backup_path": str(backup_path),
            "source_used": source_used,
            "warnings": warnings,
        }
    except Exception:
        if old_directory_moved and backup_path is not None:
            shutil.rmtree(plugin_path, ignore_errors=True)
            backup_path.rename(plugin_path)
        raise
    finally:
        shutil.rmtree(staged_path, ignore_errors=True)


def install_plugin_from_archive(
    plugin_dir,
    repo_url,
    archive_downloader=download_archive,
    requirements_installer=None,
    dependency_installer=None,
    expected_name=None,
    on_stage=None,
):
    """安装新插件：下载 → 校验 → 解压到暂存目录 → 装依赖 → 原子就位。失败不留下空目录。"""
    plugin_path = Path(plugin_dir)
    if plugin_path.exists() and any(plugin_path.iterdir()):
        raise FileExistsError(f"插件目录已存在：{plugin_path}")

    stage = on_stage or (lambda name: None)
    installer = _resolve_dependency_installer(dependency_installer, requirements_installer)

    stage("downloading")
    archive_bytes, source_used = _normalize_download_result(archive_downloader(repo_url))

    stage("validating")
    inspection = inspect_plugin_archive_bytes(archive_bytes)
    warnings = []
    actual_name = inspection["info"]["name"]
    if expected_name and actual_name != expected_name:
        warnings.append(
            f'插件包内 metadata.name 为 "{actual_name}"，与安装目录名 "{expected_name}" 不一致，'
            "已按目录名安装；插件管理里显示的是 metadata 里的名字。"
        )

    plugin_path.parent.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(
        tempfile.mkdtemp(prefix=f".{plugin_path.name}.install-", dir=str(plugin_path.parent))
    )
    try:
        stage("extracting")
        extract_archive_strip_root(archive_bytes, temp_dir)
        validate_plugin_directory(temp_dir)
        warnings.extend(_run_dependency_installer(installer, temp_dir))
        if plugin_path.exists():
            shutil.rmtree(plugin_path)
        temp_dir.rename(plugin_path)
        metadata = get_local_metadata(plugin_path)
        return {
            "name": metadata.get("name", plugin_path.name),
            "version": metadata.get("version", ""),
            "plugin_dir": str(plugin_path),
            "source_used": source_used,
            "warnings": warnings,
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
