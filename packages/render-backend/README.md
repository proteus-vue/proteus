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
| `hybrid.ts` | **★G-27 B6 混合渲染**：`createHybridRenderer`（多后端统一渲染面——区域级切后端 + 节点归属委托 + 纹理共享广播）· `textureRef`（跨后端纹理引用）· `runHybridConformance`（混合器自检）· DevTools 路由 trace（semantic → 后端 决策记录） |
| `dispatcher.ts` | **★G-41 B1**：`createNodeOpsDispatcher`（方案 B 全局转发层——`currentBackend` 一次间接调用，热切换 = 赋值）+ `toIRNode`（原语表驱动）+ nodeOps trace（H-03 双引擎一致机器证据） |
| `host-conformance.ts` | **★G-41 B2**：`runHostConformance`（H-01~H-08 共 32 项跨层组合 conformance——CMP058 上线门禁） |
| `vue-bridge.ts` | **★G-41 B3**：真实 Vue3 `createRenderer` 接入——`createVueRendererOptions(dispatch)` / `createProteusRenderer`（标准 SFC/App 落到任意后端） |
| `web-host.ts` | **★G-41 B4**：`createWebHostRuntime`（Web 宿主骨架——Main + Worker + EventLoop + bindPageVisibility） |
| `hot-switch.ts` | **★G-41 B5**：`createBackendSwitcher`（热切换生产级三策略——rebuild 开发期 / rehydrate 保状态 / hybrid 复用 G-27 B6） |
| `host-matrix.ts` | **★G-41 B6 组合矩阵**：6 宿主 × 6 引擎 = 36 组合 Tier 声明（HOST_ENGINE_MATRIX）+ `runComboConformance`（组合级 7 项：注册顺序/语义指纹/渲染完整性/控件映射/热切换等价 + 引擎级 conformance）+ `runHostEngineMatrix`（Tier 1 全部验证 failed===0）+ `formatMatrixReport` |
| `container-spi.ts` | **★G-42 B1**：`ProteusHostContainer` 插头（页面生命周期状态机 + 五原子销毁 FIVE_ATOMIC_STEPS 校验 + 六容器画像 CONTAINER_PROFILES） |
| `stack-container.ts` | **★G-42 B2 + G-43 B3**：`createStackContainer`（页面栈 + 五原子销毁 + 框架代管资源池 + LRU；`StackContainerOptions.ownership` 启用后每页伴随所有权上下文）· `createResourcePool` / `createQuotaManager` |
| `container-conformance.ts` | **★G-42 B3**：`runContainerConformance`（C-01~C-08 38 项）+ `scanRepoForFork`（严禁 fork 机器指纹）+ `checkBizManifest` 安全网关 |
| `superapp-container.ts` | **★G-42 B4**：`createSuperAppContainer`（业务沙箱 + 崩溃隔离 L1-L3 + 自动重启 + 签名/白名单网关——页面栈委托 Stack + ownership pass-through） |
| `basic-containers.ts` | **★G-42 B6 其余 4 容器**：`createSinglePageContainer`（单页/卡片/IoT 单槽 replace）/ `createEmbeddedContainer`（宿主挂载点工厂——Tier 3）/ `createWindowContainer`（多窗口各持栈 + 聚焦代理）/ `createMiniProgramContainer`（navigateTo/redirectTo/reLaunch/switchTab tab 保活/navigateBack + 10 层治理 + L1 沙箱）——全部过 conformance（能力门控诚实 SKIP）+ G-43 B3 ownership 接入 |
| `ownership.ts` | **★G-43 B1**：`Owned<T>`（Move 语义）/ `Borrow` / `Weak` / `Managed` + `OwnershipGraph`（孤儿/泄漏检测）+ Drop 五阶段协议 |
| `borrow-checker.ts` | **★G-43 B2**：`analyzeOwnershipSource`（源码级借用检查 B-01~B-08 + PSS strict/loose/off——编译期拦截 use-after-move/double-move/借用逃逸） |
| `page-ownership.ts` | **★G-43 B3**：`createPageOwnership`（页面所有权上下文——G-42 五原子第 3 步 releaseResources 委托 Drop 协议：forceDrop 强制回收 + Managed 自动释放 + 配额兜底归零；`container.ownershipOf(pageId)` 登记入口） |
| `ownership-observability.ts` | **★G-43 B4 DevTools 所有权图数据层**：`OwnershipGraph.subscribe` mutation 事件流 → `createOwnershipHistory`（alloc/drop 时间线）/ `createOwnershipCounters`（生产采样 O(1)）/ `diagnoseOwnershipIssues`（V-02 泄漏路径·V-03 长期借用·V-04 跨页强引用（strong 边）·V-05 无主资源）/ `buildOwnershipTimeline`（V-06 alloc/drop 配对）/ `formatOwnershipDiagnosis`（面板/CLI 报告契约） |
| `pss.ts` | **★G-43 B5 PSS 编译器支持**：`resolvePssMode`（文件头 pragma `@proteus-pss:` 三级声明）/ `analyzePss`（P1~P9 限制 + CMP071 ref(Owned) 拦截）/ `insertScopeDrops`（作用域自动 drop 插入——strict 不写 drop 也能正确释放）/ `runPss`（B 规则 + P 限制 + autoDrop 管线，strict 阻断构建） |

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

**G-27 B1-B6 全落地（#293-#331）**；宿主层三 plan 亦已落地：**G-41**（dispatcher/conformance/vue-bridge/web-host/hot-switch/**host-matrix**，B1-B6，#342-#359）· **G-42**（container-spi/stack-container/conformance/superapp/repo CLI + **basic-containers 四容器**，B1-B6，#347-#358；余「真实 App 验证」需生产 App）· **G-43**（ownership/borrow-checker/page-ownership/ownership-observability/pss，B1-B5，#352-#357；余 B6 跨设备转移需真机）
