// diag.rs —— 「问题面板」的诊断（决策 #1409 引入 · #1416 加 eslint）
//
// 【安全边界（与 git.rs 同源）】
//   · 只跑**两条固定命令**，参数全部写死、**不接受前端传入任何命令或参数**：
//       1) `node_modules/.bin/vue-tsc -p packages/studio/ui/tsconfig.diag.json --noEmit`
//       2) `node_modules/.bin/eslint packages/studio/ui/src --format json`
//     否则等于在 Studio 里开了一个任意命令执行口子。
//   · **不提供 `--fix` / 不写源码**。唯一副作用是 tsc 的 tsbuildinfo（落在 node_modules/.cache）。
//   · 想再加诊断源：新加一个**固定参数**的函数 + 一个独立命令，不要让前端决定跑什么。
//
// 【为什么要限范围】根 `tsconfig.json` 覆盖 6+ 个包，全量 `vue-tsc` 几十秒到几分钟；
//   eslint 全仓同理。这里都只收 Studio UI。实测：tsc 冷启 17s / 增量 12s（增量常到 3s）；
//   eslint 约 15s（54 文件）。
//
// 【超时】`recv_timeout` 有界等待（不是盲轮询）：60s 没回就 kill 并如实报错，
//   界面显示「诊断超时」而不是永远转圈。
//
// 【★退出码不能当失败判据】tsc 有类型错误时退出码非 0、eslint 有问题时退出码 1，
//   但**输出本身就是结果**。所以这里只关心「能不能解析出内容」，不因非零退出而报错。
use serde::Serialize;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

#[derive(Serialize, Clone)]
pub struct Diag {
    /// 相对仓库根的文件路径
    pub path: String,
    /// 1-based 行号
    pub line: u32,
    /// 1-based 列号
    pub col: u32,
    /// 错误码：tsc 用 `TS2339`，eslint 用规则名（如 `@typescript-eslint/no-unused-vars`）
    pub code: String,
    pub message: String,
    /// `error` | `warning`
    pub severity: String,
    /// `tsc` | `eslint`（悬浮提示里显示来源）
    pub source: String,
}

const TSC_BIN: &str = "node_modules/.bin/vue-tsc";
const TSC_CONFIG: &str = "packages/studio/ui/tsconfig.diag.json";
const ESLINT_BIN: &str = "node_modules/.bin/eslint";
const ESLINT_TARGET: &str = "packages/studio/ui/src";
const TIMEOUT: Duration = Duration::from_secs(60);

/// 跑一条固定命令，返回 (合并后的输出, 退出码)。
/// ★同时读 stdout+stderr：tsc 的诊断打在 stdout、部分工具打在 stderr，
///   只读一个流会"看起来在跑、其实没数据"（上一版踩过）。
fn run_cmd(bin: &str, args: &[&str]) -> Result<(String, i32), String> {
    let root = crate::fs_guard::repo_root().map_err(|e| format!("找不到仓库根：{e}"))?;
    let path: PathBuf = root.join(bin);
    if !path.exists() {
        return Err(format!("命令不存在：{bin}（依赖没装？）"));
    }
    let mut child = Command::new(&path)
        .args(args)
        .current_dir(&root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 {bin} 失败：{e}"))?;

    let mut out_s = child.stdout.take().ok_or("拿不到 stdout")?;
    let mut err_s = child.stderr.take().ok_or("拿不到 stderr")?;
    let (tx, rx) = mpsc::channel::<String>();
    let tx2 = tx.clone();
    std::thread::spawn(move || {
        let mut b = String::new();
        let _ = out_s.read_to_string(&mut b);
        let _ = tx.send(b);
    });
    std::thread::spawn(move || {
        let mut b = String::new();
        let _ = err_s.read_to_string(&mut b);
        let _ = tx2.send(b);
    });

    let mut out = String::new();
    for _ in 0..2 {
        match rx.recv_timeout(TIMEOUT) {
            Ok(part) => out.push_str(&part),
            Err(_) => {
                let _ = child.kill();
                return Err(format!("诊断超时（>{}s），请再试一次", TIMEOUT.as_secs()));
            }
        }
    }
    let code = child.wait().map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
    Ok((out, code))
}

/// 解析一行 tsc 输出：`路径(行,列): error TS2339: 消息`
fn parse_tsc_line(raw: &str) -> Option<Diag> {
    let s = raw.trim_end();
    let open = s.find('(')?;
    let close = s[open..].find(')')? + open;
    let (path, rest) = (&s[..open], &s[close + 1..]);
    let nums = &s[open + 1..close];
    let mut it = nums.split(',');
    let line: u32 = it.next()?.trim().parse().ok()?;
    let col: u32 = it.next()?.trim().parse().ok()?;
    let after = rest.strip_prefix(':')?.trim_start();
    let code_at = after.find("TS")?;
    let code: String = after[code_at..].split(':').next()?.trim().to_string();
    let message = after[code_at..]
        .split_once(':')
        .map(|(_, m)| m.trim().to_string())
        .unwrap_or_default();
    if message.is_empty() {
        return None;
    }
    Some(Diag {
        path: path.to_string(),
        line,
        col,
        code,
        message,
        severity: "error".into(),
        source: "tsc".into(),
    })
}

fn run_tsc() -> Result<Vec<Diag>, String> {
    let (out, _code) = run_cmd(TSC_BIN, &["-p", TSC_CONFIG, "--noEmit"])?;
    let mut list: Vec<Diag> = out.lines().filter_map(parse_tsc_line).collect();
    sort_dedup(&mut list);
    Ok(list)
}

/* ── eslint：解析 `--format json` ─────────────────────────────────────────── */
#[derive(serde::Deserialize)]
struct EslintFile {
    #[serde(rename = "filePath")]
    file_path: String,
    #[serde(default)]
    messages: Vec<EslintMsg>,
}

#[derive(serde::Deserialize)]
struct EslintMsg {
    line: u32,
    column: u32,
    severity: u8,
    #[serde(rename = "ruleId")]
    rule_id: Option<String>,
    message: String,
}

fn run_eslint() -> Result<Vec<Diag>, String> {
    let (out, _code) = run_cmd(ESLINT_BIN, &[ESLINT_TARGET, "--format", "json"])?;
    let body = match out.find('[') {
        Some(i) => &out[i..],
        None => return Ok(Vec::new()), // 没输出 = 没问题（或未配置），不当作失败
    };
    let files: Vec<EslintFile> =
        serde_json::from_str(body).map_err(|e| format!("eslint 输出解析失败：{e}"))?;
    let root = crate::fs_guard::repo_root().map_err(|e| format!("找不到仓库根：{e}"))?;
    let mut list: Vec<Diag> = Vec::new();
    for f in files {
        /* eslint 给的是绝对路径；Studio 里的文件路径都相对仓库根，必须统一，
           否则 `diagsOf()` 永远匹配不上 ⇒ 波浪线不出现。 */
        let rel = std::path::Path::new(&f.file_path)
            .strip_prefix(&root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| {
                /* 兜底：符号链接 / 打包后 cwd 不同时前缀可能对不上，
                   按已知的扫描根截取（`--format json` 的路径一定包含它）。 */
                match f.file_path.find("packages/studio/ui/") {
                    Some(i) => f.file_path[i..].replace('\\', "/"),
                    None => f.file_path.clone(),
                }
            });
        for m in f.messages {
            list.push(Diag {
                path: rel.clone(),
                line: m.line.max(1),
                col: m.column.max(1),
                code: m.rule_id.unwrap_or_else(|| "eslint".into()),
                message: m.message,
                /* eslint: 1 = warning, 2 = error */
                severity: if m.severity >= 2 { "error".into() } else { "warning".into() },
                source: "eslint".into(),
            });
        }
    }
    sort_dedup(&mut list);
    Ok(list)
}

fn sort_dedup(list: &mut Vec<Diag>) {
    list.sort_by(|a, b| (a.path.as_str(), a.line, a.col).cmp(&(b.path.as_str(), b.line, b.col)));
    list.dedup_by(|a, b| {
        a.path == b.path && a.line == b.line && a.col == b.col && a.code == b.code
    });
}

/// 前端入口：Studio UI 的类型诊断（vue-tsc）。
#[tauri::command]
pub async fn diag_tsc() -> Result<Vec<Diag>, String> {
    tauri::async_runtime::spawn_blocking(run_tsc)
        .await
        .map_err(|e| format!("诊断线程异常：{e}"))?
}

/// 前端入口：Studio UI 的 lint 诊断（eslint，只读、不自动修）。
#[tauri::command]
pub async fn diag_eslint() -> Result<Vec<Diag>, String> {
    tauri::async_runtime::spawn_blocking(run_eslint)
        .await
        .map_err(|e| format!("lint 线程异常：{e}"))?
}
