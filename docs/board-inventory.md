# 规划板块权威状态总表（17 板块盘点）

> 本文是 17 个 `docs/proteus-*-plan/` 板块的**唯一状态源**（2026-08 全仓盘点）。
> 每个板块 README 的 ★实现状态 与本表保持一致；新增/完成批次必须同步本表。
> 测试基线：**587 单测 + 8 Web e2e**（`npm run verify` 全绿）。

| # | 板块 | 状态 | 已实现范围 | 未实现/延后 |
|---|------|------|-----------|------------|
| 1 | api-plan | ✅ 已实现 | B1-B4：createApi 请求抽象（wx/fetch adapter + 拦截器/重试/错误模型）+ getDeviceInfo + createAuth 凭证托管（自动 Authorization/skipAuth/登录态订阅） | P1 业务模块（文件/支付/UI，A5 支付标注依赖） |
| 2 | app-plan | ⬜ v0.6 规划 | — | App 渲染器 createRenderer + Vapor 双模式（B1-B6 批次，待 v0.5 稳定 + npm 发布启动） |
| 3 | build-plan | ✅ 已实现 | @proteus/plugin-vite（mp 编译插件 + gen-routes + 共享模块/分包/能力包）+ 双端构建 + CI 流水线 | 增量 HMR/缓存深化（06/07 规划） |
| 4 | cli-plan | ✅ 已实现 | @proteus/cli：build/explain/rules/router:check/module:check/module:duplicates/audit module/init module/capabilities:manifest/capabilities:check/**components:audit** | dev/preview 命令（M2 规划） |
| 5 | compiler-plan | ✅ 已实现 | 编译管线 + 69 条规则注册表 + explain/trace + 产物自校验 + sourcemap + **4 项增强**（props 源 watch→observers / ref 多行 RHS 修复 / 组件 onUnmounted→detached / 未映射钩子显式警告） | computed 写路径/类型提示尾项 |
| 6 | component-plan | ✅ P0 全批 | B1-B8：16 组件（15 个 p-* + virtual-list 兼容）+ 4 runtime 共享模块（capability/event/virtual-window/observability）+ `components:audit` 门禁（CI）+ demo 页 | 业务组件（player-bar/payment-sheet 依赖 appBar/支付）；Worklet 转场 v0.6；组件库拆包 v2.0 |
| 7 | devtools-plan | ⬜ 未实现 | — | 面板（组件树/时间线/状态快照/路由回溯/性能火焰图），v1.0 方向 |
| 8 | i18n-plan | ⬜ 未实现 | — | 国际化（M1-M8 批次） |
| 9 | lifecycle-plan | ✅ 已实现 | B1-B6：defineApp 五阶段 + LifecycleOrchestrator（超时/降级/错误隔离/trace）+ Web demo + appSkeleton onShow/onHide + 页面 onUnload 自动 $dispose | B7-B9 尾项 |
| 10 | module-plan | ✅ 已实现 | B0-B9：跨模块引用（import→require）+ @proteus/module（契约/图谱/编排器）+ Web manualChunks/分包 preload + 体积/去重/审计门禁 | 模块化 DevTools 联动 |
| 11 | pinia-plan | ✅ 已实现 | M1-M8 + MP P1-P3：多端工厂/持久化/分片/版本迁移/快照时间旅行/协同 @proteus/pinia-sync/可观测 + MP 模板绑定桥/事件包装/白名单放行 | DevTools 面板联动 |
| 12 | platform-plan | ✅ 已实现 | B1-B5 + B8/B9：能力契约/Registry/编译期分叉/运行时降级/平台规范 + 矩阵测试 + CI 门禁 | B6/B7 ⏳ 延后（超级应用可靠性/可观测待 DevTools 基建） |
| 13 | router-plan | ✅ 已实现 | B1-B11：scan/tree/codegen/guards/tabBar + Router M7.1 chunk + requiresAuth 自动守卫 + 透明化规则/决策链 | B5 app codegen（appBar）⬜ 待 v0.6 |
| 14 | security-plan | 🟡 部分实现 | M2 凭证托管（createAuth：getToken/setToken/订阅/自动 Authorization） | M1 密钥存储/M3 权限/M4-M8（注入防护/网络安全/脱敏） |
| 15 | testing-plan | ✅ 已实现 | 四层金字塔（L1 单测 587 + L2 集成快照 + 跨层契约 + e2e 8）+ CI 门禁（stores 铁律/能力门禁/模板快照/组件审计） | e2e 真机矩阵 |
| 16 | types-plan | ✅ 已落地 | 类型体系（路由参数模块扩充/MpEvent 事件类型/跨层契约） | 独立 @proteus/types 包深化 |
| 17 | website-plan | ⬜ 未实现 | — | 官网（文档系统/playground/showcase），v1.0+ |

## 汇总

- ✅ 已实现 **12** 个板块（api/build/cli/compiler/component/lifecycle/module/pinia/platform/router/testing/types）
- 🟡 部分实现 **1** 个（security：仅 M2 凭证托管）
- ⬜ 未实现 **4** 个（app/devtools/i18n/website——app-plan 为 v0.6 明确排期，其余为远期方向）

## 交叉能力（编译器 4 增强，跨板块复用）

组件库 B3/B5/B6/B7 沉淀的编译器能力同时服务所有板块：
1. `script/watch-props`：watch props 源 → WeChat observers（组件响应自身属性变化）
2. `script/ref-write` 多行 RHS 修复（ref 赋值含箭头函数体）
3. 组件模式 `onUnmounted → detached`（MP 组件真实销毁钩子）
4. 未映射 `onXxx` 钩子显式警告（反黑盒）

## 下一步候选

1. **i18n-plan 评估/落地**（⬜ 板块中唯一贴近业务基线的）
2. **devtools-plan 评估**（依赖 observable 基建已部分就绪：componentRender/pinia trace）
3. **全仓收尾**：PROJECT_MEMORY 校对 + npm 发布清单执行（changesets version → 模板同步 → publish）
