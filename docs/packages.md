# 框架本体拆包（Monorepo Packages）—— 规划与实现

> **状态**：✅ 全部完成（8 步全落地，决策 #98-#105）——框架本体 `src/{platform,router,runtime,shims}` 全部移入 packages，create-proteus 模板依赖 npm 包、不再复制框架本体
> **目标**：把框架本体 `src/{platform,router,runtime,shims}` + `vite-plugin-mp-transform.ts` + `scripts/gen-routes.ts`
> 拆成 monorepo packages（`@proteus-vue/router` / `@proteus-vue/runtime` / `@proteus-vue/plugin-vite` / `@proteus-vue/shared`），
> 应用工程不再复制框架本体（create-proteus 模板改为依赖 npm 包），对齐 roadmap §5 架构演进。
> **原则**：每步独立提交、全绿后再下一步；保持 `@proteus-vue/*` 导入路径不变（包化是替换别名指向，业务代码零改动）。

## 现状与目标

| | 现状 | 目标 |
|---|---|---|
| 框架本体 | `src/{platform,router,runtime,shims,components}` + 根 `vite-plugin`/`gen-routes` | `packages/{router,runtime,plugin-vite,shared}` |
| 应用工程 | create-proteus 模板**复制**框架本体 src/ | 依赖 `@proteus-vue/*` npm 包（workspace 链接） |
| 别名 | `@proteus-vue` → `src/`（一个别名通吃） | `@proteus-vue/router` → `packages/router/src` 等（精确映射） |
| router | 框架单例（index.ts import 生成 auto-routes） | **工厂化** `createRouter(routes)`，auto-routes 随应用 |

## 目标包结构与依赖方向（roadmap §5 对齐）

```
packages/
├── shared/        # @proteus-vue/shared：平台 adapter + 全局类型（shims）+ 公共工具
├── runtime/       # @proteus-vue/runtime：setDataBridge / pageLifecycle / store 桥 / provide-inject / appSkeleton
├── router/        # @proteus-vue/router：createRouter / guards / skyline / presets（依赖 shared）
├── plugin-vite/   # @proteus-vue/plugin-vite：vite 插件 + gen-routes（依赖 compiler + shared + module + config）
├── module/        # ★@proteus-vue/module 模块化（module-plan B0-B9：契约/图谱/编排器/审计/Web 分包）
├── capabilities/  # ★@proteus-vue/capabilities 能力体系（platform-plan B1-B5：契约/Registry/分叉/降级/规范）
├── compiler/      # ✅ 已有
├── cli/           # ✅ 已有（build / explain / rules / module:* / audit / capabilities:*）
└── create-proteus/# ✅ @proteus-vue/create-proteus（模板改依赖 @proteus-vue/* npm 包）
```

依赖方向（单向）：`plugin-vite → compiler + shared`；`cli → compiler + plugin-vite(gen-routes)`；`runtime → shared`；`router → shared`；业务代码只依赖 `@proteus-vue/*`。

## 关键设计决策（★执行前必读）

1. **config 解耦（拆包前置，三处）**：
   - `runtime/setDataBridge` 的 `batchWindow` ← `proteus.config` → 改 `createSetDataBridge({ batchWindow: 16 })` 工厂（默认 16，插件/入口注入）
   - `router/skyline` 的 `isSkyline()` ← `config.skyline` → 构建期 `__PROTEUS_SKYLINE__` define 注入（vite define 已有先例：`__PROTEUS_DEBUG__`）
   - `platform/index` 的 adapter 选择 ← `config.platform` → `createAdapter(isMP)` 工厂（入口决定，`import.meta.env.MODE` 判断）
2. **adapter 归 shared**：`src/platform/`（adapter 抽象 + mp/web 实现）→ `packages/shared/src/platform/`——runtime/router 都依赖它，减少包数
3. **shims 归 shared**：`mp.d.ts`（wx/Page/RouteBuilder/RouteContext 全局）+ `events.d.ts` + `vue.d.ts` → `packages/shared/src/shims/`（全局声明，包内 include 即可）
4. **gen-routes 归 plugin-vite**：`scripts/gen-routes.ts` → `packages/plugin-vite/src/gen-routes.ts`（构建链路统一；cli 可复用）
5. **router 工厂化（★最大行为变化）**：`@proteus-vue/router` 提供 `createRouter(routes)`（去单例）——`examples/router/index.ts` 持路由表实例；auto-routes 生成位置 `routesOutput` 改为应用侧（`examples/router/auto-routes.ts`）
6. ~~**components 暂留 src/**~~ **已于 2026-09-14 拆包**：`@proteus-vue/components` → `packages/components/`（第 41 包，发源码；alias 与 frameworkComponentsDir 已退役，见下文「定位与退役路径」）
7. **别名精确化**：vite alias + tsconfig paths：`@proteus-vue/{router,runtime,plugin-vite,shared,compiler}` 各自映射包 src；**删除泛化 `@proteus-vue` → src/**（防误匹配）
8. **create-proteus 模板重构**：模板不再复制框架 src/{platform,router,runtime,shims}——应用 `package.json` 依赖 `@proteus-vue/{router,runtime,shared}` + 框架组件；`src/` 只剩应用代码（main*/App.vue/pages/components 应用级）；snapshot-template.ts 调整

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
- [x] 引用面改 `@proteus-vue/shared`（runtime/router 4 处 + RouterView）；vitest.config 独立 alias；tsconfig types/include/paths；snapshot-template 源改 packages/shared/src
- [x] 验证：vue-tsc + 198 测试 + 双端构建 + shared 包构建 + 模板快照 + workspace 链接
- 决策：#99；踩坑：① perl/sed 替换 `@proteus-vue` 被当数组插值吞掉（改用 node replaceAll）② vitest 独立配置无别名（vitest.config 补 @proteus-vue/shared）③ 测试 mock 路径与实际 import id（'../src/platform' vs '@proteus-vue/shared'，re-export 链 mock 失效）——改 mock '@proteus-vue/shared' ④ import.meta.env 类型（shared 独立构建无 vite types）——(import.meta as any) 断言

### 步骤 3：runtime 包

- [x] `git mv src/runtime → packages/runtime/src`（appSkeleton/debug/pageLifecycle/setDataBridge/store + index 聚合）
- [x] `packages/runtime/package.json`（依赖 @proteus-vue/shared，构建 external shared）+ tsconfig.build（types 引 shared shims 全局声明）
- [x] 引用面：插件 appSkeleton `./packages/runtime/src/appSkeleton`、tests 相对路径、vite/vitest alias + tsconfig paths/include @proteus-vue/runtime、snapshot 源改 packages/runtime/src
- [x] 验证：vue-tsc + 198 测试 + 双端构建 + runtime 包构建 + 模板快照 + workspace 链接
- 决策：#100；踩坑：runtime 独立构建缺全局类型（__PROTEUS_DEBUG__/PageOptions/ComponentOptions 在 shared mp.d.ts）——tsconfig.build types 引 shared shims

### 步骤 4：router 包 + 工厂化（✅ 已落地，另含 M1/M2 增量）

- [x] `git mv src/router → packages/router/src`（types/guards/skyline/presets；index.ts 改 createRouter 工厂，删单例；guards 工厂化——routeMap 由 push 注入）
- [x] `packages/router/package.json`（依赖 @proteus-vue/shared，peer @vue/compiler-sfc）+ tsconfig.build（types 引 shared shims + @types/node）
- [x] `examples/router/index.ts` 新单例（`createRouter(routes)`，routes 来自应用侧 auto-routes）；`examples/router/auto-routes.ts` 随应用存放（模块扩充注入 `@proteus-vue/router/types` 的 RouteParamsByName，vue-router 同款模式——push 泛型推导/PageOnLoad 负例零回归）
- [x] gen-routes 的 `routesOutput` 指向 `examples/router/auto-routes.ts`（输出改 `declare module` 扩充）；RouterView 改 `./auto-routes` 相对导入（仓库与模板通用）
- [x] 路由规划 M1/M2 增量（docs/proteus-router-plan）：`schema.ts`（手写校验 + RouteValidationError 含 loc）+ `scan.ts`（@vue/compiler-sfc 解析 + 行号定位）+ `tree.ts`（嵌套树：path 推导 + parent 显式优先 + 环检测 + sortByPath 稳定）+ `merge.ts`（meta 深合并限深 3）
- [x] 验证：vue-tsc 零错 + 216 测试（新增 18 条 M1/M2 用例）+ 双端构建 + router 包构建 + 模板快照 + workspace 链接（@proteus-vue/router）
- 决策：#101；踩坑：lazy 默认值语义（scan 不强制置 true，交给 defaults 解析）；RouteNode.parent 保留（构建期使用）；auto-routes 模块扩充（空基接口保证 name 受限负例成立）

### 步骤 5：plugin-vite 包（✅ 已落地）

- [x] `git mv vite-plugin-mp-transform.ts scripts/gen-routes.ts → packages/plugin-vite/src/`（plugin.ts / gen-routes.ts；另 appSkeleton 从 runtime 迁入——构建期 app.js 骨架模板归构建期包，runtime 纯运行期）
- [x] `packages/plugin-vite/package.json`（依赖 compiler + router；peer vite；devDep esbuild/sass/@types/node）+ tsconfig.build（rootDir ./src，exclude cli.ts）
- [x] **config 解耦**：插件不再 `import './proteus.config'`——`PluginOptions.config` 由 vite.config 注入；`ProteusConfig` 类型契约迁入 `packages/plugin-vite/src/config.ts`，根 proteus.config.ts 改为 import 类型 + 实例化
- [x] **gen-routes 双形态**：纯函数库 `runGenRoutes({ config, root })`（可单测）+ CLI 入口 `src/cli.ts`（tsx 直跑，动态 import 项目 config）；package.json build:mp/dev:mp 指包内 cli
- [x] 引用面：vite.config（import 包 + `mpTransform({ config })`）、proteus.config（builders 预设路径改 packages/router/src/presets）、tests（plugin.test 路径 + 新增 gen-routes.test 3 用例）、vitest alias @proteus-vue/compiler、tsconfig include
- [x] snapshot-template：plugin.ts→vite-plugin-mp-transform.ts（appSkeleton 路径替换）+ gen-routes 库→scripts/gen-routes.ts（@proteus-vue/router→../src/router/types、./config→../proteus.config）+ cli→scripts/gen-routes-cli.ts + appSkeleton→src/runtime/；模板 vite.config/package.json 手写同步
- [x] 验证：vue-tsc 零错 + 219 测试（+3 gen-routes）+ 双端构建 + plugin-vite 包构建 + 模板 gen-routes CLI 冒烟 + workspace 链接
- 决策：#102；踩坑：① workspace 依赖版本必须对齐实际包版本（compiler 0.2.0——0.1.0 触发 npm 404 拉 registry）② vite.config bundle 阶段不走 resolve.alias → 插件 @proteus-vue/compiler 解析到 dist（prepare 钩子保新鲜）③ tsx 动态 import 需带 .ts 扩展名 + 层级数（src/ → 根为三级）④ 动态 import 根 config 拉偏 tsc rootDir 推断 → CLI 拆独立 cli.ts + tsconfig.build exclude

### 步骤 6：别名与引用面全量切换（✅ 已落地）

- [x] vite alias / tsconfig paths：`@proteus-vue/{router,runtime,shared,compiler,plugin-vite,components}` 精确映射，**删除泛化 `@proteus-vue` → src/（防误匹配）**
- [x] ~~`@proteus-vue/components` → `src/components`~~ → **2026-09-14 拆包为 `packages/components/`**（真实包，发源码；alias 已删，MP 改 node_modules 解析）
- [x] 模板 vite.config 同步精确化（vendored 结构：@proteus-vue/shared → src/platform/index.ts（adapter 聚合）、@proteus-vue/router → src/router、@proteus-vue/runtime → src/runtime）
- [x] 盘点确认：examples 全部 import 已是精确包路径（步骤 2-5 铺垫），无 `@proteus-vue` 泛化残留；`@/` 保留（无人用，兼容未来）
- [x] 验证：vue-tsc 零错 + 219 测试 + 双端构建 + 模板快照
- 决策：#103；风险收敛：引用面在步骤 2-5 已逐包精确化，本步只需删兜底，无存量 import 受影响

### 步骤 7：create-proteus 模板重构（✅ 已落地）

- [x] 模板 package.json 依赖 `@proteus-vue/{router,runtime,shared,plugin-vite,compiler}`（npm 包形态）；**删除模板中框架本体 src/ 副本**（platform/runtime/router 框架代码 + vite-plugin-mp-transform.ts）
- [x] 模板应用侧 `src/`：main*/App.vue/pages + router 单例（index.ts）+ RouterView（应用壳）+ auto-routes（占位）+ shims（应用侧全局类型，自 shared 复制）+ scripts/gen-routes.ts 薄壳（runGenRoutes 来自包）
- [x] snapshot-template.ts 重构：只快照应用壳（RouterView/index.ts/shim s/mp-entry-stub/index.html），手写模板（package.json/proteus.config/vite.config/tsconfig/main*/App/pages/auto-routes/gen-routes）
- [x] router 包 exports 补子路径（./types 等纯类型 + ./package.json）+ files 加 src/presets（预设源码随包发布，插件内联需要）；插件 loadPresetBuilders 支持 node_modules 包内路径（resolvePkgPath，scoped 包正则）
- [x] 验证：**模板目录内双端构建通过（workspace 链接形态）**——gen-routes → vue-tsc → vite build web/mp-weixin；app.js 内置预设 halfScreen/slideUp/scaleDown 全部内联注册；主仓 222 测试 + vue-tsc + 双端构建；真实 `npm create` 端到端待 npm 发布后验证（用户暂不发布）
- 决策：#104；踩坑：① 模板 App.vue 不能引 `@proteus-vue/router/RouterView.vue`（npm 包 exports 无此子路径 → 应用壳相对导入）② 插件 `@proteus-vue/plugin-vite` 命名导出（模板 default import 不匹配 → 统一命名导入）③ require.resolve('@proteus-vue/router/package.json') 被 exports 拦截（补 ./package.json）④ node_modules 路径正则要处理 scoped 包（@proteus-vue/router 两层）⑤ 模板构建走 workspace 链接 dist（plugin-vite 加 prepare 保新鲜）
- 规模：~300 行；风险：中高（模板大改，端到端验证）

### 步骤 8：CI/构建/文档收尾（✅ 已落地）

- [x] CI（.github/workflows/ci.yml）：verify job 加 `npm run build --workspaces`（7 包独立构建，prepare 钩子 npm ci 自动构建 dist）+ 模板快照一致性检查（快照后 git diff 无差异 → 模板与主仓同步防漂移）
- [x] 根 `verify` 脚本加 workspace 构建；本地验证 `npm run build --workspaces` 全包通过
- [x] docs/roadmap.md 工程化行 ✅（拆包 8 步完成）、compiler/create-proteus 行描述更新（npm 包形态）；docs/packages.md 升级正式文档（状态 ✅）；PROJECT_MEMORY 决策 #105
- 决策：#105；遗留：npm 发包待启用（用户暂不发布）——发布后验证 `npm create` 真实端到端

## 框架内置组件的定位与退役路径（v0.4 补充，★2026-09-14 已按 v2.0 规划完成拆包）

**★现状（2026-09-14：组件库已拆包）**：`@proteus-vue/components` 已成为**真实 workspace 包**（`packages/components/`，
第 41 包）——73 个 `p-*` 语义组件 + `pg-glass` + `virtual-list` + `runtime/contracts/theme` 共 90 文件。
**包发源码**（`publishSource: true`，不产 dist）：① MP 编译器需在磁盘上扫 `.vue`（`<dir>/<tag>/index.vue`）；
② 与「一份源码双端」一致（Web 由消费方 `@vitejs/plugin-vue` 编译）。

| 侧 | 定位方式（拆包后） | 说明 |
|---|---|---|
| Web | **workspace 软链**（`node_modules/@proteus-vue/components` → `packages/components`） | alias 已删除；`import ... from '@proteus-vue/components'` 直接可用 |
| MP 编译（plugin-vite） | `resolveComponentsRoot(projectRoot)` 自 node_modules 解析包根（`resolve-components.ts`） | 「语义组件库目录」选项**已删除**；包缺失时**告警**（非静默） |
| MP page.json（gen-routes） | 同上（同一解析器，两者共用） | 产物 rel 仍规范化 `proteus/<name>/index`（**对外契约不变**） |

**v2.0 四条退役条件——已全部完成**：

1. ✅ Web 侧删除 alias（根/examples/showcase/website 的 tsconfig + vite 配置共 7 处），业务代码直接 `import`
2. ✅ MP 侧改自 node_modules 解析包根（复用步骤 7 的 `createRequire(projectRoot)` 先例）；产物路径不变
3. ✅ `frameworkComponentsDir` 选项**已删除**（types config / config-layers / config-validate / plugin-vite 两处 / cli build+dev / 三个消费方配置）
4. ✅ 消费方依赖升级为真实包（`workspace:*`，由 pnpm 软链）；`check-deps` 的 `@proteus-vue/components` 豁免已移除

★新增门禁：`check-package-health` 支持 `publishSource: true` 源码包分类（校验 `main`/`types`/`exports` 指向存在的源码文件、`files` 含 `index.ts`，跳过 dist 检查）。


## 版本组策略：fixed → linked（★2026-09-20）

**背景：两次都是被真实代价推动的。**

| 阶段 | 配置 | 解决的问题 | 引入的代价 |
|---|---|---|---|
| 2026-09-19 | **fixed** `[["@proteus-vue/*"]]` | 「41 包各走各的版本（实测 **14 种**）+ 65 处 exact pin 靠人同步必漏」 | **每次发布都要 bump + 重发全部 41 个包** |
| 2026-09-20 | **linked** `[["@proteus-vue/*"]]` | 只 bump/发布**实际变更**的包 | 各包预发布序号会不同（不再是 41 包同号） |

**fixed 的代价实测**（切换的直接动因）：

```
只给 compiler 写一个 patch changeset → npx changeset version
  fixed：41 个包全部 → 0.3.0-beta.12   （连内容从未变过的 docs/mcp 也要重发；
                                        它们已积累 7~10 个版本号）
  linked：4 个包 → 0.3.0-beta.12        （compiler + 依赖它的 cli/plugin-vite/test-core）
          37 个包停留在 0.3.0-beta.11
```

**linked 的语义**（读 `@changesets/assemble-release-plan` 源码 + 实验确认）：

- 只遍历**已产生 release**（`type !== "none"`）的包 → 未变更的**不 bump**；
- 但**依赖方自动级联**（实测：改 1 个叶子包 → 4 个包；改 `shared` → **16 个包**），
  这正是防「依赖 pin 指向旧版 → 重复副本/单例拆散」的关键机制；
- 组内**已发布的包仍保持同号**，故不会退回「14 种版本号」的乱局。

**配套改动**：

1. `.changeset/config.json`：`fixed: []` + `linked: [["@proteus-vue/*"]]`；
2. **门禁判据改写**（`check:internal-versions`）：从「41 包版本号必须完全相同」改为
   **「必须同在一条 `major.minor.patch` 线」**（如都 `0.3.0`，`-beta.N` 序号可不同）。
   这条仍能拦住真正的分裂（某包被单独提到 0.4.0/1.0.0），又允许 linked 的按需发版；
3. **发布器省掉白做的活**（`publish-all.sh`）：把「查 registry」提到「打包」**之前**——
   此前顺序是「打包 → 查 registry → 跳过」，于是 linked 下 37 个未变更的包仍被逐个打包（纯浪费）。
   现在 registry 已有该版本 → **直接 skip，不打包**；
4. **回归锁** `tests/version-group.test.ts`：linked 配置必须在位、fixed 必须为空、
   所有包同一条版本线、examples/模板的 pin 指向各包**自己的**版本（`workspace:*` 合法）。
   破坏性验证：改回 fixed → 测试当场红。

> ★**注意**：`--dry-run` 仍会走全部 41 个包（它的职责是验证「发布命令本身可用」，不能跳步）。

## 外部报告台账：让「报 N 修 M」可机器核对（★2026-09-20）

**问题**：外部实战报告（OPERATOR/web）提出的问题、修复、验证状态此前散落在 `PROJECT_MEMORY` 与回执段落里，
是**散文**——无法机器核对。最直接的教训：第六轮报告指出「一个 bug 有三条路径」，我们只修了一条，
**没有任何机制能发现「报 3 修 1」**，靠下一轮外部复测才撞出来。

**做法**：`docs/外部报告台账.json`（自描述 schema）+ `scripts/ledger-check.mjs`（对账与校验）。

**收口（resolved）判据 = 三件事同时成立**：

1. `status=fixed` —— 代码改对了；
2. `fix_state=published` —— **已上 npm**（只改工作树 → 用户拿不到，不算收口）；
3. `verification=passed` —— **被独立复测过**（只有框架自测不算「用户拿得到且被验证过」）。

**用法**：

| 命令 | 用途 |
|---|---|
| `pnpm check:ledger` | **schema 门禁**——必填字段 / 枚举合法 / blocker 必带 repro / partial 必带 related / `fixed_in` 不得超前于已验版本。台账不合格 → exit 2。**已接入 CI 与 `pnpm verify`** |
| `pnpm ledger:check` | **发布前自查**——有未收口项（未发布 / 验证不充分 / 部分修复）即 exit 1。回答「报 N 条，真正收口了几条」 |
| `node scripts/ledger-check.mjs` | 对账报告（恒退出 0，含逐条未收口说明） |

> 为什么 CI 只跑 schema 模式而不跑 `--check`：后者会把「已修未发布」也算未收口 → 常驻红。
> **未发布是正常中间态**，不是 CI 该拦的；但它是**发布前**必须被看见的状态。

**当前台账**：25 条（external 18 / framework 7），真实收口率见 `pnpm ledger:check` 输出——
把「我们自己发现的同类缺陷」也登记进去（`found_by=framework`），是因为**外部报告没提 ≠ 不存在**：
本次补登的 7 条里有 3 条是发布物缺陷（`types` 死子路径、`rust` 包缺 crate 源码、两个包 README 悬空声明），
2 条是 Bug B 的同族漏网路径（方法名 / 动态 SVG 误改字符串），这些**外部报告都没写**，但同属「已修/待发」范畴。

**破坏性验证**：人为植入 3 处腐化（blocker 缺 repro / partial 缺 related / `fixed_in` 超前）→ 门禁全部抓出、exit 2 → 还原绿。

## 官网数字：从「宣称」到「可重算」（★2026-09-20）

**问题**：`website/src/stats.ts` 自称「数字单一来源，禁止散落硬编码」，但**没有任何门禁校验它**。
实测 8 项里 **7 项长期过时**：

| 项 | 官网旧值 | 实际值 |
|---|---|---|
| @proteus-vue/* 包 | 40（且同页 Hero 写 40、数字区写 41——**一个页面两个数**） | **41** |
| 单测全绿 | 2966 | **3441**（290 文件） |
| 语义原语 SSOT | 176 | **183** |
| implemented 语义 | 54 | **64** |
| 语义组件 | 66 | **76** |
| 编译规则 | 106 | **111** |
| conformance 套件入口 | 8 | **10** |
| plan 文档 | 81 | **85** |

根因与 2026-09-20 的发布物事故**同形**：*只检查「我声明的」，不核对「实际是什么」*。

**修法三层**：

1. **单一来源收敛**——`stats.ts` 补 `id`（供门禁定位）与 `labelEn`（英文页从同一数组派生）；
   `Home.vue` 的 Hero 与 `STATS_EN` 原先**各自硬编码一份数字**（中文改了英文不改），现全部从 `STATS` 派生。
2. **新增门禁 `check:stats`**（`website/scripts/check-stats.ts`，已接 CI + `verify`）：
   凡**可机器重算**的 7 项，逐项与源码实际值比对（读 `PRIMITIVE_CATALOG` / `implementedPrimitives()` /
   `listTransformRules()` / 扫包目录 / 扫 conformance 入口），不符即 CI 红。
   唯一豁免 `tests`（需跑全量套件，代价高）——在 `stats.ts` 注释里写明由发布前手动核对。
   **破坏性验证**：把组件数改回 66 → 门禁报 `✗ components: 声明 66 但实际 76`、exit 1 → 还原绿。
3. **计数规则明确化**——原先的「8 conformance 套件」无对应规则可重算，现写明为
   `packages/*/src/*conformance*.ts` 文件数（10）；「× 6 后端」写明为
   `SEMANTIC_BACKEND_MAP` 的 6 个**端**键（vue-dom/skyline/native-ios/native-android/native-harmony/flutter，
   另有 headless 参考后端不属端）。

> 另修正 `PROJECT_MEMORY.md` 项目概览的「40 个包」→ **41**（该文件是新会话的权威依据，
> 它写错会让后续每个会话都从错数出发）。

## 发布打包：声明与打包器解耦（★2026-09-20 事故根治）

**一次真实事故**：`@proteus-vue/components@0.3.0-beta.7` 全量发布后，registry 上的包**只有 17 个文件**——
74 个 `p-*` 组件一个都没进去（本地源码与 `pnpm pack` 都是 94 个）。任何工程 import 组件库立即构建失败
（`Could not resolve "./p-view/index.vue"`），而**四道既有门禁全部放行**。

**根因两层**：

1. `packages/components/package.json` 的 `files` 里写的是**纯目录通配** `"p-*"`——
   **npm 打包器不展开它**（`"p-*/"` 也不行，必须 `"p-*/**"`），而 pnpm 打包器正常展开。
2. 各门禁检查的都是「**我声明的**」（源码文件在不在、构建产物在不在、包清单里有没有写），
   **没有一道检查「实际打出去的包里有什么」**——因此同一份声明在 npm 打包器下静默丢件时，全线绿灯。

事故链：09-19 22:36 的 `0.2.0-beta.2` 走 `changeset publish`（pnpm 仓库内部调 `pnpm publish` → 完整）
→ 23:33 为绕开 changesets 在 pre 模式禁止自定义 tag 的限制，改为逐包 `npm publish`（修复本身正确）
→ 23:37 全量发布**首次经 npm 打包器** → 74 个组件静默丢失。

### 落地的三条规则（**后续所有发布都必须遵守**）

| 规则 | 说明 |
|---|---|
| **打包器固定为 pnpm** | 唯一实现：`scripts/lib/pack-package.mjs`（`pnpm pack`，字节确定——同输入两次 sha512 相同，故可与 registry 的 `dist.integrity` 直接比对）。`files` 里需要通配目录时一律写 `"dir/**"`，**禁止**裸目录通配 |
| **上传仍走 npm** | `npm publish <tarball>`：OIDC trusted publishing / provenance 只认 npm，而 npm 上传 tarball 时**按字节原样上传**（实测 `--dry-run` 报的 integrity 与本地 tarball sha512 一致）→ 打包器与上传器职责可安全分离 |
| **发布物内容必须过门禁** | `pnpm check:publish-contents`（`scripts/check-publish-contents.mjs`，已接 CI + `verify`）：用**发布时同一个打包器**逐包核对——`files` 每项命中 ≥1 文件、入口在包内、**入口的相对 import 闭包在包内可解析** |

> 该门禁首跑即抓出**三处同族缺陷**（都不是本次事故，但同属「声明与发布物不符」）：
> `types` 的 exports 子路径指向从不发布的 `./src/config-schema.ts`；
> `compiler-backend-rust` 声明了从未产出的 `dist`（且包内无 `Cargo.toml`/`src/` → **发出去根本跑不起来**，已修并从 tarball 实测 `cargo build` 成功）；
> `test-ir`/`compiler-backend-rust` 声明 `README.md` 但磁盘无该文件（已补齐）。

**回归锁**：`tests/publish-contents.test.ts`（6 例，含破坏性验证——把 `files` 回退成 `"p-*"` 时测试当场红）。

组件库本身的架构规划见 docs/proteus-component-plan/（L3 @proteus-vue/components：基础组件 + 业务组件，Web/Skyline 双端语义一致）。

## 风险与对策

| 风险 | 对策 |
|---|---|
| router 工厂化破坏既有调用（步骤 4） | createRouter 兼容旧 API（guards/router 方法同签名）；15 路由用例 + e2e 兜底 |
| config 解耦改变运行时行为（步骤 1） | 测试兜底；adapter/skyline 行为等价（构建期注入） |
| 别名泛化删除后漏改（步骤 6） | 步骤 6 验证 vue-tsc 全量（tsconfig paths 覆盖全部 import） |
| 模板依赖 npm 包未发布（步骤 7） | workspace 链接（node_modules/@proteus-vue/* 指向 packages）；发布后切 npm |
| create-proteus 快照脚本与主仓同步 | 步骤 7 重写 snapshot-template.ts（只快照应用壳） |

## npm 发布记录（2026-08-31：beta 预览已全部发布）

> ✅ **22 包全部已发布**（*历史记录（2026-08-31 时点，现包规模 41）*：`npm run changeset:publish`，dist-tag `beta`；首发布时 npm 同时置 `latest`）。发布拓扑：contracts → types → api → app-config → shared → built-in-components → capabilities → compiler → css-compat → module → router → runtime → cli → create-proteus → devtools-runtime → i18n → pinia-sync → plugin-vite → renderer-app → security → test-core → web。
>
> - 包健康门禁 `npm run check:pkg`（22 包 0 error/0 warn）入 verify 末尾
> - **发布凭据**：granular Automation token（只授权 `@proteus-vue` scope，可绕过 2FA）——因此脚手架包从裸名 `create-proteus` **收口改名 `@proteus-vue/create-proteus`**（命令 `npm create @proteus-vue/proteus my-app`），使全部产物统一受组织 token 管理（决策 #215）
> - **README 随包**：22 包 README 全覆盖（9 个此前缺失的包已补齐）——npm 页面展示随下一次版本发布生效
> - test-core 随包 skill（`skills/proteus-test/`）随发布物分发
> - 验证：1058 单测 + check:pkg + Web E2E 13/13 + MP E2E 1/1 全绿；发布前 dry-run 确认 dist 内容正确

## ★版本策略：单版本号（fixed 分组）——2026-09-19 根治「版本号对不齐」

> **背景（用户彻查要求）**：changesets 本为简化版本管理，实际却越管越乱，出现「版本号对不齐」
> 这类低级问题。彻查结论：**问题不在 changesets，而在配置缺了关键一环**。
>
> **根因**：本仓用「**独立版本号 + 精确 pin**」的组合——41 个包各走各的版本，内部依赖
> **65 处全是 exact pin**。任何一个包改动都要级联同步几十处，人为维护必然漏。实测后果：
>
> | 症状 | 实测数据 |
> |---|---|
> | 版本号种类 | **14 种**（`0.1.1-beta.0` ~ `0.3.0-beta.7`）散落在 41 个包 |
> | tag 与本仓分叉 | `cli` 的 `beta` 停在 `0.2.1-beta.0`，`latest` 已到 `0.3.0-beta.6` |
> | 级联面 | 改 1 个包要跟 **65 处 pin** + 模板 7 处 |
> | `fixed` 配置 | `[]` —— changesets 官方的**版本组锁定机制根本没开** |
>
> **整改：启用 fixed 分组**（`.changeset/config.json`）：
>
> ```json
> "fixed": [["@proteus-vue/*"]]
> ```
>
> 支持 micromatch glob（已核 `@changesets/config` 源码确认）。语义：**组内任一包要发版，
> 全组一起发同一版本号**。
> **实测生效**：`npx changeset version` → **41 个包全部 `0.3.0-beta.7`**（14 种 → **1 种**）；
> `sync-internal-versions` 自动对齐 65 处内部 pin + 模板 7 处，**零手工**。
>
> **门禁锁死该不变式**（`scripts/sync-internal-versions.mjs::assertUniformVersions`）：
> ① 所有 `@proteus-vue/*` 版本号必须完全相同；② 内部 pin 必须等于该版本（或 `workspace:`）。
> 破坏性验证：把 `agent` 改成 `0.1.0` → 门禁红并指名该包；恢复 → 绿。已接入 CI 与 `pnpm verify`。
>
> **收益**：今后「版本号对不齐」在**结构上不可能发生**——不必再靠人肉同步 65 处 pin。
> 代价：任一包有改动，全组一起升版本号（对本仓「整体交付一套框架」的定位是正确取舍）。

**发布流程（一条命令）**：

```bash
pnpm release            # ① 凭据预检 ② 自动版本提升 ③ changeset publish ④ 发布核验 ⑤ tag 归一
pnpm release --all      # （仅在需要把全部包的 latest 归位时）全部包补 patch 并重发
```

> ★**设计原则：发布就是一条命令**（2026-09-19 用户反馈后收敛）。
> 版本提升、模板/examples/根包 pin 同步、lockfile 更新这些**机械动作全部由脚本完成**，
> 不要求人记步骤、也不在出错时把人挡在门外。
>
> ★**发布 tag 策略：单轨（统一 `latest`）**——本项目只有一条线，不出现两套并行版本。
> 背景：changesets 默认会按包的发布历史分流（`getReleaseTag()`：发布过的版本**全是**
> prerelease 的包会被**故意发到 `latest`**，其余发到 preState.tag）——实测同一批发布中
> `cli`/`plugin-vite` 去了 `latest` 而 `create-proteus` 去了 `beta`，形成
> 「有的在 beta 有的在 latest」的割裂。现显式统一为 `latest`（源码 `if (tag) return tag`
> 表明显式 tag 优先级最高）。
> 理由：① npm **强制**每个包必须存在 `latest`（删掉它 `npm i <pkg>` 直接解析失败），
> 无法真正取消该 tag；② 文档里的安装命令都不带 tag（走 `latest`），让 `latest` 恒等于最新版
> 意味着用户按文档装就拿对；③ 版本号本身带 `-beta.N` 前缀，语义上仍是预发布。
> 注：**事后**改 tag（`npm dist-tag`）属包管理操作，会被 npm 要求交互式 2FA（实测 EOTP），
> 而**发布时设置 tag 不受此限**——所以「发到 latest」是零手工的可行路径；`pnpm release --all`
> 即用此原理一次性把全部包的 `latest` 归位。
>
> `scripts/release.mjs` 的五步：
> 1. **凭据预检**——快失败，避免 36 行 E404 噪声掩盖真正的 E401；
> 2. **自动版本提升**——未消费的 changeset → `changeset version`；**改了源码但没 bump 的包
>    → 自动补 patch changeset 再 version**（不补会被 npm 静默跳过，用户拿到的仍是旧包——
>    这正是那次真实事故的成因）；随后同步 pin + 更新 lockfile。
>    ★pre 模式下 changesets 不删已消费的 `.md` 而是记进 `pre.json`，脚本据此判定「未消费」，
>    不会把历史 changeset 误报为待处理；
> 3. **发布**——`changeset publish --tag latest`。★退出码非 0 **不立即判定失败**：
>    版本已存在时 npm 返回 E409（`Cannot publish over previously staged version`），
>    changesets 遂以非零退出，但包其实已在线上（实测踩到，会让人误以为发布失败）；
> 4. **发布核验**——逐个包查 registry 是否已收录本仓版本。★带**有界重试**：npm 自身有传播
>    窗口（其提示为 "being processed and may take a few minutes"），单次查询会误报「未上架」
>    （实测踩到）；只对「查不到」重试，查到即通过，上限 3 分钟；
> 5. **tag 归一**——`beta` 与 `latest` 都指向当前版本；失败只提示，不让已完成的发布失败。
>
> 辅助命令：
> - `pnpm release --dry-run`——只体检（凭据 + 待提升清单），不改动不发布；
> - `pnpm publish:smoke`——**发布后深度实测**：干净目录跑真实用户旅程
>   （`npm create` → `npm install` → 依赖树无重复副本 → `proteus --help` → 导出面），
>   耗时 1~2 分钟，故**不在发布主流程内**，需要时单独跑；
> - `pnpm publish:tags`——tag 漂移报告（`--print` 打印命令；见下节《复盘续三》）。
>
> 发布完成后提交版本提升的改动：`git add -A && git commit -m "chore(release): 版本提升"`。

## ★npm 发布事故复盘（2026-09-19：CLI 在真实项目「启动即崩」）

> **现场**：另一个项目（OPERATOR/web）装 npm 上的 `@proteus-vue/cli@0.3.0-beta.2` 后**无法启动**：
> `SyntaxError: The requested module '@proteus-vue/devtools-runtime' does not provide an export named
> 'createFlamegraphCollector'`（已在本仓本地 100% 复现）。
>
> **根因（发布机制缺陷，非单包问题）**：`scripts/publish-all.sh` 旧逻辑为
> ```
> existing=$(npm view "$name@$version" version); if [ -n "$existing" ]; then echo "skip ..."; continue; fi
> ```
> 「已存在该版本 → 跳过」对**幂等重跑**是正确的，但它**无法区分两种情况**：
> ① 内容确实一致（跳过正确）；② **本地源码改了却没 bump 版本号**（跳过 = 新内容永远发不出去）。
> 事故即 ②：`devtools-runtime` 等包改了但未 bump → 被静默跳过；依赖它的 `cli` bump 并发版 →
> 声明 `0.1.0` 拿到的仍是**旧构建**（只有 8 个导出，本地有 30+）→ 顶层 import 失败 → 启动即崩。
>
> **实测范围（本次全量核对，41 包）**：**36 个包**「版本号相同但内容不同」（判据 = 本地
> `npm pack` integrity ↔ registry `dist.integrity`，本地 pack 实测可复现）；仅 5 个一致
> （均为未改动过的 `0.1.0`）。
>
> **修复（防复发，已落地）**：
> 1. 新增 `scripts/check-publish-drift.mjs`——「同版本号 ⇒ 内容须一致」全量核验
>    （`--check` 仅在「同版本不同内容」时 exit 1；「本地领先未发布」属正常状态不报错）。
> 2. `publish-all.sh` 改为**发布前先跑漂移预检**，且已存在版本改判
>    「integrity 相同 → 幂等跳过 / 不同 → FAIL 并提示 bump」（`--allow-drift` 可显式放行）。
>    ★两个分支都已验证：内容一致（gesture/dev-host）→ 幂等跳过；内容不同 → 拦住。
>
> **待办（需 npm 凭据，token 已失效 E401）**：
> 1. 给 36 个漂移包 bump 版本（建议走既有 changesets 流程——它能**自动对齐 workspace 精确依赖**；
>    仓内 58 处内部依赖均为 exact pin，手工 bump 易漏）。beta 包 → beta 序号+1；正式包 → patch+1。
> 2. `node scripts/check-publish-drift.mjs` 复核归零 → `npm run changeset:publish` 发布。
> 3. **发布后**再跑一次漂移核验（应为 0 漂移）+ 在一个干净目录里 `npm i @proteus-vue/cli@latest`
>    实测 `proteus --help` 可跑（本次事故正是「发布后没做这一步」才漏到用户侧）。
>
> **教训**：*「已发布」不等于「发布的是当前代码」*——发布幂等跳过必须带**内容校验**；
> 且「发布后可用性」需要在**干净环境**里实测，而不是只看 publish 命令退出码 0。

### 复盘续（2026-09-19 二次取证：★根因不止一处，且**第一轮修复没覆盖用户旅程**）

发版成功后，用新写的**发布后冒烟脚本**在干净目录跑「真实用户旅程」，抓到**第二层根因**——
它不是 `publish-all.sh` 的缺陷，而是**模板依赖声明**的缺陷，**修完第一层后它依然复现**：

```
$ npm create @proteus-vue/proteus@beta my-app && cd my-app && npm install   # 用户真实旅程
# ★注（2026-09-20）：此行是当时的**历史记录**。`@beta` 现已是历史遗留 tag（归位需重发：pnpm realign:beta）；
#   当前请用不带 tag 的 `npm create @proteus-vue/proteus my-app`（latest 恒指向最新版）。
$ 检查依赖树（实测，修复前）
  cli                  0.2.1-beta.0                  ← 不是修好的 0.3.0-beta.5
  devtools-runtime     0.1.0                        ← 正是「只有 8 个导出」的崩溃版
  shared               0.2.0-beta.0 | 0.2.0-beta.2  ⚠★重复副本
  router               0.2.0-beta.0 | 0.2.0-beta.5  ⚠★重复副本
  runtime              0.2.0-beta.0 | 0.2.0-beta.4  ⚠★重复副本
  compiler             0.3.0-beta.0 | 0.3.0-beta.3  ⚠★重复副本
  module / contracts / types                        ⚠★重复副本（共 7 个包）
```

**根因（prerelease 的 caret 语义）**：`packages/create-proteus/templates/package.json` 写的是范围——
`"@proteus-vue/cli": "^0.2.1-beta.0"`、`"@proteus-vue/devtools-runtime": "^0.1.0"`。
但 caret 对**预发布版**的规则是「**仅当 (major,minor,patch) 元组完全相同**才匹配该元组的预发布版」：

* `^0.1.0` **永远不会**匹配 `0.1.1-beta.1`（元组变了）→ 用户装到 **0.1.0**（8 导出的旧包）；
* `^0.2.1-beta.0` 也够不到 `0.3.0-beta.5`（元组 0.2.1 → 0.3.0）→ 用户装到 **0.2.1-beta.0**。

**链式后果（为什么变成「重复副本」）**：旧 `cli@0.2.1-beta.0` 的内部依赖是 **exact pin**
（本仓 58 处内部依赖均为此形态）`shared@0.2.0-beta.0`，而顶层已解析出 `shared@0.2.0-beta.2`——
npm 无法提升到同一份 → **在 `node_modules/@proteus-vue/cli/node_modules/` 下嵌套第二份副本**
→ 两个物理副本 = **模块被求值两次 = 模块级单例被拆散**（本仓已用 `globalThis` 挂单例，
但那解决的是「跨副本共享」；依赖树自洽才不会产生无谓副本）。

> ★这解释了实战报告作者观察到的「URL 变了视图不更新、且**无任何报错**」——它和 CLI 崩溃是
> **同一根因的两个表现**。此前当作两个独立问题，正是因为缺少**端到端的用户旅程实测**。

**修复**：
1. 模板内部依赖全部改**精确版本**（对齐 workspace 实际）：`router 0.2.0-beta.5` ·
   `runtime 0.2.0-beta.4` · `shared 0.2.0-beta.2` · `cli 0.3.0-beta.5` · `compiler 0.3.0-beta.3` ·
   `plugin-vite 0.2.0-beta.5` · `devtools-runtime 0.1.1-beta.1`。
2. **补门禁（缺口所在）**：`scripts/check-package-health.js` 此前只扫 `packages/*/package.json`，
   **从不扫模板**——模板是发布链上唯一无人看守的一环。新增 `checkTemplateAlignment()`：
   模板的 `@proteus-vue/*` 依赖必须**精确等于** workspace 版本，且**禁止 `^`/`~`**
   （范围在 prerelease 下会静默降级）。破坏性验证：改回 `^0.2.1-beta.0` → 红；`0.1.0` → 红；恢复 → 绿。
3. 新增 `scripts/verify-publish-smoke.mjs`（发布后冒烟，接入 `changeset:publish` 与 `publish-all.sh`），
   把**真实用户旅程**作为第一条断言：`npm create` → `npm install` → 依赖树**无重复副本** +
   装到的 cli == 本仓版本 → `proteus --help` → 导出面 → 版本一致。
   实测：修复前 **5/10 失败**（精确指认 7 个重复副本包），修复后全绿。

> **教训（第二层）**：门禁只覆盖「仓库内部一致性」不够——**用户旅程**（脚手架 → 安装 → 构建）
> 必须有一条机器化的端到端断言。这次掉在覆盖外的是「模板」，下次可能是别的环。
> 判据应是：*发布链上每个「用户可见的产物」都要有对应断言，而不只是「源文件之间一致」。*

### 复盘续二（2026-09-19 三次取证：警告类假阳性）

同一轮用户旅程还暴露一个**误导性警告**：默认脚手架工程首次 `proteus build` 会打印
`[gen-routes] 未找到语义组件库 @proteus-vue/components …… p-* 组件将不被注册（WXML 整块不渲染）`，
而**模板根本不使用 `p-*` 组件**（实测：模板仅在 `src/shims/mp.d.ts` 的注释里提到 `p-button`）。
**修复**：该警告改为条件触发——仅当工程内**确有 `.vue` 引用 `<p-*>` 或 `<P*>`** 时才提示
（未解析的具体标签另有更精确的逐标签警告）。三态实测：默认模板 **0 警告** · 用 `<p-view>` **告警** ·
用 `<PView>`（大写）**告警**。回归锁入 `tests/gen-routes.test.ts`。

### 复盘续三（2026-09-19 四次取证：dist-tag 漂移——「已发布」≠「tag 指向它」）

修完上面两处后，冒烟脚本仍在「用户实际装到哪个版本」上报错。深挖发现**第三个独立缺口**：
发布链的**幂等跳过路径只跳过 `publish`，不会更新 dist-tag**。于是 registry 上长期存在这种状态
（实测快照）：

```
@proteus-vue/devtools-runtime   latest=0.1.0        beta=0.1.1-beta.1
                                ^^^^^^^^ 正是「只有 8 个导出」的崩溃版本
@proteus-vue/cli                latest=0.3.0-beta.5 beta=0.2.1-beta.0
@proteus-vue/shared             latest=0.2.0-beta.2 beta=0.2.0-beta.0
```

两个方向都错：不带 tag 安装 `devtools-runtime` 的用户拿到**崩溃版**；而按本仓 pre-release 约定
用 `@beta` 的用户拿到**旧包**（`beta` 停在首次发布时的版本）。全量核对：**12 个包的 canonical tag
未指向本仓版本**（cli / compiler / plugin-vite / router / runtime / shared / pinia-sync +
5 个包连 `beta` tag 都不存在）。

**根因**：`published` 与 `dist-tags` 是 registry 上**相互独立**的两件事——「版本已存在于 registry」
不代表「任何 tag 指向它」。此前所有检查（drift / 冒烟 / publish-all）都只看版本是否存在。

**修复**：
1. 新增 `scripts/sync-dist-tags.mjs`（`publish:tags`）——canonical tag 判定：
   pre 模式（`.changeset/pre.json` 存在）取 `pre.json.tag`（本仓 `beta`），否则 `latest`；
   仅对**已发布**的版本要求 tag 指向它（本地领先未发布属正常，不报错）。`--check` 门禁 / `--fix` 修复。
2. 接入 `changeset:publish` 与 `publish-all.sh` 的发布后**报告**（★**不阻断发布**：
   修复 dist-tag 属**包管理动作**，权限高于发布本身，多数情况下无法在发布链内自动完成——
   硬失败会让「发布」这项本职工作直接不可运行。故只报告 + 打印可执行修复命令，由人决定何时处理）。
   同时 `publish-all.sh` 未显式指定 tag 时**自动采用 `.changeset/pre.json` 的 tag**——
   此前手动发布用默认 `latest`，导致 pre 模式的新版本挂到 latest 而 `beta` 停在旧版本
   （这正是 `cli` 的 `beta`=0.2.1-beta.0 的成因）。
3. 全量实测：`--check` 报 **12 个**不一致、退出码 1（门禁有效）。

> **修复命令**（需 npm 凭据，属发布动作）：`node scripts/sync-dist-tags.mjs --fix`
> ——把 12 个包的 `beta` tag 指向本仓版本。`latest` 的选择见下。
>
> ★**`latest` 待你决策**：pre-release 模式下 changesets **有意不动 `latest`**（保持指向上一稳定版），
> 这是设计而非缺陷。但 `devtools-runtime` 的 `latest=0.1.0` 恰是崩溃版——若你希望「不带 tag 安装
> 也不会踩崩溃版」，可显式把 `latest` 也指向 `0.1.1-beta.1`（`npm dist-tag add @proteus-vue/devtools-runtime@0.1.1-beta.1 latest`）；
> 若坚持 `latest` 保持稳定版语义，则维持现状（`cli` 等包已 exact-pin 新版本，功能不受影响）。
> 本脚本默认**只治理 canonical tag**，不擅自改 `latest`。

> **教训（第三层）**：*「已发布」≠「装得到」≠「tag 指向它」*——registry 上有三层独立状态
> （版本存在 / tag 指向 / 内容一致），发布链的核验必须**逐层覆盖**。


## 验收清单（✅ 全部通过）

- [x] `src/{platform,router,runtime,shims}` 全部移入 packages（`src/` 仅剩 components）
- [x] `@proteus-vue/*` 精确别名，业务代码零改动（import 路径不变）
- [x] 522 测试 + 双端构建 + e2e 全绿（每步）
- [x] create-proteus 生成的工程不再包含框架本体副本，双端构建通过（workspace 链接形态；真实 npm create 待发布后验证）
- [x] roadmap §5 架构演进对齐（packages/{api,capabilities,cli,compiler,create-proteus,module,pinia-sync,plugin-vite,router,runtime,shared}）

## 文档版本

v1.2（2026-08-31：22 包 beta 发布 + 发布记录更新 + create-proteus 收口 @proteus-vue scope）
