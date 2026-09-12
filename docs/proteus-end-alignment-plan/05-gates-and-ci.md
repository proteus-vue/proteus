# 05 · 门禁与 CI 接入

## 1. 门禁清单

| 门禁 | 实现 | 检查内容 | 状态 |
|---|---|---|---|
| **标尺快照一致性** | `gen-mp-component-attrs.mjs --check` | 快照与官方是否脱节（漂移 exit 1） | ⬜ 待接入 CI |
| **属性覆盖门禁** | `tests/mp-component-attrs.test.ts` | p-button ≥90% / p-input 核心属性齐 | ✅ 已落地 |
| **全量覆盖阈值** | `audit-component-attrs.mjs --min <pct>` | 全局覆盖率不低于棘轮底线 | ✅ 已落地（`--min 99`） |
| **★页面渲染门禁** | `test:e2e:showcase`（`assertPageRendered`） | 每个演示页**元素真实可见**（非空白/非塌陷/整体不消失）+ 关键交互有反馈 | ✅ 已落地并接入 verify |
| **降级声明门禁** | （M6） | 每个属性须声明三态（EA-5） | ⬜ M6 |
| **IR 契约门禁** | `audit.ts` 既有 | props 语义约束与组件一致 | 🔶 部分 |

### 1.1 ★页面渲染门禁（2026-09-13 新增，实测教训驱动）

**背景**：E2E 此前只断言「路由到了 / data 对不对 / 某元素文本」——**没有断言「元素在视觉上可见」**。后果：
- `p-button` 在 Web 端因缺 `style.css` 而塌陷不可见，全部门禁绿却人眼可见故障；
- 系统暗色下框架媒体查询压过页面主题化 → **浅色卡片上按钮白底白字、整体"消失"**，门禁依然全绿。

**机制**：`@proteus-vue/test-core` 的 `assertPageRendered(driver, opts)`（跨端：Web 用 DOM `getBoundingClientRect`+`getComputedStyle`；MP 用 `selectorQuery.boundingClientRect`）：

```ts
await assertPageRendered(driver, {
  keySelector: 'button',
  minVisible: 1,          // 至少 1 个可见
  expectedCount: 10,      // ★元素总数低于预期即红（抓「整体消失」——minVisible=1 抓不住）
  minVisibleRatio: 1,     // ★可见占比下限（抓「大部分不可见」）
  minContrast: 1.5,       // ★前景/背景对比度下限（抓「有尺寸但看不清」——白底白字 ratio≈1）
  assertNoErrors: true,   // 无 console error
})
```

失败抛带度量明细的错误（含不可见元素示例：宽高/display/visibility）。破坏性验证：`tests/render-gate.test.ts`（空白页/零尺寸/总数不足/占比不足/console 错误 均须被判定）。

**铁律**：演示页每页除渲染门禁外，**关键交互组件须有交互断言**（如 p-button：按下背景变化 + disabled 不可点 + loading 期间禁用）。**"能截图"不等于"渲染正确"**——两端的静态+动态都要真机/真实浏览器核验。

## 2. 棘轮（Ratchet）机制（★防退化）

属性覆盖率**只许升不许降**——记录当前水位，CI 校验不低于水位：

```jsonc
// docs/generated/alignment-ratchet.json
{
  "attrCovered": 99,
  "attrTotal": 352,
  "coveredMin": 99,               // CI：covered >= coveredMin，否则红
  "note": "只增不减；补齐后上调 coveredMin"
}
```

**理由**：本项目已踩过"手写矩阵自证同义反复"的坑（矩阵不写就永不红）；棘轮机制确保**已补齐的不会回退**。

## 3. CI 接入（`package.json` scripts）

```jsonc
{
  "check:mp-attrs": "node scripts/gen-mp-component-attrs.mjs --check && node scripts/audit-component-attrs.mjs --min 99",
  "check:mp-spec": "node scripts/gen-mp-spec.mjs --check",  // 已有
  "test:e2e:showcase": "pnpm run build:showcase:web && vitest run --no-file-parallelism tests/e2e-showcase-render.test.ts"
}
```

`verify` 链追加 `check:mp-attrs` 与 `test:e2e:showcase`（渲染门禁需先 `build:showcase:web` 产物）。

**注意**：`--check` 依赖网络（抓官方文档）。CI 无网时：**用快照比对**（读已提交快照，不抓官方），漂移只在本地/定时任务检测。

## 4. 门禁的破坏性自检（反黑盒要求）

每个门禁必须有**破坏性验证用例**（注入假缺口 → 必须报错）：

```ts
it('（破坏性验证）覆盖度算法能识别缺失', () => {
  const r = covered('button', 'p-button')
  const fake = [...r.miss, 'totally-fake-attr']
  expect(fake.length).toBeGreaterThan(r.miss.length - 1)  // 算法确实在算
})
```

> 既有先例：`tests/mp-spec-coverage` 的破坏性用例（幽灵组件注入被拦截）。

## 5. 与既有门禁的关系

| 既有门禁 | 层级 | 本计划的关系 |
|---|---|---|
| `audit:coverage`（G-32.5 语义覆盖） | 语义 | 本计划是它的**属性级下沉** |
| `check:mp-spec`（组件名/API 名） | 名称 | 本计划补**属性级** |
| `CMP006`（能力属性降级） | 能力 | 本计划扩展到**组件属性降级**（M6） |
| `auditSemanticCoverage`（IR 一致性） | IR | 本计划第 4 步同步更新 IR props |
