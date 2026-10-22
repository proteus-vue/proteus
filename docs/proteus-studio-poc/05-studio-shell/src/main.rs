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
    fn poc_send_ok() -> i64;
    fn poc_live_restarts() -> i32;
}

#[derive(Serialize)]
struct Stats {
    frames: i64,
    late: i64,
    cpu_pct: f64,
}

#[tauri::command]
fn set_canvas_rect(x: f64, y: f64, w: f64, h: f64) {
    // ★HTML → 原生 的接线证据：把收到的矩形打出来（截图被 TCC 拦时靠它证明"布局真的驱动了画布"）
    eprintln!("[studio] canvas rect = {x:.1},{y:.1} {w:.1}x{h:.1}");
    unsafe { poc_set_frame(x, y, w, h) };
}

#[tauri::command]
fn stats() -> Stats {
    unsafe {
        Stats {
            frames: poc_frames(),
            late: poc_late(),
            cpu_pct: poc_cpu_pct(),
        }
    }
}

#[tauri::command]
fn dump_frame(path: String) {
    let c = CString::new(path).unwrap();
    let rc = unsafe { poc_dump(c.as_ptr()) };
    eprintln!("[studio] dump rc={rc}");
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
                    // 自证用：POC_DUMP=<path> 时，5 秒后把画布读回成 PPM 并退出
                    if let Ok(path) = std::env::var("POC_DUMP") {
                        let hh = h.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(Duration::from_millis(5000));
                            let c = CString::new(path).unwrap();
                            let _ = hh.run_on_main_thread(move || unsafe {
                                let rc = poc_dump(c.as_ptr());
                                eprintln!(
                                    "[studio] dump rc={rc} | aus={} restarts={} frames={} send_ok={} recv_ok={}",
                                    poc_live_aus(), poc_live_restarts(), poc_frames(), poc_send_ok(), poc_recv_ok()
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
    std::thread::spawn(move || {
        let period = Duration::from_millis(1000 / 60);
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
