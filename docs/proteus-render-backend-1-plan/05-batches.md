# 落地分批与里程碑（G-27）

## 关键里程碑

- **B1**：`ProteusRenderBackend` 接口 + `BackendCapabilities` + conformance test → **验证接口完整性** ✅（@proteus-vue/render-backend：spi.ts + conformance.ts，runBackendConformance 自检——必选方法/createElement 唯一句柄/能力枚举/可选方法类型；tests/render-backend.test.ts 残缺假后端验证）
- **B2**：`VueDomBackend`（复用 `createRenderer`）→ **验证 Vue 生态零成本复用** ✅（vue-dom.ts：DOM nodeOps + onXxx→addEventListener 事件归一化；capabilities 声明 layout:native/glass:L1）
- **B3**：`HeadlessBackend` + G-23 Agent 回归 → **验证无设备开发** 🟡 内存节点树已落地（headless.ts：createElement/insert/remove/patchProp/setText + toPlainTree 序列化——SSR/测试/AI 快照载体）；G-23 Agent 接入待后续
- **B4**：`NativeBackend`（iOS UIKit）→ **验证 nodeOps → UIView** ✅（native.ts：nodeOps → NativeViewDescriptor 树 + NativeViewAdapter 宿主桥（createView/updateView/insertView/removeView/setViewText）——与 @proteus-vue/renderer-app NativeAdapter（Vue host config 层）同构，宿主未来桥接；默认 mock 适配器 ops 日志；capabilities glass L3/animation native/textureSharing 系统级声明）
- **B5**：`FlutterBackend`（Embedder C ABI）→ **验证跨引擎** ✅ spike（flutter.ts：Proteus 语义 → Flutter widget 树映射层——WIDGET_MAP 语义收敛（view→Container/text→Text/button→FilledButton/p-grid→Wrap...）+ toWidgetTree 序列化；真实 Embedder C ABI（FlutterEngineRun + RendererConfig）为宿主工程 B5 后接；capabilities layout:yoga/glass:L3/animation:native/textureSharing）
- **B6**：混合渲染（Texture Sharing）+ DevTools 可视化

## 推荐顺序

**B1 → B2 → B4 → B5 → B3 → B6**

B1/B2 最快出可演示原型（Vue 生态直接复用，无需新引擎）；B4+B5 是证明"原生与自绘双通"的核心；B3 让 AI Agent 闭环；B6 是生产级打磨。

## 单测用例（B1 可单测）

- `createElement` → 返回唯一 NodeHandle
- `insert/remove` → 父子关系正确
- `patchProp` → 属性变更触发回调
- 布局契约 → 给定 constraints 返回合法 Size
- 事件归一化 → 各端 pointerType 映射到统一枚举

详见 `02-backend-spi.md` conformance test。
