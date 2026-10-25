// main.rs —— Proteus Studio 阶段 1 骨架（决策 #1173）
//
// 【这一版要证明什么】把 PoC 的「解码 → 合成 → 上屏」接进**真正的 Studio 布局**：
//   左侧面板栏 / 中间设备画布 / 右侧检查器 / 底部状态栏，且**画布位置由 HTML 布局决定**
//   （JS 量 getBoundingClientRect → 传到原生侧设 frame），而不是写死一个全屏 GL 视图。
//
// 【与前几个 PoC 的关系】A/B1/B2 证明性能；本单是把它们**装进产品形态**的第一步。
//   仍然不做：编辑器内核、终端、真实设备连线（画面来自录制流，见 README 边界）。

use serde::Serialize;
use std::ffi::{c_char, c_int, c_void, CString};
use std::time::{Duration, Instant};
use tauri::Manager;

/// 抓屏参数的计算（纯函数 + 单测；与 Tauri/窗口无关）
mod capture;
/// 自有菜单栏（决策 #1221）：取代 Tauri 的默认菜单，动作项转给前端
mod menu;

extern "C" {
    fn poc_attach(parent: *mut c_void) -> c_int;
    fn poc_tick() -> c_int;
    fn poc_set_frame(x: f64, y: f64, w: f64, h: f64);
    fn poc_frames() -> i64;
    fn poc_late() -> i64;
    fn poc_cpu_pct() -> f64;
    fn poc_dump(path: *const c_char) -> c_int;
    fn poc_live_aus() -> i64;
    fn poc_recv_ok() -> i64;
    fn poc_ticks() -> i64;
    fn poc_live_stats(out: *mut f64) -> c_int;
    fn poc_empty() -> i64;
    fn poc_send_ok() -> i64;
    fn poc_live_restarts() -> i32;
    fn poc_report(path: *const c_char);
}

/// 面板读数。字段名就是 HTML 侧读的名字 —— 少一层映射少一处漂移。
#[derive(Serialize)]
struct Stats {
    frames: i64,
    late: i64,
    cpu_pct: f64,
    /// 帧率（原生侧按墙钟算，不靠前端差分——前端差分在丢帧时会跳）
    fps: f64,
    iv_p50: f64,
    iv_p95: f64,
    lat_p50: f64,
    lat_p95: f64,
    qw_p50: f64,
    dec_p50: f64,
    cmp_p50: f64,
    pres_p50: f64,
    aus: i64,
    mbps: f64,
    empty: i64,
    ticks: i64,
    width: i64,
    height: i64,
    hwdec: bool,
    /// 机型（adb 探测；没探测到就是 null —— 不编一个）
    device: Option<String>,
}

#[tauri::command]
fn set_canvas_rect(x: f64, y: f64, w: f64, h: f64) {
    // ★HTML → 原生 的接线证据：把收到的矩形打出来（截图被 TCC 拦时靠它证明"布局真的驱动了画布"）
    eprintln!("[studio] canvas rect = {x:.1},{y:.1} {w:.1}x{h:.1}");
    unsafe { poc_set_frame(x, y, w, h) };
}

#[tauri::command]
fn stats() -> Stats {
    // 下标见 native/embed_view.m 的 poc_live_stats（一处定义，两边按注释对齐）
    let mut a = [0f64; 18];
    let n = unsafe { poc_live_stats(a.as_mut_ptr()) };
    debug_assert_eq!(n, 18);
    Stats {
        frames: a[10] as i64,
        late: a[9] as i64,
        cpu_pct: unsafe { poc_cpu_pct() },
        fps: a[0],
        iv_p50: a[1],
        iv_p95: a[2],
        lat_p50: a[3],
        lat_p95: a[4],
        qw_p50: a[5],
        dec_p50: a[6],
        cmp_p50: a[7],
        pres_p50: a[8],
        aus: a[11] as i64,
        mbps: a[12],
        empty: a[13] as i64,
        ticks: a[14] as i64,
        width: a[15] as i64,
        height: a[16] as i64,
        hwdec: a[17] > 0.5,
        device: device_label(),
    }
}

#[tauri::command]
fn dump_frame(path: String) {
    let c = CString::new(path).unwrap();
    let rc = unsafe { poc_dump(c.as_ptr()) };
    eprintln!("[studio] dump rc={rc}");
}

/// 读仓库内一个文本文件（G4 第一块砖：代码视图的**文件通路**）。
///
/// 【为什么不用 Tauri 的 fs 插件】本目录刻意没有 `package.json`（决策 #1187），
///   引 `@tauri-apps/plugin-fs` 会连带把前端依赖树和 capabilities 配置一起拉进来；
///   而"只读仓库里的文本"这一件事，Rust 侧 20 行就够，且能**自己把关边界**。
///
/// 【边界（都是硬约束，不是建议）】
///   · **必须在仓库根之下**：`canonicalize` 后前缀比对，`../` 穿越一律拒绝；
///   · **≤512KB**：再大就不是"看一段代码"，该走别的方式；
///   · **写回走 `write_text`**：带 mtime 冲突检测 + 原子替换（见该函数的注释）。
///
/// 【★诚实边界】仓库根取自编译期 `CARGO_MANIFEST_DIR`：
///   开发机直接跑二进制 ⇒ 有效；**打包成 .app 后该路径不存在** ⇒ 明确报错（不静默返回空串）。
///   打包形态要读源码是另一个问题（应读设备侧或让用户选工程目录），不在这一版。
/// 仓库根（`read_text` / `list_files` 共用）。
/// ★打包成 .app 后编译期路径不存在 ⇒ 明确报错（不静默返回空）。
fn repo_root() -> Result<std::path::PathBuf, String> {
    let root = std::env::var("PROTEUS_REPO_ROOT")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."));
    root.canonicalize()
        .map_err(|e| format!("仓库根不可达（打包形态？）：{e}"))
}

/// 解析"仓库内的一个路径"（`read_text` / `write_text` 共用）。
/// ★`canonicalize` 后再做前缀比对：只比字符串挡不住 `a/../../etc/passwd` 这类。
fn resolve_in_repo(path: &str) -> Result<std::path::PathBuf, String> {
    let root = repo_root()?;
    let p = root.join(path).canonicalize().map_err(|e| format!("打不开 {path}：{e}"))?;
    if !p.starts_with(&root) {
        return Err(format!("路径越界：{path}"));
    }
    Ok(p)
}

/// 文件的 mtime（**微秒**，Unix epoch）。取不到就 0 —— 上层据此判断"无法做冲突检测"。
/// ★用微秒而不是毫秒：两次保存可能落在同一毫秒里，那时"冲突检测"会漏判
///   （单测里连续两次写就是这个形状）。微秒下几乎不可能撞上。
fn mtime_us(p: &std::path::Path) -> u64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_micros() as u64)
        .unwrap_or(0)
}

/// 读到的一段文本 + 它的 mtime。
/// ★为什么要带 mtime：保存时回传，用来判断"打开之后文件有没有被别人改过"。
///   本仓常驻多个 AI 会话同时改文件（今天已发生多次），没有这个检查，
///   Studio 里保存一次就会**静默覆盖**别人的改动。
#[derive(Serialize)]
struct FileText {
    text: String,
    /// 文件 mtime（微秒，Unix epoch）
    mtime_us: u64,
}

#[tauri::command]
fn read_text(path: String) -> Result<FileText, String> {
    let p = resolve_in_repo(&path)?;
    let len = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
    if len > 512 * 1024 {
        return Err(format!("文件过大：{len} 字节（上限 512KB）"));
    }
    let text = std::fs::read_to_string(&p).map_err(|e| format!("读失败 {path}：{e}"))?;
    Ok(FileText { text, mtime_us: mtime_us(&p) })
}

/// 写回一个仓库内的文本文件。返回新的 mtime（前端据此更新"上次已知版本"）。
///
/// 【为什么不是简单的 fs::write】
///   1. **冲突检测**：`expect` 是打开时读到的 mtime。若磁盘上的 mtime 已经变了，
///      说明这段文本在打开之后被改过（并发会话 / 编辑器 / git 操作）⇒ 拒绝覆盖。
///      这是"最后写入者赢"之外唯一安全的做法：宁可让用户重读一次，也不静默吃掉别人的改动。
///   2. **原子替换**：先写同目录的临时文件再 `rename`。直接 `fs::write` 若中途失败/崩溃，
///      会留下半个文件——而这是个**源码**仓库，半个文件比没写更糟。
///   3. **保留权限位**：`rename` 会换成新文件的 mode（默认 0644），可执行脚本会因此丢 `+x`。
#[tauri::command]
fn write_text(path: String, text: String, expect: u64) -> Result<u64, String> {
    if text.len() > 512 * 1024 {
        return Err(format!("内容过大：{} 字节（上限 512KB）", text.len()));
    }
    let p = resolve_in_repo(&path)?;
    let meta = std::fs::metadata(&p).map_err(|e| format!("文件已不存在：{path}（{e}）"))?;
    let now = mtime_us(&p);
    // expect == 0 表示"前端拿不到 mtime"（老版本/异常），此时不阻断，但也不假装检测过
    if expect != 0 && now != expect {
        return Err(format!(
            "文件已被外部修改（磁盘 {now} ≠ 打开时 {expect}，可能是并发会话）⇒ 已拒绝覆盖。请重新打开该文件。"
        ));
    }

    let dir = p.parent().ok_or_else(|| format!("无法定位目录：{path}"))?;
    let tmp = dir.join(format!(
        ".{}.tmp{}-{}",
        p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "f".into()),
        std::process::id(),
        now
    ));
    std::fs::write(&tmp, text.as_bytes()).map_err(|e| format!("写临时文件失败：{e}"))?;
    // 保留原 mode（可执行位/只读位）；失败不影响正确性，只是回到默认权限
    let _ = std::fs::set_permissions(&tmp, meta.permissions());
    if let Err(e) = std::fs::rename(&tmp, &p) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("替换 {path} 失败：{e}"));
    }
    Ok(mtime_us(&p))
}

/// 列仓库内若干子树下的源码文件（G4：代码视图的**文件列表**）。
///
/// 【为什么不用前端 glob】前端没有文件系统访问权（本目录也没配 capabilities），
///   而这只是个**只读、有界**的查询 ⇒ 在 Rust 侧做，边界与 `read_text` 共用同一套规则。
///
/// 【边界（硬约束）】只在仓库根之下 · 只认白名单扩展名 · 跳过 node_modules/target/构建产物
///   （否则一次几千条）· 上限 **300** 条（到上限就返回，如实截断而非静默少给）。
#[tauri::command]
fn list_files(roots: Vec<String>) -> Result<Vec<String>, String> {
    const EXT: [&str; 10] = ["ts", "tsx", "vue", "rs", "m", "h", "py", "md", "json", "css"];
    const SKIP: [&str; 8] = ["node_modules", "target", "dist", "build-app", "web-dist", "gen", ".git", ".vite"];
    const MAX: usize = 300;

    let repo = repo_root()?;
    let mut out: Vec<String> = Vec::new();
    let mut stack: Vec<std::path::PathBuf> = roots.iter().map(|r| repo.join(r)).collect();
    while let Some(dir) = stack.pop() {
        let rd = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name();
            let name = name.to_string_lossy();
            if SKIP.contains(&name.as_ref()) {
                continue;
            }
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            let ok = p
                .extension()
                .map(|x| EXT.contains(&x.to_string_lossy().as_ref()))
                .unwrap_or(false);
            if !ok {
                continue;
            }
            if let Ok(rel) = p.strip_prefix(&repo) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
                if out.len() >= MAX {
                    out.sort();
                    return Ok(out);
                }
            }
        }
    }
    out.sort();
    Ok(out)
}

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
fn load_state() -> Result<String, String> {
    let p = state_path()?;
    match std::fs::read_to_string(&p) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("{}".to_string()),
        Err(e) => Err(format!("读状态失败：{e}")),
    }
}

/// 写工作区状态（原子替换：先写 `.tmp` 再 rename，避免半个 JSON 落盘）。
#[tauri::command]
fn save_state(json: String) -> Result<(), String> {
    if json.len() > 64 * 1024 {
        return Err(format!("状态过大：{} 字节（上限 64KB）", json.len()));
    }
    let p = state_path()?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, json.as_bytes()).map_err(|e| format!("写临时状态失败：{e}"))?;
    std::fs::rename(&tmp, &p).map_err(|e| format!("替换状态文件失败：{e}"))
}

/// 机型探测：一次 adb 查询，缓存住。
/// ★探测不到就返回 None —— **不拿"Android"这种占位串冒充机型**（面板上"未知"比一个假型号有用）。
fn device_label() -> Option<String> {
    use std::sync::OnceLock;
    static CACHE: OnceLock<Option<String>> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            let get = |args: &[&str]| -> Option<String> {
                let out = std::process::Command::new("adb").args(args).output().ok()?;
                if !out.status.success() {
                    return None;
                }
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if s.is_empty() { None } else { Some(s) }
            };
            let model = get(&["shell", "getprop", "ro.product.model"])?;
            // `wm size` 输出形如 "Physical size: 1080x2400"
            let size = get(&["shell", "wm", "size"]).and_then(|s| {
                s.split("Physical size:").nth(1).map(|x| x.trim().to_string())
            });
            Some(match size {
                Some(sz) => format!("{model} · {sz}"),
                None => model,
            })
        })
        .clone()
}

/// 双击启动时 LaunchServices 只给 `/usr/bin:/bin:/usr/sbin:/sbin`，
/// 而 `adb` 通常在 `/opt/homebrew/bin` 或 `/usr/local/bin` ⇒ 显式补进 PATH。
/// ★不补的话"双击就能用"是假的：面板能开，但一台设备都连不上（同一类坑：GUI 不继承 shell 环境）。
fn ensure_tool_path() {
    const EXTRA: [&str; 2] = ["/opt/homebrew/bin", "/usr/local/bin"];
    let cur = std::env::var("PATH").unwrap_or_default();
    let missing: Vec<&str> = EXTRA.iter().copied().filter(|p| !cur.split(':').any(|x| x == *p)).collect();
    if missing.is_empty() {
        return;
    }
    let mut merged = missing.join(":");
    if !cur.is_empty() {
        merged.push(':');
        merged.push_str(&cur);
    }
    std::env::set_var("PATH", &merged);
    eprintln!("[studio] PATH 补充：{}", missing.join(":"));
}

/// 问设备当前显示尺寸（`adb shell wm size`）。
/// 失败（无设备 / adb 不在 / 输出格式变了）一律返回 `None` —— 调用方据此**不带 `--size`**，
/// 而不是退回一个写死值：写死值会让竖屏被塞进 16:9 而补出 74% 的黑边。
fn adb_screen_size() -> Option<(u32, u32)> {
    let out = std::process::Command::new("adb")
        .args(["shell", "wm", "size"])
        .output()
        .ok()?;
    capture::parse_wm_size(&String::from_utf8_lossy(&out.stdout))
}

/// 没有显式指定输入时**默认接真机**——双击启动不可能带环境变量，
/// 否则用户看到的是一个永远空白的画布，还以为坏了。
///
/// ★★两条腿（决策 #1190 · G3）：
///   · **Android**：`adb exec-out screenrecord`（整机录屏，裸 Annex-B）
///   · **iOS**：宿主把画面（ReplayKit + VT 硬编）推 TCP 裸 Annex-B ⇒ 本侧 `/usr/bin/nc -l <port>` 收。
///     用 `nc` 而不是自己写监听器：`live_stream.h` 只认「管道里的字节」，而 `nc` 系统自带、
///     `.app` 里也在；断线由 native 侧的「子进程退出自动重连」兜底（与 adb 那条腿同款）。
///     ★iPhone 侧：`bash hosts/ios/run-selfdraw.sh --stream=<本机IP>:9001`
///   · 想关掉 iOS 等待：`PROTEUS_IOS_STREAM=0`（否则没有 Android 设备时会一直挂着 nc）
fn default_live_source() {
    if std::env::var("POC_LIVE").is_ok() || std::env::var("POC_VIDEO").is_ok() {
        return;
    }
    // ★★显式点名 iOS 端口 ⇒ **优先于 adb 探测**（2026-10-23 实测踩到）：
    //   本机同时连着 Android 和 iPhone 时，若先查 adb，用户按 README 跑
    //   `PROTEUS_IOS_STREAM_PORT=9001 …` 会**静默拿到 Android 画面**（没有任何报错，只有一行 eprintln）
    //   ⇒ 显式意图必须压过自动探测。
    if let Ok(port) = std::env::var("PROTEUS_IOS_STREAM_PORT") {
        std::env::set_var("POC_LIVE", format!("/usr/bin/nc -l {port}"));
        eprintln!("[studio] PROTEUS_IOS_STREAM_PORT={port} ⇒ 等 iOS 推流（/usr/bin/nc -l {port}）");
        eprintln!("[studio]   iPhone 侧：bash hosts/ios/run-selfdraw.sh --stream=<本机IP>:{port}");
        return;
    }
    let connected = std::process::Command::new("adb")
        .arg("devices")
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .skip(1)
                .any(|l| l.trim_end().ends_with("device"))
        })
        .unwrap_or(false);
    if connected {
        // ★★抓屏尺寸必须**按设备比例**（2026-10-23 实测）：`screenrecord --size` 是把整屏塞进给定尺寸，
        //   不足处**补黑边**。写死 1280x720 时，1200x2608 的竖屏只剩 330x720 有效画面
        //   —— `cropdetect` 实测 **74.2% 的像素是黑边**，带宽/解码/FBO 全在搬运和放大一块黑。
        //   现在按 `wm size` 等比取（长边 ≤1920），实测 `crop=882:1920:0:0`（黑边消失）。
        let dev = adb_screen_size();
        let cmd = match dev.and_then(|(w, h)| capture::pick_capture_size(w, h).map(|s| (w, h, s))) {
            Some((dw, dh, (w, h))) => {
                let br = capture::bitrate_for(w, h);
                eprintln!(
                    "[studio]   录屏 {w}x{h}（设备 {dw}x{dh} · 等比 · 长边≤1920）· {} Mbps",
                    br / 1_000_000
                );
                // ★把预分配尺寸也告诉原生侧（它按 POC_LIVE_W/H 先建纹理）。
                //   不设的话它按默认 1280x720 建，首帧到达再重建一次 —— 一次无谓的
                //   纹理重分配 + 一行"首帧尺寸 ≠ 预设"的告警，看起来像出了问题。
                //   尊重用户显式设置：只在这两个变量为空时才写。
                if std::env::var("POC_LIVE_W").is_err() {
                    std::env::set_var("POC_LIVE_W", w.to_string());
                }
                if std::env::var("POC_LIVE_H").is_err() {
                    std::env::set_var("POC_LIVE_H", h.to_string());
                }
                format!(
                    "adb exec-out screenrecord --output-format=h264 --size {w}x{h} --bit-rate {br} --time-limit 180 -"
                )
            }
            // ★查不到尺寸时**不带 `--size`**（用设备原生分辨率），而不是退回某个写死的值
            //   —— 写死值正是这次要修的 bug；宁可多花点带宽，也不要一小块画面加一圈黑边。
            None => {
                eprintln!("[studio]   查不到设备尺寸（wm size 失败）⇒ 用设备原生分辨率录屏");
                "adb exec-out screenrecord --output-format=h264 --bit-rate 12000000 --time-limit 180 -"
                    .to_string()
            }
        };
        std::env::set_var("POC_LIVE", cmd);
        eprintln!("[studio] 未指定输入，默认接真机（Android / adb screenrecord）");
        eprintln!("[studio]   想看 iPhone：PROTEUS_IOS_STREAM_PORT=9001 再启动本程序（显式指定优先于本探测）");
        return;
    }
    if std::env::var("PROTEUS_IOS_STREAM").ok().as_deref() == Some("0") {
        eprintln!("[studio] 未检测到 Android 设备；PROTEUS_IOS_STREAM=0 ⇒ 不等待 iOS 推流，画布保持空白");
        return;
    }
    let port = std::env::var("PROTEUS_IOS_STREAM_PORT").unwrap_or_else(|_| "9001".to_string());
    std::env::set_var("POC_LIVE", format!("/usr/bin/nc -l {port}"));
    eprintln!("[studio] 未检测到 Android 设备 ⇒ 改等 iOS 推流（/usr/bin/nc -l {port}）");
    eprintln!("[studio]   iPhone 侧：bash hosts/ios/run-selfdraw.sh --stream=<本机IP>:{port}");
    eprintln!("[studio]   不想等：PROTEUS_IOS_STREAM=0");
}

fn main() {
    ensure_tool_path();
    default_live_source();
    std::panic::set_hook(Box::new(|info| eprintln!("[studio] PANIC: {info}")));
    tauri::Builder::default()
        // 自有菜单栏（决策 #1221）。★必须在 setup 里 `set_menu` 之外另走这条：
        //   Builder::menu 是**唯一**能让 Tauri 不装默认菜单的入口；在 setup 里 set_menu
        //   虽然也能换掉，但默认菜单会先被创建、`on_menu_event` 会同时收到两套 id。
        .menu(menu::build)
        .on_menu_event(|app, ev| menu::dispatch(app, ev.id().0.as_str()))
        .invoke_handler(tauri::generate_handler![
            set_canvas_rect,
            stats,
            dump_frame,
            read_text,
            write_text,
            list_files,
            load_state,
            save_state
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let h = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(300));
                poll_window(h, 100);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Studio 启动失败");
}

/// 主线程轮询等窗口就绪后挂载原生画布（原因见 PoC B2 的踩坑记录 1–3）
fn poll_window(handle: tauri::AppHandle, tries: u32) {
    if tries == 0 {
        eprintln!("[studio] 等窗口超时");
        return;
    }
    let h = handle.clone();
    let _ = handle.run_on_main_thread(move || {
        match h.get_webview_window("main") {
            Some(w) => match w.ns_window() {
                Ok(p) => {
                    let rc = unsafe { poc_attach(p as *mut c_void) };
                    eprintln!("[studio] attach rc={rc}");
                    start_ticks(h.clone());
                    // 取数模式（真机实时流没有容器、没法用 ffmpeg 侧统计，只能自己上报）：
                    //   POC_SECONDS=n + POC_JSON=<path> ⇒ 跑 n 秒后写读数并退出
                    //   POC_DUMP=<path>              ⇒ 5 秒后把画布读回成 PPM（视觉自证）
                    let secs: f64 = std::env::var("POC_SECONDS")
                        .ok()
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(0.0);
                    let json = std::env::var("POC_JSON").ok();
                    let dump = std::env::var("POC_DUMP").ok();
                    if secs > 0.0 && json.is_some() {
                        let hh = h.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(Duration::from_millis((secs * 1000.0) as u64));
                            let c = CString::new(json.unwrap()).unwrap();
                            let _ = hh.run_on_main_thread(move || unsafe {
                                poc_report(c.as_ptr());
                            });
                            std::thread::sleep(Duration::from_millis(500));
                            hh.exit(0);
                        });
                    } else if let Some(path) = dump {
                        let hh = h.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(Duration::from_millis(5000));
                            let c = CString::new(path).unwrap();
                            let _ = hh.run_on_main_thread(move || unsafe {
                                let rc = poc_dump(c.as_ptr());
                                eprintln!(
                                    "[studio] dump rc={rc} | aus={} restarts={} frames={} send_ok={} recv_ok={} ticks={} empty={}",
                                    poc_live_aus(), poc_live_restarts(), poc_frames(), poc_send_ok(), poc_recv_ok(),
                                    poc_ticks(), poc_empty()
                                );
                            });
                            std::thread::sleep(Duration::from_millis(600));
                            hh.exit(0);
                        });
                    }
                }
                Err(e) => eprintln!("[studio] ns_window 失败：{e}"),
            },
            None => {
                let h2 = h.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(100));
                    poll_window(h2, tries - 1);
                });
            }
        }
    });
}

/// 60Hz 调度：原生侧自己按 PTS 决定"这一拍要不要出帧"（30fps 源 ⇒ 一半的拍是空转）。
fn start_ticks(handle: tauri::AppHandle) {
    // 取样节拍可配：60Hz 面板下"到得比刷新快"没意义，但节拍越慢 ⇒ 帧在队列里等得越久。
    // 实测 60Hz 节拍下队列等待占端到端延迟的 ~80%（决策 #1176），所以这里必须可调、可测。
    let hz: u64 = std::env::var("POC_TICK_HZ")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|v| *v >= 15 && *v <= 240)
        .unwrap_or(60);
    eprintln!("[studio] tick = {hz}Hz");
    std::thread::spawn(move || {
        let period = Duration::from_micros(1_000_000 / hz);
        let mut due = Instant::now();
        loop {
            due += period;
            let now = Instant::now();
            if due > now {
                std::thread::sleep(due - now);
            } else {
                due = now;
            }
            let h = handle.clone();
            if h.run_on_main_thread(move || unsafe {
                poc_tick();
            })
            .is_err()
            {
                break;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 写回通路的三条硬约束：冲突检测 / 被拒不落盘 / 原子替换不留残留。
    /// ★放 `packages/studio/target/`（gitignore）下写临时文件，测完删掉——不给仓库留垃圾。
    #[test]
    fn write_text_带冲突检测且原子替换() {
        let rel = "packages/studio/target/write-test.txt";
        let abs = repo_root().unwrap().join(rel);
        std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
        std::fs::write(&abs, "v1\n").unwrap();

        let t1 = read_text(rel.to_string()).unwrap();
        assert_eq!(t1.text, "v1\n");
        assert!(t1.mtime_us > 0, "mtime 取不到 ⇒ 冲突检测形同虚设");

        // ① 用最新 mtime 保存：应当成功，且 mtime 变化
        let t2 = write_text(rel.to_string(), "v2\n".into(), t1.mtime_us).unwrap();
        assert_eq!(std::fs::read_to_string(&abs).unwrap(), "v2\n");
        assert_ne!(t2, t1.mtime_us, "写入后 mtime 必须变，否则无从判断'被改过'");

        // ② 拿**旧** mtime 再写 ⇒ 必须拒绝（模拟打开后被并发会话改过）
        let err = write_text(rel.to_string(), "v3\n".into(), t1.mtime_us).unwrap_err();
        assert!(err.contains("拒绝覆盖"), "错误要说清在拒绝什么：{err}");
        assert_eq!(
            std::fs::read_to_string(&abs).unwrap(),
            "v2\n",
            "被拒的写不能落盘（这条比返回 Err 更重要）"
        );

        // ③ 用新 mtime ⇒ 通过
        write_text(rel.to_string(), "v3\n".into(), t2).unwrap();
        assert_eq!(std::fs::read_to_string(&abs).unwrap(), "v3\n");

        // ④ 不留临时文件（原子替换的残留物最容易漏掉，而它会污染文件树）
        let leftovers: Vec<String> = std::fs::read_dir(abs.parent().unwrap())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "残留临时文件：{leftovers:?}");

        // ⑤ 越界路径必须拒绝（`..` 穿越）
        assert!(read_text("../../etc/passwd".to_string()).is_err());
        assert!(write_text("../../etc/passwd".to_string(), "x".into(), 0).is_err());

        let _ = std::fs::remove_file(&abs);
    }
}
