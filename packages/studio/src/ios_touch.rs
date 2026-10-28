// ios_touch.rs —— 触控回传：Studio 监听控制端口，手机反向连上来（决策 #1295）
//
// 【为什么是"手机连 Mac"而不是"Mac 连手机"】
//   和推流同向：iOS 上手机没有稳定的入站监听，Mac 也不知道手机的 IP；
//   而手机**知道** Mac 的 IP（推流地址就是它）⇒ 让手机主动连过来最省事，也天然穿过同一张 Wi-Fi。
//
// 【协议】一行一条 JSON（`\n` 结尾），坐标是**归一化 0..1**（相对画面）：
//     {"t":"tap","nx":0.5,"ny":0.15}
//     {"t":"longpress","nx":0.5,"ny":0.30}
//     {"t":"swipe","nx":0.5,"ny":0.8,"dx":0,"dy":-0.4}
//   ★为什么不发像素/逻辑点：帧是 888×1920（像素），注入要 390×844（逻辑点），中间还有系统缩放。
//     传归一化，宿主乘自己的 `bounds` ⇒ **两端都不用猜 scale**（实测 0.5/0.15 → tap@195,126.6 ✓）。
//
// 【边界：这不是系统级触控】只能注入到**我们自己的宿主 app 内**（桌面/别的 app 不行）——
//   iOS 没有公开的系统级注入 API。详见 host 侧 `touch-control.swift` 文件头。
use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::Emitter;

static CONN: Mutex<Option<TcpStream>> = Mutex::new(None);
static LISTENING: AtomicBool = AtomicBool::new(false);

/// 监听控制端口（幂等）。手机连上来后替换旧连接（重连即生效）。
///
/// ★用 `0.0.0.0`：手机在局域网另一台机器上，绑 127.0.0.1 会连不上。
pub(crate) fn ensure_listening(app: tauri::AppHandle, port: u16) {
    if LISTENING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let listener = match TcpListener::bind(("0.0.0.0", port)) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[touch] 监听 {port} 失败：{e}（端口被占用？）");
                LISTENING.store(false, Ordering::SeqCst);
                return;
            }
        };
        eprintln!("[touch] 控制通道监听 :{port}（等手机连上来）");
        for conn in listener.incoming() {
            match conn {
                Ok(s) => {
                    if let Ok(peer) = s.peer_addr() {
                        eprintln!("[touch] 手机已连接 {peer}");
                    }
                    if let Ok(mut g) = CONN.lock() {
                        *g = Some(s);
                    }
                    let _ = app.emit("ios:touch", true);
                }
                Err(e) => {
                    eprintln!("[touch] accept 失败：{e}（继续监听）");
                }
            }
        }
    });
}

/// 发一行 JSON。未连接时给**明确错误**（而不是静默失败）。
fn send_line(v: serde_json::Value) -> Result<(), String> {
    let mut guard = CONN.lock().map_err(|_| "触控连接锁中毒".to_string())?;
    let s = guard.as_mut().ok_or_else(|| {
        "触控通道还没连上：手机端的推流要先用「投屏到这台 iPhone」启动一次".to_string()
    })?;
    let mut line = serde_json::to_string(&v).map_err(|e| e.to_string())?;
    line.push('\n');
    s.write_all(line.as_bytes())
        .map_err(|e| format!("触控指令发送失败：{e}"))?;
    s.flush().ok();
    Ok(())
}

pub(crate) fn tap(nx: f64, ny: f64) -> Result<(), String> {
    /* ★iPhone 镜像：走 CGEvent 投递到镜像窗口（决策 #1318） */
    if crate::capture_preset::current_kind().as_deref() == Some("mirror") {
        return crate::live_source::mirror_click(nx, ny);
    }
    /* ★模拟器走本地 helper（归一化坐标同一套语义），真机才走 TCP 通道（决策 #1302） */
    if let Some(udid) = crate::capture_preset::sim_udid() {
        let r = crate::live_source::sim_tap(&udid, nx, ny);
        eprintln!("[touch] → sim tap {nx:.3},{ny:.3} ok={}", r.is_ok());
        return r;
    }
    let r = send_line(serde_json::json!({"t": "tap", "nx": nx, "ny": ny}));
    /* ★发送侧必须留痕（决策 #1299）：用户报"点了没反应"时，第一件要分清的是
       **指令有没有发出去**。只有宿主的日志不够——那样分不清"没发"与"发了没命中"。 */
    match &r {
        Ok(()) => eprintln!("[touch] → tap nx={nx:.3} ny={ny:.3}（已发送）"),
        Err(e) => eprintln!("[touch] ✗ tap 发送失败：{e}"),
    }
    r
}

pub(crate) fn longpress(nx: f64, ny: f64) -> Result<(), String> {
    if crate::capture_preset::current_kind().as_deref() == Some("mirror") {
        /* 镜像没有"长按"API：用原地按住 600ms 的拖拽等价表达 */
        return crate::live_source::mirror_drag(nx, ny, 0.0, 0.0, 600);
    }
    if let Some(udid) = crate::capture_preset::sim_udid() {
        /* sim-hid 没有 longpress：用"原地按住 600ms"的 swipe 等价表达 */
        return crate::live_source::sim_swipe(&udid, nx, ny, 0.0, 0.0, 600);
    }
    let r = send_line(serde_json::json!({"t": "longpress", "nx": nx, "ny": ny}));
    eprintln!("[touch] → longpress nx={nx:.3} ny={ny:.3} ok={}", r.is_ok());
    r
}

pub(crate) fn swipe(nx: f64, ny: f64, dx: f64, dy: f64) -> Result<(), String> {
    if crate::capture_preset::current_kind().as_deref() == Some("mirror") {
        let dist = (dx * dx + dy * dy).sqrt();
        let ms = (60.0 + dist * 400.0).clamp(80.0, 600.0) as u64;
        return crate::live_source::mirror_drag(nx, ny, dx, dy, ms);
    }
    if let Some(udid) = crate::capture_preset::sim_udid() {
        /* 时长取位移长度估一个（宿主侧 pan 用真实时长，这里够用） */
        let dist = (dx * dx + dy * dy).sqrt();
        let ms = (60.0 + dist * 400.0).clamp(80.0, 600.0) as u64;
        return crate::live_source::sim_swipe(&udid, nx, ny, dx, dy, ms);
    }
    send_line(serde_json::json!({"t": "swipe", "nx": nx, "ny": ny, "dx": dx, "dy": dy}))
}

pub(crate) fn connected() -> bool {
    /* 模拟器 / 镜像都不需要 TCP 通道（本地 helper / CGEvent 直接调） */
    if crate::capture_preset::sim_udid().is_some()
        || crate::capture_preset::current_kind().as_deref() == Some("mirror")
    {
        return true;
    }
    CONN.lock().map(|g| g.is_some()).unwrap_or(false)
}

// ── IPC ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn ios_tap(nx: f64, ny: f64) -> Result<(), String> {
    tap(nx, ny)
}

/// 滚轮注入（决策 #1327）：镜像走真实滚轮，模拟器/安卓用短滑动近似。
#[tauri::command]
pub(crate) fn ios_scroll(nx: f64, ny: f64, dy: f64, phase: String) -> Result<(), String> {
    scroll(&phase, nx, ny, dy)
}

#[tauri::command]
pub(crate) fn ios_longpress(nx: f64, ny: f64) -> Result<(), String> {
    longpress(nx, ny)
}

#[tauri::command]
pub(crate) fn ios_swipe(nx: f64, ny: f64, dx: f64, dy: f64) -> Result<(), String> {
    swipe(nx, ny, dx, dy)
}

#[tauri::command]
pub(crate) fn ios_touch_state() -> bool {
    connected()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 未连接时给出明确错误而不是静默() {
        if let Ok(mut g) = CONN.lock() {
            *g = None;
        }
        let e = tap(0.5, 0.5).unwrap_err();
        assert!(e.contains("还没连上"), "错误文案要能指导用户：{e}");
        assert!(!connected());
    }

    #[test]
    fn 协议字段与宿主一致() {
        let v = serde_json::json!({"t": "swipe", "nx": 0.5, "ny": 0.8, "dx": 0.0, "dy": -0.4});
        let s = serde_json::to_string(&v).unwrap();
        assert!(s.contains("\"t\":\"swipe\""));
        assert!(s.contains("\"dy\":-0.4"));
    }
}

/// 滚轮 → 手势（决策 #1327）。
///
/// 三种源的处理不同：
/// - **镜像**：直接投滚轮事件（镜像 app 会转成手机上下滑，最接近真实）；
/// - **模拟器/安卓**：没有滚轮 API，用一次**短滑动**近似（`dy>0` 向下滚 ⇒ 手指向上划）。
pub(crate) fn scroll(phase: &str, nx: f64, ny: f64, dy: f64) -> Result<(), String> {
    if crate::capture_preset::current_kind().as_deref() == Some("mirror") {
        /* ★★镜像源**不支持滚轮**（决策 #1337，实测三轮后确认的能力边界）：
           已试尽三条路，全部不成立：
             ① `CGEventPostToPid` + 完整"连续滚动"字段（IsContinuous/PointDelta/FixedPtDelta/窗口号）
                ⇒ 镜像 app **直接忽略**（指针不动，页面也不动）；
             ② HID `CGEventPost` + 事件坐标（想"不移动指针"）
                ⇒ **指针被带到事件坐标**，且镜像把滚轮当鼠标事件、页面仍不滚；
             ③ 合成一次拖动（等价手指滑） ⇒ 镜像**不把鼠标拖动当滚动**（用户指出）。
           ⇒ 明确报错（UI 提示一次后停止再发），不再伪装支持。
           想滚：直接在镜像窗口里滚（原生丝滑），或切「iOS 模拟器」源（那边用短滑动近似）。 */
        let _ = (phase, nx, ny, dy);
        return Err("镜像源不支持滚轮（macOS 限制）：请直接在镜像窗口里滚动，或切到「iOS 模拟器」源"
            .into());
    }
    if phase != "post" {
        return Ok(()); /* 模拟器/安卓没有会话概念，只处理 post */
    }
    /* 把"滚轮像素"折成"滑动比例"：经验系数 1/900，单次最多 0.35（免得一滚就飞到底） */
    let travel = (dy / 900.0).clamp(-0.35, 0.35);
    if travel.abs() < 0.005 {
        return Ok(()); /* 太小就忽略，避免高频细碎事件 */
    }
    swipe(nx, ny, 0.0, -travel)
}
