// main.rs —— Studio PoC B2：Tauri 2 窗口里承载原生 GL 画面（决策 #1169）
//
// 【做什么】起一个最小 Tauri 2 窗口（内容 = 透明 WKWebView + HTML 叠加层），
//   把原生 GL 视图垫到 contentView 最底层，再用**主线程调度**按 30fps 调 `poc_tick()`
//   解码+合成+上屏；跑 N 秒后落 JSON 读数并退出。
//
// 【★踩过的坑（写下来省下次）】
//   1) 配置里的 `app.windows` 在 `setup()` 阶段**还没建**：`get_webview_window("main")` 返回 None；
//      此时再遍历 labels 会直接在 tao 的 ObjC 回调（`did_finish_launching`）里 panic ⇒
//      `panic in a function that cannot unwind` ⇒ abort（连 catch_unwind 都抓不到）。
//      ⇒ 正确做法：`setup` 里**只起线程**，线程轮询等窗口就绪，再用 `run_on_main_thread` 挂载。
//   2) `NSOpenGLContext` 必须在**创建它的线程**（主线程）makeCurrent ⇒ 每帧都走
//      `run_on_main_thread(poc_tick)`，不要在后台线程摸 GL。
//   3) 图标必须存在且是 **RGBA** PNG，否则 `generate_context!` 直接编译失败。

use std::ffi::{c_char, c_int, c_void, CString};
use std::time::{Duration, Instant};
use tauri::Manager;

extern "C" {
    fn poc_attach(parent: *mut c_void) -> c_int;
    fn poc_tick() -> c_int;
    fn poc_report(path: *const c_char);
    fn poc_probe() -> c_int;
}

fn env_f64(k: &str, d: f64) -> f64 {
    std::env::var(k).ok().and_then(|s| s.parse().ok()).unwrap_or(d)
}

fn main() {
    // tao 的 did_finish_launching 是 extern "C" 边界：panic 无法 unwind，默认 hook 只会报
    // "panic in a function that cannot unwind"。装个 hook 至少能把真实 payload 打出来。
    std::panic::set_hook(Box::new(|info| eprintln!("[poc] PANIC: {info}")));

    let seconds = env_f64("POC_SECONDS", 15.0);
    let out_path = std::env::var("POC_JSON").unwrap_or_else(|_| "/tmp/poc/tauri-report.json".into());

    tauri::Builder::default()
        .setup(move |app| {
            if std::env::var("POC_NOOP").is_ok() {
                eprintln!("[poc] noop");
                return Ok(());
            }
            let handle = app.handle().clone();
            // ★只在**主线程**碰窗口对象：从后台线程调 get_webview_window 会触发
            //   WKWebView 的跨线程 ObjC 异常（实测 "Rust cannot catch foreign exceptions" ⇒ abort）。
            // ★不要在 setup 里直接 run_on_main_thread：此时事件循环还没起来（实测 panic ⇒ abort）。
            //   先起线程睡一会儿，等 loop 跑起来再开始轮询。
            let h = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(300));
                poll_window(h, 100);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauri 启动失败");
}

/// 在主线程上轮询等窗口就绪；ready 后挂载原生视图并启动 30fps 调度。
fn poll_window(handle: tauri::AppHandle, tries: u32) {
    if tries == 0 {
        eprintln!("[poc] 等窗口超时");
        handle.exit(2);
        return;
    }
    let h = handle.clone();
    let _ = handle.run_on_main_thread(move || {
        let win = h.get_webview_window("main");
        match win {
            Some(w) => {
                match w.ns_window() {
                    Ok(p) => {
                        let rc = unsafe { poc_attach(p as *mut c_void) };
                        eprintln!("[poc] attach rc={rc}");
                    }
                    Err(e) => eprintln!("[poc] ns_window 失败：{e}"),
                }
                std::thread::sleep(Duration::from_millis(200));
                eprintln!(
                    "[poc] webview 探测位={}（bit0 找到 / bit1 已透明）",
                    unsafe { poc_probe() }
                );
                start_ticks(h.clone());
            }
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

/// 30fps 绝对时基调度：每帧 `run_on_main_thread(poc_tick)`（GL 上下文在主线程）。
fn start_ticks(handle: tauri::AppHandle) {
    let seconds = env_f64("POC_SECONDS", 15.0);
    let out_path = std::env::var("POC_JSON").unwrap_or_else(|_| "/tmp/poc/tauri-report.json".into());
    std::thread::spawn(move || {
        let start = Instant::now();
        let period = Duration::from_millis(1000 / 30);
        let mut due = Instant::now();
        let mut ticks: u64 = 0;
        while start.elapsed().as_secs_f64() < seconds {
            due += period;
            let now = Instant::now();
            if due > now {
                std::thread::sleep(due - now);
            } else {
                due = now;
            }
            let h2 = handle.clone();
            if h2
                .run_on_main_thread(move || unsafe {
                    poc_tick();
                })
                .is_err()
            {
                break;
            }
            ticks += 1;
        }
        std::thread::sleep(Duration::from_millis(150));
        let c = CString::new(out_path).expect("路径含 NUL");
        let h3 = handle.clone();
        let _ = h3.run_on_main_thread(move || unsafe {
            poc_report(c.as_ptr());
        });
        std::thread::sleep(Duration::from_millis(400));
        eprintln!("[poc] ticks={ticks}");
        handle.exit(0);
    });
}
