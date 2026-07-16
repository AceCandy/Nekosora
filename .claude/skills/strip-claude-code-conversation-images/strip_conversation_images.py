#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""清除 Claude Code 会话历史中的图片。

会话文件存于 ``~/.claude/projects/<项目编码>/*.jsonl``。某些模型（如 glm 系列）
不支持图片识别，resume 含图片的会话会报错。本工具递归把会话 JSON 里的 image
block 替换为文本占位，保留对话上下文，让会话能被 resume。

原文件自动备份为 ``<name>.jsonl.backup-<时间戳>``——不以 ``.jsonl`` 结尾，
不会被 Claude Code 当成会话再次扫描。

用法见 ``--help`` 或同目录 SKILL.md。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")  # Windows 终端中文不乱码
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

PLACEHOLDER = "[图片内容已移除：原为图片，因当前模型不支持图片识别已清除]"

# 快速扫描用：匹配 image block 的 type 字段（list 时近似计数，含可能的文本误报，仅用于筛选）
IMG_PATTERN = re.compile(r'"type"\s*:\s*"image"')


# ---------------- 纯函数（单元测试覆盖） ----------------

def is_image_block(node) -> bool:
    """判断是否为 image block。覆盖三种真实格式：
    - Anthropic API: ``{"type":"image","source":{"type":"base64",...}}``
    - Claude Code toolUseResult: ``{"type":"image","file":{"base64":...}}``
    - 仅 type=image 标记
    """
    if not isinstance(node, dict):
        return False
    if node.get("type") == "image":
        return True
    if isinstance(node.get("source"), dict) and node["source"].get("type") == "base64":
        return True
    if isinstance(node.get("file"), dict) and "base64" in node["file"]:
        return True
    return False


def strip_images(node):
    """递归把 image block 替换为占位，返回 ``(new_node, removed_count)``。

    - message.content 各层级里的 Anthropic image block -> ``{"type":"text","text":...}``（API 合法）
    - toolUseResult 字段的 image 对象 -> 字符串占位
    """
    if isinstance(node, dict):
        if is_image_block(node):
            # toolUseResult 格式（file.base64）整体降级为字符串
            if isinstance(node.get("file"), dict) and "base64" in node["file"]:
                return (PLACEHOLDER, 1)
            # Anthropic 格式降级为 text block，保证 content 数组结构合法
            return ({"type": "text", "text": PLACEHOLDER}, 1)
        new, removed = {}, 0
        for k, v in node.items():
            nv, r = strip_images(v)
            new[k] = nv
            removed += r
        return (new, removed)
    if isinstance(node, list):
        new, removed = [], 0
        for it in node:
            ni, r = strip_images(it)
            new.append(ni)
            removed += r
        return (new, removed)
    return (node, 0)


def count_images(node) -> int:
    """递归统计 image block 数量（精确，基于结构而非字符串）。"""
    if isinstance(node, dict):
        n = 1 if is_image_block(node) else 0
        for v in node.values():
            n += count_images(v)
        return n
    if isinstance(node, list):
        return sum(count_images(it) for it in node)
    return 0


def encode_project_dir(path: str) -> str:
    """复现 Claude Code 的项目路径编码：非字母数字字符 -> ``-``。

    例：``E:\\PyCode\\iwencai`` -> ``E--PyCode-iwencai``
        ``/home/user/proj``   -> ``-home-user-proj``
    """
    return re.sub(r"[^a-zA-Z0-9]", "-", str(path))


def find_projects_dir() -> Path:
    return Path.home() / ".claude" / "projects"


# ---------------- 文件级处理 ----------------

@dataclass
class SessionInfo:
    path: Path
    mtime: float
    size: int
    img_count: int  # 近似（字符串扫描），仅用于列表筛选
    lines: int


@dataclass
class Report:
    path: str
    removed: int
    touched_rows: list = field(default_factory=list)
    backup: str | None = None
    rows: int = 0
    errors: list = field(default_factory=list)


def list_sessions(project_dir: Path) -> list[SessionInfo]:
    files = sorted(project_dir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    out = []
    for p in files:
        try:
            st = p.stat()
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        out.append(SessionInfo(p, st.st_mtime, st.st_size,
                               len(IMG_PATTERN.findall(text)), text.count("\n") + 1))
    return out


def process_file(path, dry_run: bool = False) -> Report:
    """清理单个会话文件：备份（非 dry-run 且有图片时）-> 递归替换 image block -> 写回。

    - 坏 JSON 行原样保留并记入 errors
    - 行数保持不变
    - 写回用 LF 换行（JSONL 规范）
    """
    path = Path(path)
    raw = path.read_text(encoding="utf-8", errors="replace")
    lines = raw.splitlines()
    had_trailing_nl = raw.endswith("\n")
    new_lines, total, touched, errors = [], 0, [], []
    for i, ln in enumerate(lines):
        if not ln.strip():
            new_lines.append(ln)
            continue
        try:
            obj = json.loads(ln)
        except json.JSONDecodeError as e:
            errors.append((i, str(e)))
            new_lines.append(ln)  # 坏行原样保留，不破坏文件
            continue
        new_obj, r = strip_images(obj)
        if r:
            touched.append(i)
            total += r
            new_lines.append(json.dumps(new_obj, ensure_ascii=False, separators=(",", ":")))
        else:
            new_lines.append(ln)
    backup = None
    if total > 0 and not dry_run:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        bak = path.with_name(f"{path.name}.backup-{ts}")
        path.rename(bak)
        backup = str(bak)
        content = "\n".join(new_lines)
        if had_trailing_nl:
            content += "\n"
        path.write_text(content, encoding="utf-8", newline="\n")
    return Report(str(path), total, touched, backup, len(lines), errors)


# ---------------- 展示与命令 ----------------

def fmt_size(n: int) -> str:
    if n < 1024:
        return f"{n}B"
    if n < 1024 * 1024:
        return f"{n / 1024:.0f}K"
    return f"{n / 1024 / 1024:.1f}M"


def fmt_time(t: float) -> str:
    return datetime.fromtimestamp(t).strftime("%Y-%m-%d %H:%M")


def disp_width(s: str) -> int:
    """字符串显示宽度：CJK 全角字符算 2，其余算 1。

    Python 格式化按字符数而非显示宽度对齐，含中文的列会错位，需自行按显示宽度补空格。
    """
    return sum(2 if unicodedata.east_asian_width(c) in ("W", "F") else 1 for c in s)


def align_left(s: str, width: int) -> str:
    """按显示宽度左对齐（右侧补空格）。"""
    return s + " " * max(0, width - disp_width(s))


def align_right(s: str, width: int) -> str:
    """按显示宽度右对齐（左侧补空格）。"""
    return " " * max(0, width - disp_width(s)) + s


def print_sessions(sessions: list[SessionInfo]):
    if not sessions:
        print("（无会话文件）")
        return
    print(f"{align_right('#', 2)}  {align_left('修改时间', 16)}  "
          f"{align_right('大小', 7)}  {align_right('图片', 4)}  "
          f"{align_right('行数', 6)}  会话ID")
    print("-" * 80)
    for i, s in enumerate(sessions):
        flag = str(s.img_count) if s.img_count else "-"
        print(f"{align_right(str(i), 2)}  {align_left(fmt_time(s.mtime), 16)}  "
              f"{align_right(fmt_size(s.size), 7)}  {align_right(flag, 4)}  "
              f"{align_right(str(s.lines), 6)}  {s.path.stem}")
    imgs = [s for s in sessions if s.img_count > 0]
    print("-" * 80)
    print(f"共 {len(sessions)} 个会话，其中 {len(imgs)} 个含图片")


def resolve_project_dir(args) -> Path:
    base = find_projects_dir()
    if args.all_projects:
        return base
    if args.project:
        p = Path(args.project)
        if p.is_absolute() and p.is_dir():  # 任意已存在的目录
            return p
        return base / encode_project_dir(args.project)  # 编码名或原始项目路径统一 encode
    return base / encode_project_dir(str(Path.cwd()))


def find_session_by_prefix(sessions: list[SessionInfo], prefix: str) -> SessionInfo:
    matches = [s for s in sessions if s.path.stem.startswith(prefix)]
    if not matches:
        raise SystemExit(f"未找到匹配 '{prefix}' 的会话")
    if len(matches) > 1:
        ids = "\n".join(s.path.stem for s in matches)
        raise SystemExit(f"'{prefix}' 匹配多个会话，请用更完整的前缀：\n{ids}")
    return matches[0]


def cmd_clean_one(path: Path, dry_run: bool):
    print(f"\n处理: {path.name}")
    rep = process_file(path, dry_run=dry_run)
    if rep.errors:
        print(f"  ⚠ {len(rep.errors)} 行 JSON 解析失败（原样保留）: 行 {[e[0] for e in rep.errors]}")
    if rep.removed == 0:
        print("  无图片，未改动")
        return
    print(f"  清理图片块: {rep.removed}  涉及行: {rep.touched_rows}  总行数: {rep.rows}")
    if dry_run:
        print("  [dry-run] 未写文件")
    else:
        print(f"  备份: {Path(rep.backup).name}")
        print("  ✓ 已写入")


def cmd_list(args):
    pdir = resolve_project_dir(args)
    if args.all_projects:
        sessions = []
        for sub in sorted(pdir.iterdir()):
            if sub.is_dir():
                sessions += list_sessions(sub)
        sessions.sort(key=lambda s: s.mtime, reverse=True)
    else:
        sessions = list_sessions(pdir)
    print_sessions(sessions)


def cmd_session(args):
    pdir = resolve_project_dir(args)
    sessions = list_sessions(pdir)
    target = find_session_by_prefix(sessions, args.session)
    cmd_clean_one(target.path, args.dry_run)


def cmd_all_images(args):
    pdir = resolve_project_dir(args)
    if args.all_projects:
        targets = [s for sub in sorted(pdir.iterdir()) if sub.is_dir()
                   for s in list_sessions(sub) if s.img_count > 0]
    else:
        targets = [s for s in list_sessions(pdir) if s.img_count > 0]
    if not targets:
        print("没有含图片的会话")
        return
    print(f"将清理 {len(targets)} 个含图片会话{'（dry-run）' if args.dry_run else ''}:")
    for s in targets:
        print(f"  {fmt_time(s.mtime)}  {s.path.parent.name}/{s.path.stem}  图片≈{s.img_count}")
    for s in targets:
        cmd_clean_one(s.path, args.dry_run)


def cmd_interactive(args):
    pdir = resolve_project_dir(args)
    sessions = list_sessions(pdir)
    print_sessions(sessions)
    if not any(s.img_count > 0 for s in sessions):
        print("\n当前项目无含图片会话，无需清理。")
        return
    try:
        choice = input("\n输入 # 序号（左侧数字）清理对应会话，回车跳过: ").strip()
    except (EOFError, KeyboardInterrupt):
        print("\n非交互模式，退出。用 --session <id> 或 --all-images 清理。")
        return
    if not choice:
        return
    try:
        idx = int(choice)
    except ValueError:
        print("请输入数字序号，或用 --session <id>。")
        return
    if not (0 <= idx < len(sessions)):
        print(f"序号超出范围 0..{len(sessions) - 1}")
        return
    target = sessions[idx]
    if target.img_count == 0:
        print(f"会话 {target.path.stem} 不含图片。")
        return
    cmd_clean_one(target.path, args.dry_run)


def main():
    ap = argparse.ArgumentParser(
        description="清除 Claude Code 会话历史中的图片（让不支持图片的模型能 resume）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""示例:
  %(prog)s                        交互：列出当前项目会话，选序号清理
  %(prog)s --list                 仅列出当前项目会话（标记图片数）
  %(prog)s --session abc123def    清理指定会话（id 前缀）
  %(prog)s --all-images           清理所有含图片会话
  %(prog)s --dry-run --all-images  预览，不写文件
  %(prog)s --project E:\\PyCode\\iwencai --list
  %(prog)s --all-projects --list   跨所有项目列出
""",
    )
    ap.add_argument("--list", action="store_true", help="仅列出会话，不清理")
    ap.add_argument("--session", metavar="ID", help="清理指定会话（session id 或唯一前缀）")
    ap.add_argument("--all-images", action="store_true", help="清理所有含图片的会话")
    ap.add_argument("--dry-run", action="store_true", help="预览：显示将清理什么，不写文件")
    ap.add_argument("--project", metavar="PATH", help="指定项目（路径或编码名），默认当前目录")
    ap.add_argument("--all-projects", action="store_true", help="跨 ~/.claude/projects 下所有项目")
    args = ap.parse_args()

    if args.session:
        cmd_session(args)
    elif args.all_images:
        cmd_all_images(args)
    elif args.list:
        cmd_list(args)
    else:
        cmd_interactive(args)


if __name__ == "__main__":
    main()
