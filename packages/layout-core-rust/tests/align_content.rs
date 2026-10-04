// packages/layout-core-rust/tests/align_content.rs
// ★★★批次 11（CSS 兼容对齐 · [Rust] 布局）：`align-content` 引擎行为测试（2026-10-04）
//
// 【证明什么】多行弹性容器里，`align-content` 控制**行组整体**在交叉轴的位置。
//   构造：高 200 的列容器、子项会 wrap 成多行（总行高 < 200）⇒
//   · `flex-start` ⇒ 行组贴顶（首行 y≈0）；
//   · `center`   ⇒ 行组在中间（首行 y > 0）。
use proteus_layout_core::{FlexDirection, FlexWrap, LNode, LStyle, LayoutEngine, LayoutTree, RootConstraint, TaffyEngine};

/// 容器 200 宽 × 200 高，row+wrap，子项 4×（80 宽 × 40 高）⇒ 每行 2 个 ⇒ 两行（行高 40+40=80 < 200）
fn first_child_y(align_content: &str) -> f32 {
    let mut tree = LayoutTree::new();
    let root_style = LStyle {
        width: Some(200.0),
        height: Some(200.0),
        flex_direction: FlexDirection::Row,
        ..Default::default()
    };
    let mut root_style = root_style;
    root_style.flex_wrap = FlexWrap::Wrap;
    root_style.align_content = align_content.to_string();
    let root = tree.push(LNode::new(1, root_style));

    let mut first = 0;
    for i in 0..4u32 {
        let leaf = LStyle { width: Some(80.0), height: Some(40.0), flex_shrink: 0.0, ..Default::default() };
        let idx = tree.push(LNode::new(2 + i, leaf));
        tree.add_child(root, idx);
        if i == 0 { first = idx; }
    }
    tree.roots.push(root);

    let mut engine = TaffyEngine::new();
    let out = engine.layout(&mut tree, RootConstraint::definite(200.0, 200.0));
    out.rect_of(first).map(|r| r.y).unwrap_or(f32::NAN)
}

#[test]
fn align_content_center_offsets_rows() {
    let start = first_child_y("flex-start");
    let center = first_child_y("center");
    assert!(start.abs() < 1.0, "flex-start ⇒ 首行贴顶（y≈0），实际 {start}");
    // 两行共 80 高，容器 200 ⇒ center 时行组居中，首行 y ≈ (200-80)/2 = 60
    assert!((center - 60.0).abs() < 2.0, "center ⇒ 首行 y≈60，实际 {center}");
    assert!(center > start + 10.0, "center 应比 flex-start 明显下移");
}
