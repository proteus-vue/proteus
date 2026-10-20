# 01 · 现有资产与缺口（逐条取证）

> 目的：本方案里每一句「已有」都必须能指到 `文件:行`，每一句「缺口」都必须给出 grep 命中数。
> 取证日期：2026-10-20 · 与调研文档 `docs/Proteus_TV端验证方案与可行性调研.md` 交叉核对，**修正其 3 处表述**。

---

## 1. 已有资产（可直接复用，不改）

| # | 资产 | 位置 | 实测内容 |
|---|---|---|---|
| A1 | **TV 形态画像** | `packages/fluid/src/formfactor.ts:491-511` | `form:'tv'` · `input:'remote'` · `topology:'hero-focus-row'` · `nav:'focus-row'` · `safe:{side:96,bottom:54}`（overscan）· `viewport:1920×1080` · `distance:'10ft'` · `visual.focus:'ring'` · `ratio.baseFont:18` · `caps{dpad,focusRows,multiCol}` |
| A2 | **几何焦点算法** | `packages/fluid/src/focus-nav.ts:50` | `navigateFocus(current, candidates, direction, opts)`；`FocusRect{id,x,y,width,height}`；已实现 ① 只取该方向候选 ② 打分 = 主轴距离 + 交叉轴偏移×`crossWeight`(默认 2) ③ 同行/同列优先（重叠 >50%）④ 无候选返回 null |
| A3 | **wrap 辅助** | `packages/fluid/src/focus-nav.ts:108` | `clampOrWrap(index, total, wrap)` —— 边缘环绕/钳制，纯函数 |
| A4 | **组件层接线** | `packages/components/p-formfactor/index.vue:396,422,448` | `keydown` 监听 → 方向映射 → `navigateFocus` → `focus()`；`has-dpad` 类（`:208`）放大热区；`:focus-visible` 提供焦点环（`:1280` 注释） |
| A5 | **形态容器进 IR** | `packages/component-ir/src/primitives.ts:59` | L26 `layout.formfactor`，`status:'implemented'` |
| A6 | **元素几何契约（三端）** | Android `hosts/android/.../HostCapabilities.java:267`（`element.rect`）· iOS `hosts/ios/ProteusHost/runtime/element-rect.swift` · 鸿蒙 `hosts/harmony/.../Superapp.ets:819`（`measureElementRect`） | 三端都能按 nodeId/selector 取内核矩形 ⇒ **焦点候选的几何来源已就绪** |
| A7 | **宿主→JS 推送通道** | `hosts/shared/bridge/entry-host-runtime.ts:548` | `__proteusHostAppEvent(type, payload)` 已存在并被使用（同模式见 `packages/render-backend/src/screen-executor-host.ts:35`） |
| A8 | **JS 长任务采样器** | Android `JsTaskSampler.java` / iOS `js-task-sampler.swift` | 阈值 50ms、环形 64、**9 字段逐项同名**（决策 #1098）；报告字段 `jsTasks` |
| A9 | **mount 相位读数** | iOS `SelfDrawView.mountPhaseStats()` / Android `VaporRenderHost.last*Ms` | `measure/layout/wrap/emit/scroll` + `mount_host_ms`（决策 #1100–#1101） |

**⇒ 结论：算法、画像、几何、通道、量具五样齐备。缺的只有「入口」与「视觉」。**

---

## 2. 缺口（每条给命中数，可复现）

| # | 缺口 | 取证命令 | 结果 |
|---|---|---|---|
| G1 | **宿主零按键入口** | `grep -rn "onKeyDown\|dispatchKeyEvent\|KEYCODE_DPAD" hosts/ --include="*.java" --include="*.swift" --include="*.ets"` | **命中 0** ⇒ 遥控按下，App 收不到 |
| G2 | **App 无 `:focus` 状态伪类** | `docs/generated/css-capability-sources/app-profile-features.json` → `features[40]`（`id:"selector-pseudo-state"`） | `today:"absent"` · `strategy:"降级"` · 备注「需运行时状态通道」 |
| G3 | **App 无 `@container`** | 同上（无 container-query 条目） | `packages/components/p-formfactor/index.vue:1093` 用了 `@container (max-width:559px)` ⇒ TV 拓扑收紧要降级 |
| G4 | **布局内核无焦点概念** | `grep -rn "formfactor\|focus" packages/layout-core-rust/src` | 无命中 ⇒ 焦点必须在**上层**用「内核 rect + 纯函数」算（可行，见 A2） |
| G5 | **清单非 TV 应用** | `grep -c "LEANBACK\|banner\|touchscreen" packages/cli/templates-host/android/AndroidManifest.xml` | **0** ⇒ 电视桌面不显示图标（`adb install` 仍可跑，S1 够用） |
| G6 | **仅 arm64** | `hosts/android/build-runtime-aar.sh:36-49` | 只编 `aarch64-linux-android` ⇒ 32 位盒子装不上 |
| G7 | **`useVideo` 未实现** | `packages/component-ir/src/primitives.ts:236`（C61）· `packages/api/src/capability.ts:862` | `status:'planned'` ⇒ TV demo 不能用视频 |
| G8 | **无遥控原语** | `grep -n "useKey\|useRemote" packages/component-ir/src/primitives.ts` | 只有 C14 `useKeyboard()`（**软键盘高度**，语义不同）⇒ 需**新增**能力原语 |
| G9 | **TV001-004 规则未实现** | `grep -rn "TV001\|TV003" packages/` | 仅规约表 `docs/proteus-architecture.md:370` 有编号，**无校验实现** |

---

## 3. 对调研文档的三处修正

| # | 原文表述 | 实测 | 修正后 |
|---|---|---|---|
| M1 | 「App CSS 无 `:focus-visible`」 | 能力表里**根本没有 `focus-visible` 这一条**；缺的是 `selector-pseudo-state`（`:hover/:focus/:checked`） | 「App 无 **`:focus` 状态伪类**（能力表 `selector-pseudo-state = absent`）」——否则验收会对一个不存在的条目做 |
| M2 | 「长按重复 10+ 次/秒」作为 S1 判据 | `adb shell input keyevent` 是**单次 down/up**，`repeatCount` 恒 0 | 改为「离散 N 次」+ 可选宿主 dev 合成 repeat（详见 `04-verdict-and-harness.md` §2） |
| M3 | S1 判据 #4「最长任务 <50ms」 | 实测 iOS mount 30–93ms 而 **JS 同步段仅 ~3ms**（决策 #1099/#1100） | 拆成「首屏 mount」与「稳态按键响应」两栏，**先归因 JS vs 宿主**再定优化对象 |

> ★M2/M3 属同一族错误：**量具造不出被测条件 / 读数归错层**。本仓已有三次同类教训（#1100 末次读数、
> #1103 首遍读数、#1105 逐点差异）。

---

## 4. 资产 → 批次映射

| 资产 | 用在哪个批次 |
|---|---|
| A1 画像 | B5（跨端一致性时按 `F=remote` 选路径） |
| A2/A3 算法 | **B2**（原语化的对象） |
| A4 组件 | B3（改为消费原语，Web 行为不变） |
| A6 几何 | **B1/B4**（候选矩形、滚动跟随） |
| A7 通道 | **B1**（key 事件上行） |
| A8/A9 量具 | **P5 归因**（判据装置） |
| G1 | B1（新增） |
| G2/G3 | B3（渲染器画环 + 拓扑降级） |
| G8 | B1（新增能力原语，需编号登记） |
| G9 | B2（TV001/TV003 校验） |
