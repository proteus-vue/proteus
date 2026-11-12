---
'@proteus-vue/compiler': patch
'@proteus-vue/components': patch
'@proteus-vue/plugin-vite': patch
---

外部实战报告第 13-15 轮缺陷收口（F-36~F-43，8 条）：

**compiler**
- F-39：`p-fluid` 表达式支持 `var()` / 百分比 / auto 实参（原样透传，不再静默剥离）。
  根因是 `parseFluidExpr` 有两处完全相同的实现（`fluid-layout.ts` + `template.ts`），
  模板用的是后者——已收敛为唯一实现。
- F-40：MP 产物从裸 `calc()` 改为 `clamp(min, calc(...), max)` 两端夹取。
  实测依据：1600 宽原出 33.8px（应 32）；`designWidth=1280` 时 390 宽只有 3.31px（应 ≥20）。
- F-38A：`defineEmits<泛型>()` 不再被当普通初始化落 `data.emit=undefined`
  （组件事件此前在 MP 端全部静默失效）。
- F-38B：`v-for` 作用域内的参数化 handler（`run(a.key)` / `run(a)` / `(e)=>run(a)`）
  改用 `data-*` 传参包装方法，产物不再是非法处理器名。

**components**
- F-36：三个组件不再直连平台全局 `getCurrentPages`，收敛到 `runtime/page-route.ts`
  的 `currentPageRoute()`（只依赖 `adapter` 抽象）——消费者 `vue-tsc` 不再报 TS2304。
- F-42/F-43：`p-adaptive` 在 MP 端接线尺寸测量（`mpContainerObserverFactory`）。
  此前 onMounted 首行「元素空就 return」在 MP 端必然命中 ⇒ controller 从不创建 ⇒ 整段逻辑被跳过。
- F-41：`p-grid` 新增 `minColWidthMin` + `minColWidthVw`，支持 `max(96px, min(142px, 22vw))`
  式流式下限（纯 CSS、零运行时），窄屏列数可与手写断点方案对齐。

**plugin-vite**
- F-37：`cse-lint` / `profile-boundary` 两道样式门禁不再检查 `node_modules`。
  此前消费者引用任一 `p-*` 组件都会被框架自家组件判 error ⇒ 构建被封死。
  语义边界：门禁约束消费者源码写法，已发布依赖的合规由框架仓库 CI 保证。
