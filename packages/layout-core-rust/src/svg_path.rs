// packages/layout-core-rust/src/svg_path.rs —— ★★**SVG 路径解析与弧长**（C2，2026-10-01）
//
// 【为什么在内核（不是各宿主自己解析）】`d` 字符串（`M10,20 L30,40 C… Z`）是 **SVG 语义**：
//   若 Swift 与 Java 各写一份解析器，两端就会在**浮点/隐含命令/相对坐标**等细节上分叉
//   （本仓纪律 #22：第 N 份手写副本 = 下一个静默缺陷）。⇒ 解析**只在内核做一次**，
//   宿主只把**归一化的段列表**翻译成平台 API（`CGPath` / `android.graphics.Path`）。
//
// 【归一化到什么】把 `d` 展开成**只含绝对坐标**的段序列：
//   · `M x y`（moveTo）· `L x y`（lineTo）· `C x1 y1 x2 y2 x y`（三次贝塞尔）
//   · `Q x1 y1 x y`（二次贝塞尔）· `Z`（闭合）
//   相对命令（小写 `m/l/c/q`）与隐含重复（`L` 后跟多组坐标）在这里**全部展开**——
//   宿主拿到的永远是"显式、绝对、单动"的段。
//
// 【弧长（画线动画的前提）】每段给出**长度**（贝塞尔用 16 段折线近似——
//   与 CSS `stroke-dasharray` 的实现同量级精度；误差 ~1e-3 相对量，视觉不可辨）。
//   `total_len` 是进度通道（`strokeProgress` 0..1）换算成"画到哪"的依据。
//
// 【诚实边界】v1 只支持 M/L/C/Q/Z（覆盖主流图标/插画路径的绝大多数）；
//   `A`（弧）与 `S/T`（平滑曲线）**明确拒绝**（消息给修法：先转成 C/Q——设计工具导出时可选）。
//   多子路径（多个 M）支持：宿主侧按 M 分段绘制。

/// 归一化段（绝对坐标；`Close` 表示 Z）
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum PathSeg {
    MoveTo(f32, f32),
    LineTo(f32, f32),
    /// 三次贝塞尔（两个控制点 + 终点）
    CubicTo(f32, f32, f32, f32, f32, f32),
    /// 二次贝塞尔（一个控制点 + 终点）
    QuadTo(f32, f32, f32, f32),
    Close,
}

/// 解析结果：段列表 + 总弧长（供 `strokeProgress` 通道换算）+ 各段累计起点弧长
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SvgPath {
    pub segs: Vec<PathSeg>,
    /// 含 MoveTo 的**前缀弧长**表（`prefix_len[i]` = 第 i 段**结束**时的累计长度；
    /// MoveTo 不贡献长度 ⇒ 用它可以把"画线进度"精确定位到某段内部）
    pub prefix_len: Vec<f32>,
    pub total_len: f32,
}

/// 把 `d` 字符串解析为归一化路径
///
/// 支持：`M/m L/l H/h V/v C/c Q/q Z/z`（绝对与相对、隐含重复命令）
/// 拒绝（明确报错，不静默跳过）：`A/a`（弧）/ `S/s T/t`（平滑曲线）/ 未知命令 / 参数缺失
pub fn parse_svg_path(d: &str) -> Result<SvgPath, String> {
    let toks = tokenize(d)?;
    let mut i = 0usize;
    let mut segs: Vec<PathSeg> = Vec::new();
    // 当前点（隐含命令与相对坐标的基准）
    let (mut cx, mut cy) = (0.0f32, 0.0f32);
    // 子路径起点（Z 之后回到它；相对 `m` 也以它为基准）
    let (mut sx, mut sy) = (0.0f32, 0.0f32);
    // 上一命令（用于"隐含重复"：`M x y x2 y2` 的第二组是 L）
    let mut prev_cmd: Option<char> = None;
    while i < toks.len() {
        let cmd = match toks[i] {
            Tok::Cmd(c) => {
                i += 1;
                prev_cmd = Some(c);
                c
            }
            Tok::Num(_) => {
                // 隐含命令：M/m 之后是 L/l（SVG 规范）；其余沿用上一命令
                match prev_cmd {
                    Some('M') => 'L',
                    Some('m') => 'l',
                    Some(c) => c,
                    None => return Err("路径以数字开头（缺少命令，如 'M'）".to_string()),
                }
            }
        };
        // 取 n 个数字
        let mut take = |n: usize, i: &mut usize| -> Result<Vec<f32>, String> {
            let mut out = Vec::with_capacity(n);
            for _ in 0..n {
                match toks.get(*i) {
                    Some(Tok::Num(v)) => {
                        out.push(*v);
                        *i += 1;
                    }
                    _ => {
                        return Err(format!(
                            "命令 {cmd} 的参数不足（需要 {n} 个数字，在位置 {} 处中断）",
                            *i
                        ))
                    }
                }
            }
            Ok(out)
        };
        let rel = cmd.is_ascii_lowercase();
        let up = cmd.to_ascii_uppercase();
        let dx = if rel { cx } else { 0.0 };
        let dy = if rel { cy } else { 0.0 };
        match up {
            'M' => {
                let v = take(2, &mut i)?;
                let (x, y) = (v[0] + dx, v[1] + dy);
                segs.push(PathSeg::MoveTo(x, y));
                cx = x;
                cy = y;
                // 新子路径起点（后续 Z 回到这里）
                sx = x;
                sy = y;
                if rel {
                    prev_cmd = Some('l'); // 相对 m 的后续隐含是 l
                } else {
                    prev_cmd = Some('L');
                }
            }
            'L' => {
                let v = take(2, &mut i)?;
                let (x, y) = (v[0] + dx, v[1] + dy);
                segs.push(PathSeg::LineTo(x, y));
                cx = x;
                cy = y;
            }
            'H' => {
                let v = take(1, &mut i)?;
                let x = v[0] + if rel { cx } else { 0.0 };
                segs.push(PathSeg::LineTo(x, cy));
                cx = x;
            }
            'V' => {
                let v = take(1, &mut i)?;
                let y = v[0] + if rel { cy } else { 0.0 };
                segs.push(PathSeg::LineTo(cx, y));
                cy = y;
            }
            'C' => {
                let v = take(6, &mut i)?;
                let (x1, y1) = (v[0] + dx, v[1] + dy);
                let (x2, y2) = (v[2] + dx, v[3] + dy);
                let (x, y) = (v[4] + dx, v[5] + dy);
                segs.push(PathSeg::CubicTo(x1, y1, x2, y2, x, y));
                cx = x;
                cy = y;
            }
            'Q' => {
                let v = take(4, &mut i)?;
                let (x1, y1) = (v[0] + dx, v[1] + dy);
                let (x, y) = (v[2] + dx, v[3] + dy);
                segs.push(PathSeg::QuadTo(x1, y1, x, y));
                cx = x;
                cy = y;
            }
            'Z' => {
                segs.push(PathSeg::Close);
                cx = sx;
                cy = sy;
            }
            'A' => {
                return Err(
                    "SVG 路径含圆弧命令 `A`（v1 未支持）——设计工具导出时把弧转成三次贝塞尔（C），\
                     或用 `strokeProgress` 之外的方式实现"
                        .to_string(),
                )
            }
            'S' | 'T' => {
                return Err(format!(
                    "SVG 路径含平滑曲线命令 `{up}`（v1 未支持）——导出时展开为显式 `C`/`Q`"
                ))
            }
            other => return Err(format!("SVG 路径含未知命令 `{other}`")),
        }
    }
    if segs.is_empty() {
        return Err("SVG 路径为空（`d` 里没有任何绘图命令）".to_string());
    }
    // 弧长（贝塞尔 16 段折线近似；MoveTo/Close 的处理见下）
    let mut prefix_len = Vec::with_capacity(segs.len());
    let mut acc = 0.0f32;
    let (mut px, mut py) = (0.0f32, 0.0f32);
    for s in &segs {
        match *s {
            PathSeg::MoveTo(x, y) => {
                // ★MoveTo 不贡献弧长（但更新"当前点"——后续 L/C 的长度从它算）
                px = x;
                py = y;
            }
            PathSeg::LineTo(x, y) => {
                acc += seg_len_line(px, py, x, y);
                px = x;
                py = y;
            }
            PathSeg::CubicTo(x1, y1, x2, y2, x, y) => {
                acc += seg_len_cubic(px, py, x1, y1, x2, y2, x, y);
                px = x;
                py = y;
            }
            PathSeg::QuadTo(x1, y1, x, y) => {
                // 二次 → 三次（同一形状：C1 = P0 + 2/3(Q-P0)，C2 = P2 + 2/3(Q-P2)）
                let c1x = px + (2.0 / 3.0) * (x1 - px);
                let c1y = py + (2.0 / 3.0) * (y1 - py);
                let c2x = x + (2.0 / 3.0) * (x1 - x);
                let c2y = y + (2.0 / 3.0) * (y1 - y);
                acc += seg_len_cubic(px, py, c1x, c1y, c2x, c2y, x, y);
                px = x;
                py = y;
            }
            PathSeg::Close => {
                acc += seg_len_line(px, py, sx, sy);
                px = sx;
                py = sy;
            }
        }
        prefix_len.push(acc);
    }
    Ok(SvgPath { segs, prefix_len, total_len: acc })
}

/// 词法：命令字母（单字符）与数字（含负号 / 小数 / 科学计数）
fn tokenize(d: &str) -> Result<Vec<Tok>, String> {
    let b: Vec<char> = d.chars().collect();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < b.len() {
        let c = b[i];
        if c.is_whitespace() || c == ',' {
            i += 1;
            continue;
        }
        if c.is_ascii_alphabetic() {
            out.push(Tok::Cmd(c));
            i += 1;
            continue;
        }
        // 数字：可选符号 + 数字 + 可选小数 + 可选指数
        let start = i;
        if c == '-' || c == '+' {
            i += 1;
        }
        let mut has_digit = false;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
            has_digit = true;
        }
        if i < b.len() && b[i] == '.' {
            i += 1;
            while i < b.len() && b[i].is_ascii_digit() {
                i += 1;
                has_digit = true;
            }
        }
        if !has_digit {
            return Err(format!("SVG 路径含非法字符：{:?}（位置 {start}）", b[start]));
        }
        // 指数（`1e-3`；科学计数在导出路径里罕见但合法）
        if i < b.len() && (b[i] == 'e' || b[i] == 'E') {
            i += 1;
            if i < b.len() && (b[i] == '-' || b[i] == '+') {
                i += 1;
            }
            let mut exp_digit = false;
            while i < b.len() && b[i].is_ascii_digit() {
                i += 1;
                exp_digit = true;
            }
            if !exp_digit {
                return Err("SVG 路径的指数部分缺数字".to_string());
            }
        }
        let s: String = b[start..i].iter().collect();
        let v: f32 = s
            .parse()
            .map_err(|_| format!("SVG 路径里的数字无法解析：{s:?}"))?;
        out.push(Tok::Num(v));
    }
    Ok(out)
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Tok {
    Cmd(char),
    Num(f32),
}

fn seg_len_line(x0: f32, y0: f32, x1: f32, y1: f32) -> f32 {
    ((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)).sqrt()
}

/// 三次贝塞尔的弧长（16 段折线近似——与 CSS dash 实现同量级；视觉不可辨）
fn seg_len_cubic(x0: f32, y0: f32, x1: f32, y1: f32, x2: f32, y2: f32, x3: f32, y3: f32) -> f32 {
    const N: usize = 16;
    let mut prev = (x0, y0);
    let mut acc = 0.0f32;
    for k in 1..=N {
        let t = k as f32 / N as f32;
        let mt = 1.0 - t;
        let x = mt * mt * mt * x0 + 3.0 * mt * mt * t * x1 + 3.0 * mt * t * t * x2 + t * t * t * x3;
        let y = mt * mt * mt * y0 + 3.0 * mt * mt * t * y1 + 3.0 * mt * t * t * y2 + t * t * t * y3;
        acc += seg_len_line(prev.0, prev.1, x, y);
        prev = (x, y);
    }
    acc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_common_icon_path() {
        // 一个三角 + 闭合（带相对命令与隐含重复）
        let p = parse_svg_path("M10 10 L30 10 50 40 Z").unwrap();
        // 注意：`L30 10 50 40` 是"L 后跟两组坐标"（隐含重复）⇒ 两条 L
        assert_eq!(p.segs.len(), 4, "三段 + Close：{:?}", p.segs);
        assert_eq!(p.segs[0], PathSeg::MoveTo(10.0, 10.0));
        assert_eq!(p.segs[1], PathSeg::LineTo(30.0, 10.0));
        assert_eq!(p.segs[2], PathSeg::LineTo(50.0, 40.0));
        assert_eq!(p.segs[3], PathSeg::Close);
        // 弧长：M→(30,10)=20 + (50,40)=√(20²+30²)=36.06 + Close 回 (10,10)=√(40²+30²)=50
        assert!((p.total_len - (20.0 + 36.0555 + 50.0)).abs() < 0.01, "total={}", p.total_len);
        // 前缀表：MoveTo 不贡献长度
        assert_eq!(p.prefix_len[0], 0.0);
        assert!((p.prefix_len[3] - p.total_len).abs() < 1e-4);
    }

    #[test]
    fn expands_relative_and_implicit_commands() {
        // 相对命令：m 10,10 之后 l 10,0 ⇒ 绝对 (20,10)；隐含 l 继续
        let p = parse_svg_path("m10,10 l10,0 0,10").unwrap();
        assert_eq!(p.segs[0], PathSeg::MoveTo(10.0, 10.0));
        assert_eq!(p.segs[1], PathSeg::LineTo(20.0, 10.0));
        assert_eq!(p.segs[2], PathSeg::LineTo(20.0, 20.0));
        // H/V（水平/垂直）
        let q = parse_svg_path("M0 0 H10 V10 h-5 v-5").unwrap();
        assert_eq!(q.segs[1], PathSeg::LineTo(10.0, 0.0));
        assert_eq!(q.segs[2], PathSeg::LineTo(10.0, 10.0));
        assert_eq!(q.segs[3], PathSeg::LineTo(5.0, 10.0));
        assert_eq!(q.segs[4], PathSeg::LineTo(5.0, 5.0));
    }

    #[test]
    fn parses_cubic_and_quad_with_length() {
        let p = parse_svg_path("M0 0 C0 50 50 50 50 0").unwrap();
        assert!(matches!(p.segs[1], PathSeg::CubicTo(..)));
        // ★期望值 = **独立高精度验算**（Python 1000 段折线 = 100.0；本实现 16 段 = 99.85，
        //   相对误差 0.15%——与 CSS dash 实现同量级，视觉不可辨）。
        //   ★首版把上界估成 90（拍脑袋"介于弦长与对角线之间"）⇒ 被实测 99.85 打脸。
        assert!((p.total_len - 100.0).abs() < 0.5, "len={}", p.total_len);
        let q = parse_svg_path("M0 0 Q25 50 50 0").unwrap();
        assert!(matches!(q.segs[1], PathSeg::QuadTo(..)));
        // ★期望值 = 独立高精度验算（Python 1000 段 = **73.9471**；本实现 73.889，误差 0.08%）。
        //   ★首版写 100（把三次的对称性误套到二次上）⇒ 再次被实测打脸。
        //   ★教训（本文件两次同族）：**弧长的期望值必须独立算，不能凭几何直觉拍**。
        assert!((q.total_len - 73.947).abs() < 0.5, "quad len={}", q.total_len);
    }

    #[test]
    fn rejects_unsupported_and_malformed() {
        // 弧与平滑曲线：明确拒绝（消息给修法）
        let e1 = parse_svg_path("M0 0 A10 10 0 0 1 20 20").unwrap_err();
        assert!(e1.contains("圆弧") && e1.contains("贝塞尔"), "err={e1}");
        let e2 = parse_svg_path("M0 0 S10 10 20 20").unwrap_err();
        assert!(e2.contains("平滑曲线"), "err={e2}");
        // 参数不足 / 非法字符 / 空路径
        assert!(parse_svg_path("M0 0 L10").unwrap_err().contains("参数不足"));
        assert!(parse_svg_path("M0 0 X10 10").unwrap_err().contains("未知命令"));
        assert!(parse_svg_path("   ").unwrap_err().contains("为空"));
        assert!(parse_svg_path("5 5").unwrap_err().contains("缺少命令"));
    }

    #[test]
    fn multi_subpath_support() {
        // 两个子路径（两个 M）——宿主按 M 分段；弧长连起来算（v1 语义）
        let p = parse_svg_path("M0 0 L10 0 M20 0 L30 0").unwrap();
        assert_eq!(p.segs.len(), 4);
        assert_eq!(p.total_len, 20.0, "两条 10px 线段");
    }
}
