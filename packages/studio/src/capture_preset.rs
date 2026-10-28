// capture_preset.rs —— 画质档位（决策 #1264 从 main.rs 拆出）
//
// 【为什么单独一个文件】main.rs 负责窗口/菜单/IPC 接线，已经顶到门禁的 1000 行红线。
//   这里只做一件事：**把用户选的档位翻成一条 screenrecord 命令**（改码率、不改分辨率），
//   并把它登记给原生侧重启采集会话。
use serde::Serialize;

use crate::{capture, poc_live_request_restart, ADB_SERIAL, DEVICE_PX};

/// 画质档位（决策 #1264 / #1265）：**分辨率不变，只改码率**。
/// - `low`：省流 4 Mbps —— 链路抖动/带宽紧张时才值得（本机 USB 下换不到帧率，实测迟到恒 0）
/// - `standard`：13 Mbps（默认）
/// ★原有的 `high`（20 Mbps）已撤掉：用户实测**肉眼无差异**，留着只是多一个看不出差别的状态。
/// ★分辨率两档都一样（长边 ≤1920 等比）——改码率不影响几何。
#[derive(Serialize)]
pub struct CaptureInfo {
    preset: String,
    width: u32,
    height: u32,
    mbps: u32,
}

fn live_capture_cmd(serial: Option<&str>, preset: &str) -> Result<(String, u32, u32, u32), String> {
    let (dw, dh) = DEVICE_PX
        .lock()
        .ok()
        .and_then(|g| *g)
        .ok_or("设备尺寸未知（没探测到 adb 设备？）")?;
    let (w, h) = capture::pick_capture_size(dw, dh).ok_or("设备尺寸过小，无法等比取尺寸")?;
    let br = match preset {
        "low" => 4_000_000,
        _ => 13_000_000,
    };
    let prefix = match serial {
        Some(s) => format!("adb -s {s} "),
        None => "adb ".to_string(),
    };
    Ok((
        format!("{prefix}exec-out screenrecord --output-format=h264 --size {w}x{h} --bit-rate {br} --time-limit 180 -"),
        w,
        h,
        br / 1_000_000,
    ))
}

/// 切换采集档位：**重启采集会话**（停旧 → 起新 → 重建解码器，全在原生侧一次做完）。
/// ★为什么要重启而不是"改个参数"：`screenrecord --size` 只在会话开始时生效，
///   换尺寸只能新开一条；而旧会话必须**立刻**停掉（`live_stop` 现在会杀进程组 + 设备侧 pkill）。
/// 当前档位（切换设备时要用**同一档**重建命令，不能悄悄回到默认）
static PRESET: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// 当前采集源类别（`ios` / `low` / `standard`；None = 还没切过，走启动时定下的那条）。
///
/// ★给界面判断"要不要显示 iPhone 引导卡"用（决策 #1277）。为什么不用 `POC_LIVE` 环境变量：
///   `request_ios()` **不写回环境变量**（只登记重启），所以切到 iPhone 之后 env 还是旧的 adb 命令。
pub fn current_kind() -> Option<String> {
    PRESET.lock().ok().and_then(|g| g.clone())
}

pub fn request_for_serial(serial: Option<&str>) -> Result<CaptureInfo, String> {
    let preset = PRESET
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .unwrap_or_else(|| "standard".to_string());
    request(&preset, serial)
}

fn request(preset: &str, serial: Option<&str>) -> Result<CaptureInfo, String> {
    let (cmd, w, h, mbps) = live_capture_cmd(serial, preset)?;
    let c = std::ffi::CString::new(cmd.clone()).map_err(|e| e.to_string())?;
    /* ★只登记，真正的重启在渲染线程下一拍做（不能在这里 free 解码器：poc_tick 正在用它） */
    unsafe { poc_live_request_restart(c.as_ptr()) };
    if let Ok(mut g) = PRESET.lock() {
        *g = Some(preset.to_string());
    }
    eprintln!("[studio]   采档位请求 → {preset}（{w}x{h} · {mbps} Mbps）");
    Ok(CaptureInfo {
        preset: preset.to_string(),
        width: w,
        height: h,
        mbps,
    })
}

/// 切到 iOS 采集源（决策 #1274）：手机端 ProteusHost 推流 → 本机 `nc -l <端口>` 收。
/// ★尺寸/码率此刻未知（要等第一帧的 SPS），所以 width/height 返回 0，界面显示「—」。
pub fn request_ios() -> Result<CaptureInfo, String> {
    let port = crate::settings::current().ios_port.unwrap_or(9001);
    /* ★先清场再重启（决策 #1277）：macOS 允许多个 `nc -l` 同时 LISTEN 同一端口，
       残留的旧监听会让手机的连接落到"没人读管道"的那个上 ⇒ 永远黑屏且零报错。 */
    crate::live_source::kill_stale_listeners(port);
    let cmd = format!("/usr/bin/nc -l {port}");
    let c = std::ffi::CString::new(cmd.clone()).map_err(|e| e.to_string())?;
    unsafe { poc_live_request_restart(c.as_ptr()) };
    if let Ok(mut g) = PRESET.lock() {
        *g = Some("ios".into());
    }
    eprintln!("[studio]   采集源 → iOS 推流（{cmd}）");
    Ok(CaptureInfo {
        preset: "ios".into(),
        width: 0,
        height: 0,
        mbps: 0,
    })
}

/// 当前模拟器的 UDID（触控注入用；`request_sim` 设置）
static SIM_UDID: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// 切到 **iOS 模拟器**（决策 #1302）：画面 = SCK 抓窗口 → ffmpeg 转 H.264 → 现有解码管线。
///
/// 【为什么走"窗口捕获 + 转码"而不是接一条新渲染路径】
///   我们的 live 源本来就是一个**吐出 H.264 裸流的命令**。把
///   `window-cast（JPEG 流）| ffmpeg（mjpeg→h264）` 拼成同一个命令，
///   解码/上屏/断流判定**全部复用**，零改动。代价是多一次编解码（450px 宽，实测可接受）。
pub fn sim_pipeline_cmd(udid: &str) -> Result<(String, u32, u32, u32, u32), String> {
    let (cast, _hid) = crate::live_source::sim_tools()?;
    /* 等窗口（决策 #1309）：冷启动时窗口要几秒才出现，手动点击也走这条路 */
    let (win, win_w, win_h) = crate::live_source::sim_window_wait(&cast, 12_000)?;
    let ff = crate::live_source::ffmpeg_bin();
    const OUT_W: u32 = 896;
    let crop = crate::live_source::sim_crop_rect(win_w, win_h, OUT_W);
    let crop_filter = match crop {
        Some((x, y, w, h)) => format!("crop={w}:{h}:{x}:{y},"),
        None => {
            eprintln!(
                "[studio] ⚠ 模拟器窗口 {win_w}x{win_h} 没有裁剪标定 ⇒ 画面会带标题栏 \
                 （跑 `node scripts/calibrate-sim-crop.mjs --udid <UDID>` 生成）"
            );
            String::new()
        }
    };
    let cmd = format!(
        "'{cast}' --window {win} --fps 24 --width {OUT_W} --quality 0.9 --device-aspect 0 2>/dev/null | \
         '{ff}' -hide_banner -loglevel error -f image2pipe -c:v mjpeg -i - \
         -vf \"{crop_filter}scale=trunc(iw/2)*2:trunc(ih/2)*2,setrange=limited\" \
         -c:v libx264 -preset ultrafast -tune zerolatency -crf 20 \
         -pix_fmt yuv420p -g 30 -f h264 -"
    );
    /* ★**不再调 `simctl io screenshot` 取设备尺寸**（决策 #1310 的真凶）：
       模拟器刚 boot 时这个命令会**阻塞等设备就绪**（实测卡住 20s+ 无输出），
       而它取的只是"界面显示用的物理尺寸"——我们注入用的是**归一化坐标**，根本不需要它。
       ⇒ 少一次 simctl 调用，也少一个能把启动流程卡死的点。 */
    let (dw, dh) = (0u32, 0u32);
    let _ = udid;
    Ok((cmd, win, dw, dh, win_w))
}

pub fn request_sim(udid: &str) -> Result<CaptureInfo, String> {
    let (cmd, win, dw, dh, _win_w) = sim_pipeline_cmd(udid)?;
    eprintln!("[studio]   模拟器管道 → {cmd}");
    let c = std::ffi::CString::new(cmd.clone()).map_err(|e| e.to_string())?;
    unsafe { poc_live_request_restart(c.as_ptr()) };
    if let Ok(mut g) = PRESET.lock() {
        *g = Some("sim".into());
    }
    if let Ok(mut g) = SIM_UDID.lock() {
        *g = Some(udid.to_string());
    }
    if let Ok(mut g) = crate::DEVICE_PX.lock() {
        *g = if dw > 0 { Some((dw, dh)) } else { None };
    }
    eprintln!("[studio]   采集源 → iOS 模拟器 {udid}（窗口 {win} · {dw}x{dh}）");
    Ok(CaptureInfo {
        preset: "sim".into(),
        width: dw,
        height: dh,
        mbps: 0,
    })
}

/// 切到 **iPhone 镜像**（决策 #1316）：真机整屏，走 SCK 抓系统镜像窗口。
///
/// 【为什么不需要裁剪】这个窗口里**只有设备画面**（没有标题栏/边框）：
///   实测窗口 316x696 → 抓帧 600x1321，比例 0.454 ≈ 316/696，与设备一致。
/// 【为什么不需要设置权限】它和模拟器一样依赖"屏幕录制"（已有）。
pub fn request_mirror() -> Result<CaptureInfo, String> {
    let (cast, _hid) = crate::live_source::sim_tools()?;
    let (win, w, h) = crate::live_source::mirror_window(&cast)?;
    let ff = crate::live_source::ffmpeg_bin();
    /* 宽度取 640：窗口原生是 632（316×2 retina），再大只是插值放大 */
    let cmd = format!(
        /* ★**不能**把 cast 的 stderr 丢进 /dev/null（决策 #1322）：抓流失败时它会说明原因
           （权限/窗口不可抓/被遮挡…），丢了就只能看到"参数集 0 字节"这种无信息的现象。
           落盘到日志目录，排障时直接看。 */
        "'{cast}' --window {win} --fps 30 --width 640 --quality 0.9 --device-aspect 0 2>>\"$HOME/Library/Logs/Proteus Studio/cast.err\" | \
         '{ff}' -hide_banner -loglevel error -f image2pipe -c:v mjpeg -i - \
         -vf \"scale=trunc(iw/2)*2:trunc(ih/2)*2,setrange=limited\" \
         -c:v libx264 -preset ultrafast -tune zerolatency -crf 20 \
         -pix_fmt yuv420p -g 30 -f h264 -"
    );
    eprintln!("[studio]   镜像管道 → {cmd}");
    /* ★**启动路径必须同时写 `POC_LIVE`**（决策 #1316 的坑）：
       `poc_live_request_restart()` 只是"下一拍重启"，而原生 attach 时读的是**环境变量**；
       不写的话启动阶段会退回内置示例（日志表现为"打开失败：/tmp/proteus-poc/720p30.mp4"）。 */
    std::env::set_var("POC_LIVE", &cmd);
    let c = std::ffi::CString::new(cmd.clone()).map_err(|e| e.to_string())?;
    unsafe { poc_live_request_restart(c.as_ptr()) };
    if let Ok(mut g) = PRESET.lock() {
        *g = Some("mirror".into());
    }
    if let Ok(mut g) = SIM_UDID.lock() {
        *g = None;
    }
    crate::live_source::set_mirror_window(win, w, h);
    /* 摆到右下角：它必须留在屏幕上（HID 才点得到），但不必占主工作区 */
    crate::live_source::place_mirror_window(win);
    if let Ok(mut g) = crate::DEVICE_PX.lock() {
        *g = Some((w * 2, h * 2)); // 窗口是 point，实际像素 2x（retina）
    }
    eprintln!("[studio]   采集源 → iPhone 镜像（窗口 {win} · {w}x{h}）");
    Ok(CaptureInfo {
        preset: "mirror".into(),
        width: w * 2,
        height: h * 2,
        mbps: 0,
    })
}

/// 启动路径用：登记当前模拟器（`POC_LIVE` 由 init 直接设，不走 request_sim）
pub fn set_sim_udid(udid: &str) {
    if let Ok(mut g) = SIM_UDID.lock() {
        *g = Some(udid.to_string());
    }
}

/// 当前是不是模拟器源（触控分派用）
pub fn sim_udid() -> Option<String> {
    SIM_UDID.lock().ok().and_then(|g| g.clone())
}

pub fn capture_preset(preset: String) -> Result<CaptureInfo, String> {
    let serial = ADB_SERIAL.lock().ok().and_then(|g| g.clone());
    if serial.is_none() {
        return Err("当前画面源不支持切换画质（只有 Android / adb 实时投屏可以）".into());
    }
    request(&preset, serial.as_deref())
}
