// boot.rs —— 启动期基础设施（决策 #1487 从 `main.rs` 拆出）
//
// 【为什么拆】`main.rs` 已经 **998 行**、贴上 `check:file-size` 的 1000 行硬上限，
//   而这个文件里同时住着"窗口/命令/菜单/日志/状态落盘/启动计时"六件事。
//   本模块收拢其中**与 Tauri 界面无关**的三件：
//     ① 工作区状态落盘（G5：Application Support 下的 state.json）；
//     ② stderr → 日志文件（决策 #1310，Finder 启动时排障的唯一线索）；
//     ③ 启动计时 + live source 就绪信号（决策 #1379：先量出哪段占了 10 秒）。
//
// 【★为什么不连 `fn main` 一起搬】Rust 的二进制入口必须在 crate root（`main.rs`），
//   所以入口只能留下；能被搬走的是它**调用的东西**。

/// 工作区状态的落盘位置（G5）：`~/Library/Application Support/dev.proteus.studio/state.json`。
///
/// 【为什么不用 localStorage】WebView 的 localStorage 会随清缓存/换 identifier 丢，
///   而且**用户看不见也改不了**；IDE 的会话状态属于"工程之外的用户偏好"，
///   放标准位置（macOS 的 Application Support）才能备份、迁移、排障。
fn state_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME 不可用".to_string())?;
    let dir = std::path::PathBuf::from(home).join("Library/Application Support/dev.proteus.studio");
    std::fs::create_dir_all(&dir).map_err(|e| format!("建状态目录失败：{e}"))?;
    Ok(dir.join("state.json"))
}

/// 读工作区状态。**首次运行没有文件是正常情况** ⇒ 返回 `{}` 而不是报错。
#[tauri::command]
pub fn load_state() -> Result<String, String> {
    let p = state_path()?;
    match std::fs::read_to_string(&p) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("{}".to_string()),
        Err(e) => Err(format!("读状态失败：{e}")),
    }
}

/// 写工作区状态（原子替换：先写 `.tmp` 再 rename，避免半个 JSON 落盘）。
#[tauri::command]
pub fn save_state(json: String) -> Result<(), String> {
    if json.len() > 64 * 1024 {
        return Err(format!("状态过大：{} 字节（上限 64KB）", json.len()));
    }
    let p = state_path()?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, json.as_bytes()).map_err(|e| format!("写临时状态失败：{e}"))?;
    std::fs::rename(&tmp, &p).map_err(|e| format!("替换状态文件失败：{e}"))
}

/// PATH 补齐 / 设备尺寸 / 默认采集源：见 `live_source.rs`（决策 #1277 拆出，本文件只留调用）
/// 把 stderr 同时落到日志文件（决策 #1310）。
///
/// ★为什么必须有：从 Finder 启动时 stdout/stderr 被 LaunchServices 丢掉，
///   于是"为什么没画面"这类问题只能靠猜（今天已经猜错好几次）。
///   有了它，用户点两下我就能看到真实原因。
///
/// ★为什么用 `freopen` 而不是换掉所有 `eprintln!`：一处生效、不侵入既有代码；
///   终端里启动（stderr 是 tty）时**不重定向**，保持开发体验不变。
pub fn init_log_file() {
    use std::io::IsTerminal;
    if std::io::stderr().is_terminal() {
        return;
    }
    let dir = dirs_log_dir();
    let _ = std::fs::create_dir_all(&dir);
    use std::os::unix::io::AsRawFd;
    let path = dir.join("studio.log");
    /* ★用 `dup2(fd, 2)` 而不是 `freopen`：不依赖 libc crate，也不需要 `stderr` 这个 FILE* 符号。
       Rust 的 `eprintln!` 写 fd 2，重定向后自然落到文件。 */
    extern "C" {
        fn dup2(oldfd: i32, newfd: i32) -> i32;
    }
    if let Ok(f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        unsafe {
            dup2(f.as_raw_fd(), 2);
        }
        std::mem::forget(f); // 让 fd 一直开着（进程退出才关）
    }
    eprintln!("\n===== {} 启动 · {} =====", chrono_stamp(), env!("CARGO_PKG_VERSION"));
}

fn dirs_log_dir() -> std::path::PathBuf {
    std::env::var("HOME")
        .map(|h| std::path::PathBuf::from(h).join("Library/Logs/Proteus Studio"))
        .unwrap_or_else(|_| std::env::temp_dir())
}

fn chrono_stamp() -> String {
    // 不引 chrono：用 `date` 拿本地时间（只在启动时跑一次）
    std::process::Command::new("/bin/date")
        .arg("+%F %T")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/* ★启动计时（决策 #1379）：先量出"哪一段占了 10 秒"，再决定改什么。
   用户痛点：点图标后**要 ~10 秒才出窗口**，观感像"没启动"。 */
static BOOT_T0: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
/* ★live source 就绪信号（决策 #1379）：把 `default_live_source()`（simctl 枚举 + boot 模拟器 +
   adb 探测，本机实测 **4.5 秒**）挪到**窗口创建之后**的后台线程；自动重连必须等它完成，
   用条件变量而不是 sleep —— 符合仓规"有条件等待，禁止盲等"。 */
static SRC_READY: std::sync::OnceLock<(std::sync::Mutex<bool>, std::sync::Condvar)> =
    std::sync::OnceLock::new();

/// 记下启动起点（`main` 第一件事）。★收成函数而不是暴露 `BOOT_T0`：
/// 外部只该关心"开始计时"，不该知道它存在 `OnceLock` 里。
pub fn start_clock() {
    BOOT_T0.set(std::time::Instant::now()).ok();
}

fn src_ready_pair() -> &'static (std::sync::Mutex<bool>, std::sync::Condvar) {
    SRC_READY.get_or_init(|| (std::sync::Mutex::new(false), std::sync::Condvar::new()))
}

pub fn mark_src_ready() {
    let (m, cv) = src_ready_pair();
    if let Ok(mut g) = m.lock() {
        *g = true;
        cv.notify_all();
    }
}

/// 等 live source 初始化完成（最多 `timeout`）；已就绪立刻返回。
pub fn wait_src_ready(timeout: std::time::Duration) {
    let (m, cv) = src_ready_pair();
    if let Ok(g) = m.lock() {
        if !*g {
            let _ = cv.wait_timeout(g, timeout);
        }
    }
}

pub fn boot_mark(what: &str) {
    if let Some(t) = BOOT_T0.get() {
        eprintln!("[boot] {:>6}ms  {what}", t.elapsed().as_millis());
    }
}
