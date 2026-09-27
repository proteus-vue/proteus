// packages/layout-core-rust/src/hit.rs
// ★★L1 排版核心：**绘制序 + 命中测试**（方案 §M3「事件系统 / 手势」的几何地基）。
//
// 【本模块回答什么】
//   ① `paint_order`：**唯一的绘制序真相来源**（宿主按它下发绘制/建层）
//   ② `hit_test` / `hit_path`：屏幕坐标 → 节点（`elementsFromPoint` 语义）
//   ③ `bubble_chain`：事件冒泡链（DOM 传播语义）
//
// 【为什么必须放核心，而不是各端自己写】
//   ① 命中结果依赖 **绘制序 + 裁剪（overflow）** —— 两条都必须三端一致，
//      否则「同一份 IR 在 Android 点得到、在 iOS 点不到」= 语义分叉（本仓核心宗旨）。
//   ② rects 是核心算的，绘制序与命中就必须是核心算的：**同源才不会漂移**。
//   ③ 纯几何 → **可在无头环境回归**（与 conformance 同一套方法：浏览器为真值基准）。
//
// 【★★绘制序 = 两相位（本仓实测校准，勿凭直觉简化）】
//   CSS 2.1 附录 E 的简化模型（本 Profile 无 float / inline / z-index）：
//     相位 1：**在流（非定位）**后代，按树序
//     相位 2：**定位**后代（relative/absolute），按树序，各自展开其内部同样两相位
//   ★相位是**按层叠上下文**而非按父级：深处 static 子树里的 absolute，仍绘制在
//     更外层后置的 static 兄弟**之上**（本仓用真实 Chromium 探针实测确认，见
//     `tests/golden/paint-order-probes.json` 的 D/E 两例）。
//   ⇒ 由此**修正了一个错误模型**：初版实现是「每个父级内子级树序」——
//     在 D/E 这类「static 嵌套 + 内部 absolute」场景下会画错/点错。
//
// 【★命中 = 绘制序的严格逆序】这不是巧合而是**定义**：
//   用户看到的最上层元素，就是点击时应该命中的元素。故本文件只保留**一份**顺序逻辑
//   （`paint_order`），命中是它的逆序扫描 —— 两侧不可能漂移。
//
// 【★坐标系】与 `LayoutTree::absolute_rects` 完全同口径：
//   · 根原点 (0,0)（多根重叠于原点）
//   · 子级原点 = 父**边框盒**原点 + 子级 `rect.x/y`（taffy 的 location 已含 content_box_inset）
//   · `display:none` 无盒 → 不绘制、不可命中、不下钻
//
// 【★边界语义】半开区间 `[x, x+w) × [y, y+h)`（与浏览器一致：
//   共享边界由**后绘制**者命中；零尺寸节点不可命中）。
use crate::node::{LayoutTree, NodeIndex, NO_PARENT};
use crate::style::{Display, Overflow, Position, Rect};

/// 点是否落在矩形内（★半开区间，与浏览器一致——见模块头注释）
#[inline]
pub fn rect_contains(r: Rect, x: f32, y: f32) -> bool {
    x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height
}

/// 求交（裁剪区叠加）；无交集返回**零尺寸且在原点**（等价于「全都不可见」）
#[inline]
fn intersect(a: Rect, b: Rect) -> Rect {
    let x0 = a.x.max(b.x);
    let y0 = a.y.max(b.y);
    let x1 = (a.x + a.width).min(b.x + b.width);
    let y1 = (a.y + a.height).min(b.y + b.height);
    Rect { x: x0, y: y0, width: (x1 - x0).max(0.0), height: (y1 - y0).max(0.0) }
}

/// 是否为「定位元素」（relative / absolute）——决定它落在哪个绘制相位
#[inline]
fn is_positioned(tree: &LayoutTree, idx: NodeIndex) -> bool {
    tree.get(idx).style.position != Position::Static
}

/// 每个节点的**几何快照**：绝对矩形 + 生效裁剪区
///
/// ★两相位遍历会「跳过子树」，无法沿途携带继承裁剪区 → 先一遍 O(n) 把它算好。
///   （裁剪区 = 所有 `overflow != visible` 祖先盒的交集；自身不裁剪自身）
#[derive(Debug, Clone, Copy)]
pub struct NodeGeometry {
    /// 绝对矩形（`None` = 无盒：display:none）
    pub rect: Option<Rect>,
    /// 生效裁剪区（`None` = 不裁剪）
    pub clip: Option<Rect>,
}

/// 计算全树几何快照（O(n)，单次遍历）+ 节点索引 → 快照
pub fn geometry(tree: &LayoutTree) -> Vec<NodeGeometry> {
    let mut out = vec![NodeGeometry { rect: None, clip: None }; tree.nodes.len()];

    /// 显式栈（避免深树递归爆栈——列表场景深度可达数十层，但页面可更深）
    fn walk(tree: &LayoutTree, idx: NodeIndex, ox: f32, oy: f32, clip: Option<Rect>, out: &mut Vec<NodeGeometry>) {
        let node = tree.get(idx);
        if node.style.display == Display::None {
            return; // 无盒：不记录，也不下钻
        }
        let r = node.rect;
        let abs = Rect { x: ox + r.x, y: oy + r.y, width: r.width, height: r.height };
        // ★自身可见性用**继承裁剪区**；子级继承区在自身盒（若裁剪）基础上再求交
        out[idx as usize] = NodeGeometry { rect: Some(abs), clip };
        let child_clip = if node.style.overflow != Overflow::Visible {
            Some(match clip {
                Some(c) => intersect(c, abs),
                None => abs,
            })
        } else {
            clip
        };
        for &child in &node.children {
            walk(tree, child, abs.x, abs.y, child_clip, out);
        }
    }

    for &root in &tree.roots {
        walk(tree, root, 0.0, 0.0, None, &mut out);
    }
    out
}

/// 收集「本上下文内的某个相位」的节点（树序），跳过给定相位的子树
///
/// `positioned_phase = false` → 相位 1（在流节点；遇到定位节点**跳过其整棵子树**）
/// `positioned_phase = true`  → 相位 2（定位节点；遇到定位节点收下它、跳过其子树——
///                              它的内容由它自己的上下文展开）
fn collect_phase(tree: &LayoutTree, roots: &[NodeIndex], positioned_phase: bool) -> Vec<NodeIndex> {
    let mut out = Vec::new();
    let mut stack: Vec<NodeIndex> = roots.iter().rev().copied().collect();
    // 树序 = 前序；用栈模拟（先压后序，弹出即前序）
    let mut ordered: Vec<NodeIndex> = Vec::new();
    while let Some(i) = stack.pop() {
        ordered.push(i);
        // 子级逆序入栈 → 弹出时为正序
        for &c in tree.get(i).children.iter().rev() {
            stack.push(c);
        }
    }
    let skip: std::collections::HashSet<NodeIndex> = ordered
        .iter()
        .copied()
        .filter(|&n| tree.get(n).style.display == Display::None)
        .collect();
    let mut skipped_subtrees = 0usize;
    for &n in &ordered {
        if skip.contains(&n) {
            continue;
        }
        if skipped_subtrees > 0 {
            skipped_subtrees -= 1;   // 该节点属于被跳过的子树
            continue;
        }
        if is_positioned(tree, n) == positioned_phase {
            out.push(n);
            if positioned_phase {
                // 定位节点：自身归本相位，**子树交给它自己的上下文**（递归展开）
                skipped_subtrees = subtree_size(tree, n);
            }
        } else if !positioned_phase {
            // 相位 1 遇到定位节点 → 跳过其整棵子树（它的内容属于相位 2）
            skipped_subtrees = subtree_size(tree, n);
        }
    }
    out
}

/// 子树节点数（不含自身）——用于「跳过整棵子树」
fn subtree_size(tree: &LayoutTree, idx: NodeIndex) -> usize {
    let mut n = 0usize;
    let mut stack: Vec<NodeIndex> = tree.get(idx).children.clone();
    while let Some(i) = stack.pop() {
        n += 1;
        for &c in &tree.get(i).children {
            stack.push(c);
        }
    }
    n
}

/// **★绘制序真相来源**：节点按绘制先后排列（先画的在前）
///
/// 宿主按此序下发绘制 / 建层；命中是它的**严格逆序**（见 `hit_path`）。
/// 实现 = CSS 2.1 附录 E 的简化两相位（见模块头注释），按**层叠上下文**递归。
pub fn paint_order(tree: &LayoutTree) -> Vec<NodeIndex> {
    let mut out = Vec::with_capacity(tree.nodes.len());
    for &root in &tree.roots {
        emit_context(tree, root, &mut out);
    }
    out
}

/// 展开一个**上下文**（root 或定位节点）：自身 → 相位1（在流）→ 相位2（定位，各自递归）
fn emit_context(tree: &LayoutTree, ctx: NodeIndex, out: &mut Vec<NodeIndex>) {
    if tree.get(ctx).style.display == Display::None {
        return;
    }
    out.push(ctx);
    let children: Vec<NodeIndex> = tree.get(ctx).children.clone();
    let in_flow = collect_phase(tree, &children, false);
    let positioned = collect_phase(tree, &children, true);
    for n in in_flow {
        out.push(n);
    }
    for n in positioned {
        if tree.get(n).style.display == Display::None {
            continue;
        }
        // ★本相位先输出**它自己**，再展开它内部的相位（定位节点自成层叠上下文）
        //   踩坑记录：初版只展开 inner 并 skip(1)，注释误以为「collect_phase 已收下」——
        //   实际从未 push，导致定位节点**整个从绘制序里消失**（新增的两相位测试当场抓到）。
        out.push(n);
        let mut inner = Vec::new();
        emit_context(tree, n, &mut inner);
        out.extend(inner.into_iter().skip(1));   // skip(1) = 跳过重复的自身
    }
}

/// 命中测试：返回**最上层**（最后绘制）且包含该点的节点索引；无命中返回 `None`
pub fn hit_test(tree: &LayoutTree, x: f32, y: f32) -> Option<NodeIndex> {
    hit_path(tree, x, y).first().copied()
}

/// 命中路径：**从最上层到根**，只含「自身盒包含该点且未被裁剪」的节点
///
/// 等价语义：`document.elementsFromPoint(x, y)` 的**逐位对应**（浏览器亦自上层到下层）。
/// ★实现 = 绘制序的逆序过滤 —— 与绘制共享同一份顺序逻辑，二者不可能漂移。
pub fn hit_path(tree: &LayoutTree, x: f32, y: f32) -> Vec<NodeIndex> {
    let geo = geometry(tree);
    let visible = |i: NodeIndex| -> bool {
        let g = geo[i as usize];
        match g.rect {
            Some(r) => rect_contains(r, x, y) && g.clip.map_or(true, |c| rect_contains(c, x, y)),
            None => false,
        }
    };
    let mut hits: Vec<NodeIndex> = paint_order(tree)
        .into_iter()
        .filter(|&i| visible(i))
        .collect();
    hits.reverse();   // 最后绘制的在最上层
    hits
}

/// 冒泡链：`target` 自身 + 其全部祖先（自深到浅）——**纯结构**，与几何无关。
///
/// 为什么与「命中路径」分开：DOM 的事件传播沿**祖先链**（无论祖先是否被点到），
/// 而命中路径只含「几何上被点到的节点」（子级溢出父盒时二者不同）。
/// 事件派发用本函数；`hit_path` 用于命中语义与验证。
pub fn bubble_chain(tree: &LayoutTree, target: NodeIndex) -> Vec<NodeIndex> {
    let mut out = Vec::with_capacity(8);
    let mut cur = target;
    let mut guard = 0usize;
    while cur != NO_PARENT && (cur as usize) < tree.nodes.len() && guard <= tree.nodes.len() {
        out.push(cur);
        cur = tree.get(cur).parent;
        guard += 1;   // ★防环：脏数据（父指针成环）不得让宿主死循环
    }
    out
}

/// 命中的**诊断读数**（供 FFI/宿主一次性取回：目标 + 路径 + 冒泡链）
#[derive(Debug, Clone, Default, PartialEq)]
pub struct HitResult {
    /// 最上层命中节点（`None` = 未命中）
    pub target: Option<NodeIndex>,
    /// 命中路径（自上层到根；只含几何上被点到的节点）
    pub path: Vec<NodeIndex>,
    /// 冒泡链（target 自身 + 全部祖先；target 为 `None` 时为空）
    pub chain: Vec<NodeIndex>,
}

/// 一次调用同时取回 target / path / chain（宿主派发的唯一入口）
pub fn hit_result(tree: &LayoutTree, x: f32, y: f32) -> HitResult {
    let path = hit_path(tree, x, y);
    let target = path.first().copied();
    let chain = match target {
        Some(t) => bubble_chain(tree, t),
        None => Vec::new(),
    };
    HitResult { target, path, chain }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::{LNode, TextMeasureRequest};
    use crate::style::{LStyle, Position, Size};

    fn node(id: u32, w: f32, h: f32) -> LNode {
        let mut s = LStyle::default();
        s.width = Some(w);
        s.height = Some(h);
        LNode::new(id, s)
    }

    fn node_at(id: u32, x: f32, y: f32, w: f32, h: f32) -> LNode {
        let mut n = node(id, w, h);
        n.rect = Rect { x, y, width: w, height: h };
        n
    }

    /// 手工搭树（rect 直接写入 = 模拟布局输出；本模块只吃几何）
    ///
    /// ★`roots` 必须**显式**给出——初版把所有节点都当根，导致「子级既是根又是子」
    ///   被遍历两遍（本仓实测：命中路径出现重复 id `[3,3,2,3,2,1]`）。
    fn tree_of(nodes: Vec<LNode>, roots: &[u32], edges: &[(u32, u32)]) -> LayoutTree {
        let mut t = LayoutTree::new();
        for n in nodes {
            t.push(n);
        }
        for &r in roots {
            let i = t.index_of_id(r).unwrap();
            t.roots.push(i);
        }
        for &(p, c) in edges {
            let (pi, ci) = (t.index_of_id(p).unwrap(), t.index_of_id(c).unwrap());
            t.add_child(pi, ci);
        }
        t
    }

    #[test]
    fn basic_hit_and_containment_is_half_open() {
        // 单节点 100×50 @ (10,20)
        let t = tree_of(vec![node_at(1, 10.0, 20.0, 100.0, 50.0)], &[1], &[]);
        assert_eq!(hit_test(&t, 10.0, 20.0), Some(0), "左上角含（闭）");
        assert_eq!(hit_test(&t, 109.9, 69.9), Some(0), "右下角内");
        // ★半开区间：右/下边界不含（与浏览器一致）
        assert_eq!(hit_test(&t, 110.0, 40.0), None, "右边界不含");
        assert_eq!(hit_test(&t, 50.0, 70.0), None, "下边界不含");
        assert_eq!(hit_test(&t, 9.9, 40.0), None, "左外");
    }

    #[test]
    fn deepest_child_wins_and_path_is_topmost_first() {
        // 父 0,0,100,100；子 0,0,50,50
        let mut parent = node(1, 100.0, 100.0);
        parent.rect = Rect { x: 0.0, y: 0.0, width: 100.0, height: 100.0 };
        let child = node_at(2, 0.0, 0.0, 50.0, 50.0);
        let t = tree_of(vec![parent, child], &[1], &[(1, 2)]);

        let path: Vec<u32> = hit_path(&t, 10.0, 10.0).iter().map(|&i| t.get(i).id).collect();
        assert_eq!(path, vec![2, 1], "★自上层到根（DOM elementsFromPoint 的逆序）");
        assert_eq!(t.get(hit_test(&t, 10.0, 10.0).unwrap()).id, 2, "最深者胜出");

        let path2: Vec<u32> = hit_path(&t, 80.0, 80.0).iter().map(|&i| t.get(i).id).collect();
        assert_eq!(path2, vec![1], "只有父含该点");
    }

    #[test]
    fn later_sibling_paints_on_top_and_wins() {
        // 两个重叠兄弟：后者（树序靠后）绘制在上 → 逆序探测应命中后者
        let mut root = node(1, 100.0, 100.0);
        root.rect = Rect { x: 0.0, y: 0.0, width: 100.0, height: 100.0 };
        let a = node_at(2, 0.0, 0.0, 60.0, 60.0);
        let b = node_at(3, 20.0, 20.0, 60.0, 60.0); // 与 a 重叠于 (20,20)-(60,60)
        let t = tree_of(vec![root, a, b], &[1], &[(1, 2), (1, 3)]);

        assert_eq!(t.get(hit_test(&t, 30.0, 30.0).unwrap()).id, 3, "★重叠区由后绘制的兄弟命中");
        assert_eq!(t.get(hit_test(&t, 5.0, 5.0).unwrap()).id, 2, "仅 a 覆盖处命中 a");

        // (30,30) 在 a、b、root 三者盒内 → 路径应含全部三者（a 被压在 b 下，但仍在点上）
        let over = |x: f32, y: f32| -> Vec<u32> {
            hit_path(&t, x, y).iter().map(|&i| t.get(i).id).collect()
        };
        assert_eq!(over(30.0, 30.0), vec![3, 2, 1], "重叠区：b（上层）→ a → root，三者都在点上");
        // (70,70) 在 b 与 root 内、**不在** a 内（a 止于 60）→ a 不进路径
        assert_eq!(over(70.0, 70.0), vec![3, 1], "★未被覆盖的兄弟不进命中路径");
    }

    #[test]
    fn overflow_hidden_clips_descendants_but_not_itself() {
        // 父 0,0,100,50 overflow:hidden；子 8,40,200,100（溢出父盒）
        let mut parent = node(1, 100.0, 50.0);
        parent.style.overflow = Overflow::Hidden;
        parent.rect = Rect { x: 0.0, y: 0.0, width: 100.0, height: 50.0 };
        let child = node_at(2, 8.0, 40.0, 200.0, 100.0);
        let t = tree_of(vec![parent, child], &[1], &[(1, 2)]);

        // 子级盒内、且在父盒内的部分 → 命中子级
        assert_eq!(t.get(hit_test(&t, 50.0, 45.0).unwrap()).id, 2, "裁剪区内的子级可命中");
        // 子级盒内、但超出父盒（y=60 > 父底 50）→ 被裁剪，子级不可命中；
        // 父盒也不含该点 → 无命中（★不是「回落到父」）
        assert_eq!(hit_test(&t, 50.0, 60.0), None, "★超出裁剪区 → 不可命中（不得回落父级）");
        // 父盒内、子级盒外 → 命中父
        assert_eq!(t.get(hit_test(&t, 95.0, 10.0).unwrap()).id, 1, "父自身仍可命中");
    }

    #[test]
    fn nested_clip_intersects() {
        // 外 0,0,100,100 overflow:hidden；内 50,50,100,100 overflow:hidden；叶 50,50,80,80
        let mut outer = node(1, 100.0, 100.0);
        outer.style.overflow = Overflow::Hidden;
        outer.rect = Rect { x: 0.0, y: 0.0, width: 100.0, height: 100.0 };
        let mut inner = node_at(2, 50.0, 50.0, 100.0, 100.0);
        inner.style.overflow = Overflow::Hidden;
        let leaf = node_at(3, 50.0, 50.0, 80.0, 80.0);
        let t = tree_of(vec![outer, inner, leaf], &[1], &[(1, 2), (2, 3)]);

        // 内层盒 (50,50)-(150,150)，被外层裁到 (50,50)-(100,100)；叶盒 (100,100)-(180,180)
        // → 交集为空：叶在 100..180，外层止于 100（半开）→ 无一命中
        assert_eq!(hit_test(&t, 120.0, 120.0), None, "★嵌套裁剪交集为空 → 叶不可命中");
        // 95,95 在外层裁剪区内、内层盒内；叶盒从 100 起 → 不含 → 命中内层
        assert_eq!(t.get(hit_test(&t, 95.0, 95.0).unwrap()).id, 2, "内层（含裁剪后区域）");
    }

    #[test]
    fn display_none_is_unhittable_and_not_descended() {
        let mut root = node(1, 100.0, 100.0);
        root.rect = Rect { x: 0.0, y: 0.0, width: 100.0, height: 100.0 };
        let mut hidden = node_at(2, 0.0, 0.0, 100.0, 100.0);
        hidden.style.display = Display::None;
        let grandchild = node_at(3, 0.0, 0.0, 100.0, 100.0);
        let t = tree_of(vec![root, hidden, grandchild], &[1], &[(1, 2), (2, 3)]);

        let path: Vec<u32> = hit_path(&t, 50.0, 50.0).iter().map(|&i| t.get(i).id).collect();
        assert_eq!(path, vec![1], "★display:none 子树整棵不可命中（含其后代）");
    }

    #[test]
    fn child_outside_parent_box_is_still_hittable_when_not_clipped() {
        // overflow:visible：子级溢出父盒 → 子级可命中，但父**不**进路径
        let mut parent = node(1, 50.0, 50.0);
        parent.rect = Rect { x: 0.0, y: 0.0, width: 50.0, height: 50.0 };
        let child = node_at(2, 40.0, 40.0, 100.0, 100.0);
        let t = tree_of(vec![parent, child], &[1], &[(1, 2)]);

        assert_eq!(t.get(hit_test(&t, 100.0, 100.0).unwrap()).id, 2, "溢出部分仍可命中");
        let path: Vec<u32> = hit_path(&t, 100.0, 100.0).iter().map(|&i| t.get(i).id).collect();
        assert_eq!(path, vec![2], "★父不含该点 → 不在命中路径（与 elementsFromPoint 一致）");
    }

    #[test]
    fn zero_size_node_never_hits() {
        let t = tree_of(vec![node_at(1, 0.0, 0.0, 0.0, 0.0)], &[1], &[]);
        assert_eq!(hit_test(&t, 0.0, 0.0), None, "零尺寸不可命中（半开区间为空）");
    }

    #[test]
    fn multiple_roots_later_root_wins() {
        let mut a = node_at(1, 0.0, 0.0, 100.0, 100.0);
        a.id = 1;
        let b = node_at(2, 0.0, 0.0, 100.0, 100.0);
        let t = tree_of(vec![a, b], &[1, 2], &[]);
        assert_eq!(t.get(hit_test(&t, 50.0, 50.0).unwrap()).id, 2, "后绘制（数组靠后）的根在上");
    }

    #[test]
    fn bubble_chain_goes_through_ancestors_regardless_of_geometry() {
        let mut root = node(1, 50.0, 50.0);
        root.rect = Rect { x: 0.0, y: 0.0, width: 50.0, height: 50.0 };
        let child = node_at(2, 40.0, 40.0, 100.0, 100.0);    // 溢出父盒
        let t = tree_of(vec![root, child], &[1], &[(1, 2)]);
        let child_idx = t.index_of_id(2).unwrap();

        let chain: Vec<u32> = bubble_chain(&t, child_idx).iter().map(|&i| t.get(i).id).collect();
        assert_eq!(chain, vec![2, 1], "★冒泡链含**全部**祖先（与几何无关）——事件派发用此语义");
    }

    #[test]
    fn hit_result_carries_target_path_and_chain() {
        let mut root = node(1, 100.0, 100.0);
        root.rect = Rect { x: 0.0, y: 0.0, width: 100.0, height: 100.0 };
        let child = node_at(2, 10.0, 10.0, 30.0, 30.0);
        let t = tree_of(vec![root, child], &[1], &[(1, 2)]);

        let r = hit_result(&t, 20.0, 20.0);
        assert_eq!(t.get(r.target.unwrap()).id, 2);
        let ids = |v: &Vec<NodeIndex>| -> Vec<u32> { v.iter().map(|&i| t.get(i).id).collect() };
        assert_eq!(ids(&r.path), vec![2, 1]);
        assert_eq!(ids(&r.chain), vec![2, 1]);

        let miss = hit_result(&t, 500.0, 500.0);
        assert!(miss.target.is_none() && miss.path.is_empty() && miss.chain.is_empty());
    }

    /// ★★两相位锁：**定位元素绘制在在流兄弟之上**（CSS 2.1 附录 E 的简化模型）。
    ///
    /// 【为什么必须有这条测试】这是本模块唯一一处「直觉会写错」的地方：
    ///   初版实现是「每个父级内子级树序」（纯树序）。用真实 Chromium 探针实测后发现
    ///   **纯树序是错的** —— absolute 弟弟在前、static 哥哥在后时，浏览器仍把 absolute 画在上面。
    ///   更关键的是：相位是**按层叠上下文**而非按父级 —— 深处 static 子树里的 absolute，
    ///   仍绘制在更外层**后置**的 static 兄弟之上（探针 E 实测）。
    ///
    /// 本测试用「探针 D/E 的等价结构」锁死该语义。
    #[test]
    fn positioned_paints_above_later_in_flow_sibling_even_when_deeply_nested() {
        // root(200×120)
        //   ├── A(200×60, static)
        //   │    └── A0(200×10, static)
        //   │         └── A1(100×60 @20,20, absolute)   ← 与 B 重叠
        //   └── B(200×60, static, margin-top:-80 → 覆盖 y=20..80)
        let mut root = node(1, 200.0, 120.0);
        root.rect = Rect { x: 0.0, y: 0.0, width: 200.0, height: 120.0 };
        let a = node_at(2, 0.0, 0.0, 200.0, 60.0);
        let a0 = node_at(3, 0.0, 0.0, 200.0, 10.0);
        let mut a1 = node_at(4, 20.0, 20.0, 100.0, 60.0);
        a1.style.position = crate::style::Position::Absolute;
        // B 在流中被 a 的高度+负 margin 推到 y=20（这里直接给绝对几何，命中只看几何）
        let b = node_at(5, 0.0, 20.0, 200.0, 60.0);

        let t = tree_of(vec![root, a, a0, a1, b], &[1], &[(1, 2), (1, 5), (2, 3), (3, 4)]);

        // 绘制序：相位 1 收集 A、A0、B（遇 A1 定位则跳过）；相位 2 收集 A1
        let paint: Vec<u32> = paint_order(&t).iter().map(|&i| t.get(i).id).collect();
        let pos_a1 = paint.iter().position(|&x| x == 4).expect("A1 应在绘制序中");
        let pos_b = paint.iter().position(|&x| x == 5).expect("B 应在绘制序中");
        assert!(pos_a1 > pos_b, "★深层 absolute（A1）必须绘制在后置的 static 兄弟（B）之后：{paint:?}");

        // 命中：重叠点 (30,40) → A1 必须在 B 之上（最上层）
        let path: Vec<u32> = hit_path(&t, 30.0, 40.0).iter().map(|&i| t.get(i).id).collect();
        assert_eq!(path.first(), Some(&4), "★命中应为 A1（画在上面的那个）：{path:?}");
        // A 的盒 (0,0)-(200,60) **含**该点 → 入路径；A0 (0,0)-(200,10) 不含 → 不入
        assert_eq!(path, vec![4, 5, 2, 1], "A1 → B → A → root（自上层到根）");
        // 对照：纯树序模型会给出 [5, 4, ...]（B 在上）—— 与浏览器实测不符
        assert_ne!(path.first(), Some(&5), "★最上层必须是 A1（定位元素），不是 B（纯树序的错误答案）");
    }

    /// ★绘制序与命中的**共享**性：命中路径必须逐位等于「逆绘制序中可见者」
    #[test]
    fn hit_path_equals_reverse_of_paint_order_filtered_by_visibility() {
        let mut root = node(1, 100.0, 100.0);
        root.rect = Rect { x: 0.0, y: 0.0, width: 100.0, height: 100.0 };
        let mut abs = node_at(2, 10.0, 10.0, 60.0, 60.0);
        abs.style.position = crate::style::Position::Absolute;
        let later = node_at(3, 0.0, 30.0, 100.0, 40.0);   // 在流、树序在后
        let t = tree_of(vec![root, abs, later], &[1], &[(1, 2), (1, 3)]);

        for (x, y) in [(30.0, 40.0), (20.0, 20.0), (50.0, 95.0), (95.0, 5.0)] {
            let expected: Vec<u32> = paint_order(&t)
                .into_iter()
                .rev()
                .filter(|&i| {
                    let r = t.get(i).rect;
                    rect_contains(r, x, y)
                })
                .map(|i| t.get(i).id)
                .collect();
            let got: Vec<u32> = hit_path(&t, x, y).iter().map(|&i| t.get(i).id).collect();
            assert_eq!(got, expected, "({x},{y})：命中必须 = 逆绘制序过滤");
        }
    }

    /// ★★顺序锁：命中必须与「绘制序」**严格互为逆序**。
    ///
    /// 为什么要有它：绘制（宿主指令流 / render-cmd）与命中若各自演化，会出现
    /// 「看到的在上、点到的在下」——这是自绘框架最隐蔽也最致命的一类 bug
    /// （用户「点了没反应」或「点到了看不见的东西」）。本测试把「绘制序」写成
    /// **与本文件同一份口径的独立实现**（前序遍历：自身 → 子级树序），
    /// 再断言「命中结果 == 逆绘制序中第一个含点者」。
    #[test]
    fn hit_order_is_reverse_of_paint_order() {
        // 场景：root → [A, B]，A → [A1, A2]；B 与 A1 重叠；A1 被 A 裁剪
        let mut root = node(1, 200.0, 200.0);
        root.rect = Rect { x: 0.0, y: 0.0, width: 200.0, height: 200.0 };
        let mut a = node_at(2, 0.0, 0.0, 100.0, 100.0);
        a.style.overflow = Overflow::Hidden;
        let a1 = node_at(3, 0.0, 0.0, 100.0, 100.0);
        let a2 = node_at(4, 50.0, 50.0, 100.0, 100.0);   // 被 A 裁剪到 (50,50)-(100,100)
        let b = node_at(5, 60.0, 60.0, 100.0, 100.0);    // 与 A 的裁剪区重叠于 (60,60)-(100,100)
        let t = tree_of(vec![root, a, a1, a2, b], &[1], &[(1, 2), (1, 5), (2, 3), (2, 4)]);

        // 独立实现的绘制序（前序，树序子级）+ 裁剪记账
        fn paint_order(tree: &LayoutTree) -> Vec<(NodeIndex, Rect, Option<Rect>)> {
            let mut out = Vec::new();
            fn walk(tree: &LayoutTree, i: NodeIndex, ox: f32, oy: f32, clip: Option<Rect>, out: &mut Vec<(NodeIndex, Rect, Option<Rect>)>) {
                let n = tree.get(i);
                if n.style.display == Display::None {
                    return;
                }
                let abs = Rect { x: ox + n.rect.x, y: oy + n.rect.y, width: n.rect.width, height: n.rect.height };
                out.push((i, abs, clip));       // 自身先画
                let child_clip = if n.style.overflow != Overflow::Visible {
                    Some(clip.map_or(abs, |c| super::intersect(c, abs)))
                } else {
                    clip
                };
                for &c in &n.children {
                    walk(tree, c, abs.x, abs.y, child_clip, out);
                }
            }
            for &r in &tree.roots {
                walk(tree, r, 0.0, 0.0, None, &mut out);
            }
            out
        }

        let probes: Vec<(f32, f32)> = vec![
            (10.0, 10.0), (30.0, 80.0), (75.0, 75.0), (95.0, 95.0), (110.0, 110.0), (150.0, 150.0), (250.0, 10.0),
        ];
        for (x, y) in probes {
            let order = paint_order(&t);
            // 逆绘制序中第一个「含点且未被裁剪」的节点 = 命中目标
            let expected = order.iter().rev().find(|(_, r, clip)| {
                rect_contains(*r, x, y) && clip.map_or(true, |c| rect_contains(c, x, y))
            });
            let got = hit_test(&t, x, y);
            assert_eq!(
                got.map(|i| t.get(i).id),
                expected.map(|(i, _, _)| t.get(*i).id),
                "★({x},{y})：命中必须等于逆绘制序的首个含点者（看到的在上 = 点到的在上）"
            );
            // 命中路径也必须是「逆绘制序中所有含点者」按该顺序
            let expected_path: Vec<u32> = order
                .iter()
                .rev()
                .filter(|(_, r, clip)| rect_contains(*r, x, y) && clip.map_or(true, |c| rect_contains(c, x, y)))
                .map(|(i, _, _)| t.get(*i).id)
                .collect();
            let got_path: Vec<u32> = hit_path(&t, x, y).iter().map(|&i| t.get(i).id).collect();
            assert_eq!(got_path, expected_path, "★({x},{y})：命中路径 = 逆绘制序的含点序列");
        }
    }

    #[test]
    fn text_leaf_is_hittable_like_any_box() {
        // 文本叶子也参与命中（真实场景：点文字要触发所在行的行为）
        let mut root = node(1, 100.0, 40.0);
        root.rect = Rect { x: 0.0, y: 0.0, width: 100.0, height: 40.0 };
        let mut text = node_at(2, 8.0, 8.0, 60.0, 20.0);
        text.text = Some(TextMeasureRequest { text: "提交订单".into(), style_key: 0 });
        let t = tree_of(vec![root, text], &[1], &[(1, 2)]);
        assert_eq!(t.get(hit_test(&t, 20.0, 15.0).unwrap()).id, 2, "文本叶子可命中");
        let _ = Size::default();
        let _ = Position::Static;
    }

    #[test]
    fn cycled_parents_do_not_hang_bubble_chain() {
        // ★脏数据防护：父指针成环时不得死循环
        let mut t = tree_of(vec![node_at(1, 10.0, 10.0, 10.0, 10.0), node_at(2, 10.0, 10.0, 10.0, 10.0)], &[], &[]);
        t.nodes[0].parent = 1;   // 1 → 2 且 2 → 1（环）
        t.nodes[1].parent = 0;
        let chain = bubble_chain(&t, 0);
        assert!(chain.len() <= 3, "成环时必须终止（实际 {chain:?}）");
    }
}
