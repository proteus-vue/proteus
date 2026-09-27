// packages/layout-core-rust/src/node.rs
// ★★L1 排版核心：**扁平节点树**（方案 §5.1 `node/`：扁平数组 + 父/兄弟索引）。
//
// ★为什么要扁平数组（而不是 Box<Node> 树）：
//   · **缓存友好**：布局是一遍顺序遍历，连续内存远优于指针追逐
//   · **索引稳定**：节点用 `u32` 索引引用（`NodeIndex`），可安全跨 FFI/序列化
//   · **可池化**：列表复用池（§5.1 `recycle/`）需要一个可回收的槽位数组
//   · 与既有 iOS 竖切结论一致：本仓实测 commit 成本由**节点总数**驱动，故每处遍历都要 O(n)
//
// ★索引约定：`u32` + `NO_PARENT` 哨兵（避免 `Option<u32>` 的额外分支与 8 字节占用）
use crate::style::{Edges, LStyle, Rect, Size};
use serde::{Deserialize, Serialize};

/// 节点索引（指向 `LayoutTree::nodes` 的下标）
pub type NodeIndex = u32;

/// 无父节点哨兵
pub const NO_PARENT: NodeIndex = u32::MAX;

/// 文本度量请求（§5.2：度量由**平台注入**——CoreText / StaticLayout / ArkUI）
///
/// ★本层不实现文本排版：Profile §L4 明确规定「不自研文本基础设施」。
///   核心只负责：**何时问**（一遍布局里恰好一次）与**问什么**（最大可用宽）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextMeasureRequest {
    /// 文本内容（平台侧据此 shaping；核心不解析其语义）
    pub text: String,
}

/// 扁平节点
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LNode {
    /// 稳定 id（编译期分配，便于与渲染 IR / 指令流对账——与 TS 侧 `PNode.id` 同源）
    pub id: u32,
    /// 语义标签（诊断用）
    #[serde(default)]
    pub tag: String,
    pub style: LStyle,

    /// 父索引（根为 `NO_PARENT`）
    pub parent: NodeIndex,
    /// 子索引（顺序 = 绘制顺序 = 主轴排布顺序）
    pub children: Vec<NodeIndex>,

    /// 文本度量请求（`Some` = 文本叶子）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<TextMeasureRequest>,

    // ── 求解输出 ──
    /// 相对**父内容盒**的位置与自身尺寸（绝对坐标由 `LayoutTree::absolute_rects` 叠加）
    #[serde(default)]
    pub rect: Rect,

    // ── 脏区（§5.4）──
    /// 自身尺寸需重算
    #[serde(default)]
    pub dirty: bool,
}

impl LNode {
    pub fn new(id: u32, style: LStyle) -> Self {
        Self { id, tag: String::new(), style, parent: NO_PARENT, children: Vec::new(), text: None, rect: Rect::default(), dirty: false }
    }

    /// 是否为布局边界（§5.4）：宽高均显式 **且自身有子级** ⇒ 内部变更不外溢
    ///
    /// ★「有子级」这个条件不可省（本仓 conformance 实测暴露）：叶子节点虽常有显式宽高，
    ///   但它没有「内部」可言；若把它判为边界，脏传播会**停在叶子自己**，
    ///   而其祖先若为 auto 尺寸（尺寸随内容变化）就会**漏重排**。
    ///   边界的意义是「我罩住我的子树，我的对外尺寸不因子树而变」——叶子没有子树，故不适用。
    pub fn is_layout_boundary(&self) -> bool {
        self.style.is_layout_boundary() && !self.children.is_empty()
    }

    /// 主轴可用尺寸（`None` = 不限）
    pub fn padding_sum(&self) -> Edges {
        self.style.padding
    }
}

/// 扁平布局树（节点数组 + 根列表）
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct LayoutTree {
    pub nodes: Vec<LNode>,
    /// 根节点索引（通常 1 个；多根用于「页面 + 浮层」等场景）
    pub roots: Vec<NodeIndex>,
}

impl LayoutTree {
    pub fn new() -> Self {
        Self { nodes: Vec::new(), roots: Vec::new() }
    }

    /// 追加节点，返回其索引
    pub fn push(&mut self, node: LNode) -> NodeIndex {
        let idx = self.nodes.len() as NodeIndex;
        self.nodes.push(node);
        idx
    }

    /// 建立父子关系（同时写入父索引）
    pub fn add_child(&mut self, parent: NodeIndex, child: NodeIndex) {
        self.nodes[child as usize].parent = parent;
        self.nodes[parent as usize].children.push(child);
    }

    pub fn get(&self, idx: NodeIndex) -> &LNode {
        &self.nodes[idx as usize]
    }

    pub fn get_mut(&mut self, idx: NodeIndex) -> &mut LNode {
        &mut self.nodes[idx as usize]
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// 按稳定 id 查索引（O(n)；仅供测试/诊断，热路径不要用）
    pub fn index_of_id(&self, id: u32) -> Option<NodeIndex> {
        self.nodes.iter().position(|n| n.id == id).map(|i| i as NodeIndex)
    }

    /// 计算**绝对坐标矩形**（自顶向下一次遍历，O(n)）
    ///
    /// ★坐标系约定（与 CSS 一致，M1 已由浏览器对拍验证）：
    ///   · 常规子级原点 = 父**内容盒**左上（padding 之内）
    ///   · `position:absolute` 子级原点 = 父 **padding 盒**左上（containing block 语义）
    ///   · `display:none` 在 CSS 中**无盒** → 不产出矩形（也不下钻）
    pub fn absolute_rects(&self) -> Vec<Option<Rect>> {
        let mut out: Vec<Option<Rect>> = vec![None; self.nodes.len()];
        for &root in &self.roots {
            self.apply_absolute(root, 0.0, 0.0, &mut out);
        }
        out
    }

    fn apply_absolute(&self, idx: NodeIndex, ox: f32, oy: f32, out: &mut Vec<Option<Rect>>) {
        let node = self.get(idx);
        if node.style.display == crate::style::Display::None {
            return;
        }
        let r = node.rect;
        let abs = Rect { x: ox + r.x, y: oy + r.y, width: r.width, height: r.height };
        out[idx as usize] = Some(abs);

        // ★子级原点就是父的**原点**，不再叠加父 padding——
        //   因为引擎（taffy）产出的 `location` 已经是「相对父 border-box 原点」的坐标，
        //   其中**已含** `content_box_inset`（padding + border）的偏移（见 taffy
        //   `compute/flexbox.rs`：`outer_main_size = inner + content_box_inset.sum`）。
        //   本仓 conformance 实测教训：再加一次 padding 会让每个子级偏移「父 padding」那么多
        //   （三层嵌套用例实测：所有子级坐标都比浏览器大 10dp = 父 padding）。
        //   ★这与 TS 参考实现的坐标系约定不同（TS 侧的子级相对「父内容盒」）——
        //     两边各自内部自洽即可，对拍的是**绝对坐标**，故由各自的 `absolute_*` 负责归一。
        for &child in &node.children {
            let child_node = self.get(child);
            if child_node.style.display == crate::style::Display::None {
                continue;
            }
            // absolute 与非 absolute 在此**同一原点**：taffy 已把两类定位统一到 border-box 原点
            self.apply_absolute(child, abs.x, abs.y, out);
        }
    }

    /// 节点总数（诊断）
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    /// 零尺寸（测试断言辅助）
    pub fn rect_at(&self, idx: NodeIndex) -> Rect {
        self.nodes[idx as usize].rect
    }

    /// 尺寸读取（诊断）
    pub fn size_at(&self, idx: NodeIndex) -> Size {
        let r = self.nodes[idx as usize].rect;
        Size { width: r.width, height: r.height }
    }
}
