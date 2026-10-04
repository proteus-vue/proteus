// packages/layout-core-rust/tests/gap_axes.rs
// ★★★批次 31（CSS 兼容对齐 · [Rust]）：两值 gap（row-gap / column-gap）引擎行为测试（2026-10-04）
//
// 【证明什么】`gap: 8px 12px`（行 8 / 列 12）——此前只支持单值（两轴同）⇒ 两值被丢弃。
use proteus_layout_core::{FlexDirection, LNode, LStyle, LayoutEngine, LayoutTree, RootConstraint, TaffyEngine};

#[test]
fn row_and_column_gap_are_independent() {
    // 行容器（横向）：4 个 40 宽块 + column_gap=20 ⇒ 子项 x 依次 0/60/120/180
    let mut tree = LayoutTree::new();
    let root = tree.push(LNode::new(1, LStyle {
        width: Some(300.0), height: Some(60.0), flex_direction: FlexDirection::Row,
        gap: 0.0, column_gap: Some(20.0), ..Default::default()
    }));
    let mut ids = vec![];
    for i in 0..4u32 {
        let idx = tree.push(LNode::new(2 + i, LStyle { width: Some(40.0), height: Some(40.0), flex_shrink: 0.0, ..Default::default() }));
        tree.add_child(root, idx); ids.push(idx);
    }
    tree.roots.push(root);
    let mut eng = TaffyEngine::new();
    let out = eng.layout(&mut tree, RootConstraint::definite(300.0, 60.0));
    let xs: Vec<f32> = ids.iter().map(|i| out.rect_of(*i).map(|r| r.x).unwrap_or(f32::NAN)).collect();
    for (i, expect) in [0.0f32, 60.0, 120.0, 180.0].iter().enumerate() {
        assert!((xs[i] - expect).abs() < 0.5, "column-gap=20 ⇒ 第 {} 项 x≈{}，实际 {}", i + 1, expect, xs[i]);
    }
}

#[test]
fn row_gap_affects_wrapped_lines() {
    // wrap 容器宽 100：两个 60 宽块换行 + row_gap=30 ⇒ 第二行 y = 第一行高(20) + 30 = 50
    let mut tree = LayoutTree::new();
    let root = tree.push(LNode::new(1, LStyle {
        width: Some(100.0), height: Some(200.0), flex_direction: FlexDirection::Row,
        flex_wrap: proteus_layout_core::FlexWrap::Wrap,
        align_content: "flex-start".to_string(),   // 不拉伸行 ⇒ 行高 = 内容高，gap 可精确断言
        row_gap: Some(30.0), ..Default::default()
    }));
    let a = tree.push(LNode::new(2, LStyle { width: Some(60.0), height: Some(20.0), flex_shrink: 0.0, ..Default::default() }));
    let b = tree.push(LNode::new(3, LStyle { width: Some(60.0), height: Some(20.0), flex_shrink: 0.0, ..Default::default() }));
    tree.add_child(root, a); tree.add_child(root, b); tree.roots.push(root);
    let mut eng = TaffyEngine::new();
    let out = eng.layout(&mut tree, RootConstraint::definite(100.0, 200.0));
    let rb = out.rect_of(b).expect("b 有矩形");
    assert!(rb.y >= 45.0 && rb.y <= 55.0, "row_gap=30 ⇒ 第二行 y≈50，实际 {}", rb.y);
}
