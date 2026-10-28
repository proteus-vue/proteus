// ios_stream.rs —— 「一键投屏到 iPhone」（决策 #1288）
//
// 【它解决什么】在这之前，把画面弄到 Studio 里要用户自己在终端敲 5 步：
//   编译 → 签名 → 安装 → 带环境变量启动 → 回 Studio 选设备。
//   其中 3 步是"只有读过日志的人才知道的命令"，对任何开发者都是硬门槛。
//
// 【为什么不是重写一套构建】`hosts/ios/run-selfdraw.sh` 里已经把 ①TS ②JS bundle
//   ③Rust ④Swift ⑤组装 ⑥签名 ⑦安装启动 全做了，而且踩过的坑都写在注释里
//   （源码快照、续行形态、签名档选择…）。**重复实现 = 把那些坑重踩一遍**。
//   ⇒ 本模块只做三件脚本不会做的事：
//     ① 找到仓库根（用户在 GUI 里，没有 cwd 概念）
//     ② 把子进程输出**流式**转成界面能画的"阶段 + 日志行"
//     ③ 把已知失败**翻译成人话 + 给出可点的动作**（这是门槛的真正所在）
//
// 【为什么错误翻译比流程本身更重要】实测撞到的三类失败，原始信息都指向错误的地方：
//   · `MIInstallerErrorDomain 64 / MismatchedApplicationIdentifierEntitlement`
//     → 看着像"安装坏了"，实际是**设备上有另一个团队签的同名应用**，必须卸载
//   · `ProteusSelfDraw.app: No such file or directory`（签名步）
//     → 看着像"文件没了"，实际是**上一次构建被中断**（或并发打包）没生成 .app
//   · `0xe8008018 The identity used to sign the executable is no longer valid`
//     → 证书被吊销/换机，要换签名档
//
// 【必须承认的硬门槛】首次仍然要：设备信任、开发者账号/团队、以及**签名时钥匙串授权弹窗**
//   （点一次"始终允许"之后不再问）。这几步 Apple 不允许自动化，本模块只能把它们
//   **暴露成明确的下一步**，而不是假装不需要。
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::Emitter;

/// 一次运行的状态（前端据此禁用按钮 / 显示进度）
#[derive(Clone, serde::Serialize)]
pub(crate) struct IosRun {
    running: bool,
    /// 最近一次看到的 bundle id（卸载要用；脚本会打印「选中 bundle id：…」）
    bundle: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct Progress {
    /// 阶段标题（`==> ④ 编译 Swift 宿主` 里的正文）；不是阶段行就是 None
    stage: Option<String>,
    line: String,
}

#[derive(Clone, serde::Serialize)]
struct Outcome {
    ok: bool,
    code: Option<i32>,
    /// 人话解释（None = 没有可翻译的，界面直接展示日志尾部）
    hint: Option<String>,
    /// 界面该给哪个按钮：uninstall / rebuild / signing / none
    action: Option<String>,
}

static RUNNING: AtomicBool = AtomicBool::new(false);
static LAST_BUNDLE: Mutex<Option<String>> = Mutex::new(None);
/// 失败时用来翻译的尾部缓冲（只留最后 8KB，够定位又不吃内存）
static TAIL: Mutex<String> = Mutex::new(String::new());

/// 找仓库根：GUI 里没有"当前目录"这回事。
///
/// 顺序：`PROTEUS_ROOT`（显式）→ 从可执行文件往上找 `hosts/ios/run-selfdraw.sh`。
/// 最坏 10 层（`build-app/Proteus Studio.app/Contents/MacOS/bin` 到 root 是 6 层）。
pub(crate) fn find_root() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("PROTEUS_ROOT") {
        let p = PathBuf::from(p);
        if p.join("hosts/ios/run-selfdraw.sh").exists() {
            return Some(p);
        }
    }
    let mut cur = std::env::current_exe().ok()?;
    for _ in 0..10 {
        cur = cur.parent()?.to_path_buf();
        if cur.join("hosts/ios/run-selfdraw.sh").exists() {
            return Some(cur);
        }
    }
    None
}

/// 把 `~` 换成 HOME（GUI 里没有 shell 帮忙展开）
fn expand(p: &str) -> String {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Ok(h) = std::env::var("HOME") {
            return format!("{h}/{rest}");
        }
    }
    p.to_string()
}

/// 子进程要用的 PATH。
///
/// 【为什么必须有这个】macOS 的 **GUI 应用不继承终端的 PATH**（launchd 给的只有
/// `/usr/bin:/bin:/usr/sbin:/sbin`）。实测：点"投屏"后脚本在第 159 行炸
/// `pnpm: command not found` —— 而 `pnpm` 就在 `~/Library/pnpm/bin`（pnpm 默认 PNPM_HOME）。
/// 同类工具还有 `cargo`（~/.cargo/bin）、`node`（nvm/volta/bun 各有一套）。
///
/// 做法：**先问登录 shell**（最忠实，用户装哪都认）→ 再补常见目录（幂等去重）。
/// 只补那些真实存在的目录，不往 PATH 里塞不存在的东西。
fn child_path() -> String {
    let mut parts: Vec<String> = Vec::new();

    // ① 登录 shell 的 PATH：取**含 ':' 且以 '/' 开头**的最后一行（防止 .zprofile 有打印噪声）
    if let Ok(out) = Command::new("/bin/zsh").args(["-lc", "printf %s \"$PATH\""]).output() {
        let text = String::from_utf8_lossy(&out.stdout).to_string();
        if let Some(line) = text
            .lines()
            .rev()
            .find(|l| l.contains(':') && l.trim_start().starts_with('/'))
        {
            parts.extend(line.trim().split(':').map(|s| s.to_string()));
        }
    }

    // ② 常见安装位（家目录在 GUI 里一定可展开）
    for p in [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "~/Library/pnpm/bin", // ★pnpm 的默认 PNPM_HOME · 本次事故的直接原因
        "~/Library/pnpm",
        "~/.local/share/pnpm",
        "~/.cargo/bin",
        "~/.volta/bin",
        "~/.bun/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ] {
        let e = expand(p);
        if std::path::Path::new(&e).exists() {
            parts.push(e);
        }
    }

    // 去重但保序（登录 shell 的顺序优先）
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for p in parts {
        if !p.is_empty() && seen.insert(p.clone()) {
            out.push(p);
        }
    }
    out.join(":")
}

/// 在 PATH 里找可执行文件（不依赖外部 `which`）
fn which(tool: &str, path: &str) -> Option<String> {
    for dir in path.split(':') {
        if dir.is_empty() {
            continue;
        }
        let full = std::path::Path::new(dir).join(tool);
        if full.is_file() {
            return Some(full.display().to_string());
        }
    }
    None
}

fn push_tail(line: &str) {
    if let Ok(mut g) = TAIL.lock() {
        g.push_str(line);
        g.push('\n');
        if g.len() > 8192 {
            let cut = g.len() - 8192;
            // 按字节裁，可能切断多字节字符 —— 这里只用于错误匹配，丢掉半截无碍
            let s = g.split_off(cut);
            *g = s;
        }
    }
}

/// 把已知失败翻译成「人话 + 该点哪个按钮」。返回 (hint, action)
///
/// ★这些都来自**实测**（2026-10-27 真机一轮），不是推测：
///   团队不一致 / 构建被中断 / 证书吊销 / 钥匙串未解锁 / 设备没解锁。
fn translate(text: &str) -> (Option<String>, Option<String>) {
    let has = |s: &str| text.contains(s);
    if has("MismatchedApplicationIdentifierEntitlement") || has("MIInstallerErrorDomain error 64") {
        return (
            Some(
                "这台设备上已经装过**另一个开发团队**签名的同名应用（bundle id 相同、团队不同），\
                 iOS 不允许跨团队升级。需要先卸载旧的那一份，再装这次的。"
                    .into(),
            ),
            Some("uninstall".into()),
        );
    }
    if has("No such file or directory") && (has("==> ⑥") || has("codesign")) {
        return (
            Some("签名这一步找不到 .app：上一次构建被中断（或另一个进程正在打包删了它）。重新构建即可。".into()),
            Some("rebuild".into()),
        );
    }
    if has("0xe8008018") || has("is no longer valid") {
        return (
            Some("签名证书已失效/被吊销（常见于证书重签或换机）。换一张签名身份：`bash hosts/ios/signing.sh use <账号>`。".into()),
            Some("signing".into()),
        );
    }
    if has("errSecInternalComponent") || has("User interaction is not allowed") {
        return (
            Some("签名时钥匙串没解锁。先在终端 `security unlock-keychain`，或在系统弹窗里点「始终允许」，之后不再问。".into()),
            Some("signing".into()),
        );
    }
    if has("command not found") {
        return (
            Some(
                "构建脚本找不到命令（通常是 GUI 没继承终端 PATH）。把缺的工具目录写进 \
                 ~/.zprofile 的 PATH，或在终端里跑一次确认 `which pnpm` / `which cargo` 有输出。"
                    .into(),
            ),
            Some("none".into()),
        );
    }
    if has("Unable to launch") || has("BSErrorCodeDescription") || has("Failed to launch") {
        return (
            Some("装上了但启动失败：确认手机**已解锁**并且已在这台电脑上点过「信任」。".into()),
            Some("none".into()),
        );
    }
    (None, None)
}

/// 从一行输出里顺带记下 bundle id（脚本会打印「选中 bundle id：X」）
fn note_bundle(line: &str) {
    for key in ["bundle id：", "bundle id:", "bundleID:"] {
        if let Some(i) = line.find(key) {
            /* ★按"字符类"截取而不是按空白切：脚本打印的是
               `选中 bundle id：cn.shxuxi.proteus.experiments（档位：office · team X）`
               —— 全角括号前**没有空格**，按空白切会把后半截中文一起吞进来。
               bundle id 的合法字符就是字母/数字/`.`/`-`，遇到别的就停。 */
            let rest = line[i + key.len()..].trim_start();
            let id: String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-')
                .collect();
            // bundle id 至少要有两个点，避免把无关单词记下来
            if id.matches('.').count() >= 2 {
                if let Ok(mut g) = LAST_BUNDLE.lock() {
                    *g = Some(id);
                }
            }
        }
    }
}

/// 启动一串流水线（异步）。返回后立刻回；进度走 `ios:progress`，结果走 `ios:result`。
pub(crate) fn start(app: tauri::AppHandle, udid: String, ip: String, port: u16) -> Result<(), String> {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err("上一次投屏流程还在跑，等它结束（或看进度面板里的日志）".into());
    }
    let root = find_root().ok_or_else(|| {
        "找不到仓库根（没在仓库里运行？）。可以在设置里指定 PROTEUS_ROOT 环境变量后重启。".to_string()
    })?;
    let script = root.join("hosts/ios/run-selfdraw.sh");
    if !script.exists() {
        RUNNING.store(false, Ordering::SeqCst);
        return Err(format!("找不到 {}", script.display()));
    }
    if let Ok(mut g) = TAIL.lock() {
        g.clear();
    }
    let stream_arg = format!("--stream={ip}:{port}");

    /* ★触控回传（决策 #1295）：推流端口 +1 作为**控制端口**，Studio 先挂上监听，
       手机端启动后会主动连过来（和推流同向）。顺序不能反：先监听，后启动手机。 */
    let touch_port = port.saturating_add(1);
    crate::ios_touch::ensure_listening(app.clone(), touch_port);

    /* ★启动前先算好 PATH 并**预检**（决策 #1289）。
       不在这一步做的话，失败会以 `line 159: pnpm: command not found` 的形式出现 ——
       用户看到的是"脚本坏了"，实际是"GUI 没继承终端 PATH"。预检能把话说清楚。 */
    let path = child_path();
    let missing: Vec<&str> = ["pnpm", "node", "cargo"]
        .into_iter()
        .filter(|t| which(t, &path).is_none())
        .collect();
    if !missing.is_empty() {
        RUNNING.store(false, Ordering::SeqCst);
        return Err(format!(
            "GUI 启动的 Studio 不继承终端 PATH，当前找不到：{}。\n             pnpm 一般装在 ~/Library/pnpm/bin，cargo 在 ~/.cargo/bin。\n             两种解法：① 把它们加进 ~/.zprofile 的 PATH（推荐，一次搞定）；\n             ② 启动 Studio 前设 PROTEUS_ROOT/PATH 环境变量。",
            missing.join(" / ")
        ));
    }
    eprintln!("[ios] 一键投屏 ⇒ {} {} {}", script.display(), stream_arg, udid);
    eprintln!("[ios] PATH = {path}");

    std::thread::spawn(move || {
        let mut cmd = Command::new("/bin/bash");
        cmd.arg(&script)
            .arg(&stream_arg)
            .arg(&udid)
            .current_dir(&root)
            // 固定 UTF-8 locale：脚本头注释就写了非 UTF-8 下 `set -u` 会被全角字符坑到
            .env("LANG", "en_US.UTF-8")
            .env("LC_ALL", "en_US.UTF-8")
            // ★GUI 里 PATH 是残缺的（决策 #1289）：显式注入合并后的 PATH + PNPM_HOME
            .env("PATH", &path)
            .env("PNPM_HOME", expand("~/Library/pnpm"))
            .env("PROTEUS_ROOT", &root)
            // ★脚本用它拼 devicectl 的 `-e`（决策 #1295）
            .env("PROTEUS_TOUCH_CONTROL", format!("{ip}:{}", port.saturating_add(1)))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit(
                    "ios:result",
                    Outcome {
                        ok: false,
                        code: None,
                        hint: Some(format!("起不来子进程：{e}")),
                        action: Some("none".into()),
                    },
                );
                RUNNING.store(false, Ordering::SeqCst);
                return;
            }
        };

        // stderr 单独一条线程，合并进同一条进度流（顺序可能与 stdout 略有交错，可接受）
        if let Some(err) = child.stderr.take() {
            let app2 = app.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(err).lines().map_while(Result::ok) {
                    push_tail(&line);
                    note_bundle(&line);
                    let _ = app2.emit("ios:progress", Progress { stage: None, line });
                }
            });
        }

        if let Some(out) = child.stdout.take() {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                push_tail(&line);
                note_bundle(&line);
                // `==> ④ 编译 Swift 宿主（自绘场景）` ⇒ 阶段标题
                let stage = line.strip_prefix("==> ").map(|s| s.trim().to_string());
                let _ = app.emit("ios:progress", Progress { stage, line });
            }
        }

        let code = child.wait().ok().and_then(|s| s.code());
        let text = TAIL.lock().map(|g| g.clone()).unwrap_or_default();
        let (hint, action) = translate(&text);
        let ok = code == Some(0);
        let _ = app.emit(
            "ios:result",
            Outcome {
                ok,
                code,
                hint: if ok { None } else { hint },
                action: if ok { None } else { Some(action.unwrap_or_else(|| "none".into())) },
            },
        );
        RUNNING.store(false, Ordering::SeqCst);
    });
    Ok(())
}

/// 直接启动**已装**的宿主（不编译、不安装、不签名）—— 秒级。
///
/// 【为什么需要它】用户的第一反应很对：「每次都点投屏就要重新建一遍应用？」——
///   之前的实现只有"跑完整个 run-selfdraw.sh"这一条路（编译 40s + 签名 + 安装），
///   而**绝大多数情况下手机上已经装着能用的宿主**，只需要把它**启动起来**并带上两个环境变量。
///
/// 【为什么用"试启动"来判"装没装"】`devicectl device info apps` 在本机实测**返回空列表**
///   （即使 `--bundle-id` 指定也空），拿它当判据会永远判成"没装"。
///   而 `process launch` 对未安装的 bundle 会明确失败 ⇒ **试一次就是最准的探测**，
///   失败再回退到完整构建（self-healing），不需要维护一份容易漂的"安装清单"。
fn launch_host(udid: &str, ip: &str, port: u16) -> Result<(), String> {
    let touch = port.saturating_add(1);
    let env = format!(
        "{{\"PROTEUS_SCREEN_STREAM\":\"{ip}:{port}\",\"PROTEUS_TOUCH_CONTROL\":\"{ip}:{touch}\"}}"
    );
    let bundle = LAST_BUNDLE
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .unwrap_or_else(|| "cn.shxuxi.proteus.experiments".to_string());
    let out = Command::new("/usr/bin/xcrun")
        .args([
            "devicectl",
            "device",
            "process",
            "launch",
            "--terminate-existing",
            "--device",
            udid,
            "-e",
            &env,
            &bundle,
        ])
        .output()
        .map_err(|e| format!("调 devicectl 失败：{e}"))?;
    if out.status.success() {
        eprintln!("[ios] 已启动已装宿主 {bundle}（快路径，未重新构建）");
        Ok(())
    } else {
        let text = String::from_utf8_lossy(&out.stdout).to_string()
            + &String::from_utf8_lossy(&out.stderr);
        Err(text.lines().rev().take(3).collect::<Vec<_>>().join(" / "))
    }
}

/// 卸载设备上的同名应用（团队冲突时的标准解法）。
pub(crate) fn uninstall(udid: &str, bundle: Option<String>) -> Result<String, String> {
    let bundle = bundle
        .or_else(|| LAST_BUNDLE.lock().ok().and_then(|g| g.clone()))
        .ok_or("还不知道 bundle id（先跑一次投屏，或看上一轮日志里的「选中 bundle id」）")?;
    let out = Command::new("/usr/bin/xcrun")
        .args(["devicectl", "device", "uninstall", "app", "--device", udid, &bundle])
        .output()
        .map_err(|e| format!("调 devicectl 失败：{e}"))?;
    let text = String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
    if out.status.success() {
        eprintln!("[ios] 已卸载 {bundle}（{udid}）");
        Ok(bundle)
    } else {
        Err(format!("卸载失败：{}", text.lines().rev().take(3).collect::<Vec<_>>().join(" / ")))
    }
}

// ── IPC ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn ios_stream_start(app: tauri::AppHandle, udid: String, ip: String, port: u16) -> Result<(), String> {
    start(app, udid, ip, port)
}

/// ★一键投屏的**推荐入口**（决策 #1297）：先试"直接启动已装宿主"（秒级），
/// 只有启动失败（没装/包坏了）才回退到完整构建。用户不用每次等 40 秒编译。
#[tauri::command]
pub(crate) fn ios_start_host(app: tauri::AppHandle, udid: String, ip: String, port: u16) -> Result<(), String> {
    crate::ios_touch::ensure_listening(app.clone(), port.saturating_add(1));
    match launch_host(&udid, &ip, port) {
        Ok(()) => {
            let _ = app.emit(
                "ios:progress",
                Progress { stage: Some("已启动手机端宿主（未重新构建）".into()), line: "沿用手机上已安装的宿主，秒级启动".into() },
            );
            let _ = app.emit(
                "ios:result",
                Outcome { ok: true, code: Some(0), hint: None, action: None },
            );
            Ok(())
        }
        Err(e) => {
            let _ = app.emit(
                "ios:progress",
                Progress {
                    stage: Some("没找到可用的宿主，改为完整构建".into()),
                    line: format!("启动失败：{e}"),
                },
            );
            start(app, udid, ip, port)
        }
    }
}

#[tauri::command]
pub(crate) fn ios_uninstall(udid: String, bundle: Option<String>) -> Result<String, String> {
    uninstall(&udid, bundle)
}

#[tauri::command]
pub(crate) fn ios_run_state() -> IosRun {
    IosRun {
        running: RUNNING.load(Ordering::SeqCst),
        bundle: LAST_BUNDLE.lock().ok().and_then(|g| g.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 团队不一致被翻译成可卸载() {
        let t = "Upgrade's application-identifier entitlement string (X.cn.a) does not match \
                 installed application's (F.cn.a); rejecting upgrade. (MIInstallerErrorDomain error 64)";
        let (hint, action) = translate(t);
        assert!(hint.unwrap().contains("另一个开发团队"));
        assert_eq!(action.as_deref(), Some("uninstall"));
    }

    #[test]
    fn 构建中断被翻译成重新构建() {
        let t = "==> ⑥ 签名\n/Volumes/x/build-selfdraw/ProteusSelfDraw.app: No such file or directory";
        let (_, action) = translate(t);
        assert_eq!(action.as_deref(), Some("rebuild"));
    }

    #[test]
    fn 未知失败不硬编() {
        let (hint, action) = translate("something totally unexpected");
        assert!(hint.is_none() && action.is_none());
    }

    #[test]
    fn path_合并去重且只收真实目录() {
        let p = child_path();
        // 家目录类目录必须被展开成绝对路径（否则子进程里 "~" 不生效）
        assert!(!p.contains("~/"), "PATH 里不该残留 ~：{p}");
        // /usr/bin 一定存在
        assert!(p.split(':').any(|d| d == "/usr/bin"), "PATH 缺 /usr/bin：{p}");
        // 去重
        let mut dirs: Vec<&str> = p.split(':').collect();
        let n = dirs.len();
        dirs.sort_unstable();
        dirs.dedup();
        assert_eq!(dirs.len(), n, "PATH 有重复项：{p}");
    }

    #[test]
    fn which_能在合成路径里找到() {
        let fake = "/tmp";
        assert!(which("nonexistent-tool-xyz", fake).is_none());
        assert!(which("sh", "/bin").is_some());
    }

    #[test]
    fn 命令找不到被翻译成人话() {
        let t = "/Volumes/x/hosts/ios/run-selfdraw.sh: line 159: pnpm: command not found";
        let (hint, action) = translate(t);
        assert!(hint.unwrap().contains("PATH"));
        assert_eq!(action.as_deref(), Some("none"));
    }

    #[test]
    fn bundle_id_能从脚本输出里记下来() {
        if let Ok(mut g) = LAST_BUNDLE.lock() {
            *g = None;
        }
        note_bundle("[pin] 按本机签名档选中 bundle id：cn.shxuxi.proteus.experiments（档位：office · team X）");
        let got = LAST_BUNDLE.lock().unwrap().clone();
        assert_eq!(got.as_deref(), Some("cn.shxuxi.proteus.experiments"));
    }
}
