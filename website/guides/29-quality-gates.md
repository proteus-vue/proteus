---
title: 质量门禁：一键检测不规范代码
order: 29
group: 架构与工程
---

# 质量门禁：一键检测不规范代码

Proteus 的门禁系统帮你把「不符合框架规范」的代码**在构建/CI 前就抓住**：裸平台 API、回调式写法、直连存储、手写 `@media`、第三方 UI 库……全部机器化检测，附带具体修法。官方站点自己就是第一道验证场（D-2 页面零裸平台 API、零豁免）。

## 一条命令见分晓

工程内直接跑：

```bash
proteus gate run audit        # 深度聚合：十域一次检测（推荐入口）
proteus gate run check        # 快速聚合：css/style/router/config
proteus gate ls               # 查看全部门禁目录（族 / scope / 接线态）
```

**FAIL（error 级）→ exit 1**，CI 可直接消费。违规会逐文件带行号列出来，例如：

```text
── capabilities（✗）
[proteus-capabilities] ❌ 平台原生模块规范违规（11 处）：
  - pages/mp-semantics-demo.vue: wx.pageScrollTo(（业务目录禁止平台 API 裸调用…）
── fluid（✗）
  [FLD001] pages/devtools-open-api-demo.vue:273 禁止手写 @media 断点——改用 p-fluid / p-grid 语义
  [FLD012] pages/devtools-open-api-demo.vue:298 font-size 11px 过小（≤11px 无障碍风险）——用 p-scale 动态字号
[proteus] audit all 汇总：10 域 / 2 失败
```

> 想更精确地只查某一项？`proteus gate run d2`（页面平台 API）/ `run api-check`（回调式/同步存储）/ `run fluid`（布局规范）等单域可独立执行。

## 门禁全家桶（`proteus gate ls`）

| 族 | 门禁 | 检测什么 |
|---|---|---|
| 快速聚合 | `check` | css（跨端兼容 CSS001-012）· style（`:style` 运行时安全）· router（路由表）· config/cli（配置 + .proteus 一致性） |
| 深度聚合 | `audit` | 十域：route/module/config/i18n/capabilities/components/**d2**/**api-check**/**fluid**/devtools-budget |
| 专项检查 | `d2` | 页面裸平台 API（`wx.*`/`window.*` 等）、手写 `@media`、第三方 UI 库——规则级可配 |
| 专项检查 | `api-check` | **CMP007**：回调式平台 API、同步存储、裸全局能力调用 → 迁移 `useXxx()` Hook |
| 专项检查 | `capabilities` | 业务目录禁 `wx.*`/`window.*`，平台文件防 API 泄漏 |
| 专项检查 | `fluid` | **FLD**：手写 `@media` / 硬编码断点 / 无障碍字号 / 死尺寸 |
| 专项检查 | `i18n` / `router` / `module` / `css` / `style` / `config` | 硬编码文案 · 路由块 · 模块契约 · 跨端 CSS · 样式安全 · 配置合法 |
| 框架自检 / 仓库治理 | `coverage` / `conformance` / `check-pkg` / `check-deps` 等 | 框架仓语境门禁（官方仓在用） |

## 接入三步

**① 安装 CLI**（模板工程自带 `@proteus-vue/cli`）：

```bash
npm i -D @proteus-vue/cli
```

**② （可选）声明治理策略**——`proteus.config.ts`：

```ts
export default {
  // …必填字段…
  audit: {
    rules: { 'no-media-query': 'warn' },      // D-2 规则级：error（默认）/ warn / off
  },
  gates: {
    disabled: ['capabilities', 'devtools-budget'], // 整域开关（缺省全部启用）
  },
}
```

> 语义分层：`audit.rules` 管 D-2 **内部规则级别**；`gates.disabled` 管**门禁/整域开关**。字段全表见[全局配置与页面配置](/docs/10-config)。

**③ 接入 CI**——一条命令即可：

```yaml
- name: 质量门禁（深度审计）
  run: proteus gate run audit
```

> 期望全绿后 `proteus gate run audit` 输出 `✅` 且 exit 0；新代码带违规划不进来。

## 常见违规速查（被抓 → 怎么修）

| 你写的 | 违规 | 改成 |
|---|---|---|
| `wx.request({ url, success(){…} })` 回调式 | CMP007 | 能力 Hook（`useFetch` 等 `useXxx`，见[能力系统](/docs/18-capability-system)） |
| `wx.setStorageSync('k', v)` 直连存储 | CMP007 | `useStorage`（能力 Hook——跨端同一语义） |
| 页面里 `window.scrollY` / `window.addEventListener('scroll')` | D-2 | desktop 原语 `createScrollObserver`（见[桌面端原语](/docs/30-desktop-primitives)） |
| `navigator.clipboard.writeText(url)` | D-2 | desktop `copyText(url)` |
| `@media (max-width: 820px) { … }` 手写断点 | D-2 / FLD001 | `v-p-fluid` clamp / `p-grid` 柔性网格（见[柔性布局](/docs/17-fluid-layout)） |
| `font-size: 11px` | FLD012 无障碍 | `p-scale` 动态字号或 ≥12px |
| `import { ElButton } from 'element-plus'` | D-2 | `p-*` 语义组件（见[语义组件总览](/docs/12-components-intro)） |

**修完复验**：`proteus gate run audit` 直到 `✅ PASS`。

## 进阶治理

- **规则降级而不是关闭**：`audit.rules` 里把某条设 `'warn'`——违规仍报告但 exit 0（先记录后清理）；`'off'` 才是真关。
- **整域关闭**：`gates.disabled: ['fluid']`（如你的工程有意保留某个历史违规域，先关闭并在后续迭代里回收）。
- **豁免登记（防静默）**：页面确无原语可用时，逐行 `// d2-exempt: <原因>` 或整文件 `/* d2-exempt-file: <原因> */`——豁免原因随审计报告列出，可审计、可回收（原语补齐后删豁免即复验）。
- **专项命令都可用**：完整命令面见[CLI 命令参考](/docs/reference/cli)，门禁字段全表见[全局配置与页面配置](/docs/10-config)。

## 诚实边界

- `gate run audit` 覆盖**工程规范域**（平台 API / 存储 / 布局 / 路由 / 模块 / i18n / 配置 / D-2 页面语义）；`coverage` / `conformance` / `check-pkg` 等是**框架仓语境**门禁（官方仓在跑），不是业务页面门禁。
- 门禁抓的是**静态可判定的规范**；运行期行为（性能、真机差异）由[测试与部署](/docs/27-testing-deploy)与真机验证兜底。
- 想对「规范」本身动手？`proteus gate ls` 的注册表是唯一来源——加门禁/调级别先看它。
