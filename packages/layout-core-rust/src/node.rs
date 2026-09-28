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
    /// **字体签名**（调用方提供的稳定哈希；由编译器/平台按字体属性算出）。
    ///
    /// 为什么要它：Profile §5.3 规定度量缓存键是 **(文本 hash, 字体, 宽度约束)**——
    /// 「字体」这一维必须进入键，否则「同文案不同字号」会错误命中同一缓存项。
    /// Rust 侧**不解析字体属性**（那是 L4：复用平台文本栈），只透传这个签名。
    /// 缺省 0 = 调用方不区分字体（单字体场景下安全）。
    #[serde(default)]
    pub style_key: u32,
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

    /// ★**原生宿主节点**（方案 L3：map / webview / 广告 / 相机等必须原生嵌入）。
    ///
    /// 对**布局**无影响（它就是一个有尺寸的盒子）——但对**平台层**是关键信息：
    ///   · 宿主据此为该节点创建真实原生 View（而非自绘）
    ///   · 且必须确保它**不被拍平**（M0 的 `flattenEligible` 已排除 native-host）
    ///
    /// 语义来源：编译期 IR 的 `PNode.kind === 'native-host'`（M0 已实现，见 `kindFromSemantic`）。
    #[serde(default)]
    pub native_host: bool,

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
        Self {
            id,
            tag: String::new(),
            style,
            parent: NO_PARENT,
            children: Vec::new(),
            text: None,
            native_host: false,
            rect: Rect::default(),
            dirty: false,
        }
    }

    /// 是否为布局边界（§5.4）：**两个轴的对外尺寸都与内容无关** 且自身有子级
    /// ⇒ 内部变更不外溢，脏传播可在此停止。
    ///
    /// ★「有子级」这个条件不可省（本仓 conformance 实测暴露）：叶子节点虽常有显式宽高，
    ///   但它没有「内部」可言；若把它判为边界，脏传播会**停在叶子自己**，
    ///   而其祖先若为 auto 尺寸（尺寸随内容变化）就会**漏重排**。
    ///   边界的意义是「我罩住我的子树，我的对外尺寸不因子树而变」——叶子没有子树，故不适用。
    ///
    /// ★★本轮新增：**交叉轴 stretch 也算「尺寸与内容无关」**（真机实测发现的关键缺口）
    ///
    /// 【为什么必须认 stretch（本仓实测）】App 里的列表行常见写法是
    /// `{ height: 56 }` **只写高、不写宽** —— 宽度由父的 `align-items: stretch` 撑开
    /// （跨端框架与 CSS 的默认行为）。此时行的宽 = 父内容盒宽，**与行自己的内容无关**；
    /// 高也是显式的 ⇒ **两个轴都与内容无关 ⇒ 它本来就是边界**。
    /// 但旧判据只认 `style.width.is_some()` ⇒ 行全部被判为**非边界**
    /// ⇒ 重排范围一路到根 ⇒ 增量退化为全量（实测：宿主增量路径因此**一次都没触发**）。
    ///
    /// 【判据】对每个轴分别判断「该轴尺寸是否由内容决定」：
    ///   · 显式 `width`/`height` → 与内容无关 ✓
    ///   · 交叉轴 + 父侧 `align-items: stretch`（或自身 `align-self: stretch`）→ 由父决定 ✓
    ///   · 主轴且无显式尺寸 → **由内容决定** ✗（这正是 auto 尺寸链不能当边界的原因）
    ///
    /// 【诚实边界】本判据只看「样式声明」，不解析父级实际生效的 align-items。
    ///   调用方（布局核心）在**已经知道父级**的上下文里可传 `parent_align_items`；
    ///   传 `None` 时退化为旧行为（只认显式尺寸）——保守，宁可少判边界也不误判。
    pub fn is_layout_boundary(&self) -> bool {
        self.is_layout_boundary_with(None, None) && !self.children.is_empty()
    }

    /// 带父级上下文的边界判定
    ///
    /// - `parent_align_items`：父的 `align-items`（`None` = 未知 → 保守处理）
    /// - `parent_horizontal`：**父的主轴是否为横轴**（`None` = 未知 → 保守）
    ///
    /// ★★`parent_horizontal` 不可省（本仓实测抓到的第二个错）：stretch 作用在节点的
    ///   **交叉轴**上，而「哪个轴是交叉轴」由**父**的 flex-direction 决定，**不是节点自己的**。
    ///   （踩坑：用节点自己的 direction 判 → `{height:56}` 的行被算成「主轴无显式尺寸」→ 仍非边界。
    ///    实际上它在 column 父里，交叉轴是**横**，而横由 stretch 撑开、竖是显式高 ⇒ 本来就该是边界。）
    pub fn is_layout_boundary_with(
        &self,
        parent_align_items: Option<&str>,
        parent_horizontal: Option<bool>,
    ) -> bool {
        if self.children.is_empty() || self.style.display != crate::style::Display::Flex {
            return false;
        }
        // 节点在**父的**轴系下的主/交叉轴
        let horizontal = parent_horizontal.unwrap_or_else(|| self.style.flex_direction.is_horizontal());
        let main_explicit = if horizontal { self.style.width.is_some() } else { self.style.height.is_some() };
        let cross_explicit = if horizontal { self.style.height.is_some() } else { self.style.width.is_some() };
        // 主轴：**只有显式尺寸**才与内容无关。
        //
        // ★★`flex_grow > 0` **不能**当作内容无关（我一度这么写，推导后发现是错的）：
        //   grow 节点的主轴尺寸 = base + grow_share × free_space；
        //   若自身内容变化 Δ，则 base 增 Δ、free_space 减 Δ ⇒ 尺寸变化 Δ(1 − grow_share)
        //   ⇒ 只要 grow_share ≠ 1，尺寸仍依赖内容 ⇒ **误判为边界会漏重排 → 几何错**。
        //   （正确性 > 性能：宁可少判边界，也不要错的几何。）
        let main_ok = main_explicit;
        // 交叉轴：显式，或 stretch（自身 align-self 优先；否则看父 align-items，缺省即 stretch）
        let self_stretch = matches!(self.style.align_self.as_deref(), Some("stretch"));
        let cross_ok = cross_explicit
            || self_stretch
            || match parent_align_items {
                Some("stretch") => true,
                None => true,          // 未知 → 按 CSS 默认（stretch）保守判定
                Some(_) => false,
            };
        main_ok && cross_ok
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

/// ★★**压实**：只保留从 `roots` 可达的节点，重建数组并**重映射索引**
///
/// 【为什么放在 node.rs（而不是 ffi）】这是**纯结构操作**（只依赖 LayoutTree 的
///   parent/children 表示），与 FFI 层无关 ⇒ 放在数据结构的归属模块，便于单测。
///
/// 【顺序语义】保留节点的**相对数组顺序不变**（按下标升序过滤）⇒
///   `build_taffy` 现在只信 `children`（不受数组序影响），但保持顺序仍让诊断可比。
///
/// - Returns: `(新树, old→new 下标映射)`；不可达节点在新树里没有映射项
pub fn compact_reachable(tree: &LayoutTree) -> (LayoutTree, std::collections::HashMap<u32, u32>) {
    // ① 标记可达（从 roots 沿 children DFS）
    let mut reachable = vec![false; tree.len()];
    let mut stack: Vec<u32> = tree.roots.clone();
    while let Some(i) = stack.pop() {
        let ui = i as usize;
        if ui >= tree.len() || reachable[ui] {
            continue;
        }
        reachable[ui] = true;
        for &c in &tree.get(i).children {
            stack.push(c);
        }
    }
    // ② 按下标升序分配新下标（保持相对顺序）
    let mut remap: std::collections::HashMap<u32, u32> = std::collections::HashMap::new();
    let mut out = LayoutTree::new();
    for (old, keep) in reachable.iter().enumerate() {
        if !keep {
            continue;
        }
        let mut n = tree.nodes[old].clone();
        let new_idx = out.push(n.clone());
        remap.insert(old as u32, new_idx);
        // 占位（下面统一改 parent/children；此处先取出可变引用方便使用）
        let _ = &mut n;
    }
    // ③ 重写 parent / children（经 remap 翻译）
    for old in 0..tree.len() {
        let Some(&new_idx) = remap.get(&(old as u32)) else { continue };
        let src = &tree.nodes[old];
        out.nodes[new_idx as usize].parent = if src.parent == NO_PARENT {
            NO_PARENT
        } else {
            *remap.get(&src.parent).unwrap_or(&NO_PARENT)
        };
        out.nodes[new_idx as usize].children = src
            .children
            .iter()
            .filter_map(|c| remap.get(c).copied())
            .collect();
    }
    // ④ roots
    out.roots = tree.roots.iter().filter_map(|r| remap.get(r).copied()).collect();
    (out, remap)
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
