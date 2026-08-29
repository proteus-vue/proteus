# 组件库落地评估与批次重排（v2）

> 状态：已落地（2026-08，对照当前代码库现实修订 Draft v1）  
> 前置：`00-overview.md`（Draft v1 架构/铁律）、`01-component-matrix.md`（三端矩阵唯一真相源）  
> 结论先行：**Draft v1 架构大方向成立，但「L2 渲染抽象」与当前「标准 SFC + 既有编译管线」的组件机制脱节，且 B4/B5/B6 依赖的 appBar / Worklet / 支付能力尚未实现** —— 本文做对照修正 + 批次重排，随后按 B1 起逐批攻破。

---

## 1. 现状核对（Draft v1 假设 vs 当前代码库事实）

| # | Draft v1 假设 | 当前事实 | 结论 |
|---|--------------|----------|------|
| 1 | L2 需要独立三端渲染器目录（`runtime/{web,skyline,app}`） | 内置组件 = **标准 Vue SFC**，Web 端原生 Vue 渲染，MP 端走既有编译管线（SFC → WXML + JS + component.json）；无平台渲染器概念 | ❌ 取消渲染器目录 —— 组件就是 SFC |
| 2 | 组件自带 `transform.ts`（每组件编译规则） | 编译管线已内置：`tag/unknown-kebab` kebab 直通 + gen-routes 自动扫描模板 → `usingComponents: { "<tag>": "/proteus/<tag>/index" }`（`gen-routes.ts` L382-466）+ 插件产物 `proteus/` 前缀；Web 侧 `@proteus/components` 精确别名聚合导出 | ⚠️ 简化 —— 新增组件默认**零编译规则**；只有特殊映射（如 fixed 转换）才登记规则 + AI 说明书 |
| 3 | 组件目录 = `packages/components`（独立 npm 包） | 决策 #115：组件暂留工程内 `src/components/`（`componentsDir` 选项），`@proteus/components` 别名已配；**v2.0 才拆包**（plugin-vite L166 注释） | ✅ 维持现状 —— 拆包留 v2.0，本规划不推动拆包 |
| 4 | `p-nav-bar` 依赖 appBar（Router M5） | Router B5（app codegen/appBar）**⬜ 待 v0.6** | ⏸ 降级 —— 首期 `p-nav-bar` 用普通组件（fixed 定位 + 自定义返回），appBar 集成标注 v0.6 |
| 5 | `p-popup` 转场走 Worklet `applyAnimatedStyle`（Router M7.4） | Worklet 转场调度器未实现（router B10 ⬜） | ⏸ 降级 —— 首期 **CSS transition + Transition 运行时等价**（vue-compat-advance B5/B6 已实现：进入+离开动画状态机），Worklet 后接 |
| 6 | `p-toast/p-loading` 走 Worklet 自定义组件（API A9） | API A9（反馈 UI）未实现 | ⏸ 降级 —— 首期复用 `p-popup` 渲染管线，API 层后接 |
| 7 | `p-payment-sheet` 依赖 `api.payment`（A5） | API B1-B4 仅 request/device/auth；**A5 支付未实现** | ⏸ 移出 P0 首期，标注依赖 API P1 |
| 8 | `p-login-gate` 读 `api.auth` + Router guard | `createAuth` 已实现（security M2）✓、Router requiresAuth 守卫已实现 ✓ | ✅ 依赖就绪，可进 P0（但排在基础组件后） |
| 9 | 能力探测注入 `app.config.globalProperties.$capability` | runtime 已有 `debug-flag` / `setDataBridge` 等轻量机制 | ⚠️ 修正 —— 能力探测做成**组件层轻量模块**（`src/components/runtime/capability.ts`，惰性单例，MP 端走共享模块 B0 机制），组件内直接 import 使用，不走全局注入 |
| 10 | 每组件一份 `IR → 双端产物` 文档 | 矩阵（01）已是唯一真相源，CI 校验 | ✅ 维持 —— 回填矩阵即可，不单独建 ir.md |

**核心机制（已就绪，新增组件的完整路径）**：
```
新增内置组件三步：
① src/components/<tag>/index.vue      ← 标准 Vue SFC（双端同源码）
② src/components/index.ts 聚合导出    ← Web import { Xxx } from '@proteus/components'
③ 01-component-matrix.md 回填矩阵    ← CI 唯一真相源
（MP 端零改动：kebab 直通 + gen-routes 自动 usingComponents /proteus/<tag>/index）
```

---

## 2. 命名决策（待拍板，建议如下）

Draft v1 用 `p-` 前缀（p-view/p-text/...）。当前唯一内置组件为 `virtual-list`（无前缀，examples 已引用）。

**建议**：
- 新组件统一 **`p-` 前缀**（`p-view`/`p-text`/`p-image`/`p-scroll-view`/`p-button`/`p-input`/`p-textarea`/`p-mask`/`p-popup`/`p-toast`/`p-loading`/`p-nav-bar`/`p-skeleton`/`p-error-boundary`）—— 与 Draft v1 对齐，且 `p-` 前缀天然避开原生标签命名冲突（`button`/`input`/`image` 是 MP 原生标签）。
- `virtual-list` **保留原名**（兼容既有示例/产物），其通用化演进目标 `p-list-view` 作为新组件别名共存；虚拟滚动核心抽为共享 composable，两个标签复用同一实现。
- 组件文件名 = 标签名（`p-view/index.vue`），与既有 `virtual-list/index.vue` 目录约定一致。

> 若拍板「全部去掉 p- 前缀」，则 p-view→view 会与原生标签冲突（MP 端 `<view>` 是原生容器），需要别名机制，复杂度上升 —— 故建议维持 p- 前缀。

---

## 3. 批次重排（8 批 → 按当前可落地性重排）

依赖图（重排后）：
```
B1(契约+能力探测) ─→ B2(基础组件 a: view/text/image/button) ─→ B3(scroll-view + list-view)
                                                              ↘ B4(表单 input/textarea)
                                                              ↘ B5(弹层 mask/popup/toast/loading)
                                                              ↘ B6(导航 nav-bar + 骨架 skeleton + error-boundary)
B7(性能加固) ← B3          B8(可观测 + CI 审计) ← B2-B6
```

| 批 | 交付物 | 依赖 | 关键降级/说明 |
|----|--------|------|--------------|
| B1 | 组件契约（`src/components/contracts`：BaseProps/事件命名/插槽规范）+ 能力探测（`src/components/runtime/capability.ts`：backend 判定 + has/detect + capabilityWarn 降级告警）+ 单测 | — | ✅ 已落地（2026-08，8 用例）；对齐 02-platform-capability.md；不做渲染器目录 |
| B2 | `p-view` `p-text` `p-image` `p-button` + 矩阵回填 + 快照测试 | B1 | `position:fixed` 编译期转换警告留 B5 一并评估（涉及 compiler transform）|
| B3 | `p-scroll-view` + `p-list-view`（virtual-list 通用化：item-key/虚拟开关/懒加载）| B2 | Skyline 滚动容器必备；复用既有 virtual-list 实现抽 composable |
| B4 | `p-input` `p-textarea`（v-model 双向 + 事件归一）| B2 | MP 原生 input/textarea 映射 |
| B5 | `p-mask` `p-popup` `p-toast` `p-loading`（弹层体系）| B2 | 转场 = CSS transition + Transition 运行时等价；Worklet 标注 v0.6 |
| B6 | `p-nav-bar`（普通态）`p-skeleton` `p-error-boundary` | B2 | nav-bar appBar 集成标注 v0.6；error-boundary 用 Vue errorCaptured |
| B7 | 性能加固：懒加载/长列表/内存/降级完整 warn | B3 | 对齐 06-m7-performance.md |
| B8 | 可观测 + `proteus audit component`（C3/C4/C8 审计门禁）| B2-B6 | 对齐 07/10；DRY：audit 复用 capabilities:check 基础设施 |

**移出 P0 首期（依赖未就绪，标注后接）**：
- `p-player-bar`（全局常驻 → appBar，Router B5 待 v0.6）
- `p-payment-sheet`（`api.payment` A5 未实现）
- `p-login-gate`（依赖已就绪，但优先级低于基础组件，可进 B6+）

---

## 4. 能力探测（B1 核心交付物，对齐 02 文档修正）

```ts
// src/components/runtime/capability.ts —— 轻量模块，组件内直接 import（惰性单例，不全局注入）
export interface PlatformCapability {
  backend: 'web' | 'skyline' | 'app'        // 启动期确定（web=无 wx；skyline=typeof wx!=='undefined'；app 占位 v0.6）
  has(name: CapabilityName): boolean        // 同步能力，setup() 求值一次缓存
  detect(name: DynamicCapability): Promise<boolean>  // 异步（基础库版本等）
}

export type CapabilityName =
  | 'worklet-animation'   // 当前恒 false（Worklet 未实现），弹层走 CSS transition
  | 'recycle-manager'     // Skyline 长列表（当前恒 false，list-view 用 JS 切片）
  | 'native-toast'        // wx.showToast / Toast API
  | 'webp'                // 图片格式
  | 'passive-event'       // 被动事件监听（Web）

// 降级铁律（C6）：⚠️/❌ 能力必须 console.warn('[Proteus][p-xxx] ...')（capabilityWarn），禁止静默失效
// 已实现（B1）：backend 判定 + has 能力表 + detect 兜底 + capabilityWarn；tests/component-capability.test.ts 8 用例
```

> 说明：Skyline 渲染器差异（Skyline vs WebView）由 `has('worklet-animation')` 等能力表承载，backend 只到平台级（wx 存在即 skyline）；`wx.getRenderer` 等真机 API 不作为组件判定依据。

---

## 5. 验收（P0 修订）

1. 每个已落地组件：`01-component-matrix.md` 矩阵条目回填完整（CI 校验脚本核对组件清单）。
2. 双端构建全绿：新增组件 Web import 可用 + MP `usingComponents: /proteus/<tag>/index` 产物正确。
3. 降级显式：所有 ⚠️/❌ 能力路径有 `console.warn` + 单测断言。
4. `virtual-list` 既有行为零回归（兼容别名）。
5. 每批独立提交，验证 = `npm run verify` 全绿 + snapshot-template 无漂移。

---

## 6. 进度追踪

| 批 | 状态 | 说明 |
|----|------|------|
| B1 契约 + 能力探测 | ✅ 已落地 | 2026-08，8 用例（contracts + capability.ts） |
| B2 基础组件 a（view/text/image/button）| ⬜ | — |
| B3 scroll-view + list-view | ⬜ | virtual-list 通用化 |
| B4 表单（input/textarea）| ⬜ | — |
| B5 弹层（mask/popup/toast/loading）| ⬜ | CSS 转场 |
| B6 nav-bar/skeleton/error-boundary | ⬜ | — |
| B7 性能加固 | ⬜ | — |
| B8 可观测 + audit | ⬜ | — |
