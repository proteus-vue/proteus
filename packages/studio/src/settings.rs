// settings.rs —— 开发环境：按**端**分组的工具路径（决策 #1266 / #1268 / #1270）
//
// 【为什么按端分组】Studio 面向 Web / Android / iOS / 鸿蒙 / 小程序 五种端，每端要的工具不同：
//   Web 要 node + 浏览器，Android 要 Android Studio + adb，iOS 要 Xcode，
//   鸿蒙要 DevEco Studio，小程序要微信开发者工具。摊成一串平铺输入框既难找，也说不清"给哪端用"。
//   ⇒ 模型就是 `目标.工具 → 路径` 的扁平表，界面按端分组渲染（加一端只加数据，不动类型）。
//
// 【路径从哪来】**不猜默认安装路径**：Xcode 可以装在任意磁盘（本机就有两个不同版本）。
//   ① 自动检测：Spotlight（跨所有卷）按 bundle id / 显示名找 App；二进制用 `which -a`；
//   ② 只有一个候选就自动填入（零输入可用）；
//   ③ 找不到才让用户点「浏览…」（原生 NSOpenPanel）。
//
// 【存哪】`~/Library/Application Support/dev.proteus.studio.shell/settings.json`
use std::collections::BTreeMap;
use std::ffi::{c_char, c_int, CStr, CString};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Settings {
    /// `目标.工具` → 路径（如 `ios.xcode` / `android.adb`）
    #[serde(default)]
    pub paths: BTreeMap<String, String>,
    /// iOS 推流端口（ReplayKit 助手推到本机这个端口，`nc -l` 收）
    #[serde(default)]
    pub ios_port: Option<u16>,
    /// **上次成功连接的设备串号**（决策 #1307）：启动时用它自动重连。
    /// ★为什么要持久化：用户的原话是"为什么你启动的就正常、我从 Finder 打开就不显示"——
    ///   因为"自动连上"之前只是我调试用的环境变量钩子，不是产品行为。
    ///   手动打开的会话没有输入源 ⇒ 画布永远是"等待首帧"。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_device: Option<String>,
    /// ↓ v1 遗留字段：只为读旧文件，写盘时不再序列化（load 时折进 `paths`）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xcode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adb: Option<String>,
}

impl Settings {
    fn migrated(mut self) -> Self {
        if let Some(x) = self.xcode.take() {
            if !x.trim().is_empty() {
                self.paths.entry("ios.xcode".into()).or_insert(x);
            }
        }
        if let Some(a) = self.adb.take() {
            if !a.trim().is_empty() {
                self.paths.entry("android.adb".into()).or_insert(a);
            }
        }
        self
    }

    /// 取某工具路径（空串视为未设置）
    pub fn path(&self, key: &str) -> Option<&str> {
        self.paths.get(key).map(|s| s.trim()).filter(|s| !s.is_empty())
    }
}

static CURRENT: Mutex<Option<Settings>> = Mutex::new(None);

extern "C" {
    /// 原生选路径面板（实现见 native/embed_view.m）；1 = 选中
    fn poc_pick_path(message: *const c_char, out: *mut c_char, cap: c_int) -> c_int;
}

#[derive(Serialize, Clone)]
pub struct Candidate {
    pub path: String,
    /// `None` = 路径在但拿不到版本（不是所有工具都给版本，界面如实显示"已安装"）
    pub version: Option<String>,
}

fn settings_file() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home)
        .join("Library/Application Support/dev.proteus.studio.shell")
        .join("settings.json")
}

pub fn load() -> Settings {
    std::fs::read_to_string(settings_file())
        .ok()
        .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
        .unwrap_or_default()
        .migrated()
}

pub fn current() -> Settings {
    if let Ok(g) = CURRENT.lock() {
        if let Some(s) = g.as_ref() {
            return s.clone();
        }
    }
    let s = load();
    if let Ok(mut g) = CURRENT.lock() {
        *g = Some(s.clone());
    }
    s
}

pub fn load_and_apply() -> Settings {
    let s = load();
    if let Ok(mut g) = CURRENT.lock() {
        *g = Some(s.clone());
    }
    apply(&s);
    s
}

pub fn save(s: Settings) -> Result<(), String> {
    let p = settings_file();
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("建目录失败：{e}"))?;
    }
    let text = serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?;
    std::fs::write(&p, text).map_err(|e| format!("写设置失败：{e}"))?;
    if let Ok(mut g) = CURRENT.lock() {
        *g = Some(s.clone());
    }
    apply(&s);
    eprintln!("[studio] 设置已保存 → {}", p.display());
    Ok(())
}

/// 应用设置：`DEVELOPER_DIR` 是 xcrun / xcodebuild / 各 IDE 工具的共同入口。
pub fn apply(s: &Settings) {
    if let Some(x) = s.path("ios.xcode") {
        let dev = developer_dir(x);
        std::env::set_var("DEVELOPER_DIR", &dev);
        eprintln!("[studio] DEVELOPER_DIR = {dev}");
    }
}

/// adb 可执行文件（采集与注入都用它）
pub fn adb_bin() -> String {
    current()
        .path("android.adb")
        .map(|s| s.to_string())
        .unwrap_or_else(|| "adb".to_string())
}

/// `Xcode.app` → `Contents/Developer`
pub fn developer_dir(xcode: &str) -> String {
    let p = xcode.trim_end_matches('/');
    if p.ends_with("Contents/Developer") {
        p.to_string()
    } else {
        format!("{p}/Contents/Developer")
    }
}

/* ── 工具清单：界面按 `端` 分组渲染，Rust 只认 key ─────────────────────────────
   (key, 端, 标签, 是否"应用包") */
pub const TOOLS: &[(&str, &str, &str, bool)] = &[
    ("web.node", "web", "Node", false),
    ("web.browser", "web", "浏览器", true),
    ("android.studio", "android", "Android Studio", true),
    ("android.adb", "android", "adb", false),
    ("ios.xcode", "ios", "Xcode", true),
    ("harmony.deveco", "harmony", "DevEco Studio", true),
    ("mp.devtools", "mp", "微信开发者工具", true),
];

/* ── 自动检测 ───────────────────────────────────────────────────────────── */

fn mdfind(query: &[&str]) -> Vec<String> {
    Command::new("mdfind")
        .args(query)
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|s| s.trim().to_string())
                .filter(|s| s.ends_with(".app"))
                .collect()
        })
        .unwrap_or_default()
}

fn which_all(bin: &str) -> Vec<String> {
    let mut v: Vec<String> = Command::new("which")
        .args(["-a", bin])
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|s| s.trim().to_string())
                .collect()
        })
        .unwrap_or_default();
    v.push(format!("/opt/homebrew/bin/{bin}"));
    v.push(format!("/usr/local/bin/{bin}"));
    v
}

fn dedupe_existing(paths: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for p in paths {
        let p = p.trim().to_string();
        if p.is_empty() || !std::path::Path::new(&p).exists() || out.iter().any(|x| *x == p) {
            continue;
        }
        out.push(p);
    }
    out.sort();
    out
}

/// 版本（拿不到就是 None —— 不编版本号）
fn version_of(key: &str, path: &str) -> Option<String> {
    let run = |cmd: &str, args: &[&str], env: Option<(&str, String)>| -> Option<String> {
        let mut c = Command::new(cmd);
        c.args(args);
        if let Some((k, v)) = env {
            c.env(k, v);
        }
        let out = c.output().ok()?;
        if !out.status.success() {
            return None;
        }
        let s = String::from_utf8_lossy(&out.stdout).lines().next()?.trim().to_string();
        if s.is_empty() { None } else { Some(s) }
    };
    match key {
        "ios.xcode" => run(
            &format!("{}/usr/bin/xcodebuild", developer_dir(path)),
            &["-version"],
            Some(("DEVELOPER_DIR", developer_dir(path))),
        ),
        "android.adb" => run(path, &["version"], None),
        "web.node" => run(path, &["--version"], None),
        _ => None,
    }
}

fn candidates_of(key: &str) -> Vec<String> {
    match key {
        "web.node" => which_all("node"),
        "android.adb" => which_all("adb"),
        "ios.xcode" => {
            let mut v = mdfind(&["kMDItemCFBundleIdentifier == 'com.apple.dt.Xcode'"]);
            if let Ok(out) = Command::new("xcode-select").arg("-p").output() {
                let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if let Some(app) = p.strip_suffix("/Contents/Developer") {
                    v.push(app.to_string());
                }
            }
            v
        }
        "web.browser" => {
            let mut v = Vec::new();
            for id in [
                "com.google.Chrome",
                "com.microsoft.edgemac",
                "org.mozilla.firefox",
                "com.brave.Browser",
                "company.thebrowser.Browser",
            ] {
                v.extend(mdfind(&[&format!("kMDItemCFBundleIdentifier == '{id}'")]));
            }
            v
        }
        "android.studio" => {
            let mut v = mdfind(&["kMDItemCFBundleIdentifier == 'com.google.android.studio'"]);
            v.push("/Applications/Android Studio.app".into());
            v
        }
        "harmony.deveco" => {
            let mut v = mdfind(&["-name", "DevEco-Studio.app"]);
            v.push("/Applications/DevEco-Studio.app".into());
            v
        }
        "mp.devtools" => {
            let mut v = mdfind(&["kMDItemCFBundleIdentifier == 'com.tencent.wechat.devtools'"]);
            v.extend(mdfind(&["-name", "wechatwebdevtools.app"]));
            v.push("/Applications/wechatwebdevtools.app".into());
            v
        }
        _ => Vec::new(),
    }
}

pub fn detect(key: &str) -> Vec<Candidate> {
    dedupe_existing(candidates_of(key))
        .into_iter()
        .map(|path| {
            let version = version_of(key, &path);
            Candidate { path, version }
        })
        .collect()
}

#[derive(Serialize)]
pub struct Detected {
    pub by_key: BTreeMap<String, Vec<Candidate>>,
}

/// 一次探出所有工具的候选（界面按端分组显示）。
/// ★阻塞（mdfind + 逐项跑 version）⇒ 必须下 blocking 线程池。
#[tauri::command]
pub async fn detect_tools() -> Detected {
    tauri::async_runtime::spawn_blocking(|| Detected {
        by_key: TOOLS
            .iter()
            .map(|(k, _, _, _)| (k.to_string(), detect(k)))
            .collect(),
    })
    .await
    .unwrap_or(Detected { by_key: BTreeMap::new() })
}

/* ── 探测与选择 ─────────────────────────────────────────────────────────── */

#[derive(Serialize)]
pub struct ProbeResult {
    pub ok: bool,
    pub detail: String,
}

fn probe_one(key: &str, path: &str) -> Result<String, String> {
    let p = path.trim();
    if p.is_empty() {
        return Err("路径为空".into());
    }
    if !std::path::Path::new(p).exists() {
        return Err(format!("{p} 不存在"));
    }
    if key == "ios.xcode" {
        let bin = format!("{}/usr/bin/xcodebuild", developer_dir(p));
        if !std::path::Path::new(&bin).exists() {
            return Err(format!("{bin} 不存在 —— 请选 `Xcode.app` 本体，而不是 Contents 里的目录"));
        }
    }
    Ok(version_of(key, p).unwrap_or_else(|| "路径存在（该工具不提供版本）".to_string()))
}

pub fn probe(key: &str, path: &str) -> ProbeResult {
    match probe_one(key, path) {
        Ok(detail) => ProbeResult { ok: true, detail },
        Err(detail) => ProbeResult { ok: false, detail },
    }
}

#[tauri::command]
pub async fn probe_tool(key: String, path: String) -> ProbeResult {
    tauri::async_runtime::spawn_blocking(move || probe(&key, &path))
        .await
        .unwrap_or(ProbeResult { ok: false, detail: "探测线程异常".into() })
}

/// 打开系统面板选路径；None = 用户取消
pub fn pick_path(message: &str) -> Option<String> {
    let msg = CString::new(message).ok()?;
    let mut buf = [0i8; 4096];
    let ok = unsafe { poc_pick_path(msg.as_ptr(), buf.as_mut_ptr(), buf.len() as c_int) };
    if ok == 0 {
        return None;
    }
    let s = unsafe { CStr::from_ptr(buf.as_ptr()) }.to_string_lossy().to_string();
    let s = s.trim_end_matches('/').to_string();
    if s.is_empty() { None } else { Some(s) }
}

#[tauri::command]
pub async fn pick_tool(key: String) -> Result<Option<String>, String> {
    let label = TOOLS
        .iter()
        .find(|(k, _, _, _)| *k == key)
        .map(|(_, _, l, _)| *l)
        .unwrap_or("可执行文件");
    let msg = format!("选择 {label}");
    tauri::async_runtime::spawn_blocking(move || pick_path(&msg))
        .await
        .map_err(|e| format!("选择面板异常：{e}"))
}

/* ── 设置命令 ───────────────────────────────────────────────────────────── */

#[tauri::command(rename = "get_settings")]
pub fn get_settings_cmd() -> Settings {
    current()
}

#[tauri::command(rename = "save_settings")]
pub fn save_settings_cmd(s: Settings) -> Result<(), String> {
    save(s)
}

/* ── 独立设置窗口 ───────────────────────────────────────────────────────── */

const SETTINGS_VIEW_JS: &str = "window.__PROTEUS_VIEW__ = 'settings'";

/// 打开设置窗口（已存在则聚焦）。★走 `window::studio_window`：沉浸式标题栏只有一处定义。
pub fn open_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.set_focus();
        return Ok(());
    }
    crate::window::studio_window(
        app,
        "settings",
        tauri::WebviewUrl::App("index.html".into()),
        "设置",
        (900.0, 620.0),
        (720.0, 480.0),
        Some(SETTINGS_VIEW_JS),
    )
    .map(|_| eprintln!("[studio] 设置窗口已打开（900x620 · 沉浸式标题栏 · 左侧分类）"))
}
