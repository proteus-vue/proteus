// packages/layout-core-rust/tests/flex_wrap.rs
// ★★★批次 6（CSS 兼容对齐 · [Rust] 布局）：`flex-wrap` 引擎行为测试（2026-10-04）
//
// 【证明什么】把 `flex_wrap = Wrap` 设在 row 容器上、子项总宽超过容器 ⇒ 引擎真的**换行**
//   （子项 y 分到多行）；而 `Nowrap` 不换行（同一行）。这是"引擎真的支持 flex-wrap"的直接证据。
use proteus_layout_core::{FlexDirection, FlexWrap, LNode, LStyle, LayoutEngine, LayoutTree, RootConstraint, TaffyEngine};

/// 构造：root(column, width=200) → row(width=200, 子 6×50 宽) —— 6×50=300 > 200 ⇒ wrap 应两行
fn child_ys(flex_wrap: FlexWrap) -> Vec<f32> {
    let mut tree = LayoutTree::new();
    let root_style = LStyle { width: Some(200.0), flex_direction: FlexDirection::Column, ..Default::default() };
    let root = tree.push(LNode::new(1, root_style));

    let mut row_style = LStyle { width: Some(200.0), flex_direction: FlexDirection::Row, ..Default::default() };
    row_style.flex_wrap = flex_wrap;
    row_style.flex_shrink = 0.0;
    let row = tree.push(LNode::new(2, row_style));
    tree.add_child(root, row);

    let mut ids = vec![];
    for i in 0..6u32 {
        // 定宽 50、定高 20、不收缩（否则 nowrap 下会被压扁而非换行）
        let leaf = LStyle { width: Some(50.0), height: Some(20.0), flex_shrink: 0.0, ..Default::default() };
        let idx = tree.push(LNode::new(3 + i, leaf));
        tree.add_child(row, idx);
        ids.push(idx);
    }
    tree.roots.push(root);

    let mut engine = TaffyEngine::new();
    let out = engine.layout(&mut tree, RootConstraint::loose_width(200.0));
    ids.iter()
        .map(|idx| out.rect_of(*idx).map(|r| r.y).unwrap_or(f32::NAN))
        .collect()
}

#[test]
fn wrap_splits_into_multiple_rows() {
    let ys = child_ys(FlexWrap::Wrap);
    let distinct: std::collections::BTreeSet<i32> = ys.iter().map(|y| (y * 100.0).round() as i32).collect();
    assert!(distinct.len() >= 2, "flex_wrap=wrap 应换行（多档 y），实际 y={ys:?}");
}

#[test]
fn nowrap_keeps_single_row() {
    let ys = child_ys(FlexWrap::Nowrap);
    let distinct: std::collections::BTreeSet<i32> = ys.iter().map(|y| (y * 100.0).round() as i32).collect();
    assert_eq!(distinct.len(), 1, "flex_wrap=nowrap 不应换行（单档 y），实际 y={ys:?}");
}
