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

/// **当前选中的设备串号**（任意平台）。
///
/// ★为什么不能再用 `ADB_SERIAL`（决策 #1314）：那个只在安卓分支被设置，
///   于是**只有安卓能显示选中态**，切到 iOS/模拟器后高亮还留在安卓那行（用户实测）。
pub static CURRENT_SERIAL: Mutex<Option<String>> = Mutex::new(None);

pub fn current_serial() -> Option<String> {
    if let Ok(g) = CURRENT_SERIAL.lock() {
        if let Some(s) = g.as_ref() {
            return Some(s.clone());
        }
    }
    /* 启动早期还没 select 过时，用 adb 探测到的那台兜底 */
    ADB_SERIAL.lock().ok().and_then(|g| g.clone())
}

/// 记下"当前设备"（`select()` 成功后调用）
fn set_current(serial: &str) {
    if let Ok(mut g) = CURRENT_SERIAL.lock() {
        *g = Some(serial.to_string());
    }
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
pub(crate) fn xcode_developer_dir() -> Option<String> {
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

/// 列出**可用的 iOS 模拟器**（决策 #1302）。
///
/// ★用 `simctl list devices available` 的**文本**输出而不是 `--json`：
///   我们只要 "名字 + UDID + 是否 Booted" 三样，文本行更稳（JSON 结构随 Xcode 版本变过）。
///   行格式：`    iPhone 17 Pro (F977AC99-…) (Booted)`。
fn simulators() -> Vec<DeviceInfo> {
    /* ★必须带 DEVELOPER_DIR（决策 #1302）：GUI 应用的 PATH/环境里没有它，
       `xcrun simctl` 会静默失败 ⇒ 列表为空 ⇒ 用户看到"没有模拟器"。
       复用 `xcode_developer_dir()`（设置 → xcode-select → 自动探测，已验证可用）。 */
    /* ★simctl 必须**逐个候选真跑一次**（决策 #1302）：
       `xcode-select -p` 在本机指向 CommandLineTools（**没有 simctl**），
       而 `xcode_developer_dir()` 是按"xcdevice 可用 + 版本最高"挑的——两套判据不同。
       仓里早有同族教训（#1275）：**路径存在 ≠ 工具可用**。 */
    let out = match simctl_source() {
        Some(o) => o,
        None => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut cur_runtime = String::new();
    let mut v = Vec::new();
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with("--") && t.ends_with("--") {
            // `-- iOS 26.5 --`
            cur_runtime = t.trim_matches('-').trim().to_string();
            continue;
        }
        // `iPhone 17 Pro (UDID) (Booted)` / `(Shutdown)`
        let Some(open) = t.rfind('(') else { continue };
        let state = t[open + 1..].trim_end_matches(')').trim().to_string();
        let head = &t[..open];
        let Some(open2) = head.rfind('(') else { continue };
        /* ★顺序要紧（决策 #1302）：`(UDID) (Booted)` 里 UDID 后面先有 `)` 再有空格，
           写成 `trim_end_matches(')')` 在前 ⇒ 最后的字符是空格，括号**去不掉**
           ⇒ serial 带尾巴 `)` ⇒ `select()` 永远"不在列表里"（实测踩到）。 */
        let udid = head[open2 + 1..].trim().trim_end_matches(')').trim().to_string();
        let name = head[..open2].trim().to_string();
        if udid.len() < 30 || !udid.contains('-') {
            continue;
        }
        let booted = state.eq_ignore_ascii_case("Booted");
        v.push(DeviceInfo {
            platform: "simulator".into(),
            // ★未启动的也能点（select 会先 boot）⇒ 这里一律报 device，把"未启动"写在 size 里
            note: if booted { String::new() } else { "未启动（点它会先启动模拟器）".into() },
            current: false,
            serial: udid,
            state: "device".into(),
            model: format!("{name} · {cur_runtime}"),
            size: if booted { None } else { Some("未启动".into()) },
        });
    }
    v
}

/// 命中的那个 DEVELOPER_DIR（`simctl_developer_dir()` 用）
static CACHE_DEV: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// 找一个**真的能跑 `simctl list devices`** 的 DEVELOPER_DIR（带缓存）。
///
/// 候选顺序：设置里的 iOS Xcode → `xcode_developer_dir()` → `detect()` 扫到的全部 →
/// `xcode-select -p`。用"输出里有 iPhone"当判据（而不是"目录存在"）。
pub(crate) fn simctl_developer_dir() -> Option<String> {
    simctl_source().map(|_| {
        CACHE_DEV
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .unwrap_or_default()
    })
}

fn simctl_source() -> Option<std::process::Output> {
    let mut cands: Vec<String> = Vec::new();
    if let Some(p) = crate::settings::current().path("ios.xcode") {
        cands.push(crate::settings::developer_dir(&p));
    }
    if let Some(d) = xcode_developer_dir() {
        cands.push(d);
    }
    for c in crate::settings::detect("ios.xcode") {
        cands.push(crate::settings::developer_dir(&c.path));
    }
    if let Ok(out) = Command::new("xcode-select").arg("-p").output() {
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !p.is_empty() {
            cands.push(p);
        }
    }
    cands.dedup();

    let try_one = |dev: &str| -> Option<std::process::Output> {
        let o = Command::new("/usr/bin/xcrun")
            .args(["simctl", "list", "devices", "available"])
            .env("DEVELOPER_DIR", dev)
            .output()
            .ok()?;
        if o.status.success() && String::from_utf8_lossy(&o.stdout).contains("iPhone") {
            Some(o)
        } else {
            None
        }
    };
    // 先看缓存（缓存的是 DEVELOPER_DIR，命中就直接再跑一次——simctl 输出是动态的）
    if let Ok(g) = CACHE_DEV.lock() {
        if let Some(dev) = g.as_ref() {
            if let Some(o) = try_one(dev) {
                return Some(o);
            }
        }
    }
    for d in cands {
        if let Some(o) = try_one(&d) {
            if let Ok(mut g) = CACHE_DEV.lock() {
                *g = Some(d.clone());
            }
            eprintln!("[studio] 模拟器用 Xcode：{d}");
            return Some(o);
        }
    }
    eprintln!("[studio] 找不到能跑 simctl 的 Xcode ⇒ 设备列表不显示模拟器");
    None
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
    // ── iPhone 镜像（真机整屏；macOS 独占，决策 #1316）──
    if let Some(mut d) = mirror_device() {
        d.current = cur.as_deref() == Some(d.serial.as_str());
        out.push(d);
    }

    // ── iOS 模拟器（simctl；与真机并列，决策 #1302）──
    out.extend(simulators().into_iter().map(|mut d| {
        d.current = cur.as_deref() == Some(d.serial.as_str());
        d
    }));

    out
}

/// **iPhone 镜像** 这一"台"（决策 #1316）：macOS 15+ 的系统功能，看见的是**真机整屏**。
///
/// 它不是真机设备列表里的一台（没有 UDID 可枚举），而是一个**系统窗口**；
/// 但对用户来说它确实是"另一块能看的真机屏幕"，所以在列表里给它一行。
fn mirror_device() -> Option<DeviceInfo> {
    /* ★优先用**缓存的**窗口信息（决策 #1320）：`--list` 在 Studio 里偶发阻塞，
       一超时就当成"没窗口" ⇒ 列表那行消失（画面却还在投）。缓存 30s 内直接用。 */
    let (_, w, h) = match crate::live_source::mirror_cached(30_000) {
        Some(v) => v,
        None => {
            let cast = crate::live_source::sim_tools().ok()?.0;
            let (_, w, h) = crate::live_source::mirror_window(&cast).ok()?;
            crate::live_source::set_mirror_window(0, w, h); // 只记尺寸，id 交给下一次 request_mirror
            (0, w, h)
        }
    };
    Some(DeviceInfo {
        platform: "mirror".into(),
        note: "真机整屏（手机需锁屏；一解锁镜像就断）".into(),
        current: false,
        serial: "MIRROR-IPHONE".into(),
        state: "device".into(),
        model: "iPhone（镜像）".into(),
        size: Some(format!("{}x{}", w * 2, h * 2)),
    })
}

/// 自动挑一台模拟器（决策 #1307）：**上次用过的**优先，否则任一**已启动**的。
///
/// 只在"没有 adb 设备"的兜底路径里用——那时用户最可能的意图就是"看模拟器"。
/// 所有可用模拟器的串号（判断"上次那台是不是模拟器"用）
pub(crate) fn sim_serials() -> Vec<String> {
    simulators().into_iter().map(|d| d.serial).collect()
}

pub(crate) fn auto_simulator() -> Option<String> {
    let sims = simulators();
    /* ★上次那台**即使没启动**也要用（决策 #1308）：实测踩到——用户上次看的是 iPhone 17 Pro，
       后来模拟器被 Shutdown 了，而这里只看"已启动"的 ⇒ 一台都没有 ⇒ 退回"干等 iPhone 推流"
       ⇒ 画布永远"等待首帧"。体验上应该是"我帮你把上次那台拉起来"。 */
    if let Some(last) = crate::settings::current().last_device {
        if sims.iter().any(|d| d.serial == last) {
            return Some(last);
        }
    }
    sims.iter()
        .find(|d| d.size.is_none())
        .map(|d| d.serial.clone())
        .or_else(|| sims.first().map(|d| d.serial.clone()))
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
    if serial == "MIRROR-IPHONE" {
        /* ★镜像不依赖 `list()`（决策 #1320）：`--list` 偶发超时会让列表里暂时没有它，
           而"选它"本身只需要一个指令 —— 不该因此报"不在列表里"。 */
        set_current(serial);
        if let Ok(mut g) = ADB_SERIAL.lock() {
            *g = None;
        }
        TOUCH_ANDROID.store(false, std::sync::atomic::Ordering::Relaxed);
        eprintln!("[studio] 切换设备 → iPhone 镜像（真机整屏）");
        return Ok("mirror".into());
    }
    if d.platform == "mirror" {
        set_current(serial);
        if let Ok(mut g) = ADB_SERIAL.lock() {
            *g = None;
        }
        TOUCH_ANDROID.store(false, std::sync::atomic::Ordering::Relaxed);
        eprintln!("[studio] 切换设备 → iPhone 镜像（真机整屏）");
        return Ok("mirror".into());
    }
    if d.platform == "simulator" {
        /* 模拟器：boot 是幂等的（已启动会返回错误，忽略即可）；窗口没开会话就没画面 */
        let _ = std::process::Command::new("/usr/bin/xcrun")
            .args(["simctl", "boot", serial])
            .output();
        let _ = std::process::Command::new("/usr/bin/open")
            .args(["-a", "Simulator"])
            .output();
        if let Ok(mut g) = ADB_SERIAL.lock() {
            *g = None;
        }
        TOUCH_ANDROID.store(false, std::sync::atomic::Ordering::Relaxed);
        set_current(serial);
        eprintln!("[studio] 切换设备 → iOS 模拟器 {}（{}）", d.model, serial);
        return Ok("sim".into());
    }
    set_current(serial);
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
