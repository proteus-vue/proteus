// packages/layout-core-rust/tests/grid.rs
// ★★★批次 12（CSS 兼容对齐 · [Rust] 栅格）：CSS Grid 引擎行为测试（2026-10-04）
//
// 【证明什么】`display:grid` + 显式列（`1fr 1fr 100px`）⇒ 子项按网格铺开：
//   容器 300 宽、3 列（1fr 1fr 100px）⇒ 前两列各 100，末列 100；第二个子项 x = 100（进入第 2 列）。
use proteus_layout_core::{Display, LNode, LStyle, LayoutEngine, LayoutTree, RootConstraint, TaffyEngine};

#[test]
fn grid_explicit_columns_place_children_in_cells() {
    let mut tree = LayoutTree::new();
    let mut root_style = LStyle { width: Some(300.0), height: Some(100.0), ..Default::default() };
    root_style.display = Display::Grid;
    root_style.grid_template_columns = Some("1fr 1fr 100px".to_string());
    root_style.grid_template_rows = Some("100px".to_string());
    let root = tree.push(LNode::new(1, root_style));

    // 三个定高子项（grid 项）
    let mut ids = vec![];
    for i in 0..3u32 {
        let leaf = LStyle { height: Some(100.0), ..Default::default() };
        let idx = tree.push(LNode::new(2 + i, leaf));
        tree.add_child(root, idx);
        ids.push(idx);
    }
    tree.roots.push(root);

    let mut engine = TaffyEngine::new();
    let out = engine.layout(&mut tree, RootConstraint::definite(300.0, 100.0));
    let xs: Vec<f32> = ids.iter().map(|i| out.rect_of(*i).map(|r| r.x).unwrap_or(f32::NAN)).collect();
    let ws: Vec<f32> = ids.iter().map(|i| out.rect_of(*i).map(|r| r.width).unwrap_or(f32::NAN)).collect();
    // 三列各 100 ⇒ 子项 x 依次 0 / 100 / 200，宽各 100
    assert!(xs[0].abs() < 0.5, "第 1 列 x≈0，实际 {}", xs[0]);
    assert!((xs[1] - 100.0).abs() < 0.5, "第 2 列 x≈100，实际 {}", xs[1]);
    assert!((xs[2] - 200.0).abs() < 0.5, "第 3 列 x≈200，实际 {}", xs[2]);
    for (i, w) in ws.iter().enumerate() {
        assert!((*w - 100.0).abs() < 0.5, "第 {} 列宽≈100，实际 {}", i + 1, w);
    }
}
