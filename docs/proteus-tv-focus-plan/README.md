# Proteus TV 焦点原语（Hestia）· 落地方案

> **定位**：**G-25（全终端柔性架构）的执行级子计划**——把 `04-tv.md` 的声明式草图落成可开工的工程方案。
> **代号**：**Hestia**（灶神）· 状态 🔵 暂定（N-3 商标/包名检索未做，**不得对外**）
> **触发**：用户「用框架做个电视盒子软件，验证原语是否真能跑，且 TV 是与其他跨端框架的最大差异点」
> **日期**：2026-10-20 · 承接调研 `docs/Proteus_TV端验证方案与可行性调研.md`（本目录是其可执行化版本）

---

## 0. 一句话

**TV 的价值不是「能跑」，是把输入模型从 touch 换成 remote**——只有当「没有焦点就完全不可用」时，
「形态驱动」才被真正证伪。本方案把已存在的三块资产（形态画像 / 几何焦点算法 / 组件接线）
**抬成渲染无关原语**，并用一条可机测的焦点链作为验收。

---

## 1. 命名：Hestia（灶神）

### 1.1 神职 → 职责

| 项 | 内容 |
|---|---|
| 模块职责 | **焦点引擎**：给定「当前焦点 + 候选矩形 + 方向」产出下一个焦点，并驱动焦点视觉与滚动跟随 |
| 神名 | **Hestia**（Ἑστία）· 希腊灶神 / 家宅之中心 |
| 命名论证 | **拉丁语 `focus` 的本义就是「灶台、火炉」**——古罗马家庭的火炉是屋子的中心，也是"注意力汇聚之处"。焦点引擎 = 把注意力（focus）安放在正确的位置 ⇒ **神职与职责在词源层面直接对应**（本仓最强的一次 N-1 契合） |

### 1.2 纳名自检（按《万神殿命名规范》§2 五问）

| # | 判据 | 结果 |
|---|---|---|
| 1 | 是神话名？ | ✅ 灶神（奥林匹斯十二主神之一） |
| 2 | 神职对得上？ | ✅ 见 §1.1（且词源同源） |
| 3 | 仓内撞名？ | ✅ 全仓 grep `Hestia` = 0 命中；不在 §3 总览 / §4 排除 / §6 备选 |
| 4 | 外部撞名？ | ⚠ **有同名项目 HestiaCP**（开源 Web 服务器控制面板）——**领域为服务器运维面板，非前端/跨端框架**，按 §2 第 4 问「前端/跨端/相关领域」不构成排除理由；但**须在 N-3 检索时明示** |
| 5 | 可寻址？ | ✅ `hestia` 可检索、非泛词 |
| — | 备选名 | **Teiresias**（盲眼先知，预知下一步 ⇒ 也对焦点推导）· 备用 |

> ★**状态纪律**：检索通过前标 🔵；对外文案一律写「焦点原语（Hestia，暂定）」。

---

## 2. 与现有主线的关系（不新开 G 号）

| 层 | 现有资产 | 本方案做什么 |
|---|---|---|
| L1 形态 | **G-25** `proteus-device-adaptation-plan/04-tv.md`：`F=remote` 三维断点 + `p-focus-scope` 草图 + TV001-004 规则**声明** | 把它**执行化**：算法归属、宿主契约、判据装置、批次拆分 |
| L1 画像 | `packages/fluid/src/formfactor.ts:491-511`：`input:'remote'` / `topology:'hero-focus-row'` / `safe{96,54}` / `distance:'10ft'` / `focus:'ring'` / `baseFont:18` | **直接复用，不改** |
| L1 算法 | `packages/fluid/src/focus-nav.ts:50` `navigateFocus(current, candidates, direction, opts)` —— **吃矩形、纯函数、已有单测** | 去 DOM 化后下沉为原语（§3） |
| L3 组件 | `packages/components/p-formfactor/index.vue:396/422/448`：`keydown → navigateFocus → focus()` | 改为消费原语（保持 Web 行为不变） |
| L3 能力 | `element.rect`（Android `HostCapabilities:267` / iOS `element-rect.swift` / 鸿蒙 `measureElementRect`）**三端已有** | 作为焦点候选的几何来源 |
| L4 宿主 | `hosts/**` **零按键入口**（`onKeyDown`/`dispatchKeyEvent`/`KEYCODE_DPAD` grep = 0） | 新增输入归一（§4） |
| **官网** | **`website/content/system/10-focus-navigation.md` 已完整公开** `navigateFocus` 的算法（方向筛选 / 主距离+交叉轴加权 / 同线优先 / 确定性 tie-break / clamp 不循环）与 9 例单测 | ★**不能重复描述、不能互相矛盾**：本方案 B2 做的是「把它从组件配套抬成原语」+ 补 `ensureVisible`；**官网已有内容视为对外契约**，B2 落地后须同步更新该页（新增 `ensureVisible` 与 focusId 视觉出口），避免"官网说已有、方案说要做"的观感冲突 |
| 通道 | `__proteusHostAppEvent` 推送通道已存在（`entry-host-runtime.ts:548`） | **复用，不新造** |

⇒ **本方案 = G-25 的「执行级子计划」**，登记在 G-25 行内，**不占新 G 号**（与 `proteus-end-alignment-plan` 之于 G-31 同例）。

---

## 3. 四层架构：焦点原语怎么抬到渲染无关层

```
┌─────────────────────────────────────────────────────────────┐
│ ① 输入归一（宿主）  remote key → {type:'key', key, repeat}    │
├─────────────────────────────────────────────────────────────┤
│ ② 焦点引擎（Hestia，纯函数，零 DOM / 零平台）                  │
│    (rects, currentId, direction, opts) → nextId              │
│    含：同行同列优先 / 交叉轴加权 / 首焦点 / 边缘 wrap           │
├─────────────────────────────────────────────────────────────┤
│ ③ 视觉（渲染器）   App 无 :focus，焦点环由渲染器按 focusId 画   │
├─────────────────────────────────────────────────────────────┤
│ ④ 滚动跟随         focusRect + containerRect → targetScroll   │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 为什么能跨端（这是差异化的核心）

`navigateFocus` 的入参是 **`FocusRect{x,y,width,height,id}`**，不是 DOM 元素；矩形来自**内核几何**
（`element.rect` / `readRects`），三端同契约 ⇒ **同一组矩形喂进去，三端必须给出同一焦点序列**（§5 判据 P2）。

### 3.2 与竞品的真实差异（修正调研文档的表述）

| | react-native-tvos | Flutter | Web TV（Lightning/Enact） | **Hestia** |
|---|---|---|---|---|
| TV 支持 | fork 全量替换 `react-native` | 普通 APK + 手接 Focus | 仅 Web 运行时 | 跨端（Web/Android TV/tvOS/Harmony） |
| 焦点来源 | fork 内**平台专有组件** | 通用 `Focus`，**不认形态** | 组件库自带 | **由形态画像（`F=remote`）推导** |
| 焦点算法可复用 | 否（绑平台） | 部分是（绑 widget 树） | 否 | **是（纯函数吃矩形）** |
| 可 conformance | 否 | 否 | 否 | **是（同一 rects 跨端指纹一致）** |

⇒ **差异点不是"支持 TV"，是"焦点是原语、由形态推导、可跨端一致性验证"。**

---

## 4. 宿主输入契约（三端同一张归一表）

### 4.1 归一事件

```ts
// 语义层（三端一致）
type RemoteKey = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'menu'
interface KeyEvent { type: 'key'; key: RemoteKey; repeat: boolean; raw?: string; ts: number }
```

### 4.2 键值归一表（**必须实测，不得假设**）

| 语义 | Android | tvOS | Web TV | 备注 |
|---|---|---|---|---|
| up | `KEYCODE_DPAD_UP`(19) | `UIPress.PressType.upArrow` | `ArrowUp`(38) | |
| down | `KEYCODE_DPAD_DOWN`(20) | `.downArrow` | `ArrowDown`(40) | |
| left | `KEYCODE_DPAD_LEFT`(21) | `.leftArrow` | `ArrowLeft`(37) | |
| right | `KEYCODE_DPAD_RIGHT`(22) | `.rightArrow` | `ArrowRight`(39) | |
| confirm | **`DPAD_CENTER`(23) 或 `ENTER`(66)** | `.select` | `Enter`(13) | ★两码并存，**必须都认** |
| back | `KEYCODE_BACK`(4) | `.menu` | `Escape`(27) | ★tvOS 用 menu 键 |
| menu | `KEYCODE_MENU`(82) | `.menu`（长按） | — | 语义冲突：**tvOS 上 back/menu 同键**（见风险 R3） |

### 4.3 repeat 语义（★判据的关键前提）

| 平台 | 长按重复来源 | 是否进 `KeyEvent.repeat` |
|---|---|---|
| Android | `KeyEvent.getRepeatCount() > 0` | ✅ 原生就有 |
| tvOS | `UIPress` 无 repeat（系统层） | ⚠ 需宿主自合成（按住时定时发） |
| Web | `KeyboardEvent.repeat` | ✅ 原生就有 |
| **adb 注入** | **不产生 repeat**（`input keyevent` 是单次 down/up） | ❌ **见 §5 装置修正** |

### 4.4 通道：复用 `__proteusHostAppEvent`（不新造）

```
宿主按键回调 ──► 归一(§4.2) ──► __proteusHostAppEvent('key', payload) ──► JS 层订阅
```
*依据*：`hosts/shared/bridge/entry-host-runtime.ts:548` 已有该通道，`screen-executor-host.ts:35` 亦以同模式回推。

---

## 5. S1 验收：六条判据（★两条已按实测修正）

> **装置总纪律**（本仓三条铁律的推广）：① 判据必须能**造出被测条件**；② 读数必须**归因到正确层**；③ 量具自身要有破坏性验证。

| # | 判据 | 量具 | 阈值 | 修正说明 |
|---|---|---|---|---|
| P1 | 方向键 → 焦点 id 按几何顺序变化 | 宿主 key 注入 + JS focus 日志 + `element.rect` | 序列与 `navigateFocus` 期望**完全一致** | — |
| P2 | **跨端焦点序列一致**（同一 SFC + 同一 rects） | 两端各跑一次，输出 `focusSequence` 指纹 | **指纹完全相同**（可 CI） | ★这是差异化证据，不靠肉眼 |
| P3 | 焦点环截图与 `element.rect` 一致 | 截图 + rect 对比（沿用 css-conformance 做法） | **±2px** | — |
| P4 | 连按 60 次后焦点仍在可视区 | 焦点 rect vs 容器 rect | 100% 在区内（滚动跟随生效） | — |
| P5 | **首屏 mount 与稳态按键响应分开量** | `JsTaskSampler` + mount 相位读数 | 首屏 mount 单独报；**稳态按键** P95 < 16.7ms | ★**原判据 #4 会把宿主 native 的账记到 JS 头上**：#1099 实测 iOS mount 93ms 而 JS 仅 ~3ms ⇒ 必须拆栏 |
| P6 | 冷启动 / Back / Home 符合 TV 约定 | 启动日志 + 生命周期日志 | Back 不直接杀进程 | — |
| P7 | 1GB 级盒子连续 10 分钟 JS 堆回落 | `nativeMemoryUsage` + GC | 回落到基线 +10% 内 | 需真机 |

### 5.1 ★装置修正一：`adb input keyevent` **造不出长按 repeat**

- `input keyevent 22` 是**单次 down/up**，`getRepeatCount()` 恒 0 ⇒ 「长按重复 10 次/秒」这条**用 adb 结构上产生不了**。
- **两种合法装置**（择一，须在报告里写明）：
  1. **离散快按**：脚本连续注入 N 次 keyevent，如实标注「离散 N 次，非 repeat」——验证焦点算法与渲染，**不验证 repeat 语义**；
  2. **宿主 dev 合成入口**：`--proteus-key-repeat=N`，由宿主按固定间隔发 `repeat=true` 事件（仅 dev），验证 repeat 路径。
- **禁止**：用离散注入的结果声称「长按重复已验证」。

### 5.2 ★装置修正二：长任务必须先归因到 JS / 宿主

按 #1099–#1105 的实测（iPhone 12）：mount 30–93ms、玻璃遍稳态 5.2ms、**JS 同步段 ~3ms**。
⇒ 在 1.5–2GB 盒子上，`P95 < 20ms` 这类阈值**大概率被宿主 native 吃掉**。
**必须**：先跑 `JsTaskSampler`（已有，两端同名 9 字段）+ mount 相位读数，**分开报**「JS 长任务」与「宿主 mount」，
再决定优化对象。**不做这一步就上 scheduler = 重犯 #1099 的错。**

### 5.3 装置自检（防"测了但没测到"）

| 检查 | 做法 |
|---|---|
| key 事件真的到达 JS | 计数 `keyEventsReceived > 0`，为 0 直接判**装置失败**而非"框架不支持" |
| 焦点真的变了 | 记录 `focusId` 序列，**全等**（不是"有变化"）⇒ 区分"没动"与"动错" |
| 几何真的来自内核 | 每个 focus rect 带 `source:'kernel'`，宿主不得自算 |
| 破坏性验证 | 故意把归一表 `confirm` 的 66 去掉 ⇒ P1 必须红（防止"只认 23"的漏配） |

---

## 6. 批次拆分（B1–B5，每批可独立判定）

| 批次 | 范围 | 判据 | 依赖 |
|---|---|---|---|
| **B1 输入归一** | Android 宿主 `dispatchKeyEvent` → 归一 → `__proteusHostAppEvent`；JS 层 `onRemoteKey()` | key 事件计数 > 0 且 `raw` 正确映射（§4.2 全表逐项） | 无 |
| **B2 焦点引擎原语化** | 把 `navigateFocus` 从 `fluid` 提到渲染无关层（保留 `fluid` 转导出，**零行为变化**）；`focusId` 状态机 + 首焦点 + wrap | 既有 `fluid` 单测全绿 + 新增 rects 直喂用例 | B1 |
| **B3 焦点视觉** | App 渲染器按 `focusId` 描边（不依赖 CSS `:focus`）；Web 仍走 `:focus-visible` | P3（±2px）+ Web 零回归 | B2 |
| **B4 滚动跟随** | `focusRect + containerRect → targetScroll`（内核 `setScroll` 已有） | P4（连按 60 次全在区内） | B3 |
| **B5 跨端一致性** | tvOS / 鸿蒙同一归一表 + 同一焦点序列 | **P2 指纹三端一致** | B1–B4 |

> **范围锁死**：不做播放器 / DRM / EPG / leanback 上架 / `useVideo`（后者是独立能力课题）。
> S1 = **B1–B4**；B5 属 S2。

---

## 7. 风险

| # | 风险 | 应对 |
|---|---|---|
| R1 | **范围膨胀**：叫"电视盒子软件"就会被期待播放器/会员/EPG | 本方案只承诺 B1–B4；产品化另立任务 |
| R2 | **`ensureVisible` 缺失 ⇒ 焦点跑到屏外**（"通了但不可用"） | 滚动跟随进 B4，**不得推到 S2** |
| R3 | **遥控碎片**：OK 键 23/66 并存；tvOS 的 back 与 menu 同键 | 归一表**双码并存**；tvOS 用长按/短按区分，并在 B5 实测 |
| R4 | **App 无 `:focus` 状态伪类**（能力表 `selector-pseudo-state` = `absent`） | 焦点环由渲染器画（B3），**不假装 CSS 生效** |
| R5 | **App 无 `@container`** ⇒ `p-formfactor` 的 TV 拓扑收紧要降级 | `hero-focus-row` 退化为固定拓扑 + 渲染器焦点环 |
| R6 | **`useVideo` 为 planned** ⇒ TV demo 无视频 | 用图片/首帧；不混进 S1 |
| R7 | **32 位盒子装不上**（AAR 仅 aarch64） | 硬件必须先定 ABI；见 §8 |
| R8 | 命名未检索（HestiaCP 同名） | 标 🔵；对外前完成 N-3 |
| R9 | **TV001-004 只在规约里声明、未实现** | B2 落地 TV001/TV003（编译器可校验），TV002/TV004 为 warning 后置 |

---

## 8. 动工前置（缺一不开工）

| # | 前置 | 状态 |
|---|---|---|
| 1 | 盒子规格：**arm64 + Android 9+ + 1.5–2GB**（压力机，非旗舰） | ⬜ 待定 |
| 2 | `adb connect` 可达（盒子的 5555 调试口） | ⬜ 待验 |
| 3 | 首端选择：**Android TV（建议，成本最低）** vs tvOS | ⬜ 待拍板 |
| 4 | Hestia 商标/包名检索（N-3） | ⬜ 未做 |
| 5 | TV001/TV003 规则编号登记（规约 VEH/TV/WATCH 行已有位） | ⬜ 待接 |

---

## 9. 文档清单

| 文件 | 内容 |
|---|---|
| `README.md`（本文） | 定位 / 命名 / 架构 / S1 判据 / 批次 / 风险 |
| [`01-asset-inventory.md`](./01-asset-inventory.md) | 现有资产逐条取证（文件:行）+ 缺口的**证据**（grep 命中数） |
| [`02-focus-primitive.md`](./02-focus-primitive.md) | 焦点原语 API 设计（函数签名 / 状态机 / 三端映射） |
| [`03-host-input-contract.md`](./03-host-input-contract.md) | 宿主按键契约（归一表 / repeat 语义 / 通道 / 假成功防护） |
| [`04-verdict-and-harness.md`](./04-verdict-and-harness.md) | 判据与装置（含 5.1/5.2 两个修正的完整推导） |
| [`05-batches.md`](./05-batches.md) | B1–B5 任务卡（范围 / 判据 / 交付物 / 依赖） |
| [`architecture-update.md`](./architecture-update.md) | 规约更新提案（TV001-004 落地 / 原则追加） |

---

## 10. 诚实边界

1. **本方案未写一行代码**——全部为设计；所有"已有"均标注了 `文件:行`，所有"缺口"均标注了 grep 命中数。
2. **跨端一致性（P2）只在设计上成立**：三端都还没接遥控输入，"同一 rects → 同一焦点序列"是**待验证的假设**，不是已证结论。
3. **tvOS / 鸿蒙路径的成本未评估**：本方案按 Android TV 写，另外两端的宿主改动量需单独 spike。
4. **TV 不是"线程引擎"的试金石**：TV 不会多给线程；它是**每帧预算**（输入→焦点→重绘→滚动）的试金石。
5. **性能阈值（16.7ms）是 60Hz 假设**，盒子若为 50Hz/30Hz 输出需重算。
