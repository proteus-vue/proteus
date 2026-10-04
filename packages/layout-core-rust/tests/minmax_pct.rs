// packages/layout-core-rust/tests/minmax_pct.rs
// ★★★批次 19（CSS 兼容对齐 · [Rust]）：百分比 min/max 尺寸引擎行为测试（2026-10-04）
//
// 【证明什么】`max-width: 100%`（不溢出容器）/ `min-height: 100%` 等超应用常用写法：
//   百分比 min/max 相对**父内容盒**解析。此前被丢弃 ⇒ App 不钳制、Web 钳制（多端不一致）。
use proteus_layout_core::{FlexDirection, LNode, LStyle, LayoutEngine, LayoutTree, RootConstraint, TaffyEngine};

#[test]
fn max_width_pct_clamps_to_parent() {
    // 父 200 宽 → 子 content 宽 300（flexShrink=0 保持），max-width:100% (=200) ⇒ 子被钳到 200
    let mut tree = LayoutTree::new();
    let root = tree.push(LNode::new(1, LStyle {
        width: Some(200.0), height: Some(100.0), flex_direction: FlexDirection::Row, ..Default::default()
    }));
    let child = tree.push(LNode::new(2, LStyle {
        width: Some(300.0), height: Some(40.0), flex_shrink: 0.0,
        max_width_pct: Some(1.0), // 100%
        ..Default::default()
    }));
    tree.add_child(root, child);
    tree.roots.push(root);

    let mut eng = TaffyEngine::new();
    let out = eng.layout(&mut tree, RootConstraint::definite(200.0, 100.0));
    let r = out.rect_of(child).expect("子节点应有矩形");
    assert!((r.width - 200.0).abs() < 0.5, "max-width:100% ⇒ 宽被钳到父宽 200，实际 {}", r.width);
}

#[test]
fn min_height_pct_fills_parent() {
    // 父 100 高 → 子高 20（flexShrink=0），min-height:100% (=100) ⇒ 子被撑到 100
    let mut tree = LayoutTree::new();
    let root = tree.push(LNode::new(1, LStyle {
        width: Some(200.0), height: Some(100.0), flex_direction: FlexDirection::Column, ..Default::default()
    }));
    let child = tree.push(LNode::new(2, LStyle {
        width: Some(40.0), height: Some(20.0), flex_shrink: 0.0,
        min_height_pct: Some(1.0), // 100%
        ..Default::default()
    }));
    tree.add_child(root, child);
    tree.roots.push(root);

    let mut eng = TaffyEngine::new();
    let out = eng.layout(&mut tree, RootConstraint::definite(200.0, 100.0));
    let r = out.rect_of(child).expect("子节点应有矩形");
    assert!((r.height - 100.0).abs() < 0.5, "min-height:100% ⇒ 高被撑到父高 100，实际 {}", r.height);
}
