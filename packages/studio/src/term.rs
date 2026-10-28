// term.rs —— 内置终端（pty）后端（决策 #1279）
//
// 【为什么要它】Studio 已经能投屏、能改代码、能看 Git，但**跑不了命令**。
//   用户在 IDE 里的第一条命令永远是 `git status` / `pnpm test`，没有一个真终端，其余部分都只能算"看图"。
//   本仓 README 的「没做」表里，终端一直是**下一刀候选**。
//
// 【为什么自己写 pty 而不引 crate】本仓 `packages/studio/ui` 刻意零 npm 依赖（决策 #1187），
//   Rust 侧同样保持最小：`openpty/fork/execve/ioctl` 全是 libc 里的系统调用，
//   用 `extern "C"` 声明即可（和本仓 `poc_attach` 那批原生桥同一手法），不需要 `libc`/`nix`/`portable-pty`。
//   ⇒ 少一层依赖 = 少一处"锁文件漂移 / store 不一致"的故障面（本仓已被 pnpm store 坑过多次）。
//
// 【为什么是 openpty + fork，而不是 forkpty】forkpty 在 `libutil` 里，且内部仍要 fork。
//   这里显式走 openpty 是为了**把 fork 之后的动作压到最少**：Tauri 是多线程进程，
//   fork 出来的子进程只能调 async-signal-safe 的系统调用（不能 malloc，否则可能死锁在 malloc 锁上）。
//   ⇒ 所有 `CString`（shell 路径 / argv / envp）**都在 fork 之前**造好，子进程里只做
//     close/setsid/ioctl/dup2/execve/_exit —— 一次分配都没有。
//
// 【两条纪律】
//   ① 输出**按 UTF-8 边界切**：内核按字节给数据，多字节字符（中文/emoji）会被切开；
//      直接 `from_utf8_lossy` 每个 chunk 会把一个汉字切成两个 `�`（实测过，界面上一片乱码）。
//   ② 子进程必须是**新会话**（setsid + TIOCSCTTY）：否则它在我们的会话里，Ctrl-C 会打到 Studio 自己身上。

use std::ffi::{c_char, c_int, c_void, CString};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::Emitter;

/// `struct winsize`（termios.h）。字段顺序与内核一致：行/列在前。
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Winsize {
    ws_row: u16,
    ws_col: u16,
    ws_xpixel: u16,
    ws_ypixel: u16,
}

/// macOS 的 ioctl 常量（不引 libc ⇒ 手写；这两个值在 `sys/ttycom.h` 里是稳定的 ABI）
const TIOCSWINSZ: std::ffi::c_ulong = 0x8008_7467;
const TIOCSCTTY: std::ffi::c_ulong = 0x2000_7461;
const SIGTERM: c_int = 15;
const SIGKILL: c_int = 9;

extern "C" {
    fn openpty(amaster: *mut c_int, aslave: *mut c_int, name: *mut c_char, termp: *const c_void, winp: *const Winsize) -> c_int;
    fn fork() -> c_int;
    fn setsid() -> c_int;
    fn ioctl(fd: c_int, request: std::ffi::c_ulong, ...) -> c_int;
    fn dup2(from: c_int, to: c_int) -> c_int;
    fn close(fd: c_int) -> c_int;
    fn chdir(path: *const c_char) -> c_int;
    fn execve(path: *const c_char, argv: *const *const c_char, envp: *const *const c_char) -> c_int;
    fn _exit(code: c_int) -> !;
    fn read(fd: c_int, buf: *mut c_void, n: usize) -> isize;
    fn write(fd: c_int, buf: *const c_void, n: usize) -> isize;
    fn kill(pid: c_int, sig: c_int) -> c_int;
    fn waitpid(pid: c_int, status: *mut c_int, options: c_int) -> c_int;
}

#[derive(serde::Serialize, Clone)]
struct TermData {
    id: u64,
    data: String,
}

struct Session {
    master: c_int,
    pid: c_int,
    /// 会话代号：读线程只在自己仍是"当前会话"时才发事件（切会话/重开时旧线程必须闭嘴）
    gen: u64,
}

/* ★**多会话**（决策 #1362）：从"唯一会话"改成 id → Session 的表。
   为什么要改：新建终端 / 拆分终端 / 多终端列表都要求"同时存在多个 pty"，
   单例做不到（新开就把旧的顶掉）。事件也带 id，前端按 id 分发到各自的网格。 */
static SESSIONS: Mutex<Option<HashMap<u64, Session>>> = Mutex::new(None);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn with_sessions<T>(f: impl FnOnce(&mut HashMap<u64, Session>) -> T) -> Option<T> {
    let mut g = SESSIONS.lock().ok()?;
    let map = g.get_or_insert_with(HashMap::new);
    Some(f(map))
}

/// 按 **UTF-8 边界**把缓冲区里"已经完整"的部分切出来（不完整的尾字节留在缓冲区里等下一批）。
///
/// 例：一个汉字 `E4 BD A0` 被内核切成 `E4 BD` + `A0` 两批 ⇒ 第一批必须原样留着，
/// 否则界面上出现 `�` + `�`（这是最典型的"中文乱码"来源，不是编码设错）。
fn take_utf8(buf: &mut Vec<u8>) -> String {
    let mut cut = buf.len();
    // 从尾部往回最多看 3 个字节：找"最后一个起始字节"，判断它的序列是否还没收全
    for back in 1..=3.min(buf.len()) {
        let b = buf[buf.len() - back];
        if b & 0xC0 != 0x80 {
            // 起始字节（或 ASCII）
            let need = match b {
                0x00..=0x7F => 1,
                0xC0..=0xDF => 2,
                0xE0..=0xEF => 3,
                _ => 4,
            };
            if need > back {
                cut = buf.len() - back;
            }
            break;
        }
    }
    let s = String::from_utf8_lossy(&buf[..cut]).into_owned();
    buf.drain(..cut);
    s
}

/// 关掉当前会话（若有）。先礼后兵：SIGTERM 给 200ms，之后 SIGKILL。
///
/// ★为什么连**进程组**一起杀：shell 会和它跑着的命令在同一个进程组里，
///   只 kill shell 会留下一堆孤儿（`pnpm` 之类会继续吃 CPU）。
/// 关掉**指定**会话（有界等待，绝不阻塞调用线程 —— 主线程卡死过一次，见 #1351）。
fn close_session(id: u64) {
    let old = with_sessions(|m| m.remove(&id)).flatten();
    let Some(sess) = old else { return };
    unsafe {
        kill(-sess.pid, SIGTERM);
        kill(sess.pid, SIGTERM);
        close(sess.master);
        let mut st: c_int = 0;
        let mut reaped = false;
        for _ in 0..30 {
            if waitpid(sess.pid, &mut st, 1 /* WNOHANG */) != 0 {
                reaped = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        if !reaped {
            kill(-sess.pid, SIGKILL);
            kill(sess.pid, SIGKILL);
            for _ in 0..30 {
                if waitpid(sess.pid, &mut st, 1 /* WNOHANG */) != 0 {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    }
}

/// 关掉全部会话（退出应用时用）。
fn close_all() {
    let ids: Vec<u64> = with_sessions(|m| m.keys().copied().collect()).unwrap_or_default();
    for id in ids {
        close_session(id);
    }
}

/// 起一个跑在 pty 里的进程，返回 `(master_fd, child_pid)`。
///
/// ★抽成独立函数是为了**能测**：`open()` 要 `AppHandle`（Tauri），单测拿不到；
///   而这里只依赖系统调用 ⇒ 测试可以直接跑 `/bin/echo` 并读回它的输出（见文件尾的测试）。
///
/// `path` 必须绝对路径（execve 不做 PATH 查找）；`args` 不含 argv[0] 的占位，由本函数补。
fn spawn_pty(path: &str, args: &[&str], cols: u16, rows: u16, cwd: &std::path::Path) -> Result<(c_int, c_int), String> {
    /* ★所有要进子进程的内存都在 fork **之前**造好（见文件头纪律）。 */
    let c_path = CString::new(path).map_err(|e| e.to_string())?;
    let c_cwd = CString::new(cwd.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    let mut argv: Vec<CString> = vec![c_path.clone()];
    for a in args {
        argv.push(CString::new(*a).map_err(|e| e.to_string())?);
    }
    let mut argv_p: Vec<*const c_char> = argv.iter().map(|s| s.as_ptr()).collect();
    argv_p.push(std::ptr::null());

    /* 环境：继承 + 强制 TERM。★TERM 决定 shell 发什么控制序列（xterm-256color 才有 256 色 + 光标控制）；
       不设的话很多程序退化成"哑终端"，TUI 直接不工作。 */
    let mut env: Vec<CString> = Vec::new();
    for (k, v) in std::env::vars() {
        if k == "TERM" || k == "PWD" {
            continue;
        }
        if let Ok(s) = CString::new(format!("{k}={v}")) {
            env.push(s);
        }
    }
    env.push(CString::new("TERM=xterm-256color").map_err(|e| e.to_string())?);
    env.push(
        CString::new(format!("PWD={}", cwd.to_string_lossy())).unwrap_or_else(|_| CString::new("PWD=/").unwrap()),
    );
    let mut env_p: Vec<*const c_char> = env.iter().map(|s| s.as_ptr()).collect();
    env_p.push(std::ptr::null());

    let ws = Winsize { ws_row: rows.max(1), ws_col: cols.max(1), ws_xpixel: 0, ws_ypixel: 0 };
    let mut master: c_int = -1;
    let mut slave: c_int = -1;
    let rc = unsafe { openpty(&mut master, &mut slave, std::ptr::null_mut(), std::ptr::null(), &ws) };
    if rc != 0 || master < 0 || slave < 0 {
        return Err("openpty 失败（无法分配伪终端）".into());
    }

    let pid = unsafe { fork() };
    if pid < 0 {
        unsafe {
            close(master);
            close(slave);
        }
        return Err("fork 失败".into());
    }

    if pid == 0 {
        /* ── 子进程：只允许 async-signal-safe 调用（无分配 / 无锁 / 无 println）── */
        unsafe {
            close(master);
            setsid();                                  /* 新会话 ⇒ Ctrl-C 不会打到 Studio */
            ioctl(slave, TIOCSCTTY, 0);                /* 认这个 pty 为控制终端（拿得到 job control） */
            dup2(slave, 0);
            dup2(slave, 1);
            dup2(slave, 2);
            if slave > 2 {
                close(slave);
            }
            chdir(c_cwd.as_ptr());
            execve(c_path.as_ptr(), argv_p.as_ptr(), env_p.as_ptr());
            _exit(127);                                /* execve 只有失败才会回来 */
        }
    }

    // ── 父进程 ──（argv/env 的 CString 在这里才 drop；子进程 execve 已拿到独立地址空间）
    unsafe { close(slave) };
    drop(argv_p);
    drop(env_p);
    Ok((master, pid))
}

/// 打开会话：`cols x rows` 是**前端量出来的字符格子数**（pty 靠它排版，不是像素）。
pub fn open(app: tauri::AppHandle, cols: u16, rows: u16, shell: Option<String>) -> Result<u64, String> {
    /* ★shell 可选（决策 #1349）：允许前端明确选 zsh/bash。
       只接受**白名单**里的名字，绝不让调用方传任意路径（那等于给前端一个 exec 后门）。 */
    let shell = match shell.as_deref() {
        Some(s) if matches!(s, "zsh" | "bash" | "sh") => format!("/bin/{s}"),
        _ => std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into()),
    };
    let cwd = std::env::current_dir().map_err(|e| format!("取当前目录失败：{e}"))?;
    /* `-l`：登录 shell ⇒ 读到用户的 PATH/别名（否则 `pnpm` 之类直接找不到）。 */
    let (master, pid) = spawn_pty(&shell, &["-l"], cols, rows, &cwd)?;

    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let gen = id;
    with_sessions(|m| m.insert(id, Session { master, pid, gen }));
    std::thread::spawn(move || reader_loop(app, master, id, gen));
    eprintln!("[term] 会话就绪 id={id} pid={pid} {cols}x{rows} shell={shell}");
    Ok(id)
}

/// 读线程：把 pty 的输出按 UTF-8 边界切好，通过 `term:data` 事件推给前端。
fn reader_loop(app: tauri::AppHandle, master: c_int, id: u64, gen: u64) {
    let mut buf = vec![0u8; 8192];
    let mut pending: Vec<u8> = Vec::new();
    /* `POC_TERM_LOG=1` ⇒ 把**首段输出**打到 stderr（排障/无头验证用）。
       为什么需要：`[term] 会话就绪` 只证明 fork+exec 成功；"shell 真的吐了字节"
       是另一件事，而字节的去向是 webview（看不到）。这条钩子把那段补上。 */
    let log_first = std::env::var("POC_TERM_LOG").ok().as_deref() == Some("1");
    let mut logged = false;
    /* `POC_TERM_RAW=<path>` ⇒ 把 pty 的**原始字节**原样落盘（排障用，决策 #1285）。
       为什么要它：`首段输出` 只能看到第一块，"界面上一片空白"到底是
       ①shell 没吐字 ②字节到了但被前端解析吞了 ③画出来了但看不见 —— 三者只能靠
       **同一份字节**分别喂给两侧来区分。落盘后可以脱离 GUI，直接喂给渲染层做对照。 */
    let raw_path = std::env::var("POC_TERM_RAW").ok();
    let mut raw_file = raw_path.as_ref().and_then(|p| {
        std::fs::OpenOptions::new().create(true).append(true).open(p).ok()
    });
    loop {
        let n = unsafe { read(master, buf.as_mut_ptr() as *mut c_void, buf.len()) };
        if n > 0 {
            if let Some(f) = raw_file.as_mut() {
                use std::io::Write as _;
                let _ = f.write_all(&buf[..n as usize]);
                let _ = f.flush();
            }
            pending.extend_from_slice(&buf[..n as usize]);
            let s = take_utf8(&mut pending);
            if !s.is_empty() {
                // 会话已换（用户点了重开）⇒ 旧线程闭嘴，不把上一只 shell 的输出画到新终端上
                let cur = with_sessions(|m| m.get(&id).map(|x| x.gen)).flatten().unwrap_or(0);
                if cur != gen {
                    break;
                }
                if log_first && !logged {
                    logged = true;
                    let head: String = s.chars().take(120).collect();
                    eprintln!("[term] 首段输出（{} 字符）：{:?}", s.chars().count(), head);
                }
                let _ = app.emit("term:data", TermData { id, data: s });
            }
        } else if n == 0 {
            break; // EOF：shell 退出
        } else {
            let e = std::io::Error::last_os_error();
            if e.raw_os_error() == Some(4) {
                continue; // EINTR：被信号打断，继续读
            }
            break;
        }
    }
    let cur = with_sessions(|m| m.get(&id).map(|x| x.gen)).flatten().unwrap_or(0);
    if cur == gen {
        let _ = app.emit("term:exit", id);
    }
}

/// 把前端按键送进 pty（原样字节：`\r` / `\x1b[A` / `\x03` 都由前端按终端语义生成）。
pub fn write_str(id: u64, data: &str) -> Result<(), String> {
    let fd = with_sessions(|m| m.get(&id).map(|s| s.master))
        .flatten()
        .ok_or("终端未打开")?;
    let bytes = data.as_bytes();
    let mut off = 0usize;
    while off < bytes.len() {
        let n = unsafe { write(fd, bytes[off..].as_ptr() as *const c_void, bytes.len() - off) };
        if n < 0 {
            let e = std::io::Error::last_os_error();
            if e.raw_os_error() == Some(4) {
                continue; // EINTR
            }
            return Err(format!("写入终端失败：{e}"));
        }
        off += n as usize;
    }
    Ok(())
}

/// pty 尺寸变化（前端量出新的 cols/rows 时调）。
pub fn resize(id: u64, cols: u16, rows: u16) -> Result<(), String> {
    let fd = with_sessions(|m| m.get(&id).map(|s| s.master))
        .flatten()
        .ok_or("终端未打开")?;
    let ws = Winsize {
        ws_row: rows.max(1),
        ws_col: cols.max(1),
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    let rc = unsafe { ioctl(fd, TIOCSWINSZ, &ws as *const Winsize) };
    if rc != 0 {
        return Err("设置 pty 尺寸失败".into());
    }
    Ok(())
}

/// 关会话（切视图/关窗口时调；也可被"重开终端"复用）。
/// ★不能叫 `close`：与 libc 的 `close(fd)` 撞名（extern 块里的同名符号会遮蔽）。
pub fn shutdown() {
    close_all();
}

/// 会话状态（前端据此显示"点一下开终端"/"已连接"）。
#[derive(serde::Serialize)]
pub struct TermInfo {
    open: bool,
    pid: i32,
}

pub fn info() -> TermInfo {
    /* 多会话后这条只回答"有没有会话"，pid 给最早那个（兼容旧前端/门禁）。 */
    let pid = with_sessions(|m| m.values().map(|x| x.pid).min()).flatten();
    TermInfo {
        open: pid.is_some(),
        pid: pid.unwrap_or(-1),
    }
}

// ── IPC 命令 ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn term_open(app: tauri::AppHandle, cols: u16, rows: u16, shell: Option<String>) -> Result<u64, String> {
    /* 这一行是**接线证据**：前端到底有没有把 term_open 打进来。
       排"点终端没反应"时分两种：① 这行不出现 ⇒ 前端没调（视图/守卫/样式问题）；
       ② 这行出现但 `会话就绪` 不出现 ⇒ openpty/fork 失败（看紧随其后的错误）。 */
    eprintln!("[term] term_open 收到 {cols}x{rows} shell={shell:?}");
    /* ★放到工作线程：fork/kill 都可能慢，**绝不能占主线程**（决策 #1351） */
    tauri::async_runtime::spawn_blocking(move || open(app, cols, rows, shell))
        .await
        .map_err(|e| format!("开终端失败：{e}"))?
}

#[tauri::command]
pub fn term_write(id: u64, data: String) -> Result<(), String> {
    write_str(id, &data)
}

#[tauri::command]
pub fn term_resize(id: u64, cols: u16, rows: u16) -> Result<(), String> {
    resize(id, cols, rows)
}

#[tauri::command]
pub async fn term_close(id: u64) {
    let _ = tauri::async_runtime::spawn_blocking(move || close_session(id)).await;
}

#[tauri::command]
pub fn term_info() -> TermInfo {
    info()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// UTF-8 边界：被切开的多字节字符必须等下一批，不能渲染成 `�`
    #[test]
    fn utf8_split_is_buffered() {
        let mut b = vec![0xE4, 0xBD]; // 「你」的前两个字节
        assert_eq!(take_utf8(&mut b), "");
        assert_eq!(b.len(), 2, "不完整序列必须原样留着");
        b.push(0xA0);
        assert_eq!(take_utf8(&mut b), "你");
        assert!(b.is_empty());
    }

    /// ★真开一个 pty 跑 `/bin/echo`，把它的输出读回来 —— 这条覆盖 fork/execve/dup2/读循环整条路，
    ///   而不是只测字符串切分（"判据要测真实那条路"）。
    #[test]
    fn pty_runs_echo_and_reads_back() {
        let (master, pid) = spawn_pty("/bin/echo", &["PTY_OK"], 80, 24, std::path::Path::new("/tmp")).expect("spawn_pty");
        assert!(pid > 0, "应当拿到子进程 pid");

        let mut out = Vec::new();
        let mut buf = [0u8; 512];
        loop {
            let n = unsafe { read(master, buf.as_mut_ptr() as *mut c_void, buf.len()) };
            if n > 0 {
                out.extend_from_slice(&buf[..n as usize]);
            } else {
                break; // 0 = EOF（echo 退出、slave 关闭）；<0 = 出错，同样结束
            }
            if out.len() > 4096 {
                break; // 兜底，防止异常情况下死循环
            }
        }
        unsafe {
            close(master);
            let mut st: c_int = 0;
            waitpid(pid, &mut st, 0);
        }
        let text = String::from_utf8_lossy(&out);
        // echo 在 pty 上会带 \r\n（终端把 \n 翻成 \r\n），所以断言只找正文
        assert!(text.contains("PTY_OK"), "pty 输出里没有 PTY_OK，实际收到：{text:?}");
    }

    #[test]
    fn resize_before_open_is_error() {
        // 没开会话时 resize 必须**明确报错**（而不是静默成功，让界面以为生效了）
        // ★#1362 起 `resize` 带会话 id（多终端）：用一个**不存在**的 id ⇒ 必须报错，而不是
        //   落到某个默认会话上（那会让"切错标签"这类问题变成静默生效）。
        assert!(resize(9_999_999, 80, 24).is_err());
    }

    #[test]
    fn ascii_passes_through() {
        let mut b = b"ls\r\n".to_vec();
        assert_eq!(take_utf8(&mut b), "ls\r\n");
        assert!(b.is_empty());
    }
}
