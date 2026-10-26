// settings.rs —— 开发环境路径设置（决策 #1266）
//
// 【为什么需要】**Xcode 可以装在任意磁盘**（本机就在 `/Volumes/data1/work/office-applications/Xcode.app`），
//   任何"按默认路径猜"的做法都会在真实机器上翻车——我第一次探 iOS 设备就是这么翻的：
//   `xcode-select -p` 指到 CommandLineTools、`/Applications/Xcode*.app` 不存在，于是结论成了"没有 Xcode"。
//   ⇒ 路径必须**由开发者显式指定并持久化**，代码里只留"探测"作为兜底提示，不做唯一来源。
//
// 【存哪】`~/Library/Application Support/dev.proteus.studio.shell/settings.json`
//   （identifier 与 tauri.conf 一致；不往仓库里写，避免不同开发者互相覆盖）。
// 【怎么用】启动时 `load_and_apply()`：设 `DEVELOPER_DIR`（给 xcrun/xcodebuild 用）、缓存 adb 路径；
//   保存后立即生效（下一次 spawn 就用新值），不需要重启应用。
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Settings {
    /// `Xcode.app` 的路径（不是 Contents/Developer）。空 = 用系统 `xcode-select` / 环境变量
    pub xcode: Option<String>,
    /// `adb` 可执行文件路径。空 = 走 PATH
    pub adb: Option<String>,
    /// iOS 推流端口（ReplayKit 助手推到本机这个端口，`nc -l` 收）
    pub ios_port: Option<u16>,
}

static CURRENT: Mutex<Option<Settings>> = Mutex::new(None);

fn path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home)
        .join("Library/Application Support/dev.proteus.studio.shell")
        .join("settings.json")
}

pub fn load() -> Settings {
    std::fs::read_to_string(path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// 当前生效的设置（进程内缓存；`save` 会一起更新）
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

/// adb 可执行文件：设置里有就用设置，否则 "adb"（靠 PATH）
pub fn adb_bin() -> String {
    current()
        .adb
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(|| "adb".to_string())
}

/// `Xcode.app` 路径 → `Contents/Developer`（xcrun/xcodebuild 要的是这个）
pub fn developer_dir(xcode: &str) -> String {
    let p = xcode.trim_end_matches('/');
    if p.ends_with("Contents/Developer") {
        p.to_string()
    } else {
        format!("{p}/Contents/Developer")
    }
}

/// 把设置应用到这个进程：`DEVELOPER_DIR` 是 xcrun/xcodebuild/各个 IDE 工具的共同入口。
pub fn apply(s: &Settings) {
    if let Some(x) = s.xcode.as_deref().filter(|v| !v.trim().is_empty()) {
        std::env::set_var("DEVELOPER_DIR", developer_dir(x));
        eprintln!("[studio] DEVELOPER_DIR = {}", developer_dir(x));
    }
}

/// 保存：写盘 + 立刻应用（不需要重启）
pub fn save(s: Settings) -> Result<(), String> {
    let p = path();
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

/// 启动时：读 + 应用
pub fn load_and_apply() -> Settings {
    let s = load();
    if let Ok(mut g) = CURRENT.lock() {
        *g = Some(s.clone());
    }
    apply(&s);
    s
}

/// 校验一个 `Xcode.app` 路径：跑 `<DEV>/usr/bin/xcodebuild -version`。
/// 返回版本首行（如 `Xcode 14.2`）。**不猜默认路径**——这里只认用户给的那一个。
pub fn probe_xcode(xcode: &str) -> Result<String, String> {
    let dev = developer_dir(xcode);
    let bin = format!("{dev}/usr/bin/xcodebuild");
    if !std::path::Path::new(&bin).exists() {
        return Err(format!("{bin} 不存在 —— 请选 `Xcode.app` 本体的路径"));
    }
    let out = Command::new(&bin)
        .arg("-version")
        .env("DEVELOPER_DIR", &dev)
        .output()
        .map_err(|e| format!("调用 xcodebuild 失败：{e}"))?;
    if !out.status.success() {
        return Err(format!("xcodebuild -version 失败：{}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(text.lines().next().unwrap_or("").trim().to_string())
}

/// 校验 adb：跑 `adb version` 首行
pub fn probe_adb(adb: &str) -> Result<String, String> {
    let bin = if adb.trim().is_empty() { "adb" } else { adb.trim() };
    let out = Command::new(bin).arg("version").output().map_err(|e| format!("调用 adb 失败：{e}"))?;
    if !out.status.success() {
        return Err(format!("adb version 失败：{}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or("").trim().to_string())
}

#[derive(Serialize)]
pub struct ProbeResult {
    pub ok: bool,
    pub detail: String,
}

/// 供界面「检测」按钮用：一次看两样（Xcode / adb），各自报各自的结果。
pub fn probe(kind: &str, path_or_empty: &str) -> ProbeResult {
    let r = match kind {
        "xcode" => probe_xcode(path_or_empty),
        "adb" => probe_adb(path_or_empty),
        other => Err(format!("未知的探测目标：{other}")),
    };
    match r {
        Ok(detail) => ProbeResult { ok: true, detail },
        Err(detail) => ProbeResult { ok: false, detail },
    }
}
