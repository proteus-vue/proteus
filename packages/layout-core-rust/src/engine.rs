// packages/layout-core-rust/src/engine.rs
// ★★L1 排版核心：**LayoutEngine 抽象**（方案 §5.1「引擎原生 API 不得泄漏到 layout/ 模块之外」）。
//
// ★本条是**硬约束**（方案原文：「`LayoutEngine` 接口必须在 M1 落地，引擎原生 API 不得泄漏」）：
//   上层（render/、平台层、FFI 导出）只能依赖本 trait，**不得出现 `taffy::` 类型**。
//   这样 DCP-3（M3 评估自研）或未来换引擎时，改动被限制在 `taffy_engine.rs` 一个文件内。
//
// ★稀疏输出（`sparse`）是**为增量布局而设计**：
//   全量布局时它是「每个节点一条」；增量布局时它只含**被重算的子树**——
//   调用方据此只更新这些节点的平台对象，而不是整棵树重建。
use crate::node::{LNode, LayoutTree, NodeIndex};
use crate::style::{Rect, Size};

/// 布局结果：每个节点（或**被重算的**节点）相对父内容盒的矩形
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LayoutOutput {
    /// 与 `tree.nodes` 同序；`None` = 本次未重算（增量场景）或无可视盒
    pub rects: Vec<Option<Rect>>,
    /// 本次**未命中缓存**的度量次数（真实向平台要度量的次数）
    pub measure_calls: usize,
    /// 本次命中度量缓存的次数（增量效果读数——Taffy 会多次测量同一叶子，see DCP-1 §2.4）
    pub measure_hits: usize,
    /// 本次重排的节点数（增量读数——对齐 M1 的 T1/T4 口径）
    pub relayout_count: usize,
}

impl LayoutOutput {
    pub fn rect_of(&self, idx: NodeIndex) -> Option<Rect> {
        self.rects.get(idx as usize).copied().flatten()
    }

    /// 只取被重算的非空矩形（绝对坐标叠加前）
    pub fn sparse_rects(&self) -> impl Iterator<Item = (NodeIndex, Rect)> + '_ {
        self.rects
            .iter()
            .enumerate()
            .filter_map(|(i, r)| r.map(|r| (i as NodeIndex, r)))
    }
}

/// 文本度量注入（平台实现：iOS CoreText / Android StaticLayout / 鸿蒙 ArkUI）
///
/// ★签名刻意收 `max_width` 与「**换行后**尺寸」：文本在不同可用宽下断行结果不同，
///   返回的尺寸必须是**在该宽下断行之后**的结果（TS 侧同款契约）。
///
/// ★为何也传 `node`：① 平台实现可据节点样式（字体/行高）度量——核心不解析样式字符串，
///   但平台需要它；② 测试侧要按 `node.id` 查 golden 度量值。平台实现可忽略该参数。
pub trait TextMeasurer {
    fn measure(&mut self, node: &LNode, text: &str, max_width: f32) -> Size;
}

/// 不实现文本度量的兜底（所有文本按零尺寸——仅用于无文本场景/测试）
#[derive(Debug, Default)]
pub struct NullTextMeasurer;

impl TextMeasurer for NullTextMeasurer {
    fn measure(&mut self, _node: &LNode, _text: &str, _max_width: f32) -> Size {
        Size::default()
    }
}

/// 按 `节点 id → 尺寸` 查表的度量实现（**conformance 对拍用**：
/// golden 文件里存的就是浏览器实测的文本度量，故 Rust 侧无需浏览器即可复现同一输入）
#[derive(Debug, Default, Clone)]
pub struct TableTextMeasurer {
    table: std::collections::HashMap<u32, Size>,
}

impl TableTextMeasurer {
    pub fn new(table: std::collections::HashMap<u32, Size>) -> Self {
        Self { table }
    }

    pub fn set(&mut self, id: u32, size: Size) {
        self.table.insert(id, size);
    }

    pub fn len(&self) -> usize {
        self.table.len()
    }

    pub fn is_empty(&self) -> bool {
        self.table.is_empty()
    }
}

impl TextMeasurer for TableTextMeasurer {
    fn measure(&mut self, node: &LNode, _text: &str, _max_width: f32) -> Size {
        // 查不到 → 零尺寸（测试会因几何不符而失败，不会静默给出错误结果）
        self.table.get(&node.id).copied().unwrap_or_default()
    }
}

/// 可用空间（对齐 CSS 的「不确定/确定」语义）
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AvailableSpace {
    /// 不确定（由内容决定）
    MaxContent,
    /// 确定值
    Definite(f32),
}

impl AvailableSpace {
    pub fn definite_or_none(self) -> Option<f32> {
        match self {
            Self::Definite(v) => Some(v),
            Self::MaxContent => None,
        }
    }
}

/// 根约束（宿主传入：视口/容器尺寸）
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RootConstraint {
    pub width: AvailableSpace,
    pub height: AvailableSpace,
}

impl RootConstraint {
    pub fn definite(width: f32, height: f32) -> Self {
        Self { width: AvailableSpace::Definite(width), height: AvailableSpace::Definite(height) }
    }

    pub fn loose_width(width: f32) -> Self {
        Self { width: AvailableSpace::Definite(width), height: AvailableSpace::MaxContent }
    }
}

/// ★可替换布局引擎（方案 §5.2）
pub trait LayoutEngine {
    /// 全量布局（单次测量协议：约束自顶向下、尺寸自底向上）
    fn layout(&mut self, tree: &mut LayoutTree, constraint: RootConstraint) -> LayoutOutput;

    /// 增量布局：从脏节点出发，**遇布局边界即停止向上传播**（§5.4 T2 的核心机制）
    ///
    /// 返回的 `LayoutOutput` 只包含**被重算**的节点（`sparse` 语义）。
    fn layout_incremental(&mut self, tree: &mut LayoutTree, dirty: NodeIndex) -> LayoutOutput;

    /// 引擎标识（诊断/门禁用）
    fn name(&self) -> &'static str;
}
