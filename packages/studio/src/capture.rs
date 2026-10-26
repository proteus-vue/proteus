// packages/studio/src/capture.rs
// 抓屏参数的选择（**纯函数**，无副作用、无设备依赖 ⇒ 可被 `cargo test` 覆盖）。
//
// 【为什么单独一个模块，而不是塞回 main.rs】
//   ① 这些是"输入是什么就输出什么"的计算，和 Tauri/窗口/命令分发无关；
//   ② 它们**能被单测钉住**——而设备相关的部分（adb 能不能连、screenrecord 能不能跑）只能在真机上验。
//      把可测的算干净、把不可测的留一条 eprintln 取证，是这里的分界原则。
//
// 【要修的 bug（2026-10-23 实测）】Studio 原先写死 `--size 1280x720`。
//   Android 的 `screenrecord --size` 是**把整个屏幕塞进给定尺寸**，不足的部分**补黑边**：
//   1200x2608 的竖屏塞进 1280x720 ⇒ 有效画面只有 **330x720**（`cropdetect` 实测），
//   即 **74.2% 的像素是黑边**——带宽、解码、FBO、纹理全在搬运和放大一块 74% 的黑。
//   ⇒ 按设备宽高比取尺寸后实测 `crop=882:1920:0:0`（黑边消失）。

/// 抓屏长边的上限：够看细节，又不至于把 FBO/带宽翻倍（1200x2608 原生是 3.13MP）。
/// 再高的意义只在于"像素级比对"，而那条路需要 native 分辨率与 1:1 档位，是另一件事。
const MAX_LONG_EDGE: u32 = 1920;

/// 位深预算：每像素 8 bit/帧。720p 下 ≈ 7.4 Mbps（与旧的写死 8000000 基本一致 ⇒ 不改变已验证的观感）。
const BITS_PER_PIXEL: u64 = 8;

/// 短边下限：现实中的屏幕短边都 ≥ 240（最小的手表也有 200+）。
/// 比这更小的值是**垃圾输入**（解析错、设备异常），此时返回 `None` 让调用方走"不带 `--size`"的安全兜底。
/// ★为什么要有这条：取偶会在极小尺寸上放大比例误差——单测实测 `3x5` ⇒ `4x6` 偏了 **11%**，
///   而同样的取偶在 1200x2608 上只偏 0.06%。与其"算出一个偏的尺寸"，不如说"我不知道"。
const MIN_EDGE: u32 = 64;

/// 按设备尺寸选一个**等比**的抓屏尺寸（长边 ≤ [`MAX_LONG_EDGE`]，两轴取偶数）。
///
/// 【为什么要偶数】H.264 的 4:2:0 色度是 2×2 下采样 ⇒ 奇数宽高会让编码器拒绝
///   或自动裁掉一行/一列（后者更坏：画面会有一行错位）。
/// 【为什么不放大】长边已在 1920 以内就保持原生：放大只会让带宽增加而细节不变。
/// 返回 `None` = 设备尺寸未知（0），调用方应**不带 `--size`**（让 screenrecord 用原生分辨率），
///   而不是退回某个写死的值——写死值正是这次要修的 bug。
pub fn pick_capture_size(dev_w: u32, dev_h: u32) -> Option<(u32, u32)> {
    if dev_w < MIN_EDGE || dev_h < MIN_EDGE {
        return None;
    }
    let long = dev_w.max(dev_h);
    let scale = if long > MAX_LONG_EDGE {
        MAX_LONG_EDGE as f64 / long as f64
    } else {
        1.0
    };
    Some((
        round_even(dev_w as f64 * scale),
        round_even(dev_h as f64 * scale),
    ))
}

/// 四舍五入到**最近的偶数**（下限 2）。
/// ★不能用 `x as u32 & !1`：那是"向下取偶"，883 会变 882 而不是 884 —— 长边就永远到不了 1920。
pub fn round_even(x: f64) -> u32 {
    (((x / 2.0).round() as u32) * 2).max(2)
}

/// 按像素数给码率（保持"每像素 bit"恒定，而不是换了分辨率还用旧的固定码率）。
/// 上/下限都夹住：太小会糊到看不清文字，太大对局域网/USB 没意义。
pub fn bitrate_for(w: u32, h: u32) -> u32 {
    let bps = (w as u64 * h as u64 * BITS_PER_PIXEL).clamp(4_000_000, 16_000_000);
    // 取整到 100k，日志/命令行更好读
    (bps / 100_000 * 100_000) as u32
}

/// 解析 `adb shell wm size` 的输出。
/// 形如 `Physical size: 1200x2608`，设备改过显示尺寸时还会有 `Override size: 1080x2340`。
/// **Override 优先**：那才是"当前真正在显示的尺寸"（Physical 只是面板物理值）。
pub fn parse_wm_size(out: &str) -> Option<(u32, u32)> {
    let mut physical = None;
    let mut over = None;
    for line in out.lines() {
        let (key, val) = match line.split_once(':') {
            Some(kv) => kv,
            None => continue,
        };
        let dims = match parse_dims(val.trim()) {
            Some(d) => d,
            None => continue,
        };
        if key.trim().eq_ignore_ascii_case("override size") {
            over = Some(dims);
        } else if key.trim().eq_ignore_ascii_case("physical size") {
            physical = Some(dims);
        }
    }
    over.or(physical)
}

fn parse_dims(s: &str) -> Option<(u32, u32)> {
    let (w, h) = s.split_once('x')?;
    let w: u32 = w.trim().parse().ok()?;
    let h: u32 = h.trim().parse().ok()?;
    if w == 0 || h == 0 {
        return None;
    }
    Some((w, h))
}

#[cfg(test)]
mod tests {
    // 测试名用中文（读起来是断言本身），不必迁就 snake_case 检查
    #![allow(non_snake_case)]
    use super::*;

    #[test]
    fn 竖屏长边按上限等比缩放() {
        // 本机实测设备：1200x2608 ⇒ 长边 2608 → 1920，宽 883.4 → 取偶 884
        assert_eq!(pick_capture_size(1200, 2608), Some((884, 1920)));
    }

    #[test]
    fn 长边已在限内则保持原生不放大() {
        assert_eq!(pick_capture_size(1080, 1920), Some((1080, 1920)));
        assert_eq!(pick_capture_size(720, 720), Some((720, 720)));
    }

    #[test]
    fn 横屏与超长屏同样按比例() {
        assert_eq!(pick_capture_size(1920, 1080), Some((1920, 1080)));
        assert_eq!(pick_capture_size(1440, 3200), Some((864, 1920)));
    }

    #[test]
    fn 两轴永远是偶数() {
        for (w, h) in [(811, 1201), (1081, 1921), (241, 331), (1199, 2599)] {
            let (cw, ch) = pick_capture_size(w, h).unwrap();
            assert_eq!(cw % 2, 0, "{w}x{h} ⇒ 宽 {cw} 不是偶数");
            assert_eq!(ch % 2, 0, "{w}x{h} ⇒ 高 {ch} 不是偶数");
            assert!(cw >= 2 && ch >= 2);
            // 比例误差 < 1%（取偶带来的抖动只应在这个量级）
            let e = (cw as f64 / ch as f64) / (w as f64 / h as f64);
            assert!((e - 1.0).abs() < 0.01, "{w}x{h} ⇒ {cw}x{ch} 比例偏了 {e}");
        }
    }

    #[test]
    fn 尺寸未知返回None而不是退回写死值() {
        assert_eq!(pick_capture_size(0, 2608), None);
        assert_eq!(pick_capture_size(1200, 0), None);
        // ★极小值也是"未知"：取偶会把比例放歪（3x5 ⇒ 4x6 偏 11%），宁可走不安全但不会错的兜底
        assert_eq!(pick_capture_size(3, 5), None);
        assert_eq!(pick_capture_size(63, 1200), None);
        assert!(pick_capture_size(64, 1200).is_some());
    }

    #[test]
    fn 码率随像素数走且夹在区间内() {
        // 720p ≈ 7.4 Mbps（与旧的固定 8 Mbps 同量级 ⇒ 已验证的观感不变）
        assert_eq!(bitrate_for(1280, 720), 7_300_000);
        // 884x1920 ≈ 13.5 Mbps
        assert_eq!(bitrate_for(884, 1920), 13_500_000);
        // 极小/极大都被夹住
        assert_eq!(bitrate_for(16, 16), 4_000_000);
        assert_eq!(bitrate_for(7680, 4320), 16_000_000);
    }

    #[test]
    fn 解析wm_size优先Override() {
        assert_eq!(parse_wm_size("Physical size: 1200x2608"), Some((1200, 2608)));
        assert_eq!(
            parse_wm_size("Physical size: 1200x2608\nOverride size: 1080x2340"),
            Some((1080, 2340))
        );
        assert_eq!(parse_wm_size(""), None);
        assert_eq!(parse_wm_size("Physical size: 0x0"), None);
        assert_eq!(parse_wm_size("乱七八糟"), None);
    }
}
