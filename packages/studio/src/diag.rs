// diag.rs —— 「问题面板」的类型诊断（决策 #1409）
//
// 【安全边界（与 git.rs 同源）】
//   · **只跑一条固定命令**：`node_modules/.bin/vue-tsc -p packages/studio/ui/tsconfig.diag.json --noEmit`。
//     参数全部写死、**不接受前端传入任何命令或参数** —— 否则等于在 Studio 里开了一个任意命令执行口子。
//   · **不提供 --fix / 不写源码**；唯一副作用是 `--incremental` 的 tsbuildinfo（落在 node_modules/.cache）。
//   · 想加 eslint 也是同理：新加一个**固定参数**的函数，不要让前端决定跑什么。
//
// 【为什么要限范围】根 `tsconfig.json` 覆盖 6+ 个包，全量 `vue-tsc` 要几十秒到几分钟；
//   这里用 `packages/studio/ui/tsconfig.diag.json`（只收 Studio UI + incremental），实测冷启 17s / 增量 12s。
//
// 【超时】用 `recv_timeout` 收结果（有界等待，不是盲轮询）：60s 没回就 kill 子进程并如实报错，
//   让界面显示「诊断超时」，而不是永远转圈。
use serde::Serialize;
use std::io::Read;
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
    /// TS 错误码（如 TS2339）
    pub code: String,
    pub message: String,
}

const TSC_BIN: &str = "node_modules/.bin/vue-tsc";
const TSC_CONFIG: &str = "packages/studio/ui/tsconfig.diag.json";
const TIMEOUT: Duration = Duration::from_secs(60);

/// 解析一行 tsc 输出：`路径(行,列): error TS2339: 消息`
fn parse_line(raw: &str) -> Option<Diag> {
    let s = raw.trim_end();
    let open = s.find('(')?;
    let close = s[open..].find(')')? + open;
    let (path, rest) = (&s[..open], &s[close + 1..]);
    let nums = &s[open + 1..close];
    let mut it = nums.split(',');
    let line: u32 = it.next()?.trim().parse().ok()?;
    let col: u32 = it.next()?.trim().parse().ok()?;
    /* rest = `: error TS2339: Property 'x' ...` */
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
    Some(Diag { path: path.to_string(), line, col, code, message })
}

/// 真正跑诊断（阻塞）。抽出成普通函数，便于在 spawn_blocking 里调用。
fn run_blocking() -> Result<Vec<Diag>, String> {
    let root = crate::fs_guard::repo_root().map_err(|e| format!("找不到仓库根：{e}"))?;
    let bin = root.join(TSC_BIN);
    if !bin.exists() {
        return Err(format!("没装 vue-tsc（找不到 {TSC_BIN}）"));
    }
    let mut child = Command::new(&bin)
        .args(["-p", TSC_CONFIG, "--noEmit"])
        .current_dir(&root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 vue-tsc 失败：{e}"))?;

    /* ★**两个流都要读**：`tsc` 的诊断默认打在 **stdout**（不是 stderr），
       只读 stderr 会永远拿到空列表 —— 这类"看起来在跑、其实没数据"的坑最费时间。
       两个线程各读一个流，用同一个 channel 收，避免"读 stdout 时 stderr 写满"导致死锁。 */
    let mut out_s = child.stdout.take().ok_or("拿不到子进程 stdout")?;
    let mut err_s = child.stderr.take().ok_or("拿不到子进程 stderr")?;
    let (tx, rx) = mpsc::channel::<String>();
    let tx2 = tx.clone();
    std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = out_s.read_to_string(&mut buf);
        let _ = tx.send(buf);
    });
    std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = err_s.read_to_string(&mut buf);
        let _ = tx2.send(buf);
    });

    /* 收两份输出（每份一次 recv_timeout，总上限仍是 TIMEOUT） */
    let mut out = String::new();
    for _ in 0..2 {
        match rx.recv_timeout(TIMEOUT) {
            Ok(part) => out.push_str(&part),
            Err(_) => {
                let _ = child.kill();
                return Err(format!(
                    "诊断超时（>{}s）—— 仓库较大时首次会慢，请再试一次（增量会快很多）",
                    TIMEOUT.as_secs()
                ));
            }
        }
    }
    {
            let _ = child.wait();
            let mut list: Vec<Diag> = out.lines().filter_map(parse_line).collect();
            /* 同一条错误在 tsc 里可能重复（多文件引用同一声明），去重后按文件/行排序更可读 */
            list.sort_by(|a, b| (a.path.as_str(), a.line, a.col).cmp(&(b.path.as_str(), b.line, b.col)));
            list.dedup_by(|a, b| a.path == b.path && a.line == b.line && a.col == b.col && a.code == b.code);
            Ok(list)
    }
}

/// 前端入口：跑一次 Studio UI 的类型诊断。
#[tauri::command]
pub async fn diag_tsc() -> Result<Vec<Diag>, String> {
    tauri::async_runtime::spawn_blocking(run_blocking)
        .await
        .map_err(|e| format!("诊断线程异常：{e}"))?
}
