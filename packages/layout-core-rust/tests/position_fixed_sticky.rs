// packages/layout-core-rust/tests/position_fixed_sticky.rs
// ★批 A（2026-10-08 · 决策 #651）：`position: fixed` / `position: sticky` 的**内核布局**行为
//
// 【证明什么】
//   · fixed：inset 相对 containing block，**布局同 absolute**（宿主负责不随滚动——本测试只证"能受理且按 inset 布局"）。
//   · sticky：**布局同 static**（inset 是吸附阈值、非布局偏移）——即 top/left **不**移动静态位置。
//   · 回归：这两个值此前在 ffi 层**直接报错**（未知 position）⇒ 本测试同时是"内核受理它们"的证据。
use proteus_layout_core::{FlexDirection, LNode, LStyle, LayoutEngine, LayoutTree, Position, RootConstraint, TaffyEngine};

#[test]
fn fixed_lays_out_like_absolute_with_inset() {
    let mut tree = LayoutTree::new();
    let root = tree.push(LNode::new(1, LStyle { width: Some(200.0), height: Some(200.0), flex_direction: FlexDirection::Column, ..Default::default() }));
    // 兄弟撑高，确保 fixed 元素不参与流
    let tall = tree.push(LNode::new(3, LStyle { width: Some(200.0), height: Some(50.0), ..Default::default() }));
    tree.add_child(root, tall);
    // fixed：top=10 / left=20，尺寸 40×30 ⇒ 期望落 (20,10)
    let fixed = tree.push(LNode::new(2, LStyle {
        position: Position::Fixed, top: Some(10.0), left: Some(20.0),
        width: Some(40.0), height: Some(30.0), ..Default::default()
    }));
    tree.add_child(root, fixed);
    tree.roots.push(root);

    let out = TaffyEngine::new().layout(&mut tree, RootConstraint::definite(200.0, 200.0));
    let r = out.rect_of(fixed).expect("fixed 节点应有矩形");
    assert!((r.x - 20.0).abs() < 0.5, "left=20 ⇒ x≈20，实际 {}", r.x);
    assert!((r.y - 10.0).abs() < 0.5, "top=10 ⇒ y≈10，实际 {}", r.y);
}

#[test]
fn sticky_lays_out_like_static_inset_does_not_offset() {
    let mut tree = LayoutTree::new();
    let root = tree.push(LNode::new(1, LStyle { width: Some(200.0), height: Some(200.0), flex_direction: FlexDirection::Column, ..Default::default() }));
    // 兄弟在前（高度 50）⇒ sticky 元素静态位置 y 应 = 50（**不**被 top 抵消）
    let first = tree.push(LNode::new(3, LStyle { width: Some(200.0), height: Some(50.0), ..Default::default() }));
    tree.add_child(root, first);
    let sticky = tree.push(LNode::new(2, LStyle {
        position: Position::Sticky, top: Some(10.0),
        width: Some(200.0), height: Some(20.0), ..Default::default()
    }));
    tree.add_child(root, sticky);
    tree.roots.push(root);

    let out = TaffyEngine::new().layout(&mut tree, RootConstraint::definite(200.0, 200.0));
    let r = out.rect_of(sticky).expect("sticky 节点应有矩形");
    assert!((r.y - 50.0).abs() < 0.5, "sticky 布局同 static（top 不作偏移）⇒ y≈50，实际 {}", r.y);
}
