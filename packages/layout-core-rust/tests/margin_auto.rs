// packages/layout-core-rust/tests/margin_auto.rs
// ★★★批次 17（CSS 兼容对齐 · [Rust] 定位）：`margin: 0 auto` 水平居中引擎行为测试（2026-10-04）
//
// 【证明什么】Web 里 `margin: 0 auto`（行内块/固定宽元素）把剩余水平空间平分到左右 ⇒ **水平居中**。
//   这是超级应用刚需（卡片/表单/居中容器）。此前编译器**静默丢掉 auto** ⇒ App 不居中、Web 居中。
//   本测试直接验证引擎：flex 行容器里、宽 100 的子项 left/right 皆 auto ⇒ 居中（x = (300-100)/2 = 100）。
use proteus_layout_core::{
    FlexDirection, LNode, LStyle, LayoutEngine, LayoutTree, MarginAuto, RootConstraint, TaffyEngine,
};

#[test]
fn margin_auto_left_right_centers_child() {
    let mut tree = LayoutTree::new();
    // 父：300×100 行容器
    let root_style = LStyle {
        width: Some(300.0),
        height: Some(100.0),
        flex_direction: FlexDirection::Row,
        ..Default::default()
    };
    let root = tree.push(LNode::new(1, root_style));

    // 子：宽 100、高 40，左右 margin auto ⇒ 期望 x = (300-100)/2 = 100
    let child_style = LStyle {
        width: Some(100.0),
        height: Some(40.0),
        margin_auto: MarginAuto { top: false, right: true, bottom: false, left: true },
        ..Default::default()
    };
    let child = tree.push(LNode::new(2, child_style));
    tree.add_child(root, child);
    tree.roots.push(root);

    let mut engine = TaffyEngine::new();
    let out = engine.layout(&mut tree, RootConstraint::definite(300.0, 100.0));
    let r = out.rect_of(child).expect("子节点应有矩形");
    assert!((r.width - 100.0).abs() < 0.5, "宽度 100，实际 {}", r.width);
    assert!((r.x - 100.0).abs() < 0.5, "左右 auto ⇒ 水平居中 x≈100，实际 {}", r.x);
}

#[test]
fn without_auto_child_stays_left() {
    // 对照（破坏性验证的另一半）：不设 auto ⇒ 子项贴左（x≈0），确保是 auto 在起作用。
    let mut tree = LayoutTree::new();
    let root_style = LStyle {
        width: Some(300.0),
        height: Some(100.0),
        flex_direction: FlexDirection::Row,
        ..Default::default()
    };
    let root = tree.push(LNode::new(1, root_style));
    let child_style = LStyle { width: Some(100.0), height: Some(40.0), ..Default::default() };
    let child = tree.push(LNode::new(2, child_style));
    tree.add_child(root, child);
    tree.roots.push(root);

    let mut engine = TaffyEngine::new();
    let out = engine.layout(&mut tree, RootConstraint::definite(300.0, 100.0));
    let r = out.rect_of(child).expect("子节点应有矩形");
    assert!(r.x.abs() < 0.5, "无 auto ⇒ 贴左 x≈0，实际 {}", r.x);
}
