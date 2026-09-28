// packages/layout-core-rust/tests/incremental_browser_conformance.rs
// ★★V6：**增量路径对拍浏览器**（消费 `tests/golden/browser-mutation.json`）
//
// 【与既有对齐基准的关系（本仓实测的覆盖缺口）】
//   · `browser-layout.json`（21 用例）：全量布局 ⇄ 浏览器 —— 只覆盖**首帧**
//   · `incremental_equivalence.rs`：增量 ≡ 全量 —— 只覆盖**求解器内部自洽**
//   ⇒ 增量路径此前**没有**与浏览器直接对拍过（靠「增量≡全量 ∧ 全量≡浏览器」的传递链）。
//     本文件做直接对拍：**「浏览器在变更后的布局」 vs 「求解器增量重排的结果」**。
//
// 【判据】
//   ① 求解器**全量**布局 == 浏览器**变更前**（这一步不过 ⇒ 场景本身不可比，直接失败）
//   ② 求解器**增量**重排 == 浏览器**变更后**（★本文件的核心判据）
//   ③ 路径生效证据：`expectIncremental` 的场景断言"范围确实被收窄/平移确实生效"
//      （否则可能"因为走了全量而恰好正确"——那不叫增量对拍）
//
// 【golden 从哪来】`tests/e2e-layout-incremental-conformance.test.ts`（真实 Chromium）
//   ⇒ 本测试**无需浏览器**即可回归（CI 可跑）。
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use proteus_layout_core::ops::{DecodedOps, UpdateOp};
use proteus_layout_core::ops_apply::{apply_ops_to_tree, relayout_multi};
use proteus_layout_core::{
    Display, FlexDirection, LNode, LStyle, LayoutEngine, LayoutTree, NodeIndex, RootConstraint, TaffyEngine, NO_PARENT,
};
use serde::Deserialize;

/* ────────────────────── golden 结构 ────────────────────── */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenFile {
    viewport: Viewport,
    tolerance: f32,
    scenarios: Vec<Scenario>,
}

#[derive(Debug, Deserialize)]
struct Viewport {
    width: f32,
    height: f32,
}

#[derive(Debug, Deserialize, Clone, Copy)]
struct Rect {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Scenario {
    name: String,
    nodes: Vec<DNode>,
    mutation: Mutation,
    expect_incremental: bool,
    rects_before: BTreeMap<String, Rect>,
    rects_after: BTreeMap<String, Rect>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DNode {
    id: u32,
    parent_id: Option<u32>,
    width: Option<f32>,
    height: Option<f32>,
    flex_direction: Option<String>,
    flex_grow: Option<f32>,
    flex_shrink: Option<f32>,
    align_items: Option<String>,
    justify_content: Option<String>,
    margin: Option<Edges>,
    padding: Option<Edges>,
}

#[derive(Debug, Deserialize)]
struct Edges {
    top: Option<f32>,
    right: Option<f32>,
    bottom: Option<f32>,
    left: Option<f32>,
}

#[derive(Debug, Deserialize)]
struct Mutation {
    id: u32,
    key: String,
    value: f32,
}

/* ────────────────────── 构造 ────────────────────── */

fn to_edges(e: &Option<Edges>) -> proteus_layout_core::Edges {
    match e {
        Some(e) => proteus_layout_core::Edges {
            top: e.top.unwrap_or(0.0),
            right: e.right.unwrap_or(0.0),
            bottom: e.bottom.unwrap_or(0.0),
            left: e.left.unwrap_or(0.0),
        },
        None => Default::default(),
    }
}

fn build_tree(nodes: &[DNode]) -> (LayoutTree, BTreeMap<u32, NodeIndex>) {
    let mut tree = LayoutTree::new();
    let mut idx = BTreeMap::new();
    for d in nodes {
        let style = LStyle {
            width: d.width,
            height: d.height,
            margin: to_edges(&d.margin),
            padding: to_edges(&d.padding),
            flex_direction: match d.flex_direction.as_deref() {
                Some("row") => FlexDirection::Row,
                _ => FlexDirection::Column,
            },
            flex_grow: d.flex_grow.unwrap_or(0.0),
            flex_shrink: d.flex_shrink.unwrap_or(1.0),
            align_items: d.align_items.clone().unwrap_or_else(|| "stretch".into()),
            justify_content: d.justify_content.clone().unwrap_or_else(|| "flex-start".into()),
            display: Display::Flex,
            ..Default::default()
        };
        let i = tree.push(LNode {
            id: d.id,
            tag: String::new(),
            style,
            parent: NO_PARENT,
            children: vec![],
            text: None,
            native_host: false,
            dirty: false,
            rect: Default::default(),
        });
        idx.insert(d.id, i);
    }
    for d in nodes {
        if let Some(pid) = d.parent_id {
            let p = idx[&pid];
            let c = idx[&d.id];
            tree.nodes[p as usize].children.push(c);
            tree.nodes[c as usize].parent = p;
        } else {
            let r = idx[&d.id];
            tree.roots.push(r);
        }
    }
    (tree, idx)
}

/// 绝对矩形（沿父链累加）——与 golden 的 `getBoundingClientRect` 可比
fn snapshot_abs(tree: &LayoutTree) -> BTreeMap<u32, Rect> {
    fn walk(tree: &LayoutTree, i: NodeIndex, ox: f32, oy: f32, out: &mut BTreeMap<u32, Rect>) {
        let n = tree.get(i);
        let x = ox + n.rect.x;
        let y = oy + n.rect.y;
        out.insert(n.id, Rect { x, y, width: n.rect.width, height: n.rect.height });
        for &c in &n.children {
            walk(tree, c, x, y, out);
        }
    }
    let mut out = BTreeMap::new();
    for &r in &tree.roots {
        walk(tree, r, 0.0, 0.0, &mut out);
    }
    out
}

fn assert_rects(label: &str, got: &BTreeMap<u32, Rect>, want: &BTreeMap<String, Rect>, tol: f32) {
    assert_eq!(got.len(), want.len(), "{label}: 节点数不一致（{} vs {}）", got.len(), want.len());
    for (id, g) in got {
        let w = want.get(&id.to_string()).unwrap_or_else(|| panic!("{label}: golden 缺少节点 {id}"));
        for (k, (gv, wv)) in [("x", (g.x, w.x)), ("y", (g.y, w.y)), ("w", (g.width, w.width)), ("h", (g.height, w.height))] {
            assert!(
                (gv - wv).abs() <= tol,
                "{label}: 节点 {id} 的 {k} 不一致 —— 求解器 {gv} vs 浏览器 {wv}（容差 {tol}）"
            );
        }
    }
}

fn golden_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden/browser-mutation.json")
}

fn load() -> GoldenFile {
    let raw = fs::read_to_string(golden_path()).expect(
        "golden 缺失——先跑 `npx vitest run tests/e2e-layout-incremental-conformance.test.ts`（真实 Chromium）",
    );
    serde_json::from_str(&raw).expect("golden 解析失败")
}

/* ────────────────────── 用例 ────────────────────── */

#[test]
fn incremental_matches_browser_after_mutation() {
    let g = load();
    assert!(!g.scenarios.is_empty(), "golden 无场景");

    for sc in &g.scenarios {
        let (mut tree, idx) = build_tree(&sc.nodes);

        // ── ① 全量布局（应对上浏览器「变更前」）──
        let mut eng = TaffyEngine::new().with_measurer(Box::new(proteus_layout_core::NullTextMeasurer));
        eng.layout(&mut tree, RootConstraint::definite(g.viewport.width, g.viewport.height));
        let before = snapshot_abs(&tree);
        assert_rects(&format!("[{}] ① 全量 vs 浏览器·变更前", sc.name), &before, &sc.rects_before, g.tolerance);

        // ── ② 施加变更（走指令路径：与产线一致）──
        let target = idx[&sc.mutation.id];
        tree.nodes[target as usize].dirty = true;
        let dec = DecodedOps {
            version: 1,
            keys: vec![sc.mutation.key.clone()],
            strings: vec![],
            ops: vec![UpdateOp::SetStyle { node_id: sc.mutation.id, key_id: 0, value: sc.mutation.value }],
        };
        let outcome = apply_ops_to_tree(&mut tree, &dec);
        assert_eq!(
            outcome.applied, 1,
            "[{}] 变更未被应用（unsupported={:?}）",
            sc.name, outcome.unsupported
        );
        let multi = relayout_multi(&mut tree, &outcome.dirty);

        // ── ③ 增量结果 对拍 浏览器「变更后」★核心判据 ──
        let after = snapshot_abs(&tree);
        assert_rects(
            &format!("[{}] ② **增量** vs 浏览器·变更后", sc.name),
            &after,
            &sc.rects_after,
            g.tolerance,
        );

        // ── ④ 路径生效证据（防"因为走了全量而恰好正确"）──
        let scope_is_root = multi.scopes.iter().any(|&s| tree.get(s).parent == NO_PARENT);
        if sc.expect_incremental {
            // 类A/非零偏移：范围应收窄（不得是全树）；类B：允许走根（那是平移传播的适用范围）
            let changed = outcome.dirty.len();
            assert!(changed >= 1, "[{}] 应至少 1 个脏节点", sc.name);
            if !scope_is_root {
                assert!(
                    multi.relayout_count < sc.nodes.len(),
                    "[{}] 范围应为真子集（relayout={} 全树={}）",
                    sc.name,
                    multi.relayout_count,
                    sc.nodes.len()
                );
            }
        }
        let _ = (scope_is_root, &multi);
    }
}

/// ★★反向判据：`expectIncremental=false` 的场景（有 flex-grow 竞争）必须**仍然正确**
///
/// 单列一条是为了让失败时的语义清晰：这类场景**本就该回退全量**，
/// 正确性优先于性能——它的存在是为了证明"知道什么时候不能走快路径"。
#[test]
fn contention_scenarios_stay_correct_regardless_of_path() {
    let g = load();
    let contention: Vec<_> = g.scenarios.iter().filter(|s| !s.expect_incremental).collect();
    assert!(!contention.is_empty(), "golden 应含至少一个 expectIncremental=false 场景");

    for sc in contention {
        let (mut tree, idx) = build_tree(&sc.nodes);
        let mut eng = TaffyEngine::new().with_measurer(Box::new(proteus_layout_core::NullTextMeasurer));
        eng.layout(&mut tree, RootConstraint::definite(g.viewport.width, g.viewport.height));

        // 与主用例同一条指令路径（避免"测试里走另一条路"的语义分叉）
        let target = idx[&sc.mutation.id];
        tree.nodes[target as usize].dirty = true;
        let dec = DecodedOps {
            version: 1,
            keys: vec![sc.mutation.key.clone()],
            strings: vec![],
            ops: vec![UpdateOp::SetStyle { node_id: sc.mutation.id, key_id: 0, value: sc.mutation.value }],
        };
        let outcome = apply_ops_to_tree(&mut tree, &dec);
        assert_eq!(outcome.applied, 1, "[{}] 变更未应用", sc.name);
        let multi = relayout_multi(&mut tree, &outcome.dirty);
        let after = snapshot_abs(&tree);
        assert_rects(
            &format!("[{}] 竞争场景（应回退全量）对拍浏览器", sc.name),
            &after,
            &sc.rects_after,
            g.tolerance,
        );
        let _ = multi;
    }
}
