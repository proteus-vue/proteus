// 用**库 API** 量 update 路径的分段耗时（本机 release）
//
// ★不走 FFI：examples 链接的是 lib（rlib），而 FFI 符号在 cdylib 里。
//   这里直接调库内函数做同样的分段 —— 分段构成与 FFI 入口一致（FFI 只是包一层）。
use proteus_layout_core::{
    AvailableSpace, FlexDirection, LStyle, LayoutEngine, LayoutOutput, LNode, LayoutTree, RootConstraint, TaffyEngine,
};

fn main() {
    for (rows, cols) in [(50u32, 40u32), (200, 40), (500, 40)] {
        // 建树（与 update FFI 的场景同构：行显式宽高 ⇒ 有布局边界）
        let mut tree = LayoutTree::new();
        let root = tree.push(LNode::new(1, LStyle {
            width: Some(750.0), flex_direction: FlexDirection::Column, ..Default::default()
        }));
        let mut id = 2u32;
        let mut mid_leaf = 0u32;
        for r in 0..rows {
            let rs = LStyle {
                flex_direction: FlexDirection::Row, gap: 4.0, flex_shrink: 0.0,
                width: Some(750.0), height: Some(20.0), ..Default::default()
            };
            let row = tree.push(LNode::new(id, rs)); id += 1;
            tree.add_child(root, row);
            for c in 0..cols {
                let ls = LStyle { width: Some(40.0), height: Some(16.0), flex_shrink: 0.0, ..Default::default() };
                let leaf = tree.push(LNode::new(id, ls));
                if r == rows / 2 && c == 10 { mid_leaf = leaf; }
                id += 1;
                tree.add_child(row, leaf);
            }
        }
        tree.roots.push(root);
        let n = tree.len();

        let c = RootConstraint { width: AvailableSpace::Definite(750.0), height: AvailableSpace::MaxContent };
        let mut e = TaffyEngine::new();
        e.layout(&mut tree, c);

        // ── 分段：① 建 id→索引表（update 里的 O(n) 步骤）──
        let t0 = std::time::Instant::now();
        let mut id_to_idx = std::collections::HashMap::with_capacity(n);
        for (i, nd) in tree.nodes.iter().enumerate() { id_to_idx.insert(nd.id, i as u32); }
        let t_idmap = t0.elapsed().as_secs_f64() * 1000.0;
        let idx = *id_to_idx.get(&tree.get(mid_leaf).id).unwrap();

        // ── ② 引擎构造 + 增量重排 ──
        let t1 = std::time::Instant::now();
        tree.get_mut(idx).style.width = Some(41.0);
        tree.get_mut(idx).dirty = true;
        let out: LayoutOutput = e.layout_incremental(&mut tree, idx);
        let t_relayout = t1.elapsed().as_secs_f64() * 1000.0;

        // ── ③ 变化集收集（scope 子树 + 父链原点）──
        let scope = e.relayout_scope_of(&tree, idx);
        let t2 = std::time::Instant::now();
        let (pox, poy) = parent_origin_local(&tree, scope);
        let mut cnt = 0usize;
        collect_local(&tree, scope, pox, poy, &mut cnt);
        let t_collect = t2.elapsed().as_secs_f64() * 1000.0;

        println!("{:>4}x{} = {:>5} 节点 → idmap {:.2}ms · **重排 {:.2}ms** · 变化集 {:.3}ms | relayout={} changed={}",
                 rows, cols, n, t_idmap, t_relayout, t_collect, out.relayout_count, cnt);
    }
}

fn parent_origin_local(tree: &LayoutTree, idx: u32) -> (f32, f32) {
    let mut chain = Vec::new();
    let mut cur = tree.get(idx).parent;
    while cur != proteus_layout_core::NO_PARENT {
        chain.push(cur);
        cur = tree.get(cur).parent;
    }
    let mut ox = 0.0f32; let mut oy = 0.0f32;
    for &x in chain.iter().rev() { let r = tree.get(x).rect; ox += r.x; oy += r.y; }
    (ox, oy)
}

fn collect_local(tree: &LayoutTree, idx: u32, pox: f32, poy: f32, cnt: &mut usize) {
    let nd = tree.get(idx);
    *cnt += 1;
    let (ax, ay) = (pox + nd.rect.x, poy + nd.rect.y);
    for &c in &nd.children { collect_local(tree, c, ax, ay, cnt); }
}
