// ★规避方案验证：Taffy 的指数爆炸能否被工程手段压住？
// 方案 A：给 auto 尺寸链的容器加 flex_basis（提供主轴基尺寸，跳过 min/max-content 探测）
// 方案 B：给容器加 min_size（同目的）
// 方案 C：给容器显式 size（已知有效，作对照）
// 方案 D：用 available_space = Definite（而非 MaxContent）作为根约束
use taffy::prelude::*;
use taffy::{AvailableSpace, TaffyTree};

fn chain(depth: usize, mode: &str) -> usize {
    let mut tree: TaffyTree<u32> = TaffyTree::new();
    let mut cur = tree.new_leaf_with_context(Style { size: Size { width: auto(), height: auto() }, ..Default::default() }, 0).unwrap();
    for _ in 0..depth {
        let st = match mode {
            "auto" => Style { display: Display::Flex, flex_direction: FlexDirection::Column, size: Size { width: auto(), height: auto() }, ..Default::default() },
            "basis" => Style { display: Display::Flex, flex_direction: FlexDirection::Column, flex_basis: length(30.0), size: Size { width: auto(), height: auto() }, ..Default::default() },
            "min-size" => Style { display: Display::Flex, flex_direction: FlexDirection::Column, min_size: Size { width: length(100.0), height: length(30.0) }, size: Size { width: auto(), height: auto() }, ..Default::default() },
            "explicit" => Style { display: Display::Flex, flex_direction: FlexDirection::Column, size: Size { width: length(200.0), height: length(30.0) }, ..Default::default() },
            _ => unreachable!(),
        };
        cur = tree.new_with_children(st, &[cur]).unwrap();
    }
    let mut calls = 0usize;
    tree.compute_layout_with_measure(cur, Size { width: AvailableSpace::Definite(300.0), height: AvailableSpace::MaxContent },
        |known, _a, _id, ctx: Option<&mut u32>, _s| { if ctx.is_some() { calls += 1; } Size { width: known.width.unwrap_or(100.0), height: 20.0 } }).unwrap();
    calls
}

fn main() {
    println!("{:>6} | {:>10} | {:>10} | {:>10} | {:>10}", "depth", "auto", "basis", "min-size", "explicit");
    println!("{}", "-".repeat(60));
    for d in [2, 4, 6, 8, 10, 12] {
        println!("{:>6} | {:>10} | {:>10} | {:>10} | {:>10}",
            d, chain(d, "auto"), chain(d, "basis"), chain(d, "min-size"), chain(d, "explicit"));
    }
}
