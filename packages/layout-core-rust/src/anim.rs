// packages/layout-core-rust/src/anim.rs
// ★★RT0/RT2 —— **指令驱动动画的引擎**（Proteus_App端路由与动画系统设计方案 §8 + Morpheus 方案 MA2）
//
// 【它解决什么】JS 侧只发**指令**（启动/seek/停止），此后每帧由宿主调一次 `tick(dt)`：
//   曲线求值、弹簧物理、字段写入**全在 Rust 侧**完成 —— 每帧零 JS 求值、零字符串解析。
//   RT0 实测（桌面 release）：N=1000 条动画每帧 **2.38µs**（对照"JS 每帧算+指令流"为下界 84.5×）。
//
// 【能力清单（逐项对 Flutter / Reanimated 的可比项）】
//   · 曲线动画：5 条内置曲线（查表 + 插值，65 点采样；端点钉死）
//   · **弹簧物理**：`AnimMode::Spring { stiffness, damping, mass }`（Flutter `SpringDescription` 同参数化）
//     —— 半隐式欧拉 + 4ms 子步（大 dt 稳定）+ 静止判据 + 端点钉死 + 10s 安全上限
//   · **打断接管（velocity handoff）**：`start` 遇同 `(node,kind)` 已有动画 ⇒ 默认从**当前位置 + 当前速度**接管
//     （位置无跳变；弹簧带着速度走 —— 这是"手势松手后丝滑接管"的机制面）
//   · **手势驱动（Progress）**：`seek` 设进度并**立即求值写字段**（不等下一帧）；可选 `dt` 用于速度估计
//   · **编排**：`delay_ms`（交错/延迟启动；等待期钉在起点）
//   · **属性**：translateX/Y · scale · rotate（度）· opacity
//   · **FLIP 布局动画**（招牌能力）：几何本就在内核 ⇒ `flip_capture` 记快照 → 布局变更后
//     `flip_start` 直接生成"旧位置 → 新位置"的补间（**零跨边界几何查询**）
//
// 【设计要点（对齐方案 §4.3）】
//   · 曲线 = `curve_id (u8)` → 65 点采样表 + 线性插值 ⇒ 求值是几次浮点运算（无分支、无公式幂运算）；
//   · 表在首次使用时构建一次（`OnceLock`），之后只读；
//   · 端点钉死：任何曲线/弹簧都**精确**落在起止值上（`f(0)=start`、结束= `to`）；
//   · 动画按 `(node, kind)` 唯一：重复 start 语义 = **接管**（默认）或**硬重启**（`takeover=false`）。
//
// 【诚实边界（如实标注）】
//   ① 节点索引在 `start` 时解析并缓存；树**压实/删除**后可能越界 ⇒ tick 里"越界即丢弃并计数"
//      （不 panic）；生产级"结构变更失效回调"属后续批次；
//   ② 弹簧参数不做物理量纲校验（非法值可能永不静止）⇒ 10s 安全上限兜底（到点钉在 `to`）；
//   ③ FLIP 只做**位移**补间（未做尺寸/形状插值）；它**接管**该节点的 translate 动画（会覆盖既有）；
//   ④ 内核**不做值域钳制**（如 opacity 只信调用方给的 0..1）——钳制在编译期/宿主层（单一职责）；
//   ⑤ 单位：位移 px · 旋转 度 · 弹簧速度（单位/秒）。

use crate::node::{LayoutTree, NodeIndex};
use crate::style::Rect;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

/// 曲线 id（与 TS 侧 `AnimCurve` 一一对应——**跨语言契约，不得改号**）
pub const CURVE_LINEAR: u8 = 0;
pub const CURVE_EASE_OUT_CUBIC: u8 = 1;
pub const CURVE_EASE_IN_CUBIC: u8 = 2;
pub const CURVE_EASE_IN_OUT_CUBIC: u8 = 3;
pub const CURVE_SPRING_APPROX: u8 = 4;
pub const CURVE_MAX: u8 = CURVE_SPRING_APPROX;
pub const CURVE_COUNT: usize = 5;

/// 采样点数（65 = 64 段；线性插值误差 ~1e-4 量级，见 `table_matches_exact_formula` 测试）
const TABLE_N: usize = 65;
/// 弹簧子步上限（秒）：大 dt 下保证半隐式欧拉的稳定性（ω·h ≪ 2）
const MAX_SUBSTEP_S: f32 = 0.004;
/// 弹簧安全上限（毫秒）：非法参数可能永不静止 ⇒ 到点钉在 `to` 并结束
const SPRING_MAX_MS: f32 = 10_000.0;

static TABLES: OnceLock<[[f32; TABLE_N]; CURVE_COUNT]> = OnceLock::new();

/// 阻尼振荡（spring 近似）：`1 - e^(-6u)·cos(10u)`，端点钉死
fn spring_approx(u: f32) -> f32 {
    1.0 - (-6.0 * u).exp() * (10.0 * u).cos()
}

fn build_tables() -> [[f32; TABLE_N]; CURVE_COUNT] {
    let mut t = [[0f32; TABLE_N]; CURVE_COUNT];
    for i in 0..TABLE_N {
        let u = i as f32 / (TABLE_N - 1) as f32;
        t[CURVE_LINEAR as usize][i] = u;
        t[CURVE_EASE_OUT_CUBIC as usize][i] = 1.0 - (1.0 - u).powi(3);
        t[CURVE_EASE_IN_CUBIC as usize][i] = u.powi(3);
        t[CURVE_EASE_IN_OUT_CUBIC as usize][i] = if u < 0.5 {
            4.0 * u.powi(3)
        } else {
            1.0 - (-2.0 * u + 2.0).powi(3) / 2.0
        };
        t[CURVE_SPRING_APPROX as usize][i] = spring_approx(u);
    }
    // ★端点钉死（浮点近似可能让最后一项差 1e-7；动画必须**精确**落在起止值上）
    for c in 0..CURVE_COUNT {
        t[c][0] = 0.0;
        t[c][TABLE_N - 1] = 1.0;
    }
    t
}

/// **查表 + 线性插值**（65 点表；内置曲线与自定义曲线**共用这一台机器**）
///
/// 【为什么提取成一处（2026-10-01 自定义曲线转正）】内置曲线走 `curve_eval(curve_id, u)`，
///   自定义贝塞尔走它的采样表——两条路的求值语义必须**逐位一致**（同 clamp、同插值）。
///   各写一份 = "内置曲线改了、自定义没跟"的静默分叉（本仓纪律 #22）。
#[inline]
fn table_eval(row: &[f32; TABLE_N], u: f32) -> f32 {
    let u = u.clamp(0.0, 1.0);
    let x = u * (TABLE_N - 1) as f32;
    let i0 = x.floor() as usize;
    let i1 = (i0 + 1).min(TABLE_N - 1);
    let frac = x - i0 as f32;
    let (a, b) = (row[i0], row[i1]);
    a + (b - a) * frac
}

/// ★★**循环相位映射**（2026-10-01 · A2）——"已经过时间 → 本轮进度 + 是否播完"
///
/// 语义（与 CSS `animation-iteration-count` / `-direction` 对齐）：
///   · `total = dur_ms`（含 delay 之外的动画本体时长）；`elapsed = t_ms - delay_ms`
///   · `iterations`：`1` = 一遍；`n` = n 遍；`-1`（哨兵）= **无限**
///   · `alternate`：奇偶轮反向（yoyo——第 2 轮 u 从 1→0）
///
/// 返回 `(u, finished)`；`u ∈ [0,1]` **已是"本轮方向"下的进度**（调用方直接喂曲线）。
/// ★为什么收敛成一处：时间推进（step）与进度求值（seek/滚动）都要它——各写一份必分叉。
#[inline]
pub fn loop_phase(t_ms: f32, delay_ms: f32, dur_ms: f32, iterations: f32, alternate: bool) -> (f32, bool) {
    let elapsed = t_ms - delay_ms;
    if elapsed <= 0.0 {
        return (0.0, false);
    }
    if dur_ms <= 0.0 {
        // 零时长：立即完成（与单遍语义一致）；无限循环时语义退化——按"永远停在终点"处理
        return (1.0, iterations >= 0.0);
    }
    let raw = elapsed / dur_ms; // 含"第几轮"
    if iterations >= 0.0 && raw >= iterations {
        // ★播完。**末轮端点**（方向决定停在 0 还是 to——yoyo 偶数轮停在 from！）
        //   【为什么必须按方向判（首版写死的 (1.0,true) 被测试抓出）】yoyo 的第 2 轮
        //   是"从 to 回 from"⇒ 播完时值在 **from**（净位移 0——呼吸/往复的数学本质）；
        //   一律返回 u=1 ⇒ 值又跳回 to ⇒ 往复动画每轮末尾跳变。
        let last_cycle = (iterations - 1.0).max(0.0) as i64;
        let u = if alternate && last_cycle % 2 == 1 { 0.0 } else { 1.0 };
        return (u, true);
    }
    let cycle = raw.floor();
    let u_round = raw - cycle;
    let u = if alternate && (cycle as i64) % 2 == 1 {
        1.0 - u_round
    } else {
        u_round
    };
    (u, false)
}

/// 曲线求值：查表 + 线性插值（`u` 先 clamp 到 [0,1]；未知曲线 id 落表尾兜底——不 panic）
pub fn curve_eval(curve: u8, u: f32) -> f32 {
    let tables = TABLES.get_or_init(build_tables);
    let row = &tables[(curve as usize).min(CURVE_COUNT - 1)];
    table_eval(row, u)
}

/* ══════════════ ★★自定义三次贝塞尔曲线（2026-10-01 转正） ══════════════ */

/// 自定义三次贝塞尔的 65 点采样表（与内置曲线**同一形态**——求值零迭代）
///
/// 【为什么做成表（而不是每次求值现解贝塞尔方程）】`bezier_eval` 每次要 24 次二分迭代；
///   直接现算会让自定义曲线的求值成本与内置曲线**差两个量级**（内置是一次插值）。
///   ⇒ 生成一次 65 点表（与内置曲线同机器），之后**逐位同路**——性能与语义都不分叉。
///   表按控制点缓存（见 `bezier_table`），同一条声明（如 800 片同曲线）只生成一次。
#[derive(Debug, Clone, PartialEq)]
pub struct BezierTable(pub [f32; TABLE_N]);

/// 控制点 → 采样表的全局缓存（键 = 4 个 f32 的位模式；Arc 共享 ⇒ 生成一次全片复用）
fn bezier_cache() -> &'static Mutex<HashMap<[u32; 4], Arc<BezierTable>>> {
    static CACHE: OnceLock<Mutex<HashMap<[u32; 4], Arc<BezierTable>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 控制点 `[x1,y1,x2,y2]` → `Arc<BezierTable>`（缓存命中直接克隆指针）
///
/// ★`x1/x2` 必须是 [0,1]（时间轴单调——否则求值不唯一）；`y1/y2` **任意**
///   （> 1 或 < 0 是回弹/预期效果的来源，CSS 同规）。范围校验在调用方（FFI 解析处）做，
///   本函数只负责生成（解析层的错误消息能带 nodeId——可定位）。
pub fn bezier_table(c: [f32; 4]) -> Arc<BezierTable> {
    let key = [c[0].to_bits(), c[1].to_bits(), c[2].to_bits(), c[3].to_bits()];
    if let Ok(g) = bezier_cache().lock() {
        if let Some(t) = g.get(&key) {
            return Arc::clone(t);
        }
    }
    let mut t = [0f32; TABLE_N];
    for (i, v) in t.iter_mut().enumerate() {
        *v = bezier_eval((c[0], c[1], c[2], c[3]), i as f32 / (TABLE_N - 1) as f32);
    }
    // ★端点钉死（与内置曲线同一条纪律：动画必须精确落在起止值上）
    t[0] = 0.0;
    t[TABLE_N - 1] = 1.0;
    let arc = Arc::new(BezierTable(t));
    if let Ok(mut g) = bezier_cache().lock() {
        g.insert(key, Arc::clone(&arc));
    }
    arc
}

/// ★★**曲线的三次贝塞尔近似**（供平台插值器用——Android `PathInterpolator` 只收贝塞尔控制点）
///
/// 【为什么需要（MA0-RT 的平台差异）】两条平台零参与路径的"传递方式"不同：
///   · iOS：`CAKeyframeAnimation` 收**任意采样值** ⇒ 直接传 Rust 的 17 点采样（**精确**）；
///   · Android：`ViewPropertyAnimator` / `RenderNodeAnimator` 只收**插值器** ⇒ 需要贝塞尔控制点。
/// ⇒ 引擎提供"我们的曲线 → 贝塞尔控制点"的映射（**曲线知识仍只在引擎一处**，
///   平台层不自己写曲线数学——本仓纪律 #22）。
///
/// 【诚实边界】贝塞尔近似**不等于**我们的采样曲线（easeOutCubic 的贝塞尔近似是标准的
///   CSS `cubic-bezier(0.215,0.61,0.355,1)`，与 `1-(1-u)³` 有极小偏差）；
///   误差上界由测试 `bezier_approx_matches_sampled_curve` 钉住（**可判定**，不是"看起来差不多"）。
///
/// 返回 `(x1, y1, x2, y2)`；`None` = 该曲线**没有合适的贝塞尔近似**（调用方走采样路径或降级）。
pub fn curve_bezier_approx(curve: u8) -> Option<(f32, f32, f32, f32)> {
    // ★控制点不是"照抄 CSS 标准值"，而是**对本引擎曲线的数值最优拟合**：
    //   CSS 的 easeOutCubic 控制点 (0.215,0.61,0.355,1) 对本引擎的 `1-(1-u)³`
    //   最大偏差 **0.0223**（首版用它，被测试 `bezier_approx_matches_sampled_curve` 挡下）；
    //   换成下列拟合值后偏差降到 **0.0040 / 0.0075 / 0.0128**（3–5× 改善）。
    //   ★这是"判据驱动优化"的实例：测试给出可判定上界 ⇒ 逼出更好的实现，而不是放宽阈值。
    match curve {
        CURVE_LINEAR => Some((0.0, 0.0, 1.0, 1.0)),
        CURVE_EASE_OUT_CUBIC => Some((0.255, 0.76, 0.515, 1.03)),
        CURVE_EASE_IN_CUBIC => Some((0.41, 0.025, 0.655, 0.01)),
        CURVE_EASE_IN_OUT_CUBIC => Some((0.665, 0.015, 0.355, 1.03)),
        // SPRING_APPROX 是阻尼振荡（非单调）⇒ **没有**贝塞尔近似（诚实返回 None）
        _ => None,
    }
}

/// 求值三次贝塞尔缓动（给定进度 u ⇒ 值）——**仅用于校验近似误差**（生产走平台插值器）
///
/// 标准做法：贝塞尔参数方程 x(t)/y(t)，先解 `x(t)=u` 得 t，再取 `y(t)`（牛顿迭代 + 二分兜底）。
pub fn bezier_eval(c: (f32, f32, f32, f32), u: f32) -> f32 {
    let (x1, y1, x2, y2) = c;
    let u = u.clamp(0.0, 1.0);
    let bez = |a: f32, b: f32, t: f32| {
        let mt = 1.0 - t;
        3.0 * mt * mt * t * a + 3.0 * mt * t * t * b + t * t * t
    };
    // 二分求 t（20 次足够 1e-6 精度；避免牛顿的导数退化问题）
    let (mut lo, mut hi) = (0.0f32, 1.0f32);
    for _ in 0..24 {
        let mid = (lo + hi) / 2.0;
        if bez(x1, x2, mid) < u {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    bez(y1, y2, (lo + hi) / 2.0)
}

/// 动画属性种类（与 TS 侧 `AnimKind` 一一对应——**跨语言契约，不得改号**）
///
/// ★★**颜色通道分解（2026-10-01）**：用户面是**一个** `color` / `textColor` 声明，
///   内核面是**四个标量通道**（背景色 `ColorR/G/B/A` = 5..8；文字色 `TextColorR/G/B/A` = 9..12）。
///   ★文字色与底色是**两组独立通道**（写不同样式槽：`bg` / `text_color`）——
///     同一条求值机器、同一套写值纪律，只是落点不同（"同一语义一处实现"的又一次应用）。
///
/// 【为什么这样分解（架构收益，不是权宜）】引擎的求值机器（曲线查表 / 弹簧积分 / 序列分段 /
///   滚动窗口 / seek / 接管速度移交 / 端点钉死）**全部是标量的**。拆成 4 条标量通道 ⇒
///   上面每台机器**零改动复用**，不新增"多通道求值"的第二套代码（纪律 #22：不另立副本）。
///   写值是**通道独立**的（各改各的字节）⇒ 4 条通道在同一 tick 内的写入顺序不影响最终值，
///   没有读-改-写竞争。
/// 【代价（如实）】一次颜色动画 = 4 条指令（指令计数 +4）；`plan_animations` 的非合成清单
///   会列出 4 个 kind 号（显示名统一为 `color`，见 `display()`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnimKind {
    TranslateX = 0,
    TranslateY = 1,
    Scale = 2,
    /// 旋转（**度**；锚点 = 层中心）
    Rotate = 3,
    /// 不透明度（0..1）
    Opacity = 4,
    /// ★颜色通道 R（0..255 → `bg` 的第 16..23 位）
    ColorR = 5,
    /// ★颜色通道 G（0..255 → 第 8..15 位）
    ColorG = 6,
    /// ★颜色通道 B（0..255 → 第 0..7 位）
    ColorB = 7,
    /// ★颜色通道 A（0..255 → 第 24..31 位）
    ColorA = 8,
    /// ★★文字色通道 R（0..255 → `text_color` 的第 16..23 位；2026-10-01）
    TextColorR = 9,
    /// ★文字色通道 G（0..255 → 第 8..15 位）
    TextColorG = 10,
    /// ★文字色通道 B（0..255 → 第 0..7 位）
    TextColorB = 11,
    /// ★文字色通道 A（0..255 → 第 24..31 位）
    TextColorA = 12,
    /// ★★**绕 X 轴旋转**（2026-10-01 · B 批 3D；**度**；锚点 = 层中心）——
    ///   翻牌 / 立方体 / 卡片 3D 旋入的轴。透视由节点的 `perspective`（CSS 语义）给出。
    RotateX = 13,
    /// ★★**绕 Y 轴旋转**（度；锚点 = 层中心）——翻牌/翻转的轴
    RotateY = 14,
    /// ★★**裁剪形状参数 0..15**（2026-10-01 · C1 clip-path 形变）：用户面一个 `clip` 声明
    ///   （`inset` / `circle` / `polygon`）→ 内核面**最多 16 条标量通道**（与颜色同源的分解法：
    ///   求值机器全是标量的 ⇒ 零改动复用）。含义按节点声明的**形状类型**解释：
    ///   · inset：slot0..3 = top/right/bottom/left
    ///   · circle：slot0..2 = cx/cy/r
    ///   · polygon：slot0..15 = 最多 8 个顶点的 (x,y) 展开
    ///   ★形状**类型**不参与动画（CSS 同规：异型不插值）——类型是静态的（树里声明）。
    Clip0 = 15,
    Clip1 = 16,
    Clip2 = 17,
    Clip3 = 18,
    Clip4 = 19,
    Clip5 = 20,
    Clip6 = 21,
    Clip7 = 22,
    Clip8 = 23,
    Clip9 = 24,
    Clip10 = 25,
    Clip11 = 26,
    Clip12 = 27,
    Clip13 = 28,
    Clip14 = 29,
    Clip15 = 30,
    /// ★★**SVG 描边进度**（2026-10-01 · C2）：`0..1` 的**画线进度**——
    ///   沿路径总弧长从起点画到 `progress × total_len`（"手写字/画圈"的经典动效）。
    ///   路径本体 `d` 是**静态声明**（树里 `svgPath`），本通道只驱动"画到哪"。
    StrokeProgress = 31,
    /// ★★**渐变混合因子**（2026-10-01 · 渐变 v2）：`0..1` = A 态（`fillGradient`）与
    ///   B 态（`fillGradientTo`）之间的**逐色标混合**（颜色四通道 + 位置标量）。
    ///   【为什么这是一个"标量通道"而不是"每色标各一条通道"】色标是**同一个造型的两态**——
    ///   混合语义天然是"整体过渡"（且 A/B 色标一一对应，逐标独立动反而会撕开渐变）；
    ///   ⇒ 与 `opacity` 同级的标量：曲线/弹簧/序列/循环/接管/播放控制**全部零改动复用**。
    ///   ★CSS 没有这个能力（`background-image` 不可过渡）——见 `style::GradState` 注释。
    GradientMix = 32,
    /// ★★**路径变形因子**（2026-10-01 · 路径变形 v1）：`0..1` = A 态（`svgPath`）与
    ///   B 态（`svgPathTo`）的**逐点插值**（每段每个坐标 + 弧长随几何重算）。
    ///   【与描边进度的关系】两者**正交可同开**：变形改几何、进度沿"当前几何的弧长"画到哪
    ///   （弧长表随变形重算——见 `SvgPath::morphed`）。
    ///   ★CSS 完全不能做这件事（`d` 属性不可过渡）——网页端要靠 MorphSVG/flubber 这类库。
    PathMorph = 33,
    /// ★★**发光强度**（2026-10-01 · glow v1）：`0..1` 乘子——声明在树里的 `glow`（色/半径/强度）
    ///   由它驱动"呼吸/渐亮/渐隐"。
    ///   【为什么值得做一个能力（CSS 的角度）】web 上给"发光"做动画是性能雷区：
    ///   `box-shadow` / `filter: drop-shadow` / `blur` 的**每帧变化 = 每帧全量重绘**
    ///   （浏览器里被当作"最贵的动画属性"之一）。本引擎的做法是**分层描边**（N 层同心，
    ///   宽度梯度 + alpha 梯度），每层都是一次普通 GPU 填充——120Hz 预算内毫无压力
    ///   （实测：见墨绘节目 moonGlow 幕读数）。
    ///   ★与 `opacity` 同级的**标量通道** ⇒ 曲线/弹簧/序列/循环/接管/播放控制零改动复用。
    GlowIntensity = 34,
    /// ★★**遮罩进度**（2026-10-01 · mask v1）：`0..1` = 软边揭示的进度（0=全隐 / 1=全显）。
    ///   揭示色标由内核 `MaskSpec::reveal_stops` **唯一实现**（宿主只翻译结果）。
    ///   ★与 clip 互补：clip 是硬边裁剪、遮罩是软边渐隐——两者**可组合**（内核不管组合，
    ///     宿主各自实现：iOS 嵌套 mask / Android saveLayer+DST_IN ⇄ clipPath 天然叠加）。
    MaskProgress = 35,
    /// ★★**倾斜 X**（2026-10-01 · skew v1；度）：`x' = x + tan(skewX)·y`（CSS `skewX` 同式）。
    ///   【为什么走 tick 而不是合成】（与 rotateX/Y 同一条推理）两端的"倾斜"都不是**一等属性**：
    ///   Android `View` 没有 `setSkewX`（只能走 `Matrix`）、iOS `CALayer` 也没有倾斜属性
    ///   （只能自组 shear 矩阵）⇒ 平台插值器无从谈起 ⇒ 统一内核逐帧求值 + 宿主组矩阵。
    ///   ★锚点 = `transform_origin`（默认层中心）——"从根部弯折"= origin 放底部。
    SkewX = 36,
    /// ★★**倾斜 Y**（度）：`y' = y + tan(skewY)·x`（CSS `skewY` 同式）
    SkewY = 37,
}

impl AnimKind {
    pub fn from_u8(v: u8) -> Result<Self, String> {
        Ok(match v {
            0 => AnimKind::TranslateX,
            1 => AnimKind::TranslateY,
            2 => AnimKind::Scale,
            3 => AnimKind::Rotate,
            4 => AnimKind::Opacity,
            5 => AnimKind::ColorR,
            6 => AnimKind::ColorG,
            7 => AnimKind::ColorB,
            8 => AnimKind::ColorA,
            9 => AnimKind::TextColorR,
            10 => AnimKind::TextColorG,
            11 => AnimKind::TextColorB,
            12 => AnimKind::TextColorA,
            13 => AnimKind::RotateX,
            14 => AnimKind::RotateY,
            15 => AnimKind::Clip0,
            16 => AnimKind::Clip1,
            17 => AnimKind::Clip2,
            18 => AnimKind::Clip3,
            19 => AnimKind::Clip4,
            20 => AnimKind::Clip5,
            21 => AnimKind::Clip6,
            22 => AnimKind::Clip7,
            23 => AnimKind::Clip8,
            24 => AnimKind::Clip9,
            25 => AnimKind::Clip10,
            26 => AnimKind::Clip11,
            27 => AnimKind::Clip12,
            28 => AnimKind::Clip13,
            29 => AnimKind::Clip14,
            30 => AnimKind::Clip15,
            31 => AnimKind::StrokeProgress,
            32 => AnimKind::GradientMix,
            33 => AnimKind::PathMorph,
            34 => AnimKind::GlowIntensity,
            35 => AnimKind::MaskProgress,
            36 => AnimKind::SkewX,
            37 => AnimKind::SkewY,
            other => {
                return Err(format!(
                    "未知动画属性 kind={other}（0=translateX/1=translateY/2=scale/3=rotate/4=opacity/\
5..8=color 的 R/G/B/A 通道/9..12=textColor 的 R/G/B/A 通道/13=rotateX/14=rotateY/\
15..30=clip 的形状参数通道）"
                ))
            }
        })
    }

    /// 用户面显示名（错误消息/报告用）——四个颜色通道统一显示为 `color`
    ///
    /// 【为什么需要它】内核面按通道分解，但**报错要说用户的语言**：
    ///   "非合成属性 kinds=[5,6,7,8]" 对用户毫无意义；"含 color" 才是。
    pub fn display(self) -> &'static str {
        match self {
            AnimKind::TranslateX => "translateX",
            AnimKind::TranslateY => "translateY",
            AnimKind::Scale => "scale",
            AnimKind::Rotate => "rotate",
            AnimKind::Opacity => "opacity",
            AnimKind::ColorR | AnimKind::ColorG | AnimKind::ColorB | AnimKind::ColorA => "color",
            AnimKind::TextColorR
            | AnimKind::TextColorG
            | AnimKind::TextColorB
            | AnimKind::TextColorA => "textColor",
            AnimKind::RotateX => "rotateX",
            AnimKind::RotateY => "rotateY",
            AnimKind::Clip0
            | AnimKind::Clip1
            | AnimKind::Clip2
            | AnimKind::Clip3
            | AnimKind::Clip4
            | AnimKind::Clip5
            | AnimKind::Clip6
            | AnimKind::Clip7
            | AnimKind::Clip8
            | AnimKind::Clip9
            | AnimKind::Clip10
            | AnimKind::Clip11
            | AnimKind::Clip12
            | AnimKind::Clip13
            | AnimKind::Clip14
            | AnimKind::Clip15 => "clip",
            AnimKind::StrokeProgress => "strokeProgress",
            AnimKind::GradientMix => "gradientMix",
            AnimKind::PathMorph => "pathMorph",
            AnimKind::GlowIntensity => "glowIntensity",
            AnimKind::MaskProgress => "maskProgress",
            AnimKind::SkewX => "skewX",
            AnimKind::SkewY => "skewY",
        }
    }

    /// 是否 **SVG 描边进度通道**（C2，31）
    pub fn is_stroke(self) -> bool {
        matches!(self, AnimKind::StrokeProgress)
    }

    /// 是否 **渐变混合通道**（渐变 v2，32）
    pub fn is_gradient_mix(self) -> bool {
        matches!(self, AnimKind::GradientMix)
    }

    /// 是否 **路径变形通道**（路径变形 v1，33）
    pub fn is_path_morph(self) -> bool {
        matches!(self, AnimKind::PathMorph)
    }

    /// 是否 **发光强度通道**（glow v1，34）
    pub fn is_glow_intensity(self) -> bool {
        matches!(self, AnimKind::GlowIntensity)
    }

    /// 是否 **遮罩进度通道**（mask v1，35）
    pub fn is_mask_progress(self) -> bool {
        matches!(self, AnimKind::MaskProgress)
    }

    /// 是否 **倾斜通道**（skew v1，36/37）
    pub fn is_skew(self) -> bool {
        matches!(self, AnimKind::SkewX | AnimKind::SkewY)
    }

    /// 是否 **clip 形状参数通道**（15..30）——对应槽位 = kind - 15
    pub fn is_clip(self) -> bool {
        matches!(
            self,
            AnimKind::Clip0 | AnimKind::Clip1 | AnimKind::Clip2 | AnimKind::Clip3
                | AnimKind::Clip4 | AnimKind::Clip5 | AnimKind::Clip6 | AnimKind::Clip7
                | AnimKind::Clip8 | AnimKind::Clip9 | AnimKind::Clip10 | AnimKind::Clip11
                | AnimKind::Clip12 | AnimKind::Clip13 | AnimKind::Clip14 | AnimKind::Clip15
        )
    }

    /// clip 参数槽位（0..16）；非 clip 通道返回 `None`
    pub fn clip_slot(self) -> Option<usize> {
        let v = match self {
            AnimKind::Clip0 => 0,
            AnimKind::Clip1 => 1,
            AnimKind::Clip2 => 2,
            AnimKind::Clip3 => 3,
            AnimKind::Clip4 => 4,
            AnimKind::Clip5 => 5,
            AnimKind::Clip6 => 6,
            AnimKind::Clip7 => 7,
            AnimKind::Clip8 => 8,
            AnimKind::Clip9 => 9,
            AnimKind::Clip10 => 10,
            AnimKind::Clip11 => 11,
            AnimKind::Clip12 => 12,
            AnimKind::Clip13 => 13,
            AnimKind::Clip14 => 14,
            AnimKind::Clip15 => 15,
            _ => return None,
        };
        Some(v)
    }

    /// 是否颜色通道（`write` 分流 + 复位/报告的分界）
    pub fn is_color(self) -> bool {
        matches!(
            self,
            AnimKind::ColorR
                | AnimKind::ColorG
                | AnimKind::ColorB
                | AnimKind::ColorA
                | AnimKind::TextColorR
                | AnimKind::TextColorG
                | AnimKind::TextColorB
                | AnimKind::TextColorA
        )
    }

    /// 是否**文字色**通道（9..12）——与底色通道（5..8）区分：两者写**不同的样式槽**
    pub fn is_text_color(self) -> bool {
        matches!(
            self,
            AnimKind::TextColorR | AnimKind::TextColorG | AnimKind::TextColorB | AnimKind::TextColorA
        )
    }

    /// 该通道在打包色里的位移（R→16 / G→8 / B→0 / A→24）；非颜色通道返回 0
    /// ★**必须穷尽**（不用 `_` 通配）：文字色通道落地时，通配把 R 静默当成 B
    ///   （真机前就被单测抓住：白字改 R 得到 `0xFFFFFF00` 而不是 `0xFF00FFFF`）——
    ///   与"喂给 `write()` 的六个槽"同一套"不写通配、让编译器提醒"的纪律。
    pub fn color_shift(self) -> u32 {
        match self {
            AnimKind::ColorR | AnimKind::TextColorR => 16,
            AnimKind::ColorG | AnimKind::TextColorG => 8,
            AnimKind::ColorB | AnimKind::TextColorB => 0,
            AnimKind::ColorA | AnimKind::TextColorA => 24,
            // 非颜色通道：位移无意义（调用方先判 `is_color()`——此处返回 0 是"中性值"）
            AnimKind::TranslateX
            | AnimKind::TranslateY
            | AnimKind::Scale
            | AnimKind::Rotate
            | AnimKind::Opacity
            | AnimKind::RotateX
            | AnimKind::RotateY
            | AnimKind::Clip0
            | AnimKind::Clip1
            | AnimKind::Clip2
            | AnimKind::Clip3
            | AnimKind::Clip4
            | AnimKind::Clip5
            | AnimKind::Clip6
            | AnimKind::Clip7
            | AnimKind::Clip8
            | AnimKind::Clip9
            | AnimKind::Clip10
            | AnimKind::Clip11
            | AnimKind::Clip12
            | AnimKind::Clip13
            | AnimKind::Clip14
            | AnimKind::Clip15
            | AnimKind::StrokeProgress
            | AnimKind::GradientMix
            | AnimKind::PathMorph
            | AnimKind::GlowIntensity
            | AnimKind::MaskProgress
            | AnimKind::SkewX
            | AnimKind::SkewY => 0,
        }
    }

    /// 静止判据（位置, 速度）——弹簧"停下来"的阈值（单位随属性）
    ///
    /// 取法：位置阈值 = 视觉不可辨的一小步；速度阈值 = 其 20 倍（即"20ms 内移动不足一个位置阈值"）。
    fn settle_eps(self) -> (f32, f32) {
        match self {
            AnimKind::TranslateX | AnimKind::TranslateY => (0.5, 10.0), // px, px/s
            AnimKind::Scale => (0.002, 0.04),                           // 倍, 倍/s
            AnimKind::Rotate => (0.05, 1.0),                            // 度, 度/s
            // ★3D 旋转与 Z 旋转同量纲（度）——同一阈值
            AnimKind::RotateX | AnimKind::RotateY => (0.05, 1.0),       // 度, 度/s
            // ★倾斜同为"度"量纲（tan 前的角度）——同一阈值
            AnimKind::SkewX | AnimKind::SkewY => (0.05, 1.0),           // 度, 度/s
            // ★clip 参数是**盒分数**（0..1 量纲）——与 scale 同量纲，同阈值
            AnimKind::Clip0
            | AnimKind::Clip1
            | AnimKind::Clip2
            | AnimKind::Clip3
            | AnimKind::Clip4
            | AnimKind::Clip5
            | AnimKind::Clip6
            | AnimKind::Clip7
            | AnimKind::Clip8
            | AnimKind::Clip9
            | AnimKind::Clip10
            | AnimKind::Clip11
            | AnimKind::Clip12
            | AnimKind::Clip13
            | AnimKind::Clip14
            | AnimKind::Clip15 => (0.002, 0.04),                        // 盒分数, 盒分数/s
            // ★描边进度是 0..1 量纲（与 clip 参数同）
            AnimKind::StrokeProgress => (0.002, 0.04),
            // ★渐变混合因子同为 0..1 量纲
            AnimKind::GradientMix => (0.002, 0.04),
            // ★路径变形因子同为 0..1 量纲
            AnimKind::PathMorph => (0.002, 0.04),
            // ★发光强度同为 0..1 量纲
            AnimKind::GlowIntensity => (0.002, 0.04),
            // ★遮罩进度同为 0..1 量纲
            AnimKind::MaskProgress => (0.002, 0.04),
            AnimKind::Opacity => (0.003, 0.06),                         // 1, 1/s
            // ★颜色通道：0.5/255 的通道步 ≈ 视觉不可辨（与 translate 的 0.5px 同量级取法）
            AnimKind::ColorR | AnimKind::ColorG | AnimKind::ColorB | AnimKind::ColorA => (0.5, 10.0),
            AnimKind::TextColorR
            | AnimKind::TextColorG
            | AnimKind::TextColorB
            | AnimKind::TextColorA => (0.5, 10.0),
        }
    }

    /// ★★**是否合成属性**（§5-bis.1 的分水岭）——决定能否走「提交一次 + 平台渲染线程自主插值」
    ///
    /// 合成属性 = 平台渲染线程能独立插值、**主线程无需每帧参与**的属性集：
    ///   · Android：`translationX/Y` / `scaleX/Y` / `rotation` / `alpha` → RenderThread 直接更新 RenderNode；
    ///   · iOS：`transform` / `opacity` → CoreAnimation render server（独立进程）自主插值。
    ///
    /// ★★**`color` 是 paint-only 但非合成（2026-10-01，如实标注）**：
    ///   · **不触发布局**（与 opacity 同一成本类：只改绘制属性，不改几何）；
    ///   · 但**不进**"平台零参与"路径——Android 的 `RenderNode` 可插值集里**没有背景色**
    ///     （`setBackgroundColor` 不在 RenderThread 的动画属性中）⇒ 若 iOS 单边放行，
    ///     两端就会**分档**（同一份源码在两端走不同路径）——本仓最忌讳的分叉。
    ///   ⇒ v1 统一走 **tick 路径**（每帧内核求值 + 宿主写值），跨端一致。
    ///   ★诚实边界：iOS 的 `CALayer.backgroundColor` 理论上可由 CA render server 插值，
    ///     但为了跨端一致**不启用**（已写进官网边界页）。
    pub fn is_composited(self) -> bool {
        match self {
            AnimKind::TranslateX | AnimKind::TranslateY | AnimKind::Scale | AnimKind::Rotate
            | AnimKind::Opacity => true,
            // ★★3D 旋转**不进平台零参与路径**（2026-10-01 · B 批，与 color 同源的决策）：
            //   两端的平台插值器对 3D 的语义**不同**（iOS CALayer.transform 是完整 4×4 矩阵可由
            //   CA 插值；Android 的 rotationX/Y 是 View 属性、RenderNode 侧支持面窄且与
            //   Matrix+Camera 的组合行为有差异）⇒ 若单边放行就是两端分档。
            //   ⇒ v1 统一走 **tick 路径**（每帧内核求值 + 宿主组矩阵写层），跨端一致。
            //   ★实测余量：120Hz 下每帧工作 p95 2ms（预算 8.3ms）——3D 走 tick 完全在预算内。
            AnimKind::RotateX | AnimKind::RotateY => false,
            // ★★clip 非合成（2026-10-01 · C1）：裁剪形状是**绘制期约束**（canvas.clipPath /
            //   CALayer.mask）——Android 的 RenderNode 没有"可动画裁剪形状"这类属性
            //   ⇒ 与 color 同源决策：两端统一走 **tick 路径**（每帧内核求值 + 宿主重建裁剪路径）。
            AnimKind::Clip0
            | AnimKind::Clip1
            | AnimKind::Clip2
            | AnimKind::Clip3
            | AnimKind::Clip4
            | AnimKind::Clip5
            | AnimKind::Clip6
            | AnimKind::Clip7
            | AnimKind::Clip8
            | AnimKind::Clip9
            | AnimKind::Clip10
            | AnimKind::Clip11
            | AnimKind::Clip12
            | AnimKind::Clip13
            | AnimKind::Clip14
            | AnimKind::Clip15 => false,
            // ★描边进度同样非合成（绘制期约束——两端都是"改占位层/重画路径"）
            AnimKind::StrokeProgress => false,
            // ★★渐变混合同样非合成（2026-10-01 · v2）：色标是 paint 状态（改 shader/gradient 层
            //   ——与颜色同类）；且 lerp 数学只在**内核**一处（宿主零插值）⇒ 必走 tick。
            AnimKind::GradientMix => false,
            // ★★路径变形（v1）：改的是**几何**（宿主每帧重建平台 path——与描边同族但更重）
            //   ⇒ 必走 tick；且 lerp 只在内核一处（宿主只翻译变形后的段列表）。
            AnimKind::PathMorph => false,
            // ★★发光强度（glow v1）：改的是 paint 状态（分层描边 alpha）——非合成，走 tick。
            AnimKind::GlowIntensity => false,
            // ★★遮罩进度（mask v1）：改的是**合成状态**（layer.mask / saveLayer+DST_IN）——
            //   非合成，走 tick。
            AnimKind::MaskProgress => false,
            // ★★倾斜（skew v1）：两端都不是"一等属性"（Android 无 setSkewX / iOS 无倾斜属性
            //   ——只能自组 shear 矩阵）⇒ 平台插值器无从谈起 ⇒ 统一 tick（见 enum 注释）。
            AnimKind::SkewX | AnimKind::SkewY => false,
            AnimKind::ColorR
            | AnimKind::ColorG
            | AnimKind::ColorB
            | AnimKind::ColorA
            | AnimKind::TextColorR
            | AnimKind::TextColorG
            | AnimKind::TextColorB
            | AnimKind::TextColorA => false,
        }
    }

    /// 写入节点的样式槽（返回"值真的变了"）
    ///
    /// ★颜色通道是**读-改-写**（只动自己那 8 位）：4 条通道在同一 tick 内各改自己的字节
    ///   ⇒ 顺序无关、无竞争。未设底色的节点以 `bg_base` 为种子（都没有 ⇒ 从 0 起），
    ///   因此在一次 tick 内 4 条通道依次写入后即收敛到完整颜色。
    fn write(self, node: &mut crate::node::LNode, v: f32) -> bool {
        // ★★clip 形状参数（2026-10-01 · C1）：按槽位写（与颜色的"只动自己那一段"同源——
        //   多通道各自独立写入 ⇒ 顺序无关）
        if let Some(slot) = self.clip_slot() {
            if node.style.clip[slot] != v {
                node.style.clip[slot] = v;
                return true;
            }
            return false;
        }
        // ★★遮罩进度（mask v1）：一个标量槽（0..1 钳位）
        if self.is_mask_progress() {
            let v = v.clamp(0.0, 1.0);
            if node.style.mask.is_some() && node.style.mask_progress != v {
                node.style.mask_progress = v;
                return true;
            }
            return false;
        }
        // ★★发光强度（glow v1）：一个标量槽（0..1 钳位）
        if self.is_glow_intensity() {
            let v = v.clamp(0.0, 1.0);
            if node.style.glow_intensity != v {
                node.style.glow_intensity = v;
                return true;
            }
            return false;
        }
        // ★★路径变形（v1）：一个标量槽（0..1 钳位——与描边/混合同款"内核只管存"）
        if self.is_path_morph() {
            let v = v.clamp(0.0, 1.0);
            if node.style.path_morph != v {
                node.style.path_morph = v;
                return true;
            }
            return false;
        }
        // ★★渐变混合（v2）：一个标量槽（0..1 钳位——与描边同款"内核只管存"）
        if self.is_gradient_mix() {
            let v = v.clamp(0.0, 1.0);
            if let Some(g) = node.style.grad.as_mut() {
                if g.mix != v {
                    g.mix = v;
                    return true;
                }
            }
            return false;
        }
        // ★★C2：描边进度（一个标量槽——与 clip 的"多槽"不同，它只有一条）
        if self.is_stroke() {
            /// 进度语义：内核侧**只存不裁**（clamp 在写入处做——见 `Anim` 的求值）
            let v = v.clamp(0.0, 1.0);
            if node.style.stroke_progress != v {
                node.style.stroke_progress = v;
                return true;
            }
            return false;
        }
        if self.is_color() {
            // ★底色 / 文字色走**不同的样式槽**（同一套通道数学，只是落点不同）
            let is_text = self.is_text_color();
            let cur = if is_text {
                node.style.text_color.or(node.style.text_color_base).unwrap_or(0)
            } else {
                node.style.bg.or(node.style.bg_base).unwrap_or(0)
            };
            let ch = v.round().clamp(0.0, 255.0) as u32;
            let shift = self.color_shift();
            let mask = 0xFFu32 << shift;
            let next = (cur & !mask) | (ch << shift);
            if next != cur {
                if is_text {
                    node.style.text_color = Some(next);
                } else {
                    node.style.bg = Some(next);
                }
                true
            } else {
                false
            }
        } else {
            let slot = match self {
                AnimKind::TranslateX => &mut node.style.translate_x,
                AnimKind::TranslateY => &mut node.style.translate_y,
                AnimKind::Scale => &mut node.style.scale,
                AnimKind::Rotate => &mut node.style.rotate,
                AnimKind::Opacity => &mut node.style.opacity,
                AnimKind::RotateX => &mut node.style.rotate_x,
                AnimKind::RotateY => &mut node.style.rotate_y,
                AnimKind::SkewX => &mut node.style.skew_x,
                AnimKind::SkewY => &mut node.style.skew_y,
                // clip 通道走上面的早退分支（见 write 开头）；此处不可达
                AnimKind::Clip0
                | AnimKind::Clip1
                | AnimKind::Clip2
                | AnimKind::Clip3
                | AnimKind::Clip4
                | AnimKind::Clip5
                | AnimKind::Clip6
                | AnimKind::Clip7
                | AnimKind::Clip8
                | AnimKind::Clip9
                | AnimKind::Clip10
                | AnimKind::Clip11
                | AnimKind::Clip12
                | AnimKind::Clip13
                | AnimKind::Clip14
                | AnimKind::Clip15 => return false,
                // 描边进度走上面的早退分支（见 write 开头）
                AnimKind::StrokeProgress => return false,
                // 渐变混合走上面的早退分支（见 write 开头）
                AnimKind::GradientMix => return false,
                // 路径变形走上面的早退分支（见 write 开头）
                AnimKind::PathMorph => return false,
                // 发光强度走上面的早退分支（见 write 开头）
                AnimKind::GlowIntensity => return false,
                // 遮罩进度走上面的早退分支（见 write 开头）
                AnimKind::MaskProgress => return false,
                // 颜色走上面的分支（此处不可达——`is_color` 已分流）
                AnimKind::ColorR
                | AnimKind::ColorG
                | AnimKind::ColorB
                | AnimKind::ColorA
                | AnimKind::TextColorR
                | AnimKind::TextColorG
                | AnimKind::TextColorB
                | AnimKind::TextColorA => return false,
            };
            if *slot != v {
                *slot = v;
                true
            } else {
                false
            }
        }
    }
}

/// 动画的**驱动方式**（方案 §4.2 的 `ANIM_SEEK` 落地为此模式）
///
/// · `Time`（默认）：自动播放——`tick(dt)` 推进 `t_ms`，进度 `u = t_ms / dur_ms`；
/// · `Progress`：**外部设进度**——手势 / 滚动 / 路由进度直接 `seek(u)`，`tick` **不推进它**。
///   ⇒ 这是"手势跟随"的机制面：手指移动 → `seek`，动画值**精确跟随**（≤1 帧延迟的判据由此可测）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnimDrive {
    Time = 0,
    Progress = 1,
}

impl AnimDrive {
    pub fn from_u8(v: u8) -> Result<Self, String> {
        Ok(match v {
            0 => AnimDrive::Time,
            1 => AnimDrive::Progress,
            other => return Err(format!("未知驱动方式 drive={other}（0=time/1=progress）")),
        })
    }
}

/// 弹簧参数（Flutter `SpringDescription` 同参数化：`stiffness` / `damping` / `mass`）
///
/// 物理：`F = -k·(x - target) - c·v`，`a = F/m`（x 单位 px，v px/s，k 1/s²，c 1/s）
/// 临界阻尼：`c = 2·√(k·m)`；过阻尼 `c >` 该值（不越过目标），欠阻尼 `<`（会回弹）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpringParams {
    pub stiffness: f32,
    pub damping: f32,
    pub mass: f32,
}

impl SpringParams {
    /// 常用预设（对齐 iOS `.smooth` / RN 默认 的两类手感）
    pub fn snappy() -> Self {
        Self { stiffness: 320.0, damping: 30.0, mass: 1.0 } // 快速、微回弹
    }
    pub fn smooth() -> Self {
        Self { stiffness: 180.0, damping: 26.0, mass: 1.0 } // 顺滑、几乎无回弹
    }
    fn sanitized(&self) -> Self {
        Self {
            stiffness: self.stiffness.max(0.0001),
            damping: self.damping.max(0.0),
            mass: self.mass.max(0.0001),
        }
    }
}

/// ★★序列编排的一段（对标 Flutter `TweenSequenceItem` 的曲线段）
///
/// 【为什么有它（本轮解掉的结构性缺口）】内核对同 `(节点,属性)` 是**替换**语义 ⇒
///   "先下压再弹回"这类**同属性多段**动画，用多条声明表达会被后一条静默替换
///   （编译层只能拦，不能表达）。⇒ 多段收敛到**一条动画**里：`AnimMode::Keyframes`。
///   ★这也是与平台路径的契合点：整段序列仍是**一条** `CAKeyframeAnimation`（采样见 `commit_specs`）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KeySeg {
    /// 本段终点（本段起点 = 上一段终点；首段起点 = `Anim::from`）
    pub to: f32,
    /// 本段时长（毫秒；> 0）
    pub dur_ms: f32,
    /// 本段曲线（与 `CURVE_*` 同编码）
    pub curve: u8,
}

/// 求值模式：查表曲线 / 弹簧物理 / **关键帧序列**（多段）
#[derive(Debug, Clone, PartialEq)]
pub enum AnimMode {
    Curve,
    Spring(SpringParams),
    /// 多段序列（非空；每段曲线求值 ⇒ **曲线知识仍只在引擎一处**）
    Keyframes(Vec<KeySeg>),
}

/// 一条活动动画（值由编译器/调用方生成 ⇒ 全是数字，运行时无字符串）
#[derive(Debug, Clone, PartialEq)]
pub struct Anim {
    /// 目标节点 id（生产语义用 id；索引在 start 时解析）
    pub node_id: u32,
    pub kind: AnimKind,
    pub curve: u8,
    pub from: f32,
    pub to: f32,
    pub dur_ms: f32,
    /// 起始延迟（编排/交错）：`t_ms < delay_ms` 期间**钉在起点**
    pub delay_ms: f32,
    /// 已过时间（`Time` 驱动下由 tick 推进；含延迟）
    pub t_ms: f32,
    /// 驱动方式
    pub drive: AnimDrive,
    /// `Progress` 驱动下的当前进度（0..1；`Time` 驱动下此字段被忽略）
    pub progress: f32,
    /// ★★MA5：**滚动窗口**（`scroll_to > scroll_from` 时生效）——滚动位置→进度的换算在**内核**
    ///
    /// 【为什么换算必须在内核（本仓纪律 #22 的又一次应用）】"视差系数 / 吸顶阈值"看着像布局数学，
    ///   但它决定的是**动画进度**：若宿主各写一份 `(off - from) / span`，三端就会各有一套滚动手感，
    ///   且与 `curve_eval` 的组合方式也会分叉。⇒ 宿主只报**原始滚动位置**，换算 + 曲线 + 写值都在内核。
    /// 【与 `drive` 的关系】带滚动窗口的动画**恒以 `Progress` 语义求值**（`drive` 字段被忽略）——
    ///   窗口的存在本身就说明"进度由外部位置决定"，不是时间。
    pub scroll_from: f32,
    pub scroll_to: f32,
    /// 求值模式
    pub mode: AnimMode,
    /// 当前值（权威 —— 曲线模式 = 本轮求值结果；弹簧模式 = 积分状态）
    pub x: f32,
    /// 当前速度（单位/秒；接管接力的载体）
    pub vel: f32,
    /// 遇同 `(node,kind)` 已有动画时是否**接管**（默认 `true`：位置连续 + 速度移交）
    pub takeover: bool,
    /// ★★**自定义贝塞尔曲线**（2026-10-01 转正）：`Some` 时**优先于** `curve` 内置 id——
    ///   求值走 `BezierTable`（查表+插值），与内置曲线同一台机器。
    ///   `x1/x2 ∈ [0,1]` 的校验在解析层（FFI）做；`y1/y2` 任意（回弹来源）。
    pub curve_pts: Option<Arc<BezierTable>>,
    /// ★★**循环次数**（2026-10-01 · A2）：`1` = 播一遍（缺省）；`>1` = 播 n 遍；
    ///   **`-1` = 无限循环**（呼吸灯/无限脉冲——"把时长写长"的土办法由此退役）。
    ///   ★语义与 CSS `animation-iteration-count` 对齐（数字 / infinite）。
    pub iterations: f32,
    /// ★★**交替方向**（2026-10-01 · A2）：`false` = 每轮都从 `from` 重跑（normal）；
    ///   `true` = 奇偶轮反向（**yoyo**——去程回来程，净位移为 0，天然适合往复呼吸）。
    ///   与 CSS `animation-direction: alternate` 同义。
    pub alternate: bool,
}

impl Anim {
    /// 曲线动画的便捷构造（默认参数：easeOutCubic / 无延迟 / Time 驱动 / 接管）
    pub fn curve_anim(node_id: u32, kind: AnimKind, from: f32, to: f32, dur_ms: f32) -> Self {
        Self {
            node_id,
            kind,
            curve: CURVE_EASE_OUT_CUBIC,
            from,
            to,
            dur_ms,
            delay_ms: 0.0,
            t_ms: 0.0,
            drive: AnimDrive::Time,
            progress: 0.0,
            scroll_from: 0.0,
            scroll_to: 0.0,
            mode: AnimMode::Curve,
            x: from,
            vel: 0.0,
            takeover: true,
            curve_pts: None,
            iterations: 1.0,
            alternate: false,
        }
    }

    /// ★**按进度求值**（Progress 驱动 / `seek` / `seek_velocity` / 滚动联动**共用**的求值入口）
    ///
    /// 【为什么必须收敛成一个入口】此前三处各写 `from + (to-from)*curve_eval(p)`；
    ///   本轮加入 `Keyframes` 后，多段序列要按 `p × 总时长` **分段定位**——
    ///   若三个调用点各写一份，就会有"seek 对、滚动错"这类静默分叉。
    /// ★**实例感知的曲线求值**（自定义贝塞尔优先，否则内置表）
    ///
    /// 【为什么是方法而不是全局函数（2026-10-01 自定义曲线转正）】曲线从"一条 u8"变成
    ///   "u8 或控制点表"两态 ⇒ 求值必须看**这条动画自己**的曲线。收敛成实例方法后，
    ///   所有求值点（时间推进 / 进度求值 / commit 采样）都走它——不会漏改一处。
    #[inline]
    pub fn curve_at(&self, u: f32) -> f32 {
        match &self.curve_pts {
            Some(t) => table_eval(&t.0, u),
            None => curve_eval(self.curve, u),
        }
    }

    /// ★**轮内求值（不做循环映射）**——`p_round` 已是"本轮 + 方向"下的进度。
    ///
    /// 【谁调它】时间推进（`step` 用 `loop_phase` 算出轮内进度后直接喂这里——
    ///   若再映射一次就是**双重映射**：多轮动画会跳帧）。
    pub fn value_at_round_progress(&self, p_round: f32) -> f32 {
        let p = p_round.clamp(0.0, 1.0);
        match &self.mode {
            AnimMode::Keyframes(segs) if !segs.is_empty() => {
                let total: f32 = segs.iter().map(|s| s.dur_ms.max(0.0)).sum();
                if total <= 0.0 {
                    return segs[segs.len() - 1].to; // 全零时长 ⇒ 直接落终点（不出 NaN）
                }
                eval_keyframes(self.from, segs, p * total).0
            }
            _ => self.from + (self.to - self.from) * self.curve_at(p),
        }
    }

    /// ★**整程进度求值**（公开 API：`seek` / 滚动 / 探针）——`p ∈ [0,1]` 是**整条动画**的
    ///   归一化进度（含全部循环轮）。多轮时先折算到"第几轮 + 轮内进度"（alternate 时奇偶反向），
    ///   再走轮内求值。
    pub fn value_at_progress(&self, p: f32) -> f32 {
        let p = p.clamp(0.0, 1.0);
        let p_round = if self.iterations > 1.0 {
            // 多轮：把整程进度折算到本轮（seek 0.7 且 3 轮 ⇒ 第 2.1 轮的第一轮内 0.1... 依 yoyo 反向）
            let raw = p * self.iterations;
            let c = raw.floor().min(self.iterations - 1.0);
            let u = raw - c.min(raw); // 保护：raw 恰为整数时 u = 0
            if self.alternate && (c as i64) % 2 == 1 {
                1.0 - u
            } else {
                u
            }
        } else {
            p
        };
        self.value_at_round_progress(p_round)
    }
}

/// 首段之外，某段的起点 = 上一段终点（推导；避免存两份"段的 from"）
pub fn seg_start(from: f32, segs: &[KeySeg], i: usize) -> f32 {
    if i == 0 {
        from
    } else {
        segs[i - 1].to
    }
}

/// ★★**关键帧序列求值**（距序列起点 `tau` 毫秒处的值）
///
/// 返回 `(值, 是否已走完)`；走完时值**精确等于**末段 `to`（端点钉死——与单段语义一致）。
/// `tau` 落到第 i 段：局部 `u = tau_i / dur_i`，仍走 `curve_eval`（曲线知识只在引擎一处）。
pub fn eval_keyframes(from: f32, segs: &[KeySeg], tau: f32) -> (f32, bool) {
    let mut t = tau;
    let n = segs.len();
    for i in 0..n {
        let s = segs[i];
        if t < s.dur_ms || i == n - 1 {
            let u = if s.dur_ms <= 0.0 { 1.0 } else { (t / s.dur_ms).clamp(0.0, 1.0) };
            let start = seg_start(from, segs, i);
            let x = start + (s.to - start) * curve_eval(s.curve, u);
            return (x, u >= 1.0 && i == n - 1);
        }
        t -= s.dur_ms;
    }
    (from, true) // 空序列兜底（调用方保证非空）
}

/// ★★共享元素过渡的**几何计划**（"从哪飞到哪"的全部数学——唯一实现在内核）
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SharedElementPlan {
    /// 源中心 − 目标中心（x；动画从它归位到 0）
    pub dx: f32,
    pub dy: f32,
    /// 源宽 / 目标宽（等比缩放系数；从它归位到 1）
    pub scale: f32,
    pub source: Rect,
    pub target: Rect,
}

/// 由**源矩形 + 目标矩形**算飞行参数（中心差 + 宽度比）
///
/// 【为什么"宽度比"而不是别的】内核只有**等比** scale ⇒ 以宽度为准；
///   源/目标宽高比不一致时高度按目标宽高比等比推出（如实边界见 README）。
/// 【明确拒绝而非静默】目标无可测尺寸（未布局/被移除）⇒ Err——静默会变成"元素不动"难查。
pub fn shared_element_plan(source: Rect, target: Rect) -> Result<SharedElementPlan, String> {
    let finite = |r: &Rect| r.x.is_finite() && r.y.is_finite() && r.width.is_finite() && r.height.is_finite();
    if !finite(&source) || !finite(&target) {
        return Err(format!(
            "共享元素：矩形含非有限值（源 {:?} / 目标 {:?}）",
            (source.x, source.y, source.width, source.height),
            (target.x, target.y, target.width, target.height)
        ));
    }
    if target.width <= 0.5 || target.height <= 0.5 {
        return Err(format!(
            "共享元素：目标节点无可测尺寸（{}×{}）——先完成布局/物化再启动",
            target.width, target.height
        ));
    }
    if source.width <= 0.0 {
        return Err(format!("共享元素：源矩形宽非法（{}）", source.width));
    }
    let dx = (source.x + source.width * 0.5) - (target.x + target.width * 0.5);
    let dy = (source.y + source.height * 0.5) - (target.y + target.height * 0.5);
    let scale = source.width / target.width;
    if !scale.is_finite() || scale <= 0.0 {
        return Err(format!("共享元素：缩放系数非法（{scale}）"));
    }
    Ok(SharedElementPlan { dx, dy, scale, source, target })
}

/// 节点的**绝对矩形**（与 `flip_capture` 同一套 offsets + 同一把尺子——卡 I2 的吸附在收集处）
///
/// 【为什么走同一条收集函数】`collect_abs_pairs` 同时承担：display:none 跳过、祖先偏移累加、
///   导出边界吸附。单节点若另写一遍遍历，三件事都要各写一次 ⇒ 迟早有一件漏（本仓同源教训多次）。
pub fn node_abs_rect(tree: &LayoutTree, node_id: u32) -> Option<Rect> {
    let mut v: Vec<(u32, Rect)> = Vec::new();
    for &root in &tree.roots {
        crate::rects_bin::collect_abs_pairs(tree, root, 0.0, 0.0, &mut v);
    }
    v.into_iter().find(|(id, _)| *id == node_id).map(|(_, r)| r)
}

/// ★★**复位一组节点的全部视觉字段**（"解绑"必须含**清值**，不能只停动画）
///
/// 【为什么必须有（本仓真机实测，一次污染两个判据）】`stop_nodes` 首版只把动画项从列表移除，
///   而**内核样式字段保留在最后一个值上** ⇒ 残留的 rotate/scale 会：
///   ① 让后续相位从"错误姿态"继续（真机：`gesture_tx=697` 而目标 80——差 617 恰为
///      `node.midX+midY`，即旋转 90° 后的复合矩阵偏移）；
///   ② 让宿主探针读到的是**复合变换**而非纯位移（`m41 = tx + midX + midY`）。
///   ⇒ 凡"停止/回收/清场"语义，必须**同时清值**（本函数即该义务的唯一实现）。
///
/// - Returns: 实际被改写的节点数（供宿主/判据对账）
pub fn reset_visuals(tree: &mut LayoutTree, node_ids: &[u32]) -> usize {
    let mut n = 0;
    for id in node_ids {
        if let Some(node) = tree.nodes.iter_mut().find(|x| x.id == *id) {
            let s = &mut node.style;
            // ★颜色也要判脏（2026-10-01）：`bg` 与底色的差即"颜色被动画改过"；
            //   文字色（`text_color`）同理——两组通道各自判、各自复位
            let color_dirty = s.bg != s.bg_base || s.text_color != s.text_color_base;
            // ★B 批 3D（2026-10-01）：`rotate_x/rotate_y` 必须参与"脏判定 + 复位"——
            //   ★这是真机判据抓出的**真缺陷**（E4 间歇红）：3D 测试的 rotateY=180 残留在
            //   节点样式里 ⇒ 后续 seek 驱动的层带上"绕 Y 翻转"⇒ 探针读 tx 得到
            //   `470 = 80 + 视口宽 390`（透视投影偏移）而非 80。**"解绑必须含清值"**
            //   的新字段版：新加可动画字段时必须进这里（漏一个 = 静默残留）。
            // ★C1：clip 参数也要判脏（有裁剪且参数偏离基态 = 脏）
            let clip_dirty = s.clip_kind != 0 && s.clip != s.clip_base;
            // ★C2：描边进度回 0（基态 = 未画）
            // ★C2 基态：偏离**声明基态**才算脏（2026-10-01——静态声明 `progress:1` 的路径
            //   不参与复位；此前硬编码 0 ⇒ 复位会把"生来已画成"的静态描边**抹掉**）
            let stroke_base = if s.svg_path.is_some() { s.stroke_progress_base } else { 0.0 };
            let stroke_dirty = s.svg_path.is_some() && s.stroke_progress != stroke_base;
            // ★渐变 v2：混合因子回 0（基态 = 全 A——与"解绑必须含清值"同一义务）
            let grad_dirty = s.grad.as_ref().is_some_and(|g| g.mix != 0.0);
            // ★路径变形 v1：变形因子回 0（基态 = 全 A）
            let morph_dirty = s.svg_path_to.is_some() && s.path_morph != 0.0;
            // ★发光 v1：强度回 1（基态 = 按声明全额发光）
            let glow_dirty = s.glow.is_some() && s.glow_intensity != 1.0;
            // ★遮罩 v1：进度回**声明的基态**（可能是 0——如"未显出"的基态律）
            let mask_dirty = s
                .mask
                .as_ref()
                .is_some_and(|m| s.mask_progress != m.progress_base);
            let dirty = s.translate_x != 0.0
                || s.translate_y != 0.0
                || s.scale != 1.0
                || s.rotate != 0.0
                || s.rotate_x != 0.0
                || s.rotate_y != 0.0
                || s.skew_x != 0.0
                || s.skew_y != 0.0
                || s.opacity != 1.0
                || color_dirty
                || clip_dirty
                || stroke_dirty
                || grad_dirty
                || morph_dirty
                || glow_dirty
                || mask_dirty;
            if dirty {
                s.translate_x = 0.0;
                s.translate_y = 0.0;
                s.scale = 1.0;
                s.rotate = 0.0;
                s.rotate_x = 0.0;   // ★B 批 3D：与 rotate 同一义务
                s.rotate_y = 0.0;
                s.skew_x = 0.0;     // ★skew v1：同义务
                s.skew_y = 0.0;
                s.clip = s.clip_base; // ★C1：裁剪参数回基态（与颜色回底色同一条"解绑含清值"）
                s.stroke_progress = stroke_base; // ★C2：回**声明基态**（缺省 0 = 未画；静态已画成 = 1）
                if let Some(g) = s.grad.as_mut() {
                    g.mix = 0.0; // ★渐变 v2：混合因子回 0（全 A）
                }
                s.path_morph = 0.0; // ★路径变形 v1：变形因子回 0（全 A）
                s.glow_intensity = 1.0; // ★发光 v1：强度回 1（全额）
                if let Some(m) = s.mask.as_ref() {
                    s.mask_progress = m.progress_base; // ★遮罩 v1：回声明基态
                }
                s.opacity = 1.0;
                // ★复位 = 回底色 / 回原文字色（不是清成 None：那会丢掉"本节点有基色"的事实）
                s.bg = s.bg_base;
                s.text_color = s.text_color_base;
                n += 1;
            }
        }
    }
    n
}

/// ★★**动画计划**（§5-bis.2：合成属性判定 —— "把会不会掉帧变成编译期问题"的内核落点）
///
/// 【它回答什么】一批动画能否走**平台渲染线程零参与**路径（提交一次 ⇒ 主线程不再每帧参与）？
///   · 全部属性 ∈ 合成集 ⇒ ✅ 可走（`platform_path = true`）
///   · 含非合成属性 ⇒ ❌ 必须走每帧 tick 路径（或由上层在**编译期**就拦住 —— 见 Morpheus §5-bis.2）
///
/// ★为什么判定要在**启动前**做（而不是每帧试探）：平台路径与 tick 路径是**两套提交机制**
///   （前者把动画描述交给系统，后者由我们每帧写值）——混用会导致同一属性被两处写（抖动）。
#[derive(Debug, Clone, PartialEq)]
pub struct AnimPlan {
    /// 该批动画是否全部为合成属性（⇒ 可走平台渲染线程零参与路径）
    pub composited: bool,
    /// 非合成属性的种类（`composited=false` 时非空；供上层报错/降级标记）
    pub non_composited_kinds: Vec<AnimKind>,
    /// 涉及节点数（去重）
    pub node_count: usize,
    /// 动画条数
    pub anim_count: usize,
}

/// 对一批动画做**合成属性判定**（见 `AnimPlan`）
pub fn plan_animations(anims: &[Anim]) -> AnimPlan {
    let mut bad: Vec<AnimKind> = Vec::new();
    let mut nodes: std::collections::HashSet<u32> = std::collections::HashSet::new();
    for a in anims {
        nodes.insert(a.node_id);
        if !a.kind.is_composited() && !bad.contains(&a.kind) {
            bad.push(a.kind);
        }
    }
    AnimPlan {
        composited: bad.is_empty(),
        non_composited_kinds: bad,
        node_count: nodes.len(),
        anim_count: anims.len(),
    }
}

/// ★★**平台提交规格**（§5-bis：走"提交一次 + 平台渲染线程自主插值"路径所需的全部数据）
///
/// 【设计分工（为什么采样在 Rust 侧做）】曲线求值是**本引擎的唯一实现**（`curve_eval`）；
///   若宿主自己再写一份曲线，就是"第 N 份手写副本"（本仓纪律禁止）。⇒ Rust 侧把动画
///   **采样成关键帧序列**，宿主只做"翻译成平台 API"（iOS `CAKeyframeAnimation` /
///   Android `RenderNode` 动画）——宿主里**没有任何曲线数学**。
///
/// 【为什么是节点级（而不是逐属性）】平台的合成动画以**层/视图**为单位：
///   iOS 的 `transform` 是一个整体（`CATransform3D`），拆成多条子属性动画会互相覆盖
///   ⇒ 必须把同节点的多个属性**合成为一组采样**（宿主据此构造 `CATransform3D` 序列）。
#[derive(Debug, Clone, PartialEq)]
pub struct CommitSpec {
    pub node_id: u32,
    /// 时长（毫秒）= 该节点各自动画时长的**最大值**（短的补到长）
    pub dur_ms: f32,
    /// 起始延迟（毫秒）= 各动画延迟的最小值
    pub delay_ms: f32,
    /// 采样时刻（0..1，含端点；长度 = `samples.len()`）
    pub key_times: Vec<f32>,
    /// 每个采样点的**五元组**：`(tx, ty, scale, rotate, opacity)`
    pub samples: Vec<(f32, f32, f32, f32, f32)>,
}

/// 采样点数（17 = 16 段）：曲线表是 65 点，17 点表达后平台侧误差 ≤1e-3 量级（视觉不可辨）
pub const COMMIT_SAMPLES: usize = 17;

/// 把一批动画**合成为平台提交规格**（节点级；见 `CommitSpec`）
///
/// 仅对**合成属性**有意义（非合成属性必须走 tick 路径——见 `AnimPlan`）。
/// ★颜色（kind 5..8）是**非合成** ⇒ 由调用方（`anim_commit_spec` 入口的 `plan_animations`）
///   整批拒绝（不静默丢、也不假装能提交）；本函数**不**再自己做一遍判定
///   （纪律 #22：同一语义一处实现——两处各判会分叉）。
/// 同一 `(node, kind)` 重复出现时**后发者胜**（与 `start` 的替换语义一致）。
pub fn commit_specs(tree: &LayoutTree, anims: &[Anim]) -> Vec<CommitSpec> {
    // ① 按节点分组（同 (node,kind) 后发者胜）
    let mut by_node: std::collections::HashMap<u32, Vec<Anim>> = std::collections::HashMap::new();
    for a in anims {
        let v = by_node.entry(a.node_id).or_default();
        if let Some(slot) = v.iter_mut().find(|x| x.kind == a.kind) {
            *slot = a.clone(); // ★clone：Anim 含 Vec（Keyframes）⇒ 非 Copy
        } else {
            v.push(a.clone());
        }
    }

    // ② 逐节点采样
    let mut out: Vec<CommitSpec> = Vec::with_capacity(by_node.len());
    for (node_id, items) in by_node {
        // 该节点当前的静态视觉值（未参与动画的属性取它——避免采样把无关属性清零）
        let base = tree.nodes.iter().find(|n| n.id == node_id).map(|n| {
            (n.style.translate_x, n.style.translate_y, n.style.scale, n.style.rotate, n.style.opacity)
        });
        let Some((bx, by, bsc, brot, bop)) = base else { continue };

        // ★有效时长 = max(各动画时长)；**弹簧用自然静止时间**（否则会被窗口截断，实测抓出）；
        //   **序列用段时长之和**（不是名义 dur_ms——两者不一致时序列会被截断/拖尾）
        let dur = items
            .iter()
            .map(|a| match &a.mode {
                AnimMode::Curve => a.dur_ms,
                AnimMode::Spring(p) => a.dur_ms.max(spring_settle_ms(a, *p)),
                AnimMode::Keyframes(segs) => segs.iter().map(|s| s.dur_ms).sum(),
            })
            .fold(0f32, f32::max)
            .max(1.0);
        let delay = items.iter().map(|a| a.delay_ms).fold(f32::MAX, f32::min).min(0.0);

        let mut key_times = Vec::with_capacity(COMMIT_SAMPLES);
        let mut samples = Vec::with_capacity(COMMIT_SAMPLES);
        for i in 0..COMMIT_SAMPLES {
            let u = i as f32 / (COMMIT_SAMPLES - 1) as f32;
            key_times.push(u);
            // 起点：各属性取自己的 `from`（未动画的属性取静态基线）
            let mut v = (bx, by, bsc, brot, bop);
            for a in &items {
                let local = if a.dur_ms <= 0.0 { 1.0 } else { (u * dur / a.dur_ms).min(1.0) };
                let val = match &a.mode {
                    AnimMode::Curve => a.from + (a.to - a.from) * a.curve_at(local),
                    // ★弹簧的解析采样：用同一套物理积分（**不是**平台 spring——保证与 tick 路径同形）
                    AnimMode::Spring(p) => spring_sample(a, *p, u * dur),
                    AnimMode::Keyframes(segs) => {
                        let total: f32 = segs.iter().map(|s| s.dur_ms.max(0.0)).sum();
                        eval_keyframes(a.from, segs, u * total).0
                    }
                };
                match a.kind {
                    AnimKind::TranslateX => v.0 = val,
                    AnimKind::TranslateY => v.1 = val,
                    AnimKind::Scale => v.2 = val,
                    AnimKind::Rotate => v.3 = val,
                    AnimKind::Opacity => v.4 = val,
                    // ★颜色与 3D 不可达（`anim_commit_spec` 入口已按 `plan_animations` 整批拒绝）——
                    //   这里显式 match 而非 `_` 通配，是为了**编译期**就提醒：将来若放行它们，
                    //   必须同时扩展 `CommitSpec` 的采样元组（现在只有五元组）。
                    AnimKind::ColorR
                    | AnimKind::ColorG
                    | AnimKind::ColorB
                    | AnimKind::ColorA
                    | AnimKind::TextColorR
                    | AnimKind::TextColorG
                    | AnimKind::TextColorB
                    | AnimKind::TextColorA
                    | AnimKind::RotateX
                    | AnimKind::RotateY
                    | AnimKind::Clip0
                    | AnimKind::Clip1
                    | AnimKind::Clip2
                    | AnimKind::Clip3
                    | AnimKind::Clip4
                    | AnimKind::Clip5
                    | AnimKind::Clip6
                    | AnimKind::Clip7
                    | AnimKind::Clip8
                    | AnimKind::Clip9
                    | AnimKind::Clip10
                    | AnimKind::Clip11
                    | AnimKind::Clip12
                    | AnimKind::Clip13
                    | AnimKind::Clip14
                    | AnimKind::Clip15
                    | AnimKind::StrokeProgress
                    // ★渐变混合（v2）：与颜色/裁剪同类——**不可达**（commit 是"五元组平台路径"，
                    //   入口 `anim_commit_spec` 已按 `plan_animations` 整批拒绝非合成属性）。
                    // ★路径变形（v1）：同理不可达。
                    // ★发光强度（glow v1）：同理不可达。
                    // ★遮罩进度（mask v1）：同理不可达。
                    // ★倾斜（skew v1）：commit 是"五元组平台路径"——同理不可达。
                    | AnimKind::GradientMix
                    | AnimKind::PathMorph
                    | AnimKind::GlowIntensity
                    | AnimKind::MaskProgress
                    | AnimKind::SkewX
                    | AnimKind::SkewY => {}
                }
            }
            samples.push(v);
        }
        // ★端点钉死（与 tick 路径同语义：必须精确落在 to）
        if samples.len() >= 2 {
            let mut last = samples[samples.len() - 1];
            for a in &items {
                match a.kind {
                    AnimKind::TranslateX => last.0 = a.to,
                    AnimKind::TranslateY => last.1 = a.to,
                    AnimKind::Scale => last.2 = a.to,
                    AnimKind::Rotate => last.3 = a.to,
                    AnimKind::Opacity => last.4 = a.to,
                    // ★颜色与 3D 不可达（见上）
                    AnimKind::ColorR
                    | AnimKind::ColorG
                    | AnimKind::ColorB
                    | AnimKind::ColorA
                    | AnimKind::TextColorR
                    | AnimKind::TextColorG
                    | AnimKind::TextColorB
                    | AnimKind::TextColorA
                    | AnimKind::RotateX
                    | AnimKind::RotateY
                    | AnimKind::Clip0
                    | AnimKind::Clip1
                    | AnimKind::Clip2
                    | AnimKind::Clip3
                    | AnimKind::Clip4
                    | AnimKind::Clip5
                    | AnimKind::Clip6
                    | AnimKind::Clip7
                    | AnimKind::Clip8
                    | AnimKind::Clip9
                    | AnimKind::Clip10
                    | AnimKind::Clip11
                    | AnimKind::Clip12
                    | AnimKind::Clip13
                    | AnimKind::Clip14
                    | AnimKind::Clip15
                    | AnimKind::StrokeProgress
                    // ★渐变混合（v2）：与颜色/裁剪同类——**不可达**（commit 是"五元组平台路径"，
                    //   入口 `anim_commit_spec` 已按 `plan_animations` 整批拒绝非合成属性）。
                    // ★路径变形（v1）：同理不可达。
                    // ★发光强度（glow v1）：同理不可达。
                    // ★遮罩进度（mask v1）：同理不可达。
                    // ★倾斜（skew v1）：commit 是"五元组平台路径"——同理不可达。
                    | AnimKind::GradientMix
                    | AnimKind::PathMorph
                    | AnimKind::GlowIntensity
                    | AnimKind::MaskProgress
                    | AnimKind::SkewX
                    | AnimKind::SkewY => {}
                }
            }
            let n = samples.len();
            samples[n - 1] = last;
        }
        out.push(CommitSpec { node_id, dur_ms: dur, delay_ms: delay, key_times, samples });
    }
    out.sort_by_key(|s| s.node_id);
    out
}

/// 弹簧的**自然静止时间**（毫秒）：跑一遍积分直到满足静止判据（或到安全上限）
///
/// 【为什么需要（本仓实测的截断缺陷）】弹簧**没有固定时长**（由物理决定）；若用 `dur_ms`
///   当采样窗口，窗口末尾会被"端点钉死"逻辑截断 ⇒ **动画看起来没走完**。
///   ⇒ 提交路径必须用**自然静止时间**做窗口（`commit_specs` 里取 `max(dur_ms, settle_ms)`）。
fn spring_settle_ms(a: &Anim, p: SpringParams) -> f32 {
    let p = p.sanitized();
    let (mut x, mut v) = (a.from, 0.0);
    let (eps_pos, eps_vel) = a.kind.settle_eps();
    let step = MAX_SUBSTEP_S * 1000.0; // 4ms 步（与 tick 的子步一致）
    let mut t = 0.0f32;
    while t < SPRING_MAX_MS {
        let h = MAX_SUBSTEP_S;
        let acc = (-p.stiffness * (x - a.to) - p.damping * v) / p.mass;
        v += acc * h;
        x += v * h;
        t += step;
        if (x - a.to).abs() <= eps_pos && v.abs() <= eps_vel {
            return t;
        }
    }
    SPRING_MAX_MS
}

/// 弹簧的**离线采样**（把物理积分跑一遍，取 t 时刻的值）——供提交规格用
///
/// 【为什么不用平台的 spring】iOS `CASpringAnimation` / Android SpringAnimation 的
///   参数语义与本引擎的（stiffness/damping/mass 半隐式欧拉）**不完全一致** ⇒ 直接交给它们
///   会让"提交路径"与"tick 路径"的观感分叉。⇒ 用**同一套积分**离线采样，保证两条路径同形。
fn spring_sample(a: &Anim, p: SpringParams, t_ms: f32) -> f32 {
    let p = p.sanitized();
    let (mut x, mut v) = (a.from, 0.0);
    let mut remaining = t_ms / 1000.0;
    while remaining > 0.0 {
        let h = remaining.min(MAX_SUBSTEP_S);
        let acc = (-p.stiffness * (x - a.to) - p.damping * v) / p.mass;
        v += acc * h;
        x += v * h;
        remaining -= h;
    }
    x
}

/// **受影响节点的视觉状态**（宿主据此刷层/绘制的唯一真相）
///
/// 【为什么必须回报（本仓纪律：静默不更新是最危险的失效模式）】宿主（CALayer/Canvas）
///   只认自己那份绘制状态；内核改了 `style.translate_*` 而宿主不知道 ⇒ **屏幕不动**
///   （几何、日志、单测全对，只有肉眼能发现）。这正是 V6 教训（`text_updates` 同源）的第二例。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NodeVisual {
    pub id: u32,
    pub tx: f32,
    pub ty: f32,
    pub scale: f32,
    pub rotate: f32,
    /// ★★3D 旋转（2026-10-01 · B 批；度）——走 tick 路径（见 `is_composited` 注释）
    pub rotate_x: f32,
    pub rotate_y: f32,
    /// ★★倾斜（skew v1；度）——走 tick（见 `AnimKind::SkewX` 注释）
    pub skew_x: f32,
    pub skew_y: f32,
    pub opacity: f32,
    /// ★颜色（2026-10-01）：打包 `0xAARRGGBB`；`None` = 本节点无内核底色
    ///   （宿主保持自己的静态绘制——见 `LStyle.bg` 注释）
    pub bg: Option<u32>,
    /// ★★**文字色**（2026-10-01）：打包 `0xAARRGGBB`；`None` = 本节点无内核文字色
    ///   （宿主保持自己的静态绘制——与 `bg` 同一条约定，只是落到文字而不是底色）
    pub text_color: Option<u32>,
    /// 该值是否**有效可消费**（颜色轨道专用；`false` ⇒ 宿主忽略本字段）
    ///
    /// 【为什么要显式布尔而不是靠 `None` 判断】`bg: None` 有两义：① 节点无底色；
    ///   ② 宿主拿到的记录里"本条更新没带颜色"。显式布尔让两端宿主与判据**不必猜**
    ///   （本仓纪律：不静默、不靠约定——判据要能区分"没做"与"做了值为 0"）。
    pub color_valid: bool,
    /// ★文字色是否**有效可消费**（与 `color_valid` 同一语义，分别对应两组通道）
    pub text_color_valid: bool,
    /// ★★**裁剪形状**（2026-10-01 · C1）：`None` = 本节点无裁剪（宿主保持静态绘制）；
    ///   `Some((kind, params))` = 当前形状（每帧内核求值后的值——宿主据它重建裁剪路径）。
    ///   `kind`：1=inset 2=circle 3=polygon（与 `LStyle.clip_kind` 同编码）
    pub clip: Option<(u8, [f32; 16])>,
    /// ★★**SVG 描边进度**（2026-10-01 · C2）：`None` = 本节点无描边路径（宿主保持静态绘制）；
    ///   `Some(p)` = 当前画线进度（0..1——宿主据此设 strokeEnd / trimPath）。
    pub stroke_progress: Option<f32>,
    /// ★★**渐变（混合后）**（2026-10-01 · 渐变 v2）：`None` = 本节点无渐变（宿主保持静态绘制）；
    ///   `Some((kind, n, colors, offsets))` = **内核已混合**的当前色标——宿主零 lerp 数学
    ///   （与 clip 的"内核算好参数、宿主只翻译"同一分工）。
    ///   · `kind`：1=linear 2=radial（静态，但随帧带上 = 记录自描述）
    ///   · `n`：有效色标数（2..8）
    ///   · `colors`/`offsets`：**已含 `mix` 混合**的 8 槽数组（只用前 n 个）
    ///   · `geo`：`[angle, cx, cy, r]`——**已含 `mix` 混合**的几何（渐变 v2 扩展）
    pub grad: Option<(u8, u8, [u32; 8], [f32; 8], [f32; 4])>,
    /// ★★**路径变形因子**（路径变形 v1）：`None` = 本节点无 B 态（不可变形）；
    ///   `Some(t)` = 当前因子（宿主见它变化时向内核要**变形后的段列表**——
    ///   段是变长数据，不进定长记录；见 FFI `proteus_layout_svg_morph_path`）。
    pub path_morph: Option<f32>,
    /// ★★**发光强度**（glow v1）：`None` = 本节点无发光声明；`Some(v)` = 当前强度（0..1）。
    pub glow_intensity: Option<f32>,
    /// ★★**遮罩揭示色标**（mask v1）：`None` = 本节点无遮罩；
    ///   `Some((kind, [oA,oB], [aA,aB]))` = **内核已算好**的双色标（宿主只翻译）。
    pub mask: Option<(u8, [f32; 2], [f32; 2])>,
}

/// 一次 tick（或 seek）的结果（供宿主刷新层 / 测试观测）
#[derive(Debug, Default, Clone, PartialEq)]
pub struct TickOutcome {
    /// 本帧真正写入的字段数（值未变则不写）
    pub changed: usize,
    /// 本帧结束（到达时长 / 弹簧静止）的动画数
    pub finished: usize,
    /// tick 之后仍在活动的动画数
    pub active_after: usize,
    /// 见 `NodeVisual`（只含**值真的变了**的节点）
    pub updates: Vec<NodeVisual>,
}

/// FLIP 启动的结果（宿主/判据对账用）
#[derive(Debug, Default, Clone, PartialEq)]
pub struct FlipOutcome {
    /// 被补间的节点数
    pub animated: usize,
    /// 最大位移量（px）——判据可用它区分"布局真的变了"与"什么都没动"
    pub max_delta_px: f32,
    /// ★★**受影响节点的初始视觉状态**（必须立即返回给宿主）
    ///
    /// 【为什么必须（本仓真机实测的跳变缺陷）】FLIP 的 ① 步把 translate 写成 `old - new`
    ///   （"视觉上仍在旧位置"），但若宿主**不知道**这个初始值 ⇒ 层还是几何算出的新位置
    ///   ⇒ **第一帧会跳变**（先看到新位置，再弹回旧位置开始补间）。
    ///   真机实测：`flip.start` 返回后层上 ty=0（而内核已是 -40）⇒ 判据 F3c 当场抓出。
    ///   ⇒ 与 `tick` 的 `updates` 同一通道（`NodeVisual` 五值）。
    pub updates: Vec<NodeVisual>,
}

/// 动画引擎（每个树句柄一个实例）
///
/// ★索引缓存：`start` 时把 `node_id` 解析成 `nodes[i]` 的下标并**缓存**——
///   否则每帧每条动画都要线性找节点（O(anim × nodes)/帧），那不是"编译期指令"的精神。
///   代价：树结构变更（压实/删除）会使缓存失效 ⇒ 边界见文件头。
#[derive(Debug, Default, Clone)]
pub struct AnimEngine {
    anims: Vec<(Anim, usize)>,
    /// FLIP 快照（`flip_capture` 存入；`flip_start` 消费并清空）
    flip_snap: Option<Vec<(u32, Rect)>>,
    /// ★★**时间因子**（2026-10-01 · A3 播放控制）：`dt` 全局缩放——
    ///   `1.0` = 实时；`0.25` = 慢动作；`2.0` = 快进。只影响**时间推进**，
    ///   不影响 seek/滚动（那两个的进度由外部给，本就与全局时钟无关）。
    pub time_scale: f32,
    /// ★★**暂停**（A3）：`true` ⇒ 时间不推进（`dt` 视作 0——**但仍写值**：
    ///   层被重建时不丢当前姿态，与 Progress 驱动的"保持写入"同款理由）。
    pub paused: bool,
}

impl AnimEngine {
    pub fn new() -> Self {
        Self { anims: Vec::new(), flip_snap: None, time_scale: 1.0, paused: false }
    }

    pub fn len(&self) -> usize {
        self.anims.len()
    }

    pub fn is_empty(&self) -> bool {
        self.anims.is_empty()
    }

    /// 测试/诊断用：窥视某 `(node,kind)` 的当前值与速度
    pub fn peek_state(&self, node_id: u32, kind: AnimKind) -> Option<(f32, f32)> {
        self.anims
            .iter()
            .find(|(a, _)| a.node_id == node_id && a.kind == kind)
            .map(|(a, _)| (a.x, a.vel))
    }

    /// 启动动画
    ///
    /// **接管语义（默认 `takeover=true`）**：遇同 `(node,kind)` 已有动画 ⇒ 新动画从
    ///   **当前位置**与**当前速度**接管 —— 位置无跳变、弹簧带速度（这就是"打断接管"）。
    ///   传 `takeover=false` 则硬重启（从 `from` 起，速度归零）。
    ///
    /// 节点不存在 / 曲线越界 ⇒ **Err**（**不静默**：静默会让"动画不生效"极难排查）。
    pub fn start(&mut self, tree: &LayoutTree, mut a: Anim) -> Result<(), String> {
        if matches!(a.mode, AnimMode::Curve) && a.curve > CURVE_MAX {
            return Err(format!("未知曲线 id={}（0..={CURVE_MAX}）", a.curve));
        }
        // ★序列校验：集合非空 + 每段时长 ≥ 0 + 每段曲线 id 合法（错误必须冒泡，不静默）
        if let AnimMode::Keyframes(segs) = &a.mode {
            if segs.is_empty() {
                return Err("KEYFRAMES 序列为空（至少一段；表达单段请用 curve/spring）".to_string());
            }
            for (i, s) in segs.iter().enumerate() {
                if s.dur_ms < 0.0 {
                    return Err(format!("KEYFRAMES 第 {i} 段时长非法：{}（须 ≥ 0）", s.dur_ms));
                }
                if s.curve > CURVE_MAX {
                    return Err(format!("KEYFRAMES 第 {i} 段曲线 id={} 未知（0..={CURVE_MAX}）", s.curve));
                }
            }
        }
        let idx = tree
            .nodes
            .iter()
            .position(|n| n.id == a.node_id)
            .ok_or_else(|| format!("ANIM_START 的目标节点 {} 不在树上", a.node_id))?;
        // ★★颜色动画**要求节点有底色**（2026-10-01）：底色既是"从哪开始"的基准，
        //   也是复位目标（见 `LStyle.bg_base`）。没有它 ⇒ 无法安全清场（stop 后无处可回）。
        //   ⇒ **明确拒绝**（不静默：静默会变成"动画不生效"这类难查现象）。
        if a.kind.is_color() {
            let (ok_base, what, fix) = if a.kind.is_text_color() {
                (
                    tree.nodes[idx].style.text_color_base.is_some(),
                    "没有文字色（树里未声明 `color`）",
                    "请先给该节点的 style 设 `color`",
                )
            } else {
                (
                    tree.nodes[idx].style.bg_base.is_some(),
                    "没有底色（树里未声明 `backgroundColor`）",
                    "请先给该节点设 backgroundColor",
                )
            };
            if !ok_base {
                return Err(format!(
                    "颜色动画的目标节点 {} {what}——颜色动画需要基色作为起点与复位目标；{fix}，或去掉这条颜色动画",
                    a.node_id
                ));
            }
        }
        // ★★裁剪动画**要求节点有静态裁剪形状**（2026-10-01 · C1）：形状类型与基态参数既是
        //   "从哪开始"的基准，也是复位目标（与颜色的基色同一条纪律）。
        //   ⇒ 没有 `clipPath` 声明的节点上启动裁剪动画 = **明确拒绝**（不静默）。
        // ★★SVG 描边进度**要求节点声明了 svgPath**（2026-10-01 · C2）：路径本体是"画什么"的
        //   静态前提（与 clip 需要形状、color 需要底色同一条纪律）⇒ 明确拒绝。
        if a.kind.is_stroke() && tree.nodes[idx].style.svg_path.is_none() {
            return Err(format!(
                "描边动画的目标节点 {} 没有 SVG 路径（树里未声明 `svgPath`）——描边进度需要路径本体\
                 才能换算『画到哪』；请先给该节点声明 `svgPath: {{ d: 'M…' }}`，或去掉这条描边动画",
                a.node_id
            ));
        }
        // ★★渐变混合**要求节点声明了 `fillGradient` + `fillGradientTo` 两态**（v2）：
        //   单态渐变没有"混合"可言（缺 B ⇒ 明确拒绝，不静默当 0/1）——与 clip 需要形状同一条纪律。
        // ★★遮罩进度**要求节点声明了 `mask`**（v1）：没有遮罩可言时驱动它 = 静默无效。
        if a.kind.is_mask_progress() && tree.nodes[idx].style.mask.is_none() {
            return Err(format!(
                "遮罩动画的目标节点 {} 没有遮罩声明（树里未声明 `mask`）——遮罩进度需要一个静态\
                 遮罩规格（类型/几何/柔度）作为基准；请先给该节点声明\
                 `mask: {{ kind, angle|cx/cy/r, softness }}`，或去掉这条遮罩动画",
                a.node_id
            ));
        }
        // ★★发光强度**要求节点声明了 `glow`**（v1）：没有发光可言时驱动它 = 静默无效。
        if a.kind.is_glow_intensity() && tree.nodes[idx].style.glow.is_none() {
            return Err(format!(
                "发光动画的目标节点 {} 没有发光声明（树里未声明 `glow`）——发光强度需要一个静态\
                 发光规格（色/半径/强度）作为基准；请先给该节点声明 `glow: {{ color, radius, alpha }}`，\
                 或去掉这条发光动画",
                a.node_id
            ));
        }
        // ★★路径变形**要求节点声明了 svgPath + svgPathTo 两态**（v1）：单态没有"变形"可言。
        if a.kind.is_path_morph() {
            let (has_a, has_b) = {
                let st = &tree.nodes[idx].style;
                (st.svg_path.is_some(), st.svg_path_to.is_some())
            };
            let reason = match (has_a, has_b) {
                (false, _) => Some((
                    "没有 SVG 路径（树里未声明 `svgPath`）",
                    "请先给该节点声明 `svgPath`（A 态）与 `svgPathTo`（B 态）",
                )),
                (true, false) => Some((
                    "只有 A 态（树里未声明 `svgPathTo`）",
                    "变形需要两态：再声明 `svgPathTo`（与 A **同命令序列**——同段数、同段型）",
                )),
                _ => None,
            };
            if let Some((what, fix)) = reason {
                return Err(format!(
                    "路径变形动画的目标节点 {} {what}——变形需要一个可插值的两态；{fix}，或去掉这条变形动画",
                    a.node_id
                ));
            }
        }
        if a.kind.is_gradient_mix() {
            let g = tree.nodes[idx].style.grad.as_ref();
            let reason = match g {
                None => Some((
                    "没有渐变（树里未声明 `fillGradient`）",
                    "请先给该节点声明 `fillGradient`（A 态）与 `fillGradientTo`（B 态）",
                )),
                Some(gs) if !gs.has_b => Some((
                    "只有 A 态（树里未声明 `fillGradientTo`）",
                    "混合需要两态：再声明 `fillGradientTo`（与 A 的 kind 与色标个数一致）",
                )),
                _ => None,
            };
            if let Some((what, fix)) = reason {
                return Err(format!(
                    "渐变混合动画的目标节点 {} {what}——混合需要一个可过渡的两态；{fix}，或去掉这条渐变动画",
                    a.node_id
                ));
            }
        }
        if a.kind.is_clip() && tree.nodes[idx].style.clip_kind == 0 {
            return Err(format!(
                "裁剪动画的目标节点 {} 没有裁剪形状（树里未声明 `clipPath`）——裁剪动画需要静态形状作为起点与复位目标；                 请先给该节点声明 `clipPath`（inset/circle/polygon），或去掉这条裁剪动画",
                a.node_id
            ));
        }
        if let Some(slot) = self
            .anims
            .iter_mut()
            .find(|(x, _)| x.node_id == a.node_id && x.kind == a.kind)
        {
            if a.takeover {
                // ★接管：位置连续 + 速度移交（"丝滑"的来源）
                //   ★序列动画**不重映射** —— 它的锚点是 from/to（编排好的两端），
                //   重映射会让"下压→回弹"变成"从半途压回去→弹到旧目标"（静默错形）。
                let prev = &slot.0;
                if !matches!(a.mode, AnimMode::Keyframes(_)) {
                    a.from = prev.x;
                }
                a.x = prev.x;
                a.vel = prev.vel;
            } else {
                a.x = a.from;
                a.vel = 0.0;
            }
            slot.0 = a; // ★字段赋值而非 `*slot = (a, idx)`：Anim 含 Vec（Keyframes）⇒ 非 Copy（move 语义）
        } else {
            a.x = a.from;
            a.vel = 0.0;
            self.anims.push((a, idx));
        }
        Ok(())
    }

    /// 停止动画：`kind=None` 表示该节点全部属性
    pub fn stop(&mut self, node_id: u32, kind: Option<AnimKind>) {
        self.anims
            .retain(|(a, _)| !(a.node_id == node_id && kind.map_or(true, |k| k == a.kind)));
    }

    /// 停全部动画 **并复位整棵树的视觉字段**（相位间清场；见 `reset_visuals`）
    ///
    /// ★★**为什么扫整棵树而不是只扫动画列表（真机实测的漏网）**：跑完的动画**已从列表移出**，
    ///   其最后的样式值留在内核里 ⇒ 若只按列表复位，**残留姿态会污染后续相位**
    ///   （真机实测：`gesture_tx=697` 而目标 80 —— 差 617 = 视口中心 (195+422)，
    ///    正是上一相位 rotate 90° 残留造成的复合矩阵偏移；且该动画**已完成、不在列表里**）。
    ///   ⇒ 清场的语义是"把视觉状态恢复到初始"，与"当前有没有动画在跑"无关。
    ///
    /// - Returns: 被复位的节点数
    pub fn stop_all(&mut self, tree: &mut LayoutTree) -> usize {
        self.anims.clear();
        let mut n = 0;
        for node in tree.nodes.iter_mut() {
            let s = &mut node.style;
            let color_dirty = s.bg != s.bg_base || s.text_color != s.text_color_base;
            let clip_dirty = s.clip_kind != 0 && s.clip != s.clip_base;
            // ★C2 基态：偏离**声明基态**才算脏（2026-10-01——静态声明 `progress:1` 的路径
            //   不参与复位；此前硬编码 0 ⇒ 复位会把"生来已画成"的静态描边**抹掉**）
            let stroke_base = if s.svg_path.is_some() { s.stroke_progress_base } else { 0.0 };
            let stroke_dirty = s.svg_path.is_some() && s.stroke_progress != stroke_base;
            let grad_dirty = s.grad.as_ref().is_some_and(|g| g.mix != 0.0);
            let morph_dirty = s.svg_path_to.is_some() && s.path_morph != 0.0;
            let glow_dirty = s.glow.is_some() && s.glow_intensity != 1.0;
            let mask_dirty = s
                .mask
                .as_ref()
                .is_some_and(|m| s.mask_progress != m.progress_base);
            if s.translate_x != 0.0
                || s.translate_y != 0.0
                || s.scale != 1.0
                || s.rotate != 0.0
                || s.rotate_x != 0.0   // ★B 批 3D：与 rotate 同一义务（见 reset_visuals 注释）
                || s.rotate_y != 0.0
                || s.skew_x != 0.0     // ★skew v1：同义务
                || s.skew_y != 0.0
                || s.opacity != 1.0
                || color_dirty
                || clip_dirty
                || stroke_dirty
                || grad_dirty
                || morph_dirty
                || glow_dirty
                || mask_dirty
            {
                s.translate_x = 0.0;
                s.translate_y = 0.0;
                s.scale = 1.0;
                s.rotate = 0.0;
                s.rotate_x = 0.0;
                s.rotate_y = 0.0;
                s.skew_x = 0.0;        // ★skew v1
                s.skew_y = 0.0;
                s.clip = s.clip_base; // ★C1：裁剪参数回基态
                s.stroke_progress = stroke_base; // ★C2：回**声明基态**（见上——静态已画成不被抹掉）
                if let Some(g) = s.grad.as_mut() {
                    g.mix = 0.0; // ★渐变 v2：混合因子回 0（全 A）
                }
                s.path_morph = 0.0; // ★路径变形 v1：变形因子回 0（全 A）
                s.glow_intensity = 1.0; // ★发光 v1：强度回 1（全额）
                if let Some(m) = s.mask.as_ref() {
                    s.mask_progress = m.progress_base; // ★遮罩 v1：回声明基态
                }
                s.opacity = 1.0;
                s.bg = s.bg_base; // ★颜色回底色 / 回原文字色（见 reset_visuals 注释）
                s.text_color = s.text_color_base;
                n += 1;
            }
        }
        n
    }

    /// ★★**只移交、不清值**：把一批节点的动画从引擎中**摘出**（不移除样式值）
    ///
    /// 【用途（MA0-RT 的交接语义）】走"提交一次 + 平台自主插值"路径时，动画责任**转移给平台**：
    ///   引擎这边必须把对应动画摘掉（否则 tick 会继续写 model 值，与平台的 presentation 动画打架）。
    ///   ★与 `stop_nodes` 的区别：**不清视觉值**——因为提交规格是基于"当前静态基线"采样的
    ///   （清值会把未参与动画的属性也复位，见 `commit_specs` 的 base 读取）。
    ///
    /// - Returns: 摘出的动画数
    pub fn detach_nodes(&mut self, node_ids: &[u32]) -> usize {
        let before = self.anims.len();
        self.anims.retain(|(a, _)| !node_ids.contains(&a.node_id));
        before - self.anims.len()
    }

    /// ★★**批量按节点停动画**（RT2/§7.3 节点复用解绑）
    ///
    /// 【为什么必须有（Morpheus 方案 §7 的架构不变量）】本仓列表复用率 0.997 ⇒ 节点（及其层）
    ///   会被回收给**不同的数据项**用。若动画仍绑在旧 node id 上：
    ///   ① 该节点重新物化时会显示"半路的变换"（错误位置）；
    ///   ② 动画永不结束 ⇒ 每帧白算（CPU 浪费）+ 复用后错位。
    ///   ⇒ **节点回收时必须一并解绑**（本方法即该义务的实现面）；
    ///     宿主在 `dematerializeRow` 里对整行的 ids 调用。
    ///
    /// - Returns: 实际移除的动画数（供宿主/判据对账"真的解绑了"）
    pub fn stop_nodes(&mut self, tree: &mut LayoutTree, node_ids: &[u32]) -> usize {
        let before = self.anims.len();
        self.anims.retain(|(a, _)| !node_ids.contains(&a.node_id));
        // ★同时**清值**（见 `reset_visuals` 注释：只停动画会让残留姿态污染后续一切）
        reset_visuals(tree, node_ids);
        before - self.anims.len()
    }

    /// 推进 `dt_ms`：求值（曲线/弹簧）→ 写入节点样式字段 → 移除结束项。
    ///
    /// ★**不触发重排**：translate/scale/rotate/opacity 是**绘制层变换**（不影响布局几何）——
    ///   这正是"指令驱动动画"相对"每帧 SET_STYLE 一批几何键"的关键成本优势之一。
    pub fn tick(&mut self, tree: &mut LayoutTree, dt_ms: f32) -> TickOutcome {
        let mut out = TickOutcome::default();
        let mut touched: std::collections::HashSet<u32> = std::collections::HashSet::new();
        let mut keep: Vec<(Anim, usize)> = Vec::with_capacity(self.anims.len());
        // ★A3：全局时间因子与暂停在**唯一的时间入口**生效（step 本身保持"纯 dt"——
        //   与 seek/滚动解耦：它们的进度不走时间）
        let eff_dt = if self.paused { 0.0 } else { dt_ms * self.time_scale.max(0.0) };
        for (mut a, idx) in self.anims.drain(..) {
            let (new_x, new_vel, finished) = step(&mut a, eff_dt);
            a.x = new_x;
            a.vel = new_vel;
            // 索引越界（树被压实过）⇒ 丢弃并计数（不 panic；生产应挂失效回调，见文件头边界①）
            if idx >= tree.nodes.len() {
                out.finished += 1;
                continue;
            }
            if a.kind.write(&mut tree.nodes[idx], new_x) {
                out.changed += 1;
                touched.insert(a.node_id);
            }
            if finished {
                out.finished += 1;
            } else {
                keep.push((a, idx));
            }
        }
        self.anims = keep;
        out.active_after = self.anims.len();
        out.updates = Self::collect_updates(tree, &touched);
        out
    }

    /// ★★RT2：**设置进度**（方案 §4.2 的 `ANIM_SEEK`）——手势/滚动/路由驱动的进度定位
    ///
    /// 语义：把 `(node, kind)` 的动画切到 `Progress` 驱动并设置进度 `p`（clamp 到 0..1），
    /// 立即求值并写字段（**不必等下一帧**——手势跟随要求"手指到哪画面到哪"）。
    pub fn seek(&mut self, tree: &mut LayoutTree, node_id: u32, kind: AnimKind, p: f32) -> TickOutcome {
        self.seek_velocity(tree, node_id, kind, p, None)
    }

    /// `seek` 的带速度变体：`dt_s` 提供时按 `Δx/Δt` 估计速度（供松手后弹簧接管接力）
    pub fn seek_velocity(
        &mut self,
        tree: &mut LayoutTree,
        node_id: u32,
        kind: AnimKind,
        p: f32,
        dt_s: Option<f32>,
    ) -> TickOutcome {
        let mut out = TickOutcome::default();
        let mut touched: std::collections::HashSet<u32> = std::collections::HashSet::new();
        let p = p.clamp(0.0, 1.0);
        for (a, idx) in self.anims.iter_mut() {
            if a.node_id != node_id || a.kind != kind {
                continue;
            }
            a.drive = AnimDrive::Progress;
            a.progress = p;
            if *idx >= tree.nodes.len() {
                continue; // 越界：跳过（与 tick 同策略——不 panic）
            }
            let v = a.value_at_progress(p); // ★统一求值入口（Curve / Keyframes 同一套语义）
            if let Some(dt) = dt_s {
                if dt > 0.0 {
                    a.vel = (v - a.x) / dt; // 单位/秒（供接管）
                }
            }
            a.x = v;
            if a.kind.write(&mut tree.nodes[*idx], v) {
                out.changed += 1;
                touched.insert(a.node_id);
            }
        }
        out.active_after = self.anims.len();
        out.updates = Self::collect_updates(tree, &touched);
        out
    }

    /* ──────────────────── ★★MA5：滚动联动（滚动位置 → 进度，换算在内核） ──────────────────── */

    /// ★★**按滚动位置推进**（视差 / 吸顶 / 渐显的统一驱动）——把所有带**滚动窗口**的动画
    /// 按当前滚动位置求值并写字段。
    ///
    /// 【为什么是"按位置"而不是"按节点"（与 `seek` 的关键差别）】滚动的输入是**一个标量**
    ///   （内容偏移），而受它影响的动画可能分布在多个节点上（视差层、吸顶头、渐显项）。
    ///   ⇒ 一次调用驱动**所有窗口动画**：宿主一次滚动回调 = 一次内核算值 = N 节点写值，
    ///   宿主与 JS **都不参与**任何逐节点循环。
    ///
    /// 【换算规则（唯一实现在此，宿主零数学）】
    ///   `p = ((scroll - from) / (to - from)).clamp(0,1)`；`to <= from` ⇒ 进度恒 1
    ///   （退化窗口 = "已滑过"，不是除以零）。
    ///   求值仍走 `curve_eval`（曲线知识也只在引擎一处）；写值走 `AnimKind::write`。
    ///
    /// 【与 takeover 的关系】滚动驱动**不参与接管**（位置由输入唯一决定，没有"速度移交"可言）——
    ///   但 `start` 阶段的接管语义仍适用（同一节点上从时间动画切换过来时位置连续）。
    ///
    /// - Returns: `TickOutcome`（`updates` 供宿主当帧写层；`changed` 为真正变值的字段数）
    pub fn seek_scroll(&mut self, tree: &mut LayoutTree, scroll: f32) -> TickOutcome {
        let mut out = TickOutcome::default();
        let mut touched: std::collections::HashSet<u32> = std::collections::HashSet::new();
        for (a, idx) in self.anims.iter_mut() {
            // 只驱动**滚动窗口**动画（`Time`/`Progress` 动画不受滚动影响）
            if a.scroll_to <= a.scroll_from {
                continue;
            }
            let p = if a.scroll_to > a.scroll_from {
                ((scroll - a.scroll_from) / (a.scroll_to - a.scroll_from)).clamp(0.0, 1.0)
            } else {
                1.0
            };
            a.progress = p;
            if *idx >= tree.nodes.len() {
                continue; // 越界：跳过（与 tick/seek 同策略——不 panic）
            }
            let v = a.value_at_progress(p); // ★统一求值入口
            a.x = v;
            if a.kind.write(&mut tree.nodes[*idx], v) {
                out.changed += 1;
                touched.insert(a.node_id);
            }
        }
        out.active_after = self.anims.len();
        out.updates = Self::collect_updates(tree, &touched);
        out
    }

    /// 带窗口的声明式启动（MA5 的装配入口）：`scroll_from`/`scroll_to` 非退化时该动画
    /// **恒以滚动驱动**（`drive`/`delay` 被忽略，见 `Anim::scroll_from` 注释）。
    ///
    /// ★**不接管**（`takeover=false`）：进度由滚动位置唯一决定，`from`/`to` 是**窗口映射的两端**
    ///   ——若走接管语义，`from` 会被上一条动画的当前值覆盖 ⇒ 窗口映射静默偏移
    ///   （现象：滚动联动"整体偏了一截"，且只在上一条动画中途切换时出现——典型静默缺陷）。
    ///   回归测试 `start_scroll_does_not_inherit_previous_value_into_range` 守住。
    pub fn start_scroll(&mut self, tree: &LayoutTree, mut a: Anim) -> Result<(), String> {
        a.drive = AnimDrive::Progress;
        a.t_ms = 0.0;
        a.takeover = false;
        self.start(tree, a)
    }

    /* ──────────────────── ★★共享元素（跨元素飞行：几何原语） ──────────────────── */

    /// ★★**共享元素：从源矩形飞到目标节点**（跨元素/跨页面过渡的几何原语）
    ///
    /// 【为什么几何必须在内核算（本仓纪律 #22 的又一次应用）】"从缩略图位置放大到详情页大图"
    ///   看着是三行算术（中心差 + 宽度比），但它是**跨页面过渡的全部视觉语义**：
    ///   - 三个数一旦有一个不对，元素就"跳一下"或"尺寸不对"，且只在真机上肉眼可见；
    ///   - 若让平台/Host 各写一份，三端过渡就各有一个手感（与滚动联动同源教训）。
    ///   ⇒ 内核吃**源矩形 + 目标节点**，吐 `dx/dy/scale`；宿主只把数字喂给层（零几何数学）。
    ///
    /// 【两条动效 + 硬重启语义】translateX/Y + scale 从 `(dx,dy,scale)` 归位到 `(0,0,1)`；
    ///   **`takeover=false`**：起点是**算出来的几何**，不是"上一条动画的当前值"——
    ///   若走接管，起点会被覆盖 ⇒ 视觉上不落在源矩形（静默错位，与滚动联动同一条红线）。
    ///   `fade_in=true` 时附一条 opacity `0→1`（跨图/跨文内容时减弱"旧内容飞过去"的突兀感）。
    ///
    /// 【首帧不跳变】启动后**立即 `tick(0)` 写起点**并随 `updates` 返回 —— 宿主当帧上屏，
    ///   首帧就在源矩形处（与 FLIP 的 `updates` 同一条教训）。
    ///
    /// 【等比缩放边界（如实）】内核只有**等比** scale ⇒ 以**宽度比**为准；
    ///   源/目标宽高比不一致时，高度按目标宽高比等比推出（需要精确宽高比时业务侧应保持一致）。
    pub fn start_shared_element(
        &mut self,
        tree: &mut LayoutTree,
        target_id: u32,
        source: Rect,
        dur_ms: f32,
        curve: u8,
        fade_in: bool,
    ) -> Result<(SharedElementPlan, TickOutcome), String> {
        if curve > CURVE_MAX {
            return Err(format!("未知曲线 id={curve}（0..={CURVE_MAX}）"));
        }
        let target = node_abs_rect(tree, target_id)
            .ok_or_else(|| format!("SHARED_ELEMENT 的目标节点 {target_id} 无绝对几何（不在树上或 display:none）"))?;
        let plan = shared_element_plan(source, target)?;
        let dur = dur_ms.max(1.0);
        let mk = |kind: AnimKind, from: f32, to: f32| Anim {
            node_id: target_id,
            kind,
            curve,
            from,
            to,
            dur_ms: dur,
            delay_ms: 0.0,
            t_ms: 0.0,
            drive: AnimDrive::Time,
            progress: 0.0,
            scroll_from: 0.0,
            scroll_to: 0.0,
            mode: AnimMode::Curve,
            x: from,
            vel: 0.0,
            takeover: false, // ★硬重启：起点 = 算出的几何（见注释）
            curve_pts: None,
            iterations: 1.0,
            alternate: false,
        };
        self.start(tree, mk(AnimKind::TranslateX, plan.dx, 0.0))?;
        self.start(tree, mk(AnimKind::TranslateY, plan.dy, 0.0))?;
        self.start(tree, mk(AnimKind::Scale, plan.scale, 1.0))?;
        if fade_in {
            self.start(tree, mk(AnimKind::Opacity, 0.0, 1.0))?;
        }
        // ★首帧立即写（tick(0)：曲线在 u=0 处值 = from）——宿主据此把起点当帧上屏
        let out = self.tick(tree, 0.0);
        Ok((plan, out))
    }

    /// **记快照**：把当前所有节点的**绝对**矩形存进引擎（供布局变更后对比）
    ///
    /// 【为什么这是"招牌"（Morpheus §5）】传统 FLIP 要前后各读一次几何（跨边界查询）；
    ///   而本仓几何**本来就在内核** ⇒ 两次快照都是内部读，零跨边界、零 JS。
    /// - Returns: 快照节点数
    pub fn flip_capture(&mut self, tree: &LayoutTree) -> usize {
        let mut v: Vec<(u32, Rect)> = Vec::new();
        for &root in &tree.roots {
            crate::rects_bin::collect_abs_pairs(tree, root, 0.0, 0.0, &mut v);
        }
        let n = v.len();
        self.flip_snap = Some(v);
        n
    }

    /// **启动 FLIP**：对比快照与当前几何 ⇒ 为每个位移节点生成 `translate: Δ → 0` 的补间
    ///
    /// 对每个"两边都在"且位移 > 0.5px 的节点：
    ///   ① 立即把 `translate` 写成 `old - new`（视觉上**仍在旧位置**，无跳变）；
    ///   ② 启动两条 translate 动画（X/Y）归零 ⇒ "从旧位置滑到新位置"。
    ///
    /// `stagger_ms`：按**新位置自上而下**排序后逐项递增延迟（列表让位的级联感）。
    ///
    /// 未先 `flip_capture` ⇒ Err（**不静默**）。
    pub fn flip_start(
        &mut self,
        tree: &mut LayoutTree,
        dur_ms: f32,
        curve: u8,
        stagger_ms: f32,
    ) -> Result<FlipOutcome, String> {
        let Some(snap) = self.flip_snap.take() else {
            return Err("FLIP 未先 capture（先调 flip_capture 记快照）".into());
        };
        let mut now: Vec<(u32, Rect)> = Vec::new();
        for &root in &tree.roots {
            crate::rects_bin::collect_abs_pairs(tree, root, 0.0, 0.0, &mut now);
        }
        let now_map: std::collections::HashMap<u32, Rect> =
            now.iter().map(|(id, r)| (*id, *r)).collect();

        // 收集位移（排序键 = 新 y，用于 stagger 的"自上而下"级联）
        let mut moved: Vec<(u32, f32, f32, f32)> = Vec::new(); // id, dx, dy, new_y
        let mut max_delta = 0f32;
        for (id, old) in snap.iter() {
            let Some(new) = now_map.get(id) else { continue };
            let dx = old.x - new.x;
            let dy = old.y - new.y;
            if dx.abs() > 0.5 || dy.abs() > 0.5 {
                max_delta = max_delta.max(dx.abs().max(dy.abs()));
                moved.push((*id, dx, dy, new.y));
            }
        }
        moved.sort_by(|a, b| a.3.partial_cmp(&b.3).unwrap_or(std::cmp::Ordering::Equal));

        let mut out = FlipOutcome::default();
        let mut touched: std::collections::HashSet<u32> = std::collections::HashSet::new();
        for (i, (id, dx, dy, _)) in moved.iter().enumerate() {
            let Some(idx) = tree.nodes.iter().position(|n| n.id == *id) else { continue };
            // ① 立即写在旧位置（视觉无跳变）——直接改样式，不经过动画
            tree.nodes[idx].style.translate_x = *dx;
            tree.nodes[idx].style.translate_y = *dy;
            // ★`stagger_ms = 0` ⇒ **无级联**（所有节点同时开始）；非零才按新 y 序逐项递增。
            //   （首版无条件乘 i ⇒ 215 节点会排出 214×stagger 的尾巴：即使 stagger=0 也会
            //    因浮点累加产生微小延迟；真机 F3d 的 -0.43px 残留就是这么来的——最后一帧
            //    仍有节点没走完。★这是"看起来没问题但数值不干净"的典型。）
            let delay = if stagger_ms > 0.0 { i as f32 * stagger_ms } else { 0.0 };
            // ② 两条归零补间（takeover=false：上面已把 translate 设为 Δ，必须**从这里**开始）
            for (kind, delta) in [(AnimKind::TranslateX, *dx), (AnimKind::TranslateY, *dy)] {
                if delta.abs() <= 0.5 {
                    continue;
                }
                let mut a = Anim::curve_anim(*id, kind, delta, 0.0, dur_ms);
                a.curve = curve;
                a.delay_ms = delay;
                a.takeover = false;
                self.start(tree, a)?;
            }
            touched.insert(*id);
            out.animated += 1;
        }
        out.max_delta_px = max_delta;
        // ★起点必须**立即上报**（否则宿主层停在几何新位置 ⇒ 首帧跳变；见 FlipOutcome.updates 注释）
        out.updates = Self::collect_updates(tree, &touched);
        Ok(out)
    }

    /// 把"本轮受影响的节点"转成 `updates`（nodeId + 五个视觉值）
    ///
    /// ★★**不用 `self.anims` 反查（本仓实测的真缺陷）**：动画**结束时会从 `anims` 移出**，
    ///   若按"活动动画列表"反查 ⇒ **结束那一帧的终值上报不到宿主**
    ///   ⇒ 动画会**停在倒数第二帧的位置**（几何/日志全对，只有肉眼能发现最后一步没走完）。
    ///   首版就是这么写的，被 `time_driven_anim_still_finishes_and_reports_final_value` 当场抓住。
    ///   ⇒ 正解：直接按 **node_id** 在树上取值（touched 里存的是 node_id，不是索引）。
    pub(crate) fn collect_updates(
        tree: &LayoutTree,
        touched: &std::collections::HashSet<u32>,
    ) -> Vec<NodeVisual> {
        let mut out = Vec::with_capacity(touched.len());
        for node_id in touched {
            let Some(node) = tree.nodes.iter().find(|n| n.id == *node_id) else {
                continue; // 节点已不在树上（压实/删除）⇒ 跳过（不 panic）
            };
            out.push(NodeVisual {
                id: node.id,
                tx: node.style.translate_x,
                ty: node.style.translate_y,
                scale: node.style.scale,
                rotate: node.style.rotate,
                rotate_x: node.style.rotate_x,
                rotate_y: node.style.rotate_y,
                skew_x: node.style.skew_x,
                skew_y: node.style.skew_y,
                opacity: node.style.opacity,
                // ★颜色：`bg` 优先（动画写过），否则回底色（未被动过的节点也报得出真值）
                bg: node.style.bg.or(node.style.bg_base),
                text_color: node.style.text_color.or(node.style.text_color_base),
                color_valid: node.style.bg.is_some() || node.style.bg_base.is_some(),
                text_color_valid: node.style.text_color.is_some() || node.style.text_color_base.is_some(),
                // ★C1：有裁剪声明 ⇒ 带上当前形状（每帧权威值；宿主据此重建裁剪路径）
                clip: if node.style.clip_kind != 0 {
                    Some((node.style.clip_kind, node.style.clip))
                } else {
                    None
                },
                stroke_progress: if node.style.svg_path.is_some() {
                    Some(node.style.stroke_progress)
                } else {
                    None
                },
                // ★渐变 v2：带上**混合后**的色标（唯一 lerp 实现是 `GradState::mixed`——
                //   宿主与探针都消费它的结果；本字段是"已算好"，不是"待插值"）
                grad: node.style.grad.as_ref().map(|g| {
                    let (colors, offsets) = g.mixed();
                    let (angle, cx, cy, r) = g.mixed_geometry();
                    (g.kind, g.n, colors, offsets, [angle, cx, cy, r])
                }),
                // ★路径变形 v1：带上当前变形因子（`None` = 本节点无 B 态；宿主据此决定
                //   是否向内核要"变形后的段列表"——**段本身按需查询**，不进定长记录）。
                path_morph: if node.style.svg_path_to.is_some() {
                    Some(node.style.path_morph)
                } else {
                    None
                },
                // ★发光 v1：带上当前强度（`None` = 本节点无发光声明——宿主保持静态）
                glow_intensity: if node.style.glow.is_some() {
                    Some(node.style.glow_intensity)
                } else {
                    None
                },
                // ★遮罩 v1：带上**已算好**的揭示色标（`None` = 无遮罩；唯一实现在内核）
                mask: node.style.mask.as_ref().map(|m| {
                    let (offs, alphas) = m.reveal_stops(node.style.mask_progress);
                    (m.kind, offs, alphas)
                }),
            });
        }
        out
    }
}

/// 单步求值（曲线 / 关键帧序列 / 弹簧）——返回 `(新值, 新速度, 是否结束)`
fn step(a: &mut Anim, dt_ms: f32) -> (f32, f32, bool) {
    // ── Progress 驱动：值由 seek 维护；tick 只"保持写入"（层被重建时不丢值） ──
    if a.drive == AnimDrive::Progress {
        let x = a.value_at_progress(a.progress);
        return (x, a.vel, false); // Progress 永不自动结束（由 stop 显式结束）
    }

    a.t_ms += dt_ms;
    // ── 延迟期：钉在起点（编排/交错） ──
    if a.t_ms < a.delay_ms {
        return (a.x, a.vel, false);
    }

    match &a.mode {
        AnimMode::Spring(params) => {
            let p = params.sanitized();
            let (mut x, mut v) = (a.x, a.vel);
            let mut remaining = dt_ms / 1000.0;
            // 子步积分：大 dt（掉帧/首帧）下保持稳定（ω·h ≪ 2）
            while remaining > 0.0 {
                let h = remaining.min(MAX_SUBSTEP_S);
                let acc = (-p.stiffness * (x - a.to) - p.damping * v) / p.mass;
                v += acc * h;
                x += v * h;
                remaining -= h;
            }
            let (eps_pos, eps_vel) = a.kind.settle_eps();
            let settled = (x - a.to).abs() <= eps_pos && v.abs() <= eps_vel;
            if settled {
                (a.to, 0.0, true) // ★端点钉死（静止在阈值内 ⇒ 精确落到 to）
            } else if a.t_ms >= SPRING_MAX_MS {
                (a.to, 0.0, true) // ★安全上限（非法参数兜底；到点钉在 to）
            } else {
                (x, v, false)
            }
        }
        // Curve / Keyframes 统一：时间 → 进度 → 求值（同一入口 ⇒ 不会"seek 对、滚动错"）
        _ => {
            // ★A2 循环：相位映射（含 yoyo 反向）——一遍的旧语义是 loop_phase 在 iterations=1 的特例
            let (u, finished) = loop_phase(a.t_ms, a.delay_ms, a.dur_ms, a.iterations, a.alternate);
            if finished {
                // ★端点钉死（**按末轮方向**——yoyo 偶数轮停在 from，见 loop_phase 注释）；
                //   序列的端点由 value_at_round_progress（u=0/1）给出（末段 to / 首段 from）
                let x = a.value_at_round_progress(u);
                return (x, 0.0, true);
            }
            // ★轮内求值（u 已含 yoyo 方向）——不能走 value_at_progress（那会再映射一次 ⇒ 双重映射）
            let x = a.value_at_round_progress(u);
            let dt_s = dt_ms / 1000.0;
            let vel = if dt_s > 0.0 { (x - a.x) / dt_s } else { a.vel };
            (x, vel, false)
        }
    }
}

/* ──────────────────── ★★★S3-T1：编译期交互下沉 · 跟手（指针位移 → 节点平移） ──────────────────── */

/// ★★★**S3-T1（2026-10-10 · 输入延迟专项 #767）**：**跟手**——指针位移 → 节点平移。
///
/// 【要证明什么（§14 §4 S3 Tier 2）】"拖拽跟手"这类高频交互**不过 JS**：宿主 MOVE ⇒ 直接喂指针给内核
///   ⇒ 内核算平移（**换算唯一实现在此**，宿主零数学，与 `seek_scroll` 同一纪律）⇒ 宿主帧回调采样绘制。
///   ⇒ `js_involved_gestures_ratio == 0`（手指数不变、延迟 ≤1 帧）。
///
/// 【语义】`translate_x = clamp(dx * gain, min, max)`（`axis_mask` 选轴：位0=x / 位1=y）。
///   `dx/dy` = 相对**拖拽起点**的指针位移（宿主算，纯减法）；`min/max` = 夹取区间（swap-to-delete 等）。
///   ★[S3-T2] 的夹取/回弹在此已具**夹取**；回弹（松手弹簧）由 `seek_velocity` 接管（另批）。
///
/// - Returns: 是否真的改了字段（供宿主判"要不要重绘"）。
pub fn follow_translate(
    tree: &mut LayoutTree,
    node_id: u32,
    dx: f32,
    dy: f32,
    axis_mask: u8,
    gain: f32,
    min: f32,
    max: f32,
) -> bool {
    let Some(idx) = tree.index_of_id(node_id) else { return false };
    let n = &mut tree.nodes[idx as usize];
    let mut changed = false;
    if axis_mask & 1 != 0 {
        let v = (dx * gain).clamp(min, max);
        if n.style.translate_x != v {
            n.style.translate_x = v;
            changed = true;
        }
    }
    if axis_mask & 2 != 0 {
        let v = (dy * gain).clamp(min, max);
        if n.style.translate_y != v {
            n.style.translate_y = v;
            changed = true;
        }
    }
    changed
}

/// ★★★**S3-T2（2026-10-10 · 输入延迟专项 #767）**：**松手处理**——按当前位移决定「回弹归零」
///   或「滑出吸附（swipe-to-delete）」，并以**弹簧**从当前位置接管（松手那帧起，值连续、速度归零）。
///
/// 【要证明什么（§16 §6 S3-T2）】跟手期**零 JS**（同 T1）；松手后由**内核弹簧**接管——宿主只报
///   "手指抬起了"，不参与任何数学（换算/夹取/吸附判定/弹簧积分**全在内核**）。
///
/// 【语义（唯一实现在此）】对每个活动轴：`cur = style.translate_*`；
///   · `cur.abs() >= snap_threshold`（>0 时）⇒ 目标 = `sign(cur) * |snap_target|`（**滑出吸附**——
///     swipe-to-delete 的"过半即滑出"；`snap_target` 是**滑出幅度**，方向随拖拽方向）；
///   · 否则 ⇒ 目标 = `0`（**回弹归零**）。
///   以 `Spring` 从 `cur` → 目标启动（`drive=Time`，由既有帧循环 `animTick` 推进）。
///
/// - Returns: 每轴的目标值（供宿主/判据核"吸附判定真的在内核"）。
pub fn follow_release(
    engine: &mut AnimEngine,
    tree: &LayoutTree,
    node_id: u32,
    axis_mask: u8,
    stiffness: f32,
    damping: f32,
    mass: f32,
    snap_threshold: f32,
    snap_target: f32,
) -> Vec<f32> {
    let Some(idx) = tree.index_of_id(node_id) else { return Vec::new() };
    let params = SpringParams { stiffness, damping, mass }.sanitized();
    let mut targets = Vec::new();
    let mut start = |kind: AnimKind, cur: f32| -> f32 {
        let target = if snap_threshold > 0.0 && cur.abs() >= snap_threshold {
            snap_target.abs() * if cur >= 0.0 { 1.0 } else { -1.0 }
        } else {
            0.0
        };
        let mut a = Anim::curve_anim(node_id, kind, cur, target, 0.0);
        a.mode = AnimMode::Spring(params);
        // start 仅校验 + 入表（树只读）；失败不 panic（节点消失等）——静默丢弃该轴回落
        let _ = engine.start(tree, a);
        target
    };
    if axis_mask & 1 != 0 {
        targets.push(start(AnimKind::TranslateX, tree.nodes[idx as usize].style.translate_x));
    }
    if axis_mask & 2 != 0 {
        targets.push(start(AnimKind::TranslateY, tree.nodes[idx as usize].style.translate_y));
    }
    targets
}

/// ★★★**S3-T3（2026-10-10 · 输入延迟专项 #767）**：**多指跟手的一帧一条目**（与 `proteus_dispatch_pointers`
///   同一"批量指针"精神，但落在**布局内核**的 follow 语义上）。`#[repr(C)]` 布局 = 7×4B 无填充
///   （与 Android JNI/Java 侧逐字段对齐；★顺序纪律：改字段必须两侧同改）。
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FollowEntry {
    /// 目标节点 id
    pub node_id: u32,
    /// 位移增益（1 = 1:1）
    pub gain: f32,
    /// 相对**该指**拖拽起点的位移（物理 px；宿主纯减法，无数学）
    pub dx: f32,
    pub dy: f32,
    /// 夹取区间（[min, max]）
    pub min: f32,
    pub max: f32,
    /// 轴掩码（0..3；以 f32 传递避免结构体填充——内核内转 u8）
    pub axis: f32,
}

/// ★★★**S3-T3**：**批量跟手**——一帧内 M 个指针一次 FFI（`ffi_calls_per_frame ≤ 1`）。
///   逐条目调 `follow_translate`（换算唯一实现仍在此），收集**真的变值的节点**并返回
///   ⇒ 调用方用 `collect_updates` 出**一次**合并 updates（宿主一次 `applyAnimUpdates`）。
///
/// - Returns: 本次真的改了字段的节点 id 集合（供 FFI 构建 updates）。
pub fn follow_translate_batch(
    tree: &mut LayoutTree,
    entries: &[FollowEntry],
) -> std::collections::HashSet<u32> {
    let mut touched = std::collections::HashSet::new();
    for e in entries {
        if follow_translate(tree, e.node_id, e.dx, e.dy, e.axis as u8, e.gain, e.min, e.max) {
            touched.insert(e.node_id);
        }
    }
    touched
}

/* ──────────────────── ★★★Dactyl L2：场跟手（一手势焦点驱动一片节点） ──────────────────── */

/// ★★★**Dactyl L2·场跟手**（`15-dactyl-demo.md` §4.3）：一个手势焦点驱动**一片**尖峰——
///   每根尖峰的**高度(scale)与朝向(rotate)**由**距焦点的距离**求值（近则高、倾角朝指）。
///
/// 【为什么是"场"而不是"整块平移"（本批修正）】§4.3 明写「N 根尖峰的穹顶；每根尖峰朝向与高度**由手指位置决定**
///   （距离越近越高、倾角越朝向手指）」——单个节点整体平移**不符规格**。场语义：**一次指针位置 → 全片求值**。
///
/// 【换算唯一实现在此（宿主零数学）】逐**叶节点**（=尖峰）：`t = clamp(1 − dist/falloff, 0, 1)`；
///   `scale = min_scale + (max_scale − min_scale)·t`（高度）；`rotate = clamp(dx/falloff)·max_rotate`（朝向）。
///   写 `style.scale` / `style.rotate`（**合成属性**，§7.3 合成层——装饰不自成压力源）。
///
/// - Returns: 真的改值的节点 id 集（供 `collect_updates` 出合并 updates）。
/// - `container_id`: **场容器**节点 id——只作用于其**子树内的叶节点**（尖峰），不误伤标题/其它文本。
pub fn follow_field(
    tree: &mut LayoutTree,
    container_id: u32,
    focus_x: f32,
    focus_y: f32,
    falloff: f32,
    min_scale: f32,
    max_scale: f32,
    max_rotate: f32,
) -> std::collections::HashSet<u32> {
    let mut touched = std::collections::HashSet::new();
    if falloff <= 0.0 {
        return touched;
    }
    let Some(cidx) = tree.index_of_id(container_id) else { return touched };
    // 收集容器子树内的**叶节点**索引（尖峰）
    let mut target_idx: Vec<usize> = Vec::new();
    let mut stack: Vec<NodeIndex> = tree.get(cidx).children.clone();
    while let Some(i) = stack.pop() {
        let n = tree.get(i);
        if n.children.is_empty() {
            target_idx.push(i as usize);
        } else {
            stack.extend(n.children.iter().copied());
        }
    }
    let abs = tree.absolute_rects(); // 绝对坐标（一次算好，避免与可变借用冲突）
    for idx in target_idx {
        let Some(r) = abs.get(idx).and_then(|o| *o) else { continue };
        if r.width <= 0.0 || r.height <= 0.0 {
            continue;
        }
        let cx = r.x + r.width * 0.5;
        let cy = r.y + r.height * 0.5;
        let dx = focus_x - cx;
        let dy = focus_y - cy;
        let dist = (dx * dx + dy * dy).sqrt();
        let t = (1.0 - dist / falloff).clamp(0.0, 1.0);
        let scale = min_scale + (max_scale - min_scale) * t;
        let rotate = (dx / falloff).clamp(-1.0, 1.0) * max_rotate;
        let node = &mut tree.nodes[idx];
        let mut changed = false;
        if (node.style.scale - scale).abs() > 1e-4 {
            node.style.scale = scale;
            changed = true;
        }
        if (node.style.rotate - rotate).abs() > 1e-4 {
            node.style.rotate = rotate;
            changed = true;
        }
        if changed {
            touched.insert(node.id);
        }
    }
    touched
}

/// ★★★**场跟手（复用已算绝对矩形）**（Dactyl L2 大 N 性能）：与 `follow_field` 同语义，但接受
///   **外部传入的绝对矩形**（FFI 层缓存）——去掉每次调用的 `absolute_rects()` O(N) 重新分配。
///   语义与 `follow_field` **一致**（同公式、同叶/子树判定）。
pub fn follow_field_cached(
    tree: &mut LayoutTree,
    abs: &[Option<Rect>],
    container_id: u32,
    focus_x: f32,
    focus_y: f32,
    falloff: f32,
    min_scale: f32,
    max_scale: f32,
    max_rotate: f32,
) -> std::collections::HashSet<u32> {
    let mut touched = std::collections::HashSet::new();
    if falloff <= 0.0 {
        return touched;
    }
    let Some(cidx) = tree.index_of_id(container_id) else { return touched };
    let mut target_idx: Vec<usize> = Vec::new();
    let mut stack: Vec<NodeIndex> = tree.get(cidx).children.clone();
    while let Some(i) = stack.pop() {
        let n = tree.get(i);
        if n.children.is_empty() {
            target_idx.push(i as usize);
        } else {
            stack.extend(n.children.iter().copied());
        }
    }
    for idx in target_idx {
        let Some(r) = abs.get(idx).and_then(|o| *o) else { continue };
        if r.width <= 0.0 || r.height <= 0.0 {
            continue;
        }
        let cx = r.x + r.width * 0.5;
        let cy = r.y + r.height * 0.5;
        let dx = focus_x - cx;
        let dy = focus_y - cy;
        let dist = (dx * dx + dy * dy).sqrt();
        let t = (1.0 - dist / falloff).clamp(0.0, 1.0);
        let scale = min_scale + (max_scale - min_scale) * t;
        let rotate = (dx / falloff).clamp(-1.0, 1.0) * max_rotate;
        let node = &mut tree.nodes[idx];
        let mut changed = false;
        if (node.style.scale - scale).abs() > 1e-4 {
            node.style.scale = scale;
            changed = true;
        }
        if (node.style.rotate - rotate).abs() > 1e-4 {
            node.style.rotate = rotate;
            changed = true;
        }
        if changed {
            touched.insert(node.id);
        }
    }
    touched
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::LNode;
    use crate::style::LStyle;

    fn tree_with(n: u32) -> LayoutTree {
        let mut t = LayoutTree::new();
        for i in 0..n {
            t.push(LNode::new(i + 1, LStyle::default()));
        }
        t
    }

    fn anim(node_id: u32, kind: AnimKind) -> Anim {
        Anim {
            node_id,
            kind,
            curve: CURVE_EASE_OUT_CUBIC,
            from: 0.0,
            to: 100.0,
            dur_ms: 100.0,
            delay_ms: 0.0,
            t_ms: 0.0,
            drive: AnimDrive::Time,
            progress: 0.0,
            scroll_from: 0.0,
            scroll_to: 0.0,
            mode: AnimMode::Curve,
            x: 0.0,
            vel: 0.0,
            takeover: true,
            curve_pts: None,
            iterations: 1.0,
            alternate: false,
        }
    }

    fn find_visual(v: &[NodeVisual], id: u32) -> Option<NodeVisual> {
        v.iter().find(|x| x.id == id).copied()
    }

    /* ────────────────────────── 曲线 / 端点 ────────────────────────── */

    #[test]
    fn curve_endpoints_are_exact() {
        for c in 0..CURVE_COUNT as u8 {
            assert_eq!(curve_eval(c, 0.0), 0.0, "曲线 {c} 的 f(0) 必须精确为 0");
            assert_eq!(curve_eval(c, 1.0), 1.0, "曲线 {c} 的 f(1) 必须精确为 1");
        }
    }

    #[test]
    fn curve_is_clamped_outside_unit_range() {
        for c in 0..CURVE_COUNT as u8 {
            assert_eq!(curve_eval(c, -0.5), 0.0);
            assert_eq!(curve_eval(c, 1.5), 1.0);
        }
    }

    #[test]
    fn monotonic_curves_are_monotonic() {
        for c in [CURVE_LINEAR, CURVE_EASE_OUT_CUBIC, CURVE_EASE_IN_CUBIC, CURVE_EASE_IN_OUT_CUBIC] {
            let mut prev = -1.0f32;
            for i in 0..=64 {
                let v = curve_eval(c, i as f32 / 64.0);
                assert!(v + 1e-6 >= prev, "曲线 {c} 在 u={} 处回退（{prev} → {v}）", i as f32 / 64.0);
                prev = v;
            }
        }
    }

    #[test]
    fn table_matches_exact_formula() {
        // 查表 + 线性插值的误差上界（64 段上三次曲线的最大二阶导 ⇒ 误差 ~1e-3 量级）
        for i in 0..=640 {
            let u = i as f32 / 640.0;
            let exact = 1.0 - (1.0 - u).powi(3);
            let got = curve_eval(CURVE_EASE_OUT_CUBIC, u);
            assert!((got - exact).abs() < 2e-3, "u={u}: 表 {got} vs 精确 {exact}");
        }
    }

    /* ────────────────────────── 曲线动画与基础语义 ────────────────────────── */

    #[test]
    fn tick_advances_writes_and_finishes() {
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateX)).unwrap();
        // 半程：easeOutCubic(0.5) = 0.875 ⇒ 87.5
        let o = e.tick(&mut t, 50.0);
        assert_eq!(o.changed, 1);
        assert_eq!(o.finished, 0);
        assert!((t.nodes[0].style.translate_x - 87.5).abs() < 0.1, "半程值 {}", t.nodes[0].style.translate_x);
        // 到时长：值必须**精确**等于 to，并且动画被移除
        let o2 = e.tick(&mut t, 60.0);
        assert_eq!(o2.finished, 1);
        assert_eq!(o2.active_after, 0);
        assert_eq!(t.nodes[0].style.translate_x, 100.0);
    }

    #[test]
    fn start_replaces_same_node_and_kind() {
        let t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateX)).unwrap();
        let mut second = anim(1, AnimKind::TranslateX);
        second.to = 42.0;
        e.start(&t, second).unwrap();
        assert_eq!(e.len(), 1, "同 (node, kind) 必须替换而不是叠加");
    }

    #[test]
    fn different_kinds_coexist_and_stop_selectively() {
        let t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateX)).unwrap();
        e.start(&t, anim(1, AnimKind::Scale)).unwrap();
        assert_eq!(e.len(), 2);
        e.stop(1, Some(AnimKind::Scale));
        assert_eq!(e.len(), 1);
        e.stop(1, None);
        assert_eq!(e.len(), 0);
    }

    #[test]
    fn start_on_missing_node_is_an_error_not_silent() {
        let t = tree_with(1);
        let mut e = AnimEngine::new();
        let err = e.start(&t, anim(99, AnimKind::TranslateX)).unwrap_err();
        assert!(err.contains("99"), "错误信息必须点名节点：{err}");
    }

    // ══════════════════════════════════════════════════════════════════
    // ★★颜色通道（2026-10-01）：四通道分解 / 复位回底色 / 无底色明确拒绝
    // ══════════════════════════════════════════════════════════════════

    /// 带底色的单节点树（`0xFF3355AA`）
    fn tree_with_bg(n: u32, bg: u32) -> LayoutTree {
        let mut t = tree_with(n);
        for node in t.nodes.iter_mut() {
            node.style.bg = Some(bg);
            node.style.bg_base = Some(bg);
        }
        t
    }

    fn color_anim(node_id: u32, kind: AnimKind, from: f32, to: f32) -> Anim {
        let mut a = anim(node_id, kind);
        a.from = from;
        a.to = to;
        a
    }

    #[test]
    fn color_channels_write_independently_into_packed_bg() {
        // 底色 0xFF3355AA（R=33/G=55/B=AA/A=FF）⇒ 只动 R 通道到 0x80
        let mut t = tree_with_bg(1, 0xFF33_55AA);
        let mut e = AnimEngine::new();
        e.start(&t, color_anim(1, AnimKind::ColorR, 0x33 as f32, 0x80 as f32)).unwrap();
        let o = e.tick(&mut t, 100.0); // 走完全程
        assert_eq!(o.finished, 1);
        assert_eq!(t.nodes[0].style.bg, Some(0xFF80_55AA), "只有 R 字节被改，其余三通道原样");
        // ★报告里带颜色 + color_valid
        assert_eq!(o.updates.len(), 1);
        assert_eq!(o.updates[0].bg, Some(0xFF80_55AA));
        assert!(o.updates[0].color_valid);
    }

    #[test]
    fn color_four_channels_compose_full_color_and_pin_endpoints() {
        // 四通道同时从 0 → 目标（模拟"一句话颜色动画"的内核形态）
        let mut t = tree_with_bg(1, 0x0000_0000);
        let mut e = AnimEngine::new();
        for (kind, to) in [
            (AnimKind::ColorR, 0x11 as f32),
            (AnimKind::ColorG, 0x22 as f32),
            (AnimKind::ColorB, 0x33 as f32),
            (AnimKind::ColorA, 0xFF as f32),
        ] {
            e.start(&t, color_anim(1, kind, 0.0, to)).unwrap();
        }
        assert_eq!(e.len(), 4, "一次颜色动画 = 4 条通道指令（如实的代价）");
        let o = e.tick(&mut t, 100.0);
        assert_eq!(o.finished, 4);
        // ★端点钉死：四通道精确落在目标（无浮点残差）
        assert_eq!(t.nodes[0].style.bg, Some(0xFF11_2233));
    }

    #[test]
    fn color_anim_on_node_without_base_is_rejected_not_silent() {
        // 无底色（树里没声明 backgroundColor）⇒ 必须**明确拒绝**（否则 stop 后无处可回）
        let t = tree_with(1);
        let mut e = AnimEngine::new();
        let err = e.start(&t, anim(1, AnimKind::ColorR)).unwrap_err();
        assert!(err.contains("底色"), "错误必须说明原因：{err}");
        assert!(err.contains("backgroundColor"), "错误必须给修法：{err}");
    }

    #[test]
    fn stop_and_reset_restore_base_color() {
        // 「解绑必须含清值」在颜色上的落点：stop_nodes / stop_all / reset_visuals 都要回底色
        let mut t = tree_with_bg(1, 0xFF33_55AA);
        let mut e = AnimEngine::new();
        e.start(&t, color_anim(1, AnimKind::ColorR, 0x33 as f32, 0xEE as f32)).unwrap();
        e.tick(&mut t, 50.0);
        assert_ne!(t.nodes[0].style.bg, Some(0xFF33_55AA), "动画中：颜色已偏");
        // ① stop_all：回底色 + 计脏
        let n = e.stop_all(&mut t);
        assert!(n >= 1, "颜色被改过 ⇒ stop_all 必须计一次复位");
        assert_eq!(t.nodes[0].style.bg, Some(0xFF33_55AA), "stop_all 后回底色");

        // ② stop_nodes（节点回收解绑）同样回底色
        e.start(&t, color_anim(1, AnimKind::ColorG, 0x55 as f32, 0xEE as f32)).unwrap();
        e.tick(&mut t, 50.0);
        assert_ne!(t.nodes[0].style.bg, Some(0xFF33_55AA));
        e.stop_nodes(&mut t, &[1]);
        assert_eq!(t.nodes[0].style.bg, Some(0xFF33_55AA), "stop_nodes 后回底色");

        // ③ reset_visuals 直接调用
        t.nodes[0].style.bg = Some(0x1122_3344);
        let n2 = reset_visuals(&mut t, &[1]);
        assert_eq!(n2, 1);
        assert_eq!(t.nodes[0].style.bg, Some(0xFF33_55AA));
    }

    // ══════════════════════════════════════════════════════════════════
    // ★★文字色通道（2026-10-01）：与底色**同一条数学、不同的槽**
    // ══════════════════════════════════════════════════════════════════

    /// 带**文字色**的节点树（`0xFFFFFFFF` 白字）
    fn tree_with_text_color(bg: u32, text: u32) -> LayoutTree {
        let mut t = tree_with(1);
        t.nodes[0].style.bg = Some(bg);
        t.nodes[0].style.bg_base = Some(bg);
        t.nodes[0].style.text_color = Some(text);
        t.nodes[0].style.text_color_base = Some(text);
        t
    }

    #[test]
    fn text_color_channels_write_into_text_slot_not_bg() {
        // ★核心不变量：文字色通道写 `text_color`，**不碰** `bg`（两条轨道的分界）
        let mut t = tree_with_text_color(0xFF33_55AA, 0xFFFF_FFFF);
        let mut e = AnimEngine::new();
        e.start(&t, color_anim(1, AnimKind::TextColorR, 0xFF as f32, 0x00 as f32)).unwrap();
        let o = e.tick(&mut t, 100.0);
        assert_eq!(o.finished, 1);
        assert_eq!(t.nodes[0].style.text_color, Some(0xFF00_FFFF), "文字色 R 通道应改：白 → 青");
        assert_eq!(t.nodes[0].style.bg, Some(0xFF33_55AA), "★底色必须**原样不动**（两条轨道独立）");
        // 报告里两组都带（各自 valid 标记）
        assert_eq!(o.updates.len(), 1);
        assert_eq!(o.updates[0].text_color, Some(0xFF00_FFFF));
        assert!(o.updates[0].text_color_valid);
        assert_eq!(o.updates[0].bg, Some(0xFF33_55AA), "报告同时带底色（供宿主两组都刷新）");
    }

    #[test]
    fn text_color_requires_base_and_restores_it() {
        // ① 无文字色基色 ⇒ 明确拒绝（与底色同一条纪律）
        let t = tree_with(1); // 只有默认样式（无 bg / 无 text_color）
        let mut e = AnimEngine::new();
        let err = e.start(&t, anim(1, AnimKind::TextColorR)).unwrap_err();
        assert!(err.contains("文字色") && err.contains("`color`"), "错误须点名文字色与修法：{err}");

        // ② 有基色 ⇒ 受理；stop 后回原文字色（不是停在末帧）
        let mut t2 = tree_with_text_color(0xFF00_0000, 0xFFFF_FFFF);
        let mut e2 = AnimEngine::new();
        e2.start(&t2, color_anim(1, AnimKind::TextColorR, 0xFF as f32, 0x00 as f32)).unwrap();
        e2.tick(&mut t2, 50.0);
        assert_ne!(t2.nodes[0].style.text_color, Some(0xFFFF_FFFF));
        e2.stop_all(&mut t2);
        assert_eq!(t2.nodes[0].style.text_color, Some(0xFFFF_FFFF), "stop_all 回原文字色");
        assert_eq!(t2.nodes[0].style.bg, Some(0xFF00_0000), "底色不受文字色动画影响");
    }

    #[test]
    fn both_color_tracks_can_run_together() {
        // 底色与文字色**同时**动画：互不干扰（两条轨道各自写各自的槽）
        let mut t = tree_with_text_color(0xFF00_0000, 0xFFFF_FFFF);
        let mut e = AnimEngine::new();
        e.start(&t, color_anim(1, AnimKind::ColorR, 0x00 as f32, 0xEE as f32)).unwrap();
        e.start(&t, color_anim(1, AnimKind::TextColorB, 0xFF as f32, 0x00 as f32)).unwrap();
        assert_eq!(e.len(), 2);
        let o = e.tick(&mut t, 100.0);
        assert_eq!(o.finished, 2);
        assert_eq!(t.nodes[0].style.bg, Some(0xFFEE_0000), "底色 R → EE");
        assert_eq!(t.nodes[0].style.text_color, Some(0xFFFF_FF00), "文字色 B → 00");
    }

    #[test]
    fn color_is_paint_only_and_non_composited() {
        // ① 颜色**不触发布局**（与 opacity 同成本类）
        assert!(!AnimKind::ColorR.is_composited());
        // ② 显示名统一为 color（报错要说用户的语言，不说通道号）
        assert_eq!(AnimKind::ColorR.display(), "color");
        assert_eq!(AnimKind::ColorA.display(), "color");
        assert_eq!(AnimKind::TranslateX.display(), "translateX");
        // ③ plan_animations 把它列为**非合成**（⇒ 平台零参与路径会被拒绝）
        let a = color_anim(1, AnimKind::ColorR, 0.0, 1.0);
        let plan = plan_animations(&[a]);
        assert!(!plan.composited, "含颜色 ⇒ 不可走平台零参与路径");
        assert_eq!(plan.non_composited_kinds.len(), 1);
    }

    #[test]
    fn unknown_curve_is_rejected() {
        let t = tree_with(1);
        let mut e = AnimEngine::new();
        let mut a = anim(1, AnimKind::TranslateX);
        a.curve = 200;
        assert!(e.start(&t, a).is_err());
    }

    #[test]
    fn time_driven_anim_still_finishes_and_reports_final_value() {
        // 回归：终点精确 + 结束后移除 + 终值有变化仍回报（宿主需要把最后一帧刷上去）
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateX)).unwrap();
        let o = e.tick(&mut t, 200.0);
        assert_eq!(o.finished, 1);
        assert_eq!(o.active_after, 0);
        assert_eq!(t.nodes[0].style.translate_x, 100.0);
        assert_eq!(o.updates.len(), 1);
        assert_eq!(o.updates[0].tx, 100.0);
    }

    #[test]
    fn tick_reports_updates_only_for_changed_nodes() {
        let mut t = tree_with(2);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateX)).unwrap();
        e.start(&t, anim(2, AnimKind::TranslateY)).unwrap();
        let o1 = e.tick(&mut t, 10.0);
        assert_eq!(o1.updates.len(), 2);
        e.stop(2, None);
        let o2 = e.tick(&mut t, 10.0);
        assert_eq!(o2.updates.len(), 1);
        assert_eq!(o2.updates[0].id, 1);
    }

    /* ────────────────────────── 属性：scale / rotate / opacity ────────────────────────── */

    #[test]
    fn scale_defaults_to_one_and_uses_direct_slot() {
        let mut t = tree_with(1);
        assert_eq!(t.nodes[0].style.scale, 1.0, "scale 缺省必须是 1（不是 0）");
        let mut e = AnimEngine::new();
        let mut a = anim(1, AnimKind::Scale);
        a.from = 0.9;
        a.to = 1.0;
        e.start(&t, a).unwrap();
        e.tick(&mut t, 100.0);
        assert_eq!(t.nodes[0].style.scale, 1.0);
    }

    #[test]
    fn rotate_and_opacity_map_to_their_slots() {
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::Rotate)).unwrap(); // 0 → 100 度
        e.start(&t, anim(1, AnimKind::Opacity)).unwrap(); // 0 → 100（越界值，仅验证槽映射）
        e.tick(&mut t, 200.0);
        assert_eq!(t.nodes[0].style.rotate, 100.0);
        assert_eq!(t.nodes[0].style.opacity, 100.0); // 内核不钳制值域（边界④：钳制在编译期/宿主层）
    }

    #[test]
    fn rotate_and_opacity_defaults_are_identity() {
        let t = tree_with(1);
        assert_eq!(t.nodes[0].style.opacity, 1.0, "opacity 缺省必须是 1（不是 0）");
        assert_eq!(t.nodes[0].style.rotate, 0.0, "rotate 缺省必须是 0");
    }

    /* ────────────────────────── ★弹簧物理（对齐 Flutter SpringDescription） ────────────────────────── */

    #[test]
    fn spring_settles_at_target_and_pins_endpoint() {
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        let mut a = anim(1, AnimKind::TranslateX);
        a.to = 100.0;
        a.mode = AnimMode::Spring(SpringParams { stiffness: 300.0, damping: 30.0, mass: 1.0 });
        e.start(&t, a).unwrap();
        let mut frames = 0;
        while !e.is_empty() && frames < 300 {
            e.tick(&mut t, 16.7);
            frames += 1;
        }
        assert!(frames < 300, "弹簧必须在合理帧数内静止（实际 {frames} 帧）");
        assert_eq!(t.nodes[0].style.translate_x, 100.0, "静止后必须精确钉在 to");
    }

    #[test]
    fn spring_is_stable_under_large_dt() {
        // 掉帧场景：一次 tick 200ms（子步积分必须稳住）
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        let mut a = anim(1, AnimKind::TranslateX);
        a.to = 100.0;
        a.mode = AnimMode::Spring(SpringParams { stiffness: 600.0, damping: 35.0, mass: 1.0 });
        e.start(&t, a).unwrap();
        e.tick(&mut t, 200.0);
        let x = t.nodes[0].style.translate_x;
        assert!(x.is_finite() && (-1000.0..=1000.0).contains(&x), "大 dt 下不得发散：{x}");
    }

    #[test]
    fn spring_takeover_carries_velocity_and_position() {
        // 曲线动画跑到一半 → 弹簧接管：位置连续 + 速度移交
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateX)).unwrap(); // 0→100, 100ms
        e.tick(&mut t, 50.0);
        let (x_before, v_before) = e.peek_state(1, AnimKind::TranslateX).unwrap();
        assert!(v_before > 0.0, "曲线中途速度应为正（实测 {v_before}）");
        let mut s = anim(1, AnimKind::TranslateX);
        s.to = 200.0;
        s.mode = AnimMode::Spring(SpringParams::snappy());
        e.start(&t, s).unwrap(); // takeover 默认 true
        let (x_after, v_after) = e.peek_state(1, AnimKind::TranslateX).unwrap();
        assert_eq!(x_after, x_before, "接管必须位置连续（无跳变）");
        assert_eq!(v_after, v_before, "接管必须速度移交");
    }

    #[test]
    fn hard_restart_resets_position_and_velocity() {
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateX)).unwrap();
        e.tick(&mut t, 50.0);
        let mut s = anim(1, AnimKind::TranslateX);
        s.to = 200.0;
        s.takeover = false;
        e.start(&t, s).unwrap();
        let (x, v) = e.peek_state(1, AnimKind::TranslateX).unwrap();
        assert_eq!(x, 0.0, "硬重启必须回到 from");
        assert_eq!(v, 0.0, "硬重启速度归零");
    }

    /* ────────────────────────── 编排：delay ────────────────────────── */

    #[test]
    fn delay_holds_at_start_then_moves() {
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        let mut a = anim(1, AnimKind::TranslateX);
        a.from = 10.0;
        a.delay_ms = 50.0;
        e.start(&t, a).unwrap();
        e.tick(&mut t, 30.0); // 仍在延迟期
        assert_eq!(t.nodes[0].style.translate_x, 10.0, "延迟期必须钉在起点");
        assert_eq!(e.len(), 1, "延迟期不得被移除");
        // ★算术提示：delay 50 + dur 100 = 需累计 150ms（前面已 tick 30ms）
        //   （首版这里写 tick(100) ⇒ 累计 130ms，只走了 80/100 ⇒ 断言失败——是**测试算术错**，
        //    实现正确：延迟后按 `t_ms - delay_ms` 计进度）
        e.tick(&mut t, 120.0); // 累计 150ms ⇒ 正好走完
        assert_eq!(t.nodes[0].style.translate_x, 100.0);
        assert_eq!(e.len(), 0);
    }

    /* ────────────────────────── seek（手势驱动）与速度接力 ────────────────────────── */

    #[test]
    fn seek_sets_progress_driven_value_immediately() {
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateX)).unwrap();
        // 手势拖到 50% ⇒ 值应当即 = easeOutCubic(0.5) × 100 = 87.5（不必等 tick）
        let out = e.seek(&mut t, 1, AnimKind::TranslateX, 0.5);
        assert_eq!(out.changed, 1);
        assert!((t.nodes[0].style.translate_x - 87.5).abs() < 0.05, "seek 后值 {}", t.nodes[0].style.translate_x);
        assert_eq!(out.updates.len(), 1);
        assert_eq!(out.updates[0].id, 1);
    }

    #[test]
    fn seek_switches_to_progress_drive_and_tick_no_longer_advances_it() {
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateX)).unwrap();
        e.seek(&mut t, 1, AnimKind::TranslateX, 0.3);
        let v_after_seek = t.nodes[0].style.translate_x;
        // ★关键语义：Progress 驱动后，tick 不应再推进（否则手势松手后动画会自己跑）
        let out = e.tick(&mut t, 500.0);
        assert_eq!(out.changed, 0, "Progress 驱动的动画不应被 tick 改变");
        assert_eq!(t.nodes[0].style.translate_x, v_after_seek);
        assert_eq!(out.finished, 0, "Progress 驱动不应因时长而结束（由 stop 显式结束）");
        assert_eq!(e.len(), 1);
    }

    #[test]
    fn seek_clamps_progress_out_of_range() {
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateX)).unwrap();
        e.seek(&mut t, 1, AnimKind::TranslateX, 3.7);
        assert_eq!(t.nodes[0].style.translate_x, 100.0, "progress>1 必须 clamp 到终点值");
        e.seek(&mut t, 1, AnimKind::TranslateX, -2.0);
        assert_eq!(t.nodes[0].style.translate_x, 0.0, "progress<0 必须 clamp 到起点值");
    }

    #[test]
    fn seek_on_unknown_target_is_a_noop_not_a_panic() {
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateX)).unwrap();
        let out = e.seek(&mut t, 999, AnimKind::TranslateX, 0.5);
        assert_eq!(out.changed, 0);
        assert_eq!(out.updates.len(), 0);
    }

    #[test]
    fn seek_velocity_feeds_spring_handoff() {
        // 手势序列：seek 两次（带 dt）⇒ 速度被估计；松手（弹簧接管）⇒ 速度移交
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        let mut a = anim(1, AnimKind::TranslateX);
        a.dur_ms = 1000.0;
        e.start(&t, a).unwrap();
        e.seek_velocity(&mut t, 1, AnimKind::TranslateX, 0.2, Some(1.0 / 60.0));
        let (x1, _v1) = e.peek_state(1, AnimKind::TranslateX).unwrap();
        e.seek_velocity(&mut t, 1, AnimKind::TranslateX, 0.35, Some(1.0 / 60.0));
        let (x2, v2) = e.peek_state(1, AnimKind::TranslateX).unwrap();
        assert!(v2 > 0.0, "seek 应估出正速度（实测 {v2}）");
        // 松手：弹簧接管到 0（回弹）
        let mut s = anim(1, AnimKind::TranslateX);
        s.to = 0.0;
        s.mode = AnimMode::Spring(SpringParams::smooth());
        e.start(&t, s).unwrap();
        let (x3, v3) = e.peek_state(1, AnimKind::TranslateX).unwrap();
        assert_eq!(x3, x2, "接管位置必须连续（不跳到 0；前值 {x1} → {x2}）");
        assert!(v3 > 0.0, "接管必须带着手势速度（实测 {v3}）");
    }

    /* ────────────────────────── stop_nodes（§7.3 复用解绑） ────────────────────────── */

    #[test]
    fn stop_nodes_unbinds_animations_for_recycled_nodes() {
        // 场景：两个节点在做动画，其中节点 2 所在的行被回收（离开可见区）⇒ 必须解绑
        let mut t = tree_with(2);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateX)).unwrap();
        e.start(&t, anim(2, AnimKind::TranslateY)).unwrap();
        let removed = e.stop_nodes(&mut t, &[2]);
        assert_eq!(removed, 1, "应移除节点 2 的动画");
        assert_eq!(e.len(), 1, "节点 1 的动画不受影响");
        // 解绑后 tick：**不得**再动节点 2（否则回收后错位）
        let v2_before = t.nodes[1].style.translate_y;
        e.tick(&mut t, 50.0);
        assert_eq!(t.nodes[1].style.translate_y, v2_before, "已解绑的节点不得被 tick 改动");
        // 节点 1 仍在动
        assert_ne!(t.nodes[0].style.translate_x, 0.0);
        // ★清值断言（真机实测的污染根因）：被解绑节点的视觉字段必须**复位**
        assert_eq!(t.nodes[1].style.translate_y, 0.0, "解绑必须清值（否则残留姿态污染复用/后续相位）");
    }

    #[test]
    fn spring_presets_match_ts_side() {
        // ★★跨语言契约：TS 侧 `packages/animation/src/presets.ts` 的 `easing.snappy/smooth`
        //   必须与本文件的 `SpringParams::snappy()/smooth()` **逐字段相等**——
        //   任一侧改了而另一侧没跟 ⇒ 两端手感分叉（而这是静默的：动画照样跑，只是不一样）。
        //   （TS 侧 tests/animation-presets.test.ts 有对称断言；两侧互为镜像。）
        let snappy = SpringParams::snappy();
        assert_eq!((snappy.stiffness, snappy.damping, snappy.mass), (320.0, 30.0, 1.0));
        let smooth = SpringParams::smooth();
        assert_eq!((smooth.stiffness, smooth.damping, smooth.mass), (180.0, 26.0, 1.0));
    }

    #[test]
    fn all_anim_kinds_are_composited() {
        // ★本引擎的设计选择：只做绘制层变换 ⇒ 全部属性都是合成属性
        //   （这是"平台渲染线程零参与路径"可用的前提，见 Morpheus §5-bis）
        for k in [AnimKind::TranslateX, AnimKind::TranslateY, AnimKind::Scale, AnimKind::Rotate, AnimKind::Opacity] {
            assert!(k.is_composited(), "{k:?} 应为合成属性");
        }
    }

    #[test]
    fn plan_reports_composited_for_transform_only_batch() {
        let anims = vec![
            anim(1, AnimKind::TranslateX),
            anim(1, AnimKind::Scale),
            anim(2, AnimKind::Opacity),
        ];
        let p = plan_animations(&anims);
        assert!(p.composited, "全合成属性 ⇒ 可走平台零参与路径");
        assert!(p.non_composited_kinds.is_empty());
        assert_eq!(p.node_count, 2);
        assert_eq!(p.anim_count, 3);
    }

    /* ────────────────────────── ★MA0-RT：提交规格（平台零参与路径） ────────────────────────── */

    #[test]
    fn commit_spec_has_17_samples_with_pinned_endpoints() {
        let t = tree_with(1);
        let mut a = anim(1, AnimKind::TranslateX); // 0 → 100, easeOutCubic
        a.dur_ms = 300.0;
        let specs = commit_specs(&t, &[a]);
        assert_eq!(specs.len(), 1, "单节点 ⇒ 一条规格");
        let sp = &specs[0];
        assert_eq!(sp.samples.len(), COMMIT_SAMPLES, "采样点数须为 17");
        assert_eq!(sp.key_times.len(), COMMIT_SAMPLES);
        assert_eq!(sp.key_times[0], 0.0);
        assert_eq!(*sp.key_times.last().unwrap(), 1.0);
        // 起点 = from（0）、终点 = to（100，**精确**）
        assert_eq!(sp.samples[0].0, 0.0, "起点须精确等于 from");
        assert_eq!(sp.samples[COMMIT_SAMPLES - 1].0, 100.0, "终点须精确等于 to（端点钉死）");
        // 中途值应与 curve_eval 一致（采样器与 tick 路径同源）
        let mid = sp.samples[COMMIT_SAMPLES / 2].0;
        let expect = 100.0 * curve_eval(0x01 /* EASE_OUT_CUBIC */, 0.5);
        assert!((mid - expect).abs() < 0.01, "中途值 {mid} 应 ≈ {expect}（与 tick 同曲线）");
    }

    #[test]
    fn commit_spec_merges_multiple_kinds_for_same_node() {
        let t = tree_with(1);
        let mut x = anim(1, AnimKind::TranslateX);
        x.dur_ms = 300.0;
        let mut sc = anim(1, AnimKind::Scale);
        sc.from = 1.0;
        sc.to = 0.5;
        sc.dur_ms = 300.0;
        let specs = commit_specs(&t, &[x, sc]);
        assert_eq!(specs.len(), 1, "同节点多属性 ⇒ 合并为**一条**规格（平台的 transform 是整体）");
        let last = specs[0].samples[COMMIT_SAMPLES - 1];
        assert_eq!(last.0, 100.0, "translate 终点");
        assert_eq!(last.2, 0.5, "scale 终点");
    }

    #[test]
    fn commit_spec_spring_uses_same_integration_as_tick() {
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        let mut a = anim(1, AnimKind::TranslateX);
        a.to = 100.0;
        a.mode = AnimMode::Spring(SpringParams { stiffness: 320.0, damping: 30.0, mass: 1.0 });
        // ★比较窗口 = **采样点的精确时刻**（t = u × dur），避免索引取整引入假差异。
        //   首版用 t=160ms（超出 dur=100ms 的窗口）⇒ 被端点钉死成 100 ⇒ 假红。
        let specs = commit_specs(&t, &[a.clone()]);
        let dur = specs[0].dur_ms; // 有效时长（弹簧 = 自然静止时间）
        assert!(dur > 100.0, "弹簧的有效时长应**长于**名义 dur_ms（自然静止时间；实测 {dur}）");
        let u = 0.5f32;
        let idx = ((u * (COMMIT_SAMPLES - 1) as f32).round() as usize).min(COMMIT_SAMPLES - 1);
        // ① tick 路径：积分到 t = u × dur
        e.start(&t, a).unwrap();
        e.tick(&mut t, u * dur);
        let via_tick = t.nodes[0].style.translate_x;
        // ② 提交路径：同一时刻的采样值
        let via_commit = specs[0].samples[idx].0;
        assert!(
            (via_tick - via_commit).abs() < 1.0,
            "两条路径必须同形（tick {via_tick} vs commit {via_commit}，t={}ms）", u * dur
        );
    }

    #[test]
    fn spring_commit_window_covers_natural_settle() {
        // 回归：弹簧的提交窗口必须覆盖到自然静止（否则动画被截断——真机/单测都抓过）
        let t = tree_with(1);
        let mut a = anim(1, AnimKind::TranslateX);
        a.to = 100.0;
        a.dur_ms = 100.0; // 名义时长故意设得**比自然静止短**
        a.mode = AnimMode::Spring(SpringParams { stiffness: 320.0, damping: 30.0, mass: 1.0 });
        let specs = commit_specs(&t, &[a]);
        let last = specs[0].samples[COMMIT_SAMPLES - 1].0;
        assert_eq!(last, 100.0, "窗口末尾应精确落在 to（自然静止）");
        // 且中途值应已非常接近目标（说明确实到了静止附近，而不是被硬截断）
        let near_end = specs[0].samples[COMMIT_SAMPLES - 2].0;
        assert!((near_end - 100.0).abs() < 5.0, "窗口倒数第二点应已接近静止（实测 {near_end}）");
    }

    #[test]
    fn commit_spec_respects_static_baseline_for_untouched_kinds() {
        // 未参与动画的属性：应取**节点当前值**（不是硬编码 0/1——否则会把无关属性清零）
        let mut t = tree_with(1);
        t.nodes[0].style.opacity = 0.42;
        t.nodes[0].style.rotate = 7.0;
        let mut a = anim(1, AnimKind::TranslateX);
        a.dur_ms = 100.0;
        let specs = commit_specs(&t, &[a]);
        let s0 = specs[0].samples[0];
        assert_eq!(s0.4, 0.42, "opacity 应保持静态基线（实测 {}）", s0.4);
        assert_eq!(s0.3, 7.0, "rotate 应保持静态基线（实测 {}）", s0.3);
    }

    #[test]
    fn commit_spec_keyframes_uses_segment_sum_as_window() {
        // ★回归（真机抓出的平台路径缺口）：commit 的采样窗口必须是**段时长之和**——
        //   若误用名义 dur_ms，序列会被截断（末尾几段根本没进采样）；
        //   且采样必须**按段求值**（下探/回冲都要出现在采样里，否则平台插值的是错的形状）。
        let t = tree_with(1);
        let mut a = anim(1, AnimKind::Scale);
        a.from = 1.0;
        a.to = 1.0;
        a.dur_ms = 9999.0; // ★故意给一个与段和**不一致**的名义时长（错用它会当场红）
        a.mode = AnimMode::Keyframes(vec![
            KeySeg { to: 0.6, dur_ms: 100.0, curve: CURVE_LINEAR },
            KeySeg { to: 1.2, dur_ms: 200.0, curve: CURVE_LINEAR },
            KeySeg { to: 1.0, dur_ms: 100.0, curve: CURVE_LINEAR },
        ]);
        let specs = commit_specs(&t, &[a]);
        assert!(
            (specs[0].dur_ms - 400.0).abs() < 1e-3,
            "有效时长必须是段和 400（实测 {}）",
            specs[0].dur_ms
        );
        let scales: Vec<f32> = specs[0].samples.iter().map(|s| s.2).collect();
        let min = scales.iter().cloned().fold(f32::MAX, f32::min);
        let max = scales.iter().cloned().fold(f32::MIN, f32::max);
        assert!(min <= 0.62, "采样应下探到 ≈0.6（实测 {min}）");
        assert!(max >= 1.18, "采样应上冲到 ≈1.2（实测 {max}）");
        // 端点钉死：末采样 = 声明的 to
        assert_eq!(scales[scales.len() - 1], 1.0);
    }

    #[test]
    fn detach_nodes_removes_animations_but_keeps_values() {
        // ★MA0-RT 交接语义：摘出动画但**保留样式值**（提交规格基于静态基线采样）
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateX)).unwrap();
        e.tick(&mut t, 50.0);
        let v = t.nodes[0].style.translate_x;
        assert!(v > 0.0);
        assert_eq!(e.detach_nodes(&[1]), 1);
        assert_eq!(t.nodes[0].style.translate_x, v, "detach 不得改样式值");
        assert!(e.is_empty());
    }

    #[test]
    fn bezier_approx_matches_sampled_curve() {
        // ★判据：贝塞尔近似与采样曲线的**最大偏差**必须在一个小上界内（可判定，不是"看起来差不多"）
        //   同时反证：误差**不为 0**（说明它确实是近似——诚实，不假装精确）
        for (curve, max_err) in [
            (CURVE_LINEAR, 1e-6f32),
            (CURVE_EASE_OUT_CUBIC, 0.005f32),
            (CURVE_EASE_IN_CUBIC, 0.008f32),
            (CURVE_EASE_IN_OUT_CUBIC, 0.013f32),
        ] {
            let c = curve_bezier_approx(curve).expect("该曲线应有贝塞尔近似");
            let mut worst = 0f32;
            for i in 0..=100 {
                let u = i as f32 / 100.0;
                let err = (bezier_eval(c, u) - curve_eval(curve, u)).abs();
                worst = worst.max(err);
            }
            assert!(worst <= max_err, "曲线 {curve} 的贝塞尔近似最大偏差 {worst} 超过上界 {max_err}");
        }
    }

    #[test]
    fn bezier_endpoints_are_exact() {
        for curve in [CURVE_LINEAR, CURVE_EASE_OUT_CUBIC, CURVE_EASE_IN_CUBIC, CURVE_EASE_IN_OUT_CUBIC] {
            let c = curve_bezier_approx(curve).unwrap();
            assert!((bezier_eval(c, 0.0) - 0.0).abs() < 1e-5, "曲线 {curve} 的贝塞尔 f(0) 应为 0");
            assert!((bezier_eval(c, 1.0) - 1.0).abs() < 1e-5, "曲线 {curve} 的贝塞尔 f(1) 应为 1");
        }
    }

    #[test]
    fn clip_channels_write_independently_and_reset_to_base() {
        // ★C1（2026-10-01）：16 个裁剪参数通道**各自独立写入**（顺序无关——与颜色同源）；
        //   无声明（clip_kind=0）的节点上启动 ⇒ **明确拒绝**；stop 后回基态。
        let mut t = tree_with(1);
        t.nodes[0].style.clip_kind = 1; // inset
        t.nodes[0].style.clip_base = [0.1, 0.1, 0.1, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
        t.nodes[0].style.clip = t.nodes[0].style.clip_base;
        let mut e = AnimEngine::new();
        // 三条通道各自动画（乱序启动——顺序无关性）
        let mut a2 = Anim::curve_anim(1, AnimKind::Clip2, 0.1, 0.4, 100.0);
        a2.takeover = false;
        e.start(&t, a2).unwrap();
        let mut a0 = Anim::curve_anim(1, AnimKind::Clip0, 0.1, 0.5, 100.0);
        a0.takeover = false;
        e.start(&t, a0).unwrap();
        assert_eq!(e.len(), 2, "两条不同槽位的裁剪通道并存（不是互相替换）");
        // 推进到终点：clip[0]=0.5, clip[2]=0.4，其余不动
        let mut out = e.tick(&mut t, 200.0);
        out.updates.clear();
        assert!((t.nodes[0].style.clip[0] - 0.5).abs() < 1e-4, "clip0={}", t.nodes[0].style.clip[0]);
        assert!((t.nodes[0].style.clip[2] - 0.4).abs() < 1e-4, "clip2={}", t.nodes[0].style.clip[2]);
        assert!((t.nodes[0].style.clip[1] - 0.1).abs() < 1e-6, "未参与的槽位不应被改动");
        assert!((t.nodes[0].style.clip[3] - 0.1).abs() < 1e-6);
        // 复位：stop_all ⇒ 回基态
        e.stop_all(&mut t);
        assert_eq!(t.nodes[0].style.clip, t.nodes[0].style.clip_base, "stop 后裁剪参数回基态");
    }

    #[test]
    fn clip_anim_rejected_without_declared_shape() {
        // 无 `clipPath` 声明的节点上启动裁剪动画 ⇒ 明确拒绝（消息含"没有裁剪形状"与修法）
        let t = tree_with(1);
        let mut e = AnimEngine::new();
        let err = e
            .start(&t, Anim::curve_anim(1, AnimKind::Clip0, 0.0, 0.5, 100.0))
            .expect_err("应拒绝");
        assert!(err.contains("没有裁剪形状"), "错误消息应点明原因：{err}");
        assert!(err.contains("clipPath"), "错误消息应给修法：{err}");
    }

    #[test]
    /// ★★渐变 v2（色标混合）：**混合数学钉值**（唯一 lerp 实现——两端消费它的结果）。
    #[test]
    fn gradient_mix_lerps_stops_and_resets_to_a() {
        use crate::ffi::{proteus_layout_create, proteus_layout_anim_start, proteus_layout_anim_tick_bin};
        // A：黑→白；B：红→蓝（同 kind/同色标数 ⇒ 可混合）
        let req = serde_json::json!({
            "viewport": {"width": 100.0, "height": 100.0},
            "nodes": [
                {"id": 1, "width": 100.0, "height": 100.0},
                {"id": 9, "parentId": 1, "width": 100.0, "height": 100.0,
                 "fillGradient": {"kind": "linear", "angle": 90,
                    "stops": [{"offset": 0.0, "color": "#000000"}, {"offset": 1.0, "color": "#ffffff"}]},
                 "fillGradientTo": {"kind": "linear", "angle": 90,
                    "stops": [{"offset": 0.0, "color": "#ff0000"}, {"offset": 1.0, "color": "#0000ff"}]}}
            ]
        });
        let h = unsafe {
            proteus_layout_create(std::ffi::CString::new(req.to_string()).unwrap().as_ptr())
        };
        assert!(h > 0, "建树应成功（渐变两态结构一致）");
        let start = serde_json::json!({
            "anims": [{"nodeId": 9, "kind": 32, "from": 0.0, "to": 1.0, "durMs": 100, "curve": 0}]
        });
        let r = unsafe {
            proteus_layout_anim_start(h, std::ffi::CString::new(start.to_string()).unwrap().as_ptr())
        };
        let msg = unsafe { std::ffi::CStr::from_ptr(r) }.to_string_lossy().to_string();
        assert!(msg.contains("\"ok\":true"), "混合动画应被受理：{msg}");

        // 半程（t=0.5）：色标应是 (0x80,0,0x80) 与 (0xff,0x80,0xff)（四通道各自 lerp）
        let tick_half = |h: u64, dt: f32| -> (u32, u32) {
            let mut n: u32 = 0;
            let p = unsafe { proteus_layout_anim_tick_bin(h, dt, &mut n) };
            let sl = unsafe { std::slice::from_raw_parts(p, n as usize) }.to_vec();
            unsafe { crate::ffi::proteus_rects_free(p, n) };
            assert!(sl.len() >= 184, "记录应 ≥184B（含渐变段）");
            // 记录布局：id@0 ... stroke@108, gradKind@112, gradN@116, colors@120..152, offsets@152..184
            let c0 = u32::from_le_bytes([sl[120], sl[121], sl[122], sl[123]]);
            let c1 = u32::from_le_bytes([sl[124], sl[125], sl[126], sl[127]]);
            (c0, c1)
        };
        let (c0, c1) = tick_half(h, 50.0);
        let ch = |c: u32, sh: u32| ((c >> sh) & 0xFF) as i32;
        // c0（offset 0）：黑(0,0,0,255) → 红(255,0,0,255) 半程 ⇒ (128,0,0,255)
        assert!((ch(c0, 16) - 128).abs() <= 1, "混合作半程 R 应 ≈128，实际 {}", ch(c0, 16));
        assert_eq!(ch(c0, 8), 0);
        // c1（offset 1）：白(255,255,255,255) → 蓝(0,0,255,255) 半程 ⇒ (128,128,255,255)
        assert!((ch(c1, 8) - 128).abs() <= 1, "终标 G 应 ≈128，实际 {}", ch(c1, 8));
        assert!((ch(c1, 0) - 255).abs() <= 1, "终标 B 应 ≈255（白→蓝的 B 通道未变）");

        // ── stop 后：mix 回 0（基态 A）——"解绑必须含清值" ──
        // ★判据设计（首版想错了一轮，记下来）：**写 0 与"已复位为 0"相同时不产生更新**
        //   ⇒ "有没有更新"本身就是信号：新动画 `from=0`（恰等于复位值）⇒ **无更新 = 复位成功**；
        //   若 stop 没清（残余 0.5）⇒ 0.5→0 是变化 ⇒ 会冒出更新。再用阴性对照证明通道没坏。
        let stop = "{\"all\":true}";
        unsafe {
            crate::ffi::proteus_layout_anim_stop(h, std::ffi::CString::new(stop).unwrap().as_ptr())
        };
        let keep = serde_json::json!({
            "anims": [{"nodeId": 9, "kind": 32, "from": 0.0, "to": 1.0, "durMs": 100,
                       "curve": 0, "takeover": false}]
        });
        let r2 = unsafe {
            proteus_layout_anim_start(h, std::ffi::CString::new(keep.to_string()).unwrap().as_ptr())
        };
        let m2 = unsafe { std::ffi::CStr::from_ptr(r2) }.to_string_lossy().to_string();
        assert!(m2.contains("\"ok\":true"), "复位后的新动画应被受理：{m2}");
        // ① 复位证据：dt=0 ⇒ 写入 from=0 ⇒ 与复位值相同 ⇒ **零更新**
        let mut n0: u32 = 0;
        let p0 = unsafe { proteus_layout_anim_tick_bin(h, 0.0, &mut n0) };
        if !p0.is_null() {
            unsafe { crate::ffi::proteus_rects_free(p0, n0) };
        }
        assert_eq!(n0, 0, "stop 后 mix 应已回 0（写 from=0 不应产生更新）——实际 {} 字节", n0);
        // ② 阴性对照：同一动画推进到半程 ⇒ 必须有更新（证明通道与读法都没坏）
        let (c0c, _c1c) = tick_half(h, 50.0);
        assert!(
            (ch(c0c, 16) - 128).abs() <= 1,
            "阴性对照：半程混合作应可读（R≈128）——实际 {}",
            ch(c0c, 16)
        );
        unsafe { crate::ffi::proteus_layout_destroy(h) };
    }

    /// ★★倾斜（skew v1）：写入/复位 + 记录段（@228）——"从根部弯折"的数据通路。
    #[test]
    fn skew_writes_reports_and_resets() {
        use crate::ffi::{proteus_layout_create, proteus_layout_anim_start, proteus_layout_anim_tick_bin};
        let req = serde_json::json!({
            "viewport": {"width": 100.0, "height": 100.0},
            "nodes": [
                {"id": 1, "width": 100.0, "height": 100.0},
                // 从根部弯折的典型声明：origin 在底部中点
                {"id": 9, "parentId": 1, "width": 20.0, "height": 60.0,
                 "transformOrigin": {"x": 0.5, "y": 1.0},
                 "backgroundColor": "#335544"}
            ]
        });
        let h = unsafe {
            proteus_layout_create(std::ffi::CString::new(req.to_string()).unwrap().as_ptr())
        };
        assert!(h > 0, "带 transformOrigin 应建树成功");
        let start = serde_json::json!({
            "anims": [
                {"nodeId": 9, "kind": 36, "from": 0.0, "to": 12.0, "durMs": 100, "curve": 0},
                {"nodeId": 9, "kind": 37, "from": 0.0, "to": 3.0, "durMs": 100, "curve": 0}
            ]
        });
        let r = unsafe {
            proteus_layout_anim_start(h, std::ffi::CString::new(start.to_string()).unwrap().as_ptr())
        };
        let msg = unsafe { std::ffi::CStr::from_ptr(r) }.to_string_lossy().to_string();
        assert!(msg.contains("\"ok\":true"), "倾斜动画应被受理：{msg}");
        let mut n: u32 = 0;
        let p = unsafe { proteus_layout_anim_tick_bin(h, 50.0, &mut n) };
        assert!(n >= 236, "记录应 ≥236B（含倾斜段）：实际 {n}");
        let sl = unsafe { std::slice::from_raw_parts(p, n as usize) }.to_vec();
        unsafe { crate::ffi::proteus_rects_free(p, n) };
        // 倾斜段固定在 @228/@232（末尾追加——既有偏移全不变）
        let sx = f32::from_le_bytes([sl[228], sl[229], sl[230], sl[231]]);
        let sy = f32::from_le_bytes([sl[232], sl[233], sl[234], sl[235]]);
        assert!((sx - 6.0).abs() < 0.05, "半程 skewX 应 ≈6（0→12 中点），实际 {sx}");
        assert!((sy - 1.5).abs() < 0.05, "半程 skewY 应 ≈1.5，实际 {sy}");
        // stop ⇒ 回 0（"解绑必须含清值"）
        let stop = "{\"all\":true}";
        unsafe {
            crate::ffi::proteus_layout_anim_stop(h, std::ffi::CString::new(stop).unwrap().as_ptr())
        };
        // 复位后再起一条恒 0 的动画读回（无更新 = 已是 0：与渐变同款判据设计）
        let keep = serde_json::json!({
            "anims": [{"nodeId": 9, "kind": 36, "from": 0.0, "to": 1.0, "durMs": 100,
                       "curve": 0, "takeover": false}]
        });
        unsafe {
            proteus_layout_anim_start(h, std::ffi::CString::new(keep.to_string()).unwrap().as_ptr())
        };
        let mut n0: u32 = 0;
        let p0 = unsafe { proteus_layout_anim_tick_bin(h, 0.0, &mut n0) };
        if !p0.is_null() {
            unsafe { crate::ffi::proteus_rects_free(p0, n0) };
        }
        assert_eq!(n0, 0, "stop 后 skewX 应已回 0（写 from=0 不应产生更新）");
        unsafe { crate::ffi::proteus_layout_destroy(h) };
    }

    /// ★★transformOrigin 拒绝分支：非有限 ⇒ 明确拒绝（不静默用中心——那会"看起来能跑但绕错点转"）。
    #[test]
    fn transform_origin_rejects_non_finite() {
        use crate::ffi::proteus_layout_create;
        let bad = serde_json::json!({
            "viewport": {"width": 100.0, "height": 100.0},
            "nodes": [
                {"id": 1, "width": 100.0, "height": 100.0},
                {"id": 9, "parentId": 1, "width": 20.0, "height": 20.0,
                 "transformOrigin": {"x": 0.5, "y": 1e40}}
            ]
        });
        // 1e40 as f64 → f32 溢出为 inf ⇒ 应拒绝
        let h = unsafe {
            proteus_layout_create(std::ffi::CString::new(bad.to_string()).unwrap().as_ptr())
        };
        assert_eq!(h, 0, "非有限 origin 应拒绝建树");
    }

    /// ★★渐变**几何**动画（v2 扩展）：径向 `r` 扩散的**混合数学钉值**（"光本身在动"）。
    #[test]
    fn gradient_geometry_mix_expands_radius() {
        use crate::ffi::{proteus_layout_create, proteus_layout_anim_start, proteus_layout_anim_tick_bin};
        // 两态：同 kind（radial）、同色标数；**几何不同**（r 0.4 → 1.0）
        let req = serde_json::json!({
            "viewport": {"width": 100.0, "height": 100.0},
            "nodes": [
                {"id": 1, "width": 100.0, "height": 100.0},
                {"id": 9, "parentId": 1, "width": 100.0, "height": 100.0,
                 "fillGradient": {"kind": "radial", "cx": 0.5, "cy": 0.5, "r": 0.4,
                    "stops": [{"offset": 0.0, "color": "#ffffff", "alpha": 0.8},
                              {"offset": 1.0, "color": "#ffffff", "alpha": 0.0}]},
                 "fillGradientTo": {"kind": "radial", "cx": 0.5, "cy": 0.5, "r": 1.0,
                    "stops": [{"offset": 0.0, "color": "#ffffff", "alpha": 0.8},
                              {"offset": 1.0, "color": "#ffffff", "alpha": 0.0}]}}
            ]
        });
        let h = unsafe {
            proteus_layout_create(std::ffi::CString::new(req.to_string()).unwrap().as_ptr())
        };
        assert!(h > 0, "两态应建树成功");
        let start = serde_json::json!({
            "anims": [{"nodeId": 9, "kind": 32, "from": 0.0, "to": 1.0, "durMs": 100, "curve": 0}]
        });
        unsafe {
            proteus_layout_anim_start(h, std::ffi::CString::new(start.to_string()).unwrap().as_ptr())
        };
        let read_r = |h: u64, dt: f32| -> f32 {
            let mut n: u32 = 0;
            let p = unsafe { proteus_layout_anim_tick_bin(h, dt, &mut n) };
            assert!(n >= 208, "记录应 ≥208B（含几何段）：实际 {n}");
            let sl = unsafe { std::slice::from_raw_parts(p, n as usize) }.to_vec();
            unsafe { crate::ffi::proteus_rects_free(p, n) };
            // 几何段固定在 @192（末尾追加——既有偏移全不变）
            let mut f = [0f32; 4];
            for i in 0..4 {
                f[i] = f32::from_le_bytes([
                    sl[192 + i * 4], sl[193 + i * 4], sl[194 + i * 4], sl[195 + i * 4],
                ]);
            }
            f[3] // r
        };
        let r_half = read_r(h, 50.0);
        assert!((r_half - 0.7).abs() < 0.02, "半程 r 应 ≈0.7（0.4→1.0 的中点），实际 {r_half}");
        let r_end = read_r(h, 60.0);
        assert!((r_end - 1.0).abs() < 0.02, "终态 r 应 = 1.0（端点钉死），实际 {r_end}");
        unsafe { crate::ffi::proteus_layout_destroy(h) };
    }

    /// ★★渐变 v2 拒绝分支：缺 B 态 / 色标个数不一致 / 只在 B 态——都必须**明确拒绝**。
    #[test]
    fn gradient_mix_rejects_missing_or_mismatched_states() {
        use crate::ffi::proteus_layout_create;
        let mk = |a: bool, b: Option<&str>| -> u64 {
            let mut node = serde_json::json!({
                "id": 9, "parentId": 1, "width": 100.0, "height": 100.0,
            });
            if a {
                node["fillGradient"] = serde_json::json!({"kind": "linear", "angle": 90,
                    "stops": [{"offset": 0.0, "color": "#000000"}, {"offset": 1.0, "color": "#ffffff"}]});
            }
            if let Some(bj) = b {
                node["fillGradientTo"] = serde_json::from_str(bj).unwrap();
            }
            let req = serde_json::json!({
                "viewport": {"width": 100.0, "height": 100.0},
                "nodes": [{"id": 1, "width": 100.0, "height": 100.0}, node]
            });
            unsafe { proteus_layout_create(std::ffi::CString::new(req.to_string()).unwrap().as_ptr()) }
        };
        // 只在 B 态（无 A）⇒ 拒绝
        assert_eq!(mk(false, Some(r##"{"kind":"linear","angle":90,"stops":[{"offset":0.0,"color":"#000000"},{"offset":1.0,"color":"#ffffff"}]}"##)), 0);
        // 色标个数不一致（A 2 个 / B 3 个）⇒ 拒绝
        assert_eq!(mk(true, Some(r##"{"kind":"linear","angle":90,"stops":[{"offset":0.0,"color":"#000000"},{"offset":0.5,"color":"#888888"},{"offset":1.0,"color":"#ffffff"}]}"##)), 0);
        // kind 不一致（A linear / B radial）⇒ 拒绝
        assert_eq!(mk(true, Some(r##"{"kind":"radial","cx":0.5,"cy":0.5,"r":0.8,"stops":[{"offset":0.0,"color":"#000000"},{"offset":1.0,"color":"#ffffff"}]}"##)), 0);
        // 两态一致 ⇒ 成功
        assert!(mk(true, Some(r##"{"kind":"linear","angle":90,"stops":[{"offset":0.0,"color":"#ff0000"},{"offset":1.0,"color":"#0000ff"}]}"##)) > 0);
    }

    #[test]
    fn stroke_progress_writes_clamps_and_resets() {
        // ★C2（2026-10-01）：描边进度单槽——写入 clamp 到 0..1；stop 后回 0（未画）；
        //   无 svgPath 声明的节点上启动 ⇒ 明确拒绝（消息含原因与修法）。
        let mut t = tree_with(1);
        t.nodes[0].style.svg_path = Some(crate::svg_path::parse_svg_path("M0 0 L10 0").unwrap());
        let mut e = AnimEngine::new();
        let mut a = Anim::curve_anim(1, AnimKind::StrokeProgress, 0.0, 1.0, 100.0);
        a.takeover = false;
        e.start(&t, a).unwrap();
        let mut out = e.tick(&mut t, 200.0);
        out.updates.clear();
        assert!((t.nodes[0].style.stroke_progress - 1.0).abs() < 1e-4);
        e.stop_all(&mut t);
        assert_eq!(t.nodes[0].style.stroke_progress, 0.0, "stop 后描边进度回 0（未画）");
        // 拒绝：无 svgPath
        let plain = tree_with(1);
        let mut e2 = AnimEngine::new();
        let err = e2
            .start(&plain, Anim::curve_anim(1, AnimKind::StrokeProgress, 0.0, 1.0, 100.0))
            .expect_err("应拒绝");
        assert!(err.contains("没有 SVG 路径"), "err={err}");
        assert!(err.contains("svgPath"), "err={err}");
        // clamp：to = 2.0 写入后应被夹到 1.0
        let mut t3 = tree_with(1);
        t3.nodes[0].style.svg_path = Some(crate::svg_path::parse_svg_path("M0 0 L10 0").unwrap());
        let mut e3 = AnimEngine::new();
        let mut a3 = Anim::curve_anim(1, AnimKind::StrokeProgress, 1.0, 2.0, 100.0);
        a3.takeover = false;
        e3.start(&t3, a3).unwrap();
        e3.tick(&mut t3, 200.0);
        assert!(t3.nodes[0].style.stroke_progress <= 1.0, "写入必须 clamp 到 1.0");
    }

    /// ★★**静态声明基态**（2026-10-01 · 手卷浏览真机目视抓出）：`progress:1` 声明的路径
    ///   （浏览一幅已画成的画）**生来已画成**，且 `stop_all` 复位回**声明基态**而非 0——
    ///   缺省（未声明 progress）的节点行为不变（基态 0 = 未画，动画 0→1 照旧）。
    #[test]
    fn stroke_declared_base_survives_reset() {
        let mut t = tree_with(1);
        t.nodes[0].style.svg_path = Some(crate::svg_path::parse_svg_path("M0 0 L10 0").unwrap());
        t.nodes[0].style.stroke_progress = 1.0; // 建树时按 svgPath.progress 落（见 ffi 解析）
        t.nodes[0].style.stroke_progress_base = 1.0;
        let mut e = AnimEngine::new();
        // ① 驱动一条进度动画（1→0.5 之类）后 stop ⇒ 回 1（声明基态），**不是** 0
        let mut a = Anim::curve_anim(1, AnimKind::StrokeProgress, 1.0, 0.2, 100.0);
        a.takeover = false;
        e.start(&t, a).unwrap();
        e.tick(&mut t, 200.0);
        assert!(t.nodes[0].style.stroke_progress < 0.5, "动画应把进度压下去");
        e.stop_all(&mut t);
        assert_eq!(
            t.nodes[0].style.stroke_progress, 1.0,
            "stop 后必须回**声明基态**（静态已画成不被抹掉——缺省基态 0 的行为由上一个测试钉住）"
        );
        // ② 复位后不"脏"（基态自身不算偏离——否则每帧都被判脏，白白重发更新）
        let mut touched = std::collections::HashSet::new();
        let updates = AnimEngine::collect_updates(&mut t, &touched);
        touched.clear();
        assert!(updates.is_empty(), "基态自身不应产生更新");
    }

    #[test]
    fn clip_slot_mapping_and_display() {
        // 槽位映射（kind 15..30 → 0..15）与用户面显示名（"clip"——报错说用户语言）
        for (k, slot) in [
            (AnimKind::Clip0, 0usize),
            (AnimKind::Clip3, 3),
            (AnimKind::Clip15, 15),
        ] {
            assert_eq!(k.clip_slot(), Some(slot));
            assert!(k.is_clip());
            assert_eq!(k.display(), "clip");
        }
        assert_eq!(AnimKind::Scale.clip_slot(), None);
        assert!(!AnimKind::Scale.is_clip());
        assert!(!AnimKind::Clip0.is_composited(), "裁剪非合成（tick 路径）");
    }

    #[test]
    fn reset_visuals_clears_3d_rotation() {
        // ★真机 E4 抓出的真缺陷（2026-10-01）：3D 旋转字段漏进"清场"⇒ 残留让后续 seek 的
        //   层带 180° 翻转 ⇒ 探针读 tx 得 470（= 80 + 视口宽 390 的透视投影偏移）。
        let mut t = tree_with(1);
        t.nodes[0].style.rotate_y = 180.0;
        t.nodes[0].style.rotate_x = -90.0;
        let n = reset_visuals(&mut t, &[1]);
        assert_eq!(n, 1, "带 3D 残留的节点应被判脏并复位");
        assert_eq!(t.nodes[0].style.rotate_y, 0.0);
        assert_eq!(t.nodes[0].style.rotate_x, 0.0);
        // stop_all 同一条义务
        t.nodes[0].style.rotate_y = 45.0;
        let mut e = AnimEngine::new();
        let n2 = e.stop_all(&mut t);
        assert_eq!(n2, 1);
        assert_eq!(t.nodes[0].style.rotate_y, 0.0);
    }

    #[test]
    fn loop_phase_maps_rounds_and_finishes_exactly() {
        // 单遍（iterations=1）：旧语义不变——t ∈ [0,dur] 内 u=t/dur，至 dur 完成
        let (u, fin) = loop_phase(150.0, 0.0, 400.0, 1.0, false);
        assert!((u - 0.375).abs() < 1e-6 && !fin);
        let (_, fin) = loop_phase(400.0, 0.0, 400.0, 1.0, false);
        assert!(fin, "单遍到 dur 应完成");
        // n 遍：第 2 遍中段 u ≈ 0.5（3 遍 × 400ms；t=1000ms ⇒ 第 2.5 轮 = 第 2 遍中段 0.5）
        let (u, fin) = loop_phase(1000.0, 0.0, 400.0, 3.0, false);
        assert!((u - 0.5).abs() < 1e-6 && !fin, "3 遍中 t=1000 应落在第 3 轮... {u}");
        let (_, fin) = loop_phase(1200.0, 0.0, 400.0, 3.0, false);
        assert!(fin, "3 遍到 1200ms 应完成");
        // ★yoyo：第 2 轮反向（t=400..800 区间 u 从 1→0）
        let (u1, _) = loop_phase(500.0, 0.0, 400.0, -1.0, false); // 无限 normal 第 2 轮 u=0.25
        let (u2, _) = loop_phase(500.0, 0.0, 400.0, -1.0, true); // 无限 yoyo 第 2 轮 u=0.75
        assert!((u1 - 0.25).abs() < 1e-6 && (u2 - 0.75).abs() < 1e-6, "yoyo 第二遍应反向：{u1} vs {u2}");
        // 无限：永不 finished
        let (_, fin) = loop_phase(1_000_000.0, 0.0, 400.0, -1.0, true);
        assert!(!fin, "无限循环不应完成");
        // 延迟期：钉在起点
        let (u, fin) = loop_phase(50.0, 100.0, 400.0, 2.0, false);
        assert_eq!(u, 0.0);
        assert!(!fin);
    }

    #[test]
    fn repeat_anim_runs_to_end_and_yoyo_returns_home() {
        // 3 遍：t=1200 前不结束；到点精确落 to
        let mut a = Anim::curve_anim(1, AnimKind::TranslateY, 0.0, 100.0, 400.0);
        a.iterations = 3.0;
        // 推 1199ms：应未结束（值在最后一遍）
        let mut done = false;
        for _ in 0..1199 {
            let (x, _, d) = step(&mut a, 1.0);
            a.x = x;
            done = d;
        }
        assert!(!done, "3 遍未到 1200ms 不应结束");
        let (x, _, d) = step(&mut a, 1.0);
        assert!(d, "到 1200ms 应结束");
        assert_eq!(x, 100.0, "末轮终点钉死");
        // ★yoyo 2 遍：净位移 = 0（第 2 遍从 100 回 0）——呼吸的数学本质
        let mut b = Anim::curve_anim(1, AnimKind::TranslateY, 0.0, 100.0, 400.0);
        b.iterations = 2.0;
        b.alternate = true;
        let mut x = b.x;
        for _ in 0..400 {
            let (v, _, _) = step(&mut b, 1.0);
            b.x = v;
            x = v;
        }
        // 第 1 遍结束：x = 100（到 to）
        assert!((x - 100.0).abs() < 1e-3, "yoyo 第 1 遍应到 100，实得 {x}");
        for _ in 0..400 {
            let (v, _, _) = step(&mut b, 1.0);
            b.x = v;
            x = v;
        }
        assert!(x.abs() < 1e-3, "yoyo 第 2 遍应回到 0（净位移 0），实得 {x}");
    }

    #[test]
    fn custom_bezier_table_matches_live_eval_and_pins_endpoints() {
        // ★★自定义曲线转正（2026-10-01）：采样表必须与"现算贝塞尔"逐点一致（表只是加速，不是第二条数学）
        let c = [0.34f32, 1.56, 0.64, 1.0]; // "回弹"曲线（y 过冲 > 1）
        let t = bezier_table(c);
        for i in 0..TABLE_N {
            let u = i as f32 / (TABLE_N - 1) as f32;
            let live = bezier_eval((c[0], c[1], c[2], c[3]), u);
            assert!(
                (t.0[i] - live).abs() < 1e-5,
                "u={u}: 表 {} vs 现算 {live}",
                t.0[i]
            );
        }
        // 端点钉死（动画必须精确落在起止值上）
        assert_eq!(t.0[0], 0.0);
        assert_eq!(t.0[TABLE_N - 1], 1.0);
        // ★过冲存在（回弹曲线的灵魂：中途超过 1）——这也是"转正"要提供的能力
        assert!(t.0.iter().any(|&v| v > 1.05), "回弹曲线应有过冲（>1）");
        // ★缓存语义（2026-10-01 修：原断言 `Arc::ptr_eq` 在**并行测试**下偶发假红——
        //   多个测试并发取表时，两次 get 之间可能有其它线程做同样的插入 ⇒ 断言依赖了
        //   缓存实现的时序细节，而不是它承诺的语义。本仓纪律：测试断**语义**，不断实现细节）。
        //   真正的语义 = **同一控制点取到的表内容逐位相同**（缓存的目的：一致 + 省内存）。
        let t2 = bezier_table(c);
        for i in 0..TABLE_N {
            assert_eq!(t.0[i], t2.0[i], "同控制点两次取表：第 {i} 项应逐位一致");
        }
    }

    #[test]
    fn custom_bezier_drives_anim_value_and_overshoots() {
        // 端到端：curve_pts 提供时 value_at_progress 走自定义表（含过冲）
        let mut a = Anim::curve_anim(1, AnimKind::TranslateY, 0.0, 100.0, 400.0);
        a.curve_pts = Some(bezier_table([0.34, 1.56, 0.64, 1.0]));
        let v50 = a.value_at_progress(0.5);
        assert!(v50 > 100.0, "回弹曲线中点应过冲（>100），实际 {v50}");
        assert_eq!(a.value_at_progress(0.0), 0.0, "起点精确");
        assert_eq!(a.value_at_progress(1.0), 100.0, "终点钉死");
        // ★与自定义无关的旧行为不受影响：不给 curve_pts ⇒ 走内置（easeOut 中点 < 100）
        let b = Anim::curve_anim(1, AnimKind::TranslateY, 0.0, 100.0, 400.0);
        assert!(b.value_at_progress(0.5) < 100.0);
    }

    #[test]
    fn spring_curve_has_no_bezier_approx() {
        // ★诚实边界：阻尼振荡（非单调）没有贝塞尔近似 ⇒ 必须返回 None（不得硬套一个）
        assert!(curve_bezier_approx(CURVE_SPRING_APPROX).is_none());
        assert!(curve_bezier_approx(200).is_none(), "未知曲线同样返回 None");
    }

    #[test]
    fn reset_visuals_clears_all_five_fields() {
        let mut t = tree_with(1);
        let n = &mut t.nodes[0];
        n.style.translate_x = 10.0;
        n.style.translate_y = 20.0;
        n.style.scale = 0.5;
        n.style.rotate = 90.0;
        n.style.opacity = 0.3;
        assert_eq!(reset_visuals(&mut t, &[1]), 1);
        let s = &t.nodes[0].style;
        assert!(s.translate_x == 0.0 && s.translate_y == 0.0 && s.scale == 1.0 && s.rotate == 0.0 && s.opacity == 1.0);
        // 已干净的节点不计入（幂等）
        assert_eq!(reset_visuals(&mut t, &[1]), 0);
    }

    #[test]
    fn stop_nodes_on_ids_without_animations_is_zero_not_error() {
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        assert_eq!(e.stop_nodes(&mut t, &[99, 100]), 0, "无动画的 id 返回 0（不报错——回收常常成批调用）");
    }

    /* ────────────────────────── ★FLIP 布局动画（招牌能力） ────────────────────────── */

    fn tree_with_rects() -> LayoutTree {
        // 根(0,0,100x100) + 子(0,20,50x20)
        let mut t = LayoutTree::new();
        let mut root = LNode::new(1, LStyle::default());
        root.rect = Rect { x: 0.0, y: 0.0, width: 100.0, height: 100.0 };
        let ri = t.push(root);
        t.roots.push(ri);
        let mut child = LNode::new(2, LStyle::default());
        child.rect = Rect { x: 0.0, y: 20.0, width: 50.0, height: 20.0 };
        let ci = t.push(child);
        t.add_child(ri, ci);
        t
    }

    #[test]
    fn flip_start_without_capture_is_an_error() {
        let mut t = tree_with_rects();
        let mut e = AnimEngine::new();
        assert!(
            e.flip_start(&mut t, 300.0, CURVE_EASE_OUT_CUBIC, 0.0).is_err(),
            "未 capture 必须报错（不静默）"
        );
    }

    #[test]
    fn flip_animates_moved_node_from_old_position_to_new() {
        let mut t = tree_with_rects();
        let mut e = AnimEngine::new();
        assert_eq!(e.flip_capture(&t), 2, "快照应含根 + 子");
        // 布局变更：子节点下移到 y=50（Δ = 20 - 50 = -30）
        t.nodes[1].rect.y = 50.0;
        let out = e.flip_start(&mut t, 300.0, CURVE_EASE_OUT_CUBIC, 0.0).unwrap();
        assert_eq!(out.animated, 1, "只有子节点位移");
        // ★起点必须立即上报（否则首帧跳变——真机 F3c 抓出的缺陷）
        assert_eq!(out.updates.len(), 1, "FLIP 起点须回报受影响节点");
        assert!((out.updates[0].ty - (-30.0)).abs() < 0.01, "回报的 ty 应是初始偏移（实测 {}）", out.updates[0].ty);
        assert!((out.max_delta_px - 30.0).abs() < 0.01, "最大位移应为 30（实测 {}）", out.max_delta_px);
        // ① 立即写在旧位置（视觉无跳变）
        assert!(
            (t.nodes[1].style.translate_y - (-30.0)).abs() < 0.01,
            "应立即设为旧位置偏移（实测 {}）",
            t.nodes[1].style.translate_y
        );
        // ② tick 推进 → 归零
        e.tick(&mut t, 150.0);
        let mid = t.nodes[1].style.translate_y;
        assert!(mid > -30.0 && mid < 0.0, "中途应在 [-30, 0] 之间（实测 {mid}）");
        e.tick(&mut t, 200.0);
        assert_eq!(t.nodes[1].style.translate_y, 0.0, "终值必须精确归零");
    }

    #[test]
    fn flip_zero_stagger_has_no_tail_delay() {
        // ★回归（真机 F3d 抓出）：stagger=0 时**不得**产生级联延迟——否则 215 节点会排出长尾，
        //   探针/真实场景都会看到"最后一帧仍有节点没走完"的残留（真机实测 -0.43px）。
        let mut t = LayoutTree::new();
        let mut root = LNode::new(1, LStyle::default());
        root.rect = Rect { x: 0.0, y: 0.0, width: 100.0, height: 400.0 };
        let ri = t.push(root);
        t.roots.push(ri);
        for nid in 2u32..=5 {
            let mut n = LNode::new(nid, LStyle::default());
            n.rect = Rect { x: 0.0, y: (nid as f32) * 20.0, width: 50.0, height: 20.0 };
            let i = t.push(n);
            t.add_child(ri, i);
        }
        let mut e = AnimEngine::new();
        e.flip_capture(&t);
        for i in 1..t.nodes.len() {
            t.nodes[i].rect.y += 30.0; // 全部下移 30
        }
        let out = e.flip_start(&mut t, 100.0, CURVE_LINEAR, 0.0).unwrap();
        assert_eq!(out.animated, 4);
        // stagger=0 ⇒ 一次 tick 走满时长，**全部**归零（无长尾）
        e.tick(&mut t, 120.0);
        for nid in 2u32..=5 {
            let n = t.nodes.iter().find(|x| x.id == nid).unwrap();
            assert_eq!(n.style.translate_y, 0.0, "节点 {nid} 应归零（stagger=0 时无长尾延迟）");
        }
    }

    #[test]
    fn flip_stagger_delays_later_nodes() {
        // 两节点：变更后 y 各移 30；stagger 使第二项起延迟
        let mut t = LayoutTree::new();
        let mut root = LNode::new(1, LStyle::default());
        root.rect = Rect { x: 0.0, y: 0.0, width: 100.0, height: 200.0 };
        let ri = t.push(root);
        t.roots.push(ri);
        for (nid, y) in [(2u32, 0.0f32), (3, 40.0)] {
            let mut n = LNode::new(nid, LStyle::default());
            n.rect = Rect { x: 0.0, y, width: 50.0, height: 20.0 };
            let i = t.push(n);
            t.add_child(ri, i);
        }
        let mut e = AnimEngine::new();
        e.flip_capture(&t);
        t.nodes[1].rect.y = 30.0;
        t.nodes[2].rect.y = 70.0;
        let out = e.flip_start(&mut t, 100.0, CURVE_LINEAR, 50.0).unwrap();
        assert_eq!(out.animated, 2);
        // ★算术提示：第二项 delay = 50ms ⇒ tick(40) 时它**仍在延迟期**
        //   （首版写 tick(60) ⇒ 已越过其延迟 ⇒ 它会动 —— 是**测试算术错**）
        e.tick(&mut t, 40.0);
        let a = t.nodes[1].style.translate_y;
        let b = t.nodes[2].style.translate_y;
        assert!(a > -30.0, "第一项应已推进（实测 {a}）");
        assert_eq!(b, -30.0, "第二项延迟期（40ms < 50ms）应钉在起点（实测 {b}）");
        // 再推进一步：第二项进入延迟后阶段，开始移动
        e.tick(&mut t, 40.0);
        let b2 = t.nodes[2].style.translate_y;
        assert!(b2 > -30.0, "越过延迟后第二项应开始移动（实测 {b2}）");
    }

    #[test]
    fn flip_reports_visuals_via_updates() {
        // 判据 E 组要用：FLIP 之后 tick 必须回报受影响节点（否则宿主不刷层 ⇒ 屏幕不动）
        let mut t = tree_with_rects();
        let mut e = AnimEngine::new();
        e.flip_capture(&t);
        t.nodes[1].rect.y = 60.0;
        e.flip_start(&mut t, 100.0, CURVE_LINEAR, 0.0).unwrap();
        let o = e.tick(&mut t, 10.0);
        let v = find_visual(&o.updates, 2).expect("FLIP 节点的 update 必须被回报");
        assert!(v.ty > -40.0 && v.ty < 0.0, "回报的 ty 应在补间中（实测 {}）", v.ty);
    }

    /* ──────────────────── ★★跨属性共享时间轴（tick 同步性） ──────────────────── */

    #[test]
    fn cross_property_tracks_advance_in_lockstep() {
        // ★能力判据（此前的文档把它记为"未做/评估中"——先取证）：`tick` 对**所有**动画用同一个
        //   `dt` 推进各自的 `t_ms` ⇒ 只要两条动画的 `dur_ms` 相同，它们的时间推进**严格同步**。
        //   本测试要证明的正是这一点：不同段划分的两条轨道，在任意时刻都处于"同一个绝对时间点"。
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        // 轨道 A：100ms 到 100，再 100ms 回 0（总 200）
        let mut a = anim(1, AnimKind::TranslateX);
        a.from = 0.0;
        a.to = 0.0;
        a.dur_ms = 200.0;
        a.mode = AnimMode::Keyframes(vec![
            KeySeg { to: 100.0, dur_ms: 100.0, curve: CURVE_LINEAR },
            KeySeg { to: 0.0, dur_ms: 100.0, curve: CURVE_LINEAR },
        ]);
        // 轨道 B：50ms 到 0.5，再 150ms 回 1.0（总 200；**段划分与 A 完全不同**）
        let mut b = anim(1, AnimKind::Scale);
        b.from = 1.0;
        b.to = 1.0;
        b.dur_ms = 200.0;
        b.mode = AnimMode::Keyframes(vec![
            KeySeg { to: 0.5, dur_ms: 50.0, curve: CURVE_LINEAR },
            KeySeg { to: 1.0, dur_ms: 150.0, curve: CURVE_LINEAR },
        ]);
        e.start(&t, a).unwrap();
        e.start(&t, b).unwrap();
        // t=100ms：A 恰在首段终点（100）；B 处于次段 1/3（0.5 + 0.5×50/150 ≈ 0.6667）
        e.tick(&mut t, 100.0);
        assert!((t.nodes[0].style.translate_x - 100.0).abs() < 1e-3, "A 应在首段终点（实测 {}）", t.nodes[0].style.translate_x);
        let b_at_100 = t.nodes[0].style.scale;
        assert!((b_at_100 - 0.6667).abs() < 5e-3, "B 应在次段 1/3 处（实测 {b_at_100}）");
        // 再推 50ms（t=150）：A 处于次段 1/2（50）；B 处于次段 2/3（0.5+0.5×2/3 ≈ 0.8333）
        e.tick(&mut t, 50.0);
        assert!((t.nodes[0].style.translate_x - 50.0).abs() < 1e-3, "A 次段半程（实测 {}）", t.nodes[0].style.translate_x);
        let b_at_150 = t.nodes[0].style.scale;
        assert!((b_at_150 - 0.8333).abs() < 5e-3, "B 次段 2/3 处（实测 {b_at_150}）");
        // t=200：两条同时结束（同一时间轴 ⇒ **同刻完成**）
        let o = e.tick(&mut t, 50.0);
        assert_eq!(o.finished, 2, "两条轨道必须**同刻**结束（实测 finished={}）", o.finished);
    }

    #[test]
    fn cross_property_lockstep_is_independent_of_tick_granularity() {
        // 同步性的另一种破坏方式：不同帧率下两条轨道被**分别**推进 ⇒ 相位错开。
        //   `tick` 单次调用内对所有动画循环 ⇒ 结构上不可能错开；本测试把它钉死。
        let mk = || {
            let mut a = anim(1, AnimKind::TranslateX);
            a.from = 0.0; a.to = 0.0; a.dur_ms = 200.0;
            a.mode = AnimMode::Keyframes(vec![KeySeg { to: 100.0, dur_ms: 100.0, curve: CURVE_LINEAR }, KeySeg { to: 0.0, dur_ms: 100.0, curve: CURVE_LINEAR }]);
            let mut b = anim(1, AnimKind::Scale);
            b.from = 1.0; b.to = 1.0; b.dur_ms = 200.0;
            b.mode = AnimMode::Keyframes(vec![KeySeg { to: 0.5, dur_ms: 50.0, curve: CURVE_LINEAR }, KeySeg { to: 1.0, dur_ms: 150.0, curve: CURVE_LINEAR }]);
            (a, b)
        };
        // ① 一次 tick(160)
        let (mut t1, mut e1) = (tree_with(1), AnimEngine::new());
        let (a1, b1) = mk();
        e1.start(&t1, a1).unwrap();
        e1.start(&t1, b1).unwrap();
        e1.tick(&mut t1, 160.0);
        // ② 32 次 tick(5)
        let (mut t2, mut e2) = (tree_with(1), AnimEngine::new());
        let (a2, b2) = mk();
        e2.start(&t2, a2).unwrap();
        e2.start(&t2, b2).unwrap();
        for _ in 0..32 {
            e2.tick(&mut t2, 5.0);
        }
        let (x1, s1) = (t1.nodes[0].style.translate_x, t1.nodes[0].style.scale);
        let (x2, s2) = (t2.nodes[0].style.translate_x, t2.nodes[0].style.scale);
        assert!((x1 - x2).abs() < 1e-4, "A 轨道与帧率无关（{x1} vs {x2}）");
        assert!((s1 - s2).abs() < 1e-4, "B 轨道与帧率无关（{s1} vs {s2}）");
        // ★同一时间点的**绝对值**才是判据（首版写"两轨道相位比例应一致"——**算式错了**：
        //   两轨道的**段划分不同**（A: 100+100，B: 50+150）⇒ 同一时刻的局部进度本就不同，
        //   拿它们的比例对照是在断言一件错的事。判据要落在"同刻的值"，不是"结构不同的两个量的比"。
        //   t=160：A 处于次段 60/100 ⇒ x = 100 − 100×0.6 = 40；B 处于次段 110/150 ⇒ s = 0.5 + 0.5×110/150 ≈ 0.8667
        assert!((x1 - 40.0).abs() < 1e-3, "A 在 t=160 应为 40（实测 {x1}）");
        assert!((s1 - 0.8667).abs() < 5e-3, "B 在 t=160 应 ≈0.8667（实测 {s1}）");
    }

    /* ──────────────────── ★★共享元素（几何原语） ──────────────────── */

    /// 造"已知几何"的树：根在 (0,0)，大小 200×200；子节点（相对）在 (40,60)，大小 80×40
    ///   ⇒ 子节点**绝对**矩形 = (40,60,80,40)
    fn tree_with_known_rects() -> LayoutTree {
        let mut t = LayoutTree::new();
        let mut root = LNode::new(1, LStyle::default());
        root.rect = Rect { x: 0.0, y: 0.0, width: 200.0, height: 200.0 };
        let ri = t.push(root);
        t.roots.push(ri);
        let mut child = LNode::new(2, LStyle::default());
        child.rect = Rect { x: 40.0, y: 60.0, width: 80.0, height: 40.0 };
        let ci = t.push(child);
        t.add_child(ri, ci);
        t
    }

    #[test]
    fn shared_element_plan_computes_center_delta_and_width_ratio() {
        // 源：屏幕坐标 (100,300) 起、40×40 的缩略图；目标：绝对 (40,60) 的 80×40
        let source = Rect { x: 100.0, y: 300.0, width: 40.0, height: 40.0 };
        let target = Rect { x: 40.0, y: 60.0, width: 80.0, height: 40.0 };
        let p = shared_element_plan(source, target).unwrap();
        // dx = 源中心 120 − 目标中心 80 = +40；dy = 320 − 80 = +240
        assert!((p.dx - 40.0).abs() < 1e-4, "dx 应为 +40（实测 {}）", p.dx);
        assert!((p.dy - 240.0).abs() < 1e-4, "dy 应为 +240（实测 {}）", p.dy);
        assert!((p.scale - 0.5).abs() < 1e-4, "scale 应为 40/80=0.5（实测 {}）", p.scale);
    }

    #[test]
    fn shared_element_plan_rejects_unmeasurable_and_nonfinite() {
        let ok = Rect { x: 0.0, y: 0.0, width: 50.0, height: 50.0 };
        // 目标未布局（0 尺寸）⇒ 明确拒绝（静默会变成"元素不动"难查）
        let zero = Rect { x: 0.0, y: 0.0, width: 0.0, height: 0.0 };
        assert!(shared_element_plan(ok, zero).is_err(), "零尺寸目标必须报错");
        // 非有限值 ⇒ 拒绝（比较恒 false 会造成静默错位）
        let bad = Rect { x: f32::NAN, y: 0.0, width: 50.0, height: 50.0 };
        assert!(shared_element_plan(bad, ok).is_err(), "NaN 源必须报错");
        // 零宽源 ⇒ 缩放系数无意义 ⇒ 拒绝
        let zero_w = Rect { x: 0.0, y: 0.0, width: 0.0, height: 50.0 };
        assert!(shared_element_plan(zero_w, ok).is_err(), "零宽源必须报错");
    }

    #[test]
    fn shared_element_starts_at_source_and_lands_identity() {
        // ★两件事必须同时成立：① 首帧就在**源矩形**（不跳变）② 终态**精确归位**（identity）
        let mut t = tree_with_known_rects();
        let mut e = AnimEngine::new();
        let source = Rect { x: 100.0, y: 300.0, width: 40.0, height: 40.0 };
        let (plan, first) = e
            .start_shared_element(&mut t, 2, source, 200.0, CURVE_LINEAR, true)
            .unwrap();
        // ① 首帧：updates 里就该有该节点，且值 = 起点（节点 2 是 index 1）
        let v0 = find_visual(&first.updates, 2).expect("首帧必须回报起点（宿主当帧上屏）");
        assert!((v0.tx - plan.dx).abs() < 1e-4, "首帧 tx 应为 dx={}（实测 {}）", plan.dx, v0.tx);
        assert!((v0.ty - plan.dy).abs() < 1e-4, "首帧 ty 应为 dy={}（实测 {}）", plan.dy, v0.ty);
        assert!((v0.scale - plan.scale).abs() < 1e-4, "首帧 scale 应为 {}", plan.scale);
        assert_eq!(v0.opacity, 0.0, "fade_in ⇒ 首帧透明度 0");
        // ② 终态：走完 ⇒ 精确归位（translate 0 / scale 1 / opacity 1）
        let o = e.tick(&mut t, 250.0);
        assert!(o.finished >= 4, "四条动画（tx/ty/scale/opacity）都应结束（实测 {}）", o.finished);
        let st = &t.nodes[1].style;
        assert_eq!(st.translate_x, 0.0, "终态 tx 必须精确为 0");
        assert_eq!(st.translate_y, 0.0, "终态 ty 必须精确为 0");
        assert_eq!(st.scale, 1.0, "终态 scale 必须精确为 1");
        assert_eq!(st.opacity, 1.0, "终态 opacity 必须精确为 1");
    }

    #[test]
    fn shared_element_does_not_take_over_previous_animation() {
        // ★硬重启：起点是**算出来的几何**，不是上一条动画的当前值
        //   （若走接管，起点被覆盖 ⇒ 视觉上不落在源矩形——静默错位）
        let mut t = tree_with_known_rects();
        let mut e = AnimEngine::new();
        // 先在目标节点上跑一条 translateX（到中途）
        e.start(&t, anim(2, AnimKind::TranslateX)).unwrap();
        e.tick(&mut t, 50.0);
        let mid = t.nodes[1].style.translate_x;
        assert!(mid > 0.0 && mid < 100.0, "前置条件：应处于中途（实测 {mid}）");
        let source = Rect { x: 10.0, y: 20.0, width: 160.0, height: 160.0 };
        let (plan, _) = e
            .start_shared_element(&mut t, 2, source, 150.0, CURVE_LINEAR, false)
            .unwrap();
        assert_eq!(t.nodes[1].style.translate_x, plan.dx, "起点必须等于算出的 dx（不是中途值 {mid}）");
    }

    #[test]
    fn shared_element_from_node_uses_same_ruler_as_flip() {
        // ★幂等自证：**目标自己作为源** ⇒ 恒等（dx=dy=0、scale=1）——
        //   这同时证明"节点绝对几何"与 FLIP 用的是**同一把尺子**（否则会有半像素偏差）
        let mut t = tree_with_known_rects();
        let r = node_abs_rect(&t, 2).expect("节点 2 应有绝对几何");
        assert!((r.x - 40.0).abs() < 1.0 && (r.width - 80.0).abs() < 1.0, "绝对矩形应 ≈(40,60,80,40)（实测 {r:?}）");
        let mut e = AnimEngine::new();
        let (plan, _) = e.start_shared_element(&mut t, 2, r, 100.0, CURVE_LINEAR, false).unwrap();
        assert!(plan.dx.abs() < 0.01 && plan.dy.abs() < 0.01, "自反 ✓ dx/dy 应为 0（实测 {} {}）", plan.dx, plan.dy);
        assert!((plan.scale - 1.0).abs() < 0.01, "自反 ✓ scale 应为 1（实测 {}）", plan.scale);
    }

    /* ──────────────────── ★★MA6：序列编排（AnimMode::Keyframes） ──────────────────── */

    /// 造一条序列动画：`[(to, durms, curve), …]`（线性便于算术断言）
    fn seq_anim(node_id: u32, from: f32, segs: &[(f32, f32)]) -> Anim {
        let mut a = anim(node_id, AnimKind::Scale);
        a.from = from;
        a.to = segs.last().map(|s| s.0).unwrap_or(from);
        a.dur_ms = segs.iter().map(|s| s.1).sum();
        a.mode = AnimMode::Keyframes(
            segs.iter().map(|&(to, d)| KeySeg { to, dur_ms: d, curve: CURVE_LINEAR }).collect(),
        );
        a
    }

    #[test]
    fn keyframes_hits_each_segment_endpoint_in_order() {
        // 序列：100ms 到 0.9，再 100ms 回 1.0（"下压 → 回弹"）
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        let a = seq_anim(1, 1.0, &[(0.9, 100.0), (1.0, 100.0)]);
        e.start(&t, a).unwrap();
        // 50ms：段内（线性半程 ⇒ 0.95）
        e.tick(&mut t, 50.0);
        assert!((t.nodes[0].style.scale - 0.95).abs() < 1e-3, "首段半程应 ≈0.95（实测 {}）", t.nodes[0].style.scale);
        // 100ms：**首段终点**（精确 = 0.9）
        e.tick(&mut t, 50.0);
        assert!((t.nodes[0].style.scale - 0.9).abs() < 1e-4, "首段终点须精确到 0.9（实测 {}）", t.nodes[0].style.scale);
        // 150ms：次段半程（0.9 → 1.0 的中间 ≈ 0.95）
        e.tick(&mut t, 50.0);
        assert!((t.nodes[0].style.scale - 0.95).abs() < 1e-3, "次段半程应 ≈0.95（实测 {}）", t.nodes[0].style.scale);
        // 200ms：终点（精确 = 1.0）+ 动画结束
        let o = e.tick(&mut t, 50.0);
        assert_eq!(o.finished, 1, "序列走完必须结束（否则永占活动集）");
        assert!((t.nodes[0].style.scale - 1.0).abs() < 1e-4, "终值须精确到 1.0");
    }

    #[test]
    fn keyframes_value_is_independent_of_tick_granularity() {
        // ★帧率无关：同样 200ms，拆成 1×200 与 40×5 必须得到**同一个值**（曲线求值按时间，不按帧）
        let mk = || seq_anim(1, 1.0, &[(0.5, 100.0), (1.0, 100.0)]);
        let (mut t1, mut e1) = (tree_with(1), AnimEngine::new());
        e1.start(&t1, mk()).unwrap();
        e1.tick(&mut t1, 130.0);
        let (mut t2, mut e2) = (tree_with(1), AnimEngine::new());
        e2.start(&t2, mk()).unwrap();
        for _ in 0..26 {
            e2.tick(&mut t2, 5.0);
        }
        assert!(
            (t1.nodes[0].style.scale - t2.nodes[0].style.scale).abs() < 1e-4,
            "粒度不同但时间相同 ⇒ 值必须一致（1×130 = {} vs 26×5 = {}）",
            t1.nodes[0].style.scale,
            t2.nodes[0].style.scale
        );
    }

    #[test]
    fn keyframes_seek_and_scroll_use_same_evaluation() {
        // ★统一求值入口：seek（手势）与滚动联动对同一条序列**同进度同值**（否则是静默分叉）
        let mut t = tree_with(2);
        let mut e = AnimEngine::new();
        let seq = seq_anim(1, 1.0, &[(0.5, 100.0), (1.2, 300.0)]);
        e.start(&t, seq.clone()).unwrap();
        e.seek(&mut t, 1, AnimKind::Scale, 0.5);
        let via_seek = t.nodes[0].style.scale;
        let mut scrollable = seq;
        scrollable.node_id = 2;
        scrollable.scroll_from = 0.0;
        scrollable.scroll_to = 100.0;
        e.start_scroll(&t, scrollable).unwrap();
        e.seek_scroll(&mut t, 50.0); // 进度 0.5
        let via_scroll = t.nodes[1].style.scale;
        assert!(
            (via_seek - via_scroll).abs() < 1e-5,
            "同进度必须同值（seek={via_seek} scroll={via_scroll}）"
        );
        // 进度 0.5 = 时间 200ms 落在次段（0..100 首段，100..400 次段）：u=(200-100)/300=1/3
        //   线性 ⇒ 0.5 + (1.2-0.5)/3 ≈ 0.7333
        assert!((via_seek - 0.7333).abs() < 5e-3, "分段定位应落在次段三分之一处（实测 {via_seek}）");
    }

    #[test]
    fn keyframes_takeover_does_not_remap_anchors() {
        // ★接管不重映射：序列的 from/to 是**编排好的两端**；重映射会让"下压→回弹"错形
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        // 先跑一条时间动画到中途（scale=1.0 → 0.6 的中途）
        let mut pre = anim(1, AnimKind::Scale);
        pre.from = 1.0;
        pre.to = 0.6;
        pre.dur_ms = 100.0;
        e.start(&t, pre).unwrap();
        e.tick(&mut t, 50.0);
        let mid = t.nodes[0].style.scale;
        assert!(mid < 1.0 && mid > 0.6, "前置条件：应处于中途（实测 {mid}）");
        // 接管启动序列（from=1.0）：位置连续（从 mid 出发**不跳变**）但锚点仍是 1.0→0.9→1.0
        e.start(&t, seq_anim(1, 1.0, &[(0.9, 100.0), (1.0, 100.0)])).unwrap();
        let after = t.nodes[0].style.scale;
        assert!((after - mid).abs() < 1e-5, "接管当帧位置必须连续（{} vs {}）", after, mid);
        e.tick(&mut t, 100.0);
        assert!((t.nodes[0].style.scale - 0.9).abs() < 1e-3, "锚点未被重映射（首段仍到 0.9，实测 {}）", t.nodes[0].style.scale);
    }

    #[test]
    fn keyframes_empty_and_bad_segments_are_rejected() {
        let t = tree_with(1);
        let mut e = AnimEngine::new();
        let mut empty = anim(1, AnimKind::Scale);
        empty.mode = AnimMode::Keyframes(Vec::new());
        assert!(e.start(&t, empty).is_err(), "空序列必须报错（不静默）");
        let mut bad_curve = anim(1, AnimKind::Scale);
        bad_curve.mode = AnimMode::Keyframes(vec![KeySeg { to: 1.0, dur_ms: 100.0, curve: 200 }]);
        assert!(e.start(&t, bad_curve).is_err(), "段曲线越界必须报错");
        let mut neg = anim(1, AnimKind::Scale);
        neg.mode = AnimMode::Keyframes(vec![KeySeg { to: 1.0, dur_ms: -5.0, curve: 0 }]);
        assert!(e.start(&t, neg).is_err(), "负时长必须报错");
    }

    #[test]
    fn keyframes_zero_total_duration_pins_endpoint() {
        // 全零时长（退化）⇒ 立刻落在末段终点，**不得**出 NaN / 除零
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        let a = seq_anim(1, 1.0, &[(0.8, 0.0), (0.95, 0.0)]);
        e.start(&t, a).unwrap();
        let o = e.tick(&mut t, 16.7);
        assert_eq!(o.finished, 1, "零时长序列应立刻结束");
        let v = t.nodes[0].style.scale;
        assert!(v.is_finite() && (v - 0.95).abs() < 1e-4, "应精确落在末段 to（实测 {v}）");
    }

    /* ────────────────────── ★★MA5：滚动联动（seek_scroll） ────────────────────── */

    /// 造一条"滚动窗口动画"：窗口 [from, to]，值 0 → 100，线性曲线（便于算术断言）
    fn scroll_anim(node_id: u32, sf: f32, st: f32) -> Anim {
        let mut a = anim(node_id, AnimKind::TranslateY);
        a.curve = CURVE_LINEAR;
        a.scroll_from = sf;
        a.scroll_to = st;
        a
    }

    #[test]
    fn seek_scroll_maps_position_to_progress_and_value() {
        // 窗口 [100, 200]：滚动 100 → 0；150 → 50（半程）；200 → 100
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start_scroll(&t, scroll_anim(1, 100.0, 200.0)).unwrap();
        e.seek_scroll(&mut t, 100.0);
        assert_eq!(t.nodes[0].style.translate_y, 0.0, "窗口起点 ⇒ from");
        e.seek_scroll(&mut t, 150.0);
        assert!((t.nodes[0].style.translate_y - 50.0).abs() < 0.6, "半程 ⇒ 中值附近");
        e.seek_scroll(&mut t, 200.0);
        assert!((t.nodes[0].style.translate_y - 100.0).abs() < 1e-4, "窗口终点 ⇒ to（精确）");
    }

    #[test]
    fn seek_scroll_clamps_outside_window() {
        // 窗口外必须**钳制**（不是外推——否则视差会飞出屏幕）
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start_scroll(&t, scroll_anim(1, 100.0, 200.0)).unwrap();
        e.seek_scroll(&mut t, 0.0);
        assert_eq!(t.nodes[0].style.translate_y, 0.0, "未到窗口 ⇒ 钉在起点");
        e.seek_scroll(&mut t, 9999.0);
        assert!((t.nodes[0].style.translate_y - 100.0).abs() < 1e-4, "滑过窗口 ⇒ 钉在终点");
    }

    #[test]
    fn seek_scroll_degenerate_window_is_one_not_divide_by_zero() {
        // 退化窗口（to <= from）⇒ 进度恒 1（"已滑过"），**不得**产生 NaN/Inf
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start_scroll(&t, scroll_anim(1, 100.0, 100.0)).unwrap();
        e.seek_scroll(&mut t, 100.0);
        let v = t.nodes[0].style.translate_y;
        assert!(v.is_finite(), "退化窗口不得产生非有限值（实测 {v}）");
        // ★语义说明：退化窗口在 seek_scroll 里被跳过（不算"滚动动画"）——故值保持在起点。
        //   本判据钉的是"不出 NaN/Inf"，不是"等于 to"。
        assert_eq!(v, 0.0);
    }

    #[test]
    fn seek_scroll_ignores_time_and_progress_anims() {
        // 不带窗口的动画（时间驱动 / 手势驱动）**不受滚动影响**——滚动是独立通道
        let mut t = tree_with(2);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateX)).unwrap(); // 时间驱动（无窗口）
        let mut p = anim(2, AnimKind::Scale);
        p.drive = AnimDrive::Progress;
        p.progress = 0.5;
        e.start(&t, p).unwrap();
        let before_tx = t.nodes[0].style.translate_x;
        let before_sc = t.nodes[1].style.scale;
        e.seek_scroll(&mut t, 5000.0);
        assert_eq!(t.nodes[0].style.translate_x, before_tx, "时间动画不被滚动改动");
        assert_eq!(t.nodes[1].style.scale, before_sc, "无窗口的手势动画不被滚动改动");
    }

    #[test]
    fn seek_scroll_drives_multiple_nodes_in_one_call() {
        // ★一次滚动回调驱动**全部**窗口动画（视差层 + 吸顶 + 渐显混在一起）
        let mut t = tree_with(3);
        let mut e = AnimEngine::new();
        let mut head = scroll_anim(1, 0.0, 100.0);
        head.kind = AnimKind::TranslateY;
        let mut bg = scroll_anim(2, 0.0, 100.0);
        bg.to = -50.0; // 反向视差
        let mut fade = scroll_anim(3, 0.0, 100.0);
        fade.kind = AnimKind::Opacity;
        fade.from = 1.0; // ★算术必须自洽：渐显是 1 → 0（首版写了 0 → 0，被断言当场挡下）
        fade.to = 0.0;
        e.start_scroll(&t, head).unwrap();
        e.start_scroll(&t, bg).unwrap();
        e.start_scroll(&t, fade).unwrap();
        let o = e.seek_scroll(&mut t, 50.0);
        assert_eq!(o.changed, 3, "三个节点的字段都应变值");
        assert_eq!(o.updates.len(), 3, "updates 必须回报全部受影响节点（宿主一次刷完）");
        assert!((t.nodes[1].style.translate_y - (-25.0)).abs() < 0.5, "反向视差半程 ≈ -25");
        assert!((t.nodes[2].style.opacity - 0.5).abs() < 0.01, "渐显半程 ≈ 0.5");
    }

    #[test]
    fn seek_scroll_respects_curve() {
        // 曲线仍由内核求值：easeOut 在 50% 处应 **> 50%**（减速曲线的特征）
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        let mut a = scroll_anim(1, 0.0, 100.0);
        a.curve = CURVE_EASE_OUT_CUBIC;
        e.start_scroll(&t, a).unwrap();
        e.seek_scroll(&mut t, 50.0);
        let v = t.nodes[0].style.translate_y;
        assert!(v > 50.0, "easeOut 半程应快于线性（实测 {v}）");
        assert!(v < 100.0);
    }

    #[test]
    fn seek_scroll_after_stop_does_nothing() {
        // 解绑后滚动不得再动该节点（与 §7.3 同一红线——回收节点不能残留滚动绑定）
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start_scroll(&t, scroll_anim(1, 0.0, 100.0)).unwrap();
        e.seek_scroll(&mut t, 50.0);
        let stopped = e.stop_nodes(&mut t, &[1]);
        assert_eq!(stopped, 1);
        let after_stop = t.nodes[0].style.translate_y;
        e.seek_scroll(&mut t, 100.0);
        assert_eq!(t.nodes[0].style.translate_y, after_stop, "解绑后滚动不得再写值");
    }

    #[test]
    fn start_scroll_does_not_inherit_previous_value_into_range() {
        // ★回归（本轮新写的设计决策）：滚动驱动**不接管**——窗口映射必须以**声明的 from** 为起点。
        //   若走接管语义（from=上一条动画的当前值），上一条动画中途切换时映射会静默偏移。
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateY)).unwrap(); // 时间动画 0 → 100
        e.tick(&mut t, 50.0);
        let mid = t.nodes[0].style.translate_y;
        assert!(mid > 0.0 && mid < 100.0, "前置条件：时间动画应处于中途（实测 {mid}）");
        // 同 (节点,属性) 上启动滚动动画：映射起点必须是声明的 from=0
        e.start_scroll(&t, scroll_anim(1, 200.0, 300.0)).unwrap();
        e.seek_scroll(&mut t, 200.0);
        assert_eq!(
            t.nodes[0].style.translate_y, 0.0,
            "滚动窗口起点必须映射到声明的 from=0（接管语义会让它变成上一动画的中途值 {mid}）"
        );
        e.seek_scroll(&mut t, 300.0);
        assert!((t.nodes[0].style.translate_y - 100.0).abs() < 1e-4, "窗口终点映射到声明的 to=100");
    }

    // ★★★S3-T1（2026-10-10）：跟手原语——指针位移 → 节点平移（内核算换算，宿主零数学）
    #[test]
    fn follow_translate_maps_pointer_delta_with_axis_mask_and_clamp() {
        let mut t = tree_with(1);
        // X 轴：dx=50 ⇒ translate_x=50
        assert!(follow_translate(&mut t, 1, 50.0, 99.0, 1, 1.0, -1e9, 1e9));
        assert!((t.nodes[0].style.translate_x - 50.0).abs() < 1e-4);
        assert_eq!(t.nodes[0].style.translate_y, 0.0, "axis_mask=1 ⇒ 不动 Y");
        // 夹取：dx=500 clamp 到 max=200
        follow_translate(&mut t, 1, 500.0, 0.0, 1, 1.0, -200.0, 200.0);
        assert!((t.nodes[0].style.translate_x - 200.0).abs() < 1e-4, "clamp 到 max");
        // 双向：mask=3 + gain=0.5
        follow_translate(&mut t, 1, 100.0, -40.0, 3, 0.5, -1e9, 1e9);
        assert!((t.nodes[0].style.translate_x - 50.0).abs() < 1e-4);
        assert!((t.nodes[0].style.translate_y - (-20.0)).abs() < 1e-4);
        // 无变化 ⇒ 返回 false（值同 ⇒ 不重绘）
        assert!(!follow_translate(&mut t, 1, 100.0, -40.0, 3, 0.5, -1e9, 1e9), "同值 ⇒ false");
        // 未知节点 ⇒ false（不 panic）
        assert!(!follow_translate(&mut t, 999, 10.0, 0.0, 1, 1.0, -1e9, 1e9));
    }

    // ★★★S3-T2（2026-10-10）：松手回弹/吸附——按位移判「归零」或「滑出吸附」，弹簧接管
    #[test]
    fn follow_release_snaps_past_threshold_else_returns_to_zero() {
        // 小位移（< 阈值）⇒ 回弹到 0
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        follow_translate(&mut t, 1, 30.0, 0.0, 1, 1.0, -1e9, 1e9);
        let targets = follow_release(&mut e, &t, 1, 1, 300.0, 30.0, 1.0, 80.0, 200.0);
        assert_eq!(targets, vec![0.0], "30 < 阈值 80 ⇒ 回弹归零");
        // 由弹簧推进若干步 ⇒ 值向 0 收敛（不回弹到别处）
        for _ in 0..240 { e.tick(&mut t, 16.7); }
        assert!(t.nodes[0].style.translate_x.abs() < 1.0, "回弹后停在 ≈0（实际 {}）", t.nodes[0].style.translate_x);

        // 大位移（≥ 阈值）⇒ 滑出吸附（`target` 是幅度，方向随拖拽方向：正方向 → +target）
        let mut t2 = tree_with(1);
        let mut e2 = AnimEngine::new();
        follow_translate(&mut t2, 1, 150.0, 0.0, 1, 1.0, -1e9, 1e9);
        let targets2 = follow_release(&mut e2, &t2, 1, 1, 300.0, 30.0, 1.0, 80.0, 200.0);
        assert_eq!(targets2, vec![200.0], "150 ≥ 阈值 ⇒ 滑出吸附到 +200");
        for _ in 0..240 { e2.tick(&mut t2, 16.7); }
        assert!((t2.nodes[0].style.translate_x - 200.0).abs() < 1.0, "弹簧推到吸附目标（实际 {}）", t2.nodes[0].style.translate_x);

        // 负方向 ⇒ 吸附到 -target（方向随拖拽：左滑滑出左侧）
        let mut t3 = tree_with(1);
        let mut e3 = AnimEngine::new();
        follow_translate(&mut t3, 1, -150.0, 0.0, 1, 1.0, -1e9, 1e9);
        assert_eq!(follow_release(&mut e3, &t3, 1, 1, 300.0, 30.0, 1.0, 80.0, 200.0), vec![-200.0]);

        // 未知节点 ⇒ 空（不 panic）
        let mut t4 = tree_with(1);
        let mut e4 = AnimEngine::new();
        assert!(follow_release(&mut e4, &t4, 999, 1, 300.0, 30.0, 1.0, 80.0, 200.0).is_empty());
    }

    // ★★★S3-T3（2026-10-10）：批量跟手——一帧 M 指一次调用，逐条算平移，返回真变值的节点集
    #[test]
    fn follow_translate_batch_touches_multiple_nodes_in_one_call() {
        let mut t = tree_with(3);
        let entries = [
            FollowEntry { node_id: 1, gain: 1.0, dx: 30.0, dy: 0.0, min: -1e9, max: 1e9, axis: 1.0 },
            FollowEntry { node_id: 2, gain: 1.0, dx: 0.0, dy: -40.0, min: -1e9, max: 1e9, axis: 2.0 },
            // 越界夹取：dx=500 clamp 到 max=100
            FollowEntry { node_id: 3, gain: 1.0, dx: 500.0, dy: 0.0, min: -100.0, max: 100.0, axis: 1.0 },
        ];
        let touched = follow_translate_batch(&mut t, &entries);
        assert_eq!(touched.len(), 3, "三指各自变值 ⇒ 三个节点");
        assert!((t.nodes[0].style.translate_x - 30.0).abs() < 1e-4);
        assert!((t.nodes[1].style.translate_y - (-40.0)).abs() < 1e-4);
        assert!((t.nodes[2].style.translate_x - 100.0).abs() < 1e-4, "clamp 到 max=100");

        // 重复同样条目 ⇒ 值同 ⇒ 空集（不重绘——与单指"同值 false"一致）
        let again = follow_translate_batch(&mut t, &entries);
        assert!(again.is_empty(), "同值 ⇒ 无变化（不重绘）");

        // `FollowEntry` 布局：7×4B = 28B（宿主机按此步长填充——错位会致静默错值）
        assert_eq!(std::mem::size_of::<FollowEntry>(), 28, "FollowEntry 无填充：7×4B");
    }

    // ★★★Dactyl L2（§4.3）：场跟手——焦点距离 → 尖峰高度(scale)/朝向(rotate)；近则高、倾角朝指
    #[test]
    fn follow_field_scales_near_leaf_and_rotates_toward_focus() {
        let mut t = LayoutTree::new();
        // 场容器（id=1，父）
        let root = t.push(LNode::new(1, LStyle::default()));
        t.roots.push(root);
        // 三个叶尖峰（id 2/3/4），水平排开（相对容器 x：0/100/200；各 20×20）
        for i in 0..3u32 {
            let mut n = LNode::new(i + 2, LStyle::default());
            n.rect = crate::style::Rect { x: (i as f32) * 100.0, y: 0.0, width: 20.0, height: 20.0 };
            let idx = t.push(n);
            t.add_child(root, idx);
        }
        // 焦点在叶1中心 (10,10)：叶1 t=1（最高）、叶2/3 远离（t 低）
        let touched = follow_field(&mut t, 1, 10.0, 10.0, 200.0, 0.3, 1.0, 30.0);
        assert!(touched.len() >= 2, "至少近端两节点变值");
        let s0 = t.nodes[1].style.scale;
        let s2 = t.nodes[3].style.scale;
        assert!((s0 - 1.0).abs() < 1e-3, "焦点正中 ⇒ 满高 scale=1.0（实得 {s0}）");
        assert!(s2 < s0, "远端更矮（{s2} < {s0}）");
        // 朝向：焦点在叶3（右侧）的**左方** ⇒ dx=focus-cx<0 ⇒ rotate<0（尖峰朝指倾斜）
        assert!(t.nodes[3].style.rotate < 0.0, "焦点在左 ⇒ 右侧尖峰朝左倾（rotate<0，实得 {}）", t.nodes[3].style.rotate);
        // 同焦点重复 ⇒ 空集（不重绘）
        assert!(follow_field(&mut t, 1, 10.0, 10.0, 200.0, 0.3, 1.0, 30.0).is_empty(), "同值 ⇒ 无变化");
        // 容器自身（有子）不参与场
        assert_eq!(t.nodes[0].style.scale, 1.0, "容器不缩放");
    }
}
