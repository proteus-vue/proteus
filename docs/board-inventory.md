# 规划板块权威状态总表（17 板块盘点）

> 本文是 17 个 `docs/proteus-*-plan/` 板块的**唯一状态源**（2026-08 全仓盘点）。
> 每个板块 README 的 ★实现状态 与本表保持一致；新增/完成批次必须同步本表。
> 测试基线：**616 单测 + 8 Web e2e**（`npm run verify` 全绿）。

| # | 板块 | 状态 | 已实现范围 | 未实现/延后 |
|---|------|------|-----------|------------|
| 1 | api-plan | ✅ 已实现 | B1-B4：createApi 请求抽象（wx/fetch adapter + 拦截器/重试/错误模型）+ getDeviceInfo + createAuth 凭证托管（自动 Authorization/skipAuth/登录态订阅） | P1 业务模块（文件/支付/UI，A5 支付标注依赖） |
| 2 | app-plan | ✅ B1 核心已落地（B2-B5 标 v0.6 正式启动）| @proteus-vue/renderer-app：NativeAdapter 抽象 + createRenderer host config + mock adapter——Vue 官方渲染器接线可测（无需真机）；标准 Vue SFC 三端复用的 App 运行时通道 | B2-B5（iOS/Android 原生视图/样式 rpx→dp/路由桥/能力桥/demo）需 npm 发布 + 原生工程；Vapor 双模式（B6）依赖 @vue/vapor 实验版 |
| 3 | build-plan | ✅ 已实现 | @proteus-vue/plugin-vite（mp 编译插件 + gen-routes + 共享模块/分包/能力包）+ 双端构建 + CI 流水线 + 体积预算门禁（bundle-report strict，随 build:mp 进 CI）+ build 产物契约测试（contract-build：subPackages 一致性/组件产物存在性） | 增量 HMR/磁盘远程缓存（M8）/分包并行构建（04 文档标注后续） |
| 4 | cli-plan | ✅ 已实现 | @proteus-vue/cli：build/explain/rules/router:check/module:check/module:duplicates/audit module/init module/capabilities:manifest/capabilities:check/**components:audit** | dev/preview 命令（M2 规划） |
| 5 | compiler-plan | ✅ 已实现 | 编译管线 + 69 条规则注册表 + explain/trace + 产物自校验 + sourcemap + **4 项增强**（props 源 watch→observers / ref 多行 RHS 修复 / 组件 onUnmounted→detached / 未映射钩子显式警告） | computed 写路径/类型提示尾项 |
| 6 | component-plan | ✅ P0 全批 | B1-B8：16 组件（15 个 p-* + virtual-list 兼容）+ 4 runtime 共享模块（capability/event/virtual-window/observability）+ `components:audit` 门禁（CI）+ demo 页 | 业务组件（player-bar/payment-sheet 依赖 appBar/支付）；Worklet 转场 v0.6；组件库拆包 v2.0 |
| 7 | devtools-plan | ✅ 已实现（B1-B2）| TraceBus 统一事件协议（@proteus-vue/devtools-runtime：环形缓冲/脱敏/采样/零开销门控）+ 六源接入两源示范（lifecycle + componentRender，type-only 注入）| 面板（时间轴/快照/火焰图/根因/设备）标 v1.0+；router/store/api/capability/compiler 四源同模式后续 |
| 8 | i18n-plan | ✅ 已实现（B1-B3）| @proteus-vue/i18n（类型安全 t() + ICU 子集：插值/复数/select/# 占位）+ CLI i18n:check 审计门禁 + demo（双端共享模块链路验证）| 分包加载/完整 ICU/Intl 日期货币/RTL 自动应用/AST 提取标后续批次 |
| 9 | lifecycle-plan | ✅ 已实现 | B1-B6：defineApp 五阶段 + LifecycleOrchestrator（超时/降级/错误隔离/trace）+ Web demo + appSkeleton onShow/onHide + 页面 onUnload 自动 $dispose | B7-B9 尾项 |
| 10 | module-plan | ✅ 已实现 | B0-B9：跨模块引用（import→require）+ @proteus-vue/module（契约/图谱/编排器）+ Web manualChunks/分包 preload + 体积/去重/审计门禁 | 模块化 DevTools 联动 |
| 11 | pinia-plan | ✅ 已实现 | M1-M8 + MP P1-P3：多端工厂/持久化/分片/版本迁移/快照时间旅行/协同 @proteus-vue/pinia-sync/可观测 + MP 模板绑定桥/事件包装/白名单放行 | DevTools 面板联动 |
| 12 | platform-plan | ✅ 已实现 | B1-B5 + B8/B9：能力契约/Registry/编译期分叉/运行时降级/平台规范 + 矩阵测试 + CI 门禁 | B6/B7 ⏳ 延后（超级应用可靠性/可观测待 DevTools 基建） |
| 13 | router-plan | ✅ 已实现 | B1-B11：scan/tree/codegen/guards/tabBar + Router M7.1 chunk + requiresAuth 自动守卫 + 透明化规则/决策链 | B5 app codegen（appBar）⬜ 待 v0.6 |
| 14 | security-plan | ✅ 已实现（M1-M3）| M1 SecretStorage 敏感字段加密存储（@proteus-vue/security：WebCrypto AES-GCM+PBKDF2 / DemoCipher 降级 / volatile 跳过 / redact / migrate）+ M2 凭证托管（@proteus-vue/api createAuth）+ M3 PermissionRegistry 权限最小化（withPermission/PermissionDenied/持久化）| M4-M8（注入防护/网络安全/脱敏/audit security）标后续；Router 权限守卫自动生成 / PermissionGate 组件 / 编译期字段校验 transform |
| 15 | testing-plan | ✅ 已实现 | 四层金字塔（L1 单测 587 + L2 集成快照 + 跨层契约 + e2e 8）+ CI 门禁（stores 铁律/能力门禁/模板快照/组件审计） | e2e 真机矩阵 |
| 16 | types-plan | ✅ 全批收官（B1-B7）| shims + 各包 IR 类型 + ProteusConfig TS + 平台守卫（铁律 #4）+ validateConfig（config:check）+ @proteus-vue/types 独立包（Platform 共享类型 + JSON Schema + generate types --check）+ 超级应用加固（品牌类型/配置迁移/Schema Registry）+ migrate types codemod（CI 门禁）| 独立 @proteus-vue/types 包 Registry .d.ts codegen 深化（远期）|
| 17 | website-plan | ⬜ 未实现 | — | 官网（文档系统/playground/showcase），v1.0+ |

## 汇总

- ✅ 已实现 **16** 个板块（api/app(B1 核心)/build/cli/compiler/component/devtools/i18n/lifecycle/module/pinia/platform/router/security/testing/types）
- ⬜ 未实现 **1** 个（website 为远期）

> devtools（面板 B3-B8）、i18n（分包/完整 ICU）、security（M4-M8）、app（B2-B5 原生工程）的「未实现」内容均标注依赖基建/长期方向，当前可落地批次已完成。

## 交叉能力（编译器 4 增强，跨板块复用）

组件库 B3/B5/B6/B7 沉淀的编译器能力同时服务所有板块：
1. `script/watch-props`：watch props 源 → WeChat observers（组件响应自身属性变化）
2. `script/ref-write` 多行 RHS 修复（ref 赋值含箭头函数体）
3. 组件模式 `onUnmounted → detached`（MP 组件真实销毁钩子）
4. 未映射 `onXxx` 钩子显式警告（反黑盒）

## 下一步候选

1. **全仓收尾**：PROJECT_MEMORY 校对 + npm 发布清单执行（changesets version → 模板同步 → publish，现覆盖 16 包）
2. **security M4-M8 评估**（注入防护/网络安全/脱敏）或 **app B2 预研**（原生视图样式系统 rpx→dp 契约设计）
3. **website-plan 评估**（官网文档系统——远期，依赖 v1.0）
