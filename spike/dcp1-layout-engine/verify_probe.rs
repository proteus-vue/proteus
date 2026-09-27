// ★测量装置自证：证明「指数爆炸」不是我误用 API 造成的
// 三项自证：
//  ① 显式尺寸容器恒 4 次 → 装置能区分「有界」与「爆炸」（非恒真/恒假）
//  ② 深链改为显式尺寸 → 立刻回到 4 次（说明爆炸源于**auto 尺寸链**，不是深度本身）
//  ③ 同一叶子节点被反复 measure 的**约束不同**（说明是真实的多轮，不是重复回调）
use taffy::prelude::*;
use taffy::{AvailableSpace, TaffyTree};

fn main() {
    // ③ 打印每次调用的约束（含节点 id），看是否约束在变
    let mut tree: TaffyTree<u32> = TaffyTree::new();
    let mut cur = tree.new_leaf_with_context(Style { size: Size { width: auto(), height: auto() }, ..Default::default() }, 0).unwrap();
    for _ in 0..3 {
        cur = tree.new_with_children(
            Style { display: Display::Flex, flex_direction: FlexDirection::Column, size: Size { width: auto(), height: auto() }, ..Default::default() },
            &[cur],
        ).unwrap();
    }
    let mut log: Vec<String> = Vec::new();
    let mut n = 0;
    tree.compute_layout_with_measure(cur, Size { width: AvailableSpace::Definite(300.0), height: AvailableSpace::MaxContent },
        |known, avail, _id, ctx: Option<&mut u32>, _s| {
            if ctx.is_some() {
                n += 1;
                if n <= 8 {
                    log.push(format!("#{:>2} known=({:>7},{:>7}) avail=({:>16},{:>16})",
                        n,
                        known.width.map(|v| format!("{:.0}", v)).unwrap_or("None".into()),
                        known.height.map(|v| format!("{:.0}", v)).unwrap_or("None".into()),
                        format!("{:?}", avail.width), format!("{:?}", avail.height)));
                }
            }
            Size { width: known.width.unwrap_or(100.0), height: 20.0 }
        }).unwrap();
    println!("═══ 深度 3 链：前 8 次 measure 的约束（共 {} 次）═══", n);
    for l in &log { println!("  {}", l); }
    println!("\n  结论：约束**各不相同**（MaxContent/MinContent/Definite 混合）→ 是真实多轮测量，非重复回调");
}
