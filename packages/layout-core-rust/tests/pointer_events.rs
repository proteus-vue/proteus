// packages/layout-core-rust/tests/pointer_events.rs
// ★★★批次 32（CSS 兼容对齐 · [Rust]）：`pointer-events: none` 命中测试行为测试（2026-10-04）
//
// 【证明什么】`pointer-events:none` 的节点**不参与命中**（事件穿透到其下）——浮层/遮罩刚需；
//   而它**仍占位**（有几何，只是不作命中目标）。对照 display:none（既不命中、也无几何）。
use proteus_layout_core::{hit_path, FlexDirection, LNode, LStyle, LayoutEngine, LayoutTree, Position, RootConstraint, TaffyEngine};

fn abs_rects(tree: &LayoutTree) -> Vec<Option<proteus_layout_core::Rect>> {
    tree.absolute_rects()
}

#[test]
fn pointer_events_none_is_not_a_hit_target() {
    // 父 200×200；子A（铺满、pointer-events:none）；子B（absolute 覆盖同区域、可命中）
    let mut tree = LayoutTree::new();
    let root = tree.push(LNode::new(1, LStyle { width: Some(200.0), height: Some(200.0), flex_direction: FlexDirection::Column, ..Default::default() }));
    // 覆盖层（穿透）
    let overlay_bar = LStyle { position: Position::Absolute, top: Some(0.0), left: Some(0.0), width: Some(200.0), height: Some(200.0), pointer_events: Some(false), ..Default::default() };
    let a = tree.push(LNode::new(2, overlay_bar));
    // 底层可命中
    let b = tree.push(LNode::new(3, LStyle { width: Some(200.0), height: Some(200.0), ..Default::default() }));
    tree.add_child(root, a); tree.add_child(root, b); tree.roots.push(root);

    let mut eng = TaffyEngine::new();
    eng.layout(&mut tree, RootConstraint::definite(200.0, 200.0));
    // 先确认 A 有几何（仍占位）
    let abs = abs_rects(&tree);
    assert!(abs[a as usize].is_some(), "pointer-events:none 的节点**仍占位**（有几何）");

    let hit: Vec<u32> = hit_path(&tree, 100.0, 100.0).iter().map(|&i| tree.get(i).id).collect();
    assert!(!hit.contains(&2), "pointer-events:none 的覆盖层不应是命中路径成员，实际 {:?}", hit);
    assert!(hit.contains(&3), "底层的可命中节点应在命中路径里，实际 {:?}", hit);
}

#[test]
fn without_pointer_events_overlay_wins_hit() {
    // 对照：覆盖层**可命中**时，它应是命中目标（最上层）
    let mut tree = LayoutTree::new();
    let root = tree.push(LNode::new(1, LStyle { width: Some(200.0), height: Some(200.0), flex_direction: FlexDirection::Column, ..Default::default() }));
    let a = tree.push(LNode::new(2, LStyle { position: Position::Absolute, top: Some(0.0), left: Some(0.0), width: Some(200.0), height: Some(200.0), ..Default::default() }));
    let b = tree.push(LNode::new(3, LStyle { width: Some(200.0), height: Some(200.0), ..Default::default() }));
    tree.add_child(root, a); tree.add_child(root, b); tree.roots.push(root);
    let mut eng = TaffyEngine::new();
    eng.layout(&mut tree, RootConstraint::definite(200.0, 200.0));
    let hit: Vec<u32> = hit_path(&tree, 100.0, 100.0).iter().map(|&i| tree.get(i).id).collect();
    assert!(hit.contains(&2), "默认（可命中）覆盖层应命中，实际 {:?}", hit);
}
