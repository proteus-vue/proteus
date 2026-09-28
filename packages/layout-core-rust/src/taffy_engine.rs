// packages/layout-core-rust/src/taffy_engine.rs
// ★★L1 排版核心：**Taffy 后端实现**（DCP-1 定案的引擎）。
//
// ★本文件是**唯一**允许出现 `taffy::` 类型的文件（方案 §5.1 硬约束：
//   「实现 API 不得出现在 layout/ 模块之外，上层只能依赖 LayoutEngine 抽象接口」）。
//   换引擎（DCP-3 的自研评估）时，改动被限制在这里。
//
// ★映射要点（每条都对应一处已实测的语义细节，改动时勿凭直觉）：
//   ① `box_sizing: BorderBox`：宽高语义含 padding（与 TS 参考实现一致）
//   ② 百分比：taffy 的 `Dimension::Percent` 以**父内容盒**为基准——spike 已用浏览器基线验证
//   ③ `display:none` → `Display::None`（CSS 无盒）
//   ④ absolute：`position:absolute` + `inset`（containing block = 父 padding 盒——spike 已验证）
//   ⑤ 文本叶子走 `compute_layout_with_measure`，回调内转调注入的 `TextMeasurer`
//      —— ★**度量记忆化是硬要求**：taffy 对同一叶子可能测量多次（有界常数 13，
//        见 DCP-1 决策文档 §2.4），而平台文本 shaping 是布局里最贵的一步。
//        记忆化按「(节点, 最大宽)」为键——这与 Profile §5.3 的
//        「度量按 (文本, 字体, 宽度约束) 缓存」同款语义。
use std::collections::HashMap;

// ★刻意**不用** `taffy::prelude::*`（它导出的 `Rect`/`Size`/`Point` 与本 crate 的
//   `style::Rect`/`style::Size` 撞名，glob 下解析结果不直观）——只按需导入具体符号。
use taffy::prelude::{auto, length, percent, AlignItems, BoxSizing, Dimension, JustifyContent, LengthPercentageAuto};
use taffy::{AvailableSpace as TaffyAvailableSpace, NodeId, Style, TaffyTree};

use crate::engine::{AvailableSpace, LayoutEngine, LayoutOutput, RootConstraint, TextMeasurer};
use crate::node::{LayoutTree, LNode, NodeIndex, NO_PARENT};
use crate::style::{Display, FlexDirection, LStyle, Overflow, Position, Rect, Size};

/// Taffy 后端（DCP-1：`taffy = "0.14"`，**禁止降级到 0.13**——0.13 有 measure 指数退化）
pub struct TaffyEngine {
    /// 文本度量（平台注入；`None` = 全部文本按零尺寸）
    measurer: Option<Box<dyn TextMeasurer>>,
    /// ★★最近一次**增量**重排的分段耗时（本仓纪律：任何 >5ms 的分段都必须再拆——
    ///   此前 `layers` 段只报总数，我因此把「不是瓶颈」当瓶颈查了两轮）
    ///
    /// 键：`copy_ms`（把范围子树拷进新树）/ `build_ms`（taffy 建树）/ `solve_ms`（compute_layout）
    ///     / `writeback_ms`（结果回写 + 平移）/ `total_ms`
    pub last_phases: std::collections::BTreeMap<String, f64>,
    /// ★★V5 平移传播：本轮的**变化根**（脏子树根 + 被平移的兄弟）
    ///
    /// 【为什么需要】常规增量的"变化集"就是 scope 子树；而平移传播下，
    ///   变化的是「脏子树 ∪ 若干直接兄弟」——收集层必须按这个集合取矩形，
    ///   否则会漏掉被平移的兄弟（宿主不更新其位置 ⇒ **画面停在旧位置**）。
    ///   空 = 走常规 scope 语义。
    pub last_changed_roots: Vec<NodeIndex>,
    /// ★★度量记忆化：**内容寻址**（Profile §5.3 规定的键）——
    ///   `(文本 hash ⊕ 字体签名, 宽度约束位)` → Size
    ///
    /// 【为什么必须是内容寻址而非节点寻址】（本仓实测发现的设计缺陷）
    ///   初版键是 `(node_id, max_width)` → **同一文案在不同节点会各度量一次**。
    ///   4050 元素场景里 2000 个节点的文案都是 "item" → 真实度量 **4000 次**；
    ///   改成内容寻址后同样场景只需 **1–2 次**（其余跨节点命中）。
    ///   这正是 Profile §5.3 原文的要求：「文本 hash, 字体, 宽度约束」。
    ///
    /// 【键的构成】
    ///   · 文本 hash：来自 `text_hash`（每节点文本的稳定哈希 ⊕ 字体签名 `style_key`）
    ///   · 宽度约束：`max_width.to_bits()`（NaN 归一为 +∞）
    ///   ★字体维度由调用方以 `style_key` 提供（Rust 侧不解析字体属性——那是 L4 平台的职责）
    measure_cache: HashMap<(u64, u32), Size>,
    /// 本轮 measure 调用**总次数**（未命中缓存的次数）——D3 判据的可观测读数
    measure_calls: usize,
    /// 缓存命中次数（增量效果的直接读数）
    measure_hits: usize,
    /// 最近一次全量布局的根约束（退化保护用：无边界时增量退回全量，须用**同一约束**）
    last_root_constraint: Option<RootConstraint>,
    /// 节点索引 → taffy NodeId（`build_taffy` 填充；`layout` 每次重建）
    taffy_ids: Vec<NodeId>,
}

impl Default for TaffyEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl TaffyEngine {
    pub fn new() -> Self {
        Self {
            last_phases: std::collections::BTreeMap::new(),
            last_changed_roots: Vec::new(),
            measurer: None,
            measure_cache: HashMap::new(),
            measure_calls: 0,
            measure_hits: 0,
            taffy_ids: Vec::new(),
            // ★记下最近一次全量布局的根约束：增量在「无边界 ⇒ 退化为全量」时**精确复用**它
            //   （不自己猜约束——猜错会让退化路径静默改变语义，比慢更糟）
            last_root_constraint: None,
        }
    }

    /// 注入平台文本度量（构造期）
    pub fn with_measurer(mut self, m: Box<dyn TextMeasurer>) -> Self {
        self.measurer = Some(m);
        self
    }

    /// 注入/替换平台文本度量（清缓存——度量实现换了，旧结果不能复用）
    pub fn set_measurer(&mut self, m: Box<dyn TextMeasurer>) {
        self.measurer = Some(m);
        self.measure_cache.clear();
    }

    /// 本轮未命中缓存的度量次数（真实「向平台要度量」的次数）
    pub fn measure_calls(&self) -> usize {
        self.measure_calls
    }

    /// 缓存命中次数
    pub fn measure_hits(&self) -> usize {
        self.measure_hits
    }

    /// 当前度量缓存条目数
    pub fn measure_cache_entries(&self) -> usize {
        self.measure_cache.len()
    }

    /// 清空度量缓存（字体切换等全局失效场景）
    pub fn clear_measure_cache(&mut self) {
        self.measure_cache.clear();
    }

    /// 清空全部缓存（含 taffy 侧状态——下一轮 layout 会重建）
    pub fn invalidate_all(&mut self) {
        self.measure_cache.clear();
        self.taffy_ids.clear();
    }

    /// `LStyle` → taffy `Style`（★映射细节集中在此，便于审查与对拍）
    pub(crate) fn to_taffy(style: &LStyle) -> Style {
        let mut out = Style {
            // ① 宽高语义含 padding
            box_sizing: BoxSizing::BorderBox,
            ..Default::default()
        };

        // ② display（CSS 无盒）
        out.display = match style.display {
            Display::Flex => taffy::Display::Flex,
            Display::None => taffy::Display::None,
        };

        // ③ flex 主轴 / 对齐 / 伸缩
        out.flex_direction = match style.flex_direction {
            FlexDirection::Row => taffy::FlexDirection::Row,
            FlexDirection::Column => taffy::FlexDirection::Column,
            FlexDirection::RowReverse => taffy::FlexDirection::RowReverse,
            FlexDirection::ColumnReverse => taffy::FlexDirection::ColumnReverse,
        };
        out.justify_content = Some(parse_justify(&style.justify_content));
        out.align_items = Some(parse_align_items(&style.align_items));
        if let Some(a) = style.align_self.as_deref() {
            out.align_self = Some(parse_align_items(a));
        }
        out.flex_grow = style.flex_grow;
        out.flex_shrink = style.flex_shrink;
        out.flex_basis = match (style.flex_basis, style.flex_basis_ratio) {
            (Some(b), _) => length(b),
            (None, Some(r)) => percent(r),
            _ => auto(),
        };
        if style.gap != 0.0 {
            let g = length(style.gap);
            out.gap = taffy::Size { width: g, height: g };
        }

        // ④ 尺寸（比例以父内容盒为基准——spike 已验证）
        out.size = taffy::Size { width: dim(style.width, style.width_ratio), height: dim(style.height, style.height_ratio) };
        // ★注意类型差异：`size` 用 `Dimension`，而 `min_size`/`max_size` 用 `LengthPercentageAuto`
        //   （后者额外允许 `auto` 关键字）——两者不可混用，这里分别映射。
        out.min_size = taffy::Size { width: opt_lpa(style.min_width), height: opt_lpa(style.min_height) };
        out.max_size = taffy::Size { width: opt_lpa(style.max_width), height: opt_lpa(style.max_height) };

        // ⑤ 盒模型
        out.padding = taffy::Rect {
            left: length(style.padding.left),
            right: length(style.padding.right),
            top: length(style.padding.top),
            bottom: length(style.padding.bottom),
        };
        out.margin = taffy::Rect {
            left: length(style.margin.left),
            right: length(style.margin.right),
            top: length(style.margin.top),
            bottom: length(style.margin.bottom),
        };

        // ⑥ 定位：absolute 的 inset 相对**父 padding 盒**
        match style.position {
            Position::Absolute => {
                out.position = taffy::Position::Absolute;
                out.inset = taffy::Rect {
                    left: style.left.map(length).unwrap_or(auto()),
                    right: auto(),
                    top: style.top.map(length).unwrap_or(auto()),
                    bottom: auto(),
                };
            }
            Position::Relative => {
                out.position = taffy::Position::Relative;
                out.inset = taffy::Rect {
                    left: style.left.map(length).unwrap_or(auto()),
                    right: auto(),
                    top: style.top.map(length).unwrap_or(auto()),
                    bottom: auto(),
                };
            }
            Position::Static => {
                out.position = taffy::Position::Relative;
            }
        }

        // ⑦ overflow（只影响裁剪/滚动区，不影响布局盒）
        let ov = parse_overflow(style.overflow);
        out.overflow = taffy::Point { x: ov, y: ov };

        out
    }

    /// 构建 taffy 节点表（节点索引 ↔ NodeId 一一对应，顺序一致）
    fn build_taffy(&mut self, tree: &LayoutTree) -> TaffyTree<u32> {
        let mut taffy: TaffyTree<u32> = TaffyTree::new();
        let mut ids: Vec<NodeId> = Vec::with_capacity(tree.len());

        // 先建全部节点（保证索引稳定）
        for node in &tree.nodes {
            let style = Self::to_taffy(&node.style);
            let id = match &node.text {
                // 文本叶子带 context（承载节点 id，供度量回调回查节点）
                Some(_) => taffy.new_leaf_with_context(style, node.id).expect("taffy: new_leaf_with_context"),
                None => taffy.new_leaf(style).expect("taffy: new_leaf"),
            };
            ids.push(id);
        }
        // 再连父子（顺序 = children 顺序 = 绘制顺序）
        for (idx, node) in tree.nodes.iter().enumerate() {
            if node.parent == NO_PARENT {
                continue;
            }
            taffy.add_child(ids[node.parent as usize], ids[idx]).expect("taffy: add_child");
        }

        self.taffy_ids = ids;
        taffy
    }

    /// 执行一轮 taffy 布局（含度量回调）
    fn run_taffy(&mut self, tree: &LayoutTree, taffy: &mut TaffyTree<u32>, roots: &[NodeIndex], constraint: RootConstraint) -> LayoutOutput {
        // ★字段级解构：让 `measurer` 与 `measure_cache` 同时可变借用（互不相交）
        let TaffyEngine { measurer, measure_cache, measure_calls, measure_hits, taffy_ids, last_root_constraint: _, last_phases: _, last_changed_roots: _ } = self;
        *measure_calls = 0;
        *measure_hits = 0;

        let avail = taffy::Size { width: to_taffy_space(constraint.width), height: to_taffy_space(constraint.height) };
        let nodes: &[LNode] = &tree.nodes;
        // ★id → 节点索引（供回调 O(1) 直取；见回调内说明）
        let mut id_index: HashMap<u32, u32> = HashMap::with_capacity(nodes.len());
        for (i, n) in nodes.iter().enumerate() {
            id_index.insert(n.id, i as u32);
        }
        // ★★度量缓存键的第一维（Profile §5.3「文本 hash + 字体」）——按节点索引平行存放。
        //
        // ★★**内容寻址 vs 节点寻址的取舍**（本仓实测踩到，值得记）：
        //   · 文本**字面量已知**时 → 用「文本 hash ⊕ 字体签名」= **内容寻址**
        //     → 2000 个同文案节点只需真实度量 **1–2 次**（实测：4000 → 2）
        //   · 文本**字面量未知**时（golden 用例只给 `isText` 标记 + 按 id 查度量表）
        //     → **必须回退节点寻址**（用 node_id）
        //     ✗ 若在此时仍填 0：**所有文本节点的键相同** → 不同文本错误共用缓存项
        //       → 几何错乱（本仓实测：conformance 17 用例里文本相关全部失败，max_delta 12.6dp）
        let text_hashes = compute_text_hashes(nodes);

        for &root in roots {
            let taffy_root = taffy_ids[root as usize];
            taffy
                .compute_layout_with_measure(
                    taffy_root,
                    avail,
                    |inputs: taffy::LayoutInput, _node_id: NodeId, ctx: Option<&mut u32>, style: &Style| {
                        // ★★回调必须走 `taffy::compute_leaf_layout`（**官方示例的写法**，见
                        //   taffy 0.14 `examples/measure.rs`）——它负责：解析 style 里的 size/min/max、
                        //   换算 padding/border（`content_box_inset`）、按 `run_mode` 决定用已知尺寸还是内容尺寸，
                        //   并做最终夹取。**只把「内容尺寸」这一步**交给我们的度量函数。
                        //
                        //   本仓实测教训（勿走回头路）：若自己在回调里手写「回显 style.size」，
                        //   `auto` 轴会被回显成 0 → **stretch 后的宽度被压成 0**
                        //   （实测：column 容器内 auto 宽子项，浏览器 260 → 手写实现 0）。
                        let node_id_v = ctx.as_deref().copied();
                        taffy::compute_leaf_layout(
                            inputs,
                            style,
                            |_, _| 0.0,
                            |known, avail| {
                                // 只有**文本叶子**才有内容尺寸可量；其余一律 (0,0)（内容为空）
                                let Some(nid) = node_id_v else {
                                    return taffy::Size { width: 0.0, height: 0.0 };
                                };
                                // ★★用 **id → 索引**映射直取（O(1)），而非 `nodes.iter().find()`（O(n)）
                                //   本仓实测：4051 节点内容撑开场景有 22000 次度量回调 →
                                //   线性扫描退化为 O(n × 回调数)，是最大热点
                                let Some(&nidx) = id_index.get(&nid) else {
                                    return taffy::Size { width: 0.0, height: 0.0 };
                                };
                                let node = &nodes[nidx as usize];
                                let Some(req) = &node.text else {
                                    return taffy::Size { width: 0.0, height: 0.0 };
                                };

                                // 度量可用的最大宽：已知宽优先，其次父宽，否则不限
                                let max_w = known.width.or(avail.width.into_option()).unwrap_or(f32::INFINITY);
                                // ★内容寻址键：文本 hash（含字体签名）+ 宽度约束
                                let key = measure_key(text_hashes[nidx as usize], max_w);
                                if let Some(s) = measure_cache.get(&key) {
                                    *measure_hits += 1;
                                    return taffy::Size { width: s.width, height: s.height };
                                }
                                let measured = match measurer.as_mut() {
                                    Some(m) => m.measure(node, &req.text, max_w),
                                    None => Size::default(),
                                };
                                *measure_calls += 1;
                                measure_cache.insert(key, measured);
                                taffy::Size { width: measured.width, height: measured.height }
                            },
                        )
                    },
                )
                .expect("taffy: compute_layout");
        }

        // 回写矩形（taffy 的 location 已是「相对父内容盒」——与我们的坐标约定一致）
        let mut rects: Vec<Option<Rect>> = vec![None; tree.len()];
        for (idx, taffy_id) in taffy_ids.iter().enumerate() {
            if let Ok(layout) = taffy.layout(*taffy_id) {
                rects[idx] = Some(Rect {
                    x: layout.location.x,
                    y: layout.location.y,
                    width: layout.size.width,
                    height: layout.size.height,
                });
            }
        }
        LayoutOutput { rects, measure_calls: *measure_calls, measure_hits: *measure_hits, relayout_count: tree.len() }
    }

    /// 把 `out.rects` 回写进节点（`display:none` 的 `None` 保持零矩形）
    fn write_back(&self, tree: &mut LayoutTree, out: &LayoutOutput) {
        for (idx, r) in out.rects.iter().enumerate() {
            if let Some(r) = r {
                tree.nodes[idx].rect = *r;
            }
            tree.nodes[idx].dirty = false;
        }
    }
}

impl LayoutEngine for TaffyEngine {
    fn layout(&mut self, tree: &mut LayoutTree, constraint: RootConstraint) -> LayoutOutput {
        // ★记下本次根约束：增量在「无边界 ⇒ 退回全量」时要**精确复用**它，而不是自己猜
        self.last_root_constraint = Some(constraint);
        let roots = tree.roots.clone();
        let mut taffy = self.build_taffy(tree);
        let out = self.run_taffy(tree, &mut taffy, &roots, constraint);
        self.write_back(tree, &out);
        out
    }

    /// ★增量布局（§5.4）：从脏节点向上找**最高的布局边界**作为重排范围，只重排该子树。
    ///
    /// 为什么这就够了：布局边界的对外尺寸只由自身显式宽高决定 ⇒ 边界内怎么变都不影响边界外。
    /// 反面教材是 RN 生产事故（无约束嵌套容器让 dirty 级联到根，1.2ms→28.4ms）——
    /// 本仓已在 TS 侧实测：开边界重排 4 节点 / 0.59ms，关边界退化为整树根 / 15 节点 / 1.55ms。
    ///
    /// ★本实现的成本模型（诚实标注）：为范围子树**重建**了一棵 taffy 树 ⇒ 代价 O(范围)。
    ///   对比全量 O(整树)：当 范围 ≪ 整树 时是真实收益。进一步优化（复用 taffy 状态做真增量）
    ///   留到 M2 有真机数据后再评估——先保证语义正确。
    fn layout_incremental(&mut self, tree: &mut LayoutTree, dirty: NodeIndex) -> LayoutOutput {
        // ★每轮清空（否则上一轮的平移痕迹会污染本轮的收集集合）
        self.last_changed_roots.clear();
        let scope = self.relayout_scope_of(tree, dirty);

        // ★★退化保护：重排范围 == 根 ⇒ 直接走全量，别做「拷贝整树再布局」
        //
        // 【为什么必须有（本仓实测）】没有布局边界时 scope 会一路到根，
        //   而本实现为范围子树**重建** taffy 树 ⇒ 白拷一整棵树：
        //   实测 **0.6×**（比全量更慢）。有边界时才是 45–644×。
        //   ⇒ 宁可退化为全量（1.0×），也不要「越用越慢」的假增量。
        let is_root_scope = tree.get(scope).parent == NO_PARENT;
        if is_root_scope {
            // ★★V5：范围退化到根时，**先尝试平移传播**（类B 这类"兄弟移位"场景可免全量）
            //
            // 【为什么值得试（本仓实测）】类B 桌面 3.87ms / 真机 18ms，而其中后续兄弟
            //   只是整体位移 ⇒ 无需重解 flexbox。前提不满足时本函数返回 None（回退全量）。
            if let Some(out) = self.try_translation_relayout(tree, dirty) {
                return out;
            }
            // 复用最近一次全量布局的约束（首次无记录时用「紧尺寸」兜底：范围是整树，
            // 根若为 auto 尺寸，MaxContent 语义与全量首帧一致）
            let c = self.last_root_constraint.unwrap_or(RootConstraint {
                width: AvailableSpace::MaxContent,
                height: AvailableSpace::MaxContent,
            });
            return self.layout(tree, c);
        }

        // ★★根约束 = 该边界节点**上次布局的实际尺寸**（而不是它的声明尺寸）
        //
        // 【为什么不能用声明尺寸（本仓实测）】交叉轴 stretch 的节点**没有声明宽**
        //   （宽由父撑开）⇒ `style.width` 是 `None` ⇒ 用 `INFINITY` 会让子树按
        //   「不限宽」重排 → 内容换行/换行反推的尺寸全变 ⇒ **几何错**（不是慢，是错）。
        //   而边界的定义就是「对外尺寸与内容无关」⇒ 它上次的实际尺寸**本次依然成立**，
        //   直接拿 `rect` 用即可（首帧无 rect 时退回声明尺寸/INFINITY）。
        let scope_rect = tree.get(scope).rect;
        let scope_style = tree.get(scope).style.clone();
        let cw = if scope_rect.width > 0.0 { scope_rect.width } else { scope_style.width.unwrap_or(f32::INFINITY) };
        let ch = if scope_rect.height > 0.0 { scope_rect.height } else { scope_style.height.unwrap_or(f32::INFINITY) };
        let constraint = RootConstraint::definite(cw, ch);

        // 取子树 + 前序索引映射（一次 O(范围)，避免逐节点重扫）
        let t_phase0 = std::time::Instant::now();
        let (out, _scope_size) = self.layout_subtree_and_writeback(tree, scope, constraint);
        let t_total = t_phase0.elapsed().as_secs_f64() * 1000.0;
        self.last_phases.clear();
        self.last_phases.insert("subtree_ms".into(), t_total);
        self.last_phases.insert("total_ms".into(), t_total);
        self.last_phases.insert("scope_node_count".into(), out.relayout_count as f64);

        LayoutOutput { rects: out.rects, measure_calls: out.measure_calls, measure_hits: out.measure_hits, relayout_count: out.relayout_count }
    }

    fn name(&self) -> &'static str {
        "taffy-0.14"
    }
}

impl TaffyEngine {
    /// ★★把 `scope` 子树按 `constraint` 重排并**回写**原树（子节点 rect 相对 scope）
    ///
    /// 【为什么抽成公用（本仓纪律：同一语义一处实现）】增量路径与**平移传播**都要做这件事，
    ///   两份实现必然分叉（尤其坐标换算这种易错处）。
    ///
    /// 【坐标约定（本仓实测修正过一处缺陷，务必遵守）】回写时：
    ///   · 范围根 → 保持原 rect（它的位置由父决定，本次重排不改它）
    ///   · 其子节点 → **直接采用 taffy 给的 `r`**（它已相对范围根）
    ///   ✗ 错误写法：`origin + r`（把范围自身位置叠加两次——范围非根时几何会错）
    ///
    /// 返回 `(输出, scope 重排后的实际尺寸)`
    fn layout_subtree_and_writeback(
        &mut self,
        tree: &mut LayoutTree,
        scope: NodeIndex,
        constraint: RootConstraint,
    ) -> (LayoutOutput, (f32, f32)) {
        let order = preorder(tree, scope);
        let mut sub = LayoutTree::new();
        let root_new = copy_subtree(tree, scope, &mut sub, NO_PARENT);
        sub.roots.push(root_new);

        let mut sub_engine = TaffyEngine::new();
        if let Some(m) = self.measurer.take() {
            sub_engine.set_measurer(m);
        }
        let out = sub_engine.layout(&mut sub, constraint);
        // 重排后的实际尺寸（供调用方判 delta / 传播）
        let scope_new = sub.get(root_new).rect;

        let origin = tree.get(scope).rect;
        let mut rects: Vec<Option<Rect>> = vec![None; tree.len()];
        let mut count = 0usize;
        for (sub_idx, r) in out.rects.iter().enumerate() {
            let Some(r) = r else { continue };
            let Some(&orig) = order.get(sub_idx) else { continue };
            let new_rect = if orig == scope {
                origin // 范围根：位置由父决定，本次重排不改它
            } else {
                Rect { x: r.x, y: r.y, width: r.width, height: r.height } // `r` 已相对范围根
            };
            tree.nodes[orig as usize].rect = new_rect;
            tree.nodes[orig as usize].dirty = false;
            rects[orig as usize] = Some(new_rect);
            count += 1;
        }

        // 度量缓存合并回主引擎（子树算过的成果不丢）
        if let Some(m) = sub_engine.measurer.take() {
            self.measurer = Some(m);
        }
        self.measure_cache.extend(sub_engine.measure_cache);

        (
            LayoutOutput { rects, measure_calls: out.measure_calls, measure_hits: out.measure_hits, relayout_count: count },
            (scope_new.width, scope_new.height),
        )
    }

    /// ★★V5：**平移传播**——当范围退化到根时，尝试用「重排脏子树 + 平移其后续兄弟」代替整树全量。
    ///
    /// 【要解决的问题（本仓实测的定量依据）】类B（改行高 ⇒ 兄弟移位）在当前实现下
    ///   **必然全量**：`relayout_scope_of` 返回根 ⇒ 走退化保护 ⇒ `layout()` 整树。
    ///   桌面 release 实测 4003 节点 **3.87ms**（真机 18ms，占总耗时 63%）。
    ///   而这类变更的后续兄弟**只是整体位移、尺寸未变** ⇒ 无需重解 flexbox。
    ///
    /// 【为什么成立（几何论证）】容器 P 主轴向尺寸**已定**（前提⑤）⇒ P 的尺寸不变
    ///   ⇒ 孙子层及以上的几何不受影响；子项无 grow/shrink/百分比（前提②③④）
    ///   ⇒ 子项尺寸只由自身决定 ⇒ 唯一变化是**主轴向的累计偏移**。
    ///
    /// 【前提（全部满足才走本路径；任一条不满足返回 None 让调用方回退全量——正确性优先）】
    ///   ① P 的 `justify-content` = `flex-start`（否则空间重分配 ⇒ 不是纯平移）
    ///   ② P 的子项**无 `flex-grow`**（否则自由空间重分配 ⇒ 尺寸会变）
    ///   ③ P 的子项**无 `flex-shrink`**（否则溢出收缩 ⇒ 尺寸会变）
    ///   ④ P 的子项**两轴均无百分比尺寸**（否则尺寸依赖 P ⇒ 间接依赖）
    ///   ⑤ P 主轴向尺寸**已声明**（auto 需向上递归传播——本版保守拒绝，不做跨层）
    ///   ⑥ 脏节点 D 的**主轴向尺寸已声明**（否则 delta 未知）
    fn try_translation_relayout(&mut self, tree: &mut LayoutTree, dirty: NodeIndex) -> Option<LayoutOutput> {
        let p = tree.get(dirty).parent;
        if p == NO_PARENT {
            return None; // 脏节点就是根：无父可平移
        }
        let (p_style, p_children) = {
            let pn = tree.get(p);
            (pn.style.clone(), pn.children.clone())
        };
        let horizontal = p_style.flex_direction.is_horizontal();

        // ① 主轴对齐
        if p_style.justify_content != "flex-start" {
            return None;
        }
        // ②③④ 逐子项
        for &c in &p_children {
            let cs = &tree.get(c).style;
            if cs.flex_grow > 0.0 || cs.flex_shrink != 0.0 {
                return None;
            }
            if cs.width_ratio.is_some() || cs.height_ratio.is_some() {
                return None;
            }
        }
        // ⑤ P 主轴向已声明
        let p_main = if horizontal { p_style.width } else { p_style.height };
        p_main?;
        // ⑥ D 主轴向已声明
        let d_style = tree.get(dirty).style.clone();
        let d_main_new = if horizontal { d_style.width } else { d_style.height }?;
        let d_old = tree.get(dirty).rect;
        let d_main_old = if horizontal { d_old.width } else { d_old.height };

        // ── 重排 D 的子树（D 尺寸变了 ⇒ 其内部排布可能变）──
        //   约束：主轴用**新声明值**；交叉轴用旧实际尺寸（与既有增量同款依据：
        //   交叉轴尺寸不由内容决定，故上次的实际值本次依然成立）
        let (cw, ch) = if horizontal {
            (d_main_new, if d_old.height > 0.0 { d_old.height } else { d_style.height.unwrap_or(f32::INFINITY) })
        } else {
            (if d_old.width > 0.0 { d_old.width } else { d_style.width.unwrap_or(f32::INFINITY) }, d_main_new)
        };
        let (out, d_size) = self.layout_subtree_and_writeback(tree, dirty, RootConstraint::definite(cw, ch));

        // ★实际 delta 用**重排后的真实尺寸**（可能因 min/max 夹取而与声明值不同）
        let d_main_actual = if horizontal { d_size.0 } else { d_size.1 };
        let delta = d_main_actual - d_main_old;

        // ★★脏节点**自身**的尺寸也要写回（本仓实测：不变式测试抓到的第一个 bug）
        //
        // 【为什么】`layout_subtree_and_writeback` 对**范围根**保持原 rect 不变
        //   （那是增量路径的正确语义：范围根的位置/尺寸由父决定、重排不该改它）。
        //   但平移传播里脏节点 D **正是尺寸变了的那个** ⇒ 必须显式写回它重排后的实际尺寸。
        //   （实测症状：D 的高度停在旧值 56，而全量给 90。）
        if horizontal {
            tree.nodes[dirty as usize].rect.width = d_size.0;
        } else {
            tree.nodes[dirty as usize].rect.height = d_size.1;
        }

        // ── 平移后续兄弟（★只改直接兄弟的 rect——它们的子节点 rect 是**相对父**的，
        //     父动了子自然跟着动 ⇒ 无需逐个调整，这正是「平移」省的地方）──
        let mut changed: Vec<NodeIndex> = vec![dirty];
        if delta.abs() > 0.001 {
            let mut after = false;
            for &c in &p_children {
                if c == dirty {
                    after = true;
                    continue;
                }
                if !after {
                    continue;
                }
                if horizontal {
                    tree.nodes[c as usize].rect.x += delta;
                } else {
                    tree.nodes[c as usize].rect.y += delta;
                }
                tree.nodes[c as usize].dirty = true;
                changed.push(c);
            }
        }

        self.last_phases.clear();
        self.last_phases.insert("translation_delta".into(), delta as f64);
        self.last_phases.insert("translation_shifted".into(), (changed.len() - 1) as f64);
        self.last_phases.insert("total_ms".into(), 0.0);
        // ★告知收集层：本轮的"变化根"是这些（而非 scope）
        self.last_changed_roots = changed;

        Some(out)
    }

    /// 沿 parent 链向上找**最近的（最低的）布局边界**；没有则用树根（§5.4 T2 的核心机制）
    ///
    /// ★★「最近」而非「最高」——本轮真机实测纠正的一处语义错误（影响极大）
    ///
    /// 【为什么是最近】边界节点的定义是「对外尺寸与内容无关」⇒ 它一旦罩住变更，
    ///   **重排不需要外溢到更高的边界**（更高的边界尺寸也不会变）。
    ///   取「最高」会让范围尽可能大：真实 App 的页面根通常显式宽高 ⇒ **页面自己就是边界**
    ///   ⇒ 「最高边界」永远等于页面 ⇒ 增量完全失效。
    ///   实测：只改 1 行的 margin（patch=1），却重排整页 **1407/3507 个节点**，
    ///   耗时 7.6ms/20.1ms —— 与全量几乎无差别。
    ///
    /// 【安全性】取最近边界是安全的：边界的对外尺寸不因子树而变（这正是「边界」的定义），
    ///   故子树重排不会改变祖先链上的任何几何。若链上不存在边界，才退回树根（全量）。
    pub fn relayout_scope_of(&self, tree: &LayoutTree, dirty: NodeIndex) -> NodeIndex {
        // ★★从**脏节点的父**开始找边界（而不是从脏节点自身）——本仓实测抓到的**正确性缺陷**
        //
        // 【为什么不能从自身开始（错误语义，实测复现）】
        //   `dirty` 是**自身属性发生变化**的节点。若它自己就是布局边界
        //   （如 `{width, height}` 显式的列表行），从自身起找会**立即返回它自己** ⇒
        //   只重排它自己的子树 ⇒ **父级没重排 ⇒ 后续兄弟的几何静默停在旧位置**。
        //   实测（ops_apply::sibling_reposition_after_boundary_self_resize）：
        //     两行（各高 56）· 改首行高 56→80 ⇒ 次行 y 期望 80，**实际仍为 56**（几何错）。
        //
        // 【为什么「父为起点」不损失精度（关键）】
        //   非边界的脏节点（文本叶子 / 无子节点的圆点）**本身永远不是边界**
        //   （`is_layout_boundary_with` 要求 `!children.is_empty()`）⇒ 从自身起 or 从父起，
        //   第一个命中的边界**完全相同** ⇒ 类A（边界内内容变化）的读数**不受影响**。
        //   只有「脏节点自身是边界」这一情形被修正：范围上浮到**严格祖先**中的最近边界。
        //
        // 【代价（诚实标注）】改边界的**自身外盒**（height / margin / display）时，
        //   范围必然上浮到父级边界 ⇒ 在「页面根即边界」的常见场景下退化为整页重排。
        //   这是**子树上粒度**增量的固有代价（本引擎的 API 以子树为最小重排单位），
        //   换来的是不出错——**正确性 > 性能**（本仓铁律）。
        let mut cur = if tree.get(dirty).parent == crate::node::NO_PARENT {
            dirty // 脏节点就是根：只能从它自己起（根即边界时范围=整树）
        } else {
            tree.get(dirty).parent
        };
        loop {
            let node = tree.get(cur);
            // ★把**父的 align-items 与父的轴系**传进判定：交叉轴 stretch 的节点，其该轴尺寸
            //   由父决定、与自身内容无关 ⇒ 它也是边界（本仓实测：不认 stretch 会让 App 的列表行
            //   全部被判为非边界 → 增量一次都触发不了）
            let (parent_align, parent_horiz) = if node.parent == NO_PARENT {
                (None, None)
            } else {
                let p = tree.get(node.parent);
                (Some(p.style.align_items.as_str()), Some(p.style.flex_direction.is_horizontal()))
            };
            if node.is_layout_boundary_with(parent_align, parent_horiz) {
                return cur;      // ★第一个（最近的）边界即停——见上方注释
            }
            if node.parent == NO_PARENT {
                break;
            }
            cur = node.parent;
        }
        cur      // 无任何边界 ⇒ 树根（全量）
    }
}

/// 计算每个节点的度量缓存键第一维（内容 hash 或节点寻址回退）
///
/// ★抽为**纯函数**以便单测（缓存键的正确性是本仓实测踩过坑的地方）：
///   ① 非空字面量 → 内容寻址（含字体签名）
///   ②/③ 无请求或空串 → 节点寻址（内容未知 ⇒ 不能假设"同文案"）
pub(crate) fn compute_text_hashes(nodes: &[LNode]) -> Vec<u64> {
    let mut out = Vec::with_capacity(nodes.len());
    for n in nodes {
        // ★★三情形（实测踩到第 ③ 种）：
        //   ① 有非空文本字面量 → **内容寻址**（同文案跨节点复用，实测 4000→2 次）
        //   ② 无文本请求 → 非文本节点，键用节点 id
        //   ③ **文本请求存在但字面量为空串** → golden / 按 id 查表场景的写法：
        //      空串**不代表内容相同**！若归入 ① → 不同文本共用缓存项 → 几何错乱
        //      （实测：conformance 文本用例全红，max_delta 12.6dp）
        match &n.text {
            Some(t) if !t.text.is_empty() => {
                use std::hash::{Hash, Hasher};
                let mut h = std::collections::hash_map::DefaultHasher::new();
                t.text.hash(&mut h);
                t.style_key.hash(&mut h);      // ★字体维度进键
                out.push(h.finish());
            }
            _ => out.push(((n.id as u64) << 1) | 1),   // 节点寻址（键空间与内容 hash 隔离）
        }
    }
    out
}

/// 测试用：直接取缓存键
#[cfg(test)]
fn hash_for_tests(nodes: &[LNode]) -> Vec<u64> {
    compute_text_hashes(nodes)
}

/// 度量缓存键：**(文本 hash, 宽度约束位)** —— 内容寻址（Profile §5.3）
///
/// ★为什么用元组而非折叠成 u64：折叠会引入**信息丢失**（两个不同文本可能折叠到同一键
///   → 返回错误的度量值 = 布局错乱）。元组键由 Rust 的 HashMap 正确哈希，
///   代价与单 u64 键同级（一次哈希），却**无碰撞风险**（除 64 位文本哈希本身，概率 ~1e-16）。
#[inline]
fn measure_key(text_hash: u64, max_w: f32) -> (u64, u32) {
    let w = if max_w.is_finite() { max_w.to_bits() } else { f32::INFINITY.to_bits() };
    (text_hash, w)
}

/// 前序索引序列（与 `copy_subtree` 的产出顺序**必须一致**——两者都是「自身 → 子级依次」）
fn preorder(tree: &LayoutTree, root: NodeIndex) -> Vec<NodeIndex> {
    let mut out = Vec::with_capacity(tree.len());
    let mut stack = vec![root];
    while let Some(idx) = stack.pop() {
        out.push(idx);
        for &c in tree.get(idx).children.iter().rev() {
            stack.push(c);
        }
    }
    out
}

/// 拷贝子树到新树（前序，与 `preorder` 顺序一致）
///
/// ★★必须**清空克隆体的 parent/children**（本仓实测抓到的真 bug，曾导致栈溢出）：
///   节点是按**索引**互指的（`parent: NodeIndex` / `children: Vec<NodeIndex>`）。
///   直接 `clone()` 会把**原树的索引**带进新树，而新树的索引空间完全不同：
///     · 子树根的 `parent` 仍是原树索引 —— 若恰为 0 且自己有索引 0，就成**自环**
///     · `children` 仍指向原树索引 —— 那些索引在新树里要么越界，要么是**无关节点**
///   后果：布局的父子遍历遇自环 → **无限递归 → 栈溢出**
///   （现象：4 个节点就能复现；只有「重排范围落在布局边界上」时才触发 ——
///    而没有边界时 scope=根、`parent_new == NO_PARENT` 的分支不同，故此前未暴露）
///
/// ★为什么此前没被测出：既有测试只验证了 `relayout_scope_of`（纯函数），
///   **从未调用 `layout_incremental` 本身** ⇒ 真正的增量路径零覆盖。
///   教训与全仓一致：**测了「范围算得对」不等于测了「按范围重排跑得通」**。
fn copy_subtree(tree: &LayoutTree, idx: NodeIndex, out: &mut LayoutTree, parent_new: NodeIndex) -> NodeIndex {
    let mut cloned = tree.get(idx).clone();
    cloned.parent = NO_PARENT;      // ★清空：由下面按**新树索引**重建
    cloned.children.clear();        // ★清空：旧索引在新树里无意义（越界或指向无关节点）
    let new_idx = out.push(cloned);
    if parent_new != NO_PARENT {
        out.nodes[new_idx as usize].parent = parent_new;
        out.nodes[parent_new as usize].children.push(new_idx);
    }
    // ★按值取子级列表（`tree.get(idx)` 的借用与 `out` 可变借用不冲突，但显式 clone 更清晰）
    let children: Vec<NodeIndex> = tree.get(idx).children.clone();
    for c in children {
        copy_subtree(tree, c, out, new_idx);
    }
    new_idx
}

// ── 映射辅助（集中放置，便于审查）──

fn dim(v: Option<f32>, ratio: Option<f32>) -> Dimension {
    match (v, ratio) {
        (Some(v), _) => length(v),
        (None, Some(r)) => percent(r),
        _ => auto(),
    }
}

/// `min_size`/`max_size` 的映射（`LengthPercentageAuto` 而非 `Dimension`）
fn opt_lpa(v: Option<f32>) -> LengthPercentageAuto {
    v.map(length).unwrap_or(auto())
}

fn parse_justify(s: &str) -> JustifyContent {
    match s {
        "center" => JustifyContent::CENTER,
        "flex-end" | "end" => JustifyContent::FLEX_END,
        "space-between" => JustifyContent::SPACE_BETWEEN,
        "space-around" => JustifyContent::SPACE_AROUND,
        "space-evenly" => JustifyContent::SPACE_EVENLY,
        _ => JustifyContent::FLEX_START,
    }
}

fn parse_align_items(s: &str) -> AlignItems {
    match s {
        "center" => AlignItems::CENTER,
        "flex-start" | "start" => AlignItems::FLEX_START,
        "flex-end" | "end" => AlignItems::FLEX_END,
        "baseline" => AlignItems::BASELINE,
        _ => AlignItems::STRETCH,
    }
}

/// taffy 0.14 的 `Overflow` 是 `Visible | Clip | Hidden | Scroll`（**无 Auto**）
/// —— `auto` 语义（"需要时才出滚动条"）落为 `Scroll`（滚动区语义一致，滚动条呈现由平台决定）
fn parse_overflow(o: Overflow) -> taffy::Overflow {
    match o {
        Overflow::Visible => taffy::Overflow::Visible,
        Overflow::Hidden => taffy::Overflow::Hidden,
        Overflow::Scroll | Overflow::Auto => taffy::Overflow::Scroll,
    }
}

fn to_taffy_space(a: AvailableSpace) -> TaffyAvailableSpace {
    match a {
        AvailableSpace::MaxContent => TaffyAvailableSpace::MaxContent,
        AvailableSpace::Definite(v) => TaffyAvailableSpace::Definite(v),
    }
}

#[cfg(test)]
mod cache_key_tests {
    use super::*;
    use crate::node::TextMeasureRequest;

    /// ★★回归锁：**空文本字面量必须回退节点寻址**（本仓实测踩到的陷阱）
    ///
    /// 背景：golden 场景的文本节点是 `text: ""`（真值由「按 id 查表」提供），
    /// 若把它当「内容已知」→ 所有文本节点 hash 到**同一个空串** →
    /// **不同文本错误共用缓存项** → 几何错乱（实测 conformance 文本用例全红，max_delta 12.6dp）。
    #[test]
    fn empty_literal_falls_back_to_node_addressing() {
        let mk_text = |id: u32, literal: &str| {
            let mut n = LNode::new(id, LStyle::default());
            n.text = Some(TextMeasureRequest { text: literal.to_string(), style_key: 0 });
            n
        };
        // 三个文本节点：两个空串（内容未知）+ 一个有字面量
        let a = mk_text(2, "");
        let b = mk_text(3, "");
        let c = mk_text(4, "hello");
        let hashes = hash_for_tests(&[a, b, c]);
        assert_ne!(hashes[0], hashes[1], "★空串节点之间必须**不共用**缓存键（回退节点寻址）");
        assert_ne!(hashes[0], hashes[2], "空串节点与有字面量节点也必须隔离");
    }

    /// ★内容寻址：**相同非空字面量必须共用**缓存键（这是优化的收益来源）
    #[test]
    fn same_literal_shares_cache_key() {
        let mk = |id: u32| {
            let mut n = LNode::new(id, LStyle::default());
            n.text = Some(TextMeasureRequest { text: "item".to_string(), style_key: 0 });
            n
        };
        let hashes = hash_for_tests(&[mk(10), mk(20)]);
        assert_eq!(hashes[0], hashes[1], "★同文案应共用缓存键（内容寻址的收益）");
    }

    /// ★字体维度进键：同文案不同字体签名必须**不共用**
    #[test]
    fn different_style_key_shares_nothing() {
        let mk = |id: u32, sk: u32| {
            let mut n = LNode::new(id, LStyle::default());
            n.text = Some(TextMeasureRequest { text: "item".to_string(), style_key: sk });
            n
        };
        let hashes = hash_for_tests(&[mk(10, 0), mk(20, 7)]);
        assert_ne!(hashes[0], hashes[1], "★字体签名必须参与缓存键（Profile §5.3）");
    }
}
