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

use crate::node::LayoutTree;
use crate::style::Rect;
use std::sync::OnceLock;

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

/// 曲线求值：查表 + 线性插值（`u` 先 clamp 到 [0,1]；未知曲线 id 落表尾兜底——不 panic）
pub fn curve_eval(curve: u8, u: f32) -> f32 {
    let tables = TABLES.get_or_init(build_tables);
    let row = &tables[(curve as usize).min(CURVE_COUNT - 1)];
    let u = u.clamp(0.0, 1.0);
    let x = u * (TABLE_N - 1) as f32;
    let i0 = x.floor() as usize;
    let i1 = (i0 + 1).min(TABLE_N - 1);
    let frac = x - i0 as f32;
    let (a, b) = (row[i0], row[i1]);
    a + (b - a) * frac
}

/// 动画属性种类（与 TS 侧 `AnimKind` 一一对应——**跨语言契约，不得改号**）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnimKind {
    TranslateX = 0,
    TranslateY = 1,
    Scale = 2,
    /// 旋转（**度**；锚点 = 层中心）
    Rotate = 3,
    /// 不透明度（0..1）
    Opacity = 4,
}

impl AnimKind {
    pub fn from_u8(v: u8) -> Result<Self, String> {
        Ok(match v {
            0 => AnimKind::TranslateX,
            1 => AnimKind::TranslateY,
            2 => AnimKind::Scale,
            3 => AnimKind::Rotate,
            4 => AnimKind::Opacity,
            other => {
                return Err(format!(
                    "未知动画属性 kind={other}（0=translateX/1=translateY/2=scale/3=rotate/4=opacity）"
                ))
            }
        })
    }

    /// 静止判据（位置, 速度）——弹簧"停下来"的阈值（单位随属性）
    ///
    /// 取法：位置阈值 = 视觉不可辨的一小步；速度阈值 = 其 20 倍（即"20ms 内移动不足一个位置阈值"）。
    fn settle_eps(self) -> (f32, f32) {
        match self {
            AnimKind::TranslateX | AnimKind::TranslateY => (0.5, 10.0), // px, px/s
            AnimKind::Scale => (0.002, 0.04),                           // 倍, 倍/s
            AnimKind::Rotate => (0.05, 1.0),                            // 度, 度/s
            AnimKind::Opacity => (0.003, 0.06),                         // 1, 1/s
        }
    }

    /// 写入节点的样式槽（返回"值真的变了"）
    fn write(self, node: &mut crate::node::LNode, v: f32) -> bool {
        let slot = match self {
            AnimKind::TranslateX => &mut node.style.translate_x,
            AnimKind::TranslateY => &mut node.style.translate_y,
            AnimKind::Scale => &mut node.style.scale,
            AnimKind::Rotate => &mut node.style.rotate,
            AnimKind::Opacity => &mut node.style.opacity,
        };
        if *slot != v {
            *slot = v;
            true
        } else {
            false
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

/// 求值模式：查表曲线 / 弹簧物理
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AnimMode {
    Curve,
    Spring(SpringParams),
}

/// 一条活动动画（值由编译器/调用方生成 ⇒ 全是数字，运行时无字符串）
#[derive(Debug, Clone, Copy, PartialEq)]
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
    /// 求值模式
    pub mode: AnimMode,
    /// 当前值（权威 —— 曲线模式 = 本轮求值结果；弹簧模式 = 积分状态）
    pub x: f32,
    /// 当前速度（单位/秒；接管接力的载体）
    pub vel: f32,
    /// 遇同 `(node,kind)` 已有动画时是否**接管**（默认 `true`：位置连续 + 速度移交）
    pub takeover: bool,
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
            mode: AnimMode::Curve,
            x: from,
            vel: 0.0,
            takeover: true,
        }
    }
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
            let dirty = s.translate_x != 0.0
                || s.translate_y != 0.0
                || s.scale != 1.0
                || s.rotate != 0.0
                || s.opacity != 1.0;
            if dirty {
                s.translate_x = 0.0;
                s.translate_y = 0.0;
                s.scale = 1.0;
                s.rotate = 0.0;
                s.opacity = 1.0;
                n += 1;
            }
        }
    }
    n
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
    pub opacity: f32,
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
}

impl AnimEngine {
    pub fn new() -> Self {
        Self { anims: Vec::new(), flip_snap: None }
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
        let idx = tree
            .nodes
            .iter()
            .position(|n| n.id == a.node_id)
            .ok_or_else(|| format!("ANIM_START 的目标节点 {} 不在树上", a.node_id))?;
        if let Some(slot) = self
            .anims
            .iter_mut()
            .find(|(x, _)| x.node_id == a.node_id && x.kind == a.kind)
        {
            if a.takeover {
                // ★接管：位置连续 + 速度移交（"丝滑"的来源）
                let prev = slot.0;
                a.from = prev.x;
                a.x = prev.x;
                a.vel = prev.vel;
            } else {
                a.x = a.from;
                a.vel = 0.0;
            }
            *slot = (a, idx);
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
            if s.translate_x != 0.0
                || s.translate_y != 0.0
                || s.scale != 1.0
                || s.rotate != 0.0
                || s.opacity != 1.0
            {
                s.translate_x = 0.0;
                s.translate_y = 0.0;
                s.scale = 1.0;
                s.rotate = 0.0;
                s.opacity = 1.0;
                n += 1;
            }
        }
        n
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
        for (mut a, idx) in self.anims.drain(..) {
            let (new_x, new_vel, finished) = step(&mut a, dt_ms);
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
            let v = a.from + (a.to - a.from) * curve_eval(a.curve, p);
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

    /* ────────────────────────── ★★FLIP 布局动画（招牌能力） ────────────────────────── */

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
            let delay = i as f32 * stagger_ms;
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
    fn collect_updates(
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
                opacity: node.style.opacity,
            });
        }
        out
    }
}

/// 单步求值（曲线或弹簧）——返回 `(新值, 新速度, 是否结束)`
fn step(a: &mut Anim, dt_ms: f32) -> (f32, f32, bool) {
    // ── Progress 驱动：值由 seek 维护；tick 只"保持写入"（层被重建时不丢值） ──
    if a.drive == AnimDrive::Progress {
        let u = a.progress.clamp(0.0, 1.0);
        let x = a.from + (a.to - a.from) * curve_eval(a.curve, u);
        return (x, a.vel, false); // Progress 永不自动结束（由 stop 显式结束）
    }

    a.t_ms += dt_ms;
    // ── 延迟期：钉在起点（编排/交错） ──
    if a.t_ms < a.delay_ms {
        return (a.x, a.vel, false);
    }

    match a.mode {
        AnimMode::Curve => {
            let u = if a.dur_ms <= 0.0 {
                1.0
            } else {
                ((a.t_ms - a.delay_ms) / a.dur_ms).min(1.0)
            };
            if u >= 1.0 {
                return (a.to, 0.0, true); // ★端点钉死
            }
            let x = a.from + (a.to - a.from) * curve_eval(a.curve, u);
            let dt_s = dt_ms / 1000.0;
            let vel = if dt_s > 0.0 { (x - a.x) / dt_s } else { a.vel };
            (x, vel, false)
        }
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
    }
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
            mode: AnimMode::Curve,
            x: 0.0,
            vel: 0.0,
            takeover: true,
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
}
