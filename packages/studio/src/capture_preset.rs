// capture_preset.rs —— 画质档位（决策 #1264 从 main.rs 拆出）
//
// 【为什么单独一个文件】main.rs 负责窗口/菜单/IPC 接线，已经顶到门禁的 1000 行红线。
//   这里只做一件事：**把用户选的档位翻成一条 screenrecord 命令**（改码率、不改分辨率），
//   并把它登记给原生侧重启采集会话。
use serde::Serialize;

use crate::{capture, poc_live_request_restart, ADB_SERIAL, DEVICE_PX};

/// 画质档位（决策 #1264，用户纠正：要的是**同分辨率下的清晰度**，不是切分辨率）。
/// - `low`：省流 4 Mbps —— 链路抖动/带宽紧张时才值得（本机 USB 下换不到帧率，实测迟到恒 0）
/// - `standard`：13 Mbps（默认，按像素数算）
/// - `high`：20 Mbps —— 细节多（照片/视频/密集小字）时压缩痕迹更少
/// ★分辨率**三档都一样**（长边 ≤1920 等比）：改码率只影响量化/链路占用，不影响几何。
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
    let (w, h) = if preset == "sharp" {
        /* 原生：不缩放，只把两轴取偶（H.264 4:2:0 要求，见 capture.rs 的注释） */
        (capture::round_even(dw as f64), capture::round_even(dh as f64))
    } else {
        capture::pick_capture_size(dw, dh).ok_or("设备尺寸过小，无法等比取尺寸")?
    };
    /* 码率：按档位给；`sharp`（原生分辨率）仍按像素数算，供后续再暴露 */
    let br = match preset {
        "low" => 4_000_000,
        "high" => 20_000_000,
        "sharp" => capture::bitrate_for(w, h),
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
pub fn capture_preset(preset: String) -> Result<CaptureInfo, String> {
    let serial = ADB_SERIAL.lock().ok().and_then(|g| g.clone());
    if serial.is_none() {
        return Err("当前画面源不支持切换分辨率（只有 Android / adb 实时投屏可以）".into());
    }
    let (cmd, w, h, mbps) = live_capture_cmd(serial.as_deref(), &preset)?;
    let c = std::ffi::CString::new(cmd.clone()).map_err(|e| e.to_string())?;
    /* ★只登记，真正的重启在渲染线程下一拍做（不能在这里 free 解码器：poc_tick 正在用它） */
    unsafe { poc_live_request_restart(c.as_ptr()) };
    eprintln!("[studio]   采档位请求 → {preset}（{w}x{h} · {mbps} Mbps）");
    Ok(CaptureInfo { preset, width: w, height: h, mbps })
}
