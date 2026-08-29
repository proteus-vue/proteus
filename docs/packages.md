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

- [ ] `git mv src/runtime → packages/runtime/src`（appSkeleton/debug/pageLifecycle/setDataBridge/store）
- [ ] `packages/runtime/package.json` + 构建（依赖 shared）
- [ ] 引用面改 `@proteus/runtime`；appSkeleton 的插件引用同步
- [ ] 验证：测试 + 双端构建
- 规模：~150 行；风险：低

### 步骤 4：router 包 + 工厂化

- [ ] `git mv src/router → packages/router/src`（types/guards/skyline/presets；index.ts 改 createRouter 工厂，删单例）
- [ ] `examples/router/index.ts` 新单例（`createRouter(routes)`，routes 来自应用侧 auto-routes）
- [ ] gen-routes 的 `routesOutput` 指向 `examples/router/auto-routes.ts`；RouterView 引用同步
- [ ] 验证：路由 15 用例（改为工厂实例）+ e2e
- 规模：~250 行；风险：中（工厂化是行为变化，路由测试兜底）

### 步骤 5：plugin-vite 包（插件 + gen-routes）

- [ ] `git mv vite-plugin-mp-transform.ts scripts/gen-routes.ts → packages/plugin-vite/src/`
- [ ] `packages/plugin-vite/package.json`（依赖 compiler + shared；config 由调用方传入或插件读项目 config）
- [ ] 根 vite.config / proteus.config 引用改包；`build:mp` 脚本链（gen-routes）改包内路径
- [ ] 验证：build:mp 全链路（gen-routes → 插件 → 产物）
- 规模：~250 行；风险：中（构建链路）

### 步骤 6：别名与引用面全量切换

- [ ] vite alias / tsconfig paths：`@proteus/{router,runtime,shared,compiler,plugin-vite}` 精确映射，删除泛化 `@proteus` → src/
- [ ] examples 全部 import 改精确包路径（@proteus/router、@proteus/runtime、@proteus/components 保持 src）
- [ ] 验证：vue-tsc + 198 测试 + 双端构建
- 规模：~200 行；风险：中（引用面广）

### 步骤 7：create-proteus 模板重构

- [ ] 模板 package.json 依赖 `@proteus/{router,runtime,shared}`；删除模板中框架本体 src/ 副本
- [ ] 模板应用侧 `src/`（main*/App.vue/pages）+ router 单例 + 路由表；snapshot-template.ts 调整（不再复制框架 src/）
- [ ] 验证：`npm create` → 生成工程双端构建通过（端到端）
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
