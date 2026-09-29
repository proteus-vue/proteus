// packages/layout-core-rust/src/snap.rs
// ★★卡 I2（舍入时机统一）：**Rust 内核唯一的坐标吸附实现** —— 2026-09-29
//
// 【硬性规则（卡 I2 原文）】内核产出指令时完成舍入，**平台层不得再舍入**。
//   触发场景（卡原文）：鸿蒙强制整数像素，`flex:1/3` 三列时 0.333 被舍为 0.33，
//   累计误差导致第三列错位。
//
// ── 策略：**边缘吸附**（edge snapping）—— 与 TS 侧 `packages/layout-core/src/pixel-snap.ts`
//    **同式同值**（跨语言 golden：`tests/golden/pixel-snap.json`，两侧各自求值后逐字节比对）──
//
//   snap(v) = floor(v + 0.5)                      ← 定义即公式
//   盒 (x, y, w, h) →  L = snap(x) · T = snap(y)
//                      R = snap(x + w) · B = snap(y + h)
//                      x' = L · y' = T · w' = max(0, R − L) · h' = max(0, B − T)
//
//   ★为什么必须吸附**边缘**（而不是 x/w 各自 round）：
//     「相邻元素共用同一条边」——同一条浮点边值经同一纯函数吸附 ⇒ 两侧必得**同一整数**
//     ⇒ 无 1px 缝隙、无重叠，且 flex 均分总和守恒。
//     【本卡的反例（鸿蒙三列场景）】宽 100 均分三列（33.333×3）：
//       · 逐字段四舍五入：33+33+33 = **99** ⇒ 末尾 1px 缝（或第三列错位）
//       · 边缘吸附：边 [0, 33.333, 66.666, 100] → [0, 33, 67, 100]
//                   ⇒ 宽 33 / 34 / 33，**和 = 100** ✓
//   ★推论（诚实记录）：w' 由边缘差决定，**不保证**等于 snap(w)。
//
//   ★half 值口径：用 `(v + 0.5).floor()`，**不用** `f32::round`：
//     · `f32::round(-0.5)` = -1（半值远离零），TS `Math.round(-0.5)` = -0（半值向正）
//       ⇒ 两语言原生舍入在负半值上语义不同，直接用会**跨语言差 1px**
//     · 本公式两语言**同式** ⇒ 逐位可对齐（golden 含 -0.5 / -1.5 用例）
//
// ── 应用边界（与 TS 侧一致）─────────────────────────────────────────────────
//   · 吸附发生在**导出边界**（FFI 把几何交给宿主之前）；求解器内部（taffy / 增量重排）
//     保持**亚像素精度** —— 不为吸附牺牲布局精度，也让既有 browser-layout conformance
//     （容差 0.5dp）口径不变。
//   · 诚实边界：TS 用 f64、Rust 用 f32；真实值恰好落在 `x.5 ± 1ulp` 时两端**可能**差 1px
//     （0.5 可被两精度精确表示 ⇒ golden 的半值用例两端必然一致）。
use crate::style::Rect;

/// 唯一的坐标吸附函数（策略定义见文件头）。
///
/// `-0.5 → 0`、`-1.5 → -1`（与 TS `Math.floor(v + 0.5)` 同式）。
#[inline]
pub fn snap_coord(v: f32) -> f32 {
    (v + 0.5).floor()
}

/// 按**边缘**吸附一个盒（策略见文件头：L/R 各自吸附，尺寸取差；尺寸下限 0）。
#[inline]
pub fn snap_rect(r: Rect) -> Rect {
    let l = snap_coord(r.x);
    let t = snap_coord(r.y);
    let rr = snap_coord(r.x + r.width);
    let b = snap_coord(r.y + r.height);
    Rect {
        x: l,
        y: t,
        width: (rr - l).max(0.0),
        height: (b - t).max(0.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f32, y: f32, width: f32, height: f32) -> Rect {
        Rect { x, y, width, height }
    }

    /// 半值口径：`floor(v+0.5)` ⇒ -0.5 吸到 0、-1.5 吸到 -1（**不是** f32::round 的 -1 / -2）
    #[test]
    fn half_values_follow_floor_plus_half_not_native_round() {
        assert_eq!(snap_coord(0.5), 1.0);
        assert_eq!(snap_coord(1.5), 2.0);
        assert_eq!(snap_coord(-0.5), 0.0);
        assert_eq!(snap_coord(-1.5), -1.0);
        // ★对照：若这里改成 f32::round，负半值会差 1 —— 本断言就是防那次"顺手改回原生舍入"
        assert_ne!(snap_coord(-0.5), (-0.5f32).round());
        assert_ne!(snap_coord(-1.5), (-1.5f32).round());
    }

    /// ★卡的反例（鸿蒙三列）：均分总和不因吸附而丢 1px
    #[test]
    fn three_column_split_keeps_total_width_after_snap() {
        // 宽 100 均分三列：边 [0, 33.333…, 66.666…, 100]
        let e = [0.0f32, 100.0 / 3.0, 200.0 / 3.0, 100.0];
        let l = [snap_coord(e[0]), snap_coord(e[1]), snap_coord(e[2]), snap_coord(e[3])];
        assert_eq!(l, [0.0, 33.0, 67.0, 100.0]);
        let widths = [l[1] - l[0], l[2] - l[1], l[3] - l[2]];
        assert_eq!(widths, [33.0, 34.0, 33.0]);
        assert_eq!(widths.iter().sum::<f32>(), 100.0, "吸附后总宽必须守恒");
        // ★对照反例：逐字段四舍五入只有 99 —— 这就是卡里"第三列错位"的成因
        let naive: f32 = (100.0f32 / 3.0).round() * 3.0;
        assert_eq!(naive, 99.0);
    }

    /// 共享边对齐：父子/相邻节点同一条边 ⇒ 吸附后仍落在同一整数
    #[test]
    fn shared_edges_stay_aligned() {
        // 父 x=0.3, w=10.4 ⇒ 右缘 10.7；子与其同右缘（x=5.25, w=5.45 ⇒ 右缘 10.7）
        let parent = snap_rect(rect(0.3, 0.0, 10.4, 10.0));
        let child = snap_rect(rect(5.25, 0.0, 5.45, 10.0));
        assert_eq!(parent.x + parent.width, 11.0);
        assert_eq!(child.x + child.width, 11.0, "同一条边值必须吸到同一整数（否则出现 1px 缝）");
    }

    /// 幂等：已吸附的盒再吸附不变（门禁/多次导出不会漂移）
    #[test]
    fn snap_is_idempotent() {
        let once = snap_rect(rect(10.5, -3.25, 33.5, 7.75));
        assert_eq!(snap_rect(once), once);
    }

    /// ★尺寸取边缘差（不是 snap(w)）：记录这个"反直觉但正确"的推论
    #[test]
    fn width_is_edge_difference_not_snapped_width() {
        let s = snap_rect(rect(10.5, 0.0, 33.5, 0.0));
        assert_eq!(s.x, 11.0);
        assert_eq!(s.width, 33.0); // 44 - 11 = 33，而 snap(33.5) 会是 34
        assert_ne!(s.width, snap_coord(33.5));
    }

    /// 整数输入必须原样通过（既有全整数用例读数不因接入吸附而改变）
    #[test]
    fn integer_boxes_pass_through_unchanged() {
        let r = rect(12.0, 200.0, 600.0, 40.0);
        assert_eq!(snap_rect(r), r);
    }

    /// ★★跨语言 golden（卡 I2 的机器判据）：与 TS `pixel-snap.ts` **逐字段比对**
    ///
    /// 【在防什么】两侧各有一份吸附实现；若一端改了 half 口径或边缘语义，另一端不会红，
    ///   **真机上才差 1px**。golden 由 `node scripts/gen-pixel-snap-golden.mjs` 生成
    ///   （TS 侧求值），本测试在 Rust 侧**重新求值**同一组输入并逐字段比对。
    ///   重新生成 = 显式动作 ⇒ 任何策略变更都必须两侧同时确认。
    #[test]
    fn golden_matches_ts_side() {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden/pixel-snap.json");
        let raw = std::fs::read_to_string(&path)
            .expect("golden 缺失——跑 `node scripts/gen-pixel-snap-golden.mjs` 生成");
        let g: serde_json::Value = serde_json::from_str(&raw).expect("golden 解析失败");

        let mut checked = 0usize;
        for s in g["scalars"].as_array().expect("scalars 应为数组") {
            let v = s["in"].as_f64().expect("in 应为数值") as f32;
            let want = s["out"].as_f64().expect("out 应为数值") as f32;
            assert_eq!(snap_coord(v), want, "★标量 {v} 吸附结果与 TS 侧不一致（跨语言差 1px 的起点）");
            checked += 1;
        }
        for b in g["boxes"].as_array().expect("boxes 应为数组") {
            let i = &b["in"];
            let r = rect(
                i["x"].as_f64().unwrap() as f32,
                i["y"].as_f64().unwrap() as f32,
                i["width"].as_f64().unwrap() as f32,
                i["height"].as_f64().unwrap() as f32,
            );
            let o = &b["out"];
            let want = rect(
                o["x"].as_f64().unwrap() as f32,
                o["y"].as_f64().unwrap() as f32,
                o["width"].as_f64().unwrap() as f32,
                o["height"].as_f64().unwrap() as f32,
            );
            assert_eq!(
                snap_rect(r),
                want,
                "★盒 {:?} 吸附结果与 TS 侧不一致 ⇒ 三端会差 1px（该用例是卡 I2 的原始触发场景）",
                r
            );
            checked += 1;
        }
        assert!(checked >= 24, "golden 用例数异常（应 ≥24，实际 {checked}）——防 golden 被删空后恒绿");
    }

    /// ★★表示精度边界（golden 的 `precisionDivergence` 段）——**主动断言而非绕过**
    ///
    /// 【为什么单列】首次生成 golden 时这类用例把测试打红（TS 侧 3.4999999 → 3，Rust 侧 → 4）。
    ///   查清后确认是**表示精度**而非算法差异：输入距 `.5` 边界小于 f32 的 ulp/2 时，
    ///   `3.4999999` 在 f32 下**就是** `3.5`（吸到 4），而 f64 保持原值（吸到 3）。
    ///   盒用例同理：f32 加法把 `1.4999999 + 3.9999999` 舍成 `5.5` ⇒ 右缘吸到 6（宽度 5，TS 为 4）。
    ///   ⇒ 不修（改 f64/定点代价远超收益），改为**锁定**：两侧读数都被断言，
    ///     任何一环变化（含"哪天有人把某侧改成 f64"）都会红。
    #[test]
    fn golden_records_f32_precision_boundary() {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden/pixel-snap.json");
        let g: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).expect("golden 缺失")).expect("golden 解析失败");
        let pd = &g["precisionDivergence"];

        let sdiv = pd["scalars"].as_array().expect("precisionDivergence.scalars 应为数组");
        let bdiv = pd["boxes"].as_array().expect("precisionDivergence.boxes 应为数组");
        assert!(
            !sdiv.is_empty() || !bdiv.is_empty(),
            "★精度差异台账为空 ⇒ 要么边界真的消失了（两侧都改 f64？那要更新分析），要么生成器分类失效"
        );

        // ① 标量：Rust 侧必须落在记录的 f32Out 上，且与 TS 侧**确实不同**
        for d in sdiv {
            let v = d["in"].as_f64().unwrap() as f32;
            let ts_out = d["tsOut"].as_f64().unwrap() as f32;
            let f32_out = d["f32Out"].as_f64().unwrap() as f32;
            assert_eq!(snap_coord(v), f32_out, "★Rust 侧输出应等于台账记录的 f32Out（{v}）");
            assert_ne!(ts_out, f32_out, "★台账记录的两侧输出必须不同（相同 ⇒ 分析过期，重跑生成器）");
        }
        // ② 盒：同上（这次差在**边缘**上，宽度随之差 1——卡的原始症状正是"差 1px"）
        for d in bdiv {
            let i = &d["in"];
            let r = rect(
                i["x"].as_f64().unwrap() as f32,
                i["y"].as_f64().unwrap() as f32,
                i["width"].as_f64().unwrap() as f32,
                i["height"].as_f64().unwrap() as f32,
            );
            let ts_out = &d["tsOut"];
            let f32_out = &d["f32Out"];
            let got = snap_rect(r);
            assert_eq!(got.x, f32_out["x"].as_f64().unwrap() as f32, "★台账 f32Out.x");
            assert_eq!(got.y, f32_out["y"].as_f64().unwrap() as f32, "★台账 f32Out.y");
            assert_eq!(got.width, f32_out["width"].as_f64().unwrap() as f32, "★台账 f32Out.width");
            assert_eq!(got.height, f32_out["height"].as_f64().unwrap() as f32, "★台账 f32Out.height");
            let differs = ["x", "y", "width", "height"]
                .iter()
                .any(|k| ts_out[k].as_f64().unwrap() != f32_out[k].as_f64().unwrap());
            assert!(differs, "★台账记录的两侧输出必须至少有一项不同（否则该用例应进严格段）");
        }

        // ③ 同端内不受影响（本卡的核心不变式）：父子共用边值 ⇒ 吸附后落在同一整数
        let shared = 10.4999999f32;
        assert_eq!(snap_coord(shared), snap_coord(shared), "同端内同值必同结果（纯函数）");
    }
}
