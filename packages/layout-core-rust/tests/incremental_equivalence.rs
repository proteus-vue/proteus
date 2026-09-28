// packages/layout-core-rust/tests/incremental_equivalence.rs
// ★★Vapor IR V5 —— **增量 ≡ 全量** 不变式（本仓实测补的覆盖缺口）
//
// 【为什么必须有这一层（本仓实测的动机）】
//   既有对齐基准 `tests/golden/browser-layout.json`（21 用例）测的是**全量布局**——
//   而 M1 起潜伏的**坐标缺陷**（范围非根时多叠加一次自身位置）恰恰活在**增量路径**里，
//   21 个用例**一个都没撞到**（因为它们的绑定目标偏移恰好为 0）。
//   ⇒ 缺口不是"覆盖率不够"，而是**测错了路径**：全量对了不代表增量对。
//
// 【不变式（判据形态）】
//   对任意树与任意变更：
//     ① 先全量布局一次（建立基准几何）
//     ② 施加变更后用**增量**重排 → 记下所有节点**绝对矩形**
//     ③ 另起一棵**施加了同样变更**的树，从头**全量**布局 → 记下所有节点绝对矩形
//     ④ 断言两者**逐节点相等**（容差 0.01）
//
// 【为什么这是个强判据】它把「增量路径」的正确性**归约到全量路径**——
//   而全量路径已有浏览器 golden 背书（21 用例 ≤0.5dp）。
//   两条合起来：增量 ⇒ 全量 ⇒ 浏览器。**这就把增量也锚定到了浏览器**。
//
// 【为什么"应该"相等（不是凑）】增量的范围定义是「布局边界：对外尺寸与内容无关」
//   ⇒ 边界子树按**固定约束**重排，其内部解与全量解**必然一致**；
//   边界之外的节点坐标不变 ⇒ 两棵树的绝对矩形应完全相同。
//   （若不等 ⇒ 要么边界判定错、要么坐标换算错、要么重排范围错。）
use std::collections::BTreeMap;

use proteus_layout_core::{
    Display, FlexDirection, LayoutEngine, LNode, LStyle, LayoutTree, NodeIndex, RootConstraint, TaffyEngine, NO_PARENT,
};

/* ────────────────────── 树构造工具 ────────────────────── */

fn mk(id: u32, parent: NodeIndex, style: LStyle) -> LNode {
    LNode {
        id,
        tag: String::new(),
        style,
        parent,
        children: vec![],
        text: None,
        native_host: false,
        dirty: false,
        rect: Default::default(),
    }
}

fn edges(top: f32, right: f32, bottom: f32, left: f32) -> proteus_layout_core::Edges {
    proteus_layout_core::Edges { top, right, bottom, left }
}

/// 一个「三层嵌套 + 非零偏移」的树（正是坐标缺陷的暴露形态）
///
/// root(1) → outer(2, margin-top 40) → inner(3, margin-left 24) → leaf(4, margin-top 12)
fn three_layer_tree() -> (LayoutTree, [NodeIndex; 4]) {
    let mut t = LayoutTree::new();
    let r = t.push(mk(
        1,
        NO_PARENT,
        LStyle {
            display: Display::Flex,
            flex_direction: FlexDirection::Column,
            width: Some(320.0),
            height: Some(480.0),
            ..Default::default()
        },
    ));
    t.roots.push(r);
    let outer = t.push(mk(
        2,
        r,
        LStyle {
            display: Display::Flex,
            flex_direction: FlexDirection::Column,
            width: Some(200.0),
            height: Some(160.0),
            margin: edges(40.0, 0.0, 0.0, 0.0),
            ..Default::default()
        },
    ));
    t.nodes[r as usize].children.push(outer);
    let inner = t.push(mk(
        3,
        outer,
        LStyle {
            display: Display::Flex,
            flex_direction: FlexDirection::Row,
            width: Some(120.0),
            height: Some(80.0),
            margin: edges(0.0, 0.0, 0.0, 24.0),
            ..Default::default()
        },
    ));
    t.nodes[outer as usize].children.push(inner);
    let leaf = t.push(mk(
        4,
        inner,
        LStyle { width: Some(30.0), height: Some(30.0), margin: edges(12.0, 0.0, 0.0, 0.0), ..Default::default() },
    ));
    t.nodes[inner as usize].children.push(leaf);
    (t, [r, outer, inner, leaf])
}

/// 一个「列表行」树：多行 + 每行内含子节点（类A/类B 的形态）
fn list_tree(rows: u32) -> (LayoutTree, Vec<NodeIndex>) {
    let mut t = LayoutTree::new();
    let r = t.push(mk(
        1,
        NO_PARENT,
        LStyle {
            display: Display::Flex,
            flex_direction: FlexDirection::Column,
            width: Some(375.0),
            height: Some(900.0),
            ..Default::default()
        },
    ));
    t.roots.push(r);
    let mut row_ids = Vec::new();
    for i in 0..rows {
        let row = t.push(mk(
            100 + i,
            r,
            LStyle {
                display: Display::Flex,
                flex_direction: FlexDirection::Row,
                width: Some(343.0),
                height: Some(56.0),
                flex_shrink: 0.0,
                margin: edges(0.0, 0.0, 8.0, 0.0),
                ..Default::default()
            },
        ));
        t.nodes[r as usize].children.push(row);
        let dot = t.push(mk(1000 + i, row, LStyle { width: Some(36.0), height: Some(36.0), ..Default::default() }));
        t.nodes[row as usize].children.push(dot);
        row_ids.push(row);
    }
    (t, row_ids)
}

/* ────────────────────── 绝对矩形快照 ────────────────────── */

/// 把所有节点的**绝对**矩形导出为 id → (x,y,w,h)
///
/// ★用绝对坐标（沿父链累加）——这正是坐标缺陷会显形的地方（相对坐标看不出叠加）。
fn snapshot_abs(tree: &LayoutTree) -> BTreeMap<u32, (f32, f32, f32, f32)> {
    fn accum(tree: &LayoutTree, idx: NodeIndex, ox: f32, oy: f32, out: &mut BTreeMap<u32, (f32, f32, f32, f32)>) {
        let n = tree.get(idx);
        let x = ox + n.rect.x;
        let y = oy + n.rect.y;
        out.insert(n.id, (x, y, n.rect.width, n.rect.height));
        for &c in &n.children {
            accum(tree, c, x, y, out);
        }
    }
    let mut out = BTreeMap::new();
    for &r in &tree.roots {
        accum(tree, r, 0.0, 0.0, &mut out);
    }
    out
}

fn assert_equivalent(label: &str, inc: &BTreeMap<u32, (f32, f32, f32, f32)>, full: &BTreeMap<u32, (f32, f32, f32, f32)>) {
    assert_eq!(inc.len(), full.len(), "{label}: 节点数不一致");
    for (id, a) in inc {
        let b = full.get(id).unwrap_or_else(|| panic!("{label}: 全量缺少节点 {id}"));
        for (k, (av, bv)) in [("x", (a.0, b.0)), ("y", (a.1, b.1)), ("w", (a.2, b.2)), ("h", (a.3, b.3))] {
            assert!(
                (av - bv).abs() < 0.01,
                "{label}: 节点 {id} 的 {k} 不一致 —— 增量 {av} vs 全量 {bv}\n  \
                 ⇒ 增量路径与全量路径解出了不同几何（边界判定 / 坐标换算 / 范围三者之一有错）"
            );
        }
    }
}

/* ────────────────────── 用例 ────────────────────── */

#[test]
fn incremental_equals_full_on_nonzero_offset_chain() {
    let (mut tree, [r, outer, inner, leaf]) = three_layer_tree();
    let mut eng = TaffyEngine::new().with_measurer(Box::new(proteus_layout_core::NullTextMeasurer));
    eng.layout(&mut tree, RootConstraint::definite(320.0, 480.0));
    let _ = (r, outer, inner);

    // ① 改**深层叶子**的宽度（范围应止于 inner —— 非根）
    tree.nodes[leaf as usize].style.width = Some(90.0);
    tree.nodes[leaf as usize].dirty = true;
    let scope = eng.relayout_scope_of(&tree, leaf);
    assert_ne!(scope, r, "范围不应退化为根（否则本用例失去意义）");
    eng.layout_incremental(&mut tree, leaf);
    let inc = snapshot_abs(&tree);

    // ② 另起一棵同样改了宽度的树，从头全量
    let (mut fresh, [_r2, _o2, _i2, leaf2]) = three_layer_tree();
    fresh.nodes[leaf2 as usize].style.width = Some(90.0);
    let mut eng2 = TaffyEngine::new().with_measurer(Box::new(proteus_layout_core::NullTextMeasurer));
    eng2.layout(&mut fresh, RootConstraint::definite(320.0, 480.0));
    let full = snapshot_abs(&fresh);

    assert_equivalent("三层非零偏移", &inc, &full);
    // 顺带把绝对值也钉住（防"两边一起错"）：leaf 绝对 y = 40(outer margin) + 12(leaf margin)
    let l = inc.get(&4).expect("leaf 应在快照里");
    assert!((l.1 - 52.0).abs() < 0.01, "leaf 绝对 y 应为 52（40+12），实际 {}", l.1);
}

#[test]
fn incremental_equals_full_on_list_rows() {
    // 类A：改第 3 行内的圆点宽（局部）
    let (mut tree, rows) = list_tree(8);
    let mut eng = TaffyEngine::new().with_measurer(Box::new(proteus_layout_core::NullTextMeasurer));
    eng.layout(&mut tree, RootConstraint::definite(375.0, 900.0));
    let target_dot = tree.nodes[rows[2] as usize].children[0];
    tree.nodes[target_dot as usize].style.width = Some(60.0);
    tree.nodes[target_dot as usize].dirty = true;
    eng.layout_incremental(&mut tree, target_dot);
    let inc = snapshot_abs(&tree);

    let (mut fresh, rows2) = list_tree(8);
    let d2 = fresh.nodes[rows2[2] as usize].children[0];
    fresh.nodes[d2 as usize].style.width = Some(60.0);
    let mut eng2 = TaffyEngine::new().with_measurer(Box::new(proteus_layout_core::NullTextMeasurer));
    eng2.layout(&mut fresh, RootConstraint::definite(375.0, 900.0));
    let full = snapshot_abs(&fresh);

    assert_equivalent("列表行·类A", &inc, &full);
}

#[test]
fn incremental_equals_full_when_boundary_itself_changes() {
    // 类B：改**行自身**高度 ⇒ 兄弟移位（范围上浮到根）
    let (mut tree, rows) = list_tree(8);
    let mut eng = TaffyEngine::new().with_measurer(Box::new(proteus_layout_core::NullTextMeasurer));
    eng.layout(&mut tree, RootConstraint::definite(375.0, 900.0));
    tree.nodes[rows[1] as usize].style.height = Some(90.0);
    tree.nodes[rows[1] as usize].dirty = true;
    eng.layout_incremental(&mut tree, rows[1]);
    let inc = snapshot_abs(&tree);

    let (mut fresh, rows2) = list_tree(8);
    fresh.nodes[rows2[1] as usize].style.height = Some(90.0);
    let mut eng2 = TaffyEngine::new().with_measurer(Box::new(proteus_layout_core::NullTextMeasurer));
    eng2.layout(&mut fresh, RootConstraint::definite(375.0, 900.0));
    let full = snapshot_abs(&fresh);

    assert_equivalent("列表行·类B（边界自身变化）", &inc, &full);
}

#[test]
fn incremental_equals_full_after_multiple_sequential_changes() {
    // ★连续多次增量（累积误差 / 状态残留的照妖镜）
    let (mut tree, rows) = list_tree(10);
    let mut eng = TaffyEngine::new().with_measurer(Box::new(proteus_layout_core::NullTextMeasurer));
    eng.layout(&mut tree, RootConstraint::definite(375.0, 900.0));

    // 连续改 5 处（交替类A / 类B）
    let mut changes: Vec<(u32, &'static str, f32)> = Vec::new();
    for (i, row) in rows.iter().take(5).enumerate() {
        if i % 2 == 0 {
            let dot = tree.nodes[*row as usize].children[0];
            tree.nodes[dot as usize].style.width = Some(40.0 + i as f32);
            tree.nodes[dot as usize].dirty = true;
            changes.push((dot, "w", 40.0 + i as f32));
            eng.layout_incremental(&mut tree, dot);
        } else {
            tree.nodes[*row as usize].style.height = Some(60.0 + i as f32);
            tree.nodes[*row as usize].dirty = true;
            changes.push((*row, "h", 60.0 + i as f32));
            eng.layout_incremental(&mut tree, *row);
        }
    }
    let inc = snapshot_abs(&tree);

    let (mut fresh, rows2) = list_tree(10);
    for (i, row) in rows2.iter().take(5).enumerate() {
        if i % 2 == 0 {
            let dot = fresh.nodes[*row as usize].children[0];
            fresh.nodes[dot as usize].style.width = Some(40.0 + i as f32);
        } else {
            fresh.nodes[*row as usize].style.height = Some(60.0 + i as f32);
        }
    }
    let mut eng2 = TaffyEngine::new().with_measurer(Box::new(proteus_layout_core::NullTextMeasurer));
    eng2.layout(&mut fresh, RootConstraint::definite(375.0, 900.0));
    let full = snapshot_abs(&fresh);

    assert_equivalent("连续 5 次增量", &inc, &full);
}
