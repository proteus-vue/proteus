// packages/layout-core-rust/examples/relayout-multi-bench.rs
// ★★「压 relayout 到极致」的**基线探针**（先测量再优化 —— 本仓纪律）
//
// 【为什么必须有它】设备读数只给了一个 `relayout_ms` 总数（10–15ms），
//   而多范围重排（S4 文本形态：300 个独立范围）与单范围（类B）的**成本结构完全不同**：
//     · 多范围：每个范围一次「拷贝子树 + 新建 taffy + 求解 + 写回」
//     · 单范围：一次，但范围可能高达整树
//   不拆开就只能猜该优化哪一段。
//
// 用法：cargo run --release --example relayout-multi-bench
//
// 形态（与真机 S4/S5 同构）：
//   根(explicit 375×844, column)
//     └ 500 行(explicit 高 56, flexShrink 0, row, margin.bottom 8)
//          ├ dot(36×36)
//          └ inner(flexGrow 1, column) ─ 2 个文本叶子（度量来自表）
use std::collections::HashMap;
use std::time::Instant;

use proteus_layout_core::engine::{LayoutEngine, RootConstraint};
use proteus_layout_core::node::{LNode, LayoutTree, NodeIndex, TextMeasureRequest, NO_PARENT};
use proteus_layout_core::ops_apply::{relayout_multi_in, relayout_multi_with_measures};
use proteus_layout_core::style::{Display, Edges, FlexDirection, LStyle, Position, Rect, Size};
use proteus_layout_core::taffy_engine::TaffyEngine;

fn node(id: u32, parent: NodeIndex, style: LStyle) -> LNode {
    LNode {
        id,
        tag: String::new(),
        style,
        parent,
        children: vec![],
        text: None,
        native_host: false,
        dirty: false,
        rect: Rect::default(),
    }
}

fn row_style() -> LStyle {
    LStyle {
        flex_direction: FlexDirection::Row,
        width: Some(343.0),
        height: Some(56.0),
        flex_shrink: 0.0,
        margin: Edges { top: 0.0, right: 0.0, bottom: 8.0, left: 0.0 },
        display: Display::Flex,
        position: Position::Relative,
        ..Default::default()
    }
}

/// 建「根 + N 行 × 4 节点」的树（返回树 + 行根索引 + 文本叶子索引）
fn build(n: usize) -> (LayoutTree, Vec<NodeIndex>, Vec<NodeIndex>) {
    let mut t = LayoutTree::new();
    let root = t.push(node(
        0,
        NO_PARENT,
        LStyle {
            flex_direction: FlexDirection::Column,
            width: Some(375.0),
            height: Some(844.0),
            display: Display::Flex,
            position: Position::Relative,
            ..Default::default()
        },
    ));
    t.roots.push(root);
    let mut rows = Vec::with_capacity(n);
    let mut texts = Vec::with_capacity(n);
    for i in 0..n {
        let rid = t.push(node(100 + (i as u32) * 4, root, row_style()));
        t.add_child(root, rid);
        let dot = t.push(node(
            100 + (i as u32) * 4 + 1,
            rid,
            LStyle { width: Some(36.0), height: Some(36.0), flex_shrink: 0.0, ..Default::default() },
        ));
        t.add_child(rid, dot);
        let inner = t.push(node(
            100 + (i as u32) * 4 + 2,
            rid,
            LStyle { flex_direction: FlexDirection::Column, flex_grow: 1.0, ..Default::default() },
        ));
        t.add_child(rid, inner);
        let mut title = node(100 + (i as u32) * 4 + 3, inner, LStyle::default());
        title.text = Some(TextMeasureRequest { text: format!("列表项 {}", i + 1), style_key: 0 });
        let tid = t.push(title);
        t.add_child(inner, tid);
        rows.push(rid);
        texts.push(tid);
    }
    (t, rows, texts)
}

fn measures(n: usize, suffix: &str) -> HashMap<u32, Size> {
    let mut m = HashMap::new();
    for i in 0..n {
        let w = 60.0 + (suffix.len() as f32) * 5.0;
        m.insert(100 + (i as u32) * 4 + 3, Size { width: w, height: 19.0 });
    }
    m
}

fn full_layout(t: &mut LayoutTree, m: &HashMap<u32, Size>) {
    let mut eng = TaffyEngine::new()
        .with_measurer(Box::new(proteus_layout_core::engine::TableTextMeasurer::new(m.clone())));
    eng.layout(t, RootConstraint::definite(375.0, 844.0));
}

fn median(mut xs: Vec<f64>) -> f64 {
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    xs[xs.len() / 2]
}

fn main() {
    const N: usize = 500;
    const ITERS: usize = 30;

    println!("== relayout 基线探针（N={N} 行 × 4 节点 = {} 节点）==", N * 4 + 1);
    println!();

    // ── 形态 A：多范围（S4 文本形态：改 300 行文案 ⇒ 300 个独立范围）──
    {
        let (mut t, rows, texts) = build(N);
        let m = measures(N, "");
        full_layout(&mut t, &m);
        let _ = rows;
        let mut samples = Vec::new();
        let mut out_phases: std::collections::BTreeMap<&'static str, f64> = std::collections::BTreeMap::new();
        for it in 0..ITERS {
            // 每轮改文案（交替后缀 ⇒ 保证度量真的变；同时把节点标脏）
            let m2 = measures(N, if it % 2 == 0 { "R1" } else { "R2" });
            for i in 0..300 {
                let idx = texts[i];
                t.get_mut(idx).dirty = true;
                if let Some(req) = t.get_mut(idx).text.as_mut() {
                    req.text = format!("R{} 列表项 {}", if it % 2 == 0 { 1 } else { 2 }, i + 1);
                }
            }
            let dirty: Vec<u32> = (0..300).map(|i| texts[i] as u32).collect();
            let t0 = Instant::now();
            let out = relayout_multi_with_measures(&mut t, &dirty, &m2);
            out_phases = out.phases.clone();
            samples.push(t0.elapsed().as_secs_f64() * 1000.0);
            if it == 0 {
                println!("[A 多范围] 首轮：relayout_count={} scopes={:?}", out.relayout_count, out.scopes.len());
            }
        }
        let med = median(samples);
        println!("[A 多范围 300 个范围] 中位 {:.3}ms（{:.1}µs/范围）", med, med * 1000.0 / 300.0);
        // ★相位归因（本仓纪律：先把成本拆开再优化）
        let total: f64 = out_phases.values().sum::<f64>();
        let mut keys: Vec<(&&str, &f64)> = out_phases.iter().collect();
        keys.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap());
        print!("   相位：");
        for (k, v) in keys.iter().take(6) {
            print!("{}={:.3}ms ", k, v);
        }
        println!("（合计 {:.3}ms）", total);
    }

    // ── 形态 B：单范围（类A：改行内一个叶子，范围止于该行）──
    {
        let (mut t, _rows, texts) = build(N);
        let m = measures(N, "");
        full_layout(&mut t, &m);
        let mut samples = Vec::new();
        for _ in 0..ITERS {
            let idx = texts[250];
            t.get_mut(idx).dirty = true;
            let t0 = Instant::now();
            let out = relayout_multi_with_measures(&mut t, &[idx as u32], &m);
            samples.push(t0.elapsed().as_secs_f64() * 1000.0);
            if samples.len() == 1 {
                println!("[B 单范围] 首轮：relayout_count={} scopes={:?}", out.relayout_count, out.scopes.len());
            }
        }
        println!("[B 单范围（行内）] 中位 {:.4}ms", median(samples));
    }

    // ── 形态 C：类B（改行高 ⇒ 平移传播 / 或全量）──
    {
        let (mut t, rows, _texts) = build(N);
        let m = measures(N, "");
        full_layout(&mut t, &m);
        let mut samples = Vec::new();
        for it in 0..ITERS {
            let idx = rows[250];
            t.get_mut(idx).style.height = Some(if it % 2 == 0 { 60.0 } else { 56.0 });
            t.get_mut(idx).dirty = true;
            let t0 = Instant::now();
            let out = relayout_multi_with_measures(&mut t, &[idx as u32], &m);
            samples.push(t0.elapsed().as_secs_f64() * 1000.0);
            if samples.len() == 1 {
                println!("[C 类B] 首轮：relayout_count={} scopes={:?}", out.relayout_count, out.scopes.len());
            }
        }
        println!("[C 类B（改行高）] 中位 {:.4}ms", median(samples));
    }

    // ── 形态 F：**build_taffy 单独计时**（整树重排 79% 在 run_compute，但先确认包装层）──
    {
        let (mut t, _rows, _texts) = build(N);
        let m = measures(N, "");
        full_layout(&mut t, &m);
        // 只建 taffy（不求解）——量包装层（style 转换 + 建树）的固定成本
        let mut samples = Vec::new();
        for _ in 0..ITERS {
            let t0 = Instant::now();
            let mut eng = TaffyEngine::new()
                .with_measurer(Box::new(proteus_layout_core::engine::TableTextMeasurer::new(m.clone())));
            // 用公有 API：layout 一次（含 build+run+writeback），此处通过对比 E/D 反推
            // ⇒ 改用"只 build"不可从外部调用，故这里量的是**同一棵树的完整 layout**
            eng.layout(&mut t, RootConstraint::definite(375.0, 844.0));
            samples.push(t0.elapsed().as_secs_f64() * 1000.0);
        }
        let med = median(samples);
        println!("[F 完整整树 layout] 中位 {:.4}ms（对照：taffy 纯求解 0.015ms ⇒ 包装层 {:.2}ms）", med, med - 0.0673);
    }

    // ── 形态 E：与 D 同树同变更，但**文本叶子换成显式尺寸**（无度量回调）──
    //   【为什么加它】D 里 run_compute 占 79%（2.53ms）。要判断这 2.5ms 是
    //   「taffy 求解本身」还是「我们的度量回调路径」，必须有一个**去掉度量**的对照。
    {
        let (mut t, rows, texts) = build(N);
        // 文本叶子改显式尺寸（不再走度量）
        for &i in &texts {
            t.get_mut(i).text = None;
            t.get_mut(i).style.width = Some(60.0);
            t.get_mut(i).style.height = Some(19.0);
        }
        for &r in &rows {
            t.get_mut(r).style.height = None;
        }
        let m = measures(N, "");
        full_layout(&mut t, &m);
        let mut samples = Vec::new();
        for it in 0..ITERS {
            let idx = rows[250];
            t.get_mut(idx).style.margin.bottom = if it % 2 == 0 { 12.0 } else { 8.0 };
            t.get_mut(idx).dirty = true;
            let t0 = Instant::now();
            let _out = relayout_multi_with_measures(&mut t, &[idx as u32], &m);
            samples.push(t0.elapsed().as_secs_f64() * 1000.0);
        }
        let med = median(samples);
        println!("[E 无度量（同 D 形态）] 中位 {:.4}ms  ⇒ 与 D 的差值即**度量回调路径**的成本", med);
    }

    // ── 形态 D：单范围但范围=整树（无边界：把行改成 auto 高）──
    {
        let (mut t, rows, _texts) = build(N);
        let m = measures(N, "");
        full_layout(&mut t, &m);
        // 去掉行高 ⇒ 行不再是边界 ⇒ 范围应上浮到根
        for &r in &rows {
            t.get_mut(r).style.height = None;
        }
        full_layout(&mut t, &m);
        let mut samples = Vec::new();
        let mut dphases: std::collections::BTreeMap<&'static str, f64> = std::collections::BTreeMap::new();
        // ★持久引擎（真机路径用 `with_engine` 持引擎；探针等价地跨轮复用）
        let mut eng_p = TaffyEngine::new()
            .with_measurer(Box::new(proteus_layout_core::engine::TableTextMeasurer::new(m.clone())));
        for it in 0..ITERS {
            let idx = rows[250];
            t.get_mut(idx).style.margin.bottom = if it % 2 == 0 { 12.0 } else { 8.0 };
            t.get_mut(idx).dirty = true;
            let t0 = Instant::now();
            let out = relayout_multi_in(&mut eng_p, &mut t, &[idx as u32]);
            dphases = out.phases.clone();
            samples.push(t0.elapsed().as_secs_f64() * 1000.0);
            if samples.len() == 1 {
                println!("[D 无边界] 首轮：relayout_count={} scopes={:?} changed_roots={:?}",
                    out.relayout_count, out.scopes.len(), out.changed_roots.len());
            }
        }
        let med = median(samples);
        println!("[D 无边界（整树重排）] 中位 {:.4}ms", med);
        let mut keys: Vec<(&&str, &f64)> = dphases.iter().collect();
        keys.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap());
        print!("   相位：");
        for (k, v) in keys.iter().take(8) {
            print!("{}={:.3}ms ", k, v);
        }
        println!();
    }
}
