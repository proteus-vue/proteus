// ★★交叉验证：Taffy 与 Yoga 在**同一批用例**上的结果是否一致
//   基准 = M1 的浏览器对拍用例（tests/e2e-layout-core-pixel.test.ts 的判据值）
use taffy::prelude::*;
use taffy::{AvailableSpace, TaffyTree};

fn main() {
    let mut pass = 0; let mut total = 0;
    let mut rep = |name: &str, got: f32, want: f32| {
        let ok = (got - want).abs() < 0.5;
        println!("  {} {:<34} got={:.1} want={:.1}", if ok {"✓"} else {"✗"}, name, got, want);
        total += 1; if ok { pass += 1; }
    };

    // 用例 1：row + space-between + padding（M1 用例 1 的判据）
    {
        let mut t: TaffyTree<()> = TaffyTree::new();
        let a = t.new_leaf(Style { size: Size{width:length(50.0), height:length(30.0)}, flex_shrink:0.0, ..Default::default()}).unwrap();
        let b = t.new_leaf(Style { size: Size{width:length(80.0), height:length(50.0)}, flex_shrink:0.0, ..Default::default()}).unwrap();
        let c = t.new_leaf(Style { size: Size{width:length(40.0), height:length(40.0)}, flex_shrink:0.0, ..Default::default()}).unwrap();
        let root = t.new_with_children(Style{
            display: Display::Flex, flex_direction: FlexDirection::Row,
            justify_content: Some(JustifyContent::SPACE_BETWEEN),
            align_items: Some(AlignItems::CENTER),
            size: Size{width:length(320.0), height:length(80.0)},
            padding: Rect{left:length(10.0), right:length(10.0), top:length(0.0), bottom:length(0.0)},
            ..Default::default()}, &[a,b,c]).unwrap();
        t.compute_layout(root, Size{width:AvailableSpace::Definite(320.0), height:AvailableSpace::Definite(80.0)}).unwrap();
        rep("case1.a.x (=0)", t.layout(a).unwrap().location.x, 10.0);
        rep("case1.c.right (=320)", t.layout(c).unwrap().location.x + t.layout(c).unwrap().size.width, 310.0);
        rep("case1.b.centered-y (=15)", t.layout(b).unwrap().location.y, 15.0);
    }

    // 用例 2：flex-grow 1:2:1（M1 用例 3 的判据）
    {
        let mut t: TaffyTree<()> = TaffyTree::new();
        let items: Vec<_> = [1.0f32, 2.0, 1.0].iter().map(|g| t.new_leaf(Style{flex_grow:*g, size:Size{width:auto(),height:length(50.0)}, ..Default::default()}).unwrap()).collect();
        let root = t.new_with_children(Style{display:Display::Flex, flex_direction:FlexDirection::Row, size:Size{width:length(400.0),height:length(50.0)}, ..Default::default()}, &items).unwrap();
        t.compute_layout(root, Size{width:AvailableSpace::Definite(400.0),height:AvailableSpace::Definite(50.0)}).unwrap();
        rep("case2.a.w (=100)", t.layout(items[0]).unwrap().size.width, 100.0);
        rep("case2.b.w (=200)", t.layout(items[1]).unwrap().size.width, 200.0);
        rep("case2.c.x (=300)", t.layout(items[2]).unwrap().location.x, 300.0);
    }

    // 用例 3：三层嵌套（M1 用例 8 的判据：内层 grow 子级宽度 228）
    {
        let mut t: TaffyTree<()> = TaffyTree::new();
        let a = t.new_leaf(Style{size:Size{width:length(30.0),height:length(40.0)}, flex_shrink:0.0, ..Default::default()}).unwrap();
        let b = t.new_leaf(Style{flex_grow:1.0, size:Size{width:auto(),height:length(40.0)}, flex_shrink:0.0, ..Default::default()}).unwrap();
        let row = t.new_with_children(Style{display:Display::Flex, flex_direction:FlexDirection::Row, gap:Size{width:length(4.0),height:length(0.0)}, size:Size{width:auto(),height:length(40.0)}, ..Default::default()}, &[a,b]).unwrap();
        let c = t.new_leaf(Style{size:Size{width:auto(),height:length(60.0)}, ..Default::default()}).unwrap();
        let col = t.new_with_children(Style{display:Display::Flex, flex_direction:FlexDirection::Column, gap:Size{width:length(0.0),height:length(6.0)}, flex_grow:1.0, size:Size{width:auto(),height:auto()}, ..Default::default()}, &[row,c]).unwrap();
        let s1 = t.new_leaf(Style{size:Size{width:auto(),height:length(30.0)}, ..Default::default()}).unwrap();
        let s2 = t.new_leaf(Style{size:Size{width:auto(),height:length(30.0)}, ..Default::default()}).unwrap();
        let side = t.new_with_children(Style{display:Display::Flex, flex_direction:FlexDirection::Column, size:Size{width:length(100.0),height:auto()}, ..Default::default()}, &[s1,s2]).unwrap();
        let root = t.new_with_children(Style{display:Display::Flex, flex_direction:FlexDirection::Row, gap:Size{width:length(12.0),height:length(0.0)},
            size:Size{width:length(360.0),height:length(200.0)},
            padding: Rect{left:length(10.0),right:length(10.0),top:length(10.0),bottom:length(10.0)}, ..Default::default()}, &[col,side]).unwrap();
        t.compute_layout(root, Size{width:AvailableSpace::Definite(360.0),height:AvailableSpace::Definite(200.0)}).unwrap();
        rep("case3.col.w (=228)", t.layout(col).unwrap().size.width, 228.0);
        rep("case3.innerRow.w (=228)", t.layout(row).unwrap().size.width, 228.0);
        rep("case3.growChild.w (=194)", t.layout(b).unwrap().size.width, 194.0);
        rep("case3.side.x (=250)", t.layout(side).unwrap().location.x, 250.0);
    }

    // 用例 4：absolute 定位（M1 用例 11 的判据）
    {
        let mut t: TaffyTree<()> = TaffyTree::new();
        let a = t.new_leaf(Style{size:Size{width:auto(),height:length(40.0)}, ..Default::default()}).unwrap();
        let abs = t.new_leaf(Style{position:Position::Absolute, inset: Rect{left:length(60.0), top:length(50.0), right:auto(), bottom:auto()},
            size:Size{width:length(80.0), height:length(30.0)}, ..Default::default()}).unwrap();
        let c = t.new_leaf(Style{size:Size{width:auto(),height:length(40.0)}, ..Default::default()}).unwrap();
        let root = t.new_with_children(Style{display:Display::Flex, flex_direction:FlexDirection::Column,
            size:Size{width:length(300.0),height:length(150.0)}, padding: Rect{left:length(30.0),top:length(20.0),right:length(0.0),bottom:length(0.0)}, ..Default::default()}, &[a,abs,c]).unwrap();
        t.compute_layout(root, Size{width:AvailableSpace::Definite(300.0),height:AvailableSpace::Definite(150.0)}).unwrap();
        rep("case4.abs.x (=60)", t.layout(abs).unwrap().location.x, 60.0);
        rep("case4.abs.y (=50)", t.layout(abs).unwrap().location.y, 50.0);
        rep("case4.third.y (=60)", t.layout(c).unwrap().location.y, 60.0);
    }

    println!("\n  交叉验证合计：{}/{} 项与浏览器基线一致", pass, total);
}
