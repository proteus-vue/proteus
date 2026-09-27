// 深度扫描：measure 调用数随嵌套深度的增长曲线（判断是否指数）
use taffy::prelude::*;
use taffy::{AvailableSpace, TaffyTree};

fn chain(depth: usize, auto_size: bool) -> usize {
    let mut tree: TaffyTree<u32> = TaffyTree::new();
    let leaf_style = Style { size: Size { width: auto(), height: auto() }, ..Default::default() };
    let mut cur = tree.new_leaf_with_context(leaf_style, 0).unwrap();
    for _ in 0..depth {
        let st = if auto_size {
            Style { display: Display::Flex, flex_direction: FlexDirection::Column, size: Size { width: auto(), height: auto() }, ..Default::default() }
        } else {
            Style { display: Display::Flex, flex_direction: FlexDirection::Column, size: Size { width: length(200.0), height: length(30.0) }, ..Default::default() }
        };
        cur = tree.new_with_children(st, &[cur]).unwrap();
    }
    let mut calls = 0usize;
    tree.compute_layout_with_measure(
        cur,
        Size { width: AvailableSpace::Definite(300.0), height: AvailableSpace::MaxContent },
        |input: taffy::LayoutInput, _id, ctx: Option<&mut u32>, _s| {
            if ctx.is_some() { calls += 1; }
            let w = input.known_dimensions.width.unwrap_or(100.0);
            taffy::LayoutOutput::from_outer_size(Size { width: w, height: 20.0 })
        },
    ).unwrap();
    calls
}

fn wide(width: usize, rows: usize) -> usize {
    // 宽树：rows 行 × width 列，全部显式尺寸
    let mut tree: TaffyTree<u32> = TaffyTree::new();
    let leaf = tree.new_leaf_with_context(Style { size: Size { width: length(40.0), height: length(16.0) }, ..Default::default() }, 0).unwrap();
    let row = tree.new_with_children(Style { display: Display::Flex, flex_direction: FlexDirection::Row, size: Size { width: auto(), height: auto() }, ..Default::default() }, &vec![leaf; width]).unwrap();
    let root = tree.new_with_children(Style { display: Display::Flex, flex_direction: FlexDirection::Column, size: Size { width: length(750.0), height: auto() }, ..Default::default() }, &vec![row; rows]).unwrap();
    let mut calls = 0usize;
    tree.compute_layout_with_measure(root, Size { width: AvailableSpace::Definite(750.0), height: AvailableSpace::MaxContent },
        |input: taffy::LayoutInput, _id, ctx: Option<&mut u32>, _s| { if ctx.is_some() { calls += 1; } let w = input.known_dimensions.width.unwrap_or(40.0); taffy::LayoutOutput::from_outer_size(Size { width: w, height: 16.0 }) }).unwrap();
    calls
}

fn main() {
    println!("═══ 深链（auto 尺寸容器）═══");
    for d in [1, 2, 3, 4, 5, 6, 8, 10, 12, 14] {
        let c = chain(d, true);
        println!("  depth {:>2}: {:>8} 次   (2^d = {:>8})", d, c, 1u64 << d.min(30));
    }
    println!("\n═══ 深链（显式尺寸容器）═══");
    for d in [1, 2, 3, 4, 5, 6, 8, 10, 12, 14] {
        println!("  depth {:>2}: {:>8} 次", d, chain(d, false));
    }
    println!("\n═══ 宽树（显式尺寸，非链）═══");
    for (w, r) in [(5, 1), (10, 1), (20, 1), (50, 1), (100, 1)] {
        println!("  {}×{}: {:>8} 次（叶子 {}）", w, r, wide(w, r), w * r);
    }
}
