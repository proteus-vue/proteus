# Themis 引擎 · 对外数字（自动生成——勿手改）

> 生成器 `scripts/gen-css-engine-numbers.mjs`；漂移门禁 `pnpm check:css-engine-numbers`。
> 官网 `/themis` 页与《Themis 白皮书》§6 均只读本件（`docs/generated/css-engine-numbers.json`）。

| 指标 | 数值 | 来源 |
|---|---|---|
| StyleIR 字段（闭集·版本化） | **108**（semantic 82 · engine-only 26） | STYLE_IR_SUMMARY |
| 判据①-b 逐属性对拍 | **113** 用例 / **153** 项 ≡ 真 Chromium | PARITY_CASES（夹具） |
| M1 数值一致性覆盖率 | **65.45%**（并集 82/82） | consistency-metrics.json |
| 判据② 几何等价阈值 | **≤ 0.5 dp**（App ≡ Web）· 结构类容差 ≤1px / ≤0.5% | appliers-conformance.test.ts / tolerance.ts |
| Profile lint 存量（棘轮） | **118**（examples 25 · showcase 26 · css-conformance 25 · website 42） | cse-lint-baseline.json |
| 三端能力对齐矩阵 | **79** 行 × **3** 端（web / skyline / app） | css-capability-alignment.json |
| CSS 能力清单（Web 全量） | **949** 项（implemented 144 · actionable 525 · P0 0） | css-feature-inventory.json |

> ★「113 用例 / 153 项」为**测试夹具静态计数**（与 `tests/e2e-cse-parity.test.ts` 运行时同源）；
> ≤undefineddp 为 `tolerance.ts` 的**承诺值**，非计数。
