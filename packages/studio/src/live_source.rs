// live_source.rs —— 「画面从哪来」的全部决策（决策 #1277，从 main.rs 拆出）
//
// 【为什么单独成文件】main.rs 已顶到 `check:file-size` 的 1000 行硬线。
//   而这块是**独立职责**：启动时决定采集源（Android adb / iOS nc / 显式指定），
//   外加"用户到底该怎么接上"的提示。它跟窗口、IPC、面板都无关。
//
// 【这一块解决的真问题】双击启动不可能带环境变量 ⇒ 必须有一处兜底决策；
//   而"iOS 该跑什么命令"长期只写在 eprintln 里（stderr 是**没人看的地方**），
//   用户点了 iPhone 只看到黑屏。`ios_hint()` 就是把这行命令搬到界面上。

use crate::{capture, ADB_SERIAL, DEVICE_PX, TOUCH_ANDROID};

/// 双击启动时 LaunchServices 只给 `/usr/bin:/bin:/usr/sbin:/sbin`，
/// 而 `adb` 通常在 `/opt/homebrew/bin` 或 `/usr/local/bin` ⇒ 显式补进 PATH。
/// ★不补的话"双击就能用"是假的：面板能开，但一台设备都连不上（同一类坑：GUI 不继承 shell 环境）。
pub(crate) fn ensure_tool_path() {
    const EXTRA: [&str; 2] = ["/opt/homebrew/bin", "/usr/local/bin"];
    let cur = std::env::var("PATH").unwrap_or_default();
    let missing: Vec<&str> = EXTRA.iter().copied().filter(|p| !cur.split(':').any(|x| x == *p)).collect();
    if missing.is_empty() {
        return;
    }
    let mut merged = missing.join(":");
    if !cur.is_empty() {
        merged.push(':');
        merged.push_str(&cur);
    }
    std::env::set_var("PATH", &merged);
    eprintln!("[studio] PATH 补充：{}", missing.join(":"));
}

/// 第一台处于 `device` 状态的 adb 设备（没有就 None）。
/// ★不能用 `adb shell` 不带 `-s` 去试：多设备时它的报错是"more than one device"，
///   看起来像设备坏了，其实是**没指定是哪台**。
pub(crate) fn first_adb_serial() -> Option<String> {
    let out = std::process::Command::new("adb").arg("devices").output().ok()?;
    String::from_utf8_lossy(&out.stdout).lines().skip(1).find_map(|l| {
        let mut it = l.split_whitespace();
        let serial = it.next()?;
        (it.next() == Some("device")).then(|| serial.to_string())
    })
}

/// 问设备当前显示尺寸（`adb shell wm size`）。
/// 失败（无设备 / adb 不在 / 输出格式变了）一律返回 `None` —— 调用方据此**不带 `--size`**，
/// 而不是退回一个写死值：写死值会让竖屏被塞进 16:9 而补出 74% 的黑边。
pub(crate) fn adb_screen_size() -> Option<(u32, u32)> {
    /* ★带上当前串号（决策 #1265）：不带 `-s` 时多设备会量到**另一台**的尺寸 ⇒ 画面比例错 */
    crate::device::probe_size(crate::device::current_serial().as_deref())
}

/// 没有显式指定输入时**默认接真机**——双击启动不可能带环境变量，
/// 否则用户看到的是一个永远空白的画布，还以为坏了。
///
/// ★★两条腿（决策 #1190 · G3）：
///   · **Android**：`adb exec-out screenrecord`（整机录屏，裸 Annex-B）
///   · **iOS**：宿主把画面（ReplayKit + VT 硬编）推 TCP 裸 Annex-B ⇒ 本侧 `/usr/bin/nc -l <port>` 收。
///     用 `nc` 而不是自己写监听器：`live_stream.h` 只认「管道里的字节」，而 `nc` 系统自带、
///     `.app` 里也在；断线由 native 侧的「子进程退出自动重连」兜底（与 adb 那条腿同款）。
///   · 想关掉 iOS 等待：`PROTEUS_IOS_STREAM=0`（否则没有 Android 设备时会一直挂着 nc）
pub(crate) fn default_live_source() {
    if std::env::var("POC_LIVE").is_ok() || std::env::var("POC_VIDEO").is_ok() {
        return;
    }
    // ★★显式点名 iOS 端口 ⇒ **优先于 adb 探测**（2026-10-23 实测踩到）：
    //   本机同时连着 Android 和 iPhone 时，若先查 adb，用户按 README 跑
    //   `PROTEUS_IOS_STREAM_PORT=9001 …` 会**静默拿到 Android 画面**（没有任何报错，只有一行 eprintln）
    //   ⇒ 显式意图必须压过自动探测。
    if let Ok(port) = std::env::var("PROTEUS_IOS_STREAM_PORT") {
        if let Ok(p) = port.parse::<u16>() {
            kill_stale_listeners(p);
        }
        std::env::set_var("POC_LIVE", format!("/usr/bin/nc -l {port}"));
        eprintln!("[studio] PROTEUS_IOS_STREAM_PORT={port} ⇒ 等 iOS 推流（/usr/bin/nc -l {port}）");
        eprintln!("[studio]   iPhone 侧：{}", phone_cmd(None, &port));
        return;
    }
    let connected = std::process::Command::new("adb")
        .arg("devices")
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .skip(1)
                .any(|l| l.trim_end().ends_with("device"))
        })
        .unwrap_or(false);
    if connected {
        // 触控回传的前提（决策 #1254）：注入与录屏必须打**同一台**设备。
        // 多设备时 `adb shell` 会以 "more than one device" 失败——记下第一台可用的。
        let serial = first_adb_serial();
        TOUCH_ANDROID.store(serial.is_some(), std::sync::atomic::Ordering::Relaxed);
        if let Ok(mut g) = ADB_SERIAL.lock() {
            *g = serial.clone();   /* 后面拼采集命令还要用（决策 #1265 带 -s） */
        }
        // ★★抓屏尺寸必须**按设备比例**（2026-10-23 实测）：`screenrecord --size` 是把整屏塞进给定尺寸，
        //   不足处**补黑边**。写死 1280x720 时，1200x2608 的竖屏只剩 330x720 有效画面
        //   —— `cropdetect` 实测 **74.2% 的像素是黑边**，带宽/解码/FBO 全在搬运和放大一块黑。
        //   现在按 `wm size` 等比取（长边 ≤1920），实测 `crop=882:1920:0:0`（黑边消失）。
        let dev = adb_screen_size();
        if let Ok(mut g) = DEVICE_PX.lock() {
            *g = dev;   /* ★触摸回传要用物理坐标（决策 #1260） */
        }
        let cmd = match dev.and_then(|(w, h)| capture::pick_capture_size(w, h).map(|s| (w, h, s))) {
            Some((dw, dh, (w, h))) => {
                let br = capture::bitrate_for(w, h);
                eprintln!(
                    "[studio]   录屏 {w}x{h}（设备 {dw}x{dh} · 等比 · 长边≤1920）· {} Mbps",
                    br / 1_000_000
                );
                // ★把预分配尺寸也告诉原生侧（它按 POC_LIVE_W/H 先建纹理）。
                //   不设的话它按默认 1280x720 建，首帧到达再重建一次 —— 一次无谓的
                //   纹理重分配 + 一行"首帧尺寸 ≠ 预设"的告警，看起来像出了问题。
                //   尊重用户显式设置：只在这两个变量为空时才写。
                if std::env::var("POC_LIVE_W").is_err() {
                    std::env::set_var("POC_LIVE_W", w.to_string());
                }
                if std::env::var("POC_LIVE_H").is_err() {
                    std::env::set_var("POC_LIVE_H", h.to_string());
                }
                /* ★必须带 `-s <串号>`（决策 #1265）：不带的话多设备直接
                   "more than one device" —— 而触摸注入一直是带串号的，两条路会打不同设备。 */
                match serial.as_deref() {
                    Some(sn) => format!(
                        "adb -s {sn} exec-out screenrecord --output-format=h264 --size {w}x{h} --bit-rate {br} --time-limit 180 -"
                    ),
                    None => format!(
                        "adb exec-out screenrecord --output-format=h264 --size {w}x{h} --bit-rate {br} --time-limit 180 -"
                    ),
                }
            }
            // ★查不到尺寸时**不带 `--size`**（用设备原生分辨率），而不是退回某个写死的值
            //   —— 写死值正是这次要修的 bug；宁可多花点带宽，也不要一小块画面加一圈黑边。
            None => {
                eprintln!("[studio]   查不到设备尺寸（wm size 失败）⇒ 用设备原生分辨率录屏");
                "adb exec-out screenrecord --output-format=h264 --bit-rate 12000000 --time-limit 180 -"
                    .to_string()
            }
        };
        std::env::set_var("POC_LIVE", cmd);
        eprintln!("[studio] 未指定输入，默认接真机（Android / adb screenrecord）");
        eprintln!("[studio]   想看 iPhone：PROTEUS_IOS_STREAM_PORT=9001 再启动本程序（显式指定优先于本探测）");
        return;
    }
    if std::env::var("PROTEUS_IOS_STREAM").ok().as_deref() == Some("0") {
        eprintln!("[studio] 未检测到 Android 设备；PROTEUS_IOS_STREAM=0 ⇒ 不等待 iOS 推流，画布保持空白");
        return;
    }
    let port = std::env::var("PROTEUS_IOS_STREAM_PORT").unwrap_or_else(|_| "9001".to_string());
    if let Ok(p) = port.parse::<u16>() {
        kill_stale_listeners(p);
    }
    std::env::set_var("POC_LIVE", format!("/usr/bin/nc -l {port}"));
    eprintln!("[studio] 未检测到 Android 设备 ⇒ 改等 iOS 推流（/usr/bin/nc -l {port}）");
    eprintln!("[studio]   iPhone 侧：{}", phone_cmd(None, &port));
    eprintln!("[studio]   不想等：PROTEUS_IOS_STREAM=0");
}

// ─────────────────────────── iOS：最后一公里 ───────────────────────────

/// 清掉端口上**残留的** `nc -l` 监听，返回清掉几个。
///
/// 【为什么必须清（2026-10-26 实测）】本机 lsof 出现过**两个** `nc` 同时 LISTEN 9001：
///   macOS 允许多个监听共存（SO_REUSEPORT 语义），于是**新实例的 nc 也能绑上、也不报错**，
///   但手机那次 TCP 连接可能落到**旧的那个**上——它的 stdout 管道早没人读了，
///   字节到达即被丢弃 ⇒ 用户看到的是"推流明明在跑，画面永远黑"，且**没有任何报错**。
///   这与 Android 侧 `live_kill_stale_capture()`（清设备侧残留 screenrecord）是同一族问题：
///   **长连接类采集源必须先清场，否则"绑上了"不等于"你收到的是这条流"**。
///
/// 【只杀 `nc`】端口是用户可配的（设置面板），万一被别的程序占着，那不是我们的进程——
///   杀它是越权。lsof 的输出里自带 COMMAND 列，按它筛，不需要再跑一次 ps。
pub(crate) fn kill_stale_listeners(port: u16) -> usize {
    let out = match std::process::Command::new("/usr/sbin/lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return 0, // 没有 lsof / 权限不足：不清场，但不影响主流程
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut killed = 0;
    for line in text.lines().skip(1) {
        let mut it = line.split_whitespace();
        let cmd = it.next().unwrap_or("");
        let pid = it.next().unwrap_or("");
        // ★按 basename 精确等于 `nc` 才算（`netcat-openbsd` 之类不算我们的）
        if cmd != "nc" || pid.is_empty() {
            continue;
        }
        if let Ok(p) = pid.parse::<i32>() {
            // 这里**只发 SIGTERM**：nc 没有需要清理的状态，硬杀没必要
            let rc = std::process::Command::new("/bin/kill")
                .args(["-TERM", &p.to_string()])
                .status();
            if rc.map(|s| s.success()).unwrap_or(false) {
                killed += 1;
                eprintln!("[studio]   已清理端口 {port} 上的残留监听（nc pid {p}）");
            }
        }
    }
    killed
}

/// 本机默认路由那块网卡上的 IPv4（手机要连的就是它）。
///
/// ★为什么不是 `gethostname()` 再去解析：那拿到的是 `MacBook-Pro.local`，
///   而手机（尤其 Android）经常解析不了 mDNS 名字 ⇒ 必须给**字面 IP**。
/// ★为什么不扫 `ifconfig` 全部网卡取第一个：本机有 en0~en5 + bridge + utun（VPN），
///   猜错就得到一个"手机永远连不上"的地址。跟着默认路由走才是**唯一**正确的那块。
pub(crate) fn lan_ip() -> Option<String> {
    let out = std::process::Command::new("/sbin/route")
        .args(["-n", "get", "default"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let iface = text
        .lines()
        .find_map(|l| l.trim().strip_prefix("interface:"))?
        .trim()
        .to_string();
    let out = std::process::Command::new("/sbin/ifconfig").arg(&iface).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().find_map(|l| {
        let rest = l.trim().strip_prefix("inet ")?;
        Some(rest.split_whitespace().next()?.to_string())
    })
}

/// 把「手机该在你终端里跑的那条命令」拼出来（**唯一**一份拼装处）。
fn phone_cmd(ip: Option<String>, port: &str) -> String {
    match ip {
        Some(ip) => format!("bash hosts/ios/run-selfdraw.sh --stream={ip}:{port}"),
        None => format!("bash hosts/ios/run-selfdraw.sh --stream=<本机IP>:{port}"),
    }
}

/// `ios_stream_hint` 的载荷：界面把它整段渲染成「iPhone 投屏」引导卡。
#[derive(serde::Serialize)]
pub(crate) struct IosHint {
    /// 本机局域网 IP（拿不到就是 null —— 界面显示占位而不是编一个）
    ip: Option<String>,
    port: u16,
    /// 终端里要跑的一行（含 IP:端口）
    cmd: String,
    /// 端口是不是**已经被本程序占着**（`nc -l` 在跑）
    ///
    /// ★这是"为什么手机上没画面"最常见的答案：端口没人听 / 被人听了但没数据。
    ///   判据只看「有没有进程在 LISTEN」，不用真收到字节（收到字节画布就活了，不需要提示）。
    listening: bool,
    /// 当前采集源**就是** iOS 推流（`POC_LIVE` 是本侧的 `nc -l`）。
    ///
    /// ★界面只在 true 时显示引导卡：Android 投屏时弹一段"请在 iPhone 上运行宿主"是纯噪音。
    ///   判据看 POC_LIVE 而不是"当前选中的设备平台"——用户可能选了 iPhone 但采集源还是 adb
    ///   （比如 `POC_LIVE` 是命令行显式给的），那种情况提示会骗人。
    active: bool,
}

/// 探测某端口是否有进程在 LISTEN（`lsof -nP -iTCP:<port> -sTCP:LISTEN`）。
fn port_listening(port: u16) -> bool {
    std::process::Command::new("/usr/sbin/lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN"])
        .output()
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false)
}

/// 给界面的 iOS 接法提示（决策 #1277）。
///
/// 【为什么非要有个命令】**这一条命令必须在用户自己的终端里跑**——装到真机要
///   `codesign` 访问 login 钥匙串，AI/沙箱环境被拦（实测 `login.keychain-db (file-write)`）。
///   所以界面的职责不是"代跑"，而是**把命令写到用户能复制走**。
#[tauri::command]
pub(crate) fn ios_stream_hint() -> IosHint {
    let port = crate::settings::current().ios_port.unwrap_or(9001);
    // ★端口以设置面板为准（同一份来源），但环境变量仍可能压过它 —— 与 request_ios() 保持同源
    let port = std::env::var("PROTEUS_IOS_STREAM_PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(port);
    let ip = lan_ip();
    IosHint {
        cmd: phone_cmd(ip.clone(), &port.to_string()),
        ip,
        port,
        listening: port_listening(port),
        active: crate::capture_preset::current_kind().as_deref() == Some("ios")
            || std::env::var("POC_LIVE")
                .map(|v| v.starts_with("/usr/bin/nc"))
                .unwrap_or(false),
    }
}
