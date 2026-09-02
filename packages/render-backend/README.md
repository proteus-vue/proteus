# @proteus-vue/render-backend

> **G-27 可插拔渲染后端 SPI**（`docs/proteus-render-backend-1-plan/`）· M1.4 原型

## 一句话

**后端只需实现 `ProteusRenderBackend` 接口即可接入任意渲染引擎**——nodeOps 刻意对齐 Vue（`createElement/insert/remove/patchProp/setText`），Vue Custom Renderer 即零成本后端。

## 内容

| 模块 | 说明 |
|------|------|
| `spi.ts` | `ProteusRenderBackend` 接口 + `BackendCapabilities` 能力声明 + IRNode/LayoutConstraints/NormalizedInputEvent 类型（唯一事实源，对齐 plan 02-backend-spi.md） |
| `conformance.ts` | `runBackendConformance(backend)` 接口完整性自检（RND002：后端必须通过）——必选方法存在 / createElement 唯一句柄 / 能力枚举合法 / 可选方法类型 |
| `headless.ts` | **HeadlessBackend**：内存节点树（零依赖）——SSR / 测试断言 / AI Agent 无设备回归（B3 前置 + conformance 参考实现） |
| `vue-dom.ts` | **VueDomBackend**：DOM nodeOps（Web 端官方后端，B2）——事件归一化 onXxx → addEventListener |

## 用法

```ts
import { createHeadlessBackend, createVueDomBackend, runBackendConformance } from '@proteus-vue/render-backend'

const backend = createHeadlessBackend()
const result = runBackendConformance(backend) // { ok: true, checks: [...] } —— RND002 强制
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

B1 SPI+conformance ✅ → B2 VueDom ✅ → B3 Headless（Agent 回归）→ B4 Native（UIKit nodeOps）→ B5 Flutter（Embedder C ABI）→ B6 混合渲染 + DevTools
