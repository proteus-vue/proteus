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

impl SvgPath {
    /// ★★**结构签名**（路径变形的前提）：段序列的"命令指纹"——
    ///   同签名的两条路径才能逐点插值（异签名 ⇒ 无定义；本引擎**明确拒绝**，不做"猜测对齐"）。
    ///
    /// 形态：每段一个字符（M/L/C/Q/Z）——例：`"MLLQZ"`
    pub fn structure_signature(&self) -> String {
        self.segs
            .iter()
            .map(|sg| match sg {
                PathSeg::MoveTo(..) => 'M',
                PathSeg::LineTo(..) => 'L',
                PathSeg::CubicTo(..) => 'C',
                PathSeg::QuadTo(..) => 'Q',
                PathSeg::Close => 'Z',
            })
            .collect()
    }

    /// 子路径数（`MoveTo` 的个数）——异构变形**只支持单子路径**（多子路径的重采样
    /// 需要"子路径配对"策略，本引擎 v1 不做这类猜测 ⇒ 明确拒绝）。
    pub fn subpath_count(&self) -> usize {
        self.segs
            .iter()
            .filter(|sg| matches!(sg, PathSeg::MoveTo(..)))
            .count()
    }

    /// ★★**均匀弧长重采样**为恰好 `n` 个三次贝塞尔段（+ 可选 Close）——**异构路径变形的前提**。
    ///
    /// 【为什么需要（MorphSVG 的核心难点）】两条路径段数/段型不同时"逐点插值"没有定义
    ///   （哪个点对哪个点？）。业界做法（GSAP MorphSVG / flubber）是**把两条都重采样到
    ///   同一结构**再插值。本引擎同样做，但**只做一份实现**（内核）——宿主从不重采样。
    ///
    /// 【算法（确定性、无随机）】
    ///   ① 折线化：每段按与弧长计算**同一精度**（贝塞尔 16 折线）展开成点列 + 累计弧长；
    ///   ② 取点：在总弧长上取 `n+1` 个**等间距**点（含首尾；闭合时末点 ≈ 首点）；
    ///   ③ 转贝塞尔：Catmull-Rom 切线（`T_i = (P_{i+1} - P_{i-1}) / 2`）→ 三次控制点
    ///      （`C1 = P_i + T_i/3`、`C2 = P_{i+1} - T_{i+1}/3`）——给折线点列一个**平滑**的解释。
    ///
    /// 【★关闭语义（`closed` 参数由调用方给）】**异构变形的两边必须统一闭合**——
    ///   否则重采样后签名仍不同（一边多一个 `Z`）。惯例：两边都闭合 ⇒ 闭合；否则开放。
    ///   开放时采样仍走整圈（首尾点重合）⇒ "圆→线"的观感自然（线从圆的接缝处拉开）。
    ///
    /// - Returns: `None` = 路径退化（总长为 0——无可变形内容）或多子路径（见 `subpath_count`）。
    pub fn resample_uniform(&self, n: usize, closed: bool) -> Option<SvgPath> {
        if self.total_len <= 1e-6 || n == 0 {
            return None;
        }
        if self.subpath_count() > 1 {
            return None;
        }
        // ① 折线化（与 `seg_len_cubic` 同精度：每贝塞尔 16 段）
        let mut poly: Vec<(f32, f32)> = Vec::new();
        let mut cum: Vec<f32> = Vec::new();
        let (mut cur, mut start) = ((0.0f32, 0.0f32), (0.0f32, 0.0f32));
        let mut acc = 0.0f32;
        for sg in &self.segs {
            match *sg {
                PathSeg::MoveTo(x, y) => {
                    cur = (x, y);
                    start = (x, y);
                    poly.push(cur);
                    cum.push(acc);
                }
                PathSeg::LineTo(x, y) => {
                    acc += seg_len_line(cur.0, cur.1, x, y);
                    cur = (x, y);
                    poly.push(cur);
                    cum.push(acc);
                }
                PathSeg::QuadTo(x1, y1, x, y) => {
                    let c1 = (cur.0 + (2.0 / 3.0) * (x1 - cur.0), cur.1 + (2.0 / 3.0) * (y1 - cur.1));
                    let c2 = (x + (2.0 / 3.0) * (x1 - x), y + (2.0 / 3.0) * (y1 - y));
                    push_cubic_poly(&mut poly, &mut cum, &mut acc, cur, c1, c2, (x, y));
                    cur = (x, y);
                }
                PathSeg::CubicTo(x1, y1, x2, y2, x, y) => {
                    push_cubic_poly(&mut poly, &mut cum, &mut acc, cur, (x1, y1), (x2, y2), (x, y));
                    cur = (x, y);
                }
                PathSeg::Close => {
                    if (cur.0 - start.0).abs() > 1e-6 || (cur.1 - start.1).abs() > 1e-6 {
                        acc += seg_len_line(cur.0, cur.1, start.0, start.1);
                        cur = start;
                        poly.push(cur);
                        cum.push(acc);
                    }
                }
            }
        }
        let total = acc;
        if total <= 1e-6 {
            return None;
        }
        // ② 等间距取点（n+1 个；闭合时末点与首点同位置——采样本身走完整圈）
        let mut pts: Vec<(f32, f32)> = Vec::with_capacity(n + 1);
        let mut seg_i = 0usize; // 折线游标（**单调前移**——不从头找，O(poly + n)）
        for i in 0..=n {
            let target = total * (i as f32) / (n as f32);
            while seg_i + 1 < cum.len() && cum[seg_i + 1] < target {
                seg_i += 1;
            }
            let j = seg_i.min(poly.len().saturating_sub(2));
            let (p0, p1) = (poly[j], poly[j + 1]);
            let (l0, l1) = (cum[j], cum[j + 1]);
            let span = (l1 - l0).max(1e-9);
            let t = ((target - l0) / span).clamp(0.0, 1.0);
            pts.push((p0.0 + (p1.0 - p0.0) * t, p0.1 + (p1.1 - p0.1) * t));
        }
        // ③ Catmull-Rom → 三次贝塞尔
        let mut segs: Vec<PathSeg> = Vec::with_capacity(n + 2);
        segs.push(PathSeg::MoveTo(pts[0].0, pts[0].1));
        let pt_at = |k: isize| -> (f32, f32) {
            if closed {
                // 环上取模（首尾相接）
                let m = n as isize;
                let idx = ((k % m) + m) % m;
                pts[idx as usize]
            } else {
                pts[k.clamp(0, n as isize) as usize]
            }
        };
        for i in 0..n {
            let p0 = pts[i];
            let p1 = pts[i + 1];
            let pm = pt_at(i as isize - 1);
            let pn = pt_at(i as isize + 2);
            let t0 = ((p1.0 - pm.0) * 0.5, (p1.1 - pm.1) * 0.5);
            let t1 = ((pn.0 - p0.0) * 0.5, (pn.1 - p0.1) * 0.5);
            segs.push(PathSeg::CubicTo(
                p0.0 + t0.0 / 3.0,
                p0.1 + t0.1 / 3.0,
                p1.0 - t1.0 / 3.0,
                p1.1 - t1.1 / 3.0,
                p1.0,
                p1.1,
            ));
        }
        if closed {
            segs.push(PathSeg::Close);
        }
        let (prefix_len, total_len) = compute_arc_lengths(&segs);
        Some(SvgPath { segs, prefix_len, total_len })
    }

    /// ★★**逐点插值**（路径变形的**唯一 lerp 实现**——宿主零插值数学，只翻译结果）。
    ///
    /// 【语义】`self` = A 态（t=0）· `other` = B 态（t=1）；每段的每个坐标各自线性插值
    ///   （与颜色通道动画同一数学：直插）。`Close` 无坐标 ⇒ 原样。
    /// 【前提】两条路径**结构签名相同**（调用方负责校验——本函数只做数学；
    ///   签名不同时按"能插到什么就插什么"会产出无意义几何 ⇒ 上游必须拒绝）。
    /// 【为什么实时重算弧长】变形改变几何 ⇒ `total_len`/`prefix_len` 必须跟着变
    ///   （否则 `strokeProgress` 的"画到哪"仍按旧长度换算 ⇒ 画线进度与几何不同步）。
    pub fn morphed(&self, other: &SvgPath, t: f32) -> SvgPath {
        let t = t.clamp(0.0, 1.0);
        let lerp = |a: f32, b: f32| a + (b - a) * t;
        let segs: Vec<PathSeg> = self
            .segs
            .iter()
            .zip(other.segs.iter())
            .map(|(a, b)| match (a, b) {
                (PathSeg::MoveTo(x0, y0), PathSeg::MoveTo(x1, y1)) => {
                    PathSeg::MoveTo(lerp(*x0, *x1), lerp(*y0, *y1))
                }
                (PathSeg::LineTo(x0, y0), PathSeg::LineTo(x1, y1)) => {
                    PathSeg::LineTo(lerp(*x0, *x1), lerp(*y0, *y1))
                }
                (
                    PathSeg::CubicTo(x0, y0, x1, y1, x2, y2),
                    PathSeg::CubicTo(x3, y3, x4, y4, x5, y5),
                ) => PathSeg::CubicTo(
                    lerp(*x0, *x3),
                    lerp(*y0, *y3),
                    lerp(*x1, *x4),
                    lerp(*y1, *y4),
                    lerp(*x2, *x5),
                    lerp(*y2, *y5),
                ),
                (PathSeg::QuadTo(x0, y0, x1, y1), PathSeg::QuadTo(x2, y2, x3, y3)) => {
                    PathSeg::QuadTo(lerp(*x0, *x2), lerp(*y0, *y2), lerp(*x1, *x3), lerp(*y1, *y3))
                }
                _ => PathSeg::Close, // Close↔Close（签名校验已保证；此处兜底为 Close）
            })
            .collect();
        // ★弧长重算**复用 parse 的同一套函数与口径**（`seg_len_line`/`seg_len_cubic` +
        //   Quad→Cubic 转换）——本仓纪律：同一语义一处实现（首版这里又写了一份"自己的折线近似"，
        //   两处口径一旦分叉 ⇒ `strokeProgress` 在"变形 + 画线"同开时按不同长度换算，
        //   而单看任何一条都"对"。⇒ 抽为共享的 `compute_arc_lengths`）。
        let (prefix_len, total) = compute_arc_lengths(&segs);
        SvgPath { segs, prefix_len, total_len: total }
    }
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
    // 弧长（**共享实现**：见 `compute_arc_lengths`——变形路径也用它，口径必然一致）
    let (prefix_len, acc) = compute_arc_lengths(&segs);
    Ok(SvgPath { segs, prefix_len, total_len: acc })
}

/// ★★**弧长计算**（段列表 → 前缀表 + 总长）——**唯一实现**：
///   解析路径与**变形后的**路径都走它（口径必然一致：`strokeProgress` 在两种情况下
///   都按同一精度换算"画到哪"）。
///
/// 口径：线段精确；贝塞尔用 16 段折线近似（与 CSS `stroke-dasharray` 同量级，
///   误差 ~1e-3 相对量、视觉不可辨）；Quad 转 Cubic 后同法（同一形状：
///   `C1 = P0 + 2/3(Q-P0)`、`C2 = P2 + 2/3(Q-P2)`）。
fn compute_arc_lengths(segs: &[PathSeg]) -> (Vec<f32>, f32) {
    let mut prefix_len = Vec::with_capacity(segs.len());
    let mut acc = 0.0f32;
    let (mut px, mut py) = (0.0f32, 0.0f32);
    // 子路径起点（Z 的落点）——从首段 MoveTo 记起（与解析器同规）
    let (mut sx, mut sy) = (0.0f32, 0.0f32);
    let mut seen_move = false;
    for s in segs {
        match *s {
            PathSeg::MoveTo(x, y) => {
                // ★MoveTo 不贡献弧长（但更新"当前点"与子路径起点）
                px = x;
                py = y;
                sx = x;
                sy = y;
                seen_move = true;
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
                let c1x = px + (2.0 / 3.0) * (x1 - px);
                let c1y = py + (2.0 / 3.0) * (y1 - py);
                let c2x = x + (2.0 / 3.0) * (x1 - x);
                let c2y = y + (2.0 / 3.0) * (y1 - y);
                acc += seg_len_cubic(px, py, c1x, c1y, c2x, c2y, x, y);
                px = x;
                py = y;
            }
            PathSeg::Close => {
                if seen_move {
                    acc += seg_len_line(px, py, sx, sy);
                    px = sx;
                    py = sy;
                }
            }
        }
        prefix_len.push(acc);
    }
    (prefix_len, acc)
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

/// ★折线化一段三次贝塞尔（**与 `seg_len_cubic` 同精度 16 段**——两处口径一致：
///   弧长表与重采样点列描述的是同一条近似曲线，不会"长度按 A 算、点按 B 取"）。
fn push_cubic_poly(
    poly: &mut Vec<(f32, f32)>,
    cum: &mut Vec<f32>,
    acc: &mut f32,
    p0: (f32, f32),
    c1: (f32, f32),
    c2: (f32, f32),
    p3: (f32, f32),
) {
    const N: usize = 16;
    let mut prev = p0;
    for k in 1..=N {
        let t = k as f32 / N as f32;
        let mt = 1.0 - t;
        let x = mt * mt * mt * p0.0 + 3.0 * mt * mt * t * c1.0 + 3.0 * mt * t * t * c2.0 + t * t * t * p3.0;
        let y = mt * mt * mt * p0.1 + 3.0 * mt * mt * t * c1.1 + 3.0 * mt * t * t * c2.1 + t * t * t * p3.1;
        *acc += seg_len_line(prev.0, prev.1, x, y);
        poly.push((x, y));
        cum.push(*acc);
        prev = (x, y);
    }
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

    /// ★★路径变形（v1）：**插值数学钉值** + 同构校验 + 弧长随几何重算。
    #[test]
    fn morph_interpolates_coordinates_and_recomputes_arc_length() {
        // A：一条 10px 水平线；B：同结构但终点 (20, 10)（斜线）
        let a = parse_svg_path("M0 0 L10 0").unwrap();
        let b = parse_svg_path("M0 0 L20 10").unwrap();
        assert_eq!(a.structure_signature(), b.structure_signature(), "同构");
        // t=0.5：终点 = (15, 5)
        let m = a.morphed(&b, 0.5);
        match m.segs[1] {
            PathSeg::LineTo(x, y) => {
                assert!((x - 15.0).abs() < 1e-4, "x={x}");
                assert!((y - 5.0).abs() < 1e-4, "y={y}");
            }
            other => panic!("段型不符：{other:?}"),
        }
        // 弧长 = |(15,5) - (0,0)| ≈ 15.811
        assert!((m.total_len - 15.8114).abs() < 0.01, "len={}", m.total_len);
        // t=0 / t=1 端点钉死（与其余通道同一"端点精确"语义）
        let at0 = a.morphed(&b, 0.0);
        assert!((at0.total_len - a.total_len).abs() < 1e-4, "t=0 应等于 A");
        let at1 = a.morphed(&b, 1.0);
        assert!((at1.total_len - b.total_len).abs() < 0.01, "t=1 应等于 B");
        // 越界钳位（与 progress 通道同一纪律）
        assert!((a.morphed(&b, 5.0).total_len - b.total_len).abs() < 0.01, "t>1 钳到 1");
    }

    /// ★★同构校验：异结构（命令序列不同 / 段数不同）的**签名必须不同**——
    ///   这是上游拒绝"异型变形"的依据（签名相同才允许插值；本引擎不做"猜测对齐"）。
    #[test]
    fn morph_signature_distinguishes_structures() {
        let l = parse_svg_path("M0 0 L10 0").unwrap();
        let c = parse_svg_path("M0 0 C1 1 2 2 10 0").unwrap();
        let two = parse_svg_path("M0 0 L5 0 L10 0").unwrap();
        assert_ne!(l.structure_signature(), c.structure_signature(), "L vs C");
        assert_ne!(l.structure_signature(), two.structure_signature(), "段数不同");
        let same = parse_svg_path("M0 0 L0 10").unwrap();
        assert_eq!(l.structure_signature(), same.structure_signature(), "同构（只是坐标不同）");
    }

    /// ★★均匀弧长重采样（异构变形的前提）：结构变成 n 段 C、弧长保持、端点保持、闭合语义。
    #[test]
    fn resample_uniform_preserves_length_and_structure() {
        // 折线 → 12 段 C
        let l = parse_svg_path("M0 0 L10 0 L10 10").unwrap();
        let r = l.resample_uniform(12, false).expect("折线可重采样");
        assert_eq!(r.segs.len(), 13, "M + 12 C（开放路径不加 Z）");
        assert!(matches!(r.segs[0], PathSeg::MoveTo(..)));
        assert!(r.segs[1..].iter().all(|s| matches!(s, PathSeg::CubicTo(..))));
        // 弧长保持（<3%——重采样是同一曲线的另一次折线逼近）
        let rel = (r.total_len - l.total_len).abs() / l.total_len;
        assert!(rel < 0.03, "弧长保持：原 {} vs 重采样 {}（rel={rel}）", l.total_len, r.total_len);
        // 端点保持（起终点同位置）
        match (r.segs.first().unwrap(), r.segs.last().unwrap()) {
            (PathSeg::MoveTo(x0, y0), PathSeg::CubicTo(_, _, _, _, x1, y1)) => {
                assert!(x0.abs() < 1e-4 && y0.abs() < 1e-4, "起点保持 (0,0)");
                assert!((x1 - 10.0).abs() < 0.05 && (y1 - 10.0).abs() < 0.05, "终点保持 (10,10)：({x1},{y1})");
            }
            other => panic!("段型异常：{other:?}"),
        }
        // 闭合路径：输出带 Z；且首尾点几乎重合（整圈采样）
        let c = parse_svg_path("M0 0 L10 0 L10 10 Z").unwrap();
        let rc = c.resample_uniform(16, true).expect("闭合可重采样");
        assert!(matches!(rc.segs.last(), Some(PathSeg::Close)), "闭合保持");
        assert_eq!(rc.segs.len(), 18, "M + 16 C + Z");
        // 退化与多子路径：明确返回 None（调用方据此拒绝，不静默）
        let dot = parse_svg_path("M5 5").unwrap();
        assert!(dot.resample_uniform(8, false).is_none(), "零长路径应拒绝");
        let two = parse_svg_path("M0 0 L1 0 M2 0 L3 0").unwrap();
        assert!(two.resample_uniform(8, false).is_none(), "多子路径应拒绝（不做子路径配对猜测）");
    }

    /// ★★异构变形端到端语义（重采样后两态**结构一致**——直接喂 `morphed`）。
    #[test]
    fn resample_makes_hetero_paths_morphable() {
        // A：圆（4 段 C）；B：三角（3 段 L）——段数与段型都不同
        let circleish = parse_svg_path("M0 5 C1 1 9 1 10 5 C11 9 1 9 0 5").unwrap();
        let tri = parse_svg_path("M0 0 L10 0 L5 9 Z").unwrap();
        assert_ne!(circleish.structure_signature(), tri.structure_signature(), "两态异构（前提）");
        let n = 16;
        // ★两边闭合语义统一（tri 闭合、circleish 开放 ⇒ 统一取"开放"）
        let ra = circleish.resample_uniform(n, false).unwrap();
        let rb = tri.resample_uniform(n, false).unwrap();
        assert_eq!(ra.structure_signature(), rb.structure_signature(), "重采样后同构");
        // 半程混合：段数与终态（= B 的终点位置）都正确
        let m = ra.morphed(&rb, 0.5);
        assert_eq!(m.segs.len(), rb.segs.len());
        assert!(m.total_len > 0.0 && m.total_len.is_finite());
        let at1 = ra.morphed(&rb, 1.0);
        let rel = (at1.total_len - rb.total_len).abs() / rb.total_len;
        assert!(rel < 1e-4, "t=1 应等于重采样后的 B（长度 rel={rel}）");
    }

    #[test]
    fn multi_subpath_support() {
        // 两个子路径（两个 M）——宿主按 M 分段；弧长连起来算（v1 语义）
        let p = parse_svg_path("M0 0 L10 0 M20 0 L30 0").unwrap();
        assert_eq!(p.segs.len(), 4);
        assert_eq!(p.total_len, 20.0, "两条 10px 线段");
    }
}
