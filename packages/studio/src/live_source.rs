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
    /* ★**上次用的设备优先**（决策 #1308）：用户刚在看模拟器，重开却因为"插着安卓"就跳到安卓，
       这不符合预期。这里先看 `last_device`：若它是模拟器 ⇒ 直接接它（顺带 boot）。
       只有"上次是安卓 / 没记录"时才走下面的 adb 探测。 */
    if let Some(last) = crate::settings::current().last_device.clone() {
        /* 上次用的是 **iPhone 镜像** ⇒ 直接接它（决策 #1316：同样属于"上次设备优先"） */
        if last == "MIRROR-IPHONE" {
            match crate::capture_preset::request_mirror() {
                Ok(_) => return,
                Err(e) => eprintln!("[studio] 接上次的 iPhone 镜像失败：{e}（继续按 adb 探测）"),
            }
        }
        let is_sim = crate::device::sim_serials().iter().any(|s| s == &last);
        if is_sim {
            if let Err(e) = start_simulator(&last) {
                eprintln!("[studio] 接上次的模拟器失败：{e}（继续按 adb 探测）");
            } else {
                return;
            }
        }
    }

    /* `PROTEUS_NO_ADB=1` ⇒ **忽略 adb**，直接走模拟器 / 等 iPhone 推流。
       用途：① 用户只想看模拟器（机器又插着安卓）；② 判据里模拟"没有 adb 设备"的条件。 */
    let skip_adb = std::env::var("PROTEUS_NO_ADB").ok().as_deref() == Some("1");
    let connected = !skip_adb
        && std::process::Command::new("adb")
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
    /* ★没有 adb 设备时，先看**模拟器**（决策 #1307）：
       用户的原话是"为什么你启动的就正常、我从 Finder 打开就空白"——
       因为之前只有"等 iPhone 推流"这一条兜底，模拟器会话必须手动点。
       顺序：上次用过的模拟器 → 任一**已启动**的模拟器。 */
    if let Some(udid) = crate::device::auto_simulator() {
        if let Err(e) = start_simulator(&udid) {
            eprintln!("[studio] 自动接模拟器失败：{e}（继续等 iPhone 推流）");
        } else {
            return;
        }
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

/// 启动/接上一台模拟器（决策 #1308）：boot（幂等）+ 打开 Simulator 窗口 + 拼管道设 `POC_LIVE`。
///
/// ★为什么要 `open -a Simulator` 再等 2.5s：SCK 只认**窗口**，
///   刚 boot 的模拟器窗口还没画出来时 `cast --list` 拿不到窗口 id ⇒ 命令起不来 ⇒ "等待首帧"。
fn start_simulator(udid: &str) -> Result<(), String> {
    /* ★先确保权限（只请求一次），再 boot —— 否则会先拉起模拟器又抓不到窗口，
       而且每轮轮询都弹一次授权对话框（用户实测"打开时一直弹"）。 */
    ensure_screen_capture()?;
    let _ = std::process::Command::new("/usr/bin/xcrun")
        .args(["simctl", "boot", udid])
        .env(
            "DEVELOPER_DIR",
            crate::device::simctl_developer_dir().unwrap_or_default(),
        )
        .output();
    let _ = std::process::Command::new("/usr/bin/open")
        .args(["-a", "Simulator"])
        .output();
    /* ★**轮询等窗口**，不是定时 sleep（决策 #1308 的第二个坑）：
       冷启动时 boot→窗口出现要 5~10s，写死 2.5s 会在窗口还没出来时去 `--list`
       ⇒ 拿不到窗口 id ⇒ 退回 `nc -l` 干等 ⇒ 用户又看到"等待首帧"。
       现在每 500ms 试一次，最多 12s，拿到就继续。 */
    let (cmd, win, dw, dh, _) = crate::capture_preset::sim_pipeline_cmd(udid)?;
    std::env::set_var("POC_LIVE", &cmd);
    crate::capture_preset::set_sim_udid(udid);
    if dw > 0 {
        if let Ok(mut g) = DEVICE_PX.lock() {
            *g = Some((dw, dh));
        }
    }
    eprintln!("[studio] 接上 iOS 模拟器 {udid}（窗口 {win} · {dw}x{dh}）");
    Ok(())
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

// ── iOS 模拟器（决策 #1302）──────────────────────────────────────────────
// 【为什么模拟器比真机好做】真机只能 ReplayKit（变化驱动 ~5fps、无键盘、要签名装机）；
//   模拟器有两条**公开/半公开**的成熟路径：
//     · 画面：ScreenCaptureKit 抓 Simulator 窗口 → 24fps 常驻（kcode 实测 29.5fps vs 逐帧 8fps）
//     · 输入：SimulatorKit 私有 IndigoHID（simctl 没有触摸命令，这是唯一路径）
//   两者都在 `kcode` 仓里有现成 helper（独立进程，吃参数吐字节），本模块只做编排。

/// 找两个 helper（window-cast / sim-hid）。
///
/// 顺序：`PROTEUS_SIM_TOOLS` 显式指定 → 仓库内 `packages/studio/native/sim/bin` →
/// **kcode 仓的预编译产物**（开发期兜底，正式发行应改用前两者）。
pub(crate) fn sim_tools() -> Result<(String, String), String> {
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(p) = std::env::var("PROTEUS_SIM_TOOLS") {
        dirs.push(std::path::PathBuf::from(p));
    }
    if let Ok(root) = std::env::var("PROTEUS_ROOT") {
        dirs.push(std::path::PathBuf::from(root).join("packages/studio/native/sim/bin"));
    }
    // 开发期兜底：kcode 的预编译 helper（与 Studio 同机开发时常见）
    if let Ok(h) = std::env::var("HOME") {
        dirs.push(std::path::PathBuf::from(format!(
            "{h}/work/office/kags/kcode/crates/kcode-desktop/binaries"
        )));
    }
    dirs.push(std::path::PathBuf::from(
        "/Volumes/data1/work/office/kags/kcode/crates/kcode-desktop/binaries",
    ));
    for d in dirs {
        let cast = d.join("kcode-window-cast");
        let hid = d.join("kcode-sim-hid");
        if cast.is_file() && hid.is_file() {
            return Ok((cast.display().to_string(), hid.display().to_string()));
        }
    }
    Err("找不到模拟器 helper（kcode-window-cast / kcode-sim-hid）：设 PROTEUS_SIM_TOOLS 指向它们所在目录".into())
}

/// 找 Simulator 窗口 id：`--list` 输出 `id\t标题\t宽x高`。
///
/// ★为什么按标题找：SCK 只认窗口 id，而 id 每次启动都变，不能写死。
///   多台模拟器同时开时会有多个 `Simulator` 窗口 ⇒ 取**第一个**（当前会话只支持一个）。
/// 跑一个子命令并**限时**（超时就杀掉），返回输出。
///
/// ★为什么必须有超时（决策 #1312）：`kcode-window-cast --list` 在 Studio 里
///   **会一直阻塞不返回**（在终端里跑却正常）。后果是：
///     · "等窗口"永远等不到（日志停在半路，画布空白）；
///     · 每轮轮询都拉起一个卡死的 helper，系统还各弹一次授权框 ⇒ 用户看到"一直弹窗"。
///   ⇒ 所有 helper 调用都必须有上限，超时当作"这次没成功"，让上层重试或报错。
pub(crate) fn run_with_timeout(cmd: &str, args: &[&str], ms: u64) -> Option<std::process::Output> {
    use std::process::{Command, Stdio};
    let mut child = Command::new(cmd)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let (tx, rx) = std::sync::mpsc::channel();
    let pid = child.id();
    std::thread::spawn(move || {
        /* 用子线程等：std 没有 wait_timeout，靠通道 + kill 实现硬上限 */
        std::thread::sleep(std::time::Duration::from_millis(ms));
        let _ = tx.send(pid);
    });
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) => {}
            Err(_) => return None,
        }
        match rx.recv_timeout(std::time::Duration::from_millis(30)) {
            Ok(_) => {
                /* ★★超时**先 TERM 再 **KILL**（决策 #1323）：
                   抓屏子进程背后是系统的 `replayd`（ScreenCaptureKit 的常驻服务）。
                   直接 `kill -9` 会让 SCK 的 XPC 通道处在**半死**状态，
                   症状是"之后所有抓屏都卡住、不报错、也不出帧"——今天整机就这么被我搞挂了两次
                   （`killall replayd` 都救不回来，只能重启）。
                   ⇒ 先发 SIGTERM 让它自己收尾，等 500ms，实在不退才 KILL。 */
                let pid_s = pid.to_string();
                let _ = std::process::Command::new("/bin/kill")
                    .args(["-TERM", &pid_s])
                    .output();
                std::thread::sleep(std::time::Duration::from_millis(500));
                if child.try_wait().ok().flatten().is_none() {
                    let _ = child.kill();
                }
                let _ = child.wait();
                return None; // 超时
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => return None,
        }
    }
}

/// 找 **iPhone 镜像** 窗口（macOS 15+ 的系统功能，决策 #1316）。
///
/// ★为什么用"标题里含镜像"而不是写死 `iPhone镜像`：系统语言不同（英文是 "iPhone Mirroring"），
///   写死中文名在英文系统上会找不到窗口。
pub(crate) fn mirror_window(_cast: &str) -> Result<(u32, u32, u32), String> {
    /* ★用 `CGWindowListCopyWindowInfo`（决策 #1321），**不起子进程、不要权限、毫秒级**：
       helper 的 `--list` 走 SCK，在 Studio 里实测挂满 8s ⇒ 列表那行时有时无。
       只有"抓画面"才需要 helper。 */
    let (mut id, mut w, mut h) = (0u32, 0u32, 0u32);
    let ok = unsafe { poc_find_mirror_window(&mut id, &mut w, &mut h) } == 1;
    if ok && id > 0 && w > 0 {
        Ok((id, w, h))
    } else {
        Err("没有 iPhone 镜像窗口：先打开 iPhone 镜像并连上（手机需锁屏）".into())
    }
}

/// 返回 `(窗口 id, 宽, 高)`——裁剪矩形是按**窗口尺寸**索引的（见 crop.json）
pub(crate) fn sim_window(cast: &str) -> Result<(u32, u32, u32), String> {
    /* ★限时 3s（决策 #1312）：这个 helper 在 Studio 里可能**永久阻塞**，
       不限时就会"等窗口等到天荒地老 + 每轮多弹一次授权框"。 */
    let out = run_with_timeout(cast, &["--list"], 3000)
        .ok_or_else(|| "kcode-window-cast --list 超时（3s 未返回）".to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        let mut it = line.split('\t');
        let id = it.next().unwrap_or("").trim();
        let title = it.next().unwrap_or("").trim();
        let size = it.next().unwrap_or("").trim();
        if title == "Simulator" {
            if let Ok(n) = id.parse::<u32>() {
                let (w, h) = size
                    .split_once('x')
                    .and_then(|(a, b)| Some((a.parse::<u32>().ok()?, b.parse::<u32>().ok()?)))
                    .unwrap_or((0, 0));
                return Ok((n, w, h));
            }
        }
    }
    Err("没找到 Simulator 窗口：先 `open -a Simulator` 把模拟器窗口打开".into())
}

/// 等 Simulator 窗口出现（最多 `ms` 毫秒），返回 `(id, w, h)`。
///
/// ★为什么手动点击那条路也必须等（决策 #1309）：用户点设备行时若模拟器正冷启动，
///   窗口还没出来 ⇒ `--list` 里没有它 ⇒ 报"没找到 Simulator 窗口"，而窗口两秒后就出现了。
///   只有启动路径有轮询是不够的——**两条路必须同一套等待**。
extern "C" {
    /// 见 `native/embed_view.m`：屏幕录制权限是否已授予
    fn poc_screen_capture_granted() -> i32;
    /// 见 `native/embed_view.m`：请求一次授权（系统对话框只弹一次）
    fn poc_request_screen_capture();
}

/// 屏幕录制权限（macOS TCC）。没有它时 SCK **拿不到任何窗口**，
/// 但表现是"窗口不存在"——所以每个"找不到窗口"的错误都要先分辨这一点。
pub(crate) fn screen_capture_granted() -> bool {
    unsafe { poc_screen_capture_granted() == 1 }
}

/// 确保有屏幕录制权限：没有就**只请求一次**并返回 Err（附可执行的引导）。
///
/// ★为什么必须这样（决策 #1311）：没有权限时，任何一次 SCK 调用都会弹一次系统对话框；
///   而"等窗口"是每 500ms 轮询一次 ⇒ 弹窗连环，用户看到的是"打开应用时一直弹"。
///   所以：**先查 → 只请求一次 → 没权限立刻停**，把"去设置勾选并重启"直接说清楚。
pub(crate) fn ensure_screen_capture() -> Result<(), String> {
    if screen_capture_granted() {
        return Ok(());
    }
    unsafe { poc_request_screen_capture() };
    Err("需要「屏幕录制」权限：系统设置 → 隐私与安全性 → 屏幕录制 → 勾选 Proteus Studio，\
         然后重启本应用（只授权一次，之后不再询问）"
        .into())
}

pub(crate) fn sim_window_wait(cast: &str, ms: u64) -> Result<(u32, u32, u32), String> {
    /* ★先确保权限（决策 #1311）：没权限时每次 `--list` 都会弹一次系统对话框 */
    ensure_screen_capture()?;
    let mut waited = 0u64;
    loop {
        if let Ok(w) = sim_window(cast) {
            return Ok(w);
        }
        if waited >= ms {
            /* ★先分辨"没权限"（决策 #1309）：没授权时 SCK 看不到任何窗口，
               原来会报"找不到模拟器窗口"——把用户引到完全错误的方向。 */
            if !screen_capture_granted() {
                return Err("缺少「屏幕录制」权限：系统设置 → 隐私与安全性 → 屏幕录制 → \
                     勾选 Proteus Studio，然后**重启本应用**（改签名后需要重新授权）"
                    .into());
            }
            return Err(format!(
                "找不到 Simulator 窗口（等了 {}s）：把模拟器窗口打开/别最小化，再点一次",
                ms / 1000
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
        waited += 500;
    }
}

/// 读 `native/sim/crop.json` 里对应窗口尺寸的裁剪矩形 `(x, y, w, h)`。
///
/// 【为什么按窗口尺寸索引】矩形 = 设备区在**窗口帧**里的位置，窗口一改（用户拖动改大小）
///   标题栏占比就变 ⇒ 必须按尺寸分别标定；没标过就返回 None（**退回不裁剪**）。
///   ★纪律：宁可画面多一圈 chrome，也不能裁错——裁掉屏幕会让点击整体偏移（kcode 的教训）。
pub(crate) fn sim_crop_rect(win_w: u32, win_h: u32, out_w: u32) -> Option<(u32, u32, u32, u32)> {
    let root = crate::ios_stream::find_root()?;
    let file = root.join("packages/studio/native/sim/crop.json");
    let text = std::fs::read_to_string(&file).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let e = v.get(format!("{win_w}x{win_h}"))?;
    let g = |k: &str| e.get(k).and_then(|x| x.as_u64()).map(|x| x as u32);
    /* ★按**实际输出宽度**缩放（决策 #1305）：标定是在 448 宽下做的，而清晰度要求
       我们把帧宽提到 896 ⇒ 矩形必须等比放大，否则会裁到中间一小块。 */
    let frame_w = e
        .get("frame")
        .and_then(|f| f.as_str())
        .and_then(|f| f.split_once('x'))
        .and_then(|(a, _)| a.parse::<u32>().ok())
        .unwrap_or(448);
    let k = if frame_w > 0 { out_w as f64 / frame_w as f64 } else { 1.0 };
    let sc = |v: u32| ((v as f64 * k).round() as u32).max(1);
    Some((sc(g("x")?), sc(g("y")?), sc(g("w")?), sc(g("h")?)))
}

/// 注入一次点击（归一化 0..1，与 iOS 真机那条通道**同一套坐标语义**）。
pub(crate) fn sim_tap(udid: &str, nx: f64, ny: f64) -> Result<(), String> {
    let (_cast, hid) = sim_tools()?;
    /* ★必须带 `--developer-dir`（决策 #1302）：helper 默认用 `xcode-select -p`，
       本机指到 CommandLineTools（没有 SimulatorKit）⇒ 报"没有 IndigoHIDMessageForMouseNSEvent"。
       Studio 已经用"真跑过一次"的方式选出了可用的 Xcode，这里直接复用。 */
    let dev = crate::device::simctl_developer_dir().unwrap_or_default();
    let out = std::process::Command::new(&hid)
        .args(["tap", udid, &format!("{nx:.5}"), &format!("{ny:.5}")])
        .args(["--developer-dir", &dev])
        .output()
        .map_err(|e| format!("跑 sim-hid 失败：{e}"))?;
    if out.status.success() {
        eprintln!("[sim] → tap {nx:.3},{ny:.3}");
        Ok(())
    } else {
        Err(format!(
            "sim-hid tap 失败：{}",
            String::from_utf8_lossy(&out.stderr).lines().rev().take(2).collect::<Vec<_>>().join(" / ")
        ))
    }
}

/// 注入一次滑动（同上，归一化；`--edge` 用于边缘手势——iOS 那是硬要求）
pub(crate) fn sim_swipe(udid: &str, nx: f64, ny: f64, dx: f64, dy: f64, ms: u64) -> Result<(), String> {
    let (_cast, hid) = sim_tools()?;
    let (x2, y2) = ((nx + dx).clamp(0.0, 1.0), (ny + dy).clamp(0.0, 1.0));
    /* ★★边缘手势必须带 `--edge`（决策 #1306）：iOS 的"上滑回桌面 / 边缘返回"是从**屏幕边缘**
       起手的系统手势，SimulatorKit 要显式告诉它"这一划从底边/左边开始"，否则
       **完全无效**（表现为"怎么划都回不到桌面"）。kcode 的笔记里写得很清楚：
       第 7 参 edge 1=左 / 3=下，不按落点标就会失效。 */
    let edge = if ny > 0.90 && dy < 0.0 {
        Some("3") // 底部上滑：回桌面
    } else if nx < 0.06 && dx > 0.0 {
        Some("1") // 左缘右滑：返回
    } else {
        None
    };
    let mut args: Vec<String> = vec![
        "swipe".into(),
        udid.into(),
        format!("{nx:.5}"),
        format!("{ny:.5}"),
        format!("{x2:.5}"),
        format!("{y2:.5}"),
        "--duration".into(),
        ms.to_string(),
        "--developer-dir".into(),
        crate::device::simctl_developer_dir().unwrap_or_default(),
    ];
    if let Some(e) = edge {
        args.push("--edge".into());
        args.push(e.into());
        eprintln!("[sim] 边缘手势 edge={e}（从 {nx:.2},{ny:.2} 划到 {x2:.2},{y2:.2}）");
    }
    let out = std::process::Command::new(&hid)
        .args(&args)
        .output()
        .map_err(|e| format!("跑 sim-hid 失败：{e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "sim-hid swipe 失败：{}",
            String::from_utf8_lossy(&out.stderr).lines().rev().take(2).collect::<Vec<_>>().join(" / ")
        ))
    }
}

/// 模拟器屏幕的**设备像素尺寸**：`simctl io screenshot` 落一张 PNG，读 IHDR（第 16..24 字节）。
///
/// ★为什么要它：窗口捕获到的是"含标题栏的窗口"，与设备屏幕比例不同；
///   `window-cast` 按 `--device-aspect` 裁掉标题栏。比例必须来自**设备真实尺寸**，
///   不能从窗口推（这正是 kcode 记下的"帧尺寸 ≠ 设备尺寸"那个坑）。
pub(crate) fn sim_screen_size(udid: &str) -> Option<(u32, u32)> {
    let tmp = std::env::temp_dir().join(format!("proteus-sim-{}.png", std::process::id()));
    let ok = std::process::Command::new("/usr/bin/xcrun")
        .args(["simctl", "io", udid, "screenshot", "--type=png", &tmp.display().to_string()])
        /* ★同 device.rs：用"真的能跑 simctl"的那套 Xcode（CLT 没有 simctl） */
        .env(
            "DEVELOPER_DIR",
            crate::device::simctl_developer_dir().unwrap_or_default(),
        )
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !ok {
        return None;
    }
    let bytes = std::fs::read(&tmp).ok()?;
    let _ = std::fs::remove_file(&tmp);
    if bytes.len() < 24 || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let h = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    Some((w, h))
}

/// ffmpeg 路径：设置/环境变量优先，回落到 Homebrew 常见位置。
pub(crate) fn ffmpeg_bin() -> String {
    if let Ok(p) = std::env::var("PROTEUS_FFMPEG") {
        if std::path::Path::new(&p).is_file() {
            return p;
        }
    }
    for p in ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"] {
        if std::path::Path::new(p).is_file() {
            return p.to_string();
        }
    }
    "ffmpeg".into()
}

// ── iPhone 镜像的输入（决策 #1318）──────────────────────────────────────────
// 【为什么不需要私有 API】镜像窗口就是普通 macOS 窗口 ⇒ 用公开的 CGEvent 往它投鼠标事件，
//   Apple 自己把事件转成真机触摸。这比 WDA（HTTP + XCTest，百毫秒级）快得多，也不需要装 runner。
// 【为什么必须先查辅助功能】没有授权时 CGEvent 被系统**静默丢弃**（无报错），
//   用户只会看到"点了没反应"。所以先查 → 没有就请求一次 → 仍然没有就明确报错。

extern "C" {
    fn poc_find_mirror_window(out_id: *mut u32, out_w: *mut u32, out_h: *mut u32) -> i32;
    fn poc_place_mirror_window(win: u32, margin: i32) -> i32;
    fn poc_mirror_click(win: u32, nx: f64, ny: f64) -> i32;
    fn poc_mirror_drag(win: u32, x1: f64, y1: f64, x2: f64, y2: f64, ms: i32) -> i32;
    fn poc_mirror_scroll(win: u32, nx: f64, ny: f64, dy: f64) -> i32;
    fn poc_mirror_scroll_begin(win: u32, nx: f64, ny: f64) -> i32;
    fn poc_mirror_scroll_post(win: u32, nx: f64, ny: f64, dy: f64) -> i32;
    fn poc_mirror_scroll_end() -> i32;
    fn poc_accessibility_granted() -> i32;
    fn poc_request_accessibility();
}

/// 当前镜像窗口信息 `(id, w, h, 登记时间ms)`（`request_mirror` 时登记）。
///
/// ★★为什么要缓存（决策 #1320）：`window-cast --list` 在 Studio 里**偶发阻塞**（同 #1312），
///   一旦超时就被当成"没有窗口" ⇒ 设备列表那行**消失**、再选中就报"不在列表里"，
///   而画面其实还在正常投（用户实测）。⇒ 连接成功后把信息记下来，列表/选中**不再依赖实时 --list**。
pub(crate) static MIRROR_WIN: std::sync::Mutex<Option<(u32, u32, u32, u64)>> =
    std::sync::Mutex::new(None);

/// 把镜像窗口挪到右下角（避免它和 Studio 抢地方；它必须留在屏幕上才点得到）
pub(crate) fn place_mirror_window(win: u32) {
    let rc = unsafe { poc_place_mirror_window(win, 24) };
    if rc != 0 {
        eprintln!("[studio] 挪动镜像窗口失败（code {rc}）——需要「辅助功能」权限，不影响画面");
    } else {
        eprintln!("[studio] 镜像窗口已挪到右下角（保持可见以便点击）");
    }
}

pub(crate) fn set_mirror_window(win: u32, w: u32, h: u32) {
    if let Ok(mut g) = MIRROR_WIN.lock() {
        *g = Some((win, w, h, now_ms()));
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 取缓存的镜像窗口 `(id, w, h)`；`ttl_ms` 内有效（0 = 只要非空就返回）。
pub(crate) fn mirror_cached(ttl_ms: u64) -> Option<(u32, u32, u32)> {
    let g = MIRROR_WIN.lock().ok()?;
    let (win, w, h, ts) = (*g)?;
    if ttl_ms == 0 || now_ms().saturating_sub(ts) <= ttl_ms {
        Some((win, w, h))
    } else {
        None
    }
}

fn mirror_win() -> Result<u32, String> {
    /* ★必须校验 `win > 0`：`mirror_device()` 在只知道尺寸时会以 id=0 缓存一条，
       那是"列表展示用"的记录，**不能**拿去投递事件（否则永远 -3）。 */
    mirror_cached(0)
        .filter(|(w, _, _)| *w > 0)
        .map(|(w, _, _)| w)
        .ok_or_else(|| "还没接上 iPhone 镜像（先在设备列表里选「iPhone 镜像」）".to_string())
}

/// 确保有「辅助功能」权限：没有就**只请求一次**并返回可执行引导。
pub(crate) fn ensure_accessibility() -> Result<(), String> {
    if unsafe { poc_accessibility_granted() } == 1 {
        return Ok(());
    }
    unsafe { poc_request_accessibility() };
    Err("需要「辅助功能」权限：系统设置 → 隐私与安全性 → 辅助功能 → 勾选 Proteus Studio，然后重启本应用"
        .into())
}

pub(crate) fn mirror_click(nx: f64, ny: f64) -> Result<(), String> {
    let win = mirror_win()?;
    ensure_accessibility()?;
    match unsafe { poc_mirror_click(win, nx, ny) } {
        0 => {
            eprintln!("[mirror] → click {nx:.3},{ny:.3}");
            Ok(())
        }
        -2 => Err("缺少「辅助功能」权限（事件被系统丢弃）".into()),
        -1 => Err("拿不到镜像窗口的位置（窗口被关掉/最小化？）".into()),
        -3 => Err("找不到镜像窗口的进程（镜像已断开？）".into()),
        c => Err(format!("镜像点击失败（code {c}）")),
    }
}

pub(crate) fn mirror_drag(nx: f64, ny: f64, dx: f64, dy: f64, ms: u64) -> Result<(), String> {
    let win = mirror_win()?;
    ensure_accessibility()?;
    let (x2, y2) = ((nx + dx).clamp(0.0, 1.0), (ny + dy).clamp(0.0, 1.0));
    match unsafe { poc_mirror_drag(win, nx, ny, x2, y2, ms as i32) } {
        0 => {
            eprintln!("[mirror] → drag {nx:.3},{ny:.3} → {x2:.3},{y2:.3}（{ms}ms）");
            Ok(())
        }
        -2 => Err("缺少「辅助功能」权限（事件被系统丢弃）".into()),
        -1 => Err("拿不到镜像窗口的位置（窗口被关掉/最小化？）".into()),
        -3 => Err("找不到镜像窗口的进程（镜像已断开？）".into()),
        c => Err(format!("镜像滑动失败（code {c}）")),
    }
}

/// 滚轮 → 镜像窗口（决策 #1327）。`dy` 是浏览器 `deltaY` 的语义（正 = 向下滚）。
pub(crate) fn mirror_scroll(nx: f64, ny: f64, dy: f64) -> Result<(), String> {
    let win = mirror_win()?;
    ensure_accessibility()?;
    match unsafe { poc_mirror_scroll(win, nx, ny, dy) } {
        0 => Ok(()),
        -2 => Err("缺少「辅助功能」权限（事件被系统丢弃）".into()),
        -3 => Err("找不到镜像窗口的进程（镜像已断开？）".into()),
        -1 => Err("拿不到镜像窗口的位置（窗口被关掉/最小化？）".into()),
        c => Err(format!("镜像滚动失败（code {c}）")),
    }
}

/// 滚动会话：开始（一次性准备：藏指针 + 激活 + 停到目标点）
pub(crate) fn mirror_scroll_begin(nx: f64, ny: f64) -> Result<(), String> {
    let win = mirror_win()?;
    ensure_accessibility()?;
    match unsafe { poc_mirror_scroll_begin(win, nx, ny) } {
        0 => Ok(()),
        -2 => Err("缺少「辅助功能」权限（事件被系统丢弃）".into()),
        -3 => Err("找不到镜像窗口的进程（镜像已断开？）".into()),
        -1 => Err("拿不到镜像窗口的位置（窗口被关掉/最小化？）".into()),
        c => Err(format!("滚动会话开始失败（code {c}）")),
    }
}

/// 滚动会话：投递一次（只发滚动事件，~1ms）
pub(crate) fn mirror_scroll_post(nx: f64, ny: f64, dy: f64) -> Result<(), String> {
    let win = mirror_win()?;
    match unsafe { poc_mirror_scroll_post(win, nx, ny, dy) } {
        0 => Ok(()),
        -5 => Ok(()), /* 会话已结束（正常竞态），忽略 */
        c => Err(format!("滚动投递失败（code {c}）")),
    }
}

/// 滚动会话：结束（还原指针与焦点）
pub(crate) fn mirror_scroll_end() {
    unsafe { poc_mirror_scroll_end() };
}
