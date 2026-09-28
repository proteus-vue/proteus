// packages/layout-core-rust/examples/taffy-floor-bench.rs
// ★「taffy 地板」微基准：**纯 taffy**（不经过我们的 Tree/LStyle 转换）求解同形状树
//
// 【为什么必须有它（本仓纪律：先确认地板再优化）】relayout 探针显示整树重排里
//   `run_compute` 占 79%（2.5ms / 2001 节点）。但那是**我们调用 taffy 的路径**；
//   若不测「纯 taffy 能多快」，就无法判断剩余成本是「引擎地板」还是「我们的包装」。
//   ⇒ 本基准用**完全相同的形状**（column 根 + 500 行 + 行内 3 子）直接建 taffy 树求解。
//
// 用法：cargo run --release --example taffy-floor-bench
use std::time::Instant;
use taffy::prelude::*;

fn main() {
    // ★规模可调（真机 V0 是 7005 节点 ⇒ `FLOOR_N=1750` 复现同一规模做对照）
    let N: usize = std::env::var("FLOOR_N").ok().and_then(|v| v.parse().ok()).unwrap_or(500);
    const ITERS: usize = 50;

    // 与 relayout-multi-bench 的形态 D 同形状：根 column(375×844)
    //   行：row(width 343, height auto, flexShrink 0, margin-bottom 8)
    //      ├ dot 36×36
    //      └ inner(column, flexGrow 1) ├ text-leaf(width 60,height 19)
    let mut taffy: TaffyTree<()> = TaffyTree::new();
    let leaf_style = Style {
        size: Size { width: length(60.0), height: length(19.0) },
        ..Default::default()
    };
    let inner_style = Style {
        flex_direction: FlexDirection::Column,
        flex_grow: 1.0,
        ..Default::default()
    };
    let dot_style = Style {
        size: Size { width: length(36.0), height: length(36.0) },
        flex_shrink: 0.0,
        ..Default::default()
    };
    let row_style = Style {
        flex_direction: FlexDirection::Row,
        size: Size { width: length(343.0), height: auto() },
        flex_shrink: 0.0,
        margin: Rect { top: length(0.0), right: length(0.0), bottom: length(8.0), left: length(0.0) },
        ..Default::default()
    };
    let root_style = Style {
        flex_direction: FlexDirection::Column,
        size: Size { width: length(375.0), height: length(844.0) },
        ..Default::default()
    };

    let dot = taffy.new_leaf(dot_style.clone()).unwrap();
    let text = taffy.new_leaf(leaf_style.clone()).unwrap();
    let inner = taffy.new_with_children(inner_style.clone(), &[text]).unwrap();
    let row = taffy.new_with_children(row_style.clone(), &[dot, inner]).unwrap();
    let root = taffy.new_with_children(root_style.clone(), &[]).unwrap();
    let mut rows = Vec::with_capacity(N);
    for _ in 0..N {
        let d = taffy.new_leaf(dot_style.clone()).unwrap();
        let t = taffy.new_leaf(leaf_style.clone()).unwrap();
        let i = taffy.new_with_children(inner_style.clone(), &[t]).unwrap();
        let r = taffy.new_with_children(row_style.clone(), &[d, i]).unwrap();
        taffy.add_child(root, r).unwrap();
        rows.push(r);
    }
    let _ = row;

    let avail = Size { width: AvailableSpace::Definite(375.0), height: AvailableSpace::Definite(844.0) };
    taffy.compute_layout(root, avail).unwrap();  // 预热

    // ① 纯 compute（无任何变更）
    let mut samples = Vec::new();
    for _ in 0..ITERS {
        let t0 = Instant::now();
        taffy.compute_layout(root, avail).unwrap();
        samples.push(t0.elapsed().as_secs_f64() * 1000.0);
    }
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("[taffy 纯求解] {} 节点（{} 行 × 4）· 中位 {:.4}ms", N * 4 + 1, N, samples[samples.len() / 2]);

    // ② 改一行高度后再 compute（真实变革形态）
    let mut samples2 = Vec::new();
    for it in 0..ITERS {
        let h = if it % 2 == 0 { 60.0 } else { 56.0 };
        let mut st = row_style.clone();
        st.size.height = length(h);
        taffy.set_style(rows[250], st.clone()).unwrap();
        let t0 = Instant::now();
        taffy.compute_layout(root, avail).unwrap();
        samples2.push(t0.elapsed().as_secs_f64() * 1000.0);
    }
    samples2.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("[taffy 改一行后重解] 中位 {:.4}ms", samples2[samples2.len() / 2]);

    // ③ ★**带度量回调**（与我们同款：leaf_with_context + compute_layout_with_measure）
    //   用来判定"我们的度量回调路径"本身是否是瓶颈
    {
        use std::collections::HashMap;
        let mut t2: TaffyTree<u32> = TaffyTree::new();
        let mut cache: HashMap<(u64, u32), Size<f32>> = HashMap::new();
        let mut root2 = t2.new_leaf(root_style.clone()).unwrap();
        let mut next_id = 1u32;
        let mut rows2 = Vec::new();
        for _ in 0..N {
            let did = next_id; next_id += 1;
            let tid = next_id; next_id += 1;
            let d = t2.new_leaf_with_context(dot_style.clone(), did).unwrap();
            let t = t2.new_leaf_with_context(leaf_style.clone(), tid).unwrap();
            let i = t2.new_with_children(inner_style.clone(), &[t]).unwrap();
            let r = t2.new_with_children(row_style.clone(), &[d, i]).unwrap();
            t2.add_child(root2, r).unwrap();
            rows2.push(r);
        }
        let _ = root2;
        root2 = root2; // 保持类型
        t2.compute_layout_with_measure(
            root2, avail,
            |_inputs, _nid, ctx: Option<&mut u32>, style: &Style| {
                let nid = ctx.as_deref().copied().unwrap_or(0);
                taffy::compute_leaf_layout(_inputs, style, |_, _| 0.0, |known, avail| {
                    let max_w = known.width.or(avail.width.into_option()).unwrap_or(f32::INFINITY);
                    let key = (nid as u64, max_w.to_bits());
                    if let Some(s) = cache.get(&key) { return *s; }
                    let s = Size { width: 60.0, height: 19.0 };
                    cache.insert(key, s);
                    s
                })
            },
        ).unwrap();
        let mut s3 = Vec::new();
        for it in 0..ITERS {
            let h = if it % 2 == 0 { 60.0 } else { 56.0 };
            let mut st = row_style.clone();
            st.size.height = length(h);
            t2.set_style(rows2[250], st).unwrap();
            let t0 = Instant::now();
            t2.compute_layout_with_measure(
                root2, avail,
                |_inputs, _nid, ctx: Option<&mut u32>, style: &Style| {
                    let nid = ctx.as_deref().copied().unwrap_or(0);
                    taffy::compute_leaf_layout(_inputs, style, |_, _| 0.0, |known, avail| {
                        let max_w = known.width.or(avail.width.into_option()).unwrap_or(f32::INFINITY);
                        let key = (nid as u64, max_w.to_bits());
                        if let Some(s) = cache.get(&key) { return *s; }
                        let s = Size { width: 60.0, height: 19.0 };
                        cache.insert(key, s);
                        s
                    })
                },
            ).unwrap();
            s3.push(t0.elapsed().as_secs_f64() * 1000.0);
        }
        s3.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("[taffy + 度量回调（同款）] 中位 {:.4}ms", s3[s3.len() / 2]);
    }

    // ④ ★**用我们核心的 `to_taffy` 转换 + 直调 taffy**（判定"是不是 style 转换产出导致慢"）
    {
        use proteus_layout_core::node::{LNode, LayoutTree, TextMeasureRequest, NO_PARENT};
        use proteus_layout_core::style::{Display, Edges, FlexDirection, LStyle, Position, Rect as LRect};
        use proteus_layout_core::taffy_engine::to_taffy_style_for_bench;

        let mut t = LayoutTree::new();
        let mk = |id: u32, parent: u32, style: LStyle, text: Option<&str>| {
            let mut n = LNode {
                id, tag: String::new(), style, parent,
                children: vec![], text: None, native_host: false, dirty: false, rect: LRect::default(),
            };
            if let Some(tx) = text {
                n.text = Some(TextMeasureRequest { text: tx.to_string(), style_key: 0 });
            }
            n
        };
        let root_style = LStyle { flex_direction: FlexDirection::Column, width: Some(375.0), height: Some(844.0), display: Display::Flex, position: Position::Relative, ..Default::default() };
        let root = t.push(mk(0, NO_PARENT, root_style, None));
        t.roots.push(root);
        let row_base = LStyle { flex_direction: FlexDirection::Row, width: Some(343.0), height: Some(56.0), flex_shrink: 0.0, margin: Edges { top: 0.0, right: 0.0, bottom: 8.0, left: 0.0 }, display: Display::Flex, position: Position::Relative, ..Default::default() };
        let mut next = 1u32;
        for i in 0..N {
            let rid = t.push(mk(next, root, row_base.clone(), None)); next += 1;
            t.add_child(root, rid);
            let dot = t.push(mk(next, rid, LStyle { width: Some(36.0), height: Some(36.0), ..Default::default() }, None)); next += 1;
            t.add_child(rid, dot);
            let inner = t.push(mk(next, rid, LStyle { flex_direction: FlexDirection::Column, flex_grow: 1.0, ..Default::default() }, None)); next += 1;
            t.add_child(rid, inner);
            let tl = t.push(mk(next, inner, LStyle::default(), Some(&format!("列表项 {}", i)))); next += 1;
            t.add_child(inner, tl);
        }
        // 用我们的 to_taffy 转换建 taffy 树，然后直调
        let mut t2: TaffyTree<u32> = TaffyTree::new();
        let mut ids: Vec<NodeId> = Vec::with_capacity(t.len());
        for n in &t.nodes {
            let st = to_taffy_style_for_bench(&n.style);
            let id = match &n.text {
                Some(_) => t2.new_leaf_with_context(st, n.id).unwrap(),
                None => t2.new_leaf(st).unwrap(),
            };
            ids.push(id);
        }
        for (idx, n) in t.nodes.iter().enumerate() {
            if n.parent != NO_PARENT { t2.add_child(ids[n.parent as usize], ids[idx]).unwrap(); }
        }
        t2.compute_layout(ids[0], avail).unwrap();
        let mut s4 = Vec::new();
        for _ in 0..ITERS {
            let t0 = Instant::now();
            t2.compute_layout(ids[0], avail).unwrap();
            s4.push(t0.elapsed().as_secs_f64() * 1000.0);
        }
        s4.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("[我们的 to_taffy 转换 + taffy 直调] 中位 {:.4}ms ⇒ 若远大于 0.067ms，则**style 转换产出**是元凶", s4[s4.len() / 2]);
    }

    let mut cache2: std::collections::HashMap<(u64, u32), ()> = std::collections::HashMap::new();
    let mut cache3: std::collections::HashMap<(u64, u32), ()> = std::collections::HashMap::new();
    // ⑤ ★★**每轮重建 taffy 树**（复现我们的 build_taffy 行为）——判定"重建导致失去缓存"假设
    {
        let mut s5 = Vec::new();
        for it in 0..ITERS {
            let h = if it % 2 == 0 { 60.0 } else { 56.0 };
            let t0 = Instant::now();
            // 与 build_taffy 同款：每轮**新建**全部节点
            let mut t3: TaffyTree<u32> = TaffyTree::new();
            let mut root3 = t3.new_leaf(root_style.clone()).unwrap();
            let mut rows3 = Vec::with_capacity(N);
            let mut next_id = 1u32;
            for i in 0..N {
                let mut rs = row_style.clone();
                if i == 250 { rs.size.height = length(h); }
                let did = next_id; next_id += 1;
                let tid = next_id; next_id += 1;
                let d = t3.new_leaf_with_context(dot_style.clone(), did).unwrap();
                let t = t3.new_leaf_with_context(leaf_style.clone(), tid).unwrap();
                let i3 = t3.new_with_children(inner_style.clone(), &[t]).unwrap();
                let r = t3.new_with_children(rs, &[d, i3]).unwrap();
                t3.add_child(root3, r).unwrap();
                rows3.push(r);
            }
            let _ = &mut root3;
            t3.compute_layout_with_measure(
                root3, avail,
                |_inputs, _nid, ctx: Option<&mut u32>, style: &Style| {
                    let nid = ctx.as_deref().copied().unwrap_or(0);
                    taffy::compute_leaf_layout(_inputs, style, |_, _| 0.0, |known, avail| {
                        let max_w = known.width.or(avail.width.into_option()).unwrap_or(f32::INFINITY);
                        // 复现我们的度量路径成本（HashMap 查 + 未命中则"度量"）
                        let key = (nid as u64, max_w.to_bits());
                        if cache2.get(&key).is_some() { return Size { width: 60.0, height: 19.0 }; }
                        cache2.insert(key, ());
                        Size { width: 60.0, height: 19.0 }
                    })
                },
            ).unwrap();
            s5.push(t0.elapsed().as_secs_f64() * 1000.0);
        }
        s5.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("[⑤ 每轮重建 taffy 树 + 度量回调] 中位 {:.4}ms  ⇒ 若 ≈2.5ms，则**重建=失去缓存**是元凶", s5[s5.len() / 2]);
    }

    // ⑥ ★★**保留 taffy 树 + 每轮重设全部 style**（候选修复方案的成本上界）
    {
        let mut t4: TaffyTree<u32> = TaffyTree::new();
        let mut root4 = t4.new_leaf(root_style.clone()).unwrap();
        let mut leaves: Vec<NodeId> = Vec::with_capacity(N * 4 + 1);
        leaves.push(root4);
        let mut next_id = 1u32;
        for _ in 0..N {
            let did = next_id; next_id += 1;
            let tid = next_id; next_id += 1;
            let d = t4.new_leaf_with_context(dot_style.clone(), did).unwrap();
            let t = t4.new_leaf_with_context(leaf_style.clone(), tid).unwrap();
            let i4 = t4.new_with_children(inner_style.clone(), &[t]).unwrap();
            let r = t4.new_with_children(row_style.clone(), &[d, i4]).unwrap();
            t4.add_child(root4, r).unwrap();
            leaves.push(d);
            leaves.push(t);
            leaves.push(i4);
            leaves.push(r);
        }
        let _ = &mut root4;
        let mut s6 = Vec::new();
        for it in 0..ITERS {
            let h = if it % 2 == 0 { 60.0 } else { 56.0 };
            let t0 = Instant::now();
            // 每轮**重设全部 style**（不做"哪些变了"的追踪——安全上界）
            t4.set_style(root4, root_style.clone()).unwrap();
            let mut k = 1usize;
            for i in 0..N {
                let mut rs = row_style.clone();
                if i == 250 { rs.size.height = length(h); }
                t4.set_style(leaves[k + 3], rs).unwrap();
                t4.set_style(leaves[k], dot_style.clone()).unwrap();
                let _ = t4.set_style(leaves[k + 1], leaf_style.clone());
                t4.set_style(leaves[k + 2], inner_style.clone()).unwrap();
                k += 4;
            }
            t4.compute_layout_with_measure(
                root4, avail,
                |_inputs, _nid, ctx: Option<&mut u32>, style: &Style| {
                    let nid = ctx.as_deref().copied().unwrap_or(0);
                    taffy::compute_leaf_layout(_inputs, style, |_, _| 0.0, |known, avail| {
                        let max_w = known.width.or(avail.width.into_option()).unwrap_or(f32::INFINITY);
                        let key = (nid as u64, max_w.to_bits());
                        if cache3.get(&key).is_some() { return Size { width: 60.0, height: 19.0 }; }
                        cache3.insert(key, ());
                        Size { width: 60.0, height: 19.0 }
                    })
                },
            ).unwrap();
            s6.push(t0.elapsed().as_secs_f64() * 1000.0);
        }
        s6.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("[⑥ 保留树 + 每轮重设全部 style] 中位 {:.4}ms  ⇒ 修复方案上界", s6[s6.len() / 2]);
    }

    // ⑦ ★★**只 set 变更节点的 style**（真增量：taffy 内部缓存复用）
    {
        let mut t5: TaffyTree<u32> = TaffyTree::new();
        let mut root5 = t5.new_leaf(root_style.clone()).unwrap();
        let mut rows5: Vec<NodeId> = Vec::with_capacity(N);
        let mut next_id = 1u32;
        for _ in 0..N {
            let did = next_id; next_id += 1;
            let tid = next_id; next_id += 1;
            let d = t5.new_leaf_with_context(dot_style.clone(), did).unwrap();
            let t = t5.new_leaf_with_context(leaf_style.clone(), tid).unwrap();
            let i5 = t5.new_with_children(inner_style.clone(), &[t]).unwrap();
            let r5 = t5.new_with_children(row_style.clone(), &[d, i5]).unwrap();
            t5.add_child(root5, r5).unwrap();
            rows5.push(r5);
        }
        let _ = &mut root5;
        t5.compute_layout(root5, avail).unwrap();
        let mut s7 = Vec::new();
        for it in 0..ITERS {
            let h = if it % 2 == 0 { 60.0 } else { 56.0 };
            let mut rs = row_style.clone();
            rs.size.height = length(h);
            let t0 = Instant::now();
            // ★只改一行（真增量）
            t5.set_style(rows5[250], rs).unwrap();
            t5.compute_layout(root5, avail).unwrap();
            s7.push(t0.elapsed().as_secs_f64() * 1000.0);
        }
        s7.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("[⑦ 保留树 + 只 set 变更节点] 中位 {:.4}ms  ⇒ 真增量的天花板", s7[s7.len() / 2]);
    }

    // ⑧ ★★**用我们的 to_taffy 风格 + 持久树 + 只改一行 + 带度量回调**（复现核心的 layout_cached）
    {
        use proteus_layout_core::taffy_engine::to_taffy_style_for_bench;
        let lstyle_root = proteus_layout_core::style::LStyle {
            flex_direction: proteus_layout_core::style::FlexDirection::Column,
            width: Some(375.0), height: Some(844.0),
            display: proteus_layout_core::style::Display::Flex,
            position: proteus_layout_core::style::Position::Relative,
            ..Default::default()
        };
        let lstyle_row = proteus_layout_core::style::LStyle {
            flex_direction: proteus_layout_core::style::FlexDirection::Row,
            width: Some(343.0), height: Some(56.0), flex_shrink: 0.0,
            margin: proteus_layout_core::style::Edges { top: 0.0, right: 0.0, bottom: 8.0, left: 0.0 },
            display: proteus_layout_core::style::Display::Flex,
            position: proteus_layout_core::style::Position::Relative,
            ..Default::default()
        };
        let lstyle_dot = proteus_layout_core::style::LStyle { width: Some(36.0), height: Some(36.0), ..Default::default() };
        let lstyle_inner = proteus_layout_core::style::LStyle {
            flex_direction: proteus_layout_core::style::FlexDirection::Column, flex_grow: 1.0, ..Default::default()
        };
        let lstyle_text = proteus_layout_core::style::LStyle::default();
        let mut t8: TaffyTree<u32> = TaffyTree::new();
        let r8 = t8.new_leaf(to_taffy_style_for_bench(&lstyle_root)).unwrap();
        let mut rows8 = Vec::with_capacity(N);
        let mut nid = 1u32;
        for _ in 0..N {
            let d = nid; nid += 1;
            let tx = nid; nid += 1;
            let dn = t8.new_leaf_with_context(to_taffy_style_for_bench(&lstyle_dot), d).unwrap();
            let tn = t8.new_leaf_with_context(to_taffy_style_for_bench(&lstyle_text), tx).unwrap();
            let i8 = t8.new_with_children(to_taffy_style_for_bench(&lstyle_inner), &[tn]).unwrap();
            let row = t8.new_with_children(to_taffy_style_for_bench(&lstyle_row), &[dn, i8]).unwrap();
            t8.add_child(r8, row).unwrap();
            rows8.push(row);
        }
        let mut cache8: std::collections::HashMap<(u64, u32), Size<f32>> = std::collections::HashMap::new();
        t8.compute_layout(r8, avail).unwrap();
        let mut s8 = Vec::new();
        for it in 0..ITERS {
            let h = if it % 2 == 0 { 60.0 } else { 56.0 };
            let mut lr = lstyle_row.clone();
            lr.height = Some(h);
            t8.set_style(rows8[250], to_taffy_style_for_bench(&lr)).unwrap();
            let t0 = Instant::now();
            t8.compute_layout_with_measure(r8, avail, |inp, _n, ctx: Option<&mut u32>, style: &Style| {
                let tx = ctx.as_deref().copied().unwrap_or(0);
                taffy::compute_leaf_layout(inp, style, |_, _| 0.0, |known, av| {
                    let max_w = known.width.or(av.width.into_option()).unwrap_or(f32::INFINITY);
                    let key = (tx as u64, max_w.to_bits());
                    if let Some(x) = cache8.get(&key) { return *x; }
                    cache8.insert(key, Size { width: 60.0, height: 19.0 });
                    Size { width: 60.0, height: 19.0 }
                })
            }).unwrap();
            s8.push(t0.elapsed().as_secs_f64() * 1000.0);
        }
        s8.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("[⑧ 我们的 to_taffy 风格 + 持久树 + 改一行 + 度量回调] 中位 {:.4}ms", s8[s8.len() / 2]);
    }

    // ⑨ ★★**多范围地板**：300 个"4 节点小树"各自建树 + 求解（复现拷贝法的每范围成本）
    {
        let mut s9 = Vec::new();
        for _ in 0..ITERS {
            let t0 = Instant::now();
            for _ in 0..300 {
                let mut tt: TaffyTree<u32> = TaffyTree::new();
                let d = tt.new_leaf_with_context(dot_style.clone(), 1).unwrap();
                let tx = tt.new_leaf_with_context(leaf_style.clone(), 2).unwrap();
                let i = tt.new_with_children(inner_style.clone(), &[tx]).unwrap();
                let r = tt.new_with_children(row_style.clone(), &[d, i]).unwrap();
                tt.compute_layout(r, Size { width: AvailableSpace::Definite(343.0), height: AvailableSpace::Definite(56.0) }).unwrap();
            }
            s9.push(t0.elapsed().as_secs_f64() * 1000.0);
        }
        s9.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("[⑨ 300 个 4 节点小树：建树+求解] 中位 {:.4}ms（{:.2}µs/范围）⇒ **多范围路径的地板**", s9[s9.len() / 2], s9[s9.len() / 2] * 1000.0 / 300.0);
    }

    // ③ 统计节点数（确认规模一致）
    println!("（节点总数 {} ≈ 我们的 {}）", taffy.total_node_count(), N * 4 + 1);
}
