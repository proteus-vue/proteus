// packages/layout-core-rust/tests/aspect_ratio.rs
// ★★★批次 24（CSS 兼容对齐 · [Rust]）：aspect-ratio 引擎行为测试（2026-10-04）
//
// 【证明什么】`aspect-ratio: 2` ⇒ 定宽后按比例得高（媒体卡/占位图）。taffy 原生支持。
use proteus_layout_core::{FlexDirection, LNode, LStyle, LayoutEngine, LayoutTree, RootConstraint, TaffyEngine};

#[test]
fn aspect_ratio_derives_height_from_width() {
    // 容器 300 宽 → 子 width:150 + aspect-ratio:2 ⇒ 高 = 150/2 = 75
    let mut tree = LayoutTree::new();
    let root = tree.push(LNode::new(1, LStyle {
        width: Some(300.0), height: Some(300.0), flex_direction: FlexDirection::Column, ..Default::default()
    }));
    let child = tree.push(LNode::new(2, LStyle {
        width: Some(150.0), aspect_ratio: Some(2.0), ..Default::default()
    }));
    tree.add_child(root, child);
    tree.roots.push(root);

    let mut eng = TaffyEngine::new();
    let out = eng.layout(&mut tree, RootConstraint::definite(300.0, 300.0));
    let r = out.rect_of(child).expect("子节点应有矩形");
    assert!((r.width - 150.0).abs() < 0.5, "宽 150，实际 {}", r.width);
    assert!((r.height - 75.0).abs() < 0.5, "aspect-ratio:2 ⇒ 高 75，实际 {}", r.height);
}

#[test]
fn no_aspect_ratio_keeps_height() {
    // 对照：不设 aspect-ratio + 显式高 ⇒ 高不变（确保是 aspect_ratio 在起作用）
    let mut tree = LayoutTree::new();
    let root = tree.push(LNode::new(1, LStyle {
        width: Some(300.0), height: Some(300.0), flex_direction: FlexDirection::Column, ..Default::default()
    }));
    let child = tree.push(LNode::new(2, LStyle { width: Some(150.0), height: Some(40.0), ..Default::default() }));
    tree.add_child(root, child);
    tree.roots.push(root);
    let mut eng = TaffyEngine::new();
    let out = eng.layout(&mut tree, RootConstraint::definite(300.0, 300.0));
    let r = out.rect_of(child).expect("子节点应有矩形");
    assert!((r.height - 40.0).abs() < 0.5, "无 aspect ⇒ 高 40，实际 {}", r.height);
}
