// packages/layout-core-rust/tests/page_root_flex_shrink.rs
// ★★★决策 #1052（2026-10-18 · 用户「安卓的首页列表项看着被压缩了那么多，每一个都非常窄」）
//
// 【要证明什么】**页面根若被钉成定高（`position:absolute; inset:0`）**，则内核默认
//   `display:flex; flex-direction:column` + 子项默认 `flex-shrink:1` ⇒ 内容超高时
//   **所有子项被等比压缩**（真机实测：31 个列表项从 132px 压到 72px = CSS 24px vs Web 42.5px）。
//
// 【修法】运行期包层（`packages/cli/src/app-runtime-content.ts` 的 `wrapViewportRoot`）只给
//   页面根 `absolute` + top/left/right，**不设 bottom** ⇒ 高度 auto、由内容撑开。
//
// 【本测试锁两侧】含 bottom ⇒ 子项被压缩（缺陷形态可复现）；去掉 bottom ⇒ 子项保持测量高。
use proteus_layout_core::engine::TableTextMeasurer;
use proteus_layout_core::{
    FlexDirection, LNode, LStyle, LayoutEngine, LayoutTree, Position, RootConstraint, Size, TaffyEngine,
};
use std::collections::HashMap;

const ITEM_H: f32 = 132.0; // 列表项期望高 = padding 36*2 + 文本 60

/// `pin_bottom` = 复现 `inset:0` 的旧形态；`false` = 修复后（高度 auto）。
fn run(pin_bottom: bool) -> (f32, f32) {
    // 31 个列表项，每项两个文本子项（60 / 48 高）
    let mut m: HashMap<u32, Size> = HashMap::new();
    for i in 0..31u32 {
        let base = 100 + i * 10;
        m.insert(base, Size { width: 400.0, height: 60.0 });
        m.insert(base + 1, Size { width: 100.0, height: 48.0 });
    }

    let mut tree = LayoutTree::new();
    // app-root：定高 = 视口（`widthRatio:1; heightRatio:1`，由包层产出）
    let mut outer = LStyle { ..Default::default() };
    outer.width = Some(1080.0);
    outer.height = Some(2400.0);
    outer.flex_direction = FlexDirection::Column;
    let o = tree.push(LNode::new(97, outer));

    // 页面根（旧根被包层改写）：absolute + top/left/right(+bottom?) + minHeight + padding
    let mut s0 = LStyle { ..Default::default() };
    s0.position = Position::Absolute;
    s0.top = Some(0.0);
    s0.left = Some(0.0);
    s0.right = Some(0.0);
    if pin_bottom {
        s0.bottom = Some(0.0); // ← 缺陷：把高度钉成视口高
    }
    s0.min_height = Some(2400.0);
    s0.width_ratio = Some(1.0);
    s0.flex_direction = FlexDirection::Column;
    s0.padding = proteus_layout_core::Edges { top: 192.0, right: 36.0, bottom: 156.0, left: 36.0 };
    let n0 = tree.push(LNode::new(0, s0));

    for i in 0..31u32 {
        let base = 100 + i * 10;
        let mut si = LStyle { ..Default::default() };
        si.flex_direction = FlexDirection::Row;
        si.padding = proteus_layout_core::Edges { top: 36.0, right: 42.0, bottom: 36.0, left: 42.0 };
        si.margin = proteus_layout_core::Edges { top: 0.0, right: 0.0, bottom: 24.0, left: 0.0 };
        let ni = tree.push(LNode::new(i + 1, si));
        let mut a = LNode::new(base, LStyle { ..Default::default() });
        a.text = Some(proteus_layout_core::TextMeasureRequest { text: format!("item{i}"), style_key: 0 });
        let ia = tree.push(a);
        let mut b = LNode::new(base + 1, LStyle { ..Default::default() });
        b.text = Some(proteus_layout_core::TextMeasureRequest { text: "0".into(), style_key: 0 });
        let ib = tree.push(b);
        tree.add_child(o, n0);
        tree.add_child(n0, ni);
        tree.add_child(ni, ia);
        tree.add_child(ni, ib);
    }
    tree.roots.push(o);

    let mut eng = TaffyEngine::new().with_measurer(Box::new(TableTextMeasurer::new(m)));
    let out = eng.layout(&mut tree, RootConstraint::definite(1080.0, 2400.0));
    let root_h = out.rect_of(n0).map(|r| r.height).unwrap_or(0.0);
    // 节点序：0=app-root, 1=page root, 2=第一个列表项
    let first_item_h = out.rects.get(2).copied().flatten().map(|r| r.height).unwrap_or(0.0);
    (root_h, first_item_h)
}

#[test]
fn pinned_page_root_compresses_children() {
    let (_, item_h) = run(true);
    assert!(
        item_h < ITEM_H - 1.0,
        "含 bottom:0（定高页根）时子项应被压缩（期望 <{ITEM_H}，实测 {item_h}）——这是 #1052 的缺陷形态"
    );
}

#[test]
fn auto_height_page_root_keeps_children_intact() {
    let (root_h, item_h) = run(false);
    assert!(
        (item_h - ITEM_H).abs() < 1.0,
        "去掉 bottom 后子项应保持测量高 {ITEM_H}（实测 {item_h}）"
    );
    assert!(
        root_h > 2401.0,
        "去掉 bottom 后页根应由内容撑开（应 > 2400 视口高，实测 {root_h}）"
    );
}
