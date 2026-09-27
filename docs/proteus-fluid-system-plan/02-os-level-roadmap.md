# 柔性系统 · OS 级路线图（七视角复审产出）

> **来源**：2026-09-26/27 七位子代理独立复审（OS 人机规范 / 跨端框架架构 / 能力体系与降级 /
> 输入与无障碍 / 流体运行时与性能 / 缺陷猎手 / 产品化价值）。三审收口已交付（提交 `1609b3bc`），
> 本文件记录复审暴露的**结构性差距**与到「OS 级柔性系统」的路线。
> 新会话读此文件时先读 `PROJECT_MEMORY.md` 的「当前状态速览」。
> ★**定位（2026-09-29 收口后）**：本文件描述的是**下一阶段（动态信号 / 运行时契约）**的输入——
> 静态形态求解阶段已收口，收口结论与「未收项核实状态」见 [04-closure.md](./04-closure.md) §3；
> 其中 P2-7（`nav` 已有 CSS 消费者）等条目在收口时已复核更新。

## 0. 七视角一致结论（交叉印证）

| 结论 | 命中视角 |
|---|---|
| 形态画像 + 容器驱动度量 + 能力三态这条链**已达业界上游**（对比 Flutter/SwiftUI/Compose/ArkUI 无一同时具备） | 架构、产品、规范 |
| 但它当前是**「一台没有传感器的柔性系统」**——画像/姿态/能力三态全是声明式纸面模型 | 架构、能力、缺陷猎手 |
| 最大结构性缺口是**信号源**（宿主实测能力、真机姿态事件、系统偏好），不是渲染层 | 架构、能力、无障碍、性能 |
| 「声明 ≠ 空头」此前**证明不足**：消费点门禁是文本正则、能力面板读的是声明本身 | 能力、缺陷猎手、产品 |
| 演示页是「好看的自证页」而非「可反驳的证据页」：门禁/读数/对照物都不在读者 5 分钟路径上 | 产品 |

## 1. 已交付（三审，`1609b3bc`）

- **能力真值**：SSOT 内残留的三态裸真值（`caps.dpad ? …` 恒真 → 76dp 外溢全形态）已修；
  热区改为**物理量按展示缩放投影**（76dp/44dp 在缩略壳内换算，真机满值）。
- **能力证据面**：`data-pf-caps`（14 项三态机器可读摘要）+ e2e 对账用例——「声明 ≠ 空头」首次可机器证伪。
- **度量接线**：宽度冻结（同会话切设备后字号错 22%）、安全区被拓扑 padding 简写覆盖（TV 96→22px）两处「声称已修但未生效」已真落地。
- **姿态级度量**：折叠态外屏按窄手机基准（正文 9.7px → 14.7px，Chip 22 → 41px）。
- **焦点生命周期**：随 `focusEnabled` 接/解绑 + 形态变化重建 + 稳定 id + 可编辑守卫；
  PC 不再被几何引擎夺走原生 Tab；TV/车机补 3px 焦点环（并因实测发现 scale 破坏几何而改几何稳定强调）。
- **门禁真实化**：e2e「子项越界」恒真死代码已修；补「同会话切换」用例；三态静态扫描扩到 `fluid/src`。
- **跨字段校验** 12 条（nav↔caps / topology↔caps / input↔caps / 姿态护栏）；docstring 与实际对齐。
- **i18n**：演示内容双语化（EN 站 `hasCJK=false`）；组件层不再硬编码中文默认文案。

## 2. 结构性差距（按优先级，含接口级做法）

### P0-1 运行时能力协商（能力只能来自声明 → 需要端上报）
现状：`caps` 100% 静态；实测仅 `1/98` 格 fallback。三套桥（`CapabilityBridge` 91 成员 /
`CapabilityRegistry` 真探测 + fallback 递归 / `detectFluidCapabilities`）互不引用。
做法：
```ts
// packages/fluid/src/caps-negotiation.ts
export interface CapsReport {
  v: 1; at: number; agent: { id: string; ver?: string }
  measured: Partial<Record<keyof FormCaps, boolean>>   // undefined = 未测，不得当 false
  method?: Partial<Record<keyof FormCaps, 'api-probe'|'css-supports'|'permission'|'event-heard'|'declared-only'>>
  onHotplug?: (cb: (e: { key: keyof FormCaps; present: boolean }) => void) => () => void
}
export function negotiateCaps(i: { declared: FormCaps; report?: CapsReport | null; policy?: 'optimistic'|'declared-only'|'pessimistic' }): NegotiatedCaps
```
收敛真值表：`supported×false → 有降级路径则 fallback，否则 unsupported（且必须渲染显式占位，不得静默消失）`；
`unsupported×true → 仅注册表允许时升 supported`。落地面：`data-pf-caps` 增 `reason` 列 + CLI 对账门禁。

### P0-2 形态感知服务（姿态只有宿主 prop → 需要真机事件）
现状：`createFormFactor`（订阅 resize+pointer/hover）与 `probePointer` **零生产消费者**；
组件自带 `senseFormFast` 只按宽度推断（1440px 桌面无 declared 时判 tablet，而 `senseForm` 会判 pc）。
做法：`FormSignal { displayMode, hinge?: {orientation, angle, isSeparating}, windowKind, input }`
→ `sensePosture(signal)`；各端接 `WindowInfoTracker.FoldingFeature` / ArkUI `display.foldStatus` /
Web `env(fold-*)`，缺则退回 reported。组件改用 `senseForm` 并把 `ResolvedForm.source` 落到 `data-pf-source`。

### P1-3 系统偏好联动（画像把 theme 写死 → 需要跟随系统）
现状：`visual.theme` 写死（watch/tv/car dark）；`prefers-reduced-motion` 已接但 `prefers-color-scheme` /
`forced-colors` / 动态字号与柔性系统不通。
做法：`SystemPrefs { colorScheme, contrast, fontScale, reduceMotion }` → `resolveVisual(profile, prefs)`
（画像为基线，auto 时浅色形态跟随系统）；`--pf-font: calc(<px> * var(--proteus-font-scale, 1))`
让已有 p-scale 注入生效；`@media (forced-colors: active)` 补卡片/焦点环（**1.4.4 内容不丢**优先于裁切纪律）。

### P1-4 跨形态状态连续（演示靠 Vue 不重建的副产品 → 需要框架契约）
现状：`MultiDevice` 无 `:key` → 状态保留是「恰好」；框架无 `onFormChange`、无状态迁移、无焦点/滚动恢复。
做法：`onFormChange(prev, next, { reason })` + 可选 `provideFormContinuity({ persistKey, restore })`；
几何门禁补「切换 7 形态 × 3 姿态后业务 ref 不变」断言（当前只量几何）。

### P1-5 纵向流体（度量只由宽度驱动 → 高度/纵横比缺席）
现状：`props.height` 零读取；`st.height` / `resolveOrientation` 有产出无消费；tabletop 靠删内容贴边（254 vs 253px）。
做法（四步，成本递增）：① 开数据通路（RO 回调已带 height）→ `--pf-vh`/cqh；
② 垂直系数只作用于间距不作用于字号；③ 纵向契约变量 `--pf-content-h` 替掉逐拓扑手写 40%/46%；
④ `container-type: size` 的「矮宽画布」查询通用化。

### P2-6 每后端一致性契约（当前只是控件名词汇表）
做法：把 conformance 从「控件名」升级为「**决策一致性**」——对 7 形态 × 3 姿态生成确定性
`resolveProfile` JSON fixture，各后端必须产出同构决策（先覆盖 vue-dom/skyline/headless）。

### P2-7 MP（Skyline）降级路径
现状：`p-formfactor` 未注入 MP 容器工厂（对比 p-zone/p-split/p-grid 都注入了）、未消费
`detectFluidCapabilities` → Skyline 上 grid 拓扑静默塌成纵向堆叠、`aspect-ratio` / `@container` /
`color-mix`（11 处）失效。做法：接工厂 + `capabilities.grid === false` 的 flex 降级分支 + 蒙层 rgba 兜底。

### P2-8 性能（真机 TV 连按 5-15ms/键）
现状：每次方向键 2 次 `querySelectorAll` + O(N) 矩形测量 + 交错读写。做法：候选与矩形按布局世代缓存、
读数与写相位分离、`event.repeat` 用 rAF 合并。**不要**给 RO 加 debounce（RO 已按帧节流）。

## 3. 死物与名不副实（三审已清一部分，余项记为待办）

已清：`--pf-title` / `--pf-ar` / `--pf-frame-max` / `--pf-frame-radius` / `--pf-fold-left`（零消费者变量）；
`.is-dense` 恒覆盖；`props.posture` 越形态误用；e2e 恒真检查。

仍待办（**不要重复报告为新发现**）：
- `profile.nav`（7 取值仅 `data-pf-nav` 诊断属性，无 CSS/逻辑消费者；真导航由 `caps.tabs/sidebar` 驱动）
- `profile.distance`（仅校验 + 面板展示）
- `safe.top`（零 profile 设置）
- `caps.multiCol` → 仅 `grid-auto-flow: dense`（近乎无视觉差异）
- `--pf-cols`（幽灵变量，仅注释提及）
- `topology` 7 值结构上 5 种（`rail-split` ≈ `rail-grid`）
- 跨端契约 `LayoutBuilder.formFactor` 等（`component-ir/map.ts:97-105`）无对应实现
- `props.height`（纵向流体未落地前保持死状态——已在本文件 P1-5 立项）
- `MultiDevice` 的 `.frame{transition:max-width}`（内联 width 不匹配）

## 4. 产品化（说服力缺口）

**最弱环 = 能力面板只断言不演示 + 真几何门禁只在 CI 里**。
「≤1 天」快速赢（按价值/成本排序）：
1. **页面补证据条**：直接 import `resolveFluidMetrics` 显示实时 `k` / `clamped` + 门禁徽章（链接到 CI run）
   + 诊断属性提示（`data-pf-caps` 已是可复制粘贴的断言目标）。
2. **一致性矩阵自动生成**（7 形态 × 14 能力 × 姿态 × 门禁链接，生成物 + `check:formfactor-matrix` 漂移门禁）。
3. **交互式画像浏览器**（滑块调容器宽 → k/字号/热区曲线；clamp 区着色）。
4. **「第 8 种形态」接入演示**（诚实清点：画像 + union + 校验 + 官网 ICONS + e2e 清单 ≈ 5 处；
   收敛到 2 处后 N 才有宣传价值）。
5. `proteus fluid check` 对外可用化（实现已有 `packages/cli/src/fluid-check.ts`，缺「别人怎么跑」的文档与 fixture）。

**反建议（会损伤可信度，勿做）**：
- 无外部可验证证据时不要用「OS 级」；`p-formfactor` 兼容表把 iOS/Android/鸿蒙/Flutter 标为 🟡 未接线，
  与「操作系统级」宣称自相矛盾——要么按端限定，要么直链兼容表。
- 不要把门禁数量/测试数当卖点；给**一个**可复现命令与预期退出码。
- 不要用「响应式升级版 / rpx 批判」当开场白（稻草人）；用反证实验：同内容槽 + 换 `declared`
  ⇒ 拓扑与能力集改变（`data-pf-topology` / `data-pf-caps` 可检）。
- 不要把 `fallback` 说成「支持」（对外永远三分口径）。

## 5. 术语表（对外统一）

| 中 | 英 | 说明 |
|---|---|---|
| 柔性系统 | **Fluid System** | 与 `@proteus-vue/fluid` 同名；**弃用 `Flex System`**（站内不一致，待清） |
| 设备形态 | device form | 保留（`DeviceForm`） |
| 形态画像 | form profile | 保留（`FormProfile`） |
| 能力三态 | capability tri-state | `supported / fallback / unsupported` |
| 降级路径 | fallback path | 保留 |
| 折叠姿态 | posture（folded / book / tabletop / expanded） | 保留（book = 书本式半开 · tabletop = 翻盖式半折——**两类设备各自的半折叠语义**） |
| 流体度量 | fluid metrics (k, clamped) | 弃用「缩放系数 / scale factor」（旧版概念） |
| 展示帧 | mockup frame | 弃用「展示壳」作对外词 |
| 端 | end / render backend | **端 ≠ 形态**：首页/生态页曾写「六端形态」（漏折叠屏）→ 已改为「八种设备形态」（2026-09-29 收口；机器门禁 `check:fluid-wording`） |
| 多端同屏（页面名） | Multi-device | 建议改「多形态同屏 / Form Wall」以免与「端」撞义 |
