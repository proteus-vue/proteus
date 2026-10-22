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

fn main() {
    std::panic::set_hook(Box::new(|info| eprintln!("[studio] PANIC: {info}")));
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_canvas_rect, stats, dump_frame])
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
