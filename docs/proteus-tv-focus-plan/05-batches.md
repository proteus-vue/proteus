# 05 · 批次任务卡（B1–B5）

> 每批**可独立验收、可独立回滚**。S1 = B1–B4；B5 属 S2（跨端一致性）。
> 任务卡字段对齐 `docs/ai-tasks.json`（schema v1）：`id / title / type / status / scope / verification / decision`。

---

## B1 · 宿主输入归一（Android TV）

| 项 | 内容 |
|---|---|
| **id（建议）** | `T-tv-key-input-android` |
| **type** | `capability` |
| **目标** | 遥控按键 → 归一 → `__proteusHostAppEvent('key', …)` → JS 可见 |
| **scope** | `hosts/android/app/src/main/java/dev/proteus/layoutcore/shell/SuperappActivity.java`<br>`hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/SuperappRuntimeHost.java`<br>`hosts/shared/bridge/entry-superapp.ts`<br>`packages/api/src/capability-app-remote.ts`（新建）<br>`tests/capability-app-remote.test.ts`（新建） |
| **交付物** | ① `dispatchKeyEvent` 覆写 + `KeyEventRepeat` 归一（§03 §2 全表）<br>② `useRemote()` 能力契约（三端诚实降级）<br>③ 报告字段 `key_events_received` / `key_push_dropped` / `key_raw_seen` |
| **判据** | §04 D1–D4（8 个键码逐项 + 删 `ENTER` 必红 + 未订阅不静默 + 100 连发不丢） |
| **依赖** | 无 |
| **不做** | 不做 tvOS/鸿蒙（B5）；不做 repeat 合成（装置 B，按需） |

---

## B2 · 焦点引擎原语化（Hestia）

| 项 | 内容 |
|---|---|
| **id（建议）** | `T-tv-focus-engine` |
| **type** | `framework-feature` |
| **目标** | `navigateFocus` 抬成渲染无关原语 + 状态机 + `ensureVisible`；`fluid` 转导出零行为变化 |
| **scope** | `packages/focus/src/*`（新包）<br>`packages/fluid/src/focus-nav.ts`（改为转导出）<br>`packages/components/p-formfactor/index.vue`（消费新包）<br>`tests/focus-engine.test.ts`（新建）`tests/focus-ensure-visible.test.ts`（新建） |
| **交付物** | ① `nextFocus` / `ensureVisible` 纯函数（§02 §2.1）<br>② `createFocusEngine` 状态机（§02 §2.2）<br>③ TV001/TV003 校验器 |
| **判据** | ① 既有 `fluid` 单测**全绿**（零行为变化）<br>② `ensureVisible` 三条契约 E1–E3 各一条用例<br>③ P1（注入 rects 假数据，CI 可跑）<br>④ **B-2 破坏性验证**：`crossWeight=0` ⇒ P1 红 |
| **依赖** | B1（真实按键进 P1 端到端） |
| **风险** | 新包引入 = 包数 +1 ⇒ 需同步 `check:pkg` / `check:stats` / 官网包数 |

### B2 的"零行为变化"怎么证

| 证据 | 做法 |
|---|---|
| 源码级 | `fluid/src/focus-nav.ts` 改为 `export * from '@proteus-vue/focus'`，**不留第二份实现** |
| 测试级 | 既有用例**一行不改**跑通 |
| 产物级 | `p-formfactor` 的焦点行为截图 A/B（同一组 rects，环位置一致） |

---

## B3 · 焦点视觉（App 端渲染器画环）

| 项 | 内容 |
|---|---|
| **id（建议）** | `T-tv-focus-ring-app` |
| **type** | `end-alignment` |
| **目标** | App 无 `:focus` 伪类的前提下，按 `focusId` 在**绘制期**追加描边指令 |
| **scope** | 三端宿主渲染器（`VaporRenderHost.java` / `selfdraw-scene.swift` / 鸿蒙绘制层）<br>`tests/focus-ring-contract.test.ts`（新建） |
| **交付物** | ① 描边指令（宽度按 `baseFont 18` 比例；颜色取 `visual.brand`/`accent`）<br>② **对比度检查**（环色 vs 背景 ≥3:1）<br>③ `p-formfactor` 的 `@container` 降级路径（TV 固定拓扑） |
| **判据** | P3（±2px + 对比度）+ Web 端 `:focus-visible` **零回归**（截图 A/B） |
| **依赖** | B2 |
| **不做** | 不做视差特效（Apple TV 那种按下放大+倾斜）——独立课题 |

---

## B4 · 滚动跟随（ensureVisible 端到端）

| 项 | 内容 |
|---|---|
| **id（建议）** | `T-tv-focus-scroll-follow` |
| **type** | `framework-feature` |
| **目标** | 焦点移出可视区 ⇒ 自动滚动到可见；**最小位移**、不跳动 |
| **scope** | `packages/focus/src/ensure-visible.ts`<br>三端宿主的 `setScroll` 接线<br>`tests/focus-scroll-follow.test.ts`（新建） |
| **交付物** | ① `ensureVisible` 接入 `handleKey` 后置钩子<br>② 滚动钳制复用内核既有范围（`applyContentOffset` 语义） |
| **判据** | P4（连按 60 次正向 + 60 次反向，全在区内）+ **B-3 破坏性验证**（恒返回 0 ⇒ 红） |
| **依赖** | B3 |
| **★不得推迟** | 缺此项会出现「焦点跑到屏幕外」——比没有焦点更糟（`04-tv.md` §9 已点名） |

---

## B5 · 跨端一致性（S2）

| 项 | 内容 |
|---|---|
| **id（建议）** | `T-tv-focus-crossend` |
| **type** | `verification` |
| **目标** | 同一 SFC + 同一 rects ⇒ 四端 `focusSequence` 指纹完全相同 |
| **scope** | tvOS / 鸿蒙宿主输入归一 + 三端焦点视觉<br>`tests/focus-crossend-golden.test.ts`（新建）<br>`docs/generated/focus-sequence-golden.json`（新建，SSOT） |
| **交付物** | ① tvOS/鸿蒙归一表（§03 §2 全表）<br>② 指纹生成器 + golden 文件<br>③ CI 门禁 `check:focus-crossend` |
| **判据** | P2（四端指纹一致）+ 破坏性：改一端 `crossWeight` ⇒ 指纹不一致必红 |
| **依赖** | B1–B4 |
| **前置** | **tvOS 设备与签名**（成本未评估，需独立 spike） |

---

## 批次依赖图

```
B1 (输入归一, Android)
 └─► B2 (引擎原语化)
      ├─► B3 (焦点视觉)
      │    └─► B4 (滚动跟随)  ← S1 出口
      └────────────────────► B5 (跨端一致性, S2)
```

---

## 与主线的接线点（合入计划后需同步）

| 位置 | 需要改什么 |
|---|---|
| `docs/proteus-device-adaptation-plan/04-tv.md` | 头部加「执行级子计划见 `proteus-tv-focus-plan/`」；§9 B3 落地要点改为指向本目录 |
| `docs/board-inventory.md` G-25 行 | 状态由「⬜ 规划」改为「🟡 TV 焦点执行级方案入库（B1-B5 待启）」 |
| `docs/ai-tasks.json` | 新增 B1–B5 五行（`status: planned`） |
| `packages/component-ir/src/primitives.ts` | B1 落地时增补遥控能力原语（编号按 A 链流程定） |
| `docs/proteus-architecture.md:370` | TV001-004 从"声明"改为"已实现"（B2 完成时） |
| `docs/Proteus_万神殿命名规范.md` §3/§5 | 登记 **Hestia**（🔵 待检索） |

---

## 建议的并行/串行

| 阶段 | 可并行 | 必须串行 |
|---|---|---|
| 阶段 1 | B1（宿主） ∥ B2 的纯函数部分（`ensureVisible` 可先写单测） | — |
| 阶段 2 | B3（视觉） ∥ B2 的状态机接线 | B2 必须先冻结 API |
| 阶段 3 | — | B4 依赖 B2+B3 |
| 阶段 4 | — | B5 依赖全部 |
