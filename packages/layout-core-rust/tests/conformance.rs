// packages/layout-core-rust/tests/conformance.rs
// ★★L1 排版核心的**出口条件**（M1 同款口径）：与**浏览器**布局逐像素比对（容差 0.5dp）。
//
// ★为什么基准是浏览器而不是本仓 TS 实现（方案 §5.7 原文）：
//   「Proteus 的 Web 端本身就是浏览器，因此 conformance 门禁可直接读取浏览器的
//     `getComputedStyle` 与 `getBoundingClientRect` 作为基准真值」——
//   锚定到浏览器 = 三端一致性的最终判据；锚定到自家 TS 实现只是「自己跟自己对」。
//
// ★golden 从哪来：`tests/e2e-layout-core-pixel.test.ts` 在跑真实 Chromium 对拍时**顺带冻结**
//   （引擎就绪输入 + 浏览器实测输出），路径 `tests/golden/browser-layout.json`。
//   故**本测试无需浏览器**即可运行，可在 CI/无头环境回归；重新生成走 `pnpm run test:e2e:web`。
//
// ★这份 golden 同时是「照着别人卷子做题」还是「真能力」的分界线：
//   我只喂**输入**（样式 + 平台度量值），输出（矩形）完全由 taffy 现算——
//   若把 golden 的 rects 喂进去就毫无意义（见文件末的破坏性验证）。
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use proteus_layout_core::{
    AvailableSpace, Display, FlexDirection, LStyle, LayoutEngine, LNode, LayoutTree, Overflow, Position, RootConstraint,
    Size, TableTextMeasurer, TaffyEngine,
};
use serde::Deserialize;

/* ────────────────────── golden 文件结构（DTO：与 Rust 内部类型解耦） ────────────────────── */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenFile {
    #[allow(dead_code)]
    generated_by: String,
    #[allow(dead_code)]
    note: String,
    viewport: GoldenViewport,
    tolerance: f32,
    cases: Vec<GoldenCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenViewport {
    width: f32,
    height: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenCase {
    name: String,
    nodes: Vec<GoldenNode>,
    text_measures: HashMap<String, GoldenSize>,
    rects: HashMap<String, GoldenRect>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenNode {
    id: u32,
    parent_id: Option<u32>,
    tag: String,
    width: Option<f32>,
    height: Option<f32>,
    width_ratio: Option<f32>,
    height_ratio: Option<f32>,
    min_width: Option<f32>,
    max_width: Option<f32>,
    min_height: Option<f32>,
    max_height: Option<f32>,
    margin: GoldenEdges,
    padding: GoldenEdges,
    flex_direction: String,
    justify_content: String,
    align_items: String,
    align_self: Option<String>,
    flex_grow: f32,
    flex_shrink: f32,
    flex_basis: Option<f32>,
    flex_basis_ratio: Option<f32>,
    gap: f32,
    display: String,
    position: String,
    top: Option<f32>,
    left: Option<f32>,
    overflow: String,
    /// 是否文本叶子（★golden 里**不含文本字面量**——度量按 node.id 查表，
    ///   故 Rust 侧只需标记「这是文本叶子，请走度量回调」）
    is_text: bool,
}

#[derive(Debug, Deserialize, Clone, Copy)]
struct GoldenEdges {
    top: f32,
    right: f32,
    bottom: f32,
    left: f32,
}

#[derive(Debug, Deserialize, Clone, Copy)]
struct GoldenSize {
    width: f32,
    height: f32,
}

#[derive(Debug, Deserialize, Clone, Copy)]
struct GoldenRect {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

fn golden_path() -> PathBuf {
    // ★本测试不经 cargo 的 CARGO_TARGET_DIR 之外的路径假设：直接相对本文件定位
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden/browser-layout.json")
}

fn load_golden() -> GoldenFile {
    let raw = fs::read_to_string(golden_path())
        .expect("golden 缺失——先跑 `pnpm run test:e2e:web`（真实 Chromium）生成");
    serde_json::from_str(&raw).expect("golden 解析失败（结构与 GoldenFile DTO 不符）")
}

/* ────────────────────── golden → 引擎就绪输入 ────────────────────── */

fn to_style(g: &GoldenNode) -> LStyle {
    let mut s = LStyle::default();
    s.width = g.width;
    s.height = g.height;
    s.width_ratio = g.width_ratio;
    s.height_ratio = g.height_ratio;
    s.min_width = g.min_width;
    s.max_width = g.max_width;
    s.min_height = g.min_height;
    s.max_height = g.max_height;
    s.margin = proteus_layout_core::Edges {
        top: g.margin.top,
        right: g.margin.right,
        bottom: g.margin.bottom,
        left: g.margin.left,
    };
    s.padding = proteus_layout_core::Edges {
        top: g.padding.top,
        right: g.padding.right,
        bottom: g.padding.bottom,
        left: g.padding.left,
    };
    s.flex_direction = match g.flex_direction.as_str() {
        "row" => FlexDirection::Row,
        "column" => FlexDirection::Column,
        "row-reverse" => FlexDirection::RowReverse,
        "column-reverse" => FlexDirection::ColumnReverse,
        other => panic!("未知 flexDirection：{other}"),
    };
    s.justify_content = g.justify_content.clone();
    s.align_items = g.align_items.clone();
    s.align_self = g.align_self.clone();
    s.flex_grow = g.flex_grow;
    s.flex_shrink = g.flex_shrink;
    s.flex_basis = g.flex_basis;
    s.flex_basis_ratio = g.flex_basis_ratio;
    s.gap = g.gap;
    s.display = match g.display.as_str() {
        "flex" => Display::Flex,
        "none" => Display::None,
        other => panic!("未知 display：{other}"),
    };
    s.position = match g.position.as_str() {
        "static" => Position::Static,
        "relative" => Position::Relative,
        "absolute" => Position::Absolute,
        other => panic!("未知 position：{other}"),
    };
    s.top = g.top;
    s.left = g.left;
    s.overflow = match g.overflow.as_str() {
        "visible" => Overflow::Visible,
        "hidden" => Overflow::Hidden,
        "scroll" => Overflow::Scroll,
        "auto" => Overflow::Auto,
        other => panic!("未知 overflow：{other}"),
    };
    s
}

/// golden 用例 → 扁平树（节点顺序与 golden 的 `nodes` 数组一致）
fn to_tree(case: &GoldenCase) -> (LayoutTree, Vec<u32>) {
    let mut tree = LayoutTree::new();
    let mut index_of: HashMap<u32, u32> = HashMap::new();

    for g in &case.nodes {
        let mut node = LNode::new(g.id, to_style(g));
        node.tag = g.tag.clone();
        if g.is_text {
            // 文本内容不入 golden（度量按 id 查表）→ 占位即可
            node.text = Some(proteus_layout_core::TextMeasureRequest { text: String::new() });
        }
        let idx = tree.push(node);
        index_of.insert(g.id, idx);
    }
    for g in &case.nodes {
        if let Some(pid) = g.parent_id {
            let parent = *index_of.get(&pid).expect("parentId 必须在 nodes 中");
            let child = *index_of.get(&g.id).expect("自身必须在 nodes 中");
            tree.add_child(parent, child);
        }
    }
    // 根：无 parent 的第一个节点
    let root = case.nodes.iter().find(|g| g.parent_id.is_none()).expect("应有一个根节点").id;
    tree.roots.push(*index_of.get(&root).unwrap());

    let order: Vec<u32> = case.nodes.iter().map(|g| g.id).collect();
    (tree, order)
}

/// golden 文本度量 → 查表度量器
fn to_measurer(case: &GoldenCase) -> TableTextMeasurer {
    let mut table: HashMap<u32, Size> = HashMap::new();
    for (id_str, size) in &case.text_measures {
        let id: u32 = id_str.parse().expect("textMeasures 的键应为节点 id");
        table.insert(id, Size { width: size.width, height: size.height });
    }
    TableTextMeasurer::new(table)
}

/* ────────────────────── 对拍 ────────────────────── */

#[test]
fn conformance_browser_layout() {
    let golden = load_golden();
    let mut total_compared = 0usize;
    let mut failures: Vec<String> = Vec::new();
    let mut max_delta: f32 = 0.0;

    for case in &golden.cases {
        let (mut tree, order) = to_tree(case);
        let mut engine = TaffyEngine::new().with_measurer(Box::new(to_measurer(case)));

        engine.layout(
            &mut tree,
            RootConstraint {
                width: AvailableSpace::Definite(golden.viewport.width),
                height: AvailableSpace::Definite(golden.viewport.height),
            },
        );

        // 绝对坐标（与 golden 的「相对根原点」同口径）
        let abs = tree.absolute_rects();

        // golden 按 id 索引
        let mut golden_by_id: HashMap<u32, GoldenRect> = HashMap::new();
        for (id_str, r) in &case.rects {
            golden_by_id.insert(id_str.parse().expect("rects 键应为 id"), *r);
        }

        // 隐藏节点（display:none）在 CSS 中无盒 —— 两侧都跳过
        let hidden: Vec<u32> = case
            .nodes
            .iter()
            .filter(|g| g.display == "none")
            .map(|g| g.id)
            .collect();

        let index_of: HashMap<u32, usize> = case.nodes.iter().enumerate().map(|(i, g)| (g.id, i)).collect();

        for g in &case.nodes {
            if hidden.contains(&g.id) {
                continue;
            }
            let Some(expect) = golden_by_id.get(&g.id) else {
                // 浏览器没测到该节点（如 display:none 的后代）→ 不计入
                continue;
            };
            let idx = index_of[&g.id];
            let Some(actual) = abs[idx] else {
                failures.push(format!("[{}] #{} 引擎未产出矩形（浏览器有盒）", case.name, g.id));
                continue;
            };
            total_compared += 1;
            for (prop, a, e) in [
                ("x", actual.x, expect.x),
                ("y", actual.y, expect.y),
                ("w", actual.width, expect.width),
                ("h", actual.height, expect.height),
            ] {
                let d = (a - e).abs();
                if d > max_delta {
                    max_delta = d;
                }
                if d > golden.tolerance {
                    failures.push(format!(
                        "[{}] #{} .{}: 引擎 {:.2} vs 浏览器 {:.2}（差 {:.2}dp）",
                        case.name, g.id, prop, a, e, d
                    ));
                }
            }
        }
        let _ = order;
    }

    println!("conformance：比对 {} 个节点，最大偏差 {:.3}dp（容差 {}dp）", total_compared, max_delta, golden.tolerance);
    assert!(total_compared >= 60, "参与比对的节点数过少（{total_compared}）——防空跑");
    assert!(
        failures.is_empty(),
        "与浏览器布局不一致（{} 处）：\n{}",
        failures.len(),
        failures.iter().take(20).cloned().collect::<Vec<_>>().join("\n")
    );
}

/// 引擎身份与版本锁（DCP-1：必须 0.14，禁止降级到 0.13——后者有 measure 指数退化）
#[test]
fn engine_identity_is_taffy_014() {
    let engine = TaffyEngine::new();
    assert_eq!(engine.name(), "taffy-0.14", "★DCP-1 锁定后端版本；改这里必须同步决策文档");
}

/// ★D3 判据：测量次数**有界且与深度无关**（而非字面「必须 1 次」）
///
/// 实测背景（DCP-1 决策文档 §2.4）：taffy 0.14 对同一叶子的测量次数是**有界常数 13**，
/// 与嵌套深度无关；0.13 则呈 3×2^d−2 指数爆炸。
/// 故本测试断言「深度 6 与深度 12 的测量次数相等」——这比断言绝对次数更能抓住退化。
#[test]
fn measure_bounded_and_depth_independent() {
    fn depth_case(depth: usize) -> usize {
        let mut tree = LayoutTree::new();
        // 文本叶子
        let mut leaf = LNode::new(1, LStyle::default());
        leaf.text = Some(proteus_layout_core::TextMeasureRequest { text: String::new() });
        tree.push(leaf);
        // 逐层包裹（auto 尺寸容器——正是 0.13 爆炸的形状）
        let mut cur: u32 = 0;
        for d in 0..depth {
            let mut wrapper = LNode::new(100 + d as u32, LStyle::default());
            wrapper.style.flex_direction = FlexDirection::Column;
            let idx = tree.push(wrapper);
            tree.add_child(idx, cur);
            cur = idx;
        }
        tree.roots.push(cur);

        let mut engine = TaffyEngine::new().with_measurer(Box::new(TableTextMeasurer::default()));
        let out = engine.layout(&mut tree, RootConstraint::loose_width(300.0));
        out.measure_calls + out.measure_hits
    }

    let d6 = depth_case(6);
    let d12 = depth_case(12);
    println!("measure 次数：深度 6 → {d6}，深度 12 → {d12}（有界常数即合格）");
    assert_eq!(
        d6, d12,
        "★测量次数随深度变化（{d6} → {d12}）——这是 D3 禁止的退化形态；怀疑 taffy 被降级到 0.13？"
    );
}

/// 度量记忆化：同一 (节点, 最大宽) 只向平台要一次
#[test]
fn measure_cache_hits_on_repeat_layout() {
    let golden = load_golden();
    // 取含文本的用例
    let Some(case) = golden.cases.iter().find(|c| !c.text_measures.is_empty()) else {
        panic!("golden 里应有含文本度量的用例");
    };
    let (mut tree, _) = to_tree(case);
    let mut engine = TaffyEngine::new().with_measurer(Box::new(to_measurer(case)));
    let constraint = RootConstraint {
        width: AvailableSpace::Definite(golden.viewport.width),
        height: AvailableSpace::Definite(golden.viewport.height),
    };

    let first = engine.layout(&mut tree, constraint);
    assert!(first.measure_calls > 0, "首帧应有真实度量调用");
    assert!(engine.measure_cache_entries() > 0, "首帧后应有缓存条目");

    let second = engine.layout(&mut tree, constraint);
    assert_eq!(second.measure_calls, 0, "★二帧应全部命中缓存（0 次向平台要度量）");
    // ★命中数 ≥ 首帧未命中数：taffy 对同一叶子会**多次**测量（有界常数，见 DCP-1 §2.4），
    //   故二帧的查询次数多于「不同 (节点,宽度) 组合数」。这里断言「至少覆盖了首帧的全部查询」。
    assert!(
        second.measure_hits >= first.measure_calls + first.measure_hits,
        "二帧命中数（{}）应 ≥ 首帧总查询数（{}）",
        second.measure_hits,
        first.measure_calls + first.measure_hits
    );
}

/// ★增量布局：布局边界阻断向上传播（§5.4 T2 的核心机制）
#[test]
fn incremental_scope_stops_at_layout_boundary() {
    // 树：root(column, auto) → boundary(row, 显式 320×200) → inner(row, auto) → target(20×20)
    let mut tree = LayoutTree::new();
    let mut root = LNode::new(1, LStyle::default());
    root.style.flex_direction = FlexDirection::Column;
    let root_idx = tree.push(root);

    let mut boundary = LNode::new(2, LStyle::default());
    boundary.style.flex_direction = FlexDirection::Row;
    boundary.style.width = Some(320.0);
    boundary.style.height = Some(200.0);
    let boundary_idx = tree.push(boundary);

    let mut inner = LNode::new(3, LStyle::default());
    inner.style.flex_direction = FlexDirection::Row;
    let inner_idx = tree.push(inner);

    let mut target = LNode::new(4, LStyle::default());
    target.style.width = Some(20.0);
    target.style.height = Some(20.0);
    let target_idx = tree.push(target);

    tree.roots.push(root_idx);
    tree.add_child(root_idx, boundary_idx);
    tree.add_child(boundary_idx, inner_idx);
    tree.add_child(inner_idx, target_idx);

    assert!(tree.get(boundary_idx).is_layout_boundary(), "显式宽高的容器应被判为布局边界");

    let engine = TaffyEngine::new();
    // ★核心：脏节点在边界之内 ⇒ 重排范围应停在边界，而不是一路到根
    let scope = engine.relayout_scope_of(&tree, target_idx);
    assert_eq!(scope, boundary_idx, "★脏传播应止于布局边界（这正是 §5.4 T2 要验证的机制）");

    // 对照：把边界改成 auto 尺寸（不再是边界）→ 重排范围必须**越过它继续上溯到根**
    let mut no_boundary = tree.clone();
    no_boundary.get_mut(boundary_idx).style.width = None;
    no_boundary.get_mut(boundary_idx).style.height = None;
    let engine2 = TaffyEngine::new();
    let scope2 = engine2.relayout_scope_of(&no_boundary, target_idx);
    // ★注意 root 自己是 column 且**无显式宽高** → 它不是边界 → 上溯终点是它
    assert_eq!(scope2, root_idx, "★去掉边界后应退化为整树根（这就是 RN 事故的形状）");
    // 顺带断言：有边界时范围**严格更小**（这是「边界生效」的量化判据）
    assert_ne!(scope, scope2, "★有/无边界的重排范围必须不同——否则边界没起作用");
}

/// ★★破坏性验证：证明本测试**不是靠「照着 golden 抄答案」通过的**
///
/// 手法：把引擎的输入改掉（改一个节点的宽度），输出**必然**与 golden 不符。
/// 若比对逻辑有 bug（如直接返回 golden 的值），此测试会「通过」——那才说明比对是假的。
#[test]
fn destructive_changed_input_must_mismatch() {
    let golden = load_golden();
    let case = &golden.cases[0];
    let (mut tree, _) = to_tree(case);
    let mut engine = TaffyEngine::new().with_measurer(Box::new(to_measurer(case)));

    // 找一个有显式宽度的节点，改宽 20dp
    let victim = tree
        .nodes
        .iter_mut()
        .find(|n| n.style.width.is_some() && n.parent != proteus_layout_core::NO_PARENT)
        .expect("用例里应有带显式宽度的非根节点");
    let victim_id = victim.id;
    victim.style.width = Some(victim.style.width.unwrap() + 20.0);

    engine.layout(
        &mut tree,
        RootConstraint {
            width: AvailableSpace::Definite(golden.viewport.width),
            height: AvailableSpace::Definite(golden.viewport.height),
        },
    );
    let abs = tree.absolute_rects();

    let mut golden_by_id: HashMap<u32, GoldenRect> = HashMap::new();
    for (id_str, r) in &case.rects {
        golden_by_id.insert(id_str.parse().unwrap(), *r);
    }
    let idx = tree.index_of_id(victim_id).unwrap();
    let actual = abs[idx as usize].expect("改动后的节点仍应有盒");
    let expect = golden_by_id[&victim_id];

    let delta = (actual.width - expect.width).abs();
    assert!(
        delta > golden.tolerance,
        "★改了输入却仍与 golden 一致（差 {delta:.2}dp）——比对逻辑有问题（可能直接返回了 golden 值）"
    );
    println!("破坏性验证通过：改宽 +20dp → 与浏览器基线差 {delta:.2}dp（预期不符）");
}
