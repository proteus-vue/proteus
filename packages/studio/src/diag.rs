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
// 【★★为什么类型诊断改成"常驻 watch"（决策 #1418）】
//   每次 spawn 一个 vue-tsc 要 **3–12s**（冷启动 + 全量解析），这就是"改完很久不报错"的根源；
//   而 `--watch` 模式下**增量重编译只要 <1s**（实测：文件写入 16:31:27 → 出结果 16:31:28）。
//   所以：**进程起一次、常驻**，每次磁盘变化把整批诊断通过 `diag:update` 事件推给前端。
//   · 代价：watch 看的是**磁盘文件**，所以"未保存的修改"不会报（保存即 <1s 出结果）；
//     真·实时（含未保存）需要内存语言服务（tsserver 协议），属后续独立工程。
//   · 生命周期：`diag_watch_start` 幂等；进程随 Studio 退出被系统回收（stdout 关闭 → 循环结束）。
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

/* ── 常驻 watch（决策 #1418）─────────────────────────────────────────────── */

use std::io::{BufRead, BufReader};
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

static WATCH: OnceLock<Mutex<Option<std::process::Child>>> = OnceLock::new();

/// 解析 watch 模式的一行诊断：`路径:行:列 - error TS2339: 消息`
/// ★注意与一次性输出的格式**不同**（那次是 `路径(行,列): error TS...`），
///   两者不能共用解析器 —— 混用会得到空列表（看起来"没错误"）。
fn parse_watch_line(raw: &str) -> Option<Diag> {
    let s = raw.trim();
    let (loc, rest) = s.split_once(" - ")?;
    let (sev_code, message) = rest.split_once(": ")?;
    let (sev, code) = sev_code.split_once(' ')?;
    if sev != "error" && sev != "warning" {
        return None;
    }
    /* 从右往左拆 `路径:行:列`（路径里可能有 ':' 或 Windows 盘符） */
    let mut it = loc.rsplitn(3, ':');
    let col: u32 = it.next()?.trim().parse().ok()?;
    let line: u32 = it.next()?.trim().parse().ok()?;
    let path = it.next()?.to_string();
    Some(Diag {
        path,
        line,
        col,
        code: code.to_string(),
        message: message.trim().to_string(),
        severity: if sev == "warning" { "warning".into() } else { "error".into() },
        source: "tsc".into(),
    })
}

/// 启动（或确认已启动）常驻 watch。幂等：已在跑直接返回。
#[tauri::command]
pub fn diag_watch_start(app: tauri::AppHandle) -> Result<(), String> {
    let cell = WATCH.get_or_init(|| Mutex::new(None));
    let mut guard = cell.lock().map_err(|e| format!("锁失败：{e}"))?;

    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(None) => return Ok(()), // 还活着
            _ => {
                let _ = child.kill();
                *guard = None;
            }
        }
    }

    let root = crate::fs_guard::repo_root().map_err(|e| format!("找不到仓库根：{e}"))?;
    let bin = root.join(TSC_BIN);
    if !bin.exists() {
        return Err(format!("命令不存在：{TSC_BIN}（依赖没装？）"));
    }
    let mut child = Command::new(&bin)
        .args(["-p", TSC_CONFIG, "--noEmit", "--watch", "--preserveWatchOutput"])
        .current_dir(&root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 watch 失败：{e}"))?;

    /* stderr 也要读掉（不读会写满管道把子进程卡死），内容丢弃即可 */
    if let Some(mut err) = child.stderr.take() {
        std::thread::spawn(move || {
            let mut sink = String::new();
            let _ = err.read_to_string(&mut sink);
        });
    }
    let out = child.stdout.take().ok_or("拿不到 watch stdout")?;
    *guard = Some(child);

    /* 解析线程：把每一批"编译结束"的诊断作为**全量**推给前端。
       ★推送全量而不是增量：前端只保留 tsc 来源的部分替换，逻辑简单且不会漂移。 */
    std::thread::spawn(move || {
        let reader = BufReader::new(out);
        let mut batch: Vec<Diag> = Vec::new();
        for line in reader.lines().map_while(Result::ok) {
            if line.contains("File change detected") || line.contains("Starting compilation") {
                batch.clear();
                continue;
            }
            if let Some(d) = parse_watch_line(&line) {
                batch.push(d);
                continue;
            }
            /* 一次编译的收尾行：`Found N error(s). Watching for file changes.` */
            if line.trim_start().starts_with("Found ") && line.contains("Watching for file changes")
            {
                let mut list = batch.clone();
                sort_dedup(&mut list);
                let _ = app.emit("diag:update", &list);
            }
        }
    });
    Ok(())
}

/// 停掉 watch（窗口关闭 / 退出时调用；失败不致命）。
#[tauri::command]
pub fn diag_watch_stop() {
    if let Some(cell) = WATCH.get() {
        if let Ok(mut guard) = cell.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

/* ── 内存语言服务（Volar）· 决策 #1419 ─────────────────────────────────────
 * 与 watch 的分工：
 *   · watch（磁盘）：**全仓**诊断，保存后 <1s —— 给「问题」面板全貌；
 *   · LSP（内存）：**当前打开文件**，编辑即诊断（不保存）—— 给编辑器的波浪线。
 * 两套结果在前端合并：同一个文件以 LSP 为准（更新更及时）。
 *
 * 边界：只起一个固定脚本 `packages/studio/diag-lsp.mjs`（参数只有仓库根），
 *   脚本内部再起 volar 的 `vue-language-server --stdio`；不接受前端传命令。
 */
struct Lsp {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
}

static LSP: OnceLock<Mutex<Option<Lsp>>> = OnceLock::new();

/// 单文件诊断事件（只带这一个文件的完整列表 ⇒ 前端按 path 整体替换）
#[derive(Serialize, Clone)]
pub struct FileDiag {
    pub path: String,
    pub items: Vec<Diag>,
}

#[tauri::command]
pub fn diag_lsp_start(app: tauri::AppHandle) -> Result<(), String> {
    let cell = LSP.get_or_init(|| Mutex::new(None));
    let mut guard = cell.lock().map_err(|e| format!("锁失败：{e}"))?;
    if let Some(l) = guard.as_mut() {
        match l.child.try_wait() {
            Ok(None) => return Ok(()),
            _ => {
                *guard = None;
            }
        }
    }

    let root = crate::fs_guard::repo_root().map_err(|e| format!("找不到仓库根：{e}"))?;
    let script = root.join("packages/studio/diag-lsp.mjs");
    if !script.exists() {
        return Err(format!("缺少语言服务脚本：{}", script.display()));
    }
    /* 用系统 node（脚本是 ESM），不走 npx：避免多一层进程与解析开销 */
    let node = std::env::var("PROTEUS_NODE").unwrap_or_else(|_| "node".to_string());
    let mut child = Command::new(node)
        .arg(&script)
        .arg(&root)
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动语言服务失败：{e}"))?;

    if let Some(mut err) = child.stderr.take() {
        std::thread::spawn(move || {
            let mut s = String::new();
            let _ = err.read_to_string(&mut s);
        });
    }
    let stdin = child.stdin.take().ok_or("拿不到语言服务 stdin")?;
    let out = child.stdout.take().ok_or("拿不到语言服务 stdout")?;
    *guard = Some(Lsp { child, stdin });

    std::thread::spawn(move || {
        let reader = BufReader::new(out);
        for line in reader.lines().map_while(Result::ok) {
            let v: serde_json::Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            match v.get("t").and_then(|x| x.as_str()) {
                Some("diag") => {
                    let path = v.get("path").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    let mut items: Vec<Diag> = Vec::new();
                    if let Some(arr) = v.get("items").and_then(|x| x.as_array()) {
                        for it in arr {
                            items.push(Diag {
                                path: path.clone(),
                                line: it.get("line").and_then(|x| x.as_u64()).unwrap_or(1) as u32,
                                col: it.get("col").and_then(|x| x.as_u64()).unwrap_or(1) as u32,
                                code: it.get("code").and_then(|x| x.as_str()).unwrap_or("vue").to_string(),
                                message: it.get("message").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                                severity: it
                                    .get("severity")
                                    .and_then(|x| x.as_str())
                                    .unwrap_or("error")
                                    .to_string(),
                                source: "volar".into(),
                            });
                        }
                    }
                    sort_dedup(&mut items);
                    let _ = app.emit("diag:update-file", FileDiag { path, items });
                }
                Some("log") => {
                    let msg = v.get("message").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    let _ = app.emit("diag:log", msg);
                }
                Some("ready") => {
                    let _ = app.emit("diag:ready", ());
                }
                Some("completions") => {
                    /* 拉式请求的回包：按 id 交给在等的那次调用 */
                    if let Some(id) = v.get("id").and_then(|x| x.as_u64()) {
                        if let Some(map) = PENDING.get() {
                            let sender = map.lock().ok().and_then(|mut g| g.remove(&id));
                            if let Some(tx) = sender {
                                let _ = tx.send(v.clone());
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    });
    Ok(())
}

/// 把编辑器里的**内存文本**推给语言服务（kind = open | change | close）。
#[tauri::command]
pub fn diag_lsp_sync(kind: String, path: String, text: Option<String>) -> Result<(), String> {
    let cell = LSP.get_or_init(|| Mutex::new(None));
    let mut guard = cell.lock().map_err(|e| format!("锁失败：{e}"))?;
    let lsp = guard.as_mut().ok_or("语言服务未启动")?;
    let payload = serde_json::json!({
        "t": kind,
        "path": path,
        "text": text.unwrap_or_default(),
    });
    let line = format!("{}\n", payload);
    use std::io::Write;
    lsp.stdin
        .write_all(line.as_bytes())
        .and_then(|_| lsp.stdin.flush())
        .map_err(|e| format!("写入语言服务失败：{e}"))
}

#[tauri::command]
pub fn diag_lsp_stop() {
    if let Some(cell) = LSP.get() {
        if let Ok(mut guard) = cell.lock() {
            if let Some(mut l) = guard.take() {
                use std::io::Write;
                let _ = l.stdin.write_all(b"{\"t\":\"shutdown\"}\n");
                let _ = l.stdin.flush();
                let _ = l.child.kill();
                let _ = l.child.wait();
            }
        }
    }
}

/* ── 自动补全（决策 #1428）────────────────────────────────────────────────
 * 与诊断的区别：诊断是"推"（服务端主动发），补全是"拉"（要等这一次的结果）。
 * 所以这里用 **id + 一次性 channel**：命令写 stdin 后 `recv_timeout` 等对应 id 的回包，
 * 超时返回空列表（补全失败不该在编辑器里弹错误，静默降级为"没有候选"）。
 */
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Serialize, Clone)]
pub struct CompletionItem {
    pub label: String,
    /// tsserver 的 kind：function / variable / property / keyword / interface…
    pub kind: String,
    pub detail: String,
    pub insert: String,
}

static PENDING: OnceLock<Mutex<HashMap<u64, std::sync::mpsc::Sender<serde_json::Value>>>> =
    OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[tauri::command]
pub fn diag_complete(
    path: String,
    text: String,
    line: u32,
    col: u32,
) -> Result<Vec<CompletionItem>, String> {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = std::sync::mpsc::channel();
    {
        let map = PENDING.get_or_init(|| Mutex::new(HashMap::new()));
        let mut guard = map.lock().map_err(|e| format!("锁失败：{e}"))?;
        guard.insert(id, tx);
    }

    /* 写请求：与诊断共用同一个 stdin，靠 mutex 串行化（不会交错半行） */
    let write_err = {
        let cell = LSP.get_or_init(|| Mutex::new(None));
        let mut guard = cell.lock().map_err(|e| format!("锁失败：{e}"))?;
        match guard.as_mut() {
            None => Some("语言服务未启动".to_string()),
            Some(lsp) => {
                let payload = serde_json::json!({
                    "t": "complete", "id": id, "path": path, "text": text, "line": line, "col": col
                });
                use std::io::Write;
                lsp.stdin
                    .write_all(format!("{}\n", payload).as_bytes())
                    .and_then(|_| lsp.stdin.flush())
                    .err()
                    .map(|e| format!("写入语言服务失败：{e}"))
            }
        }
    };
    if let Some(e) = write_err {
        if let Some(map) = PENDING.get() {
            if let Ok(mut g) = map.lock() {
                g.remove(&id);
            }
        }
        return Err(e);
    }

    /* 2.5s 足够（实测 tsserver 首次补全是毫秒级，冷启动时可能要等一次项目加载） */
    match rx.recv_timeout(Duration::from_millis(2500)) {
        Ok(v) => {
            let mut out = Vec::new();
            if let Some(arr) = v.get("items").and_then(|x| x.as_array()) {
                for it in arr {
                    out.push(CompletionItem {
                        label: it.get("label").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                        kind: it.get("kind").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                        detail: it.get("detail").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                        insert: it
                            .get("insert")
                            .and_then(|x| x.as_str())
                            .unwrap_or_else(|| it.get("label").and_then(|x| x.as_str()).unwrap_or(""))
                            .to_string(),
                    });
                }
            }
            Ok(out)
        }
        Err(_) => {
            if let Some(map) = PENDING.get() {
                if let Ok(mut g) = map.lock() {
                    g.remove(&id);
                }
            }
            Ok(Vec::new())
        }
    }
}
