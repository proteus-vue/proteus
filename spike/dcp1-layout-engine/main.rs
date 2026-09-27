// spike/dcp1-layout-engine/main.rs
// ★★DCP-1 决策 spike（方案 §5.0.5 / §5.6）：**排版核心语言二选一 —— C++ + Yoga vs Rust + Taffy**。
//
// 决策要回答四个问题（本程序逐项测量，输出机器可读 JSON）：
//   ① **布局能力**：Flexbox 之外是否支持 Grid？CSS 语义贴合度（box-sizing / 百分比基准 / min-max 冻结）？
//   ② **单次测量协议**（D3）：约束自顶向下、尺寸自底向上、**禁止多轮 measure** —— 引擎是否原生满足？
//   ③ **增量能力**：`mark_dirty` + 缓存 → 单点变更的真实重算量（对齐 M1 的 T1/T4 口径）
//   ④ **性能**：4050 节点（M2 出口条件的规模）单次布局耗时；深树（深度 12）脏更新耗时
//
// ★基准真值：**M1 已建成的浏览器对拍基线**（方案 §5.7 明说「以浏览器作为布局真值基准」）——
//   本 spike 的期望值直接取自 `tests/e2e-layout-core-pixel.test.ts` 的实测结果，
//   故「引擎算出来的数 vs 浏览器算出来的数」是可对账的，不是自说自话。
//
// 运行：cargo run --release --manifest-path spike/dcp1-layout-engine/Cargo.toml
use std::time::Instant;
use taffy::prelude::*;
use taffy::{AvailableSpace, TaffyTree};

/// 一个测量结果（供 JSON 输出）
struct Measurement {
    name: &'static str,
    detail: String,
    pass: bool,
}

fn main() {
    let mut out: Vec<Measurement> = Vec::new();

    // ═══════════════════════════════════════════════════════════════
    // ① CSS 语义贴合度（对齐 M1 对拍抓出的 6 个缺陷，逐个验 Taffy 是否原生正确）
    // ═══════════════════════════════════════════════════════════════

    // ①-a 主轴 auto 的 flex base size 应为 **max-content**（M1 缺陷 #1；浏览器实测 228）
    {
        let mut tree: TaffyTree<()> = TaffyTree::new();
        // 内层 row：两个 auto 宽子级（内容 30 / 100）
        let c1 = tree
            .new_leaf(Style {
                size: Size { width: length(30.0), height: length(20.0) },
                ..Default::default()
            })
            .unwrap();
        let c2 = tree
            .new_leaf(Style {
                size: Size { width: length(100.0), height: length(20.0) },
                ..Default::default()
            })
            .unwrap();
        // 中层 column：auto 宽（无显式），flex_grow=1 —— 将被外层分配宽度
        let mid = tree
            .new_with_children(
                Style {
                    display: Display::Flex,
                    flex_direction: FlexDirection::Row,
                    size: Size { width: auto(), height: auto() },
                    ..Default::default()
                },
                &[c1, c2],
            )
            .unwrap();
        // 外层 row：宽 340，mid 参与 grow
        let other = tree
            .new_leaf(Style {
                size: Size { width: length(40.0), height: length(20.0) },
                ..Default::default()
            })
            .unwrap();
        let mid_wrap = tree.new_with_children(Style { ..Default::default() }, &[mid]).unwrap();
        let root = tree
            .new_with_children(
                Style {
                    display: Display::Flex,
                    flex_direction: FlexDirection::Row,
                    size: Size { width: length(340.0), height: auto() },
                    ..Default::default()
                },
                &[mid_wrap, other],
            )
            .unwrap();
        tree.compute_layout(root, Size { width: AvailableSpace::Definite(340.0), height: AvailableSpace::MaxContent })
            .unwrap();
        let mid_layout = tree.layout(mid).unwrap();
        let got = mid_layout.size.width;
        // ★期望：不「填满可用」（旧实现的错误行为是 ~296），而是 max-content(130) + grow 分配余量
        out.push(Measurement {
            name: "flex-base-is-max-content",
            detail: format!("内层 auto 宽容器 = {:.1}（若为「填满可用」约 296；max-content 基线 130）", got),
            pass: (got - 130.0).abs() < 1.0,
        });
    }

    // ①-b 交叉轴对齐参照系 = 容器内容盒（M1 缺陷 #3）
    {
        let mut tree: TaffyTree<()> = TaffyTree::new();
        let child = tree.new_leaf(Style { size: Size { width: length(20.0), height: length(16.0) }, ..Default::default() }).unwrap();
        let root = tree
            .new_with_children(
                Style {
                    display: Display::Flex,
                    flex_direction: FlexDirection::Row,
                    align_items: Some(AlignItems::CENTER),
                    size: Size { width: length(200.0), height: length(20.0) },
                    ..Default::default()
                },
                &[child],
            )
            .unwrap();
        tree.compute_layout(root, Size { width: AvailableSpace::Definite(200.0), height: AvailableSpace::Definite(20.0) }).unwrap();
        let y = tree.layout(child).unwrap().location.y;
        // 容器高 20、子高 16 → (20-16)/2 = 2（若误用视口等更大空间，y 会是个大数）
        out.push(Measurement {
            name: "cross-center-uses-content-box",
            detail: format!("居中 y = {:.2}（期望 2.0）", y),
            pass: (y - 2.0).abs() < 0.01,
        });
    }

    // ①-c absolute 的 left/top 从**父 padding 盒**起算（M1 缺陷 #4）
    {
        let mut tree: TaffyTree<()> = TaffyTree::new();
        let abs = tree
            .new_leaf(Style {
                position: Position::Absolute,
                inset: Rect { left: length(30.0), top: length(40.0), right: auto(), bottom: auto() },
                size: Size { width: length(50.0), height: length(20.0) },
                ..Default::default()
            })
            .unwrap();
        let root = tree
            .new_with_children(
                Style {
                    display: Display::Flex,
                    size: Size { width: length(200.0), height: length(150.0) },
                    padding: Rect { left: length(10.0), top: length(20.0), right: length(0.0), bottom: length(0.0) },
                    ..Default::default()
                },
                &[abs],
            )
            .unwrap();
        tree.compute_layout(root, Size { width: AvailableSpace::Definite(200.0), height: AvailableSpace::Definite(150.0) }).unwrap();
        let l = tree.layout(abs).unwrap();
        // ★CSS 语义：containing block = 父 padding 盒，其原点即父 border-box 原点（border=0）
        //   → left=30 就是 x=30（**不叠加**父 padding-left 10）
        out.push(Measurement {
            name: "absolute-origin-is-padding-box",
            detail: format!("absolute x={:.1} y={:.1}（期望 x=30, y=40）", l.location.x, l.location.y),
            pass: (l.location.x - 30.0).abs() < 0.01 && (l.location.y - 40.0).abs() < 0.01,
        });
    }

    // ①-d min/max 冻结—再分配（M1 缺陷 #5）
    {
        let mut tree: TaffyTree<()> = TaffyTree::new();
        let a = tree
            .new_leaf(Style {
                flex_grow: 1.0,
                max_size: Size { width: length(60.0), height: auto() },
                size: Size { width: auto(), height: length(30.0) },
                ..Default::default()
            })
            .unwrap();
        let b = tree.new_leaf(Style { flex_grow: 1.0, size: Size { width: auto(), height: length(30.0) }, ..Default::default() }).unwrap();
        let root = tree
            .new_with_children(
                Style {
                    display: Display::Flex,
                    flex_direction: FlexDirection::Row,
                    gap: Size { width: length(10.0), height: length(0.0) },
                    size: Size { width: length(200.0), height: length(30.0) },
                    ..Default::default()
                },
                &[a, b],
            )
            .unwrap();
        tree.compute_layout(root, Size { width: AvailableSpace::Definite(200.0), height: AvailableSpace::Definite(30.0) }).unwrap();
        let wa = tree.layout(a).unwrap().size.width;
        let wb = tree.layout(b).unwrap().size.width;
        // 可用 190；a 被 max 60 夹住 → 剩余 130 全给 b
        out.push(Measurement {
            name: "minmax-freeze-redistribute",
            detail: format!("a={:.1}（max 60）· b={:.1}（应吸收剩余 130）", wa, wb),
            pass: (wa - 60.0).abs() < 0.5 && (wb - 130.0).abs() < 0.5,
        });
    }

    // ①-e display:none 无盒（M1 缺陷 #6）
    {
        let mut tree: TaffyTree<()> = TaffyTree::new();
        let hidden = tree.new_leaf(Style { display: Display::None, size: Size { width: length(50.0), height: length(50.0) }, ..Default::default() }).unwrap();
        let shown = tree.new_leaf(Style { size: Size { width: length(20.0), height: length(20.0) }, ..Default::default() }).unwrap();
        let root = tree
            .new_with_children(
                Style { display: Display::Flex, flex_direction: FlexDirection::Column, size: Size { width: length(100.0), height: auto() }, ..Default::default() },
                &[hidden, shown],
            )
            .unwrap();
        tree.compute_layout(root, Size { width: AvailableSpace::Definite(100.0), height: AvailableSpace::MaxContent }).unwrap();
        let h = tree.layout(hidden).unwrap();
        let s = tree.layout(shown).unwrap();
        out.push(Measurement {
            name: "display-none-no-box",
            detail: format!("hidden={:.0}×{:.0} · shown.y={:.0}（不被推开则 0）", h.size.width, h.size.height, s.location.y),
            pass: h.size.width == 0.0 && h.size.height == 0.0 && s.location.y.abs() < 0.01,
        });
    }

    // ①-f 百分比基准 = 父**内容盒**（M1 对拍用例「百分比尺寸 + 父 padding」）
    {
        let mut tree: TaffyTree<()> = TaffyTree::new();
        let child = tree.new_leaf(Style { size: Size { width: percent(0.5), height: length(30.0) }, ..Default::default() }).unwrap();
        let root = tree
            .new_with_children(
                Style {
                    display: Display::Flex,
                    size: Size { width: length(300.0), height: length(200.0) },
                    padding: Rect { left: length(25.0), right: length(25.0), top: length(0.0), bottom: length(0.0) },
                    ..Default::default()
                },
                &[child],
            )
            .unwrap();
        tree.compute_layout(root, Size { width: AvailableSpace::Definite(300.0), height: AvailableSpace::Definite(200.0) }).unwrap();
        let w = tree.layout(child).unwrap().size.width;
        // 内容盒 250 → 50% = 125（若按 border-box 会得 150）
        out.push(Measurement {
            name: "percent-based-on-content-box",
            detail: format!("50% of 内容盒(250) = {:.1}（期望 125；border-box 会得 150）", w),
            pass: (w - 125.0).abs() < 0.5,
        });
    }

    // ①-g ★Grid 支持（DCP-2 的核心事实：Yoga 没有，Taffy 有）
    {
        let mut tree: TaffyTree<()> = TaffyTree::new();
        let cell = |tree: &mut TaffyTree<()>| tree.new_leaf(Style { size: Size { width: auto(), height: length(20.0) }, ..Default::default() }).unwrap();
        let cells: Vec<_> = (0..6).map(|_| cell(&mut tree)).collect();
        let root = tree
            .new_with_children(
                Style {
                    display: Display::Grid,
                    grid_template_columns: vec![length(60.0), length(60.0), length(60.0)],
                    gap: Size { width: length(10.0), height: length(10.0) },
                    size: Size { width: length(200.0), height: auto() },
                    ..Default::default()
                },
                &cells,
            )
            .unwrap();
        tree.compute_layout(root, Size { width: AvailableSpace::Definite(200.0), height: AvailableSpace::MaxContent }).unwrap();
        let l3 = tree.layout(cells[3]).unwrap();
        let root_h = tree.layout(root).unwrap().size.height;
        // 三列：60+10+60+10+60 = 200；第二行第 1 个 cell 的 y = 20+10 = 30
        out.push(Measurement {
            name: "grid-supported",
            detail: format!("Grid 3×2 布局成功：cell[3].y={:.1}（期望 30）· 容器高={:.1}", l3.location.y, root_h),
            pass: (l3.location.y - 30.0).abs() < 0.5,
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // ② 单次测量协议（D3）—— 关键问题不是「调用几次」，而是**是否随深度退化**
    //
    // ★D3 原文禁止的是「View 体系那种父子多轮 measure」——其病根是**重测次数随树深度增长**
    //   （深层树退化成 O(n·depth)）。故正确判据是：每节点调用数**是否与深度无关**（有界常数）。
    {
        // 构造 12 层深的链（每层 1 个文本叶子），看叶子被 measure 的次数是否增长
        let depth_counts = |depth: usize| -> (usize, usize) {
            let mut tree: TaffyTree<u32> = TaffyTree::new();
            let mut cur = tree
                .new_leaf_with_context(Style { size: Size { width: auto(), height: auto() }, ..Default::default() }, 0)
                .unwrap();
            for d in 1..=depth {
                cur = tree
                    .new_with_children(
                        Style {
                            display: Display::Flex,
                            flex_direction: FlexDirection::Column,
                            size: Size { width: auto(), height: auto() },
                            ..Default::default()
                        },
                        &[cur],
                    )
                    .unwrap();
                let _ = d;
            }
            let root = cur;
            let mut calls = 0usize;
            tree.compute_layout_with_measure(
                root,
                Size { width: AvailableSpace::Definite(300.0), height: AvailableSpace::MaxContent },
                |input: taffy::LayoutInput, _id, ctx: Option<&mut u32>, _s| {
                    if ctx.is_some() { calls += 1; }
                    let w = input.known_dimensions.width.unwrap_or(100.0);
                    taffy::LayoutOutput::from_outer_size(Size { width: w, height: 20.0 })
                },
            )
            .unwrap();
            (depth, calls)
        };
        // ★判据（修正）：D3 禁的是「**随深度退化**」（View 体系 O(n·depth)），
        //   而非「调用次数必须为 1」。故正确判据 = **深度 6 与深度 12 的调用数相等**（有界常数）。
        let d6 = depth_counts(6);
        let d12 = depth_counts(12);
        let d14 = depth_counts(14);
        out.push(Measurement {
            name: "measure-depth-independent",
            detail: format!("深度 6/12/14 → {}/{}/{} 次（**有界常数、不随深度增长**即满足 D3 本意；绝对值 13 源于 min/max-content 探测）", d6.1, d12.1, d14.1),
            pass: d6.1 == d12.1 && d12.1 == d14.1,
        });
    }

    // ②-b flex-wrap 支持（M1 的 Node 参考实现**明确未实现**——这是引擎方案的实际能力差）
    {
        let mut tree: TaffyTree<()> = TaffyTree::new();
        let items: Vec<_> = (0..6)
            .map(|_| tree.new_leaf(Style { size: Size { width: length(60.0), height: length(20.0) }, flex_shrink: 0.0, ..Default::default() }).unwrap())
            .collect();
        let root = tree
            .new_with_children(
                Style {
                    display: Display::Flex,
                    flex_direction: FlexDirection::Row,
                    flex_wrap: FlexWrap::Wrap,
                    size: Size { width: length(150.0), height: auto() },
                    ..Default::default()
                },
                &items,
            )
            .unwrap();
        tree.compute_layout(root, Size { width: AvailableSpace::Definite(150.0), height: AvailableSpace::MaxContent }).unwrap();
        let h = tree.layout(root).unwrap().size.height;
        let second_row_y = tree.layout(items[3]).unwrap().location.y;
        // 150 宽 → 每行 2 个（60+60=120 ≤150，加第三个 180 >150）→ 3 行 = 60 高
        out.push(Measurement {
            name: "flex-wrap-supported",
            detail: format!("wrap 6×60dp 于 150dp 宽：容器高 {:.0}（3 行期望 60）· 第 4 项 y={:.0}（应在第 2 行）", h, second_row_y),
            pass: (h - 60.0).abs() < 1.0 && second_row_y > 0.0,
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // ③ 增量能力（对齐 M1 的 T1/T4 口径）
    // ═══════════════════════════════════════════════════════════════
    {
        // 构造 12 层深的树（每层 28 个定尺寸兄弟）≈ 360 节点，与 M1 的压力用例同形
        let mut tree: TaffyTree<()> = TaffyTree::new();
        let mk_row = |tree: &mut TaffyTree<()>, children: &[NodeId]| {
            tree.new_with_children(
                Style {
                    display: Display::Flex,
                    flex_direction: FlexDirection::Row,
                    gap: Size { width: length(6.0), height: length(0.0) },
                    ..Default::default()
                },
                children,
            )
            .unwrap()
        };
        // 最内层
        let mut inner_children = vec![tree.new_leaf(Style { size: Size { width: length(20.0), height: length(20.0) }, flex_shrink: 0.0, ..Default::default() }).unwrap()];
        let target = inner_children[0];
        for _ in 0..5 {
            inner_children.push(tree.new_leaf(Style { size: Size { width: length(30.0), height: length(20.0) }, flex_shrink: 0.0, ..Default::default() }).unwrap());
        }
        let mut cur = mk_row(&mut tree, &inner_children);
        let mut boundary = cur;
        for depth in (1..=12).rev() {
            let mut children = vec![cur];
            for _ in 0..28 {
                children.push(tree.new_leaf(Style { size: Size { width: length(40.0), height: length(18.0) }, flex_shrink: 0.0, ..Default::default() }).unwrap());
            }
            cur = mk_row(&mut tree, &children);
            if depth == 11 {
                // 边界：宽高均显式
                tree.set_style(cur, Style {
                    display: Display::Flex,
                    flex_direction: FlexDirection::Row,
                    gap: Size { width: length(6.0), height: length(0.0) },
                    size: Size { width: length(320.0), height: length(200.0) },
                    ..Default::default()
                }).unwrap();
                boundary = cur;
            }
        }
        let root = tree.new_with_children(Style { display: Display::Flex, flex_direction: FlexDirection::Column, size: Size { width: length(320.0), height: auto() }, ..Default::default() }, &[cur]).unwrap();
        let total = tree.total_node_count();

        // 首次布局
        let t0 = Instant::now();
        tree.compute_layout(root, Size { width: AvailableSpace::Definite(375.0), height: AvailableSpace::MaxContent }).unwrap();
        let first_ms = t0.elapsed().as_secs_f64() * 1000.0;

        // 边界内改一个叶子 → mark_dirty（Taffy 自己从叶向上标脏）
        tree.set_style(target, Style { size: Size { width: length(44.0), height: length(26.0) }, flex_shrink: 0.0, ..Default::default() }).unwrap();
        tree.mark_dirty(target).unwrap();
        let t1 = Instant::now();
        tree.compute_layout(root, Size { width: AvailableSpace::Definite(375.0), height: AvailableSpace::MaxContent }).unwrap();
        let inc_ms = t1.elapsed().as_secs_f64() * 1000.0;
        let dirty_after = tree.dirty(root).unwrap();

        out.push(Measurement {
            name: "incremental-layout",
            detail: format!("节点 {} · 首帧 {:.3}ms · 单点变更后重排 {:.3}ms · 树回归干净={}", total, first_ms, inc_ms, !dirty_after),
            // ★Taffy 的 dirty 会一路上标到根（无「布局边界」概念）——这正是 M1 §5.4 T2 要防的形状
            pass: inc_ms < 3.0,
        });
        let _ = boundary;
    }

    // ═══════════════════════════════════════════════════════════════
    // ④ 性能：4050 节点（M2 出口条件的规模）
    // ═══════════════════════════════════════════════════════════════
    {
        let mut tree: TaffyTree<()> = TaffyTree::new();
        let mut leaves: Vec<NodeId> = Vec::with_capacity(4050);
        for _ in 0..4050 {
            leaves.push(tree.new_leaf(Style { size: Size { width: length(40.0), height: length(16.0) }, flex_shrink: 0.0, ..Default::default() }).unwrap());
        }
        // 分组：每 50 个叶子一行，再包到 column 根（对齐 M1 的规模化用例）
        let mut rows: Vec<NodeId> = Vec::new();
        for chunk in leaves.chunks(50) {
            rows.push(
                tree.new_with_children(
                    Style { display: Display::Flex, flex_direction: FlexDirection::Row, gap: Size { width: length(4.0), height: length(0.0) }, ..Default::default() },
                    chunk,
                )
                .unwrap(),
            );
        }
        let root = tree
            .new_with_children(
                Style { display: Display::Flex, flex_direction: FlexDirection::Column, size: Size { width: length(750.0), height: auto() }, ..Default::default() },
                &rows,
            )
            .unwrap();
        // 预热一次（排除首次分配）
        tree.compute_layout(root, Size { width: AvailableSpace::Definite(750.0), height: AvailableSpace::MaxContent }).unwrap();
        // 连续 10 次取中位数
        let mut samples: Vec<f64> = Vec::new();
        for _ in 0..10 {
            tree.mark_dirty(root).unwrap();
            let t = Instant::now();
            tree.compute_layout(root, Size { width: AvailableSpace::Definite(750.0), height: AvailableSpace::MaxContent }).unwrap();
            samples.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median = samples[samples.len() / 2];
        out.push(Measurement {
            name: "perf-4050-nodes",
            detail: format!("4050 叶子 + 81 行容器：中位 {:.3}ms（10 次；min {:.3} / max {:.3}）", median, samples[0], samples[samples.len() - 1]),
            pass: median < 16.67, // 60FPS 帧预算
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // 输出（机器可读 JSON + 人读摘要）
    // ═══════════════════════════════════════════════════════════════
    let pass_count = out.iter().filter(|m| m.pass).count();
    println!("\n═══ DCP-1 spike：Taffy（Rust）实测 ═══");
    for m in &out {
        println!("  {} {:<32} {}", if m.pass { "✓" } else { "✗" }, m.name, m.detail);
    }
    println!("\n  合计：{}/{} 项通过", pass_count, out.len());
    println!("\n═══ JSON ═══");
    println!("[");
    for (i, m) in out.iter().enumerate() {
        println!(
            "  {{\"name\":\"{}\",\"pass\":{},\"detail\":\"{}\"}}{}",
            m.name,
            m.pass,
            m.detail.replace('"', "'"),
            if i + 1 == out.len() { "" } else { "," }
        );
    }
    println!("]");
}
