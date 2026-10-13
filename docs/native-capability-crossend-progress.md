# 原生能力跨端接入进度（审查报告 · 2026-10-13）

> **性质**：**审查报告**（非立项计划）。按 AI 共建规范（`.agents/skills/ai-cobuild/SKILL.md`）的纪律执行：
> **不看声明、只看机器判据**；每个数字都能用文末命令复现。
> **口径**：能力清单 SSOT = `PRIMITIVE_CATALOG` 的 `kind='capability'`（**84** 项）；
> 端注册表 SSOT = `website/src/ends.ts`；宿主契约 SSOT = `packages/render-backend/src/host-invoke-contract.ts`。
> **门禁实测**（Node 22.22.2，2026-10-13 08:5x）——8 绿 1 红，红的那道是**本轮新发现**。

---

## 0. 结论摘要

| # | 结论 |
|---|---|
| 1 | **Web / 小程序 是完整兑现面**：Web 65✅+19⚠️、MP 79✅+5⚠️、Headless 84✅，**零 ⬜**（无"未开始"格） |
| 2 | **App 原生面已从"零"走到"11 项真接线"**：宿主壳（iOS 13 / Android 17 个方法）+ JS 桥（13 个方法）都在，**但官网只承认 3 项** ⇒ **8 项漏判** |
| 3 | **鸿蒙 = 0**：`screen.*` 已按中性名下沉 runtime HAR，**能力族 1/18**（唯一命中是 `memUsage` 类），宿主壳未接线 |
| 4 | ★**`check:content` 当前红灯（162 页漂移）** —— 根因已实证：**今晨 08:39 的决策 #870 拆文件**断了生成器的三处隐式解析契约 |
| 5 | ★★**比红灯更危险的是"照着红灯去修"**：此刻盲跑 `gen:content` 会把 Web/MP 的 ✅ **改写为 ⚠️「桥未提供」**，即对外谎报"Web 和小程序也不支持" |
| 6 | 4 与 5 与另一处漏判**同一根因类型**：生成器用**文本 `indexOf`/正则解析源码**＝隐式契约，而拆文件/改声明风格这类"正确的事"会静默打断它，**没有门禁保护这个契约** |

---

## 1. 机器判据全景（8 绿 1 红）

| 门禁 | 结果 | 读数 |
|---|---|---|
| `check:capability-golden` | ✅ | 跨语言 golden 与 TS 侧产出一致 |
| `check:capability-priority` | ✅ | 优先级表与源一致（**84 能力** · 跨项目 15 · 分域 0 缺口） |
| `check:host-invoke-contract` | ✅ | android **17/18** · ios **13/18** · harmony **1/18**（缺失如实列出，非静默） |
| `check:host-variant-parity` | ✅ | 三端宿主变体一致（每端单一壳 · dev 件门控 · android release 无 INTERNET） |
| `check:platform-layering` | ✅ | 平台 7 文件 · 内核 15 文件零平台分支 |
| `check:host-separation-ledger` | ✅ | 宿主关注点分离台账 31 项（已落地 19 / 进行 0 / 未做 0 / 范围外 12） |
| `check:degradation` | ✅ | 79 组件 / 568 属性：mp supported 561 · fallback 7 · **unsupported 0**；fallback 可观察 148/148 |
| `check:gap-report` | ✅ | 漏点棘轮：degraded **253** · unsupported **0** · 总 471（只降不升） |
| **`check:content`** | **❌ 162 页** | 81 zh + 81 en 能力页与生成器不一致 —— 见 §4 |

---

## 2. 84 能力 × 7 端 分档矩阵（聚合自 84 个已发布能力页）

| 端 | ✅ 已落地 | ⚠️ 已落地·桥未提供→Err | 🟡 桥未接线 | ⬜ 未开始 |
|---|---|---|---|---|
| Web SPA | 65 | **19** | 0 | 0 |
| 微信小程序 | 79 | **5** | 0 | 0 |
| Headless（SSR/测试） | 84 | 0 | 0 | 0 |
| **iOS 原生** | **3** | 0 | **81** | 0 |
| **Android 原生** | **3** | 0 | **81** | 0 |
| **鸿蒙** | **0** | 0 | **84** | 0 |
| Flutter 混合 | 0 | 0 | 84 | 0 |

**Web 端 19 项 ⚠️**（平台确实无直通 API，走 `Err` 显式降级——属设计而非欠账）：
`address · analytics · archive · brightness · calendar · contact · data-channel · document-preview ·
in-app-purchase · keep-screen-on · login · map · payment · phone-call · qr-code · shortcut · sms ·
we-run · wifi`

**小程序 5 项 ⚠️**：`data-channel · document-preview · in-app-purchase · keep-screen-on · sms`

> 读法提醒：**Web/MP 的 ⚠️ 不是"没做"**，是"平台没有对应 API → 框架返回显式 Err"。
> 真正的"没接线"是 App 三端的 🟡（255 格 / 84×3）。

---

## 3. ★ App 原生面：真实 11 项 vs 官网 3 项（8 项漏判）

### 3.1 代码事实（两侧都验过）

| 侧 | 证据 | 内容 |
|---|---|---|
| 宿主壳 | `hosts/ios/ProteusHost/runtime/host-capabilities.swift` | 13 个 `case`（含 `window.setSize` → `windowSetSize(args)` 真实现） |
| 宿主壳 | `hosts/android/.../runtime/HostCapabilities.java` | 17 个 `case`（含 `webassembly.*` 真引擎 + `extension.load` 诚实 unsupported） |
| JS 桥 | `packages/api/src/capability-app.ts` | `createAppLifecycleCapabilities`(3) + `createAppNativeCapabilities`(10) = **13 个方法** |

### 3.2 官网声明 vs 事实

官网：iOS/Android 仅 **3 项 ✅**（`app-lifecycle` / `background` / `page-lifecycle`），其余 **81 项 🟡「渲染核心已落地——能力桥未接线」**。

**按真·桥方法集应判 ✅ 的 11 项**（已逐项核对桥实现与宿主 `case`）：

| Hook | 能力 | 桥方法 | 宿主实现 |
|---|---|---|---|
| `useAppLifecycle` | C23 | `getAppLifecycle` | ✅ 已声明 |
| `usePageLifecycle` | C24 | `getPageLifecycle` | ✅ 已声明 |
| `useBackground` | C25 | `getBackground` | ✅ 已声明 |
| `useUpdate` | C51 | `getUpdateManager` | ios/android `update.check/apply` | ★**漏判** |
| `useEmbedded` | C48 | `getHostContext` | ios/android `host.context` | ★**漏判** |
| `useExtension` | C50 | `loadExtension` | ios/android `extension.load` | ★**漏判** |
| `useWorker` | C53 | `createWorker` | ios/android `worker.*` | ★**漏判** |
| `usePreload` | C67 | `getPreload` | ios/android `preload.assets` | ★**漏判** |
| `useIdle` | C73 | `getIdle` | ios/android `idle.request/cancel` | ★**漏判** |
| `useWindow` | C74 | `getWindow` | ios/android `window.setSize` | ★**漏判** |
| `useNavigationGuard` | C75 | `getNavigationGuard` | **平台中立**（框架虚拟栈拦截，无需原生） | ★**漏判** |

### 3.3 根因（已实证，可复现）

`website/scripts/gen-content.mjs:222` 的"从源码推导"只用了**一条正则**：

```js
for (const m of src.matchAll(/^\s{4}(get[A-Z]\w*)\(/gm)) keys.add(m[1])
```

- 该正则**只认"方法简写"风格**（`getXxx(): T {…}`），**不认"属性箭头"风格**（`getXxx: () => ({…})`）；
- `capability-app.ts` 里两种风格**混用** ⇒ 实抽 **3** 个，实际 **13** 个；
- 再加一层盲区：`loadExtension` / `createWorker` / `navigateMiniProgram` **连 `get` 前缀都没有**，这条正则**永远抓不到**；
- 判定式 `refs.every(r => APP_BRIDGE_KEYS.has(r))` 因此对 8 个能力恒假 ⇒ 页面回退到模板文案「能力桥未接线」。

**同一形态第二次出现**：该函数 2026-09-30 引入时的注释写着"从源码推导，不硬编码"——**意图对、覆盖面窄**。当时它正是为用户「官网文档好像没更新」而建；今天同一处又漏了。

---

## 4. ★★ `check:content` 红灯：162 页漂移（根因已实证）

### 4.1 现象

```
$ npx tsx website/scripts/gen-content.mjs --check
DRIFT: 162 个生成页与源不一致——运行 npm run gen:content 并提交：   （exit 1）
按目录：website/content/capabilities → 81 · website/en/capabilities → 81
```
（组件页 0 漂移 —— **只有能力页**。）

### 4.2 根因（用"注入探针"实证，非推断）

决策 **#870**（`504b4fa58`，**2026-10-13 08:39**）把 `capability.ts`（8987 行）拆成三层。生成器解析的数据源仍只读 `capability.ts`，而它依赖的三个符号**全部搬走了**：

| 生成器依赖的符号 | 现在在哪 | 搬走后后果 |
|---|---|---|
| `wxBridge` / `webBridge` | → `capability-bridges.ts` | `wxKeys`/`webKeys` 变空 ⇒ **所有能力的 Web/MP 行**判为「桥未提供」 |
| `export interface CapabilityBridge` | → `capability-types.ts` | `bridgeDocs` 解析段变空 ⇒ 描述兜底链断裂（4 页） |

**验证矩阵**（在 `--check` 模式下跑生成器副本，只读不写，跑完即删）：

| 数据源 | 结果 |
|---|---|
| 现状（只读 `capability.ts`） | **DRIFT 162**（exit 1） |
| +`capability-types.ts` | DRIFT 158 |
| **+`capability-types.ts` + `capability-bridges.ts`** | **✅ DRIFT 0（exit 0）** |

⇒ 拆分前的隐式解析契约 = **三文件合并**；一文件都不改的"正确重构"，把这个契约打断了。

### 4.3 ★ 为什么**不能**照着红灯去修（比红灯更危险）

生成的"期望内容"长这样（`camera.md` 实测 diff）：

```diff
- | Web SPA | ✅ | vue-dom · webBridge 实现（平台 API 直连）    ← 现行（正确）
+ | Web SPA | ⚠️ | vue-dom · webBridge 未提供 getCamera → Err 显式降级   ← 生成器现在会吐的
- | 微信小程序 | ✅ | skyline · wx 桥 → wx.createCameraContext
+ | 微信小程序 | ⚠️ | skyline · wx 桥未提供 getCamera → Err 显式降级
```

也就是说：**`gen:content` 现在是个"会把真话改成假话"的工具**。
按 AI 共建规范的口径，这属于**反模式 #6 的镜像**（"文档说了就是做了" ↔ "源改了、生成器没跟上，重生成即撒谎"）——
正确动作顺序是：**先修数据源，再重生成**；门禁红在这里起的是"拦住了错误发布"的作用。

---

## 5. NC 里程碑进度（`docs/Proteus_原生能力接入方案.md` §9，逐项核实）

| 里程碑 | 状态 | 已交 / 未交 |
|---|---|---|
| **NC0** 能力清单扫描 | ✅ 核心交付（2026-09-30） | 已交：优先级表（84 能力 · 跨项目 15 · 分域 0 缺口）+ 门禁。未交：成本人工估（S/M/L）、真实业务语料替换（当前是**下界**） |
| **NC1** codegen 工具链 | 🟡 首个端到端切片 | 已交：`bridge-decl.ts` 声明层 + `gen-bridge-ext.mjs` 三模板族 + 生成物真实接线 + `check:bridge-ext`（✅ 2 个声明式能力）+ 9 条测试。未交：**模板族扩展** · **Android JNI / iOS ObjC 胶水生成** · 编译期三方对账 |
| **NC2** 内置能力扩充 | ⬜ 未开始 | 按优先级表分批实现 + conformance + AI 说明书 |
| **NC3** 插件开发链路 | ⬜ 未开始 | 目标：插件开发 < 1 小时 |
| **NC4** 渲染路径隔离 | ⬜ 未开始 | 帧回调内禁能力调用 + 批处理红线回归 |
| **NC5** 指标采集 | ⬜ 未开始 | A/B/C 三指标埋点 |

> 判定：**NC 线的"基建"（清单 + codegen 骨架 + 门禁）已完成**，**"铺量"（NC2）一步未动**。
> 与 §2 的 App 面读数一致：桥的骨架在、兑现面窄。

---

## 6. 外部报告闭环（AI 共建台账）现状

`node scripts/ledger-check.mjs --check`（退出 1 = 存在未收口项，属正常待办）：

| 指标 | 读数 |
|---|---|
| 报告条数 | **35**（blocker 15 / major 16 / minor 4） |
| 收口（fixed + published + 独立复测） | **32** |
| 真实收口率 | **32/35 = 91%**（分母含未发布与部分修复） |
| 未收口 | 🟡 已修未发布 1（**F-29**，台账滞后于实际发布）· 🟡 验证不充分 2（**F-34** / **F-35**） |
| 未修 / 部分修复 | **0 / 0** |
| 验证强度分层 | 使用方独立复测 **24** · 框架方自证 **8**（待升级为 external） |
| 三方对齐 `check:cobuild` | ✅ 报告↔台账↔回执 12 轮全对齐 |

**框架方自证待升级的 8 条**：`F-10 / F-13 / F-14 / F-19 / F-20 / F-21 / F-24 / F-25`
—— 按共建铁律 3，**框架方自测不算独立验证**，需使用方在自己工程跑最小复现才能翻 `external`。

---

## 7. 三条建议（按优先级）

### P0 · 修 `gen-content.mjs` 的解析数据源（**当前红灯，且是"危险红灯"**）

改一行：把 `capability-types.ts` + `capability-bridges.ts` 并入 `apiSrc`（已实证 → DRIFT 0）。
**顺序必须是"先修数据源、再 `gen:content`"**，否则会把 84 页的 Web/MP 声明改错。

### P1 · 把"生成器↔源码"的隐式契约变成显式门禁

本轮两处漏判（§3 正则、§4 数据源）**是同一类**：
生成器用文本解析源码，**拆文件 / 换声明风格**都会静默打断它，而**没有任何门禁盯这个契约**。
最小做法（二者选一，建议都做）：
1. 生成器改为**按符号名多文件检索**（找不到符号 ⇒ **直接报错**，而不是"静默得到空集"）——
   即"数据源缺失 = 硬失败"，与本仓「不静默」纪律一致；
2. 加一条自检：**`APP_BRIDGE_KEYS.size` 与 `capability-app.ts` 实抽方法数不一致 ⇒ 红**
   （今天 3 vs 13，正是这条能提前抓到的形态）。

### P2 · 修 App 端分档（8 项漏判）并同步 §2 矩阵

把 `APP_BRIDGE_KEYS` 的抽取从"一条正则"改为"方法简写 ∪ 属性箭头 ∪ 无 `get` 前缀的动词式"，
再 `gen:content` 重生成 ⇒ iOS/Android 从 3 ✅ → **11 ✅**。
顺带把 §2 表里的"鸿蒙 1/18"与页面 🟡 的口径对齐（当前是"桥已就绪（平台中立）——鸿蒙宿主壳未接线"）。

---

## 8. 复现命令

```bash
# ① 能力清单与优先级（84 能力）
npx tsx scripts/gen-capability-priority.mjs --check          # 预期：CHECK OK

# ② 宿主 invoke 契约覆盖率（android/ios/harmony）
node scripts/check-host-invoke-contract.mjs                  # 预期：android 17/18 · ios 13/18 · harmony 1/18

# ③ 降级声明面无空白格
node scripts/audit-degradation.mjs                           # 预期：unsupported 0 · fallback 可观察 148/148
node scripts/report-gaps.mjs --check                         # 预期：degraded 253 · unsupported 0（棘轮）

# ④ 外部报告闭环（退出 1 = 有未收口项，属预期）
node scripts/ledger-check.mjs --check
node scripts/cobuild-check.mjs --check                       # 预期：三方一致

# ⑤ ★红灯（当前 162）
npx tsx website/scripts/gen-content.mjs --check              # 预期：DRIFT 162（exit 1）

# ⑥ 聚合 84 能力页的跨端分档（临时脚本，无副作用）
#    见本报告 §2 数字，口径 = 各页「## 兼容进度」表的端行首符号
```

---

## 附：诚实边界

- 本报告的端分档来自**已发布的能力页**（对外声明面），§3 的"应判 ✅"来自**源码事实**；
  两者不一致时以**源码 + 宿主 `case` 存在性**为准，但**未做真机复测**（`check:host-runtime` 只覆盖生命周期组）。
- 未核实：`hosts/harmony` 能力族是否已有未合并的实现分支；Flutter 端是否有实测载体。
- 本报告**未**主张"App 面落后"：从 0 → 11 项 + 13 个宿主方法 + 18 条契约，进度是实的；
  欠的是**对外声明与代码事实的对齐**，以及**鸿蒙壳**。
- 探针均在 `--check` 模式（只读）下运行，跑完即删；仓库 `website/` 目录事后核验为干净。
