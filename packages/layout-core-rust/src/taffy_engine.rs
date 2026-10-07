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
use taffy::prelude::{auto, fr, length, percent, AlignContent, AlignItems, AlignSelf, BoxSizing, Dimension, JustifyContent, LengthPercentageAuto};
// ★批次 41 / ★★★2026-10-08：grid item 放置（GridPlacement::from_line_index / from_span）
use taffy::style_helpers::{TaffyGridLine, TaffyGridSpan};
use taffy::{AvailableSpace as TaffyAvailableSpace, NodeId, Style, TaffyTree};

use crate::engine::{AvailableSpace, LayoutEngine, LayoutOutput, RootConstraint, TextMeasurer};
use crate::node::{LayoutTree, LNode, NodeIndex, NO_PARENT};
use crate::style::{Display, FlexDirection, FlexWrap, GridLine, LStyle, Overflow, Position, Rect, Size};

/// ★★★2026-10-08（网格轨道项）：IR `GridLine` → taffy `Line<GridPlacement>`。
///   `span <n>` ⇒ `GridPlacement::Span`（跨 n 轨）；起点缺省 = Auto（自动放置起）；线号 ⇒ Line。
///   CSS 语义：`span 2` ⇒ start=Span(2)/end=Auto；`1 / span 2` ⇒ start=Line(1)/end=Span(2)。
fn grid_line_of(gl: GridLine) -> taffy::Line<taffy::GridPlacement> {
    let start = if let Some(s) = gl.start {
        taffy::GridPlacement::from_line_index(s)
    } else if let Some(n) = gl.span {
        taffy::GridPlacement::from_span(n)
    } else {
        taffy::GridPlacement::Auto
    };
    let end = if let Some(e) = gl.end {
        taffy::GridPlacement::from_line_index(e)
    } else if gl.start.is_some() && gl.span.is_some() {
        // `1 / span 2`：起线已知、跨度已知 ⇒ 终点 = Span
        taffy::GridPlacement::from_span(gl.span.unwrap())
    } else {
        taffy::GridPlacement::Auto
    };
    taffy::Line { start, end }
}

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
    /// ★多范围重排的**相位累加**（每个范围累加 copy/solve/writeback/merge——见 phases_mut）
    pub phase_acc: std::collections::BTreeMap<&'static str, f64>,
    /// ★★**持久 taffy 树**（真增量的载体——本仓实测：每轮重建 ⇒ 丢失 taffy 内部缓存）
    ///
    /// 【为什么必须有它（本仓实测的量化依据）】同形状 2001 节点树的基准（`examples/taffy-floor-bench.rs`）：
    ///   · 每轮**重建** taffy 树 + 求解：**2.96ms**
    ///   · 保留树 + **只 set 变更节点** + 求解：**0.089ms**（**33×**）
    ///   而本仓的 `layout_incremental` 此前**每个范围都新建一棵 taffy 树**（`layout_subtree_and_writeback`
    ///   里 `TaffyEngine::new()` + `build_taffy`）⇒ S4 形态（300 个文本范围）每个范围白付一次
    ///   taffy 建树固定成本（桌面 3.3µs／范围 · 真机约 30µs × 300 ≈ 9ms，正是设备读数）。
    ///   ⇒ 正解：树**随句柄持久**，每次只 `set_style(变更节点)` 后求解（taffy 自己的缓存生效）。
    ///
    /// 【失效条件（任一 ⇒ 整棵重建）】`taffy_ids.len() != tree.len()`（结构变更：splice 增删）。
    /// 【安全前提】调用方必须把**所有被改过 style 的节点**经 `sync_styles` 告知——
    ///   本仓的 FFI 路径（patch/ops/splice）都满足（改动与脏节点一一对应）；
    ///   `layout()` 公开入口保持"整棵重建"语义（外部调用方可能任意改 style，不做假设）。
    persistent_taffy: Option<TaffyTree<u32>>,
    /// ★★V5 平移传播：本轮的**变化根**（脏子树根 + 被平移的兄弟）
    ///
    /// 【为什么需要】常规增量的"变化集"就是 scope 子树；而平移传播下，
    ///   变化的是「脏子树 ∪ 若干直接兄弟」——收集层必须按这个集合取矩形，
    ///   否则会漏掉被平移的兄弟（宿主不更新其位置 ⇒ **画面停在旧位置**）。
    ///   空 = 走常规 scope 语义。
    pub last_changed_roots: Vec<NodeIndex>,
    /// ★★最近一次平移传播**被拒绝的原因**（`None` = 未被拒绝/未尝试）
    ///
    /// 【为什么必须可观测】六条前提是"能证明才激进"的落点；若某条守卫**从未被触发**，
    ///   就等于**没有被测试覆盖**（本仓实测：首轮破坏"无视 grow 前提"时测试全绿 ⇒ 守卫未被触发）。
    ///   ⇒ 把它暴露出来，让每条守卫都有对应用例可断言。
    pub translation_reject: Option<&'static str>,
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
            phase_acc: std::collections::BTreeMap::new(),
            persistent_taffy: None,
            last_changed_roots: Vec::new(),
            translation_reject: None,
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

        // ② display（CSS 无盒 / 栅格）
        out.display = match style.display {
            Display::Flex => taffy::Display::Flex,
            Display::Grid => taffy::Display::Grid,
            Display::None => taffy::Display::None,
        };
        // ★批次 12（CSS Grid）：显式轨迹（`1fr 1fr 200px`）→ taffy grid_template_*（仅 grid 容器）
        if matches!(style.display, Display::Grid) {
            if let Some(cols) = style.grid_template_columns.as_deref() {
                out.grid_template_columns = parse_grid_tracks(cols);
            }
            if let Some(rows) = style.grid_template_rows.as_deref() {
                out.grid_template_rows = parse_grid_tracks(rows);
            }
            // ★★★grid-auto-columns/rows 项（2026-10-08）：**隐式轨道尺寸**（taffy GridTrackVec<TrackSizingFunction>）
            if let Some(ac) = style.grid_auto_columns.as_deref() {
                out.grid_auto_columns = parse_auto_tracks(ac);
            }
            if let Some(ar) = style.grid_auto_rows.as_deref() {
                out.grid_auto_rows = parse_auto_tracks(ar);
            }
            if let Some(gaf) = style.grid_auto_flow.as_deref() {
                out.grid_auto_flow = parse_grid_auto_flow(gaf);
            }
            // ★★★grid-template-areas 项（2026-10-08）：命名区域模板 → taffy GridTemplateAreas
            //   （taffy 把每个区域名解析成 `{名}-start`/`{名}-end` 命名线，供子项 NamedLine 引用）
            if let Some(a) = style.grid_template_areas.as_deref() {
                if let Some(t) = parse_grid_template_areas(a) {
                    out.grid_template_areas = Some(t);
                }
            }
        }

        // ★批次 41：grid item 放置（grid-column / grid-row 线号 → taffy Line<GridPlacement>）——
        //   对**容器里的 item** 生效（taffy 忽略非 grid 子项的该属性，故无需 display 门控）。
        //   ★★★grid-area 项（2026-10-08）：命名区域引用 `grid-area: <name>` ⇒ 四边同名命名线（taffy
        //   NamedLineResolver 解析为区域跨列/跨行的 start/end）。★CSS 语义：长手 grid-column/grid-row
        //   **覆盖** grid-area 的对应轴 ⇒ 先落命名线、再由下面的长手覆盖（顺序即优先级）。
        if let Some(name) = style.grid_area.as_deref() {
            let line = taffy::Line {
                start: taffy::GridPlacement::NamedLine(name.to_string(), 0),
                end: taffy::GridPlacement::NamedLine(name.to_string(), 0),
            };
            out.grid_column = line.clone();
            out.grid_row = line;
        }
        if let Some(gl) = style.grid_column {
            out.grid_column = grid_line_of(gl);
        }
        if let Some(gl) = style.grid_row {
            out.grid_row = grid_line_of(gl);
        }

        // ③ flex 主轴 / 对齐 / 伸缩
        out.flex_direction = match style.flex_direction {
            FlexDirection::Row => taffy::FlexDirection::Row,
            FlexDirection::Column => taffy::FlexDirection::Column,
            FlexDirection::RowReverse => taffy::FlexDirection::RowReverse,
            FlexDirection::ColumnReverse => taffy::FlexDirection::ColumnReverse,
        };
        // ★批次 6：`flex-wrap`（taffy 原生支持）
        out.flex_wrap = match style.flex_wrap {
            FlexWrap::Nowrap => taffy::FlexWrap::NoWrap,
            FlexWrap::Wrap => taffy::FlexWrap::Wrap,
            FlexWrap::WrapReverse => taffy::FlexWrap::WrapReverse,
        };
        out.justify_content = Some(parse_justify(&style.justify_content));
        out.align_items = Some(parse_align_items(&style.align_items));
        // ★批次 11：`align-content`（多行容器行间对齐）
        out.align_content = Some(parse_align_content(&style.align_content));
        if let Some(a) = style.align_self.as_deref() {
            out.align_self = Some(parse_align_items(a));
        }
        // ★★★justify-self 项（2026-10-06）：网格项行内轴自对齐（taffy 原生字段；仅 grid 计算路径消费——
        //   与 Web「flex 容器下被忽略」同语义）。`auto`/缺省 ⇒ 不设（回落父 justify-items）。
        if let Some(j) = style.justify_self.as_deref() {
            if j != "auto" {
                out.justify_self = Some(parse_justify_self(j));
            }
        }
        // ★★★place-items/justify-items 项（2026-10-08）：网格容器内子项「行内轴」对齐（taffy 原生；仅 grid 消费）。
        if let Some(j) = style.justify_items.as_deref() {
            out.justify_items = Some(parse_justify_items(j));
        }
        out.flex_grow = style.flex_grow;
        out.flex_shrink = style.flex_shrink;
        out.flex_basis = match (style.flex_basis, style.flex_basis_ratio) {
            (Some(b), _) => length(b),
            (None, Some(r)) => percent(r),
            _ => auto(),
        };
        // ★批次 31：`gap` 为基值（两轴同），`row-gap`/`column-gap` 为轴级覆盖；任一非零都要应用
        if style.gap != 0.0 || style.row_gap.is_some() || style.column_gap.is_some() {
            out.gap = taffy::Size {
                width: length(style.column_gap.unwrap_or(style.gap)),
                height: length(style.row_gap.unwrap_or(style.gap)),
            };
        }

        // ④ 尺寸（比例以父内容盒为基准——spike 已验证）
        out.size = taffy::Size { width: dim(style.width, style.width_ratio), height: dim(style.height, style.height_ratio) };
        // ★注意类型差异：`size` 用 `Dimension`，而 `min_size`/`max_size` 用 `LengthPercentageAuto`
        //   （后者额外允许 `auto` 关键字）——两者不可混用，这里分别映射。
        // ★批次 19（CSS 兼容对齐 · 以 Web 为基准）：min/max 支持**百分比**（`ltp` = length-or-percent-or-auto）
        out.min_size = taffy::Size {
            width: ltp(style.min_width, style.min_width_pct, length(0.0)),
            height: ltp(style.min_height, style.min_height_pct, length(0.0)),
        };
        // ★max 未指定**必须**是 `auto`（= 无上限）——与 min 相反：清零会让所有节点被压成 0。
        //   ⇒ max 用各自独立的映射（`None → auto()`），**不可**复用上面的 `opt_lpa`。
        out.aspect_ratio = style.aspect_ratio; // ★批次 24（CSS 兼容对齐）：宽高比（taffy 原生）
        out.max_size = taffy::Size {
            width: ltp(style.max_width, style.max_width_pct, auto()),
            height: ltp(style.max_height, style.max_height_pct, auto()),
        };

        // ⑤ 盒模型
        out.padding = taffy::Rect {
            left: length(style.padding.left),
            right: length(style.padding.right),
            top: length(style.padding.top),
            bottom: length(style.padding.bottom),
        };
        // ★批次 17（CSS 兼容对齐 · 以 Web 为基准）：margin 的 auto（`margin: 0 auto` 水平居中）——
        //   margin_auto 标记的边映射为 taffy 的 `auto()`（吸收剩余空间）；其余边用 f32 length。
        let m_auto = |is_auto: bool, v: f32| -> LengthPercentageAuto { if is_auto { auto() } else { length(v) } };
        out.margin = taffy::Rect {
            left: m_auto(style.margin_auto.left, style.margin.left),
            right: m_auto(style.margin_auto.right, style.margin.right),
            top: m_auto(style.margin_auto.top, style.margin.top),
            bottom: m_auto(style.margin_auto.bottom, style.margin.bottom),
        };

        // ⑥ 定位：absolute 的 inset 相对**父 padding 盒**
        match style.position {
            Position::Absolute => {
                out.position = taffy::Position::Absolute;
                out.inset = taffy::Rect {
                    left: style.left.map(length).unwrap_or(auto()),
                    right: style.right.map(length).unwrap_or(auto()),
                    top: style.top.map(length).unwrap_or(auto()),
                    bottom: style.bottom.map(length).unwrap_or(auto()),
                };
            }
            Position::Relative => {
                out.position = taffy::Position::Relative;
                out.inset = taffy::Rect {
                    left: style.left.map(length).unwrap_or(auto()),
                    right: style.right.map(length).unwrap_or(auto()),
                    top: style.top.map(length).unwrap_or(auto()),
                    bottom: style.bottom.map(length).unwrap_or(auto()),
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
        // ★★再连父子：**按 `children` 的顺序**（布局顺序 = 绘制顺序 = children 顺序）
        //
        // 【为什么不信"数组顺序"（本仓实测的架构限制）】首版按 `tree.nodes` 的**数组序**连父子，
        //   注释写着"顺序 = children 顺序"但实现是遍历数组 ⇒ **数组序即布局序**
        //   ⇒ 想插到中间就必须搬数组（O(n)，且 `taffy_ids` 按数组索引对齐会全乱）。
        //   这正是 splice"只支持追加"的根因（其注释里记录了当时的取舍）。
        //   ⇒ 正解：**只以 `children` 为单一事实来源**（`add_child`/splice 都维护它），
        //     数组顺序退化为无关的实现细节 ⇒ 中间插入只需在父的 `children` 里插一项（O(1)）。
        //   ★前提：`parent` 与 `children` 双向一致——已由输入图校验强制（见 `build_tree` ④）。
        for (idx, node) in tree.nodes.iter().enumerate() {
            for &c in &node.children {
                taffy
                    .add_child(ids[idx], ids[c as usize])
                    .expect("taffy: add_child");
            }
        }

        self.taffy_ids = ids;
        taffy
    }

    /// 执行一轮 taffy 布局（含度量回调）
    fn run_taffy(&mut self, tree: &LayoutTree, taffy: &mut TaffyTree<u32>, roots: &[NodeIndex], constraint: RootConstraint) -> LayoutOutput {
        self.run_taffy_impl(tree, taffy, roots, constraint, true)
    }

    /// `run_taffy` 的实现（`readback` 控制是否做**整树**回读——范围求解不需要，见调用点注释）
    fn run_taffy_impl(
        &mut self,
        tree: &LayoutTree,
        taffy: &mut TaffyTree<u32>,
        roots: &[NodeIndex],
        constraint: RootConstraint,
        readback: bool,
    ) -> LayoutOutput {
        // ★字段级解构：让 `measurer` 与 `measure_cache` 同时可变借用（互不相交）
        let TaffyEngine { measurer, measure_cache, measure_calls, measure_hits, taffy_ids, last_root_constraint: _, last_phases: _, last_changed_roots: _, translation_reject: _, phase_acc: _, persistent_taffy: _ } = self;
        *measure_calls = 0;
        *measure_hits = 0;

        let avail = taffy::Size { width: to_taffy_space(constraint.width), height: to_taffy_space(constraint.height) };
        let nodes: &[LNode] = &tree.nodes;
        // ★id → 节点索引（供回调 O(1) 直取；见回调内说明）
        // ★★只装**文本节点**（本仓实测的性能缺陷：此前装全部节点）
        //   【为什么语义不变】度量回调对非文本节点本就返回 (0,0)（见回调内 `node.text` 分支），
        //   故非文本节点**从不被查**。装全部 = 每个范围白付 O(整树) 次哈希插入
        //   （S4 形态 300 个范围 × 2001 节点 ≈ 60 万次）。
        let t_idx0 = std::time::Instant::now();
        let text_count = nodes.iter().filter(|n| n.text.is_some()).count();
        let mut id_index: HashMap<u32, u32> = HashMap::with_capacity(text_count);
        for (i, n) in nodes.iter().enumerate() {
            if n.text.is_some() {
                id_index.insert(n.id, i as u32);
            }
        }
        let t_idx = t_idx0.elapsed().as_secs_f64() * 1000.0;
        // ★★度量缓存键的第一维（Profile §5.3「文本 hash + 字体」）——按节点索引平行存放。
        //
        // ★★**内容寻址 vs 节点寻址的取舍**（本仓实测踩到，值得记）：
        //   · 文本**字面量已知**时 → 用「文本 hash ⊕ 字体签名」= **内容寻址**
        //     → 2000 个同文案节点只需真实度量 **1–2 次**（实测：4000 → 2）
        //   · 文本**字面量未知**时（golden 用例只给 `isText` 标记 + 按 id 查度量表）
        //     → **必须回退节点寻址**（用 node_id）
        //     ✗ 若在此时仍填 0：**所有文本节点的键相同** → 不同文本错误共用缓存项
        //       → 几何错乱（本仓实测：conformance 17 用例里文本相关全部失败，max_delta 12.6dp）
        let t_hash0 = std::time::Instant::now();
        let text_hashes = compute_text_hashes(nodes);
        let t_hash = t_hash0.elapsed().as_secs_f64() * 1000.0;

        let t_compute0 = std::time::Instant::now();
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

        let t_compute = t_compute0.elapsed().as_secs_f64() * 1000.0;
        let t_rb0 = std::time::Instant::now();
        // 回写矩形（taffy 的 location 已是「相对父内容盒」——与我们的坐标约定一致）
        // ★`readback=false` 时**不读**（范围求解由调用方只回读其子树——否则每范围 O(整树)）
        let mut rects: Vec<Option<Rect>> = if readback { vec![None; tree.len()] } else { Vec::new() };
        for (idx, taffy_id) in taffy_ids.iter().enumerate() {
            if !readback { break; }
            if let Ok(layout) = taffy.layout(*taffy_id) {
                rects[idx] = Some(Rect {
                    x: layout.location.x,
                    y: layout.location.y,
                    width: layout.size.width,
                    height: layout.size.height,
                });
            }
        }
        // ★run_taffy 的内部三段（本仓实测：整树重排 93% 在 run_taffy，需再拆才能定位）
        //   注意：`self` 被上方字段级解构借用，故这里用 `last_phases`（BTreeMap<String,_>）
        //   而不是 `phases_mut`；只在**非空**时写，避免热路径字符串分配。
        if std::env::var_os("PROTEUS_PHASE_TRACE").is_some() {
            self.last_phases.insert("run_idx_ms".into(), t_idx);
            self.last_phases.insert("run_hash_ms".into(), t_hash);
            self.last_phases.insert("run_compute_ms".into(), t_compute);
            self.last_phases.insert("run_readback_ms".into(), t_rb0.elapsed().as_secs_f64() * 1000.0);
        }
        LayoutOutput { rects, measure_calls: *measure_calls, measure_hits: *measure_hits, relayout_count: tree.len() }
    }

    /// ★★确保持久 taffy 树与当前树结构一致（不一致 ⇒ 整棵重建）
    ///
    /// 【判据】`taffy_ids.len() == tree.len()`——splice 增删节点会让长度变化 ⇒ 重建。
    ///   （更细的结构变更如"顺序调整"不在本版支持范围：splice 只支持追加/摘除，见其实现。）
    fn ensure_persistent(&mut self, tree: &LayoutTree) {
        let stale = match &self.persistent_taffy {
            None => true,
            Some(_) => self.taffy_ids.len() != tree.len(),
        };
        if stale {
            let t = self.build_taffy(tree);   // 同时更新 self.taffy_ids
            self.persistent_taffy = Some(t);
        }
    }

    /// ★★把**变更节点**的 style 同步进持久 taffy（只同步这些 ⇒ taffy 缓存得以复用）
    fn sync_styles(&mut self, tree: &LayoutTree, changed: &[NodeIndex]) {
        let Some(t) = self.persistent_taffy.as_mut() else { return };
        for &i in changed {
            if let Some(&id) = self.taffy_ids.get(i as usize) {
                let st = Self::to_taffy(&tree.get(i).style);
                let _ = t.set_style(id, st);
            }
        }
    }

    /// ★★在**持久树**上做整树求解（根范围的退化路径用；此前是"重建整棵树再求解"）
    fn layout_cached(&mut self, tree: &mut LayoutTree, constraint: RootConstraint, changed: &[NodeIndex]) -> LayoutOutput {
        self.last_root_constraint = Some(constraint);
        // ★分段埋点（本仓实测：`layout_cached` 此前**无任何内部埋点** ⇒ 真机 17ms 无法归因，
        //   我只能看到"总耗时"——这正是本仓纪律「任何 >5ms 的分段都必须再拆」的对象）
        let t_a0 = std::time::Instant::now();
        self.ensure_persistent(tree);
        let t_ensure = t_a0.elapsed().as_secs_f64() * 1000.0;
        let t_b0 = std::time::Instant::now();
        self.sync_styles(tree, changed);
        let t_sync = t_b0.elapsed().as_secs_f64() * 1000.0;
        let roots = tree.roots.clone();
        // ★借用顺序：`run_taffy` 需要 `&mut self` ⇒ 先把持久树**取出来**、用完放回
        //   （Rust 不允许同时可变借用 `self` 与 `self` 的字段）
        let mut taffy = self.persistent_taffy.take().expect("ensure_persistent 已建树");
        let out = self.run_taffy(tree, &mut taffy, &roots, constraint);
        self.persistent_taffy = Some(taffy);
        let t_run = t_a0.elapsed().as_secs_f64() * 1000.0;
        let t_c0 = std::time::Instant::now();
        self.write_back(tree, &out);
        let t_wb = t_c0.elapsed().as_secs_f64() * 1000.0;
        *self.phases_mut("cached_ensure_ms") += t_ensure;
        *self.phases_mut("cached_sync_ms") += t_sync;
        *self.phases_mut("cached_run_ms") += t_run - t_ensure - t_sync;
        *self.phases_mut("cached_writeback_ms") += t_wb;
        out
    }

    /// ★★在**持久树**上只重排某范围子树（非根范围用；替代"拷贝子树 + 子引擎"）
    ///
    /// 【与旧实现（拷贝法）的等价性】拷贝法是「把范围子树复制成一棵新树，以 definite(范围尺寸) 求解」；
    ///   本方法是在同一棵树里对该子树根调用求解——**同一纯函数**（style + 可用空间 ⇒ 布局）
    ///   ⇒ 结果一致。差别只在：不复制、不重建，taffy 缓存可复用。
    fn layout_subtree_cached(
        &mut self,
        tree: &mut LayoutTree,
        scope: NodeIndex,
        constraint: RootConstraint,
        changed: &[NodeIndex],
    ) -> LayoutOutput {
        let _ = changed;   // 拷贝法自带完整 style ⇒ 无需 sync（见方法注释）
        // ★★**范围求解必须"拷贝子树 + 独立子引擎"**（本仓实测：真增量在**范围**场景更慢）
        //
        // 【为什么不用持久大树求解某个范围】尝试过：`ensure_persistent` + 对该范围根调
        //   `taffy.compute_layout(scope_id, definite)`。实测**形态 A 从 1.5ms 恶化到 8.1ms**
        //   ——因为 taffy 的脏标记会**向上传播到根**，对 500 行大树里的一个小范围求解，
        //   taffy 仍会重算整条祖先链（甚至整树），而拷贝法只解"范围子树"（4 节点）。
        //   ⇒ 范围场景的正确姿势是**把范围子树隔离出来解**（本实现）；taffy 的持久树增量
        //     只在"整树重排"场景有优势（见 `layout_cached` 的注释与基准数据）。
        //
        // ⚠ 另一处实测教训（保留在此以免后人重犯）：`run_taffy` 的**整树回读**是 O(整树)，
        //   多范围下要 60 万次 `layout()` 调用 ⇒ 范围求解必须只回读自己的子树（见下方循环）。
        let _ = &self.persistent_taffy;
        let t_phase0 = std::time::Instant::now();
        let (out, _scope_size) = self.layout_subtree_and_writeback(tree, scope, constraint);
        let _ = t_phase0;
        out
    }

    /// 引擎内 taffy 树的节点数（调用方判"结构是否与 LayoutTree 一致"用）
    pub fn taffy_id_len(&self) -> usize {
        self.taffy_ids.len()
    }

    /// 丢弃持久 taffy 树（结构变更后调用：下次求解会重建）
    pub fn invalidate_persistent(&mut self) {
        self.persistent_taffy = None;
        self.taffy_ids.clear();
    }

    /// 度量缓存项数（诊断：判定"持久引擎是否复用了缓存"）
    pub fn measure_cache_len(&self) -> usize {
        self.measure_cache.len()
    }

    /// 是否已持有持久 taffy 树（诊断：判定预建是否生效）
    pub fn has_persistent(&self) -> bool {
        self.persistent_taffy.is_some()
    }

    /// 相位累加器（多范围重排下**累加**每一段的耗时——单个范围的数字会淹没在噪声里）
    /// ★键用 `&'static str`（本仓实测：String 键在多范围下**每范围 5 次堆分配**，
    ///   300 个范围 = 1500 次分配 —— 比它要测的东西还贵）
    pub fn phases_mut(&mut self, key: &'static str) -> &mut f64 {
        // 注意：这里用独立的 `phase_acc` 而不是 `last_phases`（后者是"最后一次"的语义）
        self.phase_acc.entry(key).or_insert(0.0)
    }

    /// 取相位累加快照（`relayout_multi` 结束后读它做归因）
    pub fn take_phase_acc(&mut self) -> std::collections::BTreeMap<&'static str, f64> {
        std::mem::take(&mut self.phase_acc)
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
        // ★分段埋点（全量路径是类B/无边界形态的主成本；本仓纪律：先拆再优化）
        let t_b0 = std::time::Instant::now();
        // ★★**把建的 taffy 树留在 `persistent_taffy`**（本仓实测的真缺陷，一行修复）
        //
        // 【故障链（诊断一锤定音）】首版 `let mut taffy = self.build_taffy(tree)` 是**局部变量**
        //   ——方法结束即 drop。于是 `persistent_taffy` **永远是 None** ⇒ 每次增量重排
        //   都走 `ensure_persistent` → **重建整棵 taffy 树**（真机 5002 节点）
        //   + **度量缓存是空的** ⇒ 4001 次 miss（真机 `relayout_ms=17ms`）。
        //   `engine_diag` 的铁证：`has_persistent: false, cache_len: 0, taffy_len_before: 5002`
        //   —— 即"taffy_ids 有 5002 项（build 过）但持久树是 None"。
        //   ⇒ 正解：`layout()` 建完就把它存进 `persistent_taffy`：
        //     这样 create 的"预建"才真正生效（首帧那次整树求解的成果被后续增量复用）。
        let mut taffy = self.build_taffy(tree);
        let t_build = t_b0.elapsed().as_secs_f64() * 1000.0;
        let t_r0 = std::time::Instant::now();
        let out = self.run_taffy(tree, &mut taffy, &roots, constraint);
        let t_run = t_r0.elapsed().as_secs_f64() * 1000.0;
        // ★存下（含首帧算出的度量缓存 —— 这是"预建"的意义所在）
        self.persistent_taffy = Some(taffy);
        let t_w0 = std::time::Instant::now();
        self.write_back(tree, &out);
        let t_wb = t_w0.elapsed().as_secs_f64() * 1000.0;
        *self.phases_mut("full_build_ms") += t_build;
        *self.phases_mut("full_run_ms") += t_run;
        *self.phases_mut("full_writeback_ms") += t_wb;
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
    fn layout_incremental(&mut self, tree: &mut LayoutTree, dirty: &[NodeIndex]) -> LayoutOutput {
        debug_assert!(!dirty.is_empty(), "layout_incremental 收到空脏集合（调用方应先过滤）");
        let t_pro = std::time::Instant::now();
        // ★每轮清空（否则上一轮的平移痕迹会污染本轮的收集集合）
        self.last_changed_roots.clear();
        self.translation_reject = None;
        // ★范围由**首个**脏节点推出：调用方（relayout_multi_in）保证同组同范围
        //   （分组在那边完成）；若不同范围被误传进来，取首个仍安全（范围只会更大不更小）
        let scope = self.relayout_scope_of(tree, dirty[0]);

        // ★★先**同步持久树**（本仓实测的关键：真增量的正确性前提）
        //
        // 【为什么两条路径都要同步】持久 taffy 树是"整树重排"（根范围）的求解载体；
        //   而**范围重排走的是拷贝法**（把范围子树隔离出来解——实测比"在大树上解子树"快得多，
        //   因为 taffy 的脏标记会向上传播）。若范围路径**不同步**，那些节点的 style 就
        //   在持久树里**仍是旧值** ⇒ 后续某次整树重排会用旧 style 求解 ⇒ **静默错几何**。
        //   ⇒ 每条增量路径都把自己的脏节点同步进持久树（一次 set_style，成本可忽略）。
        if !self.taffy_ids.is_empty() {
            self.ensure_persistent(tree);
            // ★同步**整组**（不是首个代表）——见 trait 上的缺陷记录
            self.sync_styles(tree, dirty);
        }

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
            // ★平移传播是"单个子树整体位移"的优化；多脏节点时语义不成立 ⇒ 只在单脏时尝试
            if dirty.len() == 1 {
                if let Some(out) = self.try_translation_relayout(tree, dirty[0]) {
                    return out;
                }
            }
            // 复用最近一次全量布局的约束（首次无记录时用「紧尺寸」兜底：范围是整树，
            // 根若为 auto 尺寸，MaxContent 语义与全量首帧一致）
            let c = self.last_root_constraint.unwrap_or(RootConstraint {
                width: AvailableSpace::MaxContent,
                height: AvailableSpace::MaxContent,
            });
            // ★★真增量（本仓实测：整树重排里 79% 是"重建 taffy"的固定成本——
            //   保留树 + 只同步变更节点 ⇒ 同形状基准 2.96ms → 0.089ms）
            *self.phases_mut("prologue_ms") += t_pro.elapsed().as_secs_f64() * 1000.0;
            return self.layout_cached(tree, c, dirty);
        }

        // ★★**"范围覆盖整树"时走持久树**（本仓实测：真机 V0 白付了一次全量拷贝+重建）
        //
        // 【判据与依据】若从根到 scope 的路径上**每一级都只有一个子节点**，则 scope 的子树
        //   覆盖整棵树 ⇒ "隔离子树求解"与"整树求解"在拓扑上等价（无外部兄弟需要保持位置）。
        //   此时拷贝法纯属浪费：真机实测 `copy_ms=1.3ms` + 子引擎 `build_taffy`（7005 节点）
        //   + **丢失持久树缓存**（`solve_ms≈19ms`）。
        //
        // 【为什么不直接用 `scope == 根` 判据】本仓真机的 scope 常是根的**孙节点**
        //   （root → container → page(显式尺寸)）：它确实是"最近的布局边界"，
        //   但它同时覆盖整树 —— 两个条件都成立，应选**更省的那条路**。
        //
        // 【约束的安全性】scope 有显式尺寸（是布局边界）⇒ 它的尺寸与内容无关；
        //   而整树求解复用 `last_root_constraint`（= viewport definite）——
        //   当 scope 尺寸 == viewport 时二者等价；否则沿用"边界自身尺寸"更保守的语义
        //   ⇒ 这里仍用**scope 的实际尺寸**做定尺寸约束，只是把它施加在**持久树**上：
        //     scope 的父链尺寸不变 ⇒ 对 scope 施加 definite 求解 ⇒ 其结果就是范围结果。
        let is_sole_path = {
            let mut cur = scope;
            let mut sole = true;
            // 向上：只要某级祖先有 >1 个子节点 ⇒ scope 与"其它子树"并列 ⇒ 不能按整树处理
            while tree.get(cur).parent != NO_PARENT {
                let p = tree.get(cur).parent;
                if tree.get(p).children.len() != 1 {
                    sole = false;
                    break;
                }
                cur = p;
            }
            // 根自身也必须是唯一根（多根树里 scope 只覆盖其一）
            sole && tree.roots.len() == 1
        };
        // ★只有"范围确实覆盖了整棵树"时才走整树路径——**范围小的时候拷贝法更省**
        //   （本仓实测：单链 4 节点树上拷贝法本来就只有 5µs；而真机 7005/7005 时拷贝法要 20ms）
        //   判据：范围节点数 == 整树节点数（用 preorder 计数，只在 sole_path 时才做）
        // ★判据修正（本仓实测）：真机的 scope 常是 `root → container → page` 链上的 page，
        //   此时 `preorder(scope)` = 7005，而 `tree.len()` = **7007**（差 2 = root+container，
        //   即 scope 的**祖先链**本身）。它们不是"范围外的其它子树"，只是链上祖先！
        //   ⇒ 正确判据：**范围外只有祖先链、没有任何兄弟分支** ⟺
        //     `preorder(scope).len() + depth(scope) == tree.len()`
        //     （depth = 祖先链长度；每个祖先恰好贡献 1 个不在范围里的节点）
        let scope_nodes = if is_sole_path { preorder(tree, scope).len() } else { 0 };
        let mut depth = 0usize;
        {
            let mut cur = scope;
            while tree.get(cur).parent != NO_PARENT {
                cur = tree.get(cur).parent;
                depth += 1;
            }
        }
        // sole_path 已保证"没有兄弟分支"⇒ 范围外 = 祖先链 ⇒ 下面的等式成立即"覆盖除祖先外全部"
        //
        // ★**规模门槛（本仓实测的兼容性要求）**：拷贝法在小树上本就很快（4 节点 ~5µs），
        //   而 it 会因为"范围=全树"改变 `relayout_count` 的语义——已有浏览器对拍用例
        //   （`非零偏移链`，4 节点单链）据此断言"范围应为真子集"。
        //   ⇒ 只在**大范围**（≥512 节点）时才切换到整树持久树路径：
        //     收益（真机 7005 节点 20ms→期望 <1ms）只在此时存在；小树保持原语义（无语义漂移）。
        const SOLE_PATH_MIN_NODES: usize = 512;
        let covers_whole = is_sole_path
            && scope_nodes + depth == tree.len()
            && tree.len() >= SOLE_PATH_MIN_NODES;
        *self.phases_mut("diag_sole_path") += if is_sole_path { 1.0 } else { 0.0 };
        *self.phases_mut("diag_scope_nodes") += scope_nodes as f64;
        *self.phases_mut("diag_tree_nodes") += tree.len() as f64;
        *self.phases_mut("diag_scope_is_root") += if tree.get(scope).parent == NO_PARENT { 1.0 } else { 0.0 };
        if covers_whole {
            let scope_rect = tree.get(scope).rect;
            let (fb_w, fb_h) = {
                let n = tree.get(scope);
                (n.style.width, n.style.height)
            };
            let cw = if scope_rect.width > 0.0 { scope_rect.width } else { fb_w.unwrap_or(f32::INFINITY) };
            let ch = if scope_rect.height > 0.0 { scope_rect.height } else { fb_h.unwrap_or(f32::INFINITY) };
            *self.phases_mut("prologue_ms") += t_pro.elapsed().as_secs_f64() * 1000.0;
            *self.phases_mut("sole_path_ms") += 1.0;
            return self.layout_cached(tree, RootConstraint::definite(cw, ch), dirty);
        }

        // ★★根约束 = 该边界节点**上次布局的实际尺寸**（而不是它的声明尺寸）
        //
        // 【为什么不能用声明尺寸（本仓实测）】交叉轴 stretch 的节点**没有声明宽**
        //   （宽由父撑开）⇒ `style.width` 是 `None` ⇒ 用 `INFINITY` 会让子树按
        //   「不限宽」重排 → 内容换行/换行反推的尺寸全变 ⇒ **几何错**（不是慢，是错）。
        //   而边界的定义就是「对外尺寸与内容无关」⇒ 它上次的实际尺寸**本次依然成立**，
        //   直接拿 `rect` 用即可（首帧无 rect 时退回声明尺寸/INFINITY）。
        // ★只取需要的两个标量（本仓实测的性能缺陷：此前 `style.clone()` 整份复制
        //   ——`LStyle` 含多个 String 字段 ⇒ **每范围一次堆分配**；多范围（300 个）白付 300 次。
        //   而这里只用到 width/height 两个标量 ⇒ 直接读，不 clone。）
        let (scope_rect, fb_w, fb_h) = {
            let n = tree.get(scope);
            (n.rect, n.style.width, n.style.height)
        };
        let cw = if scope_rect.width > 0.0 { scope_rect.width } else { fb_w.unwrap_or(f32::INFINITY) };
        let ch = if scope_rect.height > 0.0 { scope_rect.height } else { fb_h.unwrap_or(f32::INFINITY) };
        let constraint = RootConstraint::definite(cw, ch);

        // 取子树 + 前序索引映射（一次 O(范围)，避免逐节点重扫）
        // ★prologue = 范围推导 + 退化判定 + 约束求解（多范围下这部分是**每范围的固定成本**）
        *self.phases_mut("prologue_ms") += t_pro.elapsed().as_secs_f64() * 1000.0;
        let t_phase0 = std::time::Instant::now();
        // ★★真增量：同一棵持久树里只重排该范围（替代"拷贝子树 + 子引擎重建"）
        let out = self.layout_subtree_cached(tree, scope, constraint, dirty);
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
        // ★分相位埋点（本仓纪律：任何 >5µs 的分段都要再拆——多范围形态下总额外开销显著）
        let t_copy0 = std::time::Instant::now();
        let order = preorder(tree, scope);
        let mut sub = LayoutTree::new();
        let root_new = copy_subtree(tree, scope, &mut sub, NO_PARENT);
        sub.roots.push(root_new);
        let t_copy = t_copy0.elapsed().as_secs_f64() * 1000.0;

        let t_sub0 = std::time::Instant::now();
        let mut sub_engine = TaffyEngine::new();
        if let Some(m) = self.measurer.take() {
            sub_engine.set_measurer(m);
        }
        // ★★**子引擎必须继承主引擎的度量缓存**（本仓实测：这是 19ms 的真凶）
        //
        // 【故障链（真机 V0 实测）】范围不是根时走**拷贝法**（`layout_subtree_and_writeback`），
        //   而子引擎是 `TaffyEngine::new()` ⇒ **度量缓存从空开始** ⇒ 范围内每个文本叶子
        //   都要重新调平台度量（真机读数：`measure_calls=3036` 次 CoreText / 轮，
        //   `solve_ms≈19ms`）。原实现只在**结束**时把子缓存的成果合并回主引擎
        //   （"成果不丢"），但**下一轮又从零开始** ⇒ 每轮重排都白付一遍全部度量。
        //   ⇒ 正解：开始时把主缓存的**所有权搬给子引擎**（`mem::take` 零拷贝）、
        //     结束时再搬回来（含子引擎新增项）。这样第二轮起命中率接近 100%。
        let inherited_cache = std::mem::take(&mut self.measure_cache);
        let inherited_len = inherited_cache.len();
        sub_engine.measure_cache = inherited_cache;
        let t_sub = t_sub0.elapsed().as_secs_f64() * 1000.0;
        let t_solve0 = std::time::Instant::now();
        let out = sub_engine.layout(&mut sub, constraint);
        let t_solve = t_solve0.elapsed().as_secs_f64() * 1000.0;
        let t_wb0 = std::time::Instant::now();
        // 重排后的实际尺寸（供调用方判 delta / 传播）
        let scope_new = sub.get(root_new).rect;

        let origin = tree.get(scope).rect;
        // ★★**不再分配 O(整树) 的 rects 缓冲**（本仓实测的性能缺陷）
        //
        // 【为什么可以省】该缓冲的形状是 `Vec<Option<Rect>>`（**按整树索引**），
        //   而回写只需要"范围子树里的节点"。此前每个范围都 `vec![None; tree.len()]`
        //   ⇒ 多范围（S4 文本形态：300 个范围 × 2001 节点）要**分配并写 60 万个槽位**，
        //   全是白付（实测探针：`5.7µs/范围` 里这是主要固定成本）。
        //   ★安全性依据：**没有任何调用方读增量路径的 `out.rects`**——
        //     `relayout_multi` 只用 relayout_count/measure_*；FFI 的更新路径用
        //     `collect_abs_subtree` 独立收集（它读的是写回后的 `tree`）。已在仓库全量 grep 确认。
        //   ⇒ 回写**直接落 tree**，输出里的 rects 置空（形状保持兼容，语义明确标注）。
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
            count += 1;
        }

        let t_wb = t_wb0.elapsed().as_secs_f64() * 1000.0;

        // ★缓存搬回主引擎（含子引擎新增项）——与开头的 `take` 配对
        let t_merge0 = std::time::Instant::now();
        if let Some(m) = sub_engine.measurer.take() {
            self.measurer = Some(m);
        }
        let final_len = sub_engine.measure_cache.len();
        self.measure_cache = std::mem::take(&mut sub_engine.measure_cache);
        let t_merge = t_merge0.elapsed().as_secs_f64() * 1000.0;
        // 诊断读数：本轮实际新增的缓存项（0 = 全程命中，说明继承生效）
        if inherited_len > 0 {
            self.last_phases.insert("cache_inherited".into(), inherited_len as f64);
            self.last_phases.insert("cache_new".into(), (final_len.saturating_sub(inherited_len)) as f64);
        }

        // ★累加相位（多范围时由 relayout_multi 读取；单范围也可读）
        *self.phases_mut("copy_ms") += t_copy;
        *self.phases_mut("subengine_ms") += t_sub;
        *self.phases_mut("solve_ms") += t_solve;
        *self.phases_mut("writeback_ms") += t_wb;
        *self.phases_mut("merge_cache_ms") += t_merge;
        *self.phases_mut("scopes_done") += 1.0;

        (
            // ★rects 为空是**契约的一部分**（见上方注释）：几何已直接写入 `tree`，
            //   调用方请读 tree（或经 `collect_abs_subtree` 收集变化集）
            LayoutOutput { rects: Vec::new(), measure_calls: out.measure_calls, measure_hits: out.measure_hits, relayout_count: count },
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
            self.translation_reject = Some("justify-content != flex-start");
            return None;
        }
        // ②③④ 逐子项
        for &c in &p_children {
            let cs = &tree.get(c).style;
            if cs.flex_grow > 0.0 {
                self.translation_reject = Some("child flex-grow > 0");
                return None;
            }
            if cs.flex_shrink != 0.0 {
                self.translation_reject = Some("child flex-shrink != 0");
                return None;
            }
            if cs.width_ratio.is_some() || cs.height_ratio.is_some() {
                self.translation_reject = Some("child has percentage size");
                return None;
            }
        }
        // ⑤ P 主轴向已声明
        let p_main = if horizontal { p_style.width } else { p_style.height };
        if p_main.is_none() {
            self.translation_reject = Some("parent main-axis size not declared");
            return None;
        }
        // ⑥ D 主轴向已声明
        let d_style = tree.get(dirty).style.clone();
        let d_main_new = match if horizontal { d_style.width } else { d_style.height } {
            Some(v) => v,
            None => {
                self.translation_reject = Some("dirty node main-axis size not declared");
                return None;
            }
        };
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

        self.translation_reject = None;
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
        // ★★四情形（第 ④ 种是本仓实测抓到的**正确性缺陷**）：
        //   ① 有非空文本字面量 **且字体签名非 0** → **内容寻址**（同文案跨节点复用，实测 4000→2 次）
        //   ② 无文本请求 → 非文本节点，键用节点 id
        //   ③ **文本请求存在但字面量为空串** → golden / 按 id 查表场景：
        //      空串**不代表内容相同**！若归入 ① → 不同文本共用缓存项 → 几何错乱
        //      （实测：conformance 文本用例全红，max_delta 12.6dp）
        //   ④ ★**有字面量但字体签名为 0**（= 无法区分字号）→ **必须回退节点寻址**
        //      【为什么（实测）】`TableTextMeasurer` 是**按 nodeId 查表**（尺寸由宿主度量表
        //      决定，可因字号不同而异）⇒ 两个节点文本相同、宽度约束相同但**字号不同**时，
        //      内容寻址会把它们**错误合并**成同一缓存项 ⇒ 其中一个尺寸错
        //      （实测：同文本 + 字号 16/28 两节点 ⇒ 都算成 16 高，差 12dp，静默）。
        //      注释原称"字体签名进键"，但那要求调用方**真的填** `style_key`——
        //      本仓当前恒为 0 ⇒ 等于没进。⇒ 保守取值：**正确 > 复用**，
        //      待宿主把字号编成 style_key 后再启用跨节点复用。
        match &n.text {
            Some(t) if !t.text.is_empty() && t.style_key != 0 => {
                use std::hash::{Hash, Hasher};
                let mut h = std::collections::hash_map::DefaultHasher::new();
                t.text.hash(&mut h);
                t.style_key.hash(&mut h);      // ★字体维度进键（调用方须真的填）
                out.push(h.finish());
            }
            // ★节点寻址（键空间与内容 hash 隔离）——情形 ②③④
            _ => out.push(((n.id as u64) << 1) | 1),
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

/// 探针用：把 `LStyle` 转成 taffy `Style`（判定"包装层"成本归属；
/// 见 `examples/taffy-floor-bench.rs` 的形态 ④）
pub fn to_taffy_style_for_bench(style: &LStyle) -> Style {
    TaffyEngine::to_taffy(style)
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
/// `Option<f32>` → `min_size` / `max_size` 的 `LengthPercentageAuto`。
///
/// ★★**未指定 ≠ auto**（2026-09-29 修，卡 I4 的文本 conformance 逼出来的缺陷）
///
/// 【缺陷现象】文本节点作为 flex 项参与收缩时，引擎与浏览器差 **24.5dp**：
///   容器 260 装 [60, 文本(内容宽 182), 40] ⇒ 浏览器按 `flex-basis × flex-shrink` 加权收缩
///   （60:182:40 ⇒ 51.9 / 157.5 / 34.6），引擎却把文本**当成不可收缩**（182 不动，只压另两个）。
///
/// 【根因】此前把「未显式指定 min-width」映射为 `auto()` ⇒ taffy 应用 CSS 的
///   **`min-width: auto` 规则**（flex 项的最小主轴尺寸 = 内容尺寸 ⇒ 不允许收缩到内容以下）。
///   而本仓的**既定模型**是「与 RN 一致地**不建模**该规则」（见
///   `tests/e2e-layout-core-pixel.test.ts` 文件头「已对齐的两处模型差异」之②，
///   Python/TS 参考实现同样显式清零）⇒ **实现与声明的模型不一致**，是一处静默分歧。
///
/// 【修法】未指定 ⇒ **`length(0.0)`**（= 可自由收缩到 0），与参考实现与浏览器 golden 口径对齐；
///   显式给了值才用该值。★注意：显式 `min-width: auto` 的语义仍不支持（本仓模型不含它）——
///   那是**有意的诚实边界**，不是遗漏。
///
/// 【为什么改引擎而不是改测试（本仓纪律）】golden 是**浏览器实测真值**（它是独立事实源），
///   用它去迁就引擎就是把真值改坏；且参考实现（Node/Rust 双份）早已是"不建模"，
///   改这里让**三份实现口径统一**。
#[allow(dead_code)] // ★批次 19：已被 ltp 取代（保留作 min 缺省=0 的语义参照）
fn opt_lpa(v: Option<f32>) -> LengthPercentageAuto {
    v.map(length).unwrap_or(length(0.0))
}

/** `max_size` 专用：未指定 = `auto`（无上限）。★与 `opt_lpa`（min 用，未指定 = 0）语义相反，勿混用。 */
#[allow(dead_code)] // ★批次 19：已被 ltp 取代（保留作 max 缺省=auto 的语义参照）
fn opt_max_lpa(v: Option<f32>) -> LengthPercentageAuto {
    v.map(length).unwrap_or(auto())
}

/// ★批次 19：min/max 的 length / percent / 缺省 三态映射（`dflt` = 缺省值：min 用 `length(0)`、max 用 `auto`）。
///   百分比优先于长度（与 `dim` 一致：恰一个有效——编译器只产其一）。
fn ltp(v: Option<f32>, pct: Option<f32>, dflt: LengthPercentageAuto) -> LengthPercentageAuto {
    match (v, pct) {
        (Some(v), _) => length(v),
        (None, Some(p)) => percent(p),
        _ => dflt,
    }
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

/// ★★★justify-self 项（2026-10-06）：`justify-self` 关键字 → taffy `AlignSelf`（网格项行内轴自对齐）。
///   与 `parse_align_items` 的差异：含 CSS Box Alignment 的 `start`/`end` 与 `self-start`/`self-end`
///   （`self-*` 由 taffy 按**项自身**的 direction 解析——本仓恒 LTR ⇒ 等价 start/end，保留语义）；
///   `normal` ⇒ stretch（Web 对 grid 项的 computed 语义）。
///   ▲ 未列值不在此猜测（编译器/注册表已收封闭集——不静默近似）。
/// ★★★place-items/justify-items 项（2026-10-08）：`justify-items` 关键字 → taffy `AlignItems`（网格容器内子项行内轴对齐）。
///   `self-*` 无 AlignItems 变体（容器级对齐在 LTR 下 self-* ≡ start/end）⇒ 归一；`normal` ⇒ stretch（Web computed）。
fn parse_justify_items(s: &str) -> AlignItems {
    match s {
        "normal" | "stretch" => AlignItems::STRETCH,
        "start" | "self-start" => AlignItems::START,
        "end" | "self-end" => AlignItems::END,
        "flex-start" => AlignItems::FLEX_START,
        "flex-end" => AlignItems::FLEX_END,
        "center" => AlignItems::CENTER,
        "baseline" => AlignItems::BASELINE,
        _ => AlignItems::STRETCH,
    }
}

fn parse_justify_self(s: &str) -> AlignSelf {
    match s {
        "normal" | "stretch" => AlignSelf::STRETCH,
        "start" => AlignSelf::START,
        "end" => AlignSelf::END,
        "self-start" => AlignSelf::SELF_START,
        "self-end" => AlignSelf::SELF_END,
        "center" => AlignSelf::CENTER,
        "flex-start" => AlignSelf::FLEX_START,
        "flex-end" => AlignSelf::FLEX_END,
        _ => AlignSelf::START,
    }
}

/// ★批次 12：显式网格轨迹串 `1fr 1fr 200px` → taffy `GridTemplateComponent` 列表。
///   支持 `<n>fr`（弹性）与 `<n>px`/纯数字（定长）；`auto`/`minmax`/`repeat` **未支持**（编译器已展开
///   repeat，其余 token 保守跳过——宁漏勿误，不猜）。
/** ★★★grid-auto-flow 项（2026-10-08）：字符串 → taffy `GridAutoFlow`。
 *   值集（编译器已归一 row dense → dense）：row / column / dense / column dense。
 *   未知值 ⇒ 回落 Row（taffy 默认；编译器已诊断跳过非法值）。 */
fn parse_grid_auto_flow(s: &str) -> taffy::GridAutoFlow {
    match s.trim() {
        "row" => taffy::GridAutoFlow::Row,
        "column" => taffy::GridAutoFlow::Column,
        "dense" | "row dense" => taffy::GridAutoFlow::RowDense,
        "column dense" => taffy::GridAutoFlow::ColumnDense,
        _ => taffy::GridAutoFlow::Row,
    }
}

/// ★★★grid 轨迹串解析升级（2026-10-08）——**用 taffy 官方 FromStr**（不再手写 fr/px）：
///   · 组件级（含 `repeat(...)` / 命名线）：`GridTemplateComponent::from_str`；
///   · 单条轨道尺寸（`minmax(..)` / `fr` / `px` / `%` / `auto` / `min-content`）：`TrackSizingFunction::from_str`。
///   · **裸 `0` → `0px`**（taffy 只认带单位的 0——CSS `minmax(0, 1fr)` 是语料最高频写法）。
///   · 无法解析的 token ⇒ 跳过（不猜）。
fn parse_grid_tracks(s: &str) -> Vec<taffy::GridTemplateComponent<String>> {
    use std::str::FromStr;
    let mut out: Vec<taffy::GridTemplateComponent<String>> = Vec::new();
    for comp in split_track_components(&fix_unitless_zero(s)) {
        let t = comp.trim();
        if t.is_empty() { continue; }
        // 先试整组件（repeat(...) / 命名线 / 单轨道）
        if let Ok(gc) = taffy::GridTemplateComponent::<String>::from_str(t) {
            out.push(gc);
            continue;
        }
        // 再试单条轨道尺寸（minmax / fr / px / % / auto / min-content…）
        if let Ok(ts) = taffy::TrackSizingFunction::from_str(t) {
            out.push(taffy::GridTemplateComponent::Single(ts));
            continue;
        }
        // 未知 ⇒ 跳过（不猜）
    }
    out
}

/// ★★★隐式轨道尺寸（grid-auto-columns / grid-auto-rows）：`GridTrackVec<TrackSizingFunction>`（无 repeat/命名线）。
///   每个 token 走 `TrackSizingFunction::from_str`（裸 0 → 0px）；不可解析 ⇒ 跳过。
fn parse_auto_tracks(s: &str) -> Vec<taffy::TrackSizingFunction> {
    use std::str::FromStr;
    let mut out: Vec<taffy::TrackSizingFunction> = Vec::new();
    for comp in split_track_components(&fix_unitless_zero(s)) {
        if let Ok(ts) = taffy::TrackSizingFunction::from_str(comp.trim()) {
            out.push(ts);
        }
    }
    out
}

/// 按**括号/方括号深度 0** 处的空白切分轨迹组件（`minmax(0, 1fr)` / `repeat(2, 1fr)` 内的空格不算）。
fn split_track_components(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut depth: i32 = 0;
    let mut cur = String::new();
    for ch in s.chars() {
        match ch {
            '(' | '[' => { depth += 1; cur.push(ch); }
            ')' | ']' => { depth -= 1; cur.push(ch); }
            c if c.is_whitespace() && depth == 0 => {
                if !cur.is_empty() { out.push(std::mem::take(&mut cur)); }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() { out.push(cur); }
    out
}

/// ★taffy 只认**带单位的 0**（`0px`）——CSS `0` 是合法轨迹尺寸 ⇒ 把**独立数值 0**（前/后为
///   起始/ `(` / `)` / `,` / 空白）改写为 `0px`。`10px`/`0.5fr`/`0px` 不受影响（0 非独立 token）。
fn fix_unitless_zero(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let sep = |c: char| c == '(' || c == ')' || c == ',' || c.is_whitespace();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '0' {
            let prev_ok = i == 0 || sep(chars[i - 1]);
            let next_ok = i + 1 >= chars.len() || sep(chars[i + 1]);
            if prev_ok && next_ok { out.push_str("0px"); i += 1; continue; }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// ★★★grid-template-areas 项（2026-10-08）：命名区域模板 → taffy `GridTemplateAreas`。
///   规范串 = 行以 `;` 分隔、每行区域名以空格分隔（`.` = 空单元），如 `"media info;rec rec"`。
///   线号语义（与 taffy 一致）：区域占单元格 [r0..r1]×[c0..c1] ⇒ 线 = start=(min+1) / end=(max+2)。
fn parse_grid_template_areas(s: &str) -> Option<taffy::GridTemplateAreas<String>> {
    // 形态① 浏览器/CSS：双引号逐行 `"a b" "c c"`（也接受单引号）；形态② 内部规范：`;` 分行 `a b;c c`。
    // 两形态都先切成「行（Vec<单元格名>）」再统一处理。
    let rows: Vec<Vec<String>> = if s.contains('"') || s.contains('\'') {
        // 提取所有引号串（单/双），每个引号串 = 一行
        let mut out: Vec<Vec<String>> = Vec::new();
        let mut cur = String::new();
        let mut quote: Option<char> = None;
        for ch in s.chars() {
            match quote {
                Some(q) => {
                    if ch == q { out.push(cur.split_whitespace().map(|x| x.to_string()).collect()); cur.clear(); quote = None; }
                    else { cur.push(ch); }
                }
                None => { if ch == '"' || ch == '\'' { quote = Some(ch); } }
            }
        }
        out.into_iter().filter(|r| !r.is_empty()).collect()
    } else if s.trim().eq_ignore_ascii_case("none") || s.trim().is_empty() {
        return None;
    } else {
        s.split(';')
            .map(|r| r.split_whitespace().map(|x| x.to_string()).collect::<Vec<String>>())
            .filter(|r| !r.is_empty())
            .collect()
    };
    if rows.is_empty() { return None; }
    let row_count = rows.len() as u16;
    let column_count = rows.iter().map(|r| r.len()).max().unwrap_or(0) as u16;
    let mut names: Vec<String> = Vec::new();
    let mut bounds: Vec<(u16, u16, u16, u16)> = Vec::new(); // (rmin, rmax, cmin, cmax) 单元格下标
    for (ri, row) in rows.iter().enumerate() {
        for (ci, name) in row.iter().enumerate() {
            if name == "." { continue; }
            if let Some(idx) = names.iter().position(|n| n == name) {
                let b = &mut bounds[idx];
                b.0 = b.0.min(ri as u16);
                b.1 = b.1.max(ri as u16);
                b.2 = b.2.min(ci as u16);
                b.3 = b.3.max(ci as u16);
            } else {
                names.push(name.clone());
                bounds.push((ri as u16, ri as u16, ci as u16, ci as u16));
            }
        }
    }
    let areas = names
        .into_iter()
        .zip(bounds.into_iter())
        .map(|(n, (rmin, rmax, cmin, cmax))| taffy::GridTemplateArea {
            name: n,
            row_start: rmin + 1,
            row_end: rmax + 2,
            column_start: cmin + 1,
            column_end: cmax + 2,
        })
        .collect();
    Some(taffy::GridTemplateAreas { areas, row_count, column_count })
}

/// ★批次 11：`align-content`（多行容器行间对齐；open string，未知值落默认 stretch）
fn parse_align_content(s: &str) -> AlignContent {
    match s {
        "center" => AlignContent::CENTER,
        "flex-start" | "start" => AlignContent::FLEX_START,
        "flex-end" | "end" => AlignContent::FLEX_END,
        "space-between" => AlignContent::SPACE_BETWEEN,
        "space-around" => AlignContent::SPACE_AROUND,
        "space-evenly" => AlignContent::SPACE_EVENLY,
        _ => AlignContent::STRETCH,
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

    /// ★内容寻址（**仅在调用方提供了字体签名时**）：同文案同字体 ⇒ 共用缓存键
    ///
    /// 【★本测试的语义在 2026-09-28 收紧了（原断言不安全）】原版用 `style_key: 0` 断言
    ///   "同文案必须共用"，而 `TableTextMeasurer` 是**按 nodeId 查表**（尺寸由宿主度量表
    ///   决定，可因字号而异）⇒ 同文案 + 同宽约束但**不同字号**时，内容寻址会把两者
    ///   合并成同一缓存项 ⇒ **其中一个尺寸错**（实测：同文本 + 字号 16/28 ⇒ 都算 16 高，
    ///   差 12dp，且无任何报错）。
    ///   ⇒ 新语义：**内容寻址的收益以"字体签名可用"为前提**；`style_key == 0`
    ///     时回退节点寻址（正确 > 复用）。保护意图（复用收益）由本测试在新前提下保留。
    #[test]
    fn same_literal_with_style_key_shares_cache_key() {
        let mk = |id: u32| {
            let mut n = LNode::new(id, LStyle::default());
            // ★字体签名非 0 = 调用方**真的**区分了字体 ⇒ 内容寻址安全
            n.text = Some(TextMeasureRequest { text: "item".to_string(), style_key: 7 });
            n
        };
        let hashes = hash_for_tests(&[mk(10), mk(20)]);
        assert_eq!(hashes[0], hashes[1], "★（字体已知时）同文案应共用缓存键——内容寻址的收益");
    }

    /// ★★**正确性锁**：`style_key == 0`（字体不可区分）时，同文案**不得**共用缓存键
    ///
    /// 【为什么必须有（本仓实测的真缺陷）】见上一条测试的说明；这条把"保守"钉死，
    ///   防止后人为了"优化收益"把它改回去而重新引入静默错几何。
    #[test]
    fn same_literal_without_style_key_falls_back_to_node_addressing() {
        let mk = |id: u32| {
            let mut n = LNode::new(id, LStyle::default());
            n.text = Some(TextMeasureRequest { text: "item".to_string(), style_key: 0 });
            n
        };
        let hashes = hash_for_tests(&[mk(10), mk(20)]);
        assert_ne!(
            hashes[0], hashes[1],
            "★字体签名缺失时必须回退节点寻址（否则不同字号会错误共用缓存项）"
        );
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
