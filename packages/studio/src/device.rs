// device.rs —— 设备枚举与切换（决策 #1265：画布升级为设备管理）
//
// 【为什么需要这个模块】这块原来有 **四个单设备假设**，多一台设备就露馅：
//   ① 采集命令 `adb exec-out ...` **不带 -s** ⇒ 多设备直接报 "more than one device"
//   ② `adb shell wm size` 不带 -s ⇒ 可能量到**另一台**的尺寸 ⇒ 画面比例错
//   ③ `device_label()` 用 `OnceLock` 缓存 ⇒ 切了设备，侧栏机型还是旧的
//   ④ `first_adb_serial()` 静默取"第一台" ⇒ 用户根本不知道在投哪台
//   ⇒ 所有 adb 调用统一走本模块的 `adb(serial, ...)`，串号只有一个来源（`ADB_SERIAL`）。
use std::process::Command;
use std::sync::Mutex;

use serde::Serialize;

use crate::{capture, ADB_SERIAL, DEVICE_PX, TOUCH_ANDROID};

/// 一台设备在界面上的全部信息。`size` 是**物理**像素（`wm size`），不是码流尺寸。
#[derive(Serialize, Clone)]
pub struct DeviceInfo {
    pub serial: String,
    /// `device` / `offline` / `unauthorized` ……（adb 原样上报，不翻译）
    pub state: String,
    pub model: String,
    pub size: Option<String>,
    pub current: bool,
}

/// 带串号的 adb 调用。**串号为 None 只在"列出设备"这种全局命令上允许**。
pub fn adb(serial: Option<&str>, args: &[&str]) -> Option<String> {
    /* ★二进制路径来自设置（决策 #1266）：不写死 "adb"，也不假设它在哪个 PATH 里 */
    let mut c = Command::new(crate::settings::adb_bin());
    if let Some(s) = serial {
        c.args(["-s", s]);
    }
    let out = c.args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

pub fn probe_size(serial: Option<&str>) -> Option<(u32, u32)> {
    adb(serial, &["shell", "wm", "size"]).and_then(|s| capture::parse_wm_size(&s))
}

pub fn current_serial() -> Option<String> {
    ADB_SERIAL.lock().ok().and_then(|g| g.clone())
}

/// 机型 + 屏幕尺寸的展示串（侧栏"机型"那一行）。
/// ★缓存**按串号**存，切换设备即失效 —— 原来用 `OnceLock` 会一直显示上一台。
pub fn label(serial: Option<&str>) -> Option<String> {
    static CACHE: Mutex<Option<(String, String)>> = Mutex::new(None);
    let key = serial.unwrap_or("").to_string();
    if let Ok(g) = CACHE.lock() {
        if let Some((k, v)) = g.as_ref() {
            if *k == key {
                return Some(v.clone());
            }
        }
    }
    let model = adb(serial, &["shell", "getprop", "ro.product.model"])?;
    let out = match probe_size(serial) {
        Some((w, h)) => format!("{model} · {w}x{h}"),
        None => model,
    };
    if let Ok(mut g) = CACHE.lock() {
        *g = Some((key, out.clone()));
    }
    Some(out)
}

/// 解析 `adb devices -l`：`serial state usb:... product:... model:... device:...`
fn parse_devices(raw: &str) -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    for line in raw.lines().skip(1) {
        let mut it = line.split_whitespace();
        let (Some(serial), Some(state)) = (it.next(), it.next()) else {
            continue;
        };
        let mut model = String::new();
        for tok in it {
            if let Some(v) = tok.strip_prefix("model:") {
                model = v.to_string();
            }
        }
        out.push((serial.to_string(), state.to_string(), model));
    }
    out
}

/// 列设备。`size` 只对 `state == device` 的查（离线/未授权的 adb shell 会挂）。
/// ★这是阻塞调用（每台 1~2 次 adb），必须从 `spawn_blocking` 里进。
pub fn list() -> Vec<DeviceInfo> {
    let Some(raw) = adb(None, &["devices", "-l"]) else {
        return Vec::new();
    };
    let cur = current_serial();
    parse_devices(&raw)
        .into_iter()
        .map(|(serial, state, model)| {
            let size = if state == "device" {
                probe_size(Some(&serial)).map(|(w, h)| format!("{w}x{h}"))
            } else {
                None
            };
            DeviceInfo {
                current: cur.as_deref() == Some(serial.as_str()),
                serial,
                state,
                model: if model.is_empty() { "—".into() } else { model },
                size,
            }
        })
        .collect()
}

/// 切换当前设备：改三处全局状态（串号 / 物理尺寸 / 可否注入）。
/// ★机型缓存**按串号**存，切过去自然 miss ⇒ 不需要显式清（原来 `OnceLock` 才需要，那是它的错）。
/// ★采集会话的重启由调用方（`capture_preset::request_for_serial`）负责——
///   本模块只管"当前是哪台"，不管"画面怎么来"。
pub fn select(serial: &str) -> Result<(), String> {
    let raw = adb(None, &["devices", "-l"]).ok_or("adb devices 失败")?;
    let found = parse_devices(&raw)
        .into_iter()
        .find(|(s, _, _)| s == serial);
    let Some((_, state, _)) = found else {
        return Err(format!("设备 {serial} 不在列表里（插好了？）"));
    };
    if state != "device" {
        return Err(format!("设备 {serial} 当前状态是 {state}，不能投屏（要先授权/唤醒）"));
    }
    let (w, h) = probe_size(Some(serial)).ok_or_else(|| format!("设备 {serial} 拿不到尺寸（wm size 失败）"))?;
    if let Ok(mut g) = ADB_SERIAL.lock() {
        *g = Some(serial.to_string());
    }
    if let Ok(mut g) = DEVICE_PX.lock() {
        *g = Some((w, h));
    }
    TOUCH_ANDROID.store(true, std::sync::atomic::Ordering::Relaxed);
    eprintln!("[studio] 切换设备 → {serial}（{w}x{h}）");
    Ok(())
}
