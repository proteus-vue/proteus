// app_setup.rs —— Tauri 启动装配（决策 #1488 从 `main.rs` 拆出）
//
// 【为什么拆】拆掉 `boot.rs` 后 `main.rs` 仍有 881 行，其中 **`fn main` 一个函数就 267 行**：
//   菜单装配 / 60 多条命令注册 / setup 闭包（后台线程 ×4 + 回归钩子 ×5）/ 窗口事件。
//   它和平常的业务代码完全不是一类东西——**只在启动那一刻按顺序执行一次**。
//
// 【★为什么 `fn main` 只剩一行】Rust 二进制入口必须在 crate root，搬不走；
//   能搬的是它的**身体**。所以这里叫 `run()`，`main.rs` 只留
//   `fn main() { app_setup::run() }` —— 入口是入口，装配是装配。
//
// 【★全用 `crate::` 前缀，不用 `use crate::xxx`】本文件与 `main.rs` 里的命令同名
//   （`capture_preset` 既是模块又是命令），`use` 进来会让"是模块还是函数"靠猜。
//   显式路径对读者和编译器都更直白。

use std::ffi::{c_int, c_void, CString};
use std::time::{Duration, Instant};
/* ★`Emitter` / `Manager` 是 **trait**：不导入就没有 `emit` / `get_webview_window` 方法，
   报错是"no method named emit"——看着像 API 变了，其实是作用域里少了 use。 */
use tauri::Emitter;
use tauri::Manager;

pub fn run() {
    crate::boot::start_clock();
    crate::boot::init_log_file();
    crate::boot::boot_mark("日志文件就绪");
    crate::live_source::ensure_tool_path();
    /* ★读设置要在**所有子进程之前**（决策 #1266）：DEVELOPER_DIR 决定 xcrun 用哪个 Xcode，
       而 adb 路径决定设备探测能不能跑。放后面就晚了——那正是"默认路径"假设的来源。 */
    crate::settings::load_and_apply();
    crate::boot::boot_mark("设置加载（含 Xcode/adb 探测）");
    std::panic::set_hook(Box::new(|info| eprintln!("[studio] PANIC: {info}")));
    tauri::Builder::default()
        // 自有菜单栏（决策 #1221）。★必须在 setup 里 `set_menu` 之外另走这条：
        //   Builder::menu 是**唯一**能让 Tauri 不装默认菜单的入口；在 setup 里 set_menu
        //   虽然也能换掉，但默认菜单会先被创建、`on_menu_event` 会同时收到两套 id。
        .menu(crate::menu::build)
        .on_menu_event(|app, ev| crate::menu::dispatch(app, ev.id().0.as_str()))
        .invoke_handler(tauri::generate_handler![
            crate::set_canvas_rect,
            crate::set_ui_zoom,
            crate::diag::diag_tsc,
            crate::diag::diag_eslint,
            crate::diag::diag_lsp_start,
            crate::diag::diag_lsp_sync,
            crate::diag::diag_complete,
            crate::diag::diag_definition,
            crate::diag::diag_references,
            crate::diag::diag_rename,
            crate::diag::diag_symbols,
            crate::diag::diag_quickinfo,
            crate::diag::diag_lsp_stop,
            crate::diag::diag_watch_start,
            crate::diag::diag_watch_stop,
            crate::stats,
            crate::dump_frame,
            crate::ipc_fs::read_text,
            /* ★漏注册过一次（决策 #1439）：`#[tauri::command]` 只是标记，**必须**列进
               `generate_handler!` 才能被前端调用；漏了会报 "Command xxx not found"，
               而 `cargo build` 依然通过 —— 只有真机调用才暴露。 */
            crate::ipc_fs::read_text_external,
            crate::ipc_fs::write_text,
            crate::ipc_fs::list_files,
            crate::ipc_fs::file_stat,
            crate::ipc_fs::file_symbols,
            /* ★决策 #1460：四个命令同样必须列进 generate_handler! —— `#[tauri::command]`
               只是生成 wrapper，漏注册时 cargo build 仍通过、只有真机调用才报
               "Command xxx not found"（check-tauri-handlers 静态兜底）。 */
            crate::fs_ops::create_file,
            crate::fs_ops::create_dir,
            crate::fs_ops::rename_path,
            crate::fs_ops::delete_path,
            /* 决策 #1462：同样必须列进 generate_handler!（check-tauri-handlers 静态兜底） */
            crate::format::format_text,
            crate::boot::load_state,
            crate::boot::save_state,
            crate::ipc_fs::copy_text,
            crate::ipc_fs::read_clipboard,
            crate::git_status,
            crate::git_head,
            crate::set_dirty_count,
            crate::close_now,
            crate::device_tap,
            crate::device_swipe,
            crate::capture_preset,
            crate::list_devices,
            crate::select_device,
            crate::open_settings,
            /* iOS 接法提示（决策 #1277）：界面靠它拿到「本机 IP + 端口 + 该跑的命令」 */
            crate::live_source::ios_stream_hint,
            /* 内置终端（决策 #1279） */
            crate::term::term_open,
            crate::term::term_write,
            crate::term::term_resize,
            crate::term::term_close,
            crate::term::term_info,
            /* 一键投屏（决策 #1288） */
            crate::ios_stream::ios_stream_start,
            crate::ios_stream::ios_start_host,
            crate::ios_stream::ios_uninstall,
            crate::ios_stream::ios_run_state,
            /* 触控回传（决策 #1295） */
            crate::ios_touch::ios_tap,
            crate::ios_touch::ios_scroll,
            crate::ios_touch::ios_key,
            crate::ios_touch::ios_longpress,
            crate::ios_touch::ios_swipe,
            crate::ios_touch::ios_touch_state,
            crate::settings::get_settings_cmd,
            crate::settings::save_settings_cmd,
            crate::settings::probe_tool,
            crate::settings::detect_tools,
            crate::settings::pick_tool,
            crate::search_text
        ])
        .setup(|app| {
            crate::boot::boot_mark("setup 开始（窗口即将创建）");
            /* ★重活挪到**窗口之后**（决策 #1379）：它要枚举模拟器（simctl）、必要时 boot 模拟器、
               再探 adb，本机实测 4.5s ⇒ 放在窗口前就是"点图标 10 秒没反应"的主因。
               现在窗口先出来（~1.2s），这条在后台跑，跑完再让自动重连往下走。 */
            std::thread::spawn(move || {
                crate::live_source::default_live_source();
                crate::boot::boot_mark("live source 就绪（后台）");
                crate::boot::mark_src_ready();
            });
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
                    let list = crate::device::list(false);
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
                    /* ★等 live source 就绪（上限 12s），不盲等固定 900ms（决策 #1379） */
                    crate::boot::wait_src_ready(Duration::from_secs(12));
                    if std::env::var("POC_LIVE").is_ok() {
                        return;
                    }
                    let last = crate::settings::current().last_device.clone();
                    let list = crate::device::list(false);
                    /* ★上次是**未启动的模拟器** ⇒ 本次启动不接管它（决策 #1380）：
                       否则 `auto_connect` 会把它 boot 起来 —— 就是"每次打开 Studio 都拉起模拟器"。 */
                    let last = match last {
                        Some(s) if s != "MIRROR-IPHONE" && !crate::device::sim_is_booted(&s)
                            && list.iter().any(|d| d.platform == "simulator" && d.serial == s) =>
                        {
                            eprintln!("[studio] 上次的模拟器 {s} 未启动：启动时跳过（点设备列表可启动）");
                            None
                        }
                        other => other,
                    };
                    let pick = last
                        .filter(|s| list.iter().any(|d| &d.serial == s))
                        .or_else(|| {
                            let ready: Vec<_> = list
                                .iter()
                                .filter(|d| d.platform == "android" && d.state == "device")
                                .collect();
                            (ready.len() == 1).then(|| ready[0].serial.clone())
                        })
                        .or_else(|| {
                            /* 只挑**已经在跑**的模拟器（决策 #1380：不再自动 boot） */
                            list.iter()
                                .find(|d| {
                                    d.platform == "simulator"
                                        && d.size.is_none()
                                        && d.state.eq_ignore_ascii_case("Booted")
                                })
                                .map(|d| d.serial.clone())
                        });
                    let Some(serial) = pick else {
                        eprintln!("[studio] 没有可自动连接的设备（列表里点一台即可）");
                        return;
                    };
                    eprintln!("[studio] 自动连接上次/唯一可用设备 → {serial}");
                    let _ = h4;
                    if let Err(e) = crate::auto_connect(&serial) {
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
                    if let Err(e) = crate::device::select(&udid) {
                        eprintln!("[sim] 自动切模拟器失败：{e}");
                        return;
                    }
                    match crate::capture_preset::request_sim(&udid) {
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
                    crate::ios_touch::ensure_listening(app.handle().clone(), port.saturating_add(1));
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
                    let _ = crate::settings::open_window(&h2);
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let dirty = crate::DIRTY_BUFFERS.load(std::sync::atomic::Ordering::Relaxed);
                if dirty > 0 && !crate::ALLOW_CLOSE.load(std::sync::atomic::Ordering::Relaxed) {
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
                unsafe { crate::poc_use_bundle_icon() };
            }
            /* ★退出时收掉常驻诊断进程（决策 #1418）：vue-tsc --watch 是我们 spawn 的，
               不 kill 会变成孤儿进程长期吃 CPU（每开一次 Studio 漏一个）。 */
            if matches!(event, tauri::RunEvent::Exit) {
                crate::diag::diag_watch_stop();
                crate::diag::diag_lsp_stop();
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
                    let rc = unsafe { crate::poc_attach(p as *mut c_void) };
                    crate::boot::boot_mark("webview 就绪 + 原生画布已挂载");
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
                                crate::poc_report(c.as_ptr());
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
                                let rc = crate::poc_dump(c.as_ptr());
                                eprintln!(
                                    "[studio] dump rc={rc} | aus={} restarts={} frames={} send_ok={} recv_ok={} ticks={} empty={}",
                                    crate::poc_live_aus(), crate::poc_live_restarts(), crate::poc_frames(), crate::poc_send_ok(), crate::poc_recv_ok(),
                                    crate::poc_ticks(), crate::poc_empty()
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
                crate::poc_tick();
            })
            .is_err()
            {
                break;
            }
        }
    });
}
