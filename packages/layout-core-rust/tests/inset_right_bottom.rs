// packages/layout-core-rust/tests/inset_right_bottom.rs
// ★★★批次 8（CSS 兼容对齐 · [Rust] 定位）：`right` / `bottom` 引擎行为测试（2026-10-04）
//
// 【证明什么】absolute 子节点用 `right`/`bottom` 锚定 ⇒ 定位在父**右下角**
//   （超级应用刚需：角标 / FAB / 关闭按钮 / 底部弹层锚点）。这是"引擎支持 right/bottom"的直接证据。
use proteus_layout_core::{FlexDirection, LNode, LStyle, LayoutEngine, LayoutTree, Position, RootConstraint, TaffyEngine};

#[test]
fn absolute_right_bottom_anchors_to_bottom_right() {
    let mut tree = LayoutTree::new();
    // 父：200×200（相对定位，作为 containing block）
    let root_style = LStyle {
        width: Some(200.0),
        height: Some(200.0),
        flex_direction: FlexDirection::Column,
        ..Default::default()
    };
    let root = tree.push(LNode::new(1, root_style));

    // 子：absolute，right=10、bottom=5，尺寸 30×20 ⇒ 期望 x = 200-10-30 = 160, y = 200-5-20 = 175
    let child_style = LStyle {
        position: Position::Absolute,
        right: Some(10.0),
        bottom: Some(5.0),
        width: Some(30.0),
        height: Some(20.0),
        ..Default::default()
    };
    let child = tree.push(LNode::new(2, child_style));
    tree.add_child(root, child);
    tree.roots.push(root);

    let mut engine = TaffyEngine::new();
    let out = engine.layout(&mut tree, RootConstraint::definite(200.0, 200.0));
    let r = out.rect_of(child).expect("子节点应有矩形");
    assert!((r.x - 160.0).abs() < 0.5, "right=10 ⇒ x≈160，实际 {}", r.x);
    assert!((r.y - 175.0).abs() < 0.5, "bottom=5 ⇒ y≈175，实际 {}", r.y);
    assert!((r.width - 30.0).abs() < 0.5, "宽度 30，实际 {}", r.width);
    assert!((r.height - 20.0).abs() < 0.5, "高度 20，实际 {}", r.height);
}
