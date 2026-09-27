# 柔性系统 · 阶段收口（2026-09-29）

> **本文回答**：柔性系统这一阶段**收了什么、没做什么、不许宣称什么**。
> 定位：`docs/proteus-fluid-system-plan/` 的**收口文档**——前序文档是**过程**
> （01 是体系设计见 `README.md` · 02 是 OS 级路线图 · 03 是折叠屏演示计划），
> 本文是**结论**，且所有覆盖面陈述都有可复现的验证入口。
> 机器门禁：`node scripts/check-fluid-wording.mjs`（形态数/术语/命名口径自洽）+
> `pnpm check:stats`（官网数字 vs 源码事实）。

---

## 0. 一句话结论

**柔性系统的「静态形态求解」阶段收口**：从声明式画像推导布局拓扑 / 导航 / 视觉语言 / 能力三态 /
流体度量 / 折叠姿态这条链已闭合，**8 形态 × 14 能力 × 3 态 = 112 格**有机器可读证据面，
且吸纳了 Apple HIG 与国内厂商统一基线（ITGSA / 小米 / 华为 / vivo）的公开适配规范。
**未收的是「动态信号」阶段**——真机姿态事件、运行时能力协商、系统偏好联动、纵向流体与跨形态
状态连续性契约（详见 §3）。这两段的分界即本文的核心结论。

---

## 1. 已收：覆盖面清单（逐项可验证）

### 1.1 两层求解体系

| 层 | 内容 | 落地物 | 验证入口 |
|---|---|---|---|
| **L1 容器求解** | 断点/网格/分栏/导航折叠（"组件在容器里"） | `p-fluid`·`p-grid`·`p-stack`·`p-fit`·`p-split`·`p-zone`·`p-aspect`·`p-sidebar`·`p-toolbar`·`p-scale`·`p-safe`·`p-adaptive`·`p-modal`（13 个） | `tests/fluid-layout-components.test.ts` · `tests/fluid-layout.test.ts` |
| **L2 形态求解** | 形态画像 → 拓扑/导航/能力/度量（"设备形态是一等公民"） | `FORM_PROFILES`（8 形态）× `FORM_CAP_KEYS`（14 能力）× 能力三态 × 折叠姿态 × 焦点导航 × `p-formfactor` | `tests/fluid-formfactor.test.ts` · `tests/fluid-formfactor-render.test.ts` · `tests/fluid-system.test.ts` |

运行时核心：`@proteus-vue/fluid`——**41 个导出符号**、零依赖纯逻辑、7 个单测文件 **140 用例**
（`createContainerQuery` / `createSizeAwareObserver` / `createDeviceEnv` / `detectFluidCapabilities` /
`resolveFluidMetrics` / `resolveFrameVars` / `vendorSizeClass` / `navigateFocus` …）。

### 1.2 形态画像覆盖（8 形态 · 每形态差异有真机依据）

| 形态 | 依据 | 关键差异（非仅尺寸） |
|---|---|---|
| `watch` | 抬腕一瞥 | `glance` 拓扑 · AMOLED 暗色 · 表冠 `crown` · 无 Tab |
| `phone` | 手机 | `stack` 单列 · 底部 Tab · 抽屉 |
| `fold` 书本式 | **三星 Fold6 实测**（内 2160×1856 / 外 968×2376） | 内方外长 · 竖直铰链 · `duo` 双窗格 · 三姿态 |
| `flip` 翻盖式 | **三星 Flip6 实测**（内 2640×1080 / 外 720×748） | 内长外方 · 水平铰链 · 三姿态 |
| `tablet` | iPad 类 | `rail-split` · 侧栏 · 多列 |
| `pc` | 桌面 | `rail-grid` · hover · 键盘焦点环 |
| `car` | AAOS 驾驶场景 | `dashboard` · 旋钮/语音 · SKU **降级路径** · 76dp 热区 · 暗色舱 |
| `tv` | 10ft 客厅 | `hero-focus-row` · 海报流 · 媒体 ×2.6 · 暗色沉浸 |

**能力三态实测分布**：`supported` 37 · `fallback` 1（车机 SKU 多选→语音/旋钮单选）· `unsupported` 74。
每一项都有渲染后果（`tests/fluid-formfactor-render.test.ts` 逐项断言），且 `data-pf-caps`
把「最终生效三态」做成机器可读摘要供 e2e 对账——「声明 ≠ 空头」可证伪。

### 1.3 标准吸纳（每一项都能指回出处）

| 来源 | 吸纳内容 | 落地位置 |
|---|---|---|
| **Apple HIG**（Designing for iPhone Duo） | 控件侧置（vertical controls）· 跨姿态功能一致 · 保留区概念 · 偶数栅格偏好 | `nav-side-tabs` · 半开布局的「只收次要信息」取舍 · `postures[].nav` |
| **ITGSA 金标联盟**（OPPO·vivo·小米共同署名白皮书） | 三区域规则（折痕区无元素）· 600/840dp 宽度档 | 折痕带结构空行 + e2e「带内零元素」· `vendorSizeClass()` |
| **小米**《大屏应用 UX 设计指南》 | TableTop / Book 两种半折叠语义 · 高度断点 480/900 · 「不要用 rotation，按宽高布局」 | `fold.book` vs `flip.tabletop` 两种布局 · `vendorSizeClass()` 高度档 · `resolveAspectClass` |
| **华为**《布局基础》 | 双维度断点（宽度 + 宽高比）· 折叠窗口四类状态查询 · 诚实边界（小屏/特殊比例无法一套布局） | `resolveAspectClass`（tall/balanced/wide/ultra-wide）· `FormPosture` · 文档明示不假装自适应 |
| **vivo** 折叠屏适配指南 | 悬停态定义（5°–160°）· 连续性「状态保存和延续」· 受限屏幕比例 | 悬停姿态建模依据 · 连续性演示证据面 · 诚实边界 |

> ★**引用纪律**（本线教训，已写入记忆）：引用外部规范**必须核对其适用设备类型**——
> Apple Duo 是翻盖式，其外屏比例不可套用到书本式。本仓因此把 `fold` / `flip` 拆为两个形态。

### 1.4 演示与门禁（理念 → 可见 → 可验证）

| 理念 | 演示可见物 | 机器判据 |
|---|---|---|
| 两种半折叠模式（Book / TableTop） | 两类设备各自的半开布局（横长条 vs 竖方形） | 铰链相反 + 拓扑不同 + 宽高比分类不同（单测 + e2e） |
| 半开 = 内屏的一半 | 应用区尺寸 + 面板「占内屏 50%」 | 面积比 40–75% 断言（校验器 + e2e） |
| 三区域规则（折痕区无元素） | 可见折痕带 + 面板标注 | 折痕带矩形与内容块零交集（e2e） |
| 跨姿态功能一致 | 功能对照条（被收起项带理由） | 「购买路径不得收起」+「收起必须给理由」（e2e） |
| 连续性（状态不丢） | 切换前后业务状态对照 | `data-biz-*` 逐项不变（e2e） |
| 厂商档位 | 面板并列显示厂商档与容器断点 | `vendorSizeClass` 边界用例（单测） |
| 端注入几何 | 折痕带宽度可切换（0/8/24px） | 注入后带宽实测变化（e2e） |
| 假折痕防回归 | 折叠态/展开态不画折痕 | 逐姿态 `data-pf-crease` 断言（单测 + e2e） |

演示页门禁：`tests/e2e-website-multidevice.test.ts` **14 用例**（真 Chromium，三视口 × 八形态 +
折叠 6 组合姿态矩阵 + 连续性/功能对照/端注入/厂商档位）。

### 1.5 口径自洽（本轮新增）

`scripts/check-fluid-wording.mjs`：形态数量（**与 `FORM_PROFILES` 键数机器对账**）、
弃用术语（`Flex System` → `Fluid System`）、命名纪律（书本式半开不得写作「半折」）三类漂移机器拦截。
**破坏性验证**：注入「七形态」→ 红并指名行；恢复 → 绿。

---

## 2. 收口的判据（为什么现在可以收）

1. **覆盖面无空白格**：8 形态 × 14 能力 = 112 格全部有声明的三态，每格有渲染后果与断言。
2. **两条独立标准体系均已吸纳**：Apple HIG（国际）+ ITGSA/小米/华为/vivo（国内），且引用有来源表。
3. **理念不再停留在文档**：演示页的每一项理念都有可见物 + 门禁判据（§1.4 八行闭环）。
4. **错误数据已清零**：半开几何、命名、假折痕、duo 重叠四个用户实测缺陷全部修复并加回归锁。
5. **口径与事实一致**：形态数、术语、命名有机器门禁（本轮新增），不再靠人工记忆。
6. **剩余项是「下一阶段」而非「本阶段欠账」**：见 §3——它们共同的特征是**需要真机信号或
   运行时契约**，不是静态求解层的缺口。

---

## 3. 未收：诚实清单（下一阶段的输入，不是本阶段的成果）

> 来源：`02-os-level-roadmap.md` §2/§3 + 本次收口复核（逐条核实过落地状态，2026-09-29）。

### 3.1 结构性未落地（按优先级）

| # | 缺口 | 现状核实 | 为什么本阶段不收 |
|---|---|---|---|
| **P0-1** | 运行时能力协商（`caps` 只能来自声明） | `packages/fluid/src/caps-negotiation.ts` **不存在**；三套桥（CapabilityBridge / CapabilityRegistry / detectFluidCapabilities）互不引用 | 需要端上报协议与各端探测实现——属「动态信号」阶段 |
| **P0-2** | 形态感知服务（姿态只有宿主 prop） | `createFormFactor` **零生产消费者**；`p-formfactor` 用自带 `senseFormFast`（仅按宽度推断） | 需要真机事件源（FoldingFeature / foldStatus / display-mode） |
| **P1-3** | 系统偏好联动（theme 写死） | `prefers-color-scheme` / `forced-colors` 与柔性系统**未接线** | 需要端偏好桥 + 画像 `auto` 语义定义 |
| **P1-4** | 跨形态状态连续**契约** | 演示层只有「同一实例重排」的证据（`data-biz-*`）；**无** `onFormChange` / 焦点/滚动恢复 | 契约设计属运行时 API 层，需与端生命周期联动 |
| **P1-5** | 纵向流体（度量只由宽度驱动） | `props.height` **仍零读取**（p-formfactor 内搜索无消费者） | 四步改造（数据通路→垂直系数→纵向契约变量→矮宽画布查询）为独立工程 |
| **P2-6** | 每后端一致性契约（决策 fixture） | 未实现（conformance 仍是控件名词汇表） | 依赖多后端就绪度 |
| **P2-7** | MP（Skyline）降级路径 | `p-formfactor` **未接** MP 容器工厂、未消费 `detectFluidCapabilities`；`color-mix` 等 11 处无兜底 | 需真机 Skyline 验证条件 |
| **P2-8** | 焦点导航性能（真机 TV 5–15ms/键） | 未做候选/矩形缓存与读写相位分离 | 需真机 TV 基准环境 |

### 3.2 死物与名不副实（余项，勿重复报告为新发现）

已清（本轮或前序）：`nav` 现已有 CSS 消费者（`nav-side-tabs` 驱动 Tab 栏侧置）；
`--pf-title` / `--pf-ar` / `--pf-frame-max` / `--pf-frame-radius` / `--pf-fold-left`、
`.is-dense` 恒覆盖、`props.posture` 越形态误用、e2e 恒真检查均已清除。

仍待办：
- `profile.distance`（仅校验 + 面板展示，无渲染后果）
- `safe.top`（零 profile 设置）
- `caps.multiCol`（仅 `grid-auto-flow: dense`，近乎无视觉差异）
- `--pf-cols`（幽灵变量，仅注释提及）
- `topology` 7 值结构上 5 种（`rail-split` ≈ `rail-grid`）
- 跨端契约 `LayoutBuilder.formFactor` 等（`component-ir/map.ts:97-105`）无对应实现
- `props.height`（并入 P1-5）
- `MultiDevice` 的 `.frame { transition: max-width }`（内联 width 不匹配，过渡不生效）

### 3.3 未核实的外部资料（不得当已核实引用）

| 缺口 | 影响 |
|---|---|
| OPPO / ColorOS 官方折叠指南（纯 SPA + 接口签名，未读） | 经 ITGSA 旁证规则同源，但未独立核实 |
| 华为 Mate X5 / 小米 MIX Fold / vivo X Fold 机型规格 | 演示几何**只用已核实的 Fold6 / Flip6**，文档已标注 |
| 各家悬停角度范围差异（仅 vivo 给 5°–160°） | 影响「悬停态判定」边界设计 |
| 各家折痕宽度典型值 | 影响折痕带预留宽度依据（现由端注入） |

---

## 4. 不许宣称什么（写进纪律的反建议）

1. **不要在无外部可验证证据时用「OS 级」**。本阶段收口的是**声明式形态求解**；
   `p-formfactor` 的 iOS/Android/鸿蒙/Flutter 兼容仍为 🟡 未接线——要么按端限定表述，要么直链兼容表。
2. **不要把 `fallback` 说成「支持」**——对外永远三分口径（supported / fallback / unsupported）。
3. **不要宣称「框架保证状态连续」**——连续性目前是演示层证据（同一实例重排 + `data-biz-*` 可断言）；
   框架契约在 P1-4，未交付。
4. **不要宣称「完整的折叠屏适配」**——机型几何只用三星两家已核实规格；华为原文的诚实边界适用：
   小屏（手表）与特殊比例（Pura X 外屏）**无法靠一套布局适配**。
5. **不要把门禁数量/测试数当卖点**——给可复现命令与预期退出码（见 §5）。
6. **不要用「响应式升级版 / rpx 批判」当开场白**（稻草人）；用反证实验：同内容槽 + 换 `declared`
   ⇒ 拓扑与能力集改变（`data-pf-topology` / `data-pf-caps` 可检）。

---

## 5. 验收：可复现命令与预期结果

```bash
# ① 口径自洽（形态数/术语/命名）—— 预期：✅ 口径一致（形态数 8）
node scripts/check-fluid-wording.mjs

# ② 形态画像 + 渲染同源（SSOT 自洽、能力无空头、姿态语义）
npx vitest run tests/fluid-formfactor.test.ts tests/fluid-formfactor-render.test.ts
#    预期：≥46 用例全过

# ③ 柔性系统全套单测（L1 组件 + L2 形态 + 焦点导航）
npx vitest run tests/fluid-*.test.ts        # 预期：7 文件 140 用例全过

# ④ 真几何门禁（八形态 × 三视口 + 折叠 6 姿态 + 连续性/功能对照/端注入/厂商档位）
pnpm run test:e2e:website                    # 预期：14 用例全过

# ⑤ 官网数字与源码事实一致
pnpm run check:stats                         # 预期：✅ 官网数字与源码实际值一致

# ⑥ 双语结构对齐（zh/en 同结构）
node website/scripts/check-en-drift.mjs      # 预期：287 对全部一致
```

演示入口（线上）：`https://proteus-vue.cn/multi-device`
直达链接：`?device=fold&posture=book`（书本式半开）· `?device=flip&posture=tabletop`（翻盖式半折）。

---

## 6. 口径与术语（对外统一，机器门禁保障）

| 中 | 英 | 说明 |
|---|---|---|
| 柔性系统 | **Fluid System** | 与 `@proteus-vue/fluid` 同名；**`Flex System` 已弃用**（EN 文档 17 处已清） |
| 设备形态 | device form | 8 个：watch / phone / fold / flip / tablet / pc / car / tv |
| 形态画像 | form profile | `FORM_PROFILES`（声明式 SSOT） |
| 能力三态 | capability tri-state | `supported` / `fallback` / `unsupported` |
| 折叠姿态 | posture | `folded` / `book`（书本式**半开**）/ `tabletop`（翻盖式**半折**）/ `expanded` |
| 半开 | half-open | **仅书本式**（被打开约 90°，half-open 悬停态）——不得写作「半折」 |
| 半折 | half-fold | **仅翻盖式**（clamshell，确实折了一半） |
| 流体度量 | fluid metrics | `k` / `clamped`；弃用「缩放系数」 |
| 展示帧 | mockup frame | 弃用「展示壳」作对外词 |
| 端 | end / render backend | **端 ≠ 形态**：一个端（如 Web）可渲染八种形态 |

---

## 7. 下一阶段的入口（若要继续）

按依赖顺序（都不是本阶段的欠账）：

1. **P0-2 形态感知服务** → 它是其余项的公共前置（P0-1 能力协商、P1-4 连续性都需要信号源）。
2. **P0-1 运行时能力协商** → 与 P0-2 共用上报通道（`CapsReport` / `FormSignal`）。
3. **P1-5 纵向流体** → 独立工程，不依赖信号源，可并行。
4. **P2-7 MP 降级** → 需真机 Skyline 验证环境（本机 wechatide 已可用）。
5. **P1-3 系统偏好** → 与 P1-5/无障碍线合并更经济。

> 立项纪律：以上任一项开工时，先在本目录建 `0X-<slug>.md` 计划文档（同 03 的格式：
> 已核实资料 + 四列追踪表 + 诚实边界），不要凭印象改代码。
