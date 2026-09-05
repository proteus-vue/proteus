---
title: 能力系统
order: 18
group: 渲染与能力
---

# 能力系统

扫码、定位、分享、剪贴板——每个端都有原生 API，但业务里一旦写下 `wx.scanCode` / `navigator.clipboard`，平台分支就开始污染业务代码。Proteus 能力系统（`@proteus-vue/capabilities`）把「平台能力」收敛为统一契约：业务只写 `useCapability('id')`，适配与降级全部收敛在能力定义里。

> **业务代码只依赖能力接口，零平台分支。**
> 缺失能力显式降级或显式报错，绝不静默；能力缺失在编译期就可见。

## 能力声明模型

能力由一份**描述文件**（`capabilities/*.capability.ts`）声明：`meta`（id / tier / name / permissions / required）+ `adapters`（各平台实现工厂）+ 可选 `fallback`（降级能力 id）：

```ts
// capabilities/share.capability.ts
import { defineCapability } from '@proteus-vue/capabilities'

export default defineCapability({
  meta: { id: 'share', tier: 2, name: '分享' }, // kebab-case id，编译期校验
  adapters: {
    web: () => ({
      capability: 'share',
      platform: 'web',
      // feature detection：不得在模块顶层执行平台 API，延后到调用
      isSupported: () => typeof navigator !== 'undefined' && 'share' in navigator,
      create: () => ({ isSupported: () => true, invoke: () => navigator.share({ title: document.title }) }),
    }),
    skyline: () => ({
      capability: 'share',
      platform: 'skyline',
      isSupported: () => typeof wx !== 'undefined',
      create: () => ({ isSupported: () => true, invoke: () => wx.showShareMenu({ menus: ['shareAppMessage'] }) }),
    }),
  },
  fallback: 'clipboard', // 全平台探测失败 → 递归解析 clipboard 能力
})
```

`tier` 是能力等级的诚实分级：

| Tier | 含义 | 例子 |
|---|---|---|
| L1 | 通用：各端都有原生对应 | 存储、剪贴板 |
| L2 | 映射需适配：语义统一，各端映射实现 | 分享、扫码 |
| L3 | 平台独占：仅部分端可用 | 微信登录（`login.wechat`） |
| L4 | 实验：接口可能变化 | —— |

描述文件不合法当场抛错：`validateCapabilityDefinition` 校验 id 格式（kebab-case）、tier 取值、adapters 非空（平台限定 `web` / `skyline` / `app`）、fallback 类型；降级目标是否真实存在由 `CapabilityRegistry.validate()` 校验（fallback 必须已注册）。

## 运行时检测与选择

Adapter Registry（`CapabilityRegistry`）按固定策略解析能力：**platform 过滤 → priority 降序 → `isSupported()` 逐个探测 → 命中第一个；无命中 → fallback 递归解析**。业务侧唯一入口：

```ts
import { useCapability, resolveCapability, matchPlatform } from '@proteus-vue/capabilities'

// 同步解析（isSupported 为同步的 adapter）
const share = useCapability('share')
if (share.isSupported()) {
  share.api.invoke('标题')
} // 缺失但不 required：返回 unsupported 包装（isSupported false），不崩溃

// 异步完整解析（支持异步探测 + fallback 递归）
const cap = await resolveCapability('share')

// 平台守卫（铁律 #4：替代 #ifdef）——三端必须穷尽，缺分支编译报错
const label = matchPlatform({
  web: () => '浏览器端',
  skyline: () => '小程序端',
  app: () => 'App 端',
})
```

降级分两级（B4 错误模型，不静默）：

| 场景 | 行为 |
|---|---|
| 非 required 能力缺失 | `unsupported` 包装：`isSupported()` 为 false，调用抛 `CapabilityError('UNSUPPORTED')` |
| required 能力缺失 | 直接抛 `CapabilityError('UNSUPPORTED')`，阻断流程 |
| 权限被拒 / 不可用 | `CapabilityError('PERMISSION_DENIED' / 'UNAVAILABLE')`——显式错误模型 |

`CapabilityError` 携带 `code` / `capability` / `platform` / `reason`，DevTools 可注入 `CapabilityTraceBus` 观测每次 `capability.detect` 探测与降级事件，`registry.snapshot()` 输出全部能力在当前平台的支持状态表。

## 编译期：manifest 与缺口检查

能力不只是运行时契约，编译期有两道机器门禁（node 子路径，不进运行时产物）：

1. **manifest 扫描**（`@proteus-vue/capabilities/scan`）：递归收集 `capabilities/*.capability.ts` → `capability-manifest.json`（每条含 id / tier / platforms / fallback / source 源文件路径——产物可追溯），与 CLI `capabilities:manifest` 共用。
2. **引用缺口检查**（`@proteus-vue/capabilities/check`）：扫描业务代码的 `useCapability('id')` / `resolveCapability('id')` 引用，对照 manifest 平台覆盖：
   - `missing`：业务引用了、但当前平台没有 adapter → 编译期报错/警告；
   - `gaps`：manifest 有能力、但当前平台没 adapter → 覆盖缺口清单。

```bash
# ① 能力清单 + 平台缺失报告（--platform web|skyline|app 追加缺口检查）
proteus capabilities:manifest --platform web
# ② 平台 API 裸调用静态检查：业务目录禁止 wx.* / window.*
#    （capabilities / adapters / platforms 目录豁免；skyline/app 文件禁 window.*，web 文件禁 wx.*）
proteus capabilities:check
```

平台裁剪原则：**业务代码不变，产物只含当前平台 adapter**——运行时 registry 已按平台探测选择。

## 能力门控与 conformance

「显式声明能力」是 Proteus 一致性验证的地基，同一个模式贯穿三层：

- **编译器 conformance（G-38）**：42 项契约测试（C-01~C-10）按后端能力声明门控——`capabilities.x = false` 时对应项为 **SKIP 而非 FAIL**（如 `incremental: false` → C-06 增量编译组全部 SKIPPED）。诚实声明让「未实现」与「实现坏了」机器可分。
- **渲染后端（G-27）**：`BackendCapabilities` 八字段诚实声明，**未声明 = 不支持**，框架按能力降级（L3→L2→L1→solid），不按 if/else 判平台。
- **能力系统（本篇）**：adapter 必须实现 `isSupported()` 探测，缺失能力走显式降级链，不静默失败。

模板侧还有一个能力入口：`p-scan-qr` / `p-pick-photo` / `p-location` 等 `capability.*` 语义组件会被编译器收集进 `CompilerIR.bindings.capabilities`（见[编译管线](/docs/26-compiler-pipeline)），供 G-28 能力调用链消费——声明式与命令式两条路共享同一张能力表。

## 下一步

- [平台 API](/docs/19-platform-api)：storage / router / ui / request 四域的统一运行时
- [一致性验证](/docs/29-conformance)：能力声明如何锚定每层 conformance
- [容器与宿主](/docs/33-containers-hosts)：能力宿主在 Platform 三元组中的位置
