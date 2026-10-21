# 跨端契约索引（改这里，必须跑这些）

> ★★★决策 #1137 · 2026-10-20 · 目的：**降低单会话认知负载**
>
> ## 为什么需要这张表（这不是"再加一份文档"）
>
> 本仓的跨端契约（线格式 / Invoke ABI / Vapor 三端 / 桥源副本 / golden）**每一处都要求"改一处、同步 N 端"**。
> 这些要求**已经写在各自门禁的头注释里**——但它们是**分散的 5~10 个脚本**：
> 新会话要一次性回答"我改了这个文件，到底要跑哪几条门禁"，得**逐个打开脚本读头注释**。
>
> **实测代价**（#1134 加一个线格式 tag）：
> - 改动面 **42 个文件**（五端编解码器 + 黄金向量 + 两端宿主 + 框架层 + 判据 + 文档）；
> - 全程需要**记住**：五端 tag 编号一致、`false` 不写 tag、prebuilt 要同步、探针要登记三处、字段要穿四层白名单……
> - 其中**两条**是事后才被门禁抓出来的（prebuilt 漏同步、探针登记漏三处），**都不是当场发现的**。
>
> ⇒ 症结不是"代码太多"，而是**跨端约束的触发条件没有单一入口**。
> 本表把"文件 → 必须跑的门禁"做成**一张可 grep 的表**，并配判据 `check:contract-index`
> （表中路径必须真实存在、门禁必须真实存在、且**每条跨端门禁都必须在表内**——防表腐化）。

## 怎么用（新会话的最短路径）

```bash
# ① 我改了哪些文件？
git status --short && git diff --name-only origin/main

# ② 这些文件命中哪条契约？（grep 本表第一列）
grep -n "packages/api/src/invoke-wire" docs/contract-index.md
#   ⇒ 命中 "线格式" 一节 ⇒ 跑那节列的门禁

# ③ 一次性看全部契约（不知道该 grep 什么时）
sed -n '/^## /,/^## /p' docs/contract-index.md | head -60
```

★**更省的办法**：`pnpm check:contract-index -- --for <path>` 会直接告诉你该跑哪些门禁
（本表就是它的数据源）。

---

## ★ 最小可闭环单元（决策 #1139）——「只读 3 段就改对」

**这是整套索引的目的**：用户原话「下次会话能不能**只读 3 个文件就改对**？」

实测答案：**能**。改一个线格式 tag，五端编解码器合计 **2734 行**，但每端真正要动的
只有**三处**（常量 / encode / decode）；探针能直接给出行号区段：

```bash
pnpm check:contract-index -- --unit tag:Redirect
# ⇒ 五端各打印「常量 123 · encode 312 · decode 377（读 L115-131 / L304-320 / L369-385）」
#   ★最小读面：约 255 行（而非整文件 2734 行）= 9%
#   ★必须跑：pnpm check:invoke-wire-parity
```

★**探针自己的两个坑（都已修，判据 `tests/contract-units.test.ts` 守着）**：
  ① **去程/回程命名不同**：去程 `TAG_*` / `MetaTagInvoke.*`，回程 `RTAG_*` / `MetaTagResolve.*`
     ——首版只认去程 ⇒ 查 `StreamSeq`/`HttpStatus` 时 encode/decode 全空（**误导人漏读，比不查更糟**）；
  ② **TS 用帕斯卡、四端用大写下划线**（`MetaTagInvoke.Redirect` vs `TAG_REDIRECT`）
     ⇒ 同一个工厂不能同时收两种形态，必须按端转换。

★当前可查的单元**两类**：

**A. 线格式 tag**（去程 `Redirect`/`SavePath`/`UploadPath`/`Stream`，
回程 `StreamSeq`/`HttpStatus`/`Reason`/`Missing`/`Pending`/`Headers`）。

**B. useFetch 字段（四层链）**（`redirectManual` / `savePath` / `onChunk` / `signal` / `method` …）：
```bash
pnpm check:contract-index -- --unit fetch-field:redirectManual
# ⇒ ① 门面类型 ② 桥参数 ③ App args ④ 线格式归类 —— 四层各给 文件:行号（每层读 13 行 ≈ 52 行）
```
★**为什么这类最需要"给位置"**：#1134 实测 `redirectManual` 前三层都加了，**唯独第③层漏了**
⇒ 宿主永远收不到 ⇒ 真机读数 `manual_status=200`（仍跟随），而 Web 层 16/16 全绿。
**漏一层的表现是功能静默失效，不是报错。**

★**探针的正当排除**：`onChunk`（走流式通道）/ `signal`（走参数通道）**不落 meta** ⇒
第④层标 `○` 而不是 `✗`。清单 SSOT = `NOT_IN_META_FIELDS`（与 `tests/fetch-wire-fields` 同源）。

新增契约点只需在 `scripts/lib/contract-units.mjs` 加一行（tag）或一条 layer 定义（字段链）。

**C. Vapor 槽位**（三端 + 17 项指纹，**最复杂的一类**）：
```bash
pnpm check:contract-index -- --unit vapor-slot
# ⇒ 五层（编译期×2 / 运行时 / 桥 / 夹具）+ 每层的行号区段（巨型文件必给）
#   + 三端证据是否在 + 三端重跑入口 + 必须跑的门禁 + 会被比对的指纹项
```
★**这一类不能一条命令闭环**：三端要真机/模拟器（USB / hdc / devicectl），CI 跑不了。
探针会**显式打印这句话**，防止 AI 以为"跑完命令就算完事"。
★**巨型文件必须给区段**（否则"5 层"会退化成通读 1 万行）：
  · `packages/compiler/src/vapor/template.ts`（4651 行）只看 `L3670-3694 / L3747-3771`；
  · `hosts/android/bridge/entry-vapor.ts`（3713 行）只看 `L315-339 / L320-344`。
★**探针自己的缺陷（实测抓出）**：首版只在 `anchors` 存在时才检查区段是否命中
⇒ **删掉 anchors 后静默通过**（探针 exit 0、判据全绿）。现在"行数 >1000 却没有 anchors ⇒ 直接判红"。
★**三端证据的纪律**：必须**同一轮**跑出——陈旧证据冒充新证据是本仓实测过的形态。

## 1. 二进制线格式（invoke 通道）——五端逐字节等价

**触发**：改了 `meta` TLV tag / 帧布局 / 版本号 / 任一端编解码器。

| 侧 | 文件 |
|---|---|
| TS（SSOT） | `packages/api/src/invoke-wire.ts` |
| Java（Android） | `hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/InvokeWire.java` |
| Swift（iOS） | `hosts/ios/ProteusHost/runtime/InvokeWire.swift` |
| ArkTS（鸿蒙 JS） | `hosts/harmony/host-app/entry/src/main/ets/runtime/InvokeWire.ts` |
| C++（鸿蒙宿主） | `hosts/harmony/host-app/proteus_render/src/main/cpp/invoke_wire.h` |
| 黄金向量 | `scripts/invoke-wire-golden.ts` |

**必须跑**：`pnpm check:invoke-wire-parity`（36 条向量 × 五端；破坏验证：任一端 tag 抄错 ⇒ 红）

**★纪律**：新增 tag 时**向量必须成对**（`true` 写 tag / `false` 不写 tag），否则"把 false 也写成 tag"的实现会漏网。

---

## 2. 宿主 Invoke 方法契约（screen.* + 能力族方法名）

**触发**：任一宿主新增/改名 `proteusHost.invoke` 的方法。

| 侧 | 文件 |
|---|---|
| 契约 SSOT | `packages/render-backend/src/host-invoke-contract.ts` |
| Android | `hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/`（整个目录） |
| iOS | `hosts/ios/ProteusHost/runtime/`（整个目录） |
| 鸿蒙 | `hosts/harmony/host-app/proteus_render/src/main/cpp/host_app_runtime_impl.h` |

**必须跑**：`pnpm check:host-invoke-contract`（方法 ⊆ 契约 + `screen.*` 三端一致 + 覆盖率如实报缺）

---

## 3. Vapor 三端同步（编译器 + 槽位运行时 + 桥 + 夹具）

**触发**：动 `packages/compiler/src/vapor/*` · `packages/slot-runtime/*` · `hosts/android/bridge/entry-vapor.ts` · `hosts/android/gen-vapor-fixture.mjs`。

**必须跑**（三端都要重跑并提交结果，CI 复算判据）：
```bash
bash hosts/android/run-vapor.sh        # Android（USB 设备）
bash hosts/harmony/run-vapor.sh        # 鸿蒙（hdc 设备）
bash hosts/ios/run-selfdraw.sh --vapor # iOS
pnpm check:vapor-three-end              # 证据齐 + 同一判据三端全过 + 17 项指纹一致
```

**★为什么必须三端**：Vapor 能力在**平台无关共享包**里 ⇒ 只跑一端时，另一端是**推断**不是**证据**。

**另需**：`pnpm check:vapor-capability`（Vapor 能力面登记齐全——新增能力不登记 ⇒ 该能力在判据里不存在）。

---

## 4. 桥源「真源 ⇄ CLI 随包副本」

**触发**：改 `hosts/shared/bridge/**` 任一文件（尤其 `hosts/shared/bridge/entry-superapp.ts` / `hosts/shared/bridge/entry-superapp-probes.ts`）。

| 侧 | 文件 |
|---|---|
| 真源 | `hosts/shared/bridge/entry-superapp.ts` |
| CLI 随包副本 | `packages/cli/templates-host/shared/bridge/entry-superapp.ts` |

**必须跑**：`node scripts/sync-host-bridge.mjs`（真源 → 副本）· `pnpm check:bridge-sync`
**★后果（不改会怎样）**：框架测试走真源、外部用户走副本 ⇒ **改了真源没同步 ⇒ 外部用户跑旧逻辑**（#666 的初衷被击穿）。

---

## 5. 鸿蒙 runtime prebuilt 副本

**触发**：改 `hosts/harmony/host-app/proteus_render/**` 任一文件（含 `hosts/harmony/host-app/proteus_render/src/main/cpp/invoke_wire.h`）。

| 侧 | 文件 |
|---|---|
| 真源 | `hosts/harmony/host-app/proteus_render/` |
| 随包副本 | `packages/cli/templates-host/prebuilt/harmony/proteus_render/` |

**必须跑**：`node scripts/harmony-runtime-prebuilt.mjs` · `pnpm check:harmony-runtime-prebuilt`
**★后果**：外部用户（无框架 checkout）拿到**旧运行时** ⇒ 宿主不认识新 tag ⇒ 该能力在鸿蒙端静默失效。
**★本轮实证**：#1134 加了 `TAG_REDIRECT` 却漏同步，是**门禁事后抓到**的（不是当场）。

---

## 6. 跨端 golden（布局 / 动画 / 能力 / 玻璃）

**触发**：改 golden 的**真源**（Rust 内核 / 契约 / 生成器）。

| golden | 真源 | 门禁 |
|---|---|---|
| 布局 golden（browser-layout） | `packages/layout-core-rust/tests/golden/` | `pnpm check:cross-end-golden` |
| 能力 golden | `packages/contracts/` | `pnpm check:capability-golden` |
| 动画颜色 | `packages/animation/` | `pnpm check:anim-color-golden` |
| StyleIR golden | 契约 + applier | `pnpm check:style-ir-golden` |
| 玻璃像素 | `packages/glass/` | `pnpm check:glass-pixel-parity` · `check:glass-parity-harmony` |

**★纪律**：golden 是**只读基准** —— 只改**源**再重生成，**不手改产物**。

---

## 7. `useFetch` 字段链（门面 → 线格式，四层白名单）

**触发**：给 `FetchConfig` 加字段。

| 层 | 文件 |
|---|---|
| ① 门面类型 | `packages/api/src/capability-fetch-types.ts` |
| ② 桥参数 | `packages/api/src/capability-fetch.ts` |
| ③ App args | `packages/api/src/capability-app-request.ts` |
| ④ 线格式归类 | `packages/api/src/capability-invoke.ts`（`splitFramePayload`） |

**必须跑**：`npx vitest run tests/fetch-wire-fields.test.ts`（断言四层齐全 + 管线字段不下传）
**★后果**：漏一层 ⇒ 功能**静默失效**（底层做了、门面传了、中间吃掉）。#1134 的 `redirectManual` 就是在**第 ③ 层**漏的。

**★加 `FetchConfig` 字段时额外确认「它属于哪一类」**（分错类会漏接或误传）：

| 类别 | 例子 | 落点 |
|---|---|---|
| 线格式字段 | `redirectManual` | 四层全加（④ `splitFramePayload` 要认识） |
| **管线字段** | `retry` / `priority` / `maxRedirects` / `onRedirect` / **`cache`** | 只到 ①②，**不得**进 ③④（App 线格式没有这些 tag）。SSOT：`scripts/lib/contract-units.mjs` 的 `PIPELINE_ONLY_FIELDS` |
| **翻译成内部头** | **`bypassPlatformCache`（#1149）** | 只到 ①②；`appHttpRequest` 把它翻成 `X-Proteus-Bypass-Platform-Cache: 1`，**宿主消费后必须从转发头剔除**（三端：`hosts/ios/ProteusHost/runtime/http-capability.swift` 设 `cachePolicy=.reloadIgnoringLocalCacheData` / `hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HttpCapability.java` 的 `applyRequestHeaders` / `hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http.h`） |

★#1149 实证：`bypassPlatformCache` 属第三类——若照"线格式字段"处理会污染请求头并外泄给业务服务端；
若照"管线字段"处理则 iOS 的 `URLCache` 不给让开 ⇒ 304 被系统合成、框架层永远看不到。

---

## 8. 真机探针登记（iOS）

**触发**：给 iOS 加一个新探针。

| 位置 | 文件 |
|---|---|
| ① 参数解析分支 / ② case 赋值 / ③ 转发清单 + `ANY_PROBE` | `hosts/ios/run-selfdraw.sh` |
| 探针配置表 | `hosts/ios/ProteusHost/shell/superapp-probes.swift` |

**必须跑**：`npx vitest run tests/host-probe-registry.test.ts`（三处集合必须相等）
**★后果**：漏任一处的表现是 **"报告永远是旧的"**（App 走常驻模式永不退出），**不报错**。#1134 三处全漏，连跑两轮空转。
★★**#1149 补的第四方**：该判据现在还把 `hosts/ios/ProteusHost/shell/superapp-probes.swift` 的 `argPrefix` 集合拉进来比对——
原判据只比脚本内部三处，**新探针只加进 Swift、脚本一处都不加时全绿**，而现场表现是
`--cache-probe=` 被当成设备 UDID ⇒ 安装失败（旧脚本还把失败原因 grep 掉了，下面一片空白）。
⇒ 新探针的四步：Swift `ProbeConfig` + 脚本解析分支 / case 赋值 / 转发清单。

---

## 9. 文档生成器（源文件集合）

**触发**：拆分/改名 `packages/api/src/*.ts` 或 `packages/*/src/*.ts`。

**必须跑**：`pnpm check:content`（84 能力页 + 78 组件页）· `pnpm check:docs-stats` · `pnpm check:reference`
**★后果**：生成器按**文件集合**扫源码 ⇒ 拆文件后源集合找不到 ⇒ 参数表/返回值表**整段消失**（#1123 实证：fetch.md 被删 38 行）。

---

## 10. 文件大小棘轮（AI 上下文容量的硬边界）

**触发**：任何新增源文件。

**必须跑**：`pnpm check:file-size` · `pnpm check:repo-hygiene`
**边界**：新文件硬上限 **1000 行**；存量棘轮**只减不增**（`scripts/file-size-baseline.json`）。

**`check:repo-hygiene` 管的是另一半**：构建产物（`target-qjs/` · `.rlib` · `.cdp-shots/` 等）**不得被跟踪**。
★后果：误入库会把 clone 体积撑大（#1136 实证：727 个文件 / 远端 clone 从 371MB 涨到 ~839MB）。
**★已知盲区（本索引实测发现）**：门禁扩展名白名单**不含 .h / .cpp** ⇒ 鸿蒙 C++ 宿主（
`hosts/harmony/host-app/proteus_render/src/main/cpp/host_app_runtime_impl.h` 1134 行、
`hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_render.cpp` 3701 行等 **7 个 ≥1000 行文件**）**完全在棘轮之外**。

---

## 附 2：这些节与 `test:coupled` 的 `gates` 同集（决策 #1138）

`scripts/test-coupling.mjs` 的 `COUPLING` 里有 **`gates`** 字段（**真跑 + 失败即红**）：
改到本节列的文件时，`pnpm test:coupled` 会**自动**跑对应门禁（约 20 秒），不需要你去查。

```bash
pnpm test:coupled -- --list   # 先看会跑哪几条门禁
pnpm test:coupled             # 真跑（门禁 + 配套测试）
```

★**本索引与本表必须同集**：索引给人/AI 读（含触发条件与后果），`gates` 给工具跑。
若某条门禁只在索引里、不在 `gates` 里 ⇒ 工具不会自动跑（只能靠人记得查索引）。

## ★ 附 3：巨型代码文件的「结构大纲」（决策 #1142）

**问题**：`check:file-size` 补上 C++ 后缀（h / cpp） 后暴露 4 个 C++ 源文件超 1000 行（最大 3958 行），
而**真正的认知瓶颈是单函数**——`proteus_render.cpp::renderCommandsImpl` = **834 行单函数**。
拆文件不解决"单函数 834 行"：要改其中一段仍须读整个函数。

```bash
pnpm outline:heavy                                    # 所有 >100 行的顶层块（找通读成本）
pnpm outline:code hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_render.cpp \
  --fn renderCommandsImpl                            # 该函数的内部段落 + 行号
```

实测：834 行函数被切成 **8 段**，改第一段只需读 **33 行**。

★★ **解析器踩过两个坑（都已修，判据 `tests/code-outline.test.ts` 守着）**：
  ① **必须先遮罩注释/字符串再数花括号**——该文件有条注释写着「首版用第一个 `}` 截断」，
     那个 `}` 把配对提前闭合 ⇒ **834 行算成 6 行**（照它改代码会只读 6 行、漏掉 830 行）；
  ② **缩进基准要跳过声明行**——声明行缩进 0，若拿它当基准，段注释（缩进 4）就判不出来
     ⇒ 834 行函数显示"无段落"（假绿：看着成功，实际没索引）。

**诚实边界（为什么只做索引不做拆分）**：鸿蒙宿主的行为判据**只有真机**（hdc），
而本机当前**无 hdc 设备** ⇒ 无法验证行为等价。本仓纪律：**没有判据就不动行为**。
⇒ 先把"改哪段读哪段"做到零风险，拆分留到有设备时（先用本工具定位，再拆 + 三端重跑）。

## 附：本索引的判据

`pnpm check:contract-index` 机器校验：
1. 表中**每个文件路径**真实存在（防改名后索引静默过期）；
2. 表中**每条门禁命令**在 `package.json` 里真实存在（防写错命令名）；
3. **每条跨端门禁都必须出现在表内**（白名单制：新增跨端门禁不登记 ⇒ 红）——
   这条是核心：**索引腐化比没有索引更糟**（它会让 AI 以为"查过了就没问题"）。

> ★诚实边界：本索引**只做导航**，不减少任何门禁的检查强度。
> 它解决的是"**我该跑什么**"，不解决"**跑得对不对**"（那是各门禁自己的事）。
