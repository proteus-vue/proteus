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
    /// ★★命中测试基准真值（浏览器 `elementsFromPoint`）——M3 事件系统的地基。
    ///   `ids` 自**最上层到根**，即 `hit_path` 的期望值。
    #[serde(default)]
    hit_probes: Vec<GoldenHitProbe>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenHitProbe {
    x: f32,
    y: f32,
    ids: Vec<u32>,
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
            node.text = Some(proteus_layout_core::TextMeasureRequest { text: String::new(), style_key: 0 });
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

/// ★★命中测试 conformance：以浏览器 `elementsFromPoint` 为真值基准（M3 事件系统出口条件）
///
/// 【为什么命中也要对拍，而不是「自己写测试自己过」】
///   命中正确性依赖两条**容易分叉的语义**：
///     ① **逆绘制序**：后画的在上 → 命中要取「最后绘制且含点」者
///     ② **裁剪（overflow:hidden）**：被裁掉的部分不可命中，且**不得回落到父级**
///   任何一条写错，「点到的元素」与「看到的元素」就不一致 —— 这是自绘框架最隐蔽的一类 bug
///   （用户现象：「点了没反应」或「点到了看不见的东西」）。故与布局同法锚定浏览器。
///
/// 【本测试比什么】对每个探针点，Rust `hit_path` 必须**逐位等于**浏览器
///   `elementsFromPoint` 过滤出的 id 序列（自上层到根）。
///   比只比 target 更强：顺序错、多余节点、缺失节点都会被抓到。
///
/// 【已知不建模的差异】CSS 绘制的「定位元素在流之上」（CSS 2.1 附录 E）
///   本模型未实现（Profile 未纳入 z-index）。golden 生成侧的翻译给所有元素加了
///   `position:relative`（containing block 对齐需要），而 `z-index:auto` 的定位元素
///   按**树序**绘制 → 与「纯树序」模型一致，故两侧可比。若将来引入 z-index，
///   **绘制与命中必须同时改**（二者永远互为逆序），并同步本测试。
#[test]
fn conformance_hit_test_against_browser() {
    let golden = load_golden();
    let mut total = 0usize;
    let mut with_hit = 0usize;
    let mut failures: Vec<String> = Vec::new();

    for case in &golden.cases {
        let (mut tree, _order) = to_tree(case);
        let mut engine = TaffyEngine::new().with_measurer(Box::new(to_measurer(case)));
        engine.layout(
            &mut tree,
            RootConstraint {
                width: AvailableSpace::Definite(golden.viewport.width),
                height: AvailableSpace::Definite(golden.viewport.height),
            },
        );

        // 探针期望值以 **id** 给出 → 换算为索引序列（布局后索引才稳定可比）
        let id_to_index: HashMap<u32, usize> =
            case.nodes.iter().enumerate().map(|(i, g)| (g.id, i)).collect();

        for probe in &case.hit_probes {
            total += 1;
            if !probe.ids.is_empty() {
                with_hit += 1;
            }
            let got_ids: Vec<u32> = proteus_layout_core::hit_path(&tree, probe.x, probe.y)
                .iter()
                .map(|&i| tree.get(i).id)
                .collect();

            if got_ids != probe.ids {
                // 期望索引（用于错误信息里指明是哪个节点，便于定位）
                let exp_idx: Vec<String> = probe
                    .ids
                    .iter()
                    .map(|id| match id_to_index.get(id) {
                        Some(i) => format!("{id}(idx{i})"),
                        None => format!("{id}(未知)"),
                    })
                    .collect();
                failures.push(format!(
                    "[{}] 点 ({:.1},{:.1})：Rust {:?} vs 浏览器 期望 [{}({})]",
                    case.name,
                    probe.x,
                    probe.y,
                    got_ids,
                    exp_idx.join(", "),
                    probe.ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(", ")
                ));
            }
        }
    }

    println!("命中 conformance：比对 {total} 个探针（其中 {with_hit} 个有命中）");
    assert!(total >= 2800, "探针数过少（{total}）——防空跑");
    assert!(with_hit >= 250, "有命中的探针过少（{with_hit}）——防空跑");
    assert!(
        failures.is_empty(),
        "命中结果与浏览器不一致（{} / {} 处）：\n{}",
        failures.len(),
        total,
        failures.iter().take(15).cloned().collect::<Vec<_>>().join("\n")
    );
}

/// ★破坏性验证：把命中实现「弄坏」（忽略裁剪）必须立刻报错——证明上面的对拍不是恒真。
///
/// 手法：手工构造一个 `overflow:hidden` 的父 + 溢出子级，点在**裁剪区外**；
/// 用「朴素实现」（只比矩形、不管裁剪）与真实 `hit_path` 对照，两者必须**给出不同答案**。
/// 若某次重构让二者一致（说明裁剪被忽略），本测试会失败。
#[test]
fn destructive_ignoring_clip_must_change_the_answer() {
    use proteus_layout_core::Overflow;

    // 父 0,0,50,50 overflow:hidden；子 0,0,200,200（大幅溢出）
    let mut tree = LayoutTree::new();
    let mut parent = LNode::new(1, LStyle { width: Some(50.0), height: Some(50.0), ..Default::default() });
    parent.style.overflow = Overflow::Hidden;
    parent.rect = proteus_layout_core::Rect { x: 0.0, y: 0.0, width: 50.0, height: 50.0 };
    let mut child = LNode::new(2, LStyle { width: Some(200.0), height: Some(200.0), ..Default::default() });
    child.rect = proteus_layout_core::Rect { x: 0.0, y: 0.0, width: 200.0, height: 200.0 };

    let pi = tree.push(parent);
    let ci = tree.push(child);
    tree.add_child(pi, ci);
    tree.roots.push(pi);

    // 点在子级盒内、但超出父的裁剪区（y=120 > 50）
    let (x, y) = (10.0, 120.0);
    let clipped: Vec<u32> = proteus_layout_core::hit_path(&tree, x, y)
        .iter()
        .map(|&i| tree.get(i).id)
        .collect();
    assert!(clipped.is_empty(), "★裁剪生效：该点应无命中（子被裁、父不含）—— 实际 {clipped:?}");

    // 朴素实现（忽略裁剪，只看矩形包含）：会错误地返回子级
    let naive: Vec<u32> = tree
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, n)| {
            let r = n.rect;
            x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height
        })
        .map(|(i, _)| tree.nodes[i].id)
        .collect();
    assert!(
        !naive.is_empty(),
        "★朴素实现必须给出不同答案（否则本测试失去破坏性意义）—— 它应错误命中子级"
    );
    assert_ne!(clipped, naive, "★裁剪语义必须真的改变结果");
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
        leaf.text = Some(proteus_layout_core::TextMeasureRequest { text: String::new(), style_key: 0 });
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

/* ────────────── ★绘制序真值：消费浏览器探针（tests/golden/paint-order-probes.json） ────────────── */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaintProbeFile {
    generated_by: String,
    probes: Vec<PaintProbe>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaintProbe {
    id: String,
    desc: String,
    point: ProbePoint,
    /// 自**最上层到最下层**（浏览器 `elementsFromPoint` 的原生顺序）
    top_down_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ProbePoint {
    x: f32,
    y: f32,
}

/// ★★绘制序 conformance：两相位模型必须与**真实 Chromium** 的 `elementsFromPoint` 一致。
///
/// 【为什么这条测试存在】
///   绘制序是命中正确性的地基，也是本模块**唯一一处「直觉会写错」**的地方：
///   初版实现是纯树序，探针 D/E 证明那是错的（相位按**层叠上下文**而非按父级）。
///   探针脚本 `tests/paint-order-probe.mjs` 把浏览器真值冻结成 JSON；
///   本测试把它转成等价的 Rust 树，再断言 `hit_path` 逐位一致。
///   ⇒ 浏览器真值 → **机器可检**，而不是躺在文档里的一段话。
///
/// 【几何来源】探针 HTML 的几何是**手写内联样式**（不是布局算出来的），
///   故这里按同一份声明手工给 rect——两侧的几何同源，比较的才是**顺序语义**。
#[test]
fn conformance_paint_order_against_browser_probes() {
    // ★探针文件在**仓库根**的 tests/golden/（绘制序探针与布局 golden 分开放：
    //   前者由 `tests/paint-order-probe.mjs` 生成，后者由 e2e 对拍顺带冻结）
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/golden/paint-order-probes.json");
    let raw = fs::read_to_string(&path).expect("绘制序探针文件应存在（生成：node tests/paint-order-probe.mjs）");
    let file: PaintProbeFile = serde_json::from_str(&raw).expect("探针 JSON 应可解析");
    assert!(file.generated_by.contains("Chromium"), "真值必须来自真实浏览器：{}", file.generated_by);

    // 探针 id → 该场景的等价 Rust 树（几何按探针的声明样式手工构造）
    let build = |id: &str| -> Option<(LayoutTree, HashMap<String, u32>)> {
        let mut names: HashMap<String, u32> = HashMap::new();
        let mut tree = LayoutTree::new();
        let mut add = |tree: &mut LayoutTree, names: &mut HashMap<String, u32>, name: &str, style: LStyle, rect: proteus_layout_core::Rect| -> u32 {
            let id = (names.len() as u32) + 1;
            names.insert(name.to_string(), id);
            let mut n = LNode::new(id, style);
            n.rect = rect;
            tree.push(n)
        };
        let boxed = |w: f32, h: f32| LStyle { width: Some(w), height: Some(h), ..Default::default() };
        let abs = |w: f32, h: f32| LStyle {
            width: Some(w),
            height: Some(h),
            position: Position::Absolute,
            ..Default::default()
        };
        let rc = |x: f32, y: f32, w: f32, h: f32| proteus_layout_core::Rect { x, y, width: w, height: h };

        let root_idx = match id {
            "A" | "B" => {
                // w(200×100, relative) > [infl 100×60 @y10, abs 100×60 @(20,20)]
                let w = add(&mut tree, &mut names, "w", boxed(200.0, 100.0), rc(0.0, 0.0, 200.0, 100.0));
                let infl = add(&mut tree, &mut names, "infl", boxed(100.0, 60.0), rc(0.0, 10.0, 100.0, 60.0));
                let a = add(&mut tree, &mut names, "abs", abs(100.0, 60.0), rc(20.0, 20.0, 100.0, 60.0));
                tree.add_child(w, infl);
                tree.add_child(w, a);
                w
            }
            "C" => {
                // w(200×100, relative) > [a 100×60 @y10, b 100×60 @(20,60-40=20)]
                let w = add(&mut tree, &mut names, "w", boxed(200.0, 100.0), rc(0.0, 0.0, 200.0, 100.0));
                let a = add(&mut tree, &mut names, "a", boxed(100.0, 60.0), rc(0.0, 10.0, 100.0, 60.0));
                let b = add(&mut tree, &mut names, "b", boxed(100.0, 60.0), rc(20.0, 20.0, 100.0, 60.0));
                tree.add_child(w, a);
                tree.add_child(w, b);
                w
            }
            "D" | "E" => {
                // root(200×120) > [A(200×60) > (E: A0 200×10 >) A1 abs 100×60 @(20,20) ; B 200×60 @y20]
                let root = add(&mut tree, &mut names, "root", boxed(200.0, 120.0), rc(0.0, 0.0, 200.0, 120.0));
                let a = add(&mut tree, &mut names, "A", boxed(200.0, 60.0), rc(0.0, 0.0, 200.0, 60.0));
                let parent = if id == "E" {
                    let a0 = add(&mut tree, &mut names, "A0", boxed(200.0, 10.0), rc(0.0, 0.0, 200.0, 10.0));
                    tree.add_child(a, a0);
                    a0
                } else {
                    a
                };
                let a1 = add(&mut tree, &mut names, "A1", abs(100.0, 60.0), rc(20.0, 20.0, 100.0, 60.0));
                tree.add_child(parent, a1);
                let b = add(&mut tree, &mut names, "B", boxed(200.0, 60.0), rc(0.0, 20.0, 200.0, 60.0));
                tree.add_child(root, a);
                tree.add_child(root, b);
                root
            }
            "F" => {
                // root(200×120) > [X 200×40 @y0, Y 200×40 @y20]
                let root = add(&mut tree, &mut names, "root", boxed(200.0, 120.0), rc(0.0, 0.0, 200.0, 120.0));
                let x = add(&mut tree, &mut names, "X", boxed(200.0, 40.0), rc(0.0, 0.0, 200.0, 40.0));
                let y = add(&mut tree, &mut names, "Y", boxed(200.0, 40.0), rc(0.0, 20.0, 200.0, 40.0));
                tree.add_child(root, x);
                tree.add_child(root, y);
                root
            }
            _ => return None,
        };
        tree.roots.push(root_idx);
        Some((tree, names))
    };

    let mut checked = 0usize;
    let mut failures: Vec<String> = Vec::new();
    for probe in &file.probes {
        let Some((tree, names)) = build(&probe.id) else {
            failures.push(format!("探针 {} 无对应构造（测试需补齐）", probe.id));
            continue;
        };
        let got: Vec<String> = proteus_layout_core::hit_path(&tree, probe.point.x, probe.point.y)
            .iter()
            .map(|&i| {
                let id = tree.get(i).id;
                names
                    .iter()
                    .find(|(_, &v)| v == id)
                    .map(|(k, _)| k.clone())
                    .unwrap_or_else(|| format!("?{id}"))
            })
            .collect();
        checked += 1;
        if got != probe.top_down_ids {
            failures.push(format!("[{}] {}：Rust {:?} vs 浏览器 {:?}", probe.id, probe.desc, got, probe.top_down_ids));
        }
    }

    println!("绘制序 conformance：比对 {checked} 个浏览器探针");
    assert!(checked >= 6, "探针数过少（{checked}）——防空跑");
    assert!(failures.is_empty(), "绘制序与浏览器不一致：\n{}", failures.join("\n"));
}

/* ────────────── ★★增量布局：正确性 + 退化保护（本轮抓到栈溢出后补的覆盖） ────────────── */

/// 构造「root → boundary(显式尺寸) → inner → target」四层树。
///
/// ★这个形状是**最小复现**：只有重排范围落在**布局边界**上时才会走到出问题的代码路径
///   （没有边界时 scope=根，走的是另一个分支 → 此前未暴露）。
fn incremental_tree(sized_boundary: bool) -> (LayoutTree, u32, u32) {
    let mut tree = LayoutTree::new();
    let mut root = LNode::new(1, LStyle::default());
    root.style.flex_direction = FlexDirection::Column;
    let root_idx = tree.push(root);

    let mut b = LNode::new(2, LStyle::default());
    b.style.flex_direction = FlexDirection::Row;
    if sized_boundary {
        b.style.width = Some(320.0);
        b.style.height = Some(200.0);
    }
    let b_idx = tree.push(b);

    let mut inner = LNode::new(3, LStyle::default());
    inner.style.flex_direction = FlexDirection::Row;
    let inner_idx = tree.push(inner);

    let mut target = LNode::new(4, LStyle::default());
    target.style.width = Some(20.0);
    target.style.height = Some(20.0);
    let target_idx = tree.push(target);

    tree.roots.push(root_idx);
    tree.add_child(root_idx, b_idx);
    tree.add_child(b_idx, inner_idx);
    tree.add_child(inner_idx, target_idx);
    (tree, root_idx, target_idx)
}

/// ★★回归锁：**边界存在时**调用 `layout_incremental` 不得崩溃（曾栈溢出）
///
/// 【此前的覆盖盲区（本仓实测）】既有测试只验证 `relayout_scope_of`（纯函数）
///   **从未调用 `layout_incremental` 本身** ⇒ 真正的增量路径**零覆盖**，
///   而它在「范围=边界」时必然栈溢出（4 个节点即可复现）。
///   根因：`copy_subtree` 直接 `clone()` 节点，把**原树的索引**带进新树
///   → 子树根的 `parent` 指向自己（自环）→ 布局遍历无限递归。
///   ⇒ 教训：**测了「范围算得对」不等于测了「按范围重排跑得通」**。
#[test]
fn incremental_with_boundary_does_not_crash_and_matches_full() {
    let (mut tree, _root_idx, target_idx) = incremental_tree(true);
    assert!(tree.get(target_idx) == tree.get(target_idx));
    let boundary_idx = tree.index_of_id(2).unwrap();
    assert!(tree.get(boundary_idx).is_layout_boundary(), "显式宽高的容器应为布局边界");

    let constraint = RootConstraint { width: AvailableSpace::Definite(375.0), height: AvailableSpace::MaxContent };
    let mut engine = TaffyEngine::new();
    engine.layout(&mut tree, constraint);          // 首帧全量

    // 改叶子 → 增量重排（★此行曾栈溢出）
    tree.get_mut(target_idx).style.width = Some(25.0);
    tree.get_mut(target_idx).dirty = true;
    let out = engine.layout_incremental(&mut tree, target_idx);
    assert!(out.relayout_count > 0, "增量应产出矩形");

    // ★结果必须与**全量重排**逐节点一致（不只是「没崩」）
    let mut full = tree.clone();
    let mut e2 = TaffyEngine::new();
    e2.layout(&mut full, constraint);
    let a = tree.absolute_rects();
    let b = full.absolute_rects();
    let mut worst = 0f32;
    for i in 0..tree.len() {
        match (a[i], b[i]) {
            (Some(x), Some(y)) => {
                worst = worst
                    .max((x.x - y.x).abs())
                    .max((x.y - y.y).abs())
                    .max((x.width - y.width).abs())
                    .max((x.height - y.height).abs());
            }
            (None, None) => {}
            _ => panic!("节点 {i}：增量与全量的「有无盒」不一致"),
        }
    }
    assert!(worst < 0.01, "增量与全量最大偏差 {worst:.4}dp 超阈值");
    // 新宽度确实生效
    let t = a[target_idx as usize].unwrap();
    assert!((t.width - 25.0).abs() < 0.01, "target 宽应为 25，实际 {}", t.width);
}

/// ★退化保护：**无布局边界**时增量必须不退化为「比全量更慢」
///
/// 【为什么需要（本仓实测）】没有边界时 scope=根，而本实现为范围子树**重建** taffy 树
///   ⇒ 白拷一整棵树：实测 **0.6×**（越用越慢）。加退化保护（scope=根 → 直接全量）后回到 ~1.0×。
///   ★本测试只断言**正确性与非退化到崩溃**；比值是性能断言，交给 `examples/incremental-bench`。
#[test]
fn incremental_without_boundary_still_matches_full() {
    let (mut tree, _r, target_idx) = incremental_tree(false);
    let constraint = RootConstraint { width: AvailableSpace::Definite(375.0), height: AvailableSpace::MaxContent };
    let mut engine = TaffyEngine::new();
    engine.layout(&mut tree, constraint);

    tree.get_mut(target_idx).style.width = Some(25.0);
    tree.get_mut(target_idx).dirty = true;
    engine.layout_incremental(&mut tree, target_idx);   // 无边界 ⇒ 内部退回全量

    let mut full = tree.clone();
    let mut e2 = TaffyEngine::new();
    e2.layout(&mut full, constraint);
    let a = tree.absolute_rects();
    let b = full.absolute_rects();
    for i in 0..tree.len() {
        match (a[i], b[i]) {
            (Some(x), Some(y)) => {
                assert!((x.x - y.x).abs() < 0.01 && (x.width - y.width).abs() < 0.01,
                        "节点 {i} 无边界时增量与全量不一致");
            }
            (None, None) => {}
            _ => panic!("节点 {i}：有无盒不一致"),
        }
    }
}

/// ★★量化判据：有边界的增量必须**显著快于**全量（回归时立刻红）
///
/// 与上面两个测试互补：那两个保「对」，这个保「快」。
/// 阈值取保守值（>5×）—— 实测在 30–600× 区间，故 5× 只在真正劣化时才失败。
#[test]
fn incremental_with_boundary_is_much_faster_than_full() {
    // 100 行 × 40 列 = 4101 节点；每行给显式宽高 ⇒ 100 个布局边界
    let mut tree = LayoutTree::new();
    let root = tree.push(LNode::new(1, LStyle { width: Some(750.0), flex_direction: FlexDirection::Column, ..Default::default() }));
    let mut id = 2u32;
    let mut rows = Vec::new();
    for _ in 0..100 {
        let rs = LStyle {
            flex_direction: FlexDirection::Row, gap: 4.0, flex_shrink: 0.0,
            width: Some(750.0), height: Some(20.0), ..Default::default()
        };
        let r = tree.push(LNode::new(id, rs)); id += 1;
        rows.push(r);
        tree.add_child(root, r);
        for _ in 0..40 {
            let ls = LStyle { width: Some(40.0), height: Some(16.0), flex_shrink: 0.0, ..Default::default() };
            let l = tree.push(LNode::new(id, ls)); id += 1;
            tree.add_child(r, l);
        }
    }
    tree.roots.push(root);

    let c = RootConstraint { width: AvailableSpace::Definite(750.0), height: AvailableSpace::MaxContent };
    let mut e = TaffyEngine::new();
    e.layout(&mut tree, c);
    let t0 = std::time::Instant::now();
    for _ in 0..5 { e.layout(&mut tree, c); }
    let full = t0.elapsed().as_secs_f64() / 5.0;

    let mid = rows[rows.len() / 2];
    let leaf = tree.get(mid).children[10];
    let t1 = std::time::Instant::now();
    for _ in 0..50 {
        tree.get_mut(leaf).style.width = Some(41.0);
        tree.get_mut(leaf).dirty = true;
        e.layout_incremental(&mut tree, leaf);
    }
    let inc = t1.elapsed().as_secs_f64() / 50.0;
    let speedup = full / inc;
    println!("增量 vs 全量：全量 {:.3}ms · 增量 {:.4}ms · 加速 {:.1}×", full * 1000.0, inc * 1000.0, speedup);
    assert!(speedup > 5.0, "有边界时增量应显著快于全量（实测 {speedup:.1}×，阈值 5×）");
}
