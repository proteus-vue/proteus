---
title: 形态画像（Form Profiles）
order: 6
group: 柔性系统
---

# 形态画像（Form Profiles）

> **宽度只能区分大小，区分不了形态。** 1280px 的车机和 1280px 的 PC，宽度相同、交互完全不同——前者是旋钮 + 语音、大热区、禁细滚动；后者是鼠标 + 键盘、三栏密排、悬停反馈。柔性系统的第二层把「设备形态」做成一等公民：一张 `FORM_PROFILES` 表声明形态的全部差异，框架据此换布局、换导航、换能力集。

## 为什么宽度不够

容器查询（[本区第 2 篇](/docs/system/02-container-query)）解决了「组件活在容器里」的问题，但形态差异不止于尺寸：

| 形态 | 典型宽度 | 交互真相 | 宽度能表达吗 |
|---|---|---|---|
| 车机 | 1280–1920 | 旋钮/方向盘键 + 语音，**驾驶中禁精细操作** | ❌ 与 PC 同宽 |
| TV | 1920（10ft 观看） | 遥控器方向键 + 焦点环，**远距离可读** | ❌ 与 PC 同宽 |
| 手表 | 198 | 表冠 + 抬腕一瞥，**一屏一意** | ⚠️ 只是"很窄"，语义是全屏一意 |
| 折叠屏 | 340 ⇄ 673 | **同一台设备两种形态**（折叠/半折/展开） | ❌ 宽窄是动态的 |

结论：形态是**输入的连续性 + 观看距离 + 能力集**的组合，必须显式建模。

## 一张表：FORM_PROFILES（SSOT）

`@proteus-vue/fluid` 导出的 `FORM_PROFILES` 是唯一事实源——布局拓扑、导航、视觉语言、展示帧、流体比例、能力声明**全从这一张表推导**：

| 形态 | 输入 | 密度 | 布局拓扑 | 导航 | 观看距离 | 视觉主题 |
|---|---|---|---|---|---|---|
| `watch` | dial（表冠） | compact | `glance` 一屏一意 | page-stack | glance 抬腕 | dark（AMOLED 常亮） |
| `phone` | touch | regular | `stack` 单列 + Tab | bottom-tabs | arm 臂长 | light |
| `fold` | touch | regular | `duo` 双窗格（展开态） | tabs | arm | light |
| `tablet` | touch | regular | `rail-split` 侧栏分栏 | rail | arm | light |
| `pc` | cursor | regular | `rail-grid` 侧栏多列 | side-nav | desk 桌面 | light |
| `car` | remote（旋钮） | comfortable | `dashboard` 驾驶舱 | focus-tree | dashboard 驾驶位 | dark |
| `tv` | remote（遥控） | comfortable | `hero-focus-row` 英雄区 + 海报流 | focus-row | **10ft** 沙发 | dark |

> 每个形态还带：`frame`（展示帧规格：比例/上限宽/刘海/状态栏/折痕/表盘）、`mediaRatio`、`safe`（安全区）、`visual.ratio`（流体基准）、`postures`（折叠姿态集）、`caps`（能力声明）。

## 字段怎么被消费

| 字段 | 消费点 | 效果举例 |
|---|---|---|
| `topology` | `p-formfactor` 根类 `topo-*` | 换掉整块布局结构（非缩放） |
| `nav` | `data-pf-nav` + 能力过滤 | 折叠屏出 Tab、平板出侧栏、TV 走焦点行 |
| `input` / `density` | 根类 + `--pf-gap-dense` | 遥控系热区放大、车机大间距 |
| `visual` | CSS 变量（bg/text/dim/brand/accent/focus） | TV/车机暗色沉浸、暖橙强调 |
| `visual.ratio` | `resolveFluidMetrics` | 字号与尺寸的流体求解（[下一篇](/docs/system/07-fluid-metrics)） |
| `frame` | 展示壳 | 演示页的设备外框（比例/刘海/折痕） |
| `caps` | 能力三态过滤 | 见[能力三态](/docs/system/08-capabilities) |
| `postures` | 动态形态 | 见[折叠姿态](/docs/system/09-postures) |

## 三道机器门禁（画像不能写歪）

新增或修改画像时，以下断言会在 CI 里拦住不一致：

1. **自洽校验** `validateFormProfiles()`——跨字段规则，例如：
   - `nav=tabs` ⇒ `caps.tabs` 必须支持（否则导航永不渲染）
   - `topology=hero-focus-row` ⇒ `input=remote` 且 `caps.focusRows` 支持
   - `caps.driveAware` ⇒ `distance=dashboard`；`caps.crown` ⇒ `input∈{dial,remote}`
   - 暗色/浅色对比度：`text/bg ≥ 4.5`、`accent/bg ≥ 3`（WCAG AA）
   - 姿态集齐备、展开视口 > 折叠视口、折叠/展开拓扑必须不同
2. **键集 SSOT** `FORM_CAP_KEYS`（14 项）——七形态的 `caps` 键集必须逐项相等（防幽灵字段/漏声明）。
3. **渲染级对账**——`data-pf-caps` 摘要与画像声明逐项一致，且每项能力都有真实渲染后果（防「面板绿点不可证伪」）。

```bash
pnpm test tests/fluid-formfactor.test.ts tests/fluid-formfactor-render.test.ts   # 三道门禁
```

## 加第 8 种形态要改几处（诚实清点）

柔性系统的可扩展性是**声明式的**，但不是零成本——新增形态需要碰 5 处（当前实现口径）：

| # | 位置 | 改动 |
|---|---|---|
| 1 | `packages/fluid/src/formfactor.ts` | `DeviceForm` union + `FORM_PROFILES` 一条画像（主体工作量在此） |
| 2 | 同文件的 `validateFormProfiles` | `forms` 数组加名（否则新形态不被校验） |
| 3 | 同文件的 `senseForm` | 若该形态可被环境推断则加探测；不可推断（watch/car/tv 这类）则维持「须宿主声明」 |
| 4 | `website/src/pages/MultiDevice.vue` | 官网演示页图标表 `ICONS` |
| 5 | `tests/e2e-website-multidevice.test.ts` | 形态清单 + 断言分组（一屏/可滚动） |

约束：新增形态必须**在拓扑/导航/能力上至少有一项与既有形态不同**，否则门禁会把它当作重复形态拦下（`rail-split` 与 `rail-grid` 这类近邻也会被要求给出真实差异）。

## 诚实边界

- **浏览器无法自动识别 watch / car / tv**——没有标准信号，UA 可伪造。这三个形态必须由宿主**声明**（`?device=` 参数、端 profile、App 配置）。另四种（phone/fold/tablet/pc）可按容器尺寸 + 指针能力推断，但仍以宿主声明为权威。
- **能力声明 ≠ 实测能力**：画像里的 `caps` 是"该形态应当具备什么"，端上是否真有表冠/遥控器属于**运行时协商**范畴（愿景见[能力三态](/docs/system/08-capabilities)的诚实边界一节）。
- 新增形态的 5 处清点会随「画像校验/官网/测试」的自动化程度下降；当前不夸大为「只加一行」。

## 下一步

- [流体度量](/docs/system/07-fluid-metrics)：画像里的 `ratio` 怎么解出字号与热区
- [能力三态与降级](/docs/system/08-capabilities)：14 项能力怎么过滤与降级
- [p-formfactor](/docs/system/11-p-formfactor)：业务零分支地消费整张画像
