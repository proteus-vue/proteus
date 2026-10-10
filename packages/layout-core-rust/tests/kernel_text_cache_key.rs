// packages/layout-core-rust/tests/kernel_text_cache_key.rs
// ★★★B-T3（2026-10-10）：**度量缓存键必须含文本策略维度**（white-space/word-break/line-clamp）
//
// 【要证明什么】内容寻址键 = (文本 ⊕ 字体签名 ⊕ **文本策略**, 宽度约束)。缺策略维度时，
//   两个「同文案 + 同字体签名 + 同宽、但 white-space 不同」的文本节点会**错误共用缓存项**
//   ⇒ 后者取前者的尺寸（真机上 style_key≠0 ⇒ 内容寻址生效 ⇒ 可达）。
//   本测试用**按 id 查表**的度量器（A 单行高 20 / B 折行高 30）——若缓存错误合并，B 会得到 20。
use proteus_layout_core::engine::TableTextMeasurer;
use proteus_layout_core::{FlexDirection, LNode, LStyle, LayoutEngine, LayoutTree, RootConstraint, Size, TaffyEngine};
use std::collections::HashMap;

#[test]
fn text_policy_is_part_of_measure_cache_key() {
    // 两个文本子节点：同文案「item」+ 同字体签名 7 + 同显式宽 100；仅 white-space 不同。
    let mut tree = LayoutTree::new();
    let mut root_style = LStyle { width: Some(400.0), height: Some(200.0), ..Default::default() };
    root_style.flex_direction = FlexDirection::Column;
    let root = tree.push(LNode::new(1, root_style));
    for (id, ws) in [(10u32, "nowrap"), (11u32, "normal")] {
        let leaf_style = LStyle { width: Some(100.0), white_space: Some(ws.to_string()), ..Default::default() };
        let mut n = LNode::new(id, leaf_style);
        n.text = Some(proteus_layout_core::TextMeasureRequest { text: "item".to_string(), style_key: 7 });
        let idx = tree.push(n);
        tree.add_child(root, idx);
    }
    tree.roots.push(root);

    // 度量表：A(10) 单行 100×20；B(11) 折行 100×30（策略不同 ⇒ 尺寸不同）
    let mut m = TableTextMeasurer::new(HashMap::new());
    m.set(10, Size { width: 100.0, height: 20.0 });
    m.set(11, Size { width: 100.0, height: 30.0 });

    let mut engine = TaffyEngine::new().with_measurer(Box::new(m));
    let out = engine.layout(&mut tree, RootConstraint::definite(400.0, 200.0));
    let ha = out.rect_of(tree.index_of_id(10).unwrap()).unwrap().height;
    let hb = out.rect_of(tree.index_of_id(11).unwrap()).unwrap().height;
    assert!((ha - 20.0).abs() < 0.5, "A(nowrap) 高应 20，实际 {ha}");
    assert!(
        (hb - 30.0).abs() < 0.5,
        "★B(normal/wrap) 高应 30（若为 20 = 策略未进缓存键 ⇒ 与 A 错误共用条目）：ha={ha} hb={hb}",
    );
    // 反证：两者确实各度量了一次（无错误缓存命中）
    assert!(engine.measure_calls() >= 2, "两节点策略不同 ⇒ 各自度量（measure_calls={}）", engine.measure_calls());
}
