# 05 · 优先级分级与验收（Vue 全集基准线）

## 优先级

### P0（先做——建基准线 + 状态表 + 兜底，回答"为什么没做对齐"）
1. **Step 1：固化「Vue 全集基准线」SSOT**（权威拉取 `@vue/runtime-core@3.5.42`+reactivity+shared+SFC 面，见 02 A-D；版本号入 SSOT）。
   - ✅ **2026-09-08 已落地**：`packages/compiler/src/vue-compat.ts`（`VUE_COMPAT_MATRIX` entries（含 `degrade` 标志）+ `vueCompatStatus`/`vueCompatLevel` 查询 + `VUE_COMPAT_UNKNOWN` 反黑盒兜底）+ 导出到 `packages/compiler/src/index.ts` + `tests/vue-compat-matrix.test.ts` 8 用例（完整性/规则/代表性状态/漂移护栏）。
   - 用户规则已固化为 `vueCompatLevel`：aligned→none；partial→warning；unsupported+degrade→warning；unsupported 无 degrade→error。
   - 用户决策 1（b）已固化：`getCurrentInstance`/`useSlots`/`useAttrs`/`watchEffect`/`h`/`createApp` 等运行时对内 API → `unsupported` 反黑盒（note 写「单独立项框架语义 API 承接」）。
2. **Step 2：逐能力标状态**（aligned/partial/unsupported）——优先来源 `vue-compat-plan` §1（✅/⚠️/❌）+ advance + roadmap #2；未覆盖的评估。
   - ✅ 已在 `VUE_COMPAT_MATRIX` 赋值（aligned 核心 / partial 受限 / unsupported 反黑盒，均带 source）。
   - ✅ **2026-09-08 校准**：实测逐项核对，纠 16 项假 aligned（详见 README「进展」）：运行时守卫 isRef/isReactive/isReadonly/isProxy/isShallow + 内部渲染助手 resolveComponent/renderSlot/mergeProps/toHandlers/withCtx/withScopeId + defineComponent/withDefaults → `unsupported`·error；version/v-text/v-pre/v-once → `partial`·warning。新增 `tests/vue-compat-aligned.test.ts`（aligned 黄金断言 11 用例）。
   - ✅ **顺带修复关键运行时回归**：onMounted/onUnmounted 裸调用泄漏进 onLoad → ReferenceError（`extractTopLevelCalls` 跳过正则补 onMounted/onUnmounted），`dist/mp-weixin` 验证无裸调用。
   - ⚠️ 待办：emit 接线（defineEmits 产物至少数上下文为 bare emit(...)，疑受 isComponent/emitEnabled 影响，需真实组件上下文复核）；withDefaults/defineComponent 宏对齐；computed 响应式二次求值（暂按框架既定锁定）。
3. **Step 3：机器门禁（⚠️ 2026-09-08 已落地）**
   - ✅ **compiler 接线**（packages/compiler/src/script.ts vue import 分支）：vue 命名导入逐 API 查 `vueCompatStatus` → aligned 静默翻译 / partial·unsupported+degrade 编译期警告 / **unsupported 无降级 抛 CompilerError**（反黑盒 fail-closed）。
   - ✅ `tests/vue-compat-compile.test.ts` 5 用例（aligned 编译正常 / getCurrentInstance·h·createApp·useSlots 抛 CompilerError / partial onErrorCaptured 警告 + note / provide 正常）。
   - ✅ 现有项目零破坏：扫描现有 .vue 仅用 aligned（ref/computed/watch/onMounted/onUnmounted/provide）+ partial（onErrorCaptured/onBeforeUnmount 既有警告）；无 unsupported 无降级 API → build:mp/web 通过，全量 2553/2553 绿。
   - 兜底：任何基准线内能力必须"三类之一"，绝不静默。—— ✅（error 抛 / warning 收 / aligned 静默）

**下一步建议**：P0 Step 3 接线 compiler（script.ts 扫描 `<script setup>` vue 命名导入 → `vueCompatStatus` 对照 → aligned 走翻译 / partial·unsupported 按 `vueCompatLevel` 出编译期警告/报错）。

### P1（逐能力对齐）
- 把 partial 里仍受限的，按 `vue-compat-advance` 模式逐批转 aligned（每批 = 状态变更 + 黄金断言）。

### P2（unsupported / 框架非目标——反黑盒 + 文档）
- `getCurrentInstance`/`useSlots`/`useAttrs`/`watchEffect`/`h`/`createApp`/`<component :is>`/自定义指令/模板 ref/transition-group/teleport/suspense/keep-alive——unsupported 显式报错（含替代建议）。

## 验收标准

1. **基准线存在**：Vue 全集枚举（SSOT，测试可消费），版本号锁定，来源权威（runtime-core d.ts）。
2. **逐能力状态**：每个基准线能力有 aligned/partial/unsupported 三态之一，可查询。
3. **机器门禁**：aligned 全部有黄金断言；partial/unsupported 有编译期提示；**新能力进 aligned 必须同批补断言**（防打地鼠回归）。
4. **反黑盒**：任一基准线内能力不会被"静默翻译成坏产物/未定义引用"——`getCurrentInstance` 不再裸奔。
5. **回归**：全量测试绿 + build:mp/web 通过 + MP 运行时 console 零错门禁。

## gated by（用户拍板）
1. `getCurrentInstance` 等运行时对内 API：`unsupported` 报错 vs 框架语义 API（`useMpInstance`/`adapter.selectorQuery(组件)`）立项——我倾向后者承接真实需求。
2. `unsupported` 报 error 还是 warning。
3. 矩阵 SSOT 位置（compiler / types 包）。
4. Vue 版本演进 SSOT 重拉 + 状态复评流程。
