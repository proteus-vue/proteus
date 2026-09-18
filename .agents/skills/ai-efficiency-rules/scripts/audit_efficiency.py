#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
audit_efficiency.py —— 执行效率规范静态审计

扫描 diff 或指定路径，检测规范中禁止的低效模式：
固定 sleep 盲等、无 timeout 的网络请求、重复 clone 同一仓库、重复装依赖、
无目标全量遍历、破坏性命令等。用于在 CI / PR 中自动报警。

用法:
  # 扫描与主干的 diff（CI 最常用）
  python3 audit_efficiency.py --diff-base origin/main
  # 扫描工作区未提交改动
  python3 audit_efficiency.py --diff
  # 扫描暂存区（pre-commit 用）
  python3 audit_efficiency.py --staged
  # 全量扫描目录
  python3 audit_efficiency.py --path .

  --format text|md|json|sarif     输出格式（默认 text）
  --output FILE                   写入文件，同时打印到 stdout
  --fail-on error|warn|none       达到该级别则退出码为 1（默认 error）
  --config FILE                   规则配置（.efficiency-audit.yaml）
  --include-docs                  同时扫描 Markdown 文档中的示例
  --quiet                         只输出汇总行

退出码: 0 无违规 / 1 存在达到 --fail-on 级别的违规 / 2 参数或环境错误

行内豁免: 在代码行末尾加 `# efficiency-audit: ignore` 或 `# efficiency-audit: ignore R001`
文件豁免: 文件首部加 `# efficiency-audit: ignore-file`
"""

import argparse
import json
import os
import re
import subprocess
import sys
from collections import defaultdict

VERSION = "1.0.0"

SEVERITY_ORDER = {"error": 3, "warn": 2, "info": 1}

# ---------------------------------------------------------------- 规则定义

# 行级规则：(id, 名称, 严重级别, 正则, 建议)
LINE_RULES = [
    dict(
        id="R001", name="固定时长盲等", sev="error",
        patterns=[
            (r"\bsleep\s+\d+", "shell"),
            (r"time\.sleep\(\s*[\d.]+\s*\)", "python"),
            (r"\bStart-Sleep\s+-Seconds\s+\d+", "powershell"),
            (r"setTimeout\(\s*[^,]*,\s*\d{3,}\s*\)", "javascript"),
        ],
        advice="改为条件探测 + 指数退避 + 总超时上限，或使用 scripts/wait_for.sh",
    ),
    dict(
        id="R002", name="网络请求缺少 timeout", sev="warn",
        patterns=[
            (r"\bcurl\b", "shell"),
            (r"\bwget\b", "shell"),
            (r"requests\.(get|post|put)\(", "python"),
            (r"\bfetch\(\s*['\"`]https?://", "javascript"),
            (r"axios\.(get|post)\(", "javascript"),
        ],
        advice="显式设置超时（curl --connect-timeout 5 --max-time 15；requests timeout=(5,15)）",
        # 命中上述 pattern 后，若不含下列任一"已有超时"标记则报警
        safe_patterns=[
            r"--max-time", r"--connect-timeout", r"(?:^|\s)-m\s*\d", r"-m\d",
            r"--timeout", r"(?:^|\s)-T\s*\d",
            r"timeout\s*=", r"timeout\s*:", r"AbortSignal", r"signal\s*:",
        ],
    ),
    dict(
        id="R003", name="git clone 拉取全量历史", sev="warn",
        patterns=[(r"\bgit\s+clone\b", "shell")],
        advice="使用 --depth 1 --filter=blob:none（+ sparse-checkout）只取需要的内容",
        safe_patterns=[r"--depth", r"--filter=blob:none", r"--single-branch"],
    ),
    dict(
        id="R004", name="无目标全量遍历", sev="warn",
        patterns=[
            (r"\bls\s+-R\b", "shell"),
            (r"\bcat\s+\*\*/\*", "shell"),
            (r"\bfind\s+[/.~]\s", "shell"),
            (r"\bgrep\s+-r\b", "shell"),
        ],
        advice="限定路径 + 文件类型 + 排除目录，例如 rg -n -e 'A' --glob '*.ts' --glob '!**/node_modules/**'",
        safe_patterns=[r"--maxdepth", r"--glob", r"--include", r"--exclude", r"-g\s"],
    ),
    dict(
        id="R005", name="读取构建产物或依赖目录", sev="warn",
        patterns=[
            (r"(?:cat|grep|rg|head|tail|sed|awk|open|read_file)\b[^\n]{0,80}"
             r"(?:node_modules|/dist/|/build/|\.venv|/vendor/|package-lock\.json|"
             r"yarn\.lock|pnpm-lock\.yaml|\.min\.js)", "any"),
        ],
        advice="跳过依赖与构建产物目录，除非任务明确指向它们",
    ),
    dict(
        id="R006", name="交互式/破坏性命令", sev="warn",
        patterns=[
            (r"\bnpm\s+init\b(?!.*(?:-y|--yes))", "shell"),
            (r"\bapt-get\s+install\b(?!.*\s-y\b)", "shell"),
            (r"\bgit\s+rebase\s+-i\b", "shell"),
            (r"\bgit\s+push\s+--force\b(?!-with-lease)", "shell"),
            (r"\bgit\s+reset\s+--hard\b", "shell"),
            (r"\brm\s+-rf\s+/(?:\s|$)", "shell"),
            (r"\bDROP\s+TABLE\b", "any"),
        ],
        advice="加非交互参数（-y / GIT_SEQUENCE_EDITOR=true），破坏性操作先 dry-run 或备份",
    ),
    dict(
        id="R007", name="CI Job 缺少 timeout-minutes", sev="info",
        patterns=[(r"^\s*(?:runs-on|uses|steps)\s*:", "yaml")],
        advice="为每个 job 设置 timeout-minutes，避免挂死后长期占用 runner",
        file_only=True,      # 需要配合文件级检查
        yaml_check="timeout-minutes",
    ),
]

# 聚合规则：跨行/跨文件统计
AGG_RULES = [
    dict(
        id="R100", name="重复拉取同一远程仓库", sev="error",
        extract=r"(?:git\s+clone|git\s+fetch)[^\n]*?(https?://[^\s'\"`)]+|git@[^\s'\"`):]+)",
        min_count=2,
        advice="一次拉取 → 本地缓存 → 复用 → 用完清理，使用 scripts/cache_fetch.sh",
    ),
    dict(
        id="R101", name="重复执行依赖安装/构建", sev="warn",
        extract=r"\b(?:npm\s+(?:ci|install)|yarn\s+install|pnpm\s+install|"
                r"pip\s+install|cargo\s+build|bundle\s+install|go\s+build)\b",
        min_count=2,
        advice="执行前先检测已完成状态（test -d node_modules），或使用 --prefer-offline / 离线缓存",
    ),
    dict(
        id="R102", name="无退出条件的轮询", sev="warn",
        extract=r"\bwhile\s+(?:true|:)\s*;?\s*do\b",
        min_count=1,
        advice="轮询必须带成功条件 + 总超时上限 + 失败分支",
        need_absent=[r"\bbreak\b", r"\bdeadline\b", r"\btimeout\b", r"SECONDS", r"\bexit\b"],
        scope="file",
    ),
]

SKIP_DIRS = {
    ".git", "node_modules", "dist", "build", ".venv", "venv", "vendor",
    "__pycache__", ".next", ".cache", "target", ".idea", ".vscode", "coverage",
}
SKIP_SUFFIX = {
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".pdf", ".zip", ".gz",
    ".tar", ".woff", ".woff2", ".ttf", ".mp4", ".mp3", ".lock", ".min.js",
    ".map", ".pyc", ".so", ".dylib", ".exe", ".bin",
}
SCAN_SUFFIX = {
    ".sh", ".bash", ".zsh", ".py", ".js", ".ts", ".jsx", ".tsx", ".mjs",
    ".yml", ".yaml", ".toml", ".json", ".ps1", ".rb", ".go", ".rs", ".java",
    ".mk", ".makefile", "Dockerfile", ".dockerfile", "Makefile",
}
DOC_SUFFIX = {".md", ".mdx", ".rst", ".txt"}

IGNORE_LINE = re.compile(r"#\s*efficiency-audit:\s*ignore(?:\s+([A-Za-z0-9,]+))?")
IGNORE_FILE = re.compile(r"efficiency-audit:\s*ignore-file")


# ---------------------------------------------------------------- 工具函数

def run_git(args):
    try:
        p = subprocess.run(["git"] + args, capture_output=True, text=True, timeout=60)
        return p.returncode, p.stdout
    except (OSError, subprocess.SubprocessError):
        return 127, ""


def normalize_url(u):
    u = u.rstrip("/'\"`)]")
    if u.endswith(".git"):
        u = u[:-4]
    return u.lower()


def parse_diff(patch_text):
    """解析 unified diff，返回 [(path, lineno, content)]，只保留新增行"""
    out, cur_file, cur_line = [], None, 0
    for raw in patch_text.splitlines():
        if raw.startswith("+++ "):
            cur_file = raw[4:].strip()
            if cur_file.startswith("b/"):
                cur_file = cur_file[2:]
            continue
        if raw.startswith("--- ") or raw.startswith("diff "):
            continue
        m = re.match(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@", raw)
        if m:
            cur_line = int(m.group(1))
            continue
        if raw.startswith("+") and not raw.startswith("+++"):
            if cur_file and cur_file != "/dev/null":
                out.append((cur_file, cur_line, raw[1:]))
            cur_line += 1
    return out


class Finding:
    __slots__ = ("rid", "name", "sev", "path", "line", "content", "advice")

    def __init__(self, rid, name, sev, path, line, content, advice):
        self.rid, self.name, self.sev = rid, name, sev
        self.path, self.line, self.content = path, line, content
        self.advice = advice

    def as_dict(self):
        return dict(rule=self.rid, name=self.name, severity=self.sev,
                    path=self.path, line=self.line,
                    content=self.content.strip()[:300], advice=self.advice)

    def loc(self):
        return f"{self.path}:{self.line}"


# ---------------------------------------------------------------- 扫描器

class Auditor:
    def __init__(self, config=None, include_docs=False):
        self.cfg = config or {}
        self.include_docs = include_docs
        self.disabled = set(self.cfg.get("disable", []) or [])
        self.sev_override = self.cfg.get("severity", {}) or {}
        self.ignore_paths = [re.compile(p) for p in (self.cfg.get("ignore_paths", []) or [])]
        self.findings = []
        self.stats = defaultdict(int)

    # ---- 规则级开关 ----
    def _enabled(self, rid):
        return rid not in self.disabled

    def _sev(self, rid, default):
        return self.sev_override.get(rid, default)

    def _ignored(self, path):
        if any(p.search(path) for p in self.ignore_paths):
            return True
        return False

    # ---- 入口 ----
    def scan_rows(self, rows):
        """rows: [(path, lineno, content)]，用于 diff / 未跟踪文件等子集扫描"""
        files = defaultdict(list)
        for path, lineno, content in rows:
            files[path].append((lineno, content))
        self._scan(files, diff_mode=True)

    def scan_paths(self, roots):
        files = defaultdict(list)
        for root in roots:
            if os.path.isfile(root):
                self._collect_file(root, files)
                continue
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
                for fn in filenames:
                    self._collect_file(os.path.join(dirpath, fn), files)
        self._scan(files, diff_mode=False)

    def _should_scan(self, path, ext, base):
        ok = ext in SCAN_SUFFIX or base in SCAN_SUFFIX
        if not ok and self.include_docs:
            ok = ext in DOC_SUFFIX
        return ok and ext not in SKIP_SUFFIX and not self._ignored(path)

    def _read_rows(self, path):
        """读取单文件为 [(relpath, lineno, content)]，返回 None 表示跳过"""
        base = os.path.basename(path)
        ext = os.path.splitext(base)[1].lower()
        if not self._should_scan(path, ext, base):
            return None
        try:
            if os.path.getsize(path) > 1024 * 1024:
                return None
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.read().splitlines()
        except OSError:
            return None
        if any(IGNORE_FILE.search(l) for l in lines[:20]):
            return None
        rel = os.path.relpath(path)
        return [(rel, i + 1, l) for i, l in enumerate(lines)]

    def _collect_file(self, path, files):
        rows = self._read_rows(path)
        if rows:
            files[rows[0][0]] = [(ln, c) for _, ln, c in rows]

    # ---- 核心 ----
    def _scan(self, files, diff_mode):
        agg_hits = defaultdict(list)   # rid -> [(path, line, key, content)]
        file_text = {}

        for path, rows in files.items():
            if self._ignored(path):
                continue
            full_text = "\n".join(c for _, c in rows)
            file_text[path] = full_text
            if IGNORE_FILE.search(full_text[:2000] if diff_mode else "\n".join(
                    c for _, c in rows[:20])):
                continue

            for lineno, content in rows:
                for rule in LINE_RULES:
                    if not self._enabled(rule["id"]):
                        continue
                    if rule.get("file_only"):
                        continue
                    if self._line_ignored(content, rule["id"]):
                        continue
                    for pat, _lang in rule["patterns"]:
                        if not re.search(pat, content):
                            continue
                        # 已有缓解措施则跳过
                        if any(re.search(s, content) for s in rule.get("safe_patterns", [])):
                            break
                        # R001 豁免：退避/重试上下文
                        if rule["id"] == "R001" and self._is_backoff(rows, lineno):
                            break
                        self.findings.append(Finding(
                            rule["id"], rule["name"], self._sev(rule["id"], rule["sev"]),
                            path, lineno, content, rule["advice"]))
                        self.stats[rule["id"]] += 1
                        break

            # 文件级规则（YAML workflow）
            for rule in LINE_RULES:
                if not rule.get("file_only") or not self._enabled(rule["id"]):
                    continue
                if not re.search(r"\.github/workflows/.*\.ya?ml$", path):
                    continue
                marker = rule.get("yaml_check")
                if marker and marker not in full_text:
                    self.findings.append(Finding(
                        rule["id"], rule["name"], self._sev(rule["id"], rule["sev"]),
                        path, 1, "（workflow 文件）", rule["advice"]))
                    self.stats[rule["id"]] += 1

            # 聚合规则取样
            for rule in AGG_RULES:
                if not self._enabled(rule["id"]):
                    continue
                for lineno, content in rows:
                    if self._line_ignored(content, rule["id"]):
                        continue
                    m = re.search(rule["extract"], content)
                    if m:
                        key = normalize_url(m.group(1)) if "http" in rule["extract"] or "git@" in rule["extract"] else m.group(0)
                        agg_hits[rule["id"]].append((path, lineno, key, content))

        # 聚合判定
        for rule in AGG_RULES:
            if not self._enabled(rule["id"]):
                continue
            hits = agg_hits[rule["id"]]
            if not hits:
                continue
            if rule.get("scope") == "file":
                grouped = defaultdict(list)
                for h in hits:
                    grouped[h[0]].append(h)
                for path, hs in grouped.items():
                    body = file_text.get(path, "")
                    if any(re.search(p, body) for p in rule.get("need_absent", [])):
                        continue
                    path, lineno, key, content = hs[0]
                    # diff 模式上下文不全，降级为 info 以免误报
                    sev = "info" if diff_mode else self._sev(rule["id"], rule["sev"])
                    self.findings.append(Finding(
                        rule["id"], rule["name"], sev,
                        path, lineno, content, rule["advice"]))
                    self.stats[rule["id"]] += 1
                continue
            by_key = defaultdict(list)
            for h in hits:
                by_key[h[2]].append(h)
            for key, hs in by_key.items():
                if len(hs) < rule["min_count"]:
                    continue
                # 首次出现不算违规，从第二次起报警
                for path, lineno, _, content in hs[1:]:
                    self.findings.append(Finding(
                        rule["id"], rule["name"], self._sev(rule["id"], rule["sev"]),
                        path, lineno,
                        f"{content.strip()[:120]}  ← 与 {hs[0][0]}:{hs[0][1]} 重复",
                        rule["advice"]))
                    self.stats[rule["id"]] += 1

        self.findings.sort(key=lambda f: (f.path, f.line, f.rid))

    @staticmethod
    def _line_ignored(content, rid):
        m = IGNORE_LINE.search(content)
        if not m:
            return False
        if rid is None:
            return True
        return not m.group(1) or rid in m.group(1).split(",")

    @staticmethod
    def _is_backoff(rows, lineno):
        """判断 sleep 是否处于退避/重试上下文（此类 sleep 有依据，不违规）"""
        lo = max(0, lineno - 4)
        window = " ".join(c for ln, c in rows if lo <= ln <= lineno + 2)
        return bool(re.search(
            r"retry|Retry-After|backoff|attempt|deadline|SECONDS|elapsed|"
            r"\bdelay\b|interval|max_?wait|timeout", window, re.I))


# ---------------------------------------------------------------- 输出

def render_text(fs, quiet=False):
    if not fs:
        return "✅ 未检测到违反执行效率规范的代码"
    lines = []
    for f in fs:
        icon = {"error": "❌", "warn": "⚠️ ", "info": "ℹ️ "}[f.sev]
        lines.append(f"{icon} {f.rid} [{f.sev.upper()}] {f.loc()} · {f.name}")
        if not quiet:
            lines.append(f"      > {f.content.strip()[:160]}")
            lines.append(f"      ↳ {f.advice}")
    return "\n".join(lines)


def render_md(fs, summary):
    if not fs:
        return "## ✅ 执行效率审计通过\n\n未检测到固定 sleep 盲等、无超时请求、重复拉取等低效模式。"
    out = ["## ⚠️ 执行效率审计结果", "",
           f"共 **{len(fs)}** 处：❌ error {summary['error']} · ⚠️ warn {summary['warn']} · ℹ️ info {summary['info']}",
           "", "| 规则 | 级别 | 位置 | 问题 |",
           "|---|---|---|---|"]
    for f in fs:
        icon = {"error": "❌", "warn": "⚠️", "info": "ℹ️"}[f.sev]
        snippet = f.content.strip().replace("|", "\\|")[:90]
        out.append(f"| `{f.rid}` | {icon} {f.sev} | `{f.loc()}` | {f.name}<br>`{snippet}`<br>↳ {f.advice} |")
    out += ["", "> 行内豁免：`# efficiency-audit: ignore R001`；文件豁免：`# efficiency-audit: ignore-file`"]
    return "\n".join(out)


def render_json(fs, summary):
    return json.dumps(
        {"tool": "audit_efficiency", "version": VERSION, "summary": summary,
         "findings": [f.as_dict() for f in fs]},
        ensure_ascii=False, indent=2)


def render_sarif(fs):
    rules = {}
    for r in LINE_RULES + AGG_RULES:
        rules[r["id"]] = {
            "id": r["id"], "name": r["name"],
            "shortDescription": {"text": r["name"]},
            "fullDescription": {"text": r.get("advice", "")},
            "help": {"text": r.get("advice", "")},
            "defaultConfiguration": {
                "level": "error" if r["sev"] == "error" else ("warning" if r["sev"] == "warn" else "note")},
        }
    results = []
    for f in fs:
        results.append({
            "ruleId": f.rid,
            "level": {"error": "error", "warn": "warning", "info": "note"}[f.sev],
            "message": {"text": f"{f.name}：{f.advice}"},
            "locations": [{
                "physicalLocation": {
                    "artifactLocation": {"uri": f.path},
                    "region": {"startLine": max(1, f.line),
                               "snippet": {"text": f.content.strip()[:200]}},
                }}],
        })
    return json.dumps({
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "version": "2.1.0",
        "runs": [{"tool": {"driver": {
            "name": "audit_efficiency", "version": VERSION,
            "informationUri": "https://example.invalid/ai-efficiency-rules",
            "rules": list(rules.values())}}, "results": results}],
    }, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------- 主流程

def load_config(path):
    if not path:
        for cand in (".efficiency-audit.yaml", ".efficiency-audit.yml"):
            if os.path.exists(cand):
                path = cand
                break
    if not path or not os.path.exists(path):
        return {}
    try:
        import yaml  # type: ignore
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except ImportError:
        print("提示：未安装 PyYAML，忽略规则配置文件", file=sys.stderr)
        return {}
    except Exception as e:  # noqa: BLE001
        print(f"提示：配置文件解析失败（{e}），按默认规则执行", file=sys.stderr)
        return {}


def main():
    ap = argparse.ArgumentParser(
        description="执行效率规范静态审计（反固定 sleep / 反重复拉取 / 反无超时请求）",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--diff", action="store_true", help="扫描工作区未提交改动")
    src.add_argument("--staged", action="store_true", help="扫描暂存区（pre-commit）")
    src.add_argument("--diff-base", metavar="REF", help="与指定 ref 比较，如 origin/main")
    src.add_argument("--diff-file", metavar="FILE", help="读取已有 patch 文件")
    src.add_argument("--path", nargs="*", metavar="PATH", help="全量扫描指定路径（默认 .）")
    ap.add_argument("--format", choices=["text", "md", "json", "sarif"], default="text")
    ap.add_argument("--output", metavar="FILE", help="同时写入文件")
    ap.add_argument("--fail-on", choices=["error", "warn", "info", "none"], default="error")
    ap.add_argument("--config", metavar="FILE", help="规则配置文件")
    ap.add_argument("--include-docs", action="store_true", help="一并扫描 Markdown 文档")
    ap.add_argument("--quiet", action="store_true", help="精简输出")
    ap.add_argument("--version", action="version", version=f"audit_efficiency {VERSION}")
    args = ap.parse_args()

    cfg = load_config(args.config)
    auditor = Auditor(cfg, include_docs=args.include_docs)

    patch = None
    explicit_diff = bool(args.diff_file or args.staged or args.diff_base or args.diff)
    if args.diff_file:
        try:
            with open(args.diff_file, "r", encoding="utf-8", errors="ignore") as f:
                patch = f.read()
        except OSError as e:
            print(f"错误：无法读取 {args.diff_file}（{e}）", file=sys.stderr)
            return 2
    elif args.staged:
        rc, patch = run_git(["diff", "--cached", "-U0", "--no-color"])
        if rc != 0:
            print("错误：git 不可用或不在仓库中", file=sys.stderr)
            return 2
    elif args.diff_base:
        run_git(["fetch", "--depth", "50", "origin"])  # 尽力而为，失败不影响
        rc, patch = run_git(["diff", "-U0", "--no-color", f"{args.diff_base}...HEAD"])
        if rc != 0:
            rc, patch = run_git(["diff", "-U0", "--no-color", args.diff_base])
        if rc != 0:
            print(f"错误：无法与 {args.diff_base} 比较", file=sys.stderr)
            return 2
    elif args.diff or args.path is None:
        rc, patch = run_git(["diff", "-U0", "--no-color"])
        if rc != 0:
            patch = None

    if patch is not None:
        rows = parse_diff(patch)
        # 未跟踪的新文件不在 git diff 中，单独纳入
        rc, untracked = run_git(["ls-files", "--others", "--exclude-standard"])
        if rc == 0 and untracked.strip():
            for up in untracked.splitlines():
                if up.strip():
                    extra = auditor._read_rows(up.strip())  # noqa: SLF001
                    if extra:
                        rows.extend(extra)
        auditor.scan_rows(rows)
    else:
        if explicit_diff:
            print("未检测到改动（diff 为空）", file=sys.stderr)
        auditor.scan_paths(args.path or ["."])

    fs = auditor.findings
    summary = {"total": len(fs),
               "error": sum(1 for f in fs if f.sev == "error"),
               "warn": sum(1 for f in fs if f.sev == "warn"),
               "info": sum(1 for f in fs if f.sev == "info")}

    if args.format == "text":
        body = render_text(fs, args.quiet)
        body += f"\n\n—— 汇总：{summary['error']} error / {summary['warn']} warn / {summary['info']} info"
    elif args.format == "md":
        body = render_md(fs, summary)
    elif args.format == "json":
        body = render_json(fs, summary)
    else:
        body = render_sarif(fs)

    print(body)
    if args.output:
        try:
            os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(body + "\n")
        except OSError as e:
            print(f"错误：无法写入 {args.output}（{e}）", file=sys.stderr)
            return 2

    if args.fail_on == "none":
        return 0
    threshold = SEVERITY_ORDER[args.fail_on]
    return 1 if any(SEVERITY_ORDER[f.sev] >= threshold for f in fs) else 0


if __name__ == "__main__":
    sys.exit(main())
