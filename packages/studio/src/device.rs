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
///
/// 【检测方式的选择（决策 #1276）】原来用 `xcrun xctrace list devices`（Instruments 的视角），
///   它要求 Xcode **能挂上去做性能采集**：本机 Xcode 14.2 面对 iOS 26 的设备直接标成 `Devices Offline`，
///   而同一台设备 `xcdevice` 报 `available: true`、`ideviceinfo` 也能正常读到型号。
///   ⇒ 用 `xcrun xcdevice list`（JSON，Xcode 自己的"可用性"判断），字段齐：
///     `platform`（iphoneos / iphonesimulator）、`available`、`ignored`、`interface`（usb/network）、
///     `reason`（不可用的原因）、`operatingSystemVersion`。
///   `xctrace` 只在 `xcdevice` 完全不可用时兜底。
/// 【必须带 DEVELOPER_DIR】取"验证过能用"的那套 Xcode（见 `xcode_developer_dir`）。
fn ios_devices(force: bool) -> Vec<(String, String, String, bool, String)> {
    /* ★缓存 30 秒（决策 #1276）：`xcdevice list` 实测 **6.8 秒**，
       面板每次刷新/每次切换设备都跑一次会让人以为"卡死了"。刷新按钮走 force。 */
    static CACHE: std::sync::Mutex<Option<(std::time::Instant, Vec<(String, String, String, bool, String)>)>> =
        std::sync::Mutex::new(None);
    if !force {
        if let Ok(g) = CACHE.lock() {
            if let Some((t, v)) = g.as_ref() {
                if t.elapsed().as_secs() < 30 {
                    return v.clone();
                }
            }
        }
    }
    let v = ios_devices_uncached();
    if let Ok(mut g) = CACHE.lock() {
        *g = Some((std::time::Instant::now(), v.clone()));
    }
    v
}

fn ios_devices_uncached() -> Vec<(String, String, String, bool, String)> {
    if let Some(dev) = xcode_developer_dir() {
        if let Some(list) = xcdevice_list(&dev) {
            let mut v = Vec::new();
            for item in list {
                // 只留**真机**：模拟器和本机 Mac 都被 platform 挡掉
                if item.get("simulator").and_then(|b| b.as_bool()) == Some(true) {
                    continue;
                }
                if item.get("platform").and_then(|p| p.as_str()) != Some("com.apple.platform.iphoneos") {
                    continue;
                }
                let Some(udid) = item.get("identifier").and_then(|x| x.as_str()) else { continue };
                let name = item.get("name").and_then(|x| x.as_str()).unwrap_or("iPhone");
                let os = item.get("operatingSystemVersion").and_then(|x| x.as_str()).unwrap_or("");
                let iface = item.get("interface").and_then(|x| x.as_str()).unwrap_or("");
                let available = item.get("available").and_then(|x| x.as_bool()).unwrap_or(false);
                let ignored = item.get("ignored").and_then(|x| x.as_bool()).unwrap_or(false);
                let reason = item.get("reason").and_then(|x| x.as_str()).unwrap_or("");
                let online = available && !ignored;
                let note = if online {
                    format!(
                        "{}{}连接 · 点它切到推流模式，然后在手机上运行 ProteusHost 开始直播",
                        if iface == "usb" { "USB " } else { "" },
                        if iface.is_empty() { "" } else { "" }
                    )
                } else if reason.is_empty() {
                    "不可用：解锁手机并点「信任此电脑」后重试".to_string()
                } else {
                    format!("不可用：{reason}")
                };
                v.push((name.to_string(), os.to_string(), udid.to_string(), online, note));
            }
            if !v.is_empty() {
                return v;
            }
        }
    }
    ios_devices_xctrace()
}

/// `xcrun xcdevice list`：Xcode 自己的设备可用性判断（JSON 数组）。
fn xcdevice_list(dev: &str) -> Option<Vec<serde_json::Value>> {
    let out = Command::new("/usr/bin/xcrun")
        .args(["xcdevice", "list"])
        .env("DEVELOPER_DIR", dev)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    v.as_array().cloned()
}

/// 兜底：`xctrace list devices`（Instruments 视角，版本敏感；只在 xcdevice 不可用时用）。
fn ios_devices_xctrace() -> Vec<(String, String, String, bool, String)> {
    let Some(dev_dir) = xcode_developer_dir() else { return Vec::new() };
    let mut c = Command::new("/usr/bin/xcrun");
    c.args(["xctrace", "list", "devices"]).env("DEVELOPER_DIR", dev_dir);
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
        if l.is_empty() || seen_sim || !l.contains('(') {
            continue;
        }
        let Some(close) = l.rfind(')') else { continue };
        let Some(open) = l[..close].rfind('(') else { continue };
        let udid = l[open + 1..close].trim().to_string();
        let head = l[..open].trim();
        let Some(close2) = head.rfind(')') else { continue };
        let Some(open2) = head[..close2].rfind('(') else { continue };
        let version = head[open2 + 1..close2].trim().to_string();
        let name = head[..open2].trim().to_string();
        if udid.matches('-').count() == 4 {
            continue; // 本机 Mac
        }
        let note = if online {
            "点它切到推流模式，然后在手机上运行 ProteusHost 开始直播".to_string()
        } else {
            "不可用：xctrace 认为它离线（Instruments 版本可能过旧，建议在设置里换成较新的 Xcode）".to_string()
        };
        v.push((name, version, udid, online, note));
    }
    v
}

/// 这套 Xcode 能不能列 iOS 设备？
/// ★**便宜地判断**：看 `Contents/Developer/usr/bin/xcdevice` 在不在 + 读 `Contents/version.plist` 的版本号。
///   原来用"真跑一次 `xcdevice list`"验证——**一次 6.8 秒**，两个候选就 14 秒，
///   面板会长时间空白、日志线程还没跑完就被杀（这就是那次"刷新还是离线"的真相之一）。
///   真正需要跑 `xcdevice` 的只有**最终那一次**列设备。
fn xcode_usable(app: &str) -> Option<String> {
    let dev = crate::settings::developer_dir(app);
    let bin = format!("{dev}/usr/bin/xcdevice");
    if !std::path::Path::new(&bin).exists() {
        return None;
    }
    let plist = std::fs::read_to_string(format!("{}/version.plist", app.trim_end_matches('/')))
        .unwrap_or_default();
    let ver = plist
        .split("CFBundleShortVersionString")
        .nth(1)
        .and_then(|t| t.split("<string>").nth(1))
        .and_then(|t| t.split("</string>").next())
        .map(|v| v.trim().to_string())
        .unwrap_or_else(|| "0".into());
    Some(ver)
}


/// 解析可用的 `DEVELOPER_DIR`：设置 → `xcode-select -p` → 自动探测（**按版本号取最高的可用那套**）。
/// 结果缓存；判断"可用"只看文件（见 `xcode_usable`），不跑命令 —— 跑一次 `xcdevice` 要 6.8 秒。
fn xcode_developer_dir() -> Option<String> {
    static CACHE: std::sync::Mutex<Option<Option<String>>> = std::sync::Mutex::new(None);
    if let Some(p) = crate::settings::current().path("ios.xcode") {
        if xcode_usable(p).is_some() {
            return Some(crate::settings::developer_dir(p));
        }
        eprintln!("[studio] 设置里的 Xcode 不可用（缺 xcdevice）：{p} ⇒ 回落到自动探测");
    }
    if let Ok(g) = CACHE.lock() {
        if let Some(v) = g.as_ref() {
            return v.clone();
        }
    }
    let mut best: Option<(u64, String)> = None;
    let mut consider = |app: &str| {
        if let Some(ver) = xcode_usable(app) {
            let score = version_score(&ver);
            if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
                best = Some((score, crate::settings::developer_dir(app)));
            }
        }
    };
    if let Ok(out) = Command::new("xcode-select").arg("-p").output() {
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if let Some(app) = p.strip_suffix("/Contents/Developer") {
            consider(app);
        }
    }
    for c in crate::settings::detect("ios.xcode") {
        consider(&c.path);
    }
    let found = best.map(|(_, d)| d);
    if let Ok(mut g) = CACHE.lock() {
        *g = Some(found.clone());
    }
    found
}

/// 版本号 → 可比较的分数（`14.2` → 140200；`26.5` → 260500）
fn version_score(v: &str) -> u64 {
    let mut it = v.split('.').map(|x| x.trim().parse::<u64>().unwrap_or(0));
    let major = it.next().unwrap_or(0);
    let minor = it.next().unwrap_or(0);
    let patch = it.next().unwrap_or(0);
    major * 10_000 + minor * 100 + patch
}

/// 列设备。`size` 只对 `state == device` 的查（离线/未授权的 adb shell 会挂）。
/// ★这是阻塞调用（每台 1~2 次 adb），必须从 `spawn_blocking` 里进。
pub fn list(force: bool) -> Vec<DeviceInfo> {
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
    for (name, version, udid, online, note) in ios_devices(force) {
        out.push(DeviceInfo {
            platform: "ios".into(),
            note,
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
    let devs = list(true);   /* 切换前要最新的可用状态 */
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
