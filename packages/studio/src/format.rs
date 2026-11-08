// format.rs —— 编辑器「格式化文档」（决策 #1462；GUI PATH 修复见 #1463）
//
// 【★★决策 #1463：GUI 应用不继承终端 PATH】
//   首版直接 `Command::new("node_modules/.bin/prettier")`。那个文件是 **sh wrapper**，
//   第 16 行 `exec node ...` —— macOS 从 Dock/Finder 启动时 launchd 只给
//   `/usr/bin:/bin:/usr/sbin:/sbin`，里面没有 node ⇒ 真机报
//   `prettier: line 16: exec: node: not found`。
//   ★判据当时是绿的，因为 UI 判据在 Node 侧跑、cargo test 在终端跑，**两边都有 node**。
//   这正是「判据通过 ≠ 功能可用」：注入/执行的东西在真实运行时根本不存在。
//   修法：不依赖 PATH —— 用 `ios_stream::child_path()`（决策 #1277 已解决过同类
//   `pnpm: command not found`）解析出 **node 绝对路径**，直接执行 prettier 的
//   JS 入口 `node_modules/prettier/bin-prettier.js`，绕开 sh wrapper。
//
// 【为什么是 Rust 侧固定命令、而不是前端 import prettier】
//   ① studio/ui 刻意不是 npm 包（决策 #1187），前端 import 一个只能靠 pnpm hoist 才存在的
//      **传递依赖**（prettier 2.8.8 来自 @changesets）非常脆弱；Rust 侧固定路径调用，
//      找不到就明确报错，不会静默变成"点了没反应"。
//   ② 与 `diag.rs` 的两条固定命令同源：仓库内工具一律由 Rust 起进程，参数写死。
//   ③ 前端只拿到「格式化后的文本」，`dispatch` 进 CodeMirror buffer ⇒ **不写盘**。
//      写盘仍然只有 `write_text`（mtime 冲突检测 + 原子替换），用户按 ⌘S 才落盘。
//
// 【★★安全边界（与 diag.rs 同源，勿放宽）】
//   · 命令与参数**全部写死**，前端只传 (path, text)；不接受任何命令行片段；
//   · `--stdin-filepath` 只是给 prettier **推断 parser** 的字符串，不读该文件；
//     仍校验相对路径 / 无 `..` / 无控制字符，避免与仓库沙箱出现两套路径语义；
//   · stdin 进、stdout 出，全程不碰磁盘；文本 ≤512KB（与 `read_text` 一致）；15s 超时；
//   · 非零退出时把 stderr 首行回给前端（"No parser could be inferred" 这类要说人话）。
//
// 【★风格参数为什么写死在这里】本仓源码是「单引号 / 无分号 / 100 列 / 尾逗号」，
//   prettier 默认（双引号 + 分号 + 80 列）会把整个文件改造成另一种风格。
//   `FORMAT_ARGS` 是**唯一真源**：UI 判据在 Node 侧静态读取本常量后真跑同一个 CLI，
//   保证判据回包不是手写的假文本（判据纪律：注入的东西必须说明真实运行时由谁产生）。
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, OnceLock};
use std::time::Duration;

/// prettier 的 **JS 入口**（不是 `.bin/prettier` 那个依赖 PATH 的 sh wrapper）。
/// 判据侧从本常量读取后真跑同一个入口 ⇒ 真实运行时与判据同源。
pub const PRETTIER_JS: &str = "node_modules/prettier/bin-prettier.js";
pub const FORMAT_ARGS: [&str; 6] = [
    "--single-quote",
    "--no-semi",
    "--print-width",
    "100",
    "--trailing-comma",
    "all",
];
/// `fs_guard::LIST_EXT` 里 prettier **没有 parser** 的那几个；提前拒绝，省一次 spawn 且错误可懂。
const NO_PARSER_EXT: [&str; 4] = ["rs", "m", "h", "py"];
const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_BYTES: usize = 512 * 1024;

fn check_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.contains("..")
        || path.contains('\\')
        || path.chars().any(|c| c.is_control())
    {
        return Err(format!("非法路径：{path}"));
    }
    let ext = std::path::Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if NO_PARSER_EXT.contains(&ext.as_str()) {
        return Err(format!("暂不支持 .{ext} 格式化（prettier 没有对应 parser）"));
    }
    Ok(())
}

/// stderr 只取第一行：prettier 的语法错误会连源码片段一起打，整段塞进 toast 没意义。
fn first_line(s: &str) -> String {
    let v = s.lines().find(|l| !l.trim().is_empty()).unwrap_or("格式化器没有给出原因").trim();
    let mut out: String = v.chars().take(180).collect();
    if v.chars().count() > 180 {
        out.push('…');
    }
    out
}

/// 解析 **node 绝对路径**，不受当前进程 PATH 影响（决策 #1463）。
/// `child_path()` 先问登录 shell、再补常见安装位（决策 #1277 同源）；成功才缓存，
/// 失败不缓存 —— 用户后来把 node 配进 PATH 时不必重启 Studio。
fn node_for_prettier() -> Result<PathBuf, String> {
    static CACHED: OnceLock<PathBuf> = OnceLock::new();
    if let Some(p) = CACHED.get() {
        return Ok(p.clone());
    }
    let found = crate::ios_stream::which("node", &crate::ios_stream::child_path())
        .map(PathBuf::from)
        .filter(|p| p.is_file());
    match found {
        Some(p) => {
            let _ = CACHED.set(p.clone());
            Ok(p)
        }
        None => Err(
            "找不到 node（GUI 启动未继承终端 PATH）。请把 node 目录写进 ~/.zprofile 的 PATH，或从终端启动 Studio"
                .to_string(),
        ),
    }
}

/// 构造固定命令：`node(绝对路径) + prettier 的 JS 入口 + 固定风格参数`。
/// 抽成函数是为了让单测能在**最小 PATH 的子进程**里真跑同一条命令（#1463）。
fn format_command(root: &Path, path: &str) -> Result<Command, String> {
    check_path(path)?;
    let js = root.join(PRETTIER_JS);
    if !js.exists() {
        return Err(format!("格式化器不存在：{PRETTIER_JS}（依赖没装？）"));
    }
    let node = node_for_prettier()?;
    let mut c = Command::new(node);
    c.arg(js)
        .args(FORMAT_ARGS)
        .arg("--stdin-filepath")
        .arg(path)
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    Ok(c)
}

fn format_via_cli(path: &str, text: &str) -> Result<String, String> {
    check_path(path)?;
    if text.len() > MAX_BYTES {
        return Err(format!("内容过大：{} 字节（上限 512KB）", text.len()));
    }
    if text.trim().is_empty() {
        return Ok(text.to_string());
    }
    let root = crate::fs_guard::repo_root()?;
    let mut child = format_command(&root, path)?
        .spawn()
        .map_err(|e| format!("启动格式化器失败：{e}"))?;

    /* ★三条流必须各起一个线程：512KB 文本会撑爆管道缓冲（默认 64KB），
       若主线程先 write_all 再读 stdout，prettier 等 stdin EOF、我们等它退出 ⇒ 死锁。
       stdin 线程写完即 drop 句柄 ⇒ EOF；stdout/stderr 各自由读取线程排空。 */
    let mut sin = child.stdin.take().ok_or("拿不到 stdin")?;
    let owned = text.to_owned();
    std::thread::spawn(move || {
        let _ = sin.write_all(owned.as_bytes());
    });

    let mut sout = child.stdout.take().ok_or("拿不到 stdout")?;
    let mut serr = child.stderr.take().ok_or("拿不到 stderr")?;
    let (tx, rx) = mpsc::channel::<(bool, String)>();
    let tx_out = tx.clone();
    std::thread::spawn(move || {
        let mut b = String::new();
        let _ = sout.read_to_string(&mut b);
        let _ = tx_out.send((true, b));
    });
    std::thread::spawn(move || {
        let mut b = String::new();
        let _ = serr.read_to_string(&mut b);
        let _ = tx.send((false, b));
    });

    let mut out = String::new();
    let mut err = String::new();
    for _ in 0..2 {
        match rx.recv_timeout(TIMEOUT) {
            Ok((is_out, s)) => {
                if is_out {
                    out = s
                } else {
                    err = s
                }
            }
            Err(_) => {
                let _ = child.kill();
                return Err(format!("格式化超时（>{}s）", TIMEOUT.as_secs()));
            }
        }
    }
    let status = child.wait().map_err(|e| format!("等待格式化器失败：{e}"))?;
    if !status.success() {
        return Err(format!("格式化失败：{}", first_line(&err)));
    }
    Ok(out)
}

/// 编辑器格式化：返回格式化后的**文本**，不写盘（决策 #1462）。
/// `#[tauri::command]` 只是生成 wrapper；仍须列进 `main.rs::generate_handler!`。
#[tauri::command]
pub async fn format_text(path: String, text: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || format_via_cli(&path, &text))
        .await
        .map_err(|e| format!("格式化线程异常：{e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_guard() {
        assert!(check_path("packages/studio/ui/src/a.ts").is_ok());
        assert!(check_path("../etc/passwd").is_err());
        assert!(check_path("/etc/passwd").is_err());
        assert!(check_path("a\\b.ts").is_err());
        assert!(check_path("packages/studio/src/main.rs").is_err());
        assert!(check_path("packages/studio/native/embed_view.m").is_err());
    }

    /// ★真跑 CLI（不是桩）：本机仓库有 prettier 时，断言产物就是本仓风格。
    /// 没装就打印后跳过——不把"环境缺失"伪装成通过，也不让别的机器因此判红。
    #[test]
    fn formats_with_real_cli() {
        let root = match crate::fs_guard::repo_root() {
            Ok(r) => r,
            Err(_) => {
                eprintln!("skip: 仓库根不可达");
                return;
            }
        };
        if !root.join(PRETTIER_JS).exists() {
            eprintln!("skip: {PRETTIER_JS} 不存在");
            return;
        }
        let src = "const a = {x:1,y:2};\nfunction f(  ){return \"hi\"}\n";
        let out = format_via_cli("packages/studio/ui/src/__fmt_probe.ts", src).expect("真跑 prettier 应成功");
        assert!(out.contains("const a = { x: 1, y: 2 }"), "{out}");
        assert!(out.contains("return 'hi'"), "{out}");
        assert!(!out.contains(';'), "{out}");
        /* .rs 由 check_path 提前拒绝，不能落到 prettier 的英文报错 */
        assert!(format_via_cli("packages/studio/src/main.rs", "fn main(){}").is_err());
    }

    /// ★决策 #1463：**复现用户报错的环境**（GUI 的 PATH 里没有 node），用同一条
    /// `format_command` 真跑一次。首版在这条测试下必红 —— `.bin/prettier` 是 sh
    /// wrapper，第 16 行 `exec node` 会报 `node: not found`。
    #[test]
    fn formats_under_gui_minimal_path() {
        let root = match crate::fs_guard::repo_root() {
            Ok(r) => r,
            Err(_) => return,
        };
        if !root.join(PRETTIER_JS).exists() {
            eprintln!("skip: {PRETTIER_JS} 不存在");
            return;
        }
        let mut cmd = format_command(&root, "packages/studio/ui/src/__fmt_probe.ts")
            .expect("应能解析 node 并构造命令");
        assert!(
            Path::new(cmd.get_program()).is_absolute(),
            "必须是绝对路径 node，不能依赖 PATH：{:?}",
            cmd.get_program()
        );
        cmd.env_clear().env("PATH", "/usr/bin:/bin");
        let mut child = cmd.spawn().expect("最小 PATH 下也应能启动");
        {
            let mut sin = child.stdin.take().expect("stdin");
            sin.write_all(b"const a = {x:1,y:2};\n").expect("write");
        } // drop ⇒ EOF
        let mut out = String::new();
        child.stdout.take().expect("stdout").read_to_string(&mut out).expect("read");
        let mut err = String::new();
        child.stderr.take().expect("stderr").read_to_string(&mut err).expect("read");
        assert!(child.wait().expect("wait").success(), "最小 PATH 下格式化失败：{}", first_line(&err));
        assert!(out.contains("const a = { x: 1, y: 2 }"), "{out}");
    }
}
