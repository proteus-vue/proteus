// 增量布局的收益量化：全量 vs 增量（同一棵树，改 1 个节点）
use proteus_layout_core::{
    AvailableSpace, FlexDirection, LStyle, LayoutEngine, LNode, LayoutTree, RootConstraint, TaffyEngine,
};
use std::time::Instant;

/// 是否给**行**显式宽高（决定树里有没有「布局边界」——本仓 §5.4 / 坑位 #11）
///
/// ★这是本实验的关键自变量：`is_layout_boundary()` = 宽高均显式 **且**有子级。
///   没有边界时，`relayout_scope_of` 会一路走到根 ⇒ 「增量」退化为**全量重排 + 额外开销**。
fn build(rows: u32, cols: u32, row_sized: bool) -> (LayoutTree, Vec<u32>) {
    let mut t = LayoutTree::new();
    let root = t.push(LNode::new(1, LStyle { width: Some(750.0), flex_direction: FlexDirection::Column, ..Default::default() }));
    let mut id = 2u32;
    let mut row_ids = Vec::new();
    for _ in 0..rows {
        let mut rs = LStyle { flex_direction: FlexDirection::Row, gap: 4.0, ..Default::default() };
        rs.flex_shrink = 0.0;
        if row_sized {
            // 行给显式宽高 → 成为**布局边界**（内部变更不外溢）
            rs.width = Some(750.0);
            rs.height = Some(20.0);
        }
        let r = t.push(LNode::new(id, rs)); id += 1; row_ids.push(r);   // ★存索引（tree.get 吃索引）
        t.add_child(root, r);
        for _ in 0..cols {
            let ls = LStyle { width: Some(40.0), height: Some(16.0), flex_shrink: 0.0, ..Default::default() };
            let l = t.push(LNode::new(id, ls)); id += 1;
            t.add_child(r, l);
        }
    }
    t.roots.push(root);
    (t, row_ids)
}

fn main() {
    for (rows, cols, sized) in [(50u32, 40u32, false), (50, 40, true), (100, 40, false), (100, 40, true), (250, 40, false), (250, 40, true)] {
        let (mut tree, rows_idx) = build(rows, cols, sized);
        let n = tree.len();
        let c = RootConstraint { width: AvailableSpace::Definite(750.0), height: AvailableSpace::MaxContent };
        let mut e = TaffyEngine::new();
        e.layout(&mut tree, c);                       // 预热
        let t0 = Instant::now();
        for _ in 0..5 { e.layout(&mut tree, c); }
        let full_ms = t0.elapsed().as_secs_f64() * 1000.0 / 5.0;

        // ★增量：改中间一行的某个叶子（改宽度 → 该行内重排，不应外溢到整棵树）
        let mid_row = rows_idx[rows_idx.len() / 2];
        let leaf = tree.get(mid_row).children[10];
        let t1 = Instant::now();
        let iters = 20;
        for _ in 0..iters {
            tree.get_mut(leaf).style.width = Some(41.0);
            tree.get_mut(leaf).dirty = true;
            e.layout_incremental(&mut tree, &[leaf]);
        }
        let inc_ms = t1.elapsed().as_secs_f64() * 1000.0 / iters as f64;
        // 边界数（诊断：解释增量为何快/慢）
        let bounds = (0..tree.len()).filter(|&i| tree.get(i as u32).is_layout_boundary()).count();
        println!("{:>5} 节点（{} 行×{}，行{}显式尺寸）· 边界 {:<4}：全量 {:>8.3}ms · 增量 {:>8.3}ms · 加速 {:.1}×",
                 n, rows, cols, if sized { "有" } else { "无" }, bounds, full_ms, inc_ms, full_ms / inc_ms);
    }
}
