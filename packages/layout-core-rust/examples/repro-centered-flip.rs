// 复现：居中网格 + 瓦片尺寸 patch 后，FLIP 位移为何只有 ~3px（真机 800 瓦片编舞的 FLIP 幕）
//
// 【背景】炫技场把网格从"左上角起排"改为"整块居中"（root: column + justifyContent:center +
//   alignItems:center）后，真机报告里 FLIP 幕的 `animated` 从 760 掉到 21、`maxDeltaPx` 从 114 掉到 3。
//   本程序用**内核本体**复刻该形态，判定是"布局没变"还是"FLIP 比较逻辑错"。
//
// 用法：cargo run --release --example repro-centered-flip
use proteus_layout_core::{AvailableSpace, FlexDirection, LStyle, LayoutEngine, LNode, LayoutTree, RootConstraint, TaffyEngine};
use proteus_layout_core::{Edges, NodeIndex};

const W: f32 = 390.0;
const H: f32 = 844.0;
const COLS: usize = 20;
const ROWS: usize = 40;
const N: usize = COLS * ROWS;
const PAD: f32 = 8.0;
/// 节点索引基址：root=0 · 行=1..=ROW S · 瓦片从 1+ROWS+1 起
const TILE_BASE: usize = 1 + ROWS;
const GAP: f32 = 3.0;

fn main() {
    let tile = ((W - PAD * 2.0 - GAP * (COLS as f32 - 1.0)) / COLS as f32).floor();
    println!("瓦片边长 = {tile}（期望 15）");

    // ① 居中形态（与 entry-showcase.ts 的 buildTree 一致）
    let mut tree = LayoutTree::new();
    let mut root = LNode::new(1, LStyle::default());
    root.style.flex_direction = FlexDirection::Column;
    root.style.width = Some(W);
    root.style.height = Some(H);
    root.style.padding = Edges { top: PAD, right: PAD, bottom: PAD, left: PAD };
    root.style.gap = GAP;
    root.style.justify_content = "center".to_string();
    root.style.align_items = "center".to_string();
    let root_idx = tree.push(root);

    let mut row_idx = Vec::new();
    for r in 0..ROWS {
        let mut row = LNode::new((2 + r) as u32, LStyle::default());
        row.style.flex_direction = FlexDirection::Row;
        row.style.gap = GAP;
        row.style.height = Some(tile);
        row.style.flex_shrink = 0.0;
        let idx = tree.push(row);
        row_idx.push(idx);
        tree.add_child(root_idx, idx);
    }
    let tile_base: u32 = 1000;
    for i in 0..N {
        let mut t = LNode::new(tile_base + i as u32, LStyle::default());
        t.style.width = Some(tile);
        t.style.height = Some(tile);
        t.style.flex_shrink = 0.0;
        let idx = tree.push(t);
        tree.add_child(row_idx[i / COLS], idx);
    }
    tree.roots.push(root_idx);

    let mut e = TaffyEngine::new();
    e.layout(&mut tree, RootConstraint { width: AvailableSpace::Definite(W), height: AvailableSpace::Definite(H) });

    let before = tree.absolute_rects();
    let t0 = before[TILE_BASE].unwrap(); // 第一片瓦片（id 1000）
    let t_mid = before[TILE_BASE + 9].unwrap(); // id 1009（中间）
    let t_last = before[TILE_BASE + 19].unwrap(); // id 1019（行尾）
    println!("① 居中布局（瓦片 {tile}）：首片 x={:.1} · 中片 x={:.1} · 行尾 x={:.1}（右缘 {:.1}）",
        t0.x, t_mid.x, t_last.x, t_last.x + t_last.width);
    let row0 = before[1].unwrap();
    println!("   第 0 行：x={:.1} w={:.1}（居中则应 ≈ {:.1}）", row0.x, row0.width, (W - row0.width) / 2.0);

    // ② patch：瓦片 15 → 9（与 flip-condense 同形）
    let to = 9.0f32;
    for i in 0..N {
        let idx = TILE_BASE + i;
        tree.get_mut(idx as u32).style.width = Some(to);
        tree.get_mut(idx as u32).style.height = Some(to);
        tree.get_mut(idx as u32).dirty = true;
    }
    // 触发重排（用一个瓦片作为脏点做增量，与 updatePatches 的多范围重排等价）
    let out = e.layout_incremental(&mut tree, &[TILE_BASE as NodeIndex]);
    println!("② 重排完成：relayout_count={}", out.relayout_count);

    let after = tree.absolute_rects();
    let a0 = after[TILE_BASE].unwrap();
    let a_mid = after[TILE_BASE + 9].unwrap();
    let a_last = after[TILE_BASE + 19].unwrap();
    println!("   瓦片 {to}：首片 x={:.1} · 中片 x={:.1} · 行尾 x={:.1}（右缘 {:.1}）",
        a0.x, a_mid.x, a_last.x, a_last.x + a_last.width);
    let row0b = after[1].unwrap();
    println!("   第 0 行：x={:.1} w={:.1}", row0b.x, row0b.width);

    // ③ FLIP 位移（dx = old - new，与内核 flip_start 同式）
    let mut moved = 0usize;
    let mut max_delta = 0f32;
    for i in 0..N {
        let idx = TILE_BASE + i;
        if let (Some(o), Some(n)) = (before[idx], after[idx]) {
            let dx = o.x - n.x;
            let dy = o.y - n.y;
            if dx.abs() > 0.5 || dy.abs() > 0.5 {
                moved += 1;
                max_delta = max_delta.max(dx.abs().max(dy.abs()));
            }
        }
    }
    println!("③ FLIP 位移：moved={moved} · maxDeltaPx={max_delta:.1}（真机报告：21 / 3）");
    println!();
    if moved > 700 {
        println!("✅ 内核侧位移正常 ⇒ 真机读数是**装置**问题（capture 时机 / 补丁没生效）");
    } else {
        println!("✗ 内核侧位移同样小 ⇒ 布局本身没变（居中形态下 patch 未改几何）");
    }
}
