# @proteus-vue/render-backend

> **G-27 可插拔渲染后端 SPI**（`docs/proteus-render-backend-1-plan/`）· M1.4 原型 + G-31 B5 conformance 基础设施

## 一句话

**后端只需实现 `ProteusRenderBackend` 接口即可接入任意渲染引擎**——nodeOps 刻意对齐 Vue（`createElement/insert/remove/patchProp/setText`），Vue Custom Renderer 即零成本后端。

## 内容

| 模块 | 说明 |
|------|------|
| `spi.ts` | `ProteusRenderBackend` 接口 + `BackendCapabilities` 能力声明 + IRNode/LayoutConstraints/NormalizedInputEvent 类型（唯一事实源，对齐 plan 02-backend-spi.md） |
| `conformance.ts` | `runBackendConformance(backend)` 接口完整性自检（RND002：后端必须通过）——必选方法存在 / createElement 唯一句柄 / 能力枚举合法 / 可选方法类型 |
| `conformance-component.ts` | **★G-31 B5 组件渲染快照基础设施**：`renderComponentSnapshot(backend, ir, readControl)` 驱动 nodeOps 渲染 C-IR → 归一化快照树 + `createControlReader` 内置后端控件 readback（对照参考表见 @proteus-vue/component-ir `conformance.ts`） |
| `headless.ts` | **HeadlessBackend**：内存节点树（零依赖）——SSR / 测试断言 / AI Agent 无设备回归（B3 前置 + conformance 参考实现；★B5 消费 semantic） |
| `vue-dom.ts` | **VueDomBackend**：DOM nodeOps（Web 端官方后端，B2）——事件归一化 onXxx → addEventListener；★B5 补全 18 语义 SEMANTIC_WEB_MAP |
| `native.ts` | **NativeBackend**（B4）：nodeOps → 原生视图（iOS/Android/鸿蒙三平台语义映射 SEMANTIC_NATIVE_MAPS + 宿主适配器桥 + mock adapter） |
| `flutter.ts` | **FlutterBackend**（B5 spike）：Proteus 语义 → Flutter widget 树（★B5 补 semantic 消费 SEMANTIC_FLUTTER_MAP） |

## 用法

```ts
import { createHeadlessBackend, createVueDomBackend, runBackendConformance } from '@proteus-vue/render-backend'

const backend = createHeadlessBackend()
const result = runBackendConformance(backend) // { ok: true, checks: [...] } —— RND002 强制
```

## 组件 Conformance（G-31 B5）

```ts
import { createNativeBackend, renderComponentSnapshot, createControlReader } from '@proteus-vue/render-backend'
import { checkComponentSnapshot } from '@proteus-vue/component-ir' // 参考表对照

const backend = createNativeBackend(undefined, 'android')
const snap = renderComponentSnapshot(backend, ir, createControlReader(backend.id))
const result = checkComponentSnapshot(backend.id, snap) // 控件 readback == SEMANTIC_BACKEND_MAP？
```

## 能力协商（BackendCapabilities）

框架按后端声明的能力自动降级（对齐 G-22 CapabilityRegistry），不按 if/else 判断平台：
`layout`（yoga/native/none）· `glass`（L3/L2/L1/none）· `blur` · `animation` · `textureSharing`（混合渲染）· `remoteRendering`（TV/车机）· `ssr` · `input`（touch/cursor/remote/dial/voice）

## 严格规则

- **RND001**：禁止业务直调后端专有 API；走 `p-*` 或 Backend SPI
- **RND002**：后端必须通过 conformance test
- **RND003**：布局语义不得硬编码为某后端算法
- **RND004**：混合后端须声明纹理/事件边界
- **RND005**：后端不得在 IR 层外修改组件树

## 路线

B1 SPI+conformance ✅ → B2 VueDom ✅ → B3 Headless（Agent 回归）→ B4 Native（UIKit nodeOps）→ B5 Flutter（Embedder C ABI）+ **G-31 B5 conformance 快照基础设施 ✅** → B6 混合渲染 + DevTools
