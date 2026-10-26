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
    /// `android` / `ios` —— 列表按平台分组渲染（决策 #1274）
    pub platform: String,
    /// 界面上的一行提示（iOS：要手机端跑 ProteusHost 才有画面）
    pub note: String,
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

/// 枚举 iOS 设备。
/// 【为什么用 `xcrun xctrace list devices`】它和 Xcode 的 Devices 窗口**同源**，
///   能看到**已配对但离线**的设备（`== Devices Offline ==`）——那正是"我明明连着"的错觉来源。
///   `idevice_id -l` 只列当前 USB 在线的，看不到离线。
/// 【必须带 DEVELOPER_DIR】用配置里的 Xcode（决策 #1266/#1268），否则 xcrun 找不到工具。
fn ios_devices() -> Vec<(String, String, String, bool)> {
    /* ★Xcode 路径按三级回落（决策 #1275）：设置里填的 → `xcode-select -p` → 自动探测。
       只认设置的话，**没配过的人会永远看不到 iOS 设备**（而这正是"我明明连着"的另一半原因：
       `xcrun` 找不到 xctrace 时是**静默失败**的，不是报错）。 */
    let dev_dir = xcode_developer_dir();
    let mut c = Command::new("/usr/bin/xcrun");
    c.args(["xctrace", "list", "devices"]);
    if let Some(d) = dev_dir {
        c.env("DEVELOPER_DIR", d);
    }
    let Ok(out) = c.output() else { return Vec::new() };
    if !out.status.success() {
        return Vec::new();
    }
    let mut online = false;
    let mut seen_sim = false;
    let mut v = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let l = line.trim();
        if l.starts_with("==") {
            online = l.contains("== Devices ==");
            seen_sim = l.contains("Simulators");
            continue;
        }
        if l.is_empty() || seen_sim || !online && !l.contains('(') {
            continue;
        }
        if l.contains("Simulator") {
            continue;
        }
        // `名字 (版本) (UDID)`；名字里也可能带括号 ⇒ 从右往左取两段
        let Some(close) = l.rfind(')') else { continue };
        let Some(open) = l[..close].rfind('(') else { continue };
        let udid = l[open + 1..close].trim().to_string();
        let head = l[..open].trim();
        let Some(close2) = head.rfind(')') else { continue };
        let Some(open2) = head[..close2].rfind('(') else { continue };
        let version = head[open2 + 1..close2].trim().to_string();
        let name = head[..open2].trim().to_string();
        // ★跳过本机 Mac：它的"UDID"是标准 UUID（8-4-4-4-12，4 个连字符）；
        //   iPhone 的新格式是 `00008101-001938AC1A68801E`（只有 1 个连字符）。
        if udid.matches('-').count() == 4 {
            continue;
        }
        v.push((name, version, udid, online));
    }
    v
}

/// 这个 `DEVELOPER_DIR` 到底能不能列 iOS 设备？
/// ★不能只看"路径存在"：本机有两套 Xcode，其中 14.2 那套跑 `xctrace list devices` **输出为空**，
///   而 26.5 那套正常。按"第一个候选"取会稳定挑到坏的那套 ⇒ **必须真跑一次看结果**。
fn xctrace_works(dev: &str) -> bool {
    Command::new("/usr/bin/xcrun")
        .args(["xctrace", "list", "devices"])
        .env("DEVELOPER_DIR", dev)
        .output()
        .map(|o| o.status.success() && !o.stdout.is_empty())
        .unwrap_or(false)
}

/// 解析可用的 `DEVELOPER_DIR`：设置 → `xcode-select -p` → 自动探测（逐个验，取第一个真的能用的）。
/// 结果**缓存**：每次 `list()` 都跑 xcrun 太贵（一次 ~1s）。
fn xcode_developer_dir() -> Option<String> {
    if let Some(p) = crate::settings::current().path("ios.xcode") {
        let d = crate::settings::developer_dir(p);
        if xctrace_works(&d) {
            return Some(d);
        }
        // 设置里填的那套不能用 ⇒ 继续往下找，但要在界面上说得清（见 DeviceSwitcher 的提示）
        eprintln!("[studio] 设置里的 Xcode 无法列设备：{d} ⇒ 回落到自动探测");
    }
    static CACHE: std::sync::Mutex<Option<Option<String>>> = std::sync::Mutex::new(None);
    if let Ok(g) = CACHE.lock() {
        if let Some(v) = g.as_ref() {
            return v.clone();
        }
    }
    let mut found: Option<String> = None;
    if let Ok(out) = Command::new("xcode-select").arg("-p").output() {
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if p.contains(".app/Contents/Developer") && xctrace_works(&p) {
            found = Some(p);
        }
    }
    if found.is_none() {
        for c in crate::settings::detect("ios.xcode") {
            let d = crate::settings::developer_dir(&c.path);
            if xctrace_works(&d) {
                found = Some(d);
                break;
            }
        }
    }
    if let Ok(mut g) = CACHE.lock() {
        *g = Some(found.clone());
    }
    found
}

/// 列设备。`size` 只对 `state == device` 的查（离线/未授权的 adb shell 会挂）。
/// ★这是阻塞调用（每台 1~2 次 adb），必须从 `spawn_blocking` 里进。
pub fn list() -> Vec<DeviceInfo> {
    let cur = current_serial();
    let mut out: Vec<DeviceInfo> = Vec::new();

    // ── Android（adb）──
    if let Some(raw) = adb(None, &["devices", "-l"]) {
        out.extend(parse_devices(&raw).into_iter().map(|(serial, state, model)| {
            let size = if state == "device" {
                probe_size(Some(&serial)).map(|(w, h)| format!("{w}x{h}"))
            } else {
                None
            };
            DeviceInfo {
                platform: "android".into(),
                note: String::new(),
                current: cur.as_deref() == Some(serial.as_str()),
                serial,
                state,
                model: if model.is_empty() { "—".into() } else { model },
                size,
            }
        }));
    }

    // ── iOS（xctrace；能列到"已配对但离线"的设备）──
    for (name, version, udid, online) in ios_devices() {
        out.push(DeviceInfo {
            platform: "ios".into(),
            note: if online {
                "在手机上运行 ProteusHost 并开始直播后出画面（触控回传暂不支持）".into()
            } else {
                "离线：用 USB 连接并在手机上点「信任此电脑」".into()
            },
            current: cur.as_deref() == Some(udid.as_str()),
            serial: udid,
            state: if online { "device".into() } else { "offline".into() },
            model: format!("{name} · iOS {version}"),
            size: None,
        });
    }
    out
}

/// 切换当前设备：返回平台名（`android` / `ios`），调用方据此决定**采集源**。
/// ★iOS 这条腿没有 adb 串号：采集是手机推流（`nc -l`），注入本版不支持 ⇒ 关掉触控。
pub fn select(serial: &str) -> Result<String, String> {
    let devs = list();
    let d = devs
        .iter()
        .find(|d| d.serial == serial)
        .ok_or_else(|| format!("设备 {serial} 不在列表里（插好了？）"))?;
    if d.state != "device" {
        return Err(format!("{} 当前是 {}，不能投屏：{}", d.model, d.state, d.note));
    }
    if d.platform == "ios" {
        if let Ok(mut g) = ADB_SERIAL.lock() {
            *g = None;
        }
        if let Ok(mut g) = DEVICE_PX.lock() {
            *g = None;
        }
        TOUCH_ANDROID.store(false, std::sync::atomic::Ordering::Relaxed);
        eprintln!("[studio] 切换设备 → iOS {}（采集改为 nc 收推流）", d.model);
        return Ok("ios".into());
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
    Ok("android".into())
}
