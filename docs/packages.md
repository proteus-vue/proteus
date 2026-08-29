# 框架本体拆包（Monorepo Packages）—— 规划与实现

> **状态**：📋 规划已落地，按分步骤执行中（roadmap v0.2 遗留结构性欠账 C 类）
> **目标**：把框架本体 `src/{platform,router,runtime,shims}` + `vite-plugin-mp-transform.ts` + `scripts/gen-routes.ts`
> 拆成 monorepo packages（`@proteus/router` / `@proteus/runtime` / `@proteus/plugin-vite` / `@proteus/shared`），
> 应用工程不再复制框架本体（create-proteus 模板改为依赖 npm 包），对齐 roadmap §5 架构演进。
> **原则**：每步独立提交、全绿后再下一步；保持 `@proteus/*` 导入路径不变（包化是替换别名指向，业务代码零改动）。

## 现状与目标

| | 现状 | 目标 |
|---|---|---|
| 框架本体 | `src/{platform,router,runtime,shims,components}` + 根 `vite-plugin`/`gen-routes` | `packages/{router,runtime,plugin-vite,shared}` |
| 应用工程 | create-proteus 模板**复制**框架本体 src/ | 依赖 `@proteus/*` npm 包（workspace 链接） |
| 别名 | `@proteus` → `src/`（一个别名通吃） | `@proteus/router` → `packages/router/src` 等（精确映射） |
| router | 框架单例（index.ts import 生成 auto-routes） | **工厂化** `createRouter(routes)`，auto-routes 随应用 |

## 目标包结构与依赖方向（roadmap §5 对齐）

```
packages/
├── shared/        # @proteus/shared：平台 adapter + 全局类型（shims）+ 公共工具
├── runtime/       # @proteus/runtime：setDataBridge / pageLifecycle / store 桥 / appSkeleton
├── router/        # @proteus/router：createRouter / guards / skyline / presets（依赖 shared）
├── plugin-vite/   # @proteus/plugin-vite：vite 插件 + gen-routes（依赖 compiler + shared + config）
├── compiler/      # ✅ 已有
├── cli/           # ✅ 已有
└── create-proteus/# ✅ 已有（模板改依赖 @proteus/* npm 包）
```

依赖方向（单向）：`plugin-vite → compiler + shared`；`cli → compiler + plugin-vite(gen-routes)`；`runtime → shared`；`router → shared`；业务代码只依赖 `@proteus/*`。

## 关键设计决策（★执行前必读）

1. **config 解耦（拆包前置，三处）**：
   - `runtime/setDataBridge` 的 `batchWindow` ← `proteus.config` → 改 `createSetDataBridge({ batchWindow: 16 })` 工厂（默认 16，插件/入口注入）
   - `router/skyline` 的 `isSkyline()` ← `config.skyline` → 构建期 `__PROTEUS_SKYLINE__` define 注入（vite define 已有先例：`__PROTEUS_DEBUG__`）
   - `platform/index` 的 adapter 选择 ← `config.platform` → `createAdapter(isMP)` 工厂（入口决定，`import.meta.env.MODE` 判断）
2. **adapter 归 shared**：`src/platform/`（adapter 抽象 + mp/web 实现）→ `packages/shared/src/platform/`——runtime/router 都依赖它，减少包数
3. **shims 归 shared**：`mp.d.ts`（wx/Page/RouteBuilder/RouteContext 全局）+ `events.d.ts` + `vue.d.ts` → `packages/shared/src/shims/`（全局声明，包内 include 即可）
4. **gen-routes 归 plugin-vite**：`scripts/gen-routes.ts` → `packages/plugin-vite/src/gen-routes.ts`（构建链路统一；cli 可复用）
5. **router 工厂化（★最大行为变化）**：`@proteus/router` 提供 `createRouter(routes)`（去单例）——`examples/router/index.ts` 持路由表实例；auto-routes 生成位置 `routesOutput` 改为应用侧（`examples/router/auto-routes.ts`）
6. **components 暂留 src/**：`src/components/`（virtual-list）本轮不拆（组件库是 v2.0 方向），别名 `@proteus/components` → `src/components` 保持；规划文档标注
7. **别名精确化**：vite alias + tsconfig paths：`@proteus/{router,runtime,plugin-vite,shared,compiler}` 各自映射包 src；**删除泛化 `@proteus` → src/**（防误匹配）
8. **create-proteus 模板重构**：模板不再复制框架 src/{platform,router,runtime,shims}——应用 `package.json` 依赖 `@proteus/{router,runtime,shared}` + 框架组件；`src/` 只剩应用代码（main*/App.vue/pages/components 应用级）；snapshot-template.ts 调整

## 分步骤实现（每步独立提交）

### 步骤 1：config 解耦（前置，不动目录）

- [x] `setDataBridge` 改工厂 `createSetDataBridge({ batchWindow: 16 })`（默认 16，单例导出兼容）
- [x] `isSkyline()` 改读 `__PROTEUS_SKYLINE__`（mp.d.ts 声明 + vite define 注入 config.skyline）
- [x] `platform/index` 删 config 依赖：`import.meta.env.MODE === 'mp-weixin'` 直接选择 adapter
- [x] 验证：vue-tsc + 198 测试 + 双端构建全绿（行为不变）；产物无 define 残留
- 规模：~120 行；决策：#98；踩坑：测试环境无 vite define → isSkyline 的 `typeof __PROTEUS_SKYLINE__ !== 'undefined'` 守卫（vitest 独立 config 不加载 vite define）

### 步骤 2：shared 包（adapter + shims）

- [x] `git mv src/platform src/shims → packages/shared/src/`
- [x] `packages/shared/package.json` + tsconfig.build（esbuild 单文件 + tsc 声明，同 compiler 模式）+ `index.ts` 聚合（adapter + 类型）
- [x] 引用面改 `@proteus/shared`（runtime/router 4 处 + RouterView）；vitest.config 独立 alias；tsconfig types/include/paths；snapshot-template 源改 packages/shared/src
- [x] 验证：vue-tsc + 198 测试 + 双端构建 + shared 包构建 + 模板快照 + workspace 链接
- 决策：#99；踩坑：① perl/sed 替换 `@proteus` 被当数组插值吞掉（改用 node replaceAll）② vitest 独立配置无别名（vitest.config 补 @proteus/shared）③ 测试 mock 路径与实际 import id（'../src/platform' vs '@proteus/shared'，re-export 链 mock 失效）——改 mock '@proteus/shared' ④ import.meta.env 类型（shared 独立构建无 vite types）——(import.meta as any) 断言

### 步骤 3：runtime 包

- [x] `git mv src/runtime → packages/runtime/src`（appSkeleton/debug/pageLifecycle/setDataBridge/store + index 聚合）
- [x] `packages/runtime/package.json`（依赖 @proteus/shared，构建 external shared）+ tsconfig.build（types 引 shared shims 全局声明）
- [x] 引用面：插件 appSkeleton `./packages/runtime/src/appSkeleton`、tests 相对路径、vite/vitest alias + tsconfig paths/include @proteus/runtime、snapshot 源改 packages/runtime/src
- [x] 验证：vue-tsc + 198 测试 + 双端构建 + runtime 包构建 + 模板快照 + workspace 链接
- 决策：#100；踩坑：runtime 独立构建缺全局类型（__PROTEUS_DEBUG__/PageOptions/ComponentOptions 在 shared mp.d.ts）——tsconfig.build types 引 shared shims

### 步骤 4：router 包 + 工厂化（✅ 已落地，另含 M1/M2 增量）

- [x] `git mv src/router → packages/router/src`（types/guards/skyline/presets；index.ts 改 createRouter 工厂，删单例；guards 工厂化——routeMap 由 push 注入）
- [x] `packages/router/package.json`（依赖 @proteus/shared，peer @vue/compiler-sfc）+ tsconfig.build（types 引 shared shims + @types/node）
- [x] `examples/router/index.ts` 新单例（`createRouter(routes)`，routes 来自应用侧 auto-routes）；`examples/router/auto-routes.ts` 随应用存放（模块扩充注入 `@proteus/router/types` 的 RouteParamsByName，vue-router 同款模式——push 泛型推导/PageOnLoad 负例零回归）
- [x] gen-routes 的 `routesOutput` 指向 `examples/router/auto-routes.ts`（输出改 `declare module` 扩充）；RouterView 改 `./auto-routes` 相对导入（仓库与模板通用）
- [x] 路由规划 M1/M2 增量（docs/proteus-router-plan）：`schema.ts`（手写校验 + RouteValidationError 含 loc）+ `scan.ts`（@vue/compiler-sfc 解析 + 行号定位）+ `tree.ts`（嵌套树：path 推导 + parent 显式优先 + 环检测 + sortByPath 稳定）+ `merge.ts`（meta 深合并限深 3）
- [x] 验证：vue-tsc 零错 + 216 测试（新增 18 条 M1/M2 用例）+ 双端构建 + router 包构建 + 模板快照 + workspace 链接（@proteus/router）
- 决策：#101；踩坑：lazy 默认值语义（scan 不强制置 true，交给 defaults 解析）；RouteNode.parent 保留（构建期使用）；auto-routes 模块扩充（空基接口保证 name 受限负例成立）

### 步骤 5：plugin-vite 包（✅ 已落地）

- [x] `git mv vite-plugin-mp-transform.ts scripts/gen-routes.ts → packages/plugin-vite/src/`（plugin.ts / gen-routes.ts；另 appSkeleton 从 runtime 迁入——构建期 app.js 骨架模板归构建期包，runtime 纯运行期）
- [x] `packages/plugin-vite/package.json`（依赖 compiler + router；peer vite；devDep esbuild/sass/@types/node）+ tsconfig.build（rootDir ./src，exclude cli.ts）
- [x] **config 解耦**：插件不再 `import './proteus.config'`——`PluginOptions.config` 由 vite.config 注入；`ProteusConfig` 类型契约迁入 `packages/plugin-vite/src/config.ts`，根 proteus.config.ts 改为 import 类型 + 实例化
- [x] **gen-routes 双形态**：纯函数库 `runGenRoutes({ config, root })`（可单测）+ CLI 入口 `src/cli.ts`（tsx 直跑，动态 import 项目 config）；package.json build:mp/dev:mp 指包内 cli
- [x] 引用面：vite.config（import 包 + `mpTransform({ config })`）、proteus.config（builders 预设路径改 packages/router/src/presets）、tests（plugin.test 路径 + 新增 gen-routes.test 3 用例）、vitest alias @proteus/compiler、tsconfig include
- [x] snapshot-template：plugin.ts→vite-plugin-mp-transform.ts（appSkeleton 路径替换）+ gen-routes 库→scripts/gen-routes.ts（@proteus/router→../src/router/types、./config→../proteus.config）+ cli→scripts/gen-routes-cli.ts + appSkeleton→src/runtime/；模板 vite.config/package.json 手写同步
- [x] 验证：vue-tsc 零错 + 219 测试（+3 gen-routes）+ 双端构建 + plugin-vite 包构建 + 模板 gen-routes CLI 冒烟 + workspace 链接
- 决策：#102；踩坑：① workspace 依赖版本必须对齐实际包版本（compiler 0.2.0——0.1.0 触发 npm 404 拉 registry）② vite.config bundle 阶段不走 resolve.alias → 插件 @proteus/compiler 解析到 dist（prepare 钩子保新鲜）③ tsx 动态 import 需带 .ts 扩展名 + 层级数（src/ → 根为三级）④ 动态 import 根 config 拉偏 tsc rootDir 推断 → CLI 拆独立 cli.ts + tsconfig.build exclude

### 步骤 6：别名与引用面全量切换（✅ 已落地）

- [x] vite alias / tsconfig paths：`@proteus/{router,runtime,shared,compiler,plugin-vite,components}` 精确映射，**删除泛化 `@proteus` → src/（防误匹配）**
- [x] `@proteus/components` → `src/components`（框架内置组件暂留 src，组件库 v2.0 方向）——vite 单键前缀匹配子路径（`@proteus/components/virtual-list/index.vue`）+ tsconfig 双键（components/components/*）
- [x] 模板 vite.config 同步精确化（vendored 结构：@proteus/shared → src/platform/index.ts（adapter 聚合）、@proteus/router → src/router、@proteus/runtime → src/runtime）
- [x] 盘点确认：examples 全部 import 已是精确包路径（步骤 2-5 铺垫），无 `@proteus` 泛化残留；`@/` 保留（无人用，兼容未来）
- [x] 验证：vue-tsc 零错 + 219 测试 + 双端构建 + 模板快照
- 决策：#103；风险收敛：引用面在步骤 2-5 已逐包精确化，本步只需删兜底，无存量 import 受影响

### 步骤 7：create-proteus 模板重构（✅ 已落地）

- [x] 模板 package.json 依赖 `@proteus/{router,runtime,shared,plugin-vite,compiler}`（npm 包形态）；**删除模板中框架本体 src/ 副本**（platform/runtime/router 框架代码 + vite-plugin-mp-transform.ts）
- [x] 模板应用侧 `src/`：main*/App.vue/pages + router 单例（index.ts）+ RouterView（应用壳）+ auto-routes（占位）+ shims（应用侧全局类型，自 shared 复制）+ scripts/gen-routes.ts 薄壳（runGenRoutes 来自包）
- [x] snapshot-template.ts 重构：只快照应用壳（RouterView/index.ts/shim s/mp-entry-stub/index.html），手写模板（package.json/proteus.config/vite.config/tsconfig/main*/App/pages/auto-routes/gen-routes）
- [x] router 包 exports 补子路径（./types 等纯类型 + ./package.json）+ files 加 src/presets（预设源码随包发布，插件内联需要）；插件 loadPresetBuilders 支持 node_modules 包内路径（resolvePkgPath，scoped 包正则）
- [x] 验证：**模板目录内双端构建通过（workspace 链接形态）**——gen-routes → vue-tsc → vite build web/mp-weixin；app.js 内置预设 halfScreen/slideUp/scaleDown 全部内联注册；主仓 222 测试 + vue-tsc + 双端构建；真实 `npm create` 端到端待 npm 发布后验证（用户暂不发布）
- 决策：#104；踩坑：① 模板 App.vue 不能引 `@proteus/router/RouterView.vue`（npm 包 exports 无此子路径 → 应用壳相对导入）② 插件 `@proteus/plugin-vite` 命名导出（模板 default import 不匹配 → 统一命名导入）③ require.resolve('@proteus/router/package.json') 被 exports 拦截（补 ./package.json）④ node_modules 路径正则要处理 scoped 包（@proteus/router 两层）⑤ 模板构建走 workspace 链接 dist（plugin-vite 加 prepare 保新鲜）
- 规模：~300 行；风险：中高（模板大改，端到端验证）

### 步骤 8：CI/构建/文档收尾

- [ ] CI 加各包构建；根 `verify` 全绿
- [ ] docs/roadmap.md 拆包行 ✅、docs/packages.md 升级正式文档、PROJECT_MEMORY 决策
- 规模：~100 行；风险：低

## 风险与对策

| 风险 | 对策 |
|---|---|
| router 工厂化破坏既有调用（步骤 4） | createRouter 兼容旧 API（guards/router 方法同签名）；15 路由用例 + e2e 兜底 |
| config 解耦改变运行时行为（步骤 1） | 测试兜底；adapter/skyline 行为等价（构建期注入） |
| 别名泛化删除后漏改（步骤 6） | 步骤 6 验证 vue-tsc 全量（tsconfig paths 覆盖全部 import） |
| 模板依赖 npm 包未发布（步骤 7） | workspace 链接（node_modules/@proteus/* 指向 packages）；发布后切 npm |
| create-proteus 快照脚本与主仓同步 | 步骤 7 重写 snapshot-template.ts（只快照应用壳） |

## 验收清单

- [ ] `src/{platform,router,runtime,shims}` 全部移入 packages（`src/` 仅剩 components）
- [ ] `@proteus/*` 精确别名，业务代码零改动（import 路径不变）
- [ ] 198 测试 + 双端构建 + e2e 全绿（每步）
- [ ] create-proteus 生成的工程不再包含框架本体副本，双端构建通过
- [ ] roadmap §5 架构演进对齐（packages/{compiler,runtime,router,plugin-vite,shared,cli,create-proteus}）

## 文档版本

v1.0（规划落地，roadmap v0.2 结构性欠账 C 类）
