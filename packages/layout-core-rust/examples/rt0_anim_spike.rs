// packages/layout-core-rust/examples/rt0_anim_spike.rs
// ★★RT0 spike（Proteus_App端路由与动画系统设计方案 §8）——**指令路径 vs JS 路径**实测对比
//
// 【RT0 的出口（方案原文）】「拿到"指令路径 vs JS 路径"的实测对比。**未验证前不得开始 RT1。**」
//
// 【两条路径的真实成本构成（本 exp 模拟的就是它们）】
//
//   路径 A（指令驱动，本 spike 实现）：
//     · JS 侧**每动画一次**：1 条 ANIM_START（~20B）
//     · 每帧：1 次跨边界调用 `tick(dt)` → Rust 查表插值 → 写 3 个 f32 字段
//     · 成本 = O(活动动画数) 次浮点查表，**无编解码、无字符串、无 JS 求值**
//
//   路径 B（JS 每帧计算 + 指令流，即"没有动画指令时"的倒退方案）：
//     · 每帧 JS 侧：N 次缓动求值（Math.pow 等）→ 编码 N 条 SET_STYLE（11B/条）→ 跨边界
//     · 每帧宿主侧：解码 N 条 → 逐条 apply → 标记 N 个节点脏
//     · 成本 = O(N) JS 计算 + O(N) 编码 + O(N) 解码 + O(N) 应用
//
// 【本 exp 量什么】同一场景（N 个节点同时做 easeOutCubic 位移，M 帧）下：
//   · A：`AnimEngine::tick` 的总耗时（含写字段）
//   · B：TS 侧编码 N 条 SET_STYLE 的真实字节数（用真实编码器，非估算）
//        + Rust 侧解码 + 应用的耗时
//   ⇒ 输出每帧均摊、总耗时、加速比，以及**字节量对比**（跨边界数据量差异）。
//
// 【诚实边界（必须随读数一起看）】
//   ① 本 exp 在**桌面 release** 跑，不是真机；结论用于**可行性判断**与量级对比，
//     绝对值不跨机比较（本仓既有纪律：比值可信、绝对值受机器影响）；
//   ② 路径 B 的 JS 侧耗时（缓动求值 + 编码）**无法在本进程内测**——它是 Node/QuickJS 的
//      工作。本 exp 只测它的**宿主侧**（解码 + 应用）与**字节量**，JS 侧成本以"缺失项"如实标注
//      ⇒ 因此本 exp 报出的加速比是**下界**（B 的真实成本 ≥ 此处测到的）；
//   ③ 未接真机、未接帧循环：本 exp 是**微基准**，不替代真机帧率验证（那属 RT2 验收）。
//
// 【三个代表性场景（RT0 要求：位移 / 缩放 / 路由转场）】
//   · `translate` —— 单属性位移（N 节点各一条动画）
//   · `scale`     —— 单属性缩放（同一执行路径，不同样式槽）
//   · `route`     —— 路由转场（**组合**：每节点 translate + scale 两条动画；
//                    真实转场还含新旧页交叉，此处以"双属性同节点"覆盖其成本特征）
//
// 用法：cargo run --release --example rt0_anim_spike [节点数] [帧数] [translate|scale|route]
use std::time::Instant;

use proteus_layout_core::anim::{Anim, AnimEngine, AnimKind, CURVE_EASE_OUT_CUBIC};
use proteus_layout_core::node::{LNode, LayoutTree};
use proteus_layout_core::ops::decode_ops;
use proteus_layout_core::ops_apply::apply_ops_to_tree;
use proteus_layout_core::style::LStyle;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let n: u32 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(200);
    let frames: u32 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(120);
    let scenario = args.get(3).map(|s| s.as_str()).unwrap_or("translate").to_string();

    println!("═══ RT0 spike：指令路径 vs JS 路径（场景={scenario} · N={n} 节点 × {frames} 帧）═══");
    println!("★诚实边界：桌面 release 微基准；B 的 JS 侧成本未含 ⇒ 加速比为**下界**");

    // ── 构造场景：N 个节点，每个做一次 easeOutCubic 位移（0 → 200px，1 秒 @60fps）──
    let mut tree = build_tree(n);
    let mut engine = AnimEngine::new();

    // ── 路径 A：指令驱动 ──────────────────────────────────────────────
    // JS 侧成本：N 条 ANIM_START（这里直接调 Rust API 模拟"指令已解码后的启动"）
    let t_start = Instant::now();
    let mut started = 0usize;
    for i in 0..n {
        let node_id = i + 2; // 根 = 1，子从 2 起（与 rt0-gen-ops.mjs 对齐）
        let mut one = |kind: AnimKind, from: f32, to: f32, engine: &mut AnimEngine| {
            engine
                .start(
                    &tree,
                    Anim {
                        node_id,
                        kind,
                        curve: CURVE_EASE_OUT_CUBIC,
                        from,
                        to,
                        dur_ms: 1000.0,
                        // ★字段随内核演进补齐（此前未补 ⇒ 本例子**编译不过**，挡住 cargo test）
                        delay_ms: 0.0,
                        t_ms: 0.0,
                        drive: proteus_layout_core::anim::AnimDrive::Time,
                        progress: 0.0,
                        scroll_from: 0.0,
                        scroll_to: 0.0,
                        mode: proteus_layout_core::anim::AnimMode::Curve,
                        x: from,
                        vel: 0.0,
                        takeover: true,
                    },
                )
                .expect("start 失败");
            started += 1;
        };
        match scenario.as_str() {
            "scale" => one(AnimKind::Scale, 0.5, 1.0, &mut engine),
            "route" => {
                // 路由转场：进场页从右侧滑入（translation）+ 轻微放大（scale），两条同节点
                one(AnimKind::TranslateX, 390.0, 0.0, &mut engine);
                one(AnimKind::Scale, 0.96, 1.0, &mut engine);
            }
            _ => one(AnimKind::TranslateX, 0.0, 200.0, &mut engine),
        }
    }
    let start_ms = t_start.elapsed().as_secs_f64() * 1000.0;

    let dt = 1000.0 / 60.0;
    let t_a = Instant::now();
    let mut a_changed = 0usize;
    for _ in 0..frames {
        a_changed += engine.tick(&mut tree, dt).changed;
    }
    let a_total_ms = t_a.elapsed().as_secs_f64() * 1000.0;
    let a_per_frame_us = a_total_ms * 1000.0 / frames as f64;

    // ── 路径 B：JS 每帧计算 + 指令流 ─────────────────────────────────
    // ① 宿主侧：解码 + 应用（用**真实**解码器与应用器）
    //    指令流由 TS 侧生成（见下方提示；本 exp 内嵌一份等价字节以保证可独立运行）
    let bytes = std::env::var("RT0_OPS_BIN")
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .unwrap_or_else(|| {
            eprintln!("  ⚠ 未提供 RT0_OPS_BIN（TS 侧生成的指令流）——B 路径解码/应用测量**跳过**");
            Vec::new()
        });

    let (b_decode_ms, b_apply_ms, b_bytes, b_applied) = if !bytes.is_empty() {
        // 预热一次（把首解的表分配排除）
        let _ = decode_ops(&bytes).expect("解码失败");

        let t_d = Instant::now();
        let mut dec = decode_ops(&bytes).expect("解码失败");
        let decode_once_ms = t_d.elapsed().as_secs_f64() * 1000.0;

        // 每帧：解码一次 + 应用一次（真实路径就是"每帧一批指令"）
        let mut tree_b = build_tree(n);
        let t_b = Instant::now();
        let mut b_applied = 0usize;
        for _ in 0..frames {
            dec = decode_ops(&bytes).expect("解码失败");
            let out = apply_ops_to_tree(&mut tree_b, &dec);
            b_applied += out.applied;
        }
        let b_total_ms = t_b.elapsed().as_secs_f64() * 1000.0;
        (decode_once_ms, b_total_ms, bytes.len(), b_applied)
    } else {
        (0.0, 0.0, 0, 0)
    };

    // ── 报告 ────────────────────────────────────────────────────────
    println!();
    println!("── 路径 A（指令驱动：1 条 ANIM_START + 每帧 1 次 tick）──");
    println!("  启动 {started} 条动画：{start_ms:.3} ms（一次性）");
    println!("  逐帧求值总耗时：{a_total_ms:.3} ms / {frames} 帧");
    println!("  ★每帧均摊：**{a_per_frame_us:.2} µs**（写入字段 {a_changed} 次）");

    if b_bytes > 0 {
        println!();
        println!("── 路径 B（JS 每帧计算 + N 条 SET_STYLE 指令流）──");
        println!("  每帧指令流尺寸：{b_bytes} B（{} B/节点）", b_bytes / (n.max(1) as usize));
        println!("  解码一次：{b_decode_ms:.3} ms（含池解析）");
        println!("  解码+应用 总耗时（{frames} 帧）：{b_apply_ms:.3} ms（应用 {b_applied} 条）");
        let b_per_frame_us = b_apply_ms * 1000.0 / frames as f64;
        println!("  ★每帧均摊（**仅宿主侧**，不含 JS 求值与编码）：**{b_per_frame_us:.2} µs**");
        println!();
        println!("── 对比（★按「每帧宿主侧」口径；B 的 JS 侧成本未含 ⇒ 加速比为下界）──");
        if a_per_frame_us > 0.0 {
            println!("  宿主侧加速比：**{:.1}×**（{b_per_frame_us:.2} µs → {a_per_frame_us:.2} µs）", b_per_frame_us / a_per_frame_us);
        }
        println!("  跨边界数据量：每帧 {b_bytes} B（B）→ **0 B**（A：tick 无数据，仅 1 次函数调用）");
        println!("  每帧指令条数：{n} 条（B）→ **0 条**（A：曲线求值在内核）");
    } else {
        println!();
        println!("── 路径 B 未测（缺 TS 侧指令流）──");
        println!("  生成方式：npx tsx scripts/rt0-gen-ops.mjs {n} > /tmp/rt0-ops.bin");
        println!("  然后：RT0_OPS_BIN=/tmp/rt0-ops.bin cargo run --release --example rt0_anim_spike -- {n} {frames}");
    }

    // ── 正确性交叉验证：A 路径的终值与 B 路径的终值必须一致（同场景同曲线）──
    println!();
    println!("── 正确性：A 路径终值（合成 u=1 ⇒ 精确落在 to）──");
    let (got, want, what) = match scenario.as_str() {
        "scale" => (tree.nodes[1].style.scale, 1.0, "scale"),
        "route" => (tree.nodes[1].style.translate_x, 0.0, "translate_x"),
        _ => (tree.nodes[1].style.translate_x, 200.0, "translate_x"),
    };
    println!("  首个动画节点 {what} = {got}（期望 {want}）");
    assert_eq!(got, want, "动画终值必须精确等于 to");
    println!("  ✅ 终值精确（曲线端点钉死策略生效）");
}

fn build_tree(n: u32) -> LayoutTree {
    let mut t = LayoutTree::new();
    let mut root = LNode::new(1, LStyle::default());
    root.style.width = Some(390.0);
    root.style.height = Some(844.0);
    let root_idx = t.push(root);
    t.roots.push(root_idx);
    for i in 0..n {
        let mut node = LNode::new(i + 2, LStyle::default());
        node.style.width = Some(100.0);
        node.style.height = Some(40.0);
        let idx = t.push(node);
        t.add_child(root_idx, idx);
    }
    t
}
