// 复现：边界存在时 layout_incremental 的崩溃
use proteus_layout_core::{AvailableSpace, FlexDirection, LStyle, LayoutEngine, LNode, LayoutTree, RootConstraint, TaffyEngine};

fn main() {
    // root(auto column) → boundary(row, 320×200) → inner(row, auto) → target(20×20)
    let mut tree = LayoutTree::new();
    let mut root = LNode::new(1, LStyle::default());
    root.style.flex_direction = FlexDirection::Column;
    let root_idx = tree.push(root);
    let mut b = LNode::new(2, LStyle::default());
    b.style.flex_direction = FlexDirection::Row;
    b.style.width = Some(320.0); b.style.height = Some(200.0);
    let b_idx = tree.push(b);
    let mut inner = LNode::new(3, LStyle::default());
    inner.style.flex_direction = FlexDirection::Row;
    let inner_idx = tree.push(inner);
    let mut target = LNode::new(4, LStyle::default());
    target.style.width = Some(20.0); target.style.height = Some(20.0);
    let target_idx = tree.push(target);
    tree.roots.push(root_idx);
    tree.add_child(root_idx, b_idx);
    tree.add_child(b_idx, inner_idx);
    tree.add_child(inner_idx, target_idx);

    let mut e = TaffyEngine::new();
    e.layout(&mut tree, RootConstraint { width: AvailableSpace::Definite(375.0), height: AvailableSpace::MaxContent });
    println!("全量布局 OK；边界判定={}", tree.get(b_idx).is_layout_boundary());

    let scope = e.relayout_scope_of(&tree, target_idx);
    println!("重排范围 = 索引 {}（id {}）", scope, tree.get(scope).id);

    println!("现在调用 layout_incremental …");
    tree.get_mut(target_idx).style.width = Some(25.0);
    tree.get_mut(target_idx).dirty = true;
    let out = e.layout_incremental(&mut tree, &[target_idx]);
    println!("增量布局返回：relayout_count={}", out.relayout_count);

    // ★关键：结果**对不对**（不只是「没崩」）——与全量重排逐节点比对
    let mut full = tree.clone();
    let mut e2 = TaffyEngine::new();
    e2.layout(&mut full, RootConstraint { width: AvailableSpace::Definite(375.0), height: AvailableSpace::MaxContent });
    let a = tree.absolute_rects();
    let b = full.absolute_rects();
    let mut worst = 0f32;
    for i in 0..tree.len() {
        match (a[i], b[i]) {
            (Some(x), Some(y)) => {
                worst = worst.max((x.x - y.x).abs()).max((x.y - y.y).abs())
                             .max((x.width - y.width).abs()).max((x.height - y.height).abs());
            }
            (None, None) => {}
            _ => { println!("  ✗ 节点 {i} 有无盒不一致"); return; }
        }
        print!(""); let _ = i;
    }
    println!("增量 vs 全量 逐节点最大偏差 = {:.4}dp → {}", worst, if worst < 0.001 { "✓ 一致" } else { "✗ 不一致" });
    // 打印 target 的尺寸，确认新宽度生效
    let t = tree.absolute_rects()[target_idx as usize].unwrap();
    println!("target 尺寸 = {}×{}（期望宽 25）", t.width, t.height);
}
