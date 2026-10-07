---
title: useWebAssembly（capability.webassembly）
group: 应用与生命周期
order: 7013
---

# useWebAssembly

★C82 WebAssembly：WASM 编译/实例化/校验（跨端归一，平台差异见 `WebAssemblyAPI` 头）。

【三端真实形态（已取证 + 双端真机验证）】MP 走 `WXWebAssembly.instantiate(path)`（基础库
v2.13.0+ · 只收**代码包路径** · 无 compile/validate）· Web 与 App-iOS(JSC) 走标准
`WebAssembly`（收字节 · compile/validate 齐备）· App-Android 由**宿主 wasm3** 执行
（QuickJS 无内建 WASM——真机 add(2,40)=42）。
⇒ 用 `supportsStreaming` / `supportsPathLoad` 两个能力位判断，**不要按平台名分支**。

> 能力原语 C82 · `capability.webassembly` · 返回 `WebAssemblyAPI` · **Hook 已实现**（API 就绪，双端桥见下表）

## 签名

```ts
useWebAssembly(): CapResult<WebAssemblyAPI>
```

## 返回值

`Promise<CapResult<T>>`——铁律：无回调、无 try/catch 义务，`res.ok` 分支处理：

| 属性 | 类型 | 说明 |
|---|---|---|
| `ok` | `boolean` | 成功 `true` / 失败 `false` |
| `data` | `WebAssemblyAPI` | 成功载荷（结构见下） |
| `error` | `CapError` | 失败时存在：`code`（机器码）/ `message`（人读原因）/ `cause`（原始异常） |

## 方法

| 方法 | 说明 |
|---|---|
| [`instantiate`](#instantiate) | 实例化 WASM 模块（**跨端归一的唯一入口**）。 不可用平台 / 来源形态不匹配 → `Err('webassembly.unsupported')`（不抛异常）。 |

### `instantiate`

```ts
instantiate(source: WasmSource, options?: WasmInstantiateOptions): Promise<CapResult<WasmModuleHandle>>
```

**说明**：实例化 WASM 模块（**跨端归一的唯一入口**）。
不可用平台 / 来源形态不匹配 → `Err('webassembly.unsupported')`（不抛异常）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `source` | `WasmSource` | 是 | — |
| `options` | `WasmInstantiateOptions` | 否 | 配置选项对象 |

**返回值**：`Promise<CapResult<WasmModuleHandle>>`

## 属性

| 属性 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `supportsStreaming` | `boolean` | 是 | 能力位：是否支持流式/字节编译（Web/App-JSC true；MP **false**——只收路径） |
| `supportsPathLoad` | `boolean` | 是 | 能力位：是否支持从代码包路径加载（MP true；Web/App **false**） |

## 类型引用

### `WasmInstantiateOptions`

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `imports` | `Record<string, Record<string, unknown>>` | — | 导入对象（`{ module: { name: value } }`）；缺省无导入 |

### `WasmModuleHandle`

★C82 WebAssembly：跨平台 WASM 模块编译/实例化/校验。

【为什么有它】WASM 是"一次编译、三端执行"的计算载体（图像处理 / 编解码 / 加解密 /
物理引擎等 CPU 密集逻辑），与 Proteus 的「一份源码多端」定位同源。

★★**平台真实能力（已取证，非按标准 Web API 假设）**——三端形态**有实质差异**：

| 端 | 入口 | 首参 | compile/validate | 证据 |
|---|---|---|---|---|
| MP（微信） | `WXWebAssembly.instantiate(path, imports)` | **代码包路径**（.wasm / .wasm.br） | ❌ **无** | 官方文档 + `miniprogram-api-typings/lib.wx.wasm.d.ts` |
| Web | 标准 `WebAssembly` | `BufferSource \| Response \| URL` | ✅ 有 | 平台标准 |
| App-iOS | JSC 内建 `WebAssembly`（与 Web 同形） | 同上 | ✅ 有 | **本机实测**：`validate(minimalModule)===true`，8 个 API 齐备 |
| App-Android | 宿主 **wasm3**（QuickJS 无内建 WASM ⇒ 宿主侧运行时） | `{ bytes }`（宿主通道） | ✅ 有（宿主实现） | **真机实测**：`add(2,40)===42`，真跑 i32.add（wasm3 解释器，MIT/无 JIT ⇒ 兼容 W^X） |

【因此本原语的设计取舍（★不是"照抄 Web 标准"）】
· **入口归一为 `instantiate(source)`**，`source` 是**判别联合**（`{ bytes }` / `{ path }`）——
因为 MP 只收路径、Web/App-JSC 只收字节，**没有**一个共同的首参类型可表达；
若强行只暴露字节，MP 端会**结构性不可用**（无法把路径变成字节，见下）。
· **`compile` / `validate` 声明为可选**（`?`）：MP 端**客观没有**这两个方法；
声明为必需会让 MP 端实现要么撒谎、要么抛错。诚实做法 = 调用方 `if (wasm.compile)` 探测。
· **`supportsStreaming` / `supportsPathLoad` 两个能力位**把这个差异变成**可查询的数据**，
而不是让调用方按平台名分支（平台名分支是本仓 stores 铁律禁止的形态）。

【诚实边界（明确不支持的）】
· MP 端**无法**从网络/字节流加载：官方只接受代码包内路径 ⇒ 动态下载 wasm 需先落包
（`useFileSystem` + 重新分包），本原语**不假装**能做。
· ★App-Android 的 JS 引擎（QuickJS）**内建无 WebAssembly** ⇒ 由**宿主侧 wasm3** 提供
（`webassembly.instantiate/call/release` 通道，`hosts/android/wasm/`）；iOS 的 JSC 内建
⇒ 走引擎路径。同一份 JS 桥 **两条路径都被真机验证**（结果都是 add(2,40)=42）。
· MP 端 export 支持 函数 / Memory / Table，**iOS 平台暂不支持 Global**（官方原文）。
· 本原语**不做** WASM↔JS 的自动编组（那需要 IDL）；只负责"拿到 instance"，调用面归调用方。

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `exports` | `Record<string, unknown>` | — | 模块导出的符号（函数 / Memory / Table；Global 依平台而定——见接口头） |
| `fromPath` | `boolean` | — | 该实例是否由**路径**加载（MP 端恒 true；Web/App 端恒 false） |

| 方法 | 签名 | 说明 |
|---|---|---|
| `dispose` | `dispose(): void` | 释放（暂无资源需释放——预留：WASM 实例由 GC 回收，本方法供未来池化实现统一出口） |

## 错误码

| code | 说明 |
|---|---|
| `webassembly.unsupported` | 桥未提供 getWebAssembly（useWebAssembly 不可用） |

> 平台不支持 → `*.unsupported` 族；业务按 code 分支处理，无需 try/catch。

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge 实现（平台 API 直连） |
| 微信小程序 | ✅ | skyline（WebView 降级） · wx 桥 → WXWebAssembly.instantiate（官方文档 performance/wasm） |
| Headless（SSR / 测试） | ✅ | headless · mock 桥注入（测试 / SSR 档） |
| iOS 原生 | 🟡 | native-ios（UIKit + CoreAnimation） · 渲染核心已落地——能力桥未接线 |
| Android 原生 | 🟡 | native-android（自绘 Canvas） · 渲染核心已落地——能力桥未接线 |
| 鸿蒙 | 🟡 | native-harmony（ArkUI RenderNode） · 渲染核心已落地——能力桥未接线 |
| Flutter 混合 | 🟡 | flutter · 同一 JS 逻辑层——能力桥未接线 |
| 快应用 | ⬜ | 快应用引擎（待定） · 端未开始 |

> 状态口径：✅ 端已落地·本能力可用；⚠️ 端已落地·桥未提供→Err 显式降级；🟡 能力桥未接线；⬜ 端未开始。端架构对照见 [端与成熟度](/docs/framework/ends-matrix)。

> 铁律：能力原语全部返回 `Result<T>`（无回调 / 无全局对象）；平台不支持 → `Err` 显式降级，业务零平台分支。

## 用法

```ts
const wasm = useWebAssembly() // 同步句柄——无 await、无 res.ok

if (wasm.ok) {
  // ★用能力位判断形态，不要按平台名分支：
  //   （小程序侧 WXWebAssembly 是**全局对象**——基础库 v2.13.0+ 起可用）
  //   MP 只收代码包路径（supportsPathLoad）；Web / App-iOS 收字节（supportsStreaming）
  const source = wasm.data.supportsPathLoad
    ? { path: 'wasm/image-filter.wasm.br' }   // 小程序：包内路径（支持 brotli）
    : { bytes: await fetch(url).then((r) => r.arrayBuffer()) } // Web / App-JSC：字节
  const inst = await wasm.data.instantiate(source)
  if (inst.ok) inst.data.exports.sharpen(width, height, amount)

  // compile / validate 是**可选**能力（MP 端无此二者）——先探测再调用：
  if (wasm.data.validate && (await wasm.data.validate(bytes)).ok) { /* ... */ }
} else if (wasm.error.code === 'webassembly.unsupported') {
  // 当前宿主无 WASM 引擎（如 App-Android 无 JS 引擎）→ 走 JS 降级实现
}
```

## 平台专栏

### 小程序（MP）

- **WXWebAssembly（路径加载）** — ★只能从**代码包路径**加载（.wasm / .wasm.br）——不支持字节/流式编译（能力位 supportsStreaming=false）

### Web

- **标准 WebAssembly（流式）** — instantiateStreaming 边下边编译（比先下载再编译更快）；compile/validate 全可用

### App（iOS / Android / 鸿蒙）

- **JSC / QuickJS 内置 WASM** — App 端 JS 引擎（iOS JavaScriptCore / Android QuickJS）均内置 WebAssembly——与 Web 同形（字节加载 + 流式能力位随引擎）

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->