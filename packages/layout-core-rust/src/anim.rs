// packages/layout-core-rust/src/anim.rs
// ★★RT0 spike（Proteus_App端路由与动画系统设计方案 §8）——**指令驱动动画的求值引擎**
//
// 【RT0 要验证什么】方案 §2.4 的推论：动画表达式若能编译期完全分析，就能编译为
//   **直接驱动 Rust 内核的指令**，不需要第二个 JS runtime。本模块是该推论的**执行半边**：
//   JS 侧只发一条 ANIM_START 指令（含曲线 id / 起止值 / 时长），此后**每帧**由宿主调一次
//   `AnimEngine::tick(dt)` ⇒ 曲线求值在 **Rust 侧完成**（查表 + 插值，不经 JS、不解析字符串）。
//
// 【与 JS 路径的成本差异（RT0 的测量对象）】
//   · 指令路径（本模块）：每帧 1 次跨边界调用 + O(活动动画数) 的查表插值 + 字段写入；
//   · JS 路径（对照）：JS 侧每帧对每节点做缓动计算 + 编码 N 条 SET_STYLE + 跨边界；
//     宿主再解码 N 条 + 应用。
//   ⇒ 差值 = 被消除的「O(N) JS 计算 + O(N) 编解码」。RT0 用实测数字回答"差值多大"。
//
// 【设计要点（对齐方案 §4.3）】
//   · 曲线 = `curve_id (u8)` → 65 点采样表 + 线性插值 ⇒ 求值是几次浮点运算（无分支、无公式幂运算）；
//   · 表在首次使用时构建一次（`OnceLock`），之后只读；
//   · 端点钉死：任何曲线 `f(0)=0`、`f(1)=1`（动画必须精确落在起止值上）；
//   · 动画按 `(node, kind)` 唯一：重复 start 语义 = **替换**（同属性后发者胜，避免叠加速度）。
//
// 【诚实边界（spike 级实现，如实标注）】
//   ① 节点索引在 `start` 时解析一次并缓存；若树发生**压实/删除**（`compact_reachable`）
//      导致索引变化，需 stop/restart —— 生产实现应挂"结构变更失效"回调（RT2 范围）；
//   ② 本轮只有 3 种动画属性（translateX/Y、scale）与 5 条曲线——足够回答 RT0 的可行性问题；
//      完整指令集（ANIM_BIND/SEEK/PROGRESS）归 RT2；
//   ③ `SprintApprox` 是**近似**（阻尼振荡的采样），不承诺与任何平台的原生 spring 逐帧一致。

use crate::node::LayoutTree;
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

/// 曲线求值：查表 + 线性插值（`u` 先 clamp 到 [0,1]；未知曲线 id 落 linear 兜底——不 panic）
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
}

impl AnimKind {
    pub fn from_u8(v: u8) -> Result<Self, String> {
        Ok(match v {
            0 => AnimKind::TranslateX,
            1 => AnimKind::TranslateY,
            2 => AnimKind::Scale,
            other => return Err(format!("未知动画属性 kind={other}（0=translateX/1=translateY/2=scale）")),
        })
    }
}

/// 动画的**驱动方式**（RT2：方案 §4.2 的 `ANIM_SEEK` 落地为此模式）
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

/// 一条活动动画（值由编译器生成 ⇒ 全是数字，运行时无字符串）
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Anim {
    /// 目标节点 id（生产语义用 id；索引在 start 时解析）
    pub node_id: u32,
    pub kind: AnimKind,
    pub curve: u8,
    pub from: f32,
    pub to: f32,
    pub dur_ms: f32,
    /// 已过时间（`Time` 驱动下由 tick 推进）
    pub t_ms: f32,
    /// 驱动方式（RT2）
    pub drive: AnimDrive,
    /// `Progress` 驱动下的当前进度（0..1；`Time` 驱动下此字段被忽略）
    pub progress: f32,
}

/// 一次 tick（或 seek）的结果（供宿主刷新层 / 测试观测）
#[derive(Debug, Default, Clone, PartialEq)]
pub struct TickOutcome {
    /// 本帧真正写入的字段数（值未变则不写）
    pub changed: usize,
    /// 本帧结束（到达时长）的动画数
    pub finished: usize,
    /// tick 之后仍在活动的动画数
    pub active_after: usize,
    /// ★**受影响的节点及其当前变换值**（`nodeId, translateX, translateY, scale`）
    ///
    /// 【为什么必须回报（本仓纪律：静默不更新是最危险的失效模式）】宿主（CALayer/Canvas）
    ///   只认自己那份绘制状态；内核改了 `style.translate_*` 而宿主不知道 ⇒ **屏幕不动**
    ///   （几何、日志、单测全对，只有肉眼能发现）。RT0 的对照实验不需要它（只测内核侧），
    ///   但**真机链路必须**——这正是 V6 教训（`text_updates` 同源）的第二次应用。
    ///   只含**值真的变了**的节点（未变化不回报 ⇒ 宿主不做无谓写入）。
    pub updates: Vec<(u32, f32, f32, f32)>,
}

/// 动画引擎（每个树句柄一个实例）
///
/// ★索引缓存：`start` 时把 `node_id` 解析成 `nodes[i]` 的下标并**缓存**——
///   否则每帧每条动画都要线性找节点（O(anim × nodes)/帧），那不是"编译期指令"的精神。
///   代价：树结构变更（压实/删除）会使缓存失效 ⇒ 边界见文件头。
#[derive(Debug, Default, Clone)]
pub struct AnimEngine {
    anims: Vec<(Anim, usize)>,
}

impl AnimEngine {
    pub fn new() -> Self {
        Self { anims: Vec::new() }
    }

    pub fn len(&self) -> usize {
        self.anims.len()
    }

    pub fn is_empty(&self) -> bool {
        self.anims.is_empty()
    }

    /// 启动动画（同 `(node, kind)` 已存在 ⇒ **替换**：后发者胜）
    ///
    /// 节点不存在 ⇒ 返回 Err（**不静默**：静默会让"动画不生效"极难排查）。
    pub fn start(&mut self, tree: &LayoutTree, a: Anim) -> Result<(), String> {
        if a.curve > CURVE_MAX {
            return Err(format!("未知曲线 id={}（0..={CURVE_MAX}）", a.curve));
        }
        let idx = tree
            .nodes
            .iter()
            .position(|n| n.id == a.node_id)
            .ok_or_else(|| format!("ANIM_START 的目标节点 {} 不在树上", a.node_id))?;
        if let Some(slot) = self.anims.iter_mut().find(|(x, _)| x.node_id == a.node_id && x.kind == a.kind) {
            *slot = (a, idx);
        } else {
            self.anims.push((a, idx));
        }
        Ok(())
    }

    /// 停止动画：`kind=None` 表示该节点全部属性
    pub fn stop(&mut self, node_id: u32, kind: Option<AnimKind>) {
        self.anims
            .retain(|(a, _)| !(a.node_id == node_id && kind.map_or(true, |k| k == a.kind)));
    }

    pub fn stop_all(&mut self) {
        self.anims.clear();
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
    pub fn stop_nodes(&mut self, node_ids: &[u32]) -> usize {
        let before = self.anims.len();
        self.anims.retain(|(a, _)| !node_ids.contains(&a.node_id));
        before - self.anims.len()
    }

    /// 推进 `dt_ms`：求值（查表插值）→ 写入节点样式字段 → 移除结束项。
    ///
    /// ★**不触发重排**：translate/scale 是**绘制层变换**（不影响布局几何）——
    ///   这正是"指令驱动动画"相对"每帧 SET_STYLE 一批几何键"的关键成本优势之一。
    pub fn tick(&mut self, tree: &mut LayoutTree, dt_ms: f32) -> TickOutcome {
        let mut out = TickOutcome::default();
        let mut touched: std::collections::HashSet<u32> = std::collections::HashSet::new();
        let mut keep: Vec<(Anim, usize)> = Vec::with_capacity(self.anims.len());
        for (mut a, idx) in self.anims.drain(..) {
            // ★驱动分支（RT2）：Progress 驱动的动画**不被时间推进**——它的进度由 `seek` 给
            //   （手势跟随语义：手指不动 ⇒ 值不动，而不是"自己往前跑"）
            let u = match a.drive {
                AnimDrive::Time => {
                    a.t_ms += dt_ms;
                    if a.dur_ms <= 0.0 { 1.0 } else { (a.t_ms / a.dur_ms).min(1.0) }
                }
                AnimDrive::Progress => a.progress.clamp(0.0, 1.0),
            };
            let v = a.from + (a.to - a.from) * curve_eval(a.curve, u);
            // 索引越界（树被压实过）⇒ 丢弃并计数（不 panic；生产应挂失效回调，见文件头边界①）
            if idx >= tree.nodes.len() {
                out.finished += 1;
                continue;
            }
            let node = &mut tree.nodes[idx];
            let slot = match a.kind {
                AnimKind::TranslateX => &mut node.style.translate_x,
                AnimKind::TranslateY => &mut node.style.translate_y,
                AnimKind::Scale => &mut node.style.scale,
            };
            if *slot != v {
                *slot = v;
                out.changed += 1;
                touched.insert(a.node_id);
            }
            // ★只有 Time 驱动会"结束"；Progress 驱动常驻（由 stop 显式结束）
            if a.drive == AnimDrive::Time && u >= 1.0 {
                out.finished += 1; // 到达时长 ⇒ 值已钉在 `to`，移除
            } else {
                keep.push((a, idx));
            }
        }
        self.anims = keep;
        out.active_after = self.anims.len();
        out.updates = self.collect_updates(tree, &touched);
        out
    }

    /// ★★RT2：**设置进度**（方案 §4.2 的 `ANIM_SEEK`）——手势/滚动/路由驱动的进度定位
    ///
    /// 语义：把 `(node, kind)` 的动画切到 `Progress` 驱动并设置进度 `p`（clamp 到 0..1），
    /// 立即求值并写字段（**不必等下一帧**——手势跟随要求"手指到哪画面到哪"）。
    ///
    /// ★与 `tick` 的分工：`seek` 是"外部给进度"，`tick` 是"时间推进"。
    ///   两者写入后都通过 `updates` 回报受影响节点（宿主据此刷层）。
    pub fn seek(&mut self, tree: &mut LayoutTree, node_id: u32, kind: AnimKind, p: f32) -> TickOutcome {
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
            let node = &mut tree.nodes[*idx];
            let slot = match a.kind {
                AnimKind::TranslateX => &mut node.style.translate_x,
                AnimKind::TranslateY => &mut node.style.translate_y,
                AnimKind::Scale => &mut node.style.scale,
            };
            if *slot != v {
                *slot = v;
                out.changed += 1;
                touched.insert(a.node_id);
            }
        }
        out.active_after = self.anims.len();
        out.updates = self.collect_updates(tree, &touched);
        out
    }

    /// 把"本轮受影响的节点"转成 `updates`（nodeId + 三个变换值）
    ///
    /// ★★**不用 `self.anims` 反查（本仓实测的真缺陷）**：动画**结束时会从 `anims` 移出**，
    ///   若按"活动动画列表"反查 ⇒ **结束那一帧的终值上报不到宿主**
    ///   ⇒ 动画会**停在倒数第二帧的位置**（几何/日志全对，只有肉眼能发现最后一步没走完）。
    ///   首版就是这么写的，被 `time_driven_anim_still_finishes_and_reports_final_value` 当场抓住。
    ///   ⇒ 正解：直接按 **node_id** 在树上取值（touched 里存的是 node_id，不是索引）。
    fn collect_updates(
        &self,
        tree: &LayoutTree,
        touched: &std::collections::HashSet<u32>,
    ) -> Vec<(u32, f32, f32, f32)> {
        let mut out = Vec::with_capacity(touched.len());
        for node_id in touched {
            let Some(node) = tree.nodes.iter().find(|n| n.id == *node_id) else {
                continue; // 节点已不在树上（压实/删除）⇒ 跳过（不 panic）
            };
            out.push((node.id, node.style.translate_x, node.style.translate_y, node.style.scale));
        }
        out
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
            t_ms: 0.0,
            drive: AnimDrive::Time,
            progress: 0.0,
        }
    }

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

    /* ────────────────────────── ★RT2：seek（手势驱动）与 updates 回报 ────────────────────────── */

    #[test]
    fn seek_sets_progress_driven_value_immediately() {
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateX)).unwrap();
        // 手势拖到 50% ⇒ 值应当即 = easeOutCubic(0.5) × 100 = 87.5（不必等 tick）
        let out = e.seek(&mut t, 1, AnimKind::TranslateX, 0.5);
        assert_eq!(out.changed, 1);
        assert!((t.nodes[0].style.translate_x - 87.5).abs() < 0.05, "seek 后值 {}", t.nodes[0].style.translate_x);
        // ★updates 必须回报（否则宿主不知道要刷哪一层 ⇒ 屏幕不动）
        assert_eq!(out.updates.len(), 1);
        assert_eq!(out.updates[0].0, 1);
        assert!((out.updates[0].1 - 87.5).abs() < 0.05);
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
    fn tick_reports_updates_only_for_changed_nodes() {
        let mut t = tree_with(2);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateX)).unwrap();
        e.start(&t, anim(2, AnimKind::TranslateY)).unwrap();
        // 第一帧：两条都动 ⇒ 两条 updates
        let o1 = e.tick(&mut t, 10.0);
        assert_eq!(o1.updates.len(), 2);
        // 停掉节点 2，再 tick：只有节点 1 的 update
        e.stop(2, None);
        let o2 = e.tick(&mut t, 10.0);
        assert_eq!(o2.updates.len(), 1);
        assert_eq!(o2.updates[0].0, 1);
    }

    #[test]
    fn time_driven_anim_still_finishes_and_reports_final_value() {
        // 回归：drive 分支不能把原有 Time 语义改坏（终点精确 + 结束后移除）
        let mut t = tree_with(1);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateX)).unwrap();
        let o = e.tick(&mut t, 200.0);
        assert_eq!(o.finished, 1);
        assert_eq!(o.active_after, 0);
        assert_eq!(t.nodes[0].style.translate_x, 100.0);
        // 结束时值有变化 ⇒ 仍应回报（宿主需要把最后一帧刷上去）
        assert_eq!(o.updates.len(), 1);
        assert_eq!(o.updates[0].1, 100.0);
    }

    /* ────────────────────────── ★RT2/§7.3：节点复用解绑 ────────────────────────── */

    #[test]
    fn stop_nodes_unbinds_animations_for_recycled_nodes() {
        // 场景：两个节点在做动画，其中节点 2 所在的行被回收（离开可见区）⇒ 必须解绑
        let mut t = tree_with(2);
        let mut e = AnimEngine::new();
        e.start(&t, anim(1, AnimKind::TranslateX)).unwrap();
        e.start(&t, anim(2, AnimKind::TranslateY)).unwrap();
        let removed = e.stop_nodes(&[2]);
        assert_eq!(removed, 1, "应移除节点 2 的动画");
        assert_eq!(e.len(), 1, "节点 1 的动画不受影响");
        // 解绑后 tick：**不得**再动节点 2（否则回收后错位）
        let v2_before = t.nodes[1].style.translate_y;
        e.tick(&mut t, 50.0);
        assert_eq!(t.nodes[1].style.translate_y, v2_before, "已解绑的节点不得被 tick 改动");
        // 节点 1 仍在动
        assert_ne!(t.nodes[0].style.translate_x, 0.0);
    }

    #[test]
    fn stop_nodes_on_ids_without_animations_is_zero_not_error() {
        let t = tree_with(1);
        let mut e = AnimEngine::new();
        assert_eq!(e.stop_nodes(&[99, 100]), 0, "无动画的 id 返回 0（不报错——回收常常成批调用）");
    }
}