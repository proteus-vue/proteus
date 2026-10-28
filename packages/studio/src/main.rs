// main.rs —— Proteus Studio 阶段 1 骨架（决策 #1173）
//
// 【这一版要证明什么】把 PoC 的「解码 → 合成 → 上屏」接进**真正的 Studio 布局**：
//   左侧面板栏 / 中间设备画布 / 右侧检查器 / 底部状态栏，且**画布位置由 HTML 布局决定**
//   （JS 量 getBoundingClientRect → 传到原生侧设 frame），而不是写死一个全屏 GL 视图。
//
// 【与前几个 PoC 的关系】A/B1/B2 证明性能；本单是把它们**装进产品形态**的第一步。
//   仍然不做：终端（pty）· 调试器（DAP）· 元素拾取（G-54 无数据源）。
//   ★编辑器（CodeMirror）、真实设备实时投屏（adb / iOS nc）、触摸回传均**已落地**——
//     2026-10-26 更正：这段注释曾长期写着"不做编辑器、不做真实设备连线"，与实际相反（决策 #1254）。

use serde::Serialize;
use std::ffi::{c_char, c_int, c_void, CString};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tauri::Manager;

/// 抓屏参数的计算（纯函数 + 单测；与 Tauri/窗口无关）
mod capture;
/// 自有菜单栏（决策 #1221）：取代 Tauri 的默认菜单，动作项转给前端
mod menu;
/// 仓库内全文搜索（决策 #1222）：rg 子进程 + 字节偏移→字符列的换算
mod capture_preset;
mod device;
mod settings;
mod window;
mod search;
/// 「画面从哪来」+ iOS 接法提示（决策 #1277，从本文件拆出）
mod live_source;
/// 内置终端（pty）：openpty + fork + execve（决策 #1279）
mod term;
/// 一键投屏到 iPhone：复用 run-selfdraw.sh + 把失败翻译成人话（决策 #1288）
mod ios_stream;
/// 触控回传：Studio 监听控制端口，手机反向连上来注入手势（决策 #1295）
mod ios_touch;
/// ★#1344：Git **只读**查询（从本文件抽出——曾 1103 行越过 1000 行上限）。
///   ★只查询不写：stage/commit/push 一律不加（本仓纪律：push 必须人工批准）。
mod git;
/// ★#1344：仓库内文件读写 + 路径沙箱（同一组抽出；共享**同一条**安全边界）。
///   ★新增任何文件系统能力必须复用 `resolve_in_repo`，不要自己拼路径。
mod fs_guard;

extern "C" {
    fn poc_attach(parent: *mut c_void) -> c_int;
    fn poc_tick() -> c_int;
    fn poc_set_frame(x: f64, y: f64, w: f64, h: f64);
    fn poc_frames() -> i64;
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
    /// 把应用图标切到**当前 bundle 的 icon.icns**（决策 #1230，实现见 native/embed_view.m）
    fn poc_use_bundle_icon();
    /// 写系统剪贴板（NSPasteboard，决策 #1234）
    fn poc_copy_text(s: *const c_char);
    /// 只**登记**重启请求，由渲染线程在下一拍执行（避免与解码器竞争，决策 #1263）
    fn poc_live_request_restart(cmd: *const c_char);
}

/// 设备物理尺寸（启动探测一次；`stats` 轮询读缓存，不再跑 adb）。
pub(crate) static DEVICE_PX: std::sync::Mutex<Option<(u32, u32)>> = std::sync::Mutex::new(None);

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
    /// 推流是否已中断（>1.5s 没有新 AU）。★界面据此把"运行中"改成"手机端已停止推流"，
    /// 否则画布停着上一帧、面板还在显示旧 fps，看起来像没断（决策 #1290）
    stalled: bool,
    /// 当前采集源（`android` / `ios` / `file`…）。★界面用它决定触控走哪条腿：
    /// 之前用 `iosStreamHint.active`，而那个值在挂载时算一次就不再更新
    /// ⇒ 切到 iOS 后点击仍走 adb（对空气发指令，用户看到"点了没反应"）。决策 #1298
    source: String,
    /// 机型（adb 探测；没探测到就是 null —— 不编一个）
    device: Option<String>,
    /// 设备**物理**像素（`wm size`；0 = 未知）。
    /// ★和 `width/height`（**码流**尺寸）不是一回事：触摸回传必须注入物理坐标，
    ///   拿码流尺寸去点会整体缩到 884/1200 = 0.737（实测：点"设置"落到它上面的 App，决策 #1260）。
    dev_w: i64,
    dev_h: i64,
}

/// 画质档位（决策 #1264）：逻辑在 `capture_preset.rs`，这里只做 IPC 接线。
/// 自动连接的内部实现（决策 #1307）：与 `select_device` 同一套分支，只是不走 IPC。
fn auto_connect(serial: &str) -> Result<(), String> {
    let platform = device::select(serial)?;
    match platform.as_str() {
        "ios" => capture_preset::request_ios().map(|_| ()),
        "sim" => capture_preset::request_sim(serial).map(|_| ()),
        _ => capture_preset::request_for_serial(Some(serial)).map(|_| ()),
    }
}

#[tauri::command]
fn capture_preset(preset: String) -> Result<capture_preset::CaptureInfo, String> {
    capture_preset::capture_preset(preset)
}

/// 列出设备（异步 + 阻塞线程池：每台要跑 1~2 次 adb，不能占 IPC 线程）
#[tauri::command]
async fn list_devices(force: Option<bool>) -> Vec<device::DeviceInfo> {
    tauri::async_runtime::spawn_blocking(move || device::list(force.unwrap_or(false)))
        .await
        .unwrap_or_default()
}

/// 等"首帧真的到了"——**切换成功与否以此为准**（决策 #1339）。
///
/// ★为什么必须在后端等：原来的 `select_device` 只是"把命令发下去"就返回 Ok，
///   UI 于是立刻弹"已切到 xxx"，而流可能根本没起来（昨天就出现"提示切换成功、画布空白"）。
///   这正是"假绿"——提示的依据必须是**观察到的事实**，不是"指令已发出"。
///
/// 判定（两种情形都兼容）：
///   · `frames` 是累计计数 ⇒ 比切换前大即视为有新帧；
///   · 采集会话重启后计数会归零 ⇒ 只要"restarts 增加过且 frames > 0"也算成功。
///
/// 注意：**有界等待**（最多 `ms`），不做无退出条件的轮询。
fn wait_first_frame(f0: i64, r0: i32, ms: u64) -> Result<(), String> {
    let t0 = std::time::Instant::now();
    let mut restarted = unsafe { poc_live_restarts() } > r0;
    while (t0.elapsed().as_millis() as u64) < ms {
        let f = unsafe { poc_frames() };
        if unsafe { poc_live_restarts() } > r0 {
            restarted = true;
        }
        if f > f0 || (restarted && f > 0) {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    Err(if restarted {
        format!(
            "采集已启动，但 {}s 内没有收到画面 —— 原因见 ~/Library/Logs/Proteus Studio/cast.err",
            ms / 1000
        )
    } else {
        format!("{}s 内采集进程都没起来（设备/窗口可能没就绪）", ms / 1000)
    })
}

/// 切换当前设备：改全局串号/尺寸 → 用**当前画质档**重建采集命令 → 让渲染线程重启会话。
/// ★顺序不能反：先改状态再重建命令，否则新命令还是旧串号。
#[tauri::command]
async fn select_device(serial: String) -> Result<capture_preset::CaptureInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        /* ★先切"当前设备"，再**按平台**决定采集源（决策 #1274）：
           Android 走 adb 拉流；iOS 走 `nc -l` 收手机推流。 */
        let platform = device::select(&serial)?;
        /* 记住这次的选择（决策 #1307）：下次启动自动连回来，用户不必每次手动点 */
        {
            let mut cfg = settings::current();
            cfg.last_device = Some(serial.clone());
            if let Err(e) = settings::save(cfg) {
                eprintln!("[studio] 记不住上次设备（不影响本次会话）：{e}");
            }
        }
        /* ★记下切换前的计数，用于"首帧是否真的到了"（决策 #1339） */
        let f0 = unsafe { poc_frames() };
        let r0 = unsafe { poc_live_restarts() };
        let info = if platform == "ios" {
            /* iOS 真机：命令是 `nc -l`，**本来就该等手机开始推流** ⇒ 不等首帧（不能把"等待"当失败） */
            return capture_preset::request_ios();
        } else if platform == "mirror" {
            /* ★iPhone 镜像（决策 #1316）：真机整屏，走 SCK 抓系统镜像窗口 */
            capture_preset::request_mirror()
        } else if platform == "sim" {
            /* ★iOS 模拟器（决策 #1302）：画面走 SCK 抓窗口 → ffmpeg → 现有管线 */
            capture_preset::request_sim(&serial)
        } else {
            capture_preset::request_for_serial(device::current_serial().as_deref())
        };
        let info = info?;
        /* ★**只有看到首帧才算切换成功**（决策 #1339）：模拟器/镜像/安卓都该立刻出帧 */
        wait_first_frame(f0, r0, 10_000)?;
        Ok(info)
    })
    .await
    .map_err(|e| format!("切换线程失败：{e}"))?
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
    let mut a = [0f64; 19];
    let n = unsafe { poc_live_stats(a.as_mut_ptr()) };
    debug_assert_eq!(n, 19);
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
        stalled: a[18] > 0.5,
        source: capture_preset::current_kind().unwrap_or_else(|| "none".into()),
        /* ★切到 iOS 后 ADB_SERIAL 是空的，但 `device::label(None)` 会跑
           `adb shell getprop`（无 `-s`）⇒ 机器上只接着一台安卓时它**照样返回那台**
           ⇒ 面板在 iOS 推流时显示 Android 机型（实测）。这里按"真的选了安卓"才取。 */
        device: ADB_SERIAL
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .and_then(|s| device::label(Some(&s))),
        dev_w: DEVICE_PX.lock().ok().and_then(|g| *g).map(|(w, _)| w as i64).unwrap_or(0),
        dev_h: DEVICE_PX.lock().ok().and_then(|g| *g).map(|(_, h)| h as i64).unwrap_or(0),
    }
}


/// 仓库内全文搜索（决策 #1222）。
///
/// 【为什么是 `async` + `spawn_blocking`】rg 是**阻塞子进程**：写进同步 command 会占住
///   IPC 线程（macOS 上就是主线程）⇒ 搜索时界面卡一下，输入法都会顿。
///   Tauri 的异步命令跑在 tokio 上，再把阻塞体丢回 blocking 线程池，两边都不占。
#[tauri::command]
async fn search_text(query: String) -> Result<search::Outcome, String> {
    let q = query.trim().to_string();
    if q.chars().count() < 2 {
        // ★明确报错，不静默返回空：单字符搜索在这仓里是上万条命中，那不是"搜索"是"扫描"。
        return Err("至少输入 2 个字符（单字符会命中上万条，不是搜索是扫描）".into());
    }
    let root = fs_guard::repo_root()?;
    tauri::async_runtime::spawn_blocking(move || search::run(&root, &q, 300))
        .await
        .map_err(|e| format!("搜索线程异常：{e}"))?
}

/// 把文本写进系统剪贴板（右键菜单「复制相对路径」用）。
/// ★为什么不走浏览器的 `navigator.clipboard`：WKWebView 里它要**用户手势 + 焦点**同时满足，
///   菜单项点击后焦点常在菜单节点上 ⇒ 会静默失败。NSPasteboard 没有这些前提。
/* ★★★#1344：**Git 只读**整块已抽到 `git.rs`（`GitFile` / `GitStatus` / `git_status` / `git_head`）。
   本文件曾 1103 行越过 1000 行硬上限；Git 只读与"窗口/画布/设备"职责无关，
   且它有一条独立安全边界（**只查询、不写**）——分开写更不容易在改窗口代码时被顺手放宽。 */
#[tauri::command]
fn git_status() -> git::GitStatus {
    git::git_status()
}

/// 取某个文件在 HEAD 里的内容（用于"与 HEAD 比较"）；未跟踪/不存在 ⇒ None。
#[tauri::command]
fn git_head(path: String) -> Option<String> {
    git::git_head(path)
}

#[tauri::command]
fn copy_text(text: String) {
    let c = CString::new(text).unwrap_or_default();
    #[cfg(target_os = "macos")]
    unsafe {
        poc_copy_text(c.as_ptr())
    };
}

/* ── 关窗口/退出前的拦截（决策 #1244）─────────────────────────────────────
 * 前端把"脏缓冲数量"同步过来；窗口收到关闭请求时，只要还有脏的就**拦下来**并通知前端弹确认框。
 * 前端选完（保存并关闭 / 不保存）再调 `close_now()` 放行。
 * ★为什么状态放 Rust：关闭请求是**系统事件**，必须在这一层就能判断——前端来不及接。
 */
static DIRTY_BUFFERS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
static ALLOW_CLOSE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
fn set_dirty_count(n: usize) {
    DIRTY_BUFFERS.store(n, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
fn close_now(window: tauri::Window) {
    ALLOW_CLOSE.store(true, std::sync::atomic::Ordering::Relaxed);
    let _ = window.close();
}

/* ── 触摸回传（决策 #1254 · G4 第三项）：画布上点一下 ⇒ 注入到真机 ───────────────
 *
 * 【为什么只做 Android】iOS 那条腿是「宿主 ReplayKit 推流 → 本机 `nc -l` 收」，**只有下行**；
 *   反向注入要 iPhone 侧另开一条控制通道（G3 二阶段）。这里**如实报不支持**而不是静默丢弃——
 *   "点了没反应"和"这种源不支持"必须能分清，否则用户会以为是自己点歪了。
 *
 * 【为什么记 serial】本机常同时连着多台设备，而 `adb shell` 在**多设备时直接失败**
 *   （`more than one device/emulator`）。更重要的是：注入和录屏必须打**同一台**，
 *   否则会出现"看着 A 的屏、点在 B 上"——这种错很难从界面上看出来。
 *
 * 【为什么用 `input tap` 而不是 sendevent】`input` 是设备上的系统命令（无需权限），
 *   一次点击 ≈ 一次进程启动（真机实测 60~120ms）；sendevent 要走 root 且要自己算坐标变换，
 *   对一个"调试时点几下"的场景不划算。拖动/多指等复杂手势另议（见 #1254 的边界）。
 */
static TOUCH_ANDROID: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub(crate) static ADB_SERIAL: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// 第一台处于 `device` 状态的 adb 设备（见 `live_source::first_adb_serial`）。

/// 设备屏幕是否亮着。缓存 1.5s：连点时不必每次多问一遍（一次 adb 往返 ≈ 30~60ms）。
/// ★这是 2026-10-26 真机实测换来的：**熄屏时 `input tap` 返回 0，但状态不变**
///   （`mWakefulness=Dozing` 前后一致）——即"点了等于没点"，而且**永远不会报错**。
///   本仓对"静默无效"有明确态度：要么做到，要么说出来。这里选后者（不擅自点亮用户设备）。
static SCREEN_STATE: std::sync::Mutex<Option<(Instant, bool)>> = std::sync::Mutex::new(None);

fn screen_awake(serial: Option<&str>) -> Option<bool> {
    if let Ok(g) = SCREEN_STATE.lock() {
        if let Some((t, v)) = *g {
            if t.elapsed() < Duration::from_millis(1500) {
                return Some(v);
            }
        }
    }
    let mut c = std::process::Command::new("adb");
    if let Some(s) = serial {
        c.args(["-s", s]);
    }
    c.args(["shell", "dumpsys", "power"]);
    let out = c.output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let v = text
        .lines()
        .find(|l| l.contains("mWakefulness="))
        .map(|l| l.split('=').nth(1).unwrap_or("").trim() == "Awake")?;
    if let Ok(mut g) = SCREEN_STATE.lock() {
        *g = Some((Instant::now(), v));
    }
    Some(v)
}

/// 注入一条 `adb shell input ...`。tap / swipe 共用**同一套闸门**：
/// ① 源不支持（iOS / 录制流）② 熄屏 ③ 串号。三道闸门只写一次，避免两条命令漂移。
///
/// ★`adb` 是**阻塞子进程**（真机 60~120ms）：必须放阻塞线程池，不能占住 IPC/主线程，
///   否则连续点两下就会卡住整个界面（与 search.rs 里 rg 的处理同理）。
async fn inject_input(args: Vec<String>) -> Result<(), String> {
    if !TOUCH_ANDROID.load(std::sync::atomic::Ordering::Relaxed) {
        return Err("当前画面源不支持触控回传（只有 Android / adb 实时投屏能注入）".into());
    }
    let serial = ADB_SERIAL.lock().ok().and_then(|g| g.clone());
    // ★熄屏时注入**不会报错也不会生效**（真机实测）⇒ 提前说清楚，别让人以为点歪了
    if let Some(false) = screen_awake(serial.as_deref()) {
        return Err("设备屏幕没亮（Dozing）：这次操作大概率没效果 —— 先把设备屏幕点亮".into());
    }
    let out = tauri::async_runtime::spawn_blocking(move || {
        let mut c = std::process::Command::new("adb");
        if let Some(s) = serial.as_deref() {
            c.args(["-s", s]);
        }
        c.args(["shell", "input"]).args(&args).output()
    })
    .await
    .map_err(|e| format!("注入线程失败：{e}"))?;
    match out {
        Ok(o) if o.status.success() => Ok(()),
        Ok(o) => Err(format!(
            "adb input 失败：{}",
            String::from_utf8_lossy(&o.stderr).trim()
        )),
        Err(e) => Err(format!("调不起 adb：{e}")),
    }
}

#[tauri::command]
async fn device_tap(x: u32, y: u32) -> Result<String, String> {
    inject_input(vec!["tap".into(), x.to_string(), y.to_string()]).await?;
    Ok(format!("{x},{y}"))
}

/// 滑动 / 长按（决策 #1255）。★长按不单独做一个命令：Android 的语义就是
/// `input swipe x y x y <ms>`（同点 + 持续时间）—— 两个命令会是同一件事的两种说法，
/// 迟早漂移（一个改了闸门另一个没改，就是 #1254 里"看着 A 的屏点在 B 上"的同族风险）。
#[tauri::command]
async fn device_swipe(x1: u32, y1: u32, x2: u32, y2: u32, ms: u32) -> Result<String, String> {
    // 夹住时长：太短设备侧可能判成 tap（`input swipe` 对 0ms 的行为不保证），太长会卡住输入队列
    let d = ms.clamp(50, 3000);
    inject_input(vec![
        "swipe".into(),
        x1.to_string(),
        y1.to_string(),
        x2.to_string(),
        y2.to_string(),
        d.to_string(),
    ])
    .await?;
    Ok(format!("{x1},{y1}→{x2},{y2} @{d}ms"))
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
/* ★★★#1344：**仓库内文件读写 + 路径沙箱**已抽到 `fs_guard.rs`
   （`repo_root` / `resolve_in_repo` / `mtime_us` / `FileText` / `read_text` /
    `write_text` / `list_files`）。抽因：本文件曾 1103 行越过 1000 行硬上限；
   而这一组共享**同一条安全边界**（canonicalize + 前缀比对），写在一起边界才不会分叉。
   ★以下四个 command 只是把 Tauri 入口转发到该模块（命令名不变，前端零改动）。 */
#[tauri::command]
fn read_text(path: String) -> Result<fs_guard::FileText, String> {
    fs_guard::read_text(path)
}

#[tauri::command]
fn write_text(path: String, text: String, expect: u64) -> Result<u64, String> {
    fs_guard::write_text(path, text, expect)
}

#[tauri::command]
fn list_files(roots: Vec<String>) -> Result<Vec<String>, String> {
    fs_guard::list_files(roots)
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


/// 设置窗口入口（实现见 `settings::open_window`）
#[tauri::command]
fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    settings::open_window(&app)
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
fn init_log_file() {
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

fn main() {
    init_log_file();
    live_source::ensure_tool_path();
    /* ★读设置要在**所有子进程之前**（决策 #1266）：DEVELOPER_DIR 决定 xcrun 用哪个 Xcode，
       而 adb 路径决定设备探测能不能跑。放后面就晚了——那正是"默认路径"假设的来源。 */
    settings::load_and_apply();
    live_source::default_live_source();
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
            save_state,
            copy_text,
            git_status,
            git_head,
            set_dirty_count,
            close_now,
            device_tap,
            device_swipe,
            capture_preset,
            list_devices,
            select_device,
            open_settings,
            /* iOS 接法提示（决策 #1277）：界面靠它拿到「本机 IP + 端口 + 该跑的命令」 */
            live_source::ios_stream_hint,
            /* 内置终端（决策 #1279） */
            term::term_open,
            term::term_write,
            term::term_resize,
            term::term_close,
            term::term_info,
            /* 一键投屏（决策 #1288） */
            ios_stream::ios_stream_start,
            ios_stream::ios_start_host,
            ios_stream::ios_uninstall,
            ios_stream::ios_run_state,
            /* 触控回传（决策 #1295） */
            ios_touch::ios_tap,
            ios_touch::ios_scroll,
            ios_touch::ios_key,
            ios_touch::ios_longpress,
            ios_touch::ios_swipe,
            ios_touch::ios_touch_state,
            settings::get_settings_cmd,
            settings::save_settings_cmd,
            settings::probe_tool,
            settings::detect_tools,
            settings::pick_tool,
            search_text
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let h = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(300));
                poll_window(h, 100);
            });
            /* 启动时把**设备枚举结果**打一行日志（决策 #1276）：
               "列表为空"是最难自查的故障（xcrun/adb 都可能静默失败）。这条日志让人一眼看到
               各平台列到几台、以及 iOS 用的是哪套 Xcode。 */
            {
                let h3 = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(1200));
                    let list = device::list(false);
                    let android = list.iter().filter(|d| d.platform == "android").count();
                    let ios = list.iter().filter(|d| d.platform == "ios").count();
                    eprintln!("[studio] 设备枚举：Android {android} 台 · iOS {ios} 台");
                    for d in &list {
                        eprintln!(
                            "[studio]   {} {} · {} · {}{}",
                            d.platform,
                            d.model,
                            d.state,
                            d.serial,
                            if d.note.is_empty() { String::new() } else { format!(" · {}", d.note) }
                        );
                    }
                    drop(h3);
                });
            }
            /* 回归钩子（决策 #1267）：`STUDIO_OPEN_SETTINGS_MS=<毫秒>` ⇒ 到点自动开设置窗口。
               用来在**无头**模式下验证"独立窗口真能建起来"——窗建不出来的表现是白窗，
               而判据跑的是 http 页面，天生看不到 Tauri 那一层。 */
            /* ★启动自动重连（决策 #1307）：按"上次设备 → 唯一可用"的顺序自动接上。
               优先级：**上次成功的设备** → 唯一的已连真机 → 已启动的模拟器。
               `POC_LIVE` 显式指定时不动（那是调试/自测路径）。 */
            {
                let h4 = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(900));
                    if std::env::var("POC_LIVE").is_ok() {
                        return;
                    }
                    let last = settings::current().last_device.clone();
                    let list = device::list(false);
                    let pick = last
                        .filter(|s| list.iter().any(|d| &d.serial == s))
                        .or_else(|| {
                            let ready: Vec<_> = list
                                .iter()
                                .filter(|d| d.platform == "android" && d.state == "device")
                                .collect();
                            (ready.len() == 1).then(|| ready[0].serial.clone())
                        })
                        .or_else(|| list.iter().find(|d| d.platform == "simulator" && d.size.is_none()).map(|d| d.serial.clone()));
                    let Some(serial) = pick else {
                        eprintln!("[studio] 没有可自动连接的设备（列表里点一台即可）");
                        return;
                    };
                    eprintln!("[studio] 自动连接上次/唯一可用设备 → {serial}");
                    let _ = h4;
                    if let Err(e) = auto_connect(&serial) {
                        eprintln!("[studio] 自动连接失败（可手动点设备）：{e}");
                    }
                });
            }
            /* 回归钩子（决策 #1302）：`PROTEUS_SIM_AUTOSTART=<udid>` ⇒ 启动即切到该 iOS 模拟器。
               存在的理由与终端钩子相同：**画面/注入这条链只有真环境能证**，
               而判据跑的是 http 页面（桩），看不到 Tauri 与 SCK/HID 那一层。 */
            if let Ok(udid) = std::env::var("PROTEUS_SIM_AUTOSTART") {
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(1200));
                    if let Err(e) = device::select(&udid) {
                        eprintln!("[sim] 自动切模拟器失败：{e}");
                        return;
                    }
                    match capture_preset::request_sim(&udid) {
                        Ok(_) => eprintln!("[sim] 已切到模拟器 {udid}"),
                        Err(e) => eprintln!("[sim] request_sim 失败：{e}"),
                    }
                });
            }
            /* 回归钩子（决策 #1279）：`STUDIO_OPEN_TERM_MS=<毫秒>` ⇒ 到点替用户点一下"终端"。
               存在的理由和上面那条一样：pty 开没开、shell 有没有起来，**只有真窗口能证**——
               判据跑的是 http 页面（桩），天生看不到 Tauri 那一层。证法看 stderr 里的
               `[term] 会话就绪 pid=…`（那条日志只在 open() 成功后才打）。

               ★**它是 best-effort，不是判据**：实测 webview 未挂载/正忙时 `emit("menu", …)`
                 会直接丢（2500ms 命中过一次、8000ms 反而没命中）——与"投屏解码占着渲染线程"同源。
                 所以真窗口那一步（点 rail 图标 / ⌘\` 能开出终端）**只能人眼验**，
                 别拿这条钩子当"功能已通"的证据。 */
            /* ★手动 iOS 模式（`PROTEUS_IOS_STREAM_PORT`）也要有触控通道：
       否则只有走「一键投屏」才有 9002 监听，手工起的会话点了没反应（决策 #1299）。 */
            if let Ok(p) = std::env::var("PROTEUS_IOS_STREAM_PORT") {
                if let Ok(port) = p.parse::<u16>() {
                    ios_touch::ensure_listening(app.handle().clone(), port.saturating_add(1));
                }
            }
            if let Ok(ms) = std::env::var("STUDIO_OPEN_TERM_MS") {
                let h2 = app.handle().clone();
                let delay = ms.parse::<u64>().unwrap_or(1500);
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(delay));
                    let _ = h2.emit("menu", "view.term");
                });
            }
            if let Ok(ms) = std::env::var("STUDIO_OPEN_SETTINGS_MS") {
                let h2 = app.handle().clone();
                let delay = ms.parse::<u64>().unwrap_or(1500);
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(delay));
                    let _ = settings::open_window(&h2);
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let dirty = DIRTY_BUFFERS.load(std::sync::atomic::Ordering::Relaxed);
                if dirty > 0 && !ALLOW_CLOSE.load(std::sync::atomic::Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.emit("app:close-blocked", dirty);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Studio 启动失败")
        // ★Dock 图标以**包内 icon.icns** 为准（决策 #1230）。
        //   为什么放在这里而不是 `setup()`：Tauri 在 Ready 事件里会先用**嵌进二进制的那张 PNG**
        //   调 `setApplicationIconImage`（dev 构建实测），而两个通道共用同一个二进制 ⇒ 不覆盖回来，
        //   预览版的 Dock 图标就是正式版那张（症状：先绿几秒后变紫）。
        //   这个 `run` 回调在 Ready 处理链的**最后**，所以这里设置的一定是最终值。
        .run(|_app, event| {
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Ready) {
                unsafe { poc_use_bundle_icon() };
            }
        });
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
        let abs = fs_guard::repo_root().unwrap().join(rel);
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
