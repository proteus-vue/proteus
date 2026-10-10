// packages/layout-core-rust/tests/kernel_text_baseline.rs
// ★★★B-T1（2026-10-10）：**文本基线对齐**引擎行为测试
//
// 【要证明什么】taffy 0.14 的度量回调**只返回 Size**、叶子基线恒 `Baselines::NONE`
//   （`taffy-0.14.0/src/compute/leaf.rs`）⇒ `align-items: baseline` 对文本会按盒对齐（**错的**）。
//   本内核在 `write_back` 后做**基线后处理**：让同容器内文本子项的**真实基线共线**。
//
// 【判据设计】基线刻意取 ≠ 盒高（否则"盒底对齐"与"基线对齐"同结果，测不出后处理）：
//   两个文本叶子：A 高 20 基线 12（有下沉 8）· B 高 30 基线 30（满高）。
//   ⇒ 正确基线对齐后必须满足 `A.y + 12 == B.y + 30`（基线在一条线上）。
use proteus_layout_core::engine::TableTextMeasurer;
use proteus_layout_core::{FlexDirection, LNode, LStyle, LayoutEngine, LayoutTree, RootConstraint, Size, TaffyEngine};
use std::collections::HashMap;

fn build_baseline_case(measurer: TableTextMeasurer) -> (LayoutTree, u32, u32) {
    build_baseline_case_order(measurer, false)
}

/// `swap=true` ⇒ 子项顺序反转（大字号在前）——用于锁"参考基线只看基线值，与 taffy 已摆的 y 无关"。
fn build_baseline_case_order(_measurer: TableTextMeasurer, swap: bool) -> (LayoutTree, u32, u32) {
    let mut tree = LayoutTree::new();
    let mut root_style = LStyle { width: Some(400.0), height: Some(100.0), ..Default::default() };
    root_style.flex_direction = FlexDirection::Row;
    root_style.align_items = "baseline".to_string();
    let root = tree.push(LNode::new(1, root_style));
    let order: [u32; 2] = if swap { [11, 10] } else { [10, 11] };
    let mut ids = vec![];
    for id in order {
        let mut n = LNode::new(id, LStyle { flex_shrink: 0.0, ..Default::default() });
        n.text = Some(proteus_layout_core::TextMeasureRequest { text: format!("t{id}"), style_key: 7 });
        let idx = tree.push(n);
        tree.add_child(root, idx);
        ids.push(id);
    }
    tree.roots.push(root);
    (tree, 10, 11)
}

#[test]
fn baseline_alignment_aligns_text_baselines() {
    // 注入度量：A(10) 100×20 基线 12 · B(11) 100×30 基线 30
    let mut m = TableTextMeasurer::new(HashMap::new());
    m.set(10, Size { width: 100.0, height: 20.0 });
    m.set(11, Size { width: 100.0, height: 30.0 });
    m.set_baseline(10, 12.0);
    m.set_baseline(11, 30.0);

    let (mut tree, id_a, id_b) = build_baseline_case(m.clone());
    let mut engine = TaffyEngine::new().with_measurer(Box::new(m));
    let out = engine.layout(&mut tree, RootConstraint::definite(400.0, 100.0));
    let ya = out.rect_of(tree.index_of_id(id_a).unwrap()).unwrap().y;
    let yb = out.rect_of(tree.index_of_id(id_b).unwrap()).unwrap().y;
    let base_a = ya + 12.0;
    let base_b = yb + 30.0;
    assert!(
        (base_a - base_b).abs() < 0.5,
        "★基线必须共线（A.y+12={base_a} vs B.y+30={base_b}；ya={ya}, yb={yb}）——\
         内核基线后处理未生效（或在按盒对齐）",
    );
    // 反证：基线≠盒高 ⇒ 若按"盒底对齐"，A.y+20 == B.y+30 ⇒ base 差 = −8（与本断言不符）
    assert!(
        (ya + 20.0 - (yb + 30.0)).abs() > 1.0,
        "★必须是**基线**对齐（非盒底）：ya={ya} yb={yb}",
    );
}

#[test]
fn baseline_alignment_is_order_independent() {
    // ★锁"参考基线只看基线值"：大字号子项**在前/在后**两种排布，基线对齐结果必须同（否则 taffy 的盒底 y 泄漏进了参考基线）。
    let mut m = TableTextMeasurer::new(HashMap::new());
    m.set(10, Size { width: 100.0, height: 20.0 });
    m.set(11, Size { width: 100.0, height: 30.0 });
    m.set_baseline(10, 12.0);
    m.set_baseline(11, 30.0);
    let measure = |swap: bool| -> (f32, f32) {
        let (mut tree, _a, _b) = build_baseline_case_order(m.clone(), swap);
        let mut engine = TaffyEngine::new().with_measurer(Box::new(m.clone()));
        let out = engine.layout(&mut tree, RootConstraint::definite(400.0, 100.0));
        (
            out.rect_of(tree.index_of_id(10).unwrap()).unwrap().y,
            out.rect_of(tree.index_of_id(11).unwrap()).unwrap().y,
        )
    };
    let (a1, b1) = measure(false);
    let (a2, b2) = measure(true);
    assert!((a1 - a2).abs() < 0.5 && (b1 - b2).abs() < 0.5, "★基线对齐须与子项顺序无关（{a1},{b1} vs {a2},{b2}）——参考基线不得用 taffy 已摆的 y");
    // 两排布都应满足基线共线（A.y+12 == B.y+30）
    assert!((a1 + 12.0 - (b1 + 30.0)).abs() < 0.5);
    assert!((a2 + 12.0 - (b2 + 30.0)).abs() < 0.5);
}

#[test]
fn no_baseline_means_no_alignment_change() {
    // 未提供基线（缺省 0）⇒ 不采集 ⇒ 后处理零操作。
    //   ★taffy **自己**会按 align-items:baseline 做**盒底对齐**（叶基线 NONE ⇒ 用盒底近似）：
    //     A(高20) B(高30) ⇒ ya=10, yb=0（= taffy-only 结果）。本内核后处理**不介入**时必须是这两个值。
    let mut m = TableTextMeasurer::new(HashMap::new());
    m.set(10, Size { width: 100.0, height: 20.0 });
    m.set(11, Size { width: 100.0, height: 30.0 });
    let (mut tree, id_a, id_b) = build_baseline_case(m.clone());
    let mut engine = TaffyEngine::new().with_measurer(Box::new(m));
    let out = engine.layout(&mut tree, RootConstraint::definite(400.0, 100.0));
    let ya = out.rect_of(tree.index_of_id(id_a).unwrap()).unwrap().y;
    let yb = out.rect_of(tree.index_of_id(id_b).unwrap()).unwrap().y;
    assert!((ya - 10.0).abs() < 0.5 && yb.abs() < 0.5, "无基线 ⇒ 后处理零操作（应保持 taffy-only：ya=10 yb=0；实际 ya={ya}, yb={yb}）");
}
