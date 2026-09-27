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
    /// ★度量记忆化：`node_id → (max_width 位表示 → Size)`
    measure_cache: HashMap<u32, HashMap<u32, Size>>,
    /// 本轮 measure 调用**总次数**（未命中缓存的次数）——D3 判据的可观测读数
    measure_calls: usize,
    /// 缓存命中次数（增量效果的直接读数）
    measure_hits: usize,
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
        Self { measurer: None, measure_cache: HashMap::new(), measure_calls: 0, measure_hits: 0, taffy_ids: Vec::new() }
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
        self.measure_cache.values().map(|m| m.len()).sum()
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
        let TaffyEngine { measurer, measure_cache, measure_calls, measure_hits, taffy_ids } = self;
        *measure_calls = 0;
        *measure_hits = 0;

        let avail = taffy::Size { width: to_taffy_space(constraint.width), height: to_taffy_space(constraint.height) };
        let nodes: &[LNode] = &tree.nodes;

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
                                let Some(node) = nodes.iter().find(|n| n.id == nid) else {
                                    return taffy::Size { width: 0.0, height: 0.0 };
                                };
                                let Some(req) = &node.text else {
                                    return taffy::Size { width: 0.0, height: 0.0 };
                                };

                                // 度量可用的最大宽：已知宽优先，其次父宽，否则不限
                                let max_w = known.width.or(avail.width.into_option()).unwrap_or(f32::INFINITY);
                                let key = if max_w.is_finite() { max_w.to_bits() } else { f32::INFINITY.to_bits() };

                                let per_node = measure_cache.entry(nid).or_default();
                                if let Some(s) = per_node.get(&key) {
                                    *measure_hits += 1;
                                    return taffy::Size { width: s.width, height: s.height };
                                }
                                let measured = match measurer.as_mut() {
                                    Some(m) => m.measure(node, &req.text, max_w),
                                    None => Size::default(),
                                };
                                *measure_calls += 1;
                                per_node.insert(key, measured);
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
        let scope = self.relayout_scope_of(tree, dirty);

        // 边界有显式宽高 ⇒ 根约束就是它自己的尺寸（这正是「边界」的定义）
        let scope_style = tree.get(scope).style.clone();
        let constraint = RootConstraint::definite(
            scope_style.width.unwrap_or(f32::INFINITY),
            scope_style.height.unwrap_or(f32::INFINITY),
        );

        // 取子树 + 前序索引映射（一次 O(范围)，避免逐节点重扫）
        let order = preorder(tree, scope);
        let mut sub = LayoutTree::new();
        let root_new = copy_subtree(tree, scope, &mut sub, NO_PARENT);
        sub.roots.push(root_new);

        let mut sub_engine = TaffyEngine::new();
        if let Some(m) = self.measurer.take() {
            sub_engine.set_measurer(m);
        }
        let out = sub_engine.layout(&mut sub, constraint);

        // 结果平移回原树（子树的绝对原点 = 范围节点在原树中的相对位置）
        let origin = tree.get(scope).rect;
        let mut rects: Vec<Option<Rect>> = vec![None; tree.len()];
        let mut count = 0usize;
        for (sub_idx, r) in out.rects.iter().enumerate() {
            let Some(r) = r else { continue };
            let Some(&orig) = order.get(sub_idx) else { continue };
            let shifted = Rect { x: origin.x + r.x, y: origin.y + r.y, width: r.width, height: r.height };
            tree.nodes[orig as usize].rect = shifted;
            tree.nodes[orig as usize].dirty = false;
            rects[orig as usize] = Some(shifted);
            count += 1;
        }

        // 度量缓存合并回主引擎（子树算过的成果不丢）
        if let Some(m) = sub_engine.measurer.take() {
            self.measurer = Some(m);
        }
        for (node_id, per) in sub_engine.measure_cache {
            let dst = self.measure_cache.entry(node_id).or_default();
            for (k, v) in per {
                dst.insert(k, v);
            }
        }

        LayoutOutput { rects, measure_calls: out.measure_calls, measure_hits: out.measure_hits, relayout_count: count }
    }

    fn name(&self) -> &'static str {
        "taffy-0.14"
    }
}

impl TaffyEngine {
    /// 沿 parent 链向上找**最高的布局边界**；没有则用树根（§5.4 T2 的核心机制）
    pub fn relayout_scope_of(&self, tree: &LayoutTree, dirty: NodeIndex) -> NodeIndex {
        let mut cur = dirty;
        let mut boundary: Option<NodeIndex> = None;
        loop {
            let node = tree.get(cur);
            if node.is_layout_boundary() {
                boundary = Some(cur);
            }
            if node.parent == NO_PARENT {
                break;
            }
            cur = node.parent;
        }
        boundary.unwrap_or(cur)
    }
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
fn copy_subtree(tree: &LayoutTree, idx: NodeIndex, out: &mut LayoutTree, parent_new: NodeIndex) -> NodeIndex {
    let new_idx = out.push(tree.get(idx).clone());
    if parent_new != NO_PARENT {
        out.nodes[new_idx as usize].parent = parent_new;
        out.nodes[parent_new as usize].children.push(new_idx);
    }
    for i in 0..tree.get(idx).children.len() {
        let c = tree.get(idx).children[i];
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
