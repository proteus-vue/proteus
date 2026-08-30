# @proteus-vue/router

## 0.2.0-beta.0

### Minor Changes

- 7cf0406: 拆包步骤 4：router 工厂化 + 路由规划 M1/M2 落地

  - `createRouter(routes)` 工厂（删全局单例），guards 同工厂化（routeMap 由 push 注入）
  - `RouteParamsByName` 改空基接口 + 应用侧 auto-routes `declare module` 模块扩充注入（vue-router 同款模式，push 泛型/PageOnLoad 零回归）
  - 新增 M1 `schema.ts`（RouteValidationError 含 loc + 手写校验）/ `scan.ts`（@vue/compiler-sfc 解析 + 行号定位）
  - 新增 M2 `tree.ts`（嵌套树：path 前缀推导 + parent 显式优先 + 环检测 + 稳定排序）/ `merge.ts`（meta 深合并限深 3）
  - auto-routes 随应用存放（gen-routes `routesOutput` 指向应用侧），RouterView 改相对导入

- a501441: 拆包步骤 7：create-proteus 模板重构（npm 包形态）

  - 模板不再复制框架本体（src/platform|runtime|router 框架代码 + 插件），改依赖 `@proteus-vue/{router,runtime,shared,plugin-vite,compiler}` npm 包
  - `@proteus-vue/router` exports 补类型子路径（`./types`/`./schema`/`./scan`/`./tree`/`./merge`）+ `./package.json`；预设源码随包发布（`src/presets`，插件内联需要）
  - `@proteus-vue/plugin-vite` 插件支持 `node_modules/` 包内预设路径解析（resolvePkgPath，含 scoped 包）
  - snapshot-template 改为只快照应用壳；模板应用侧自带 shims 全局类型

- ae60825: 底线整改：AI-native 透明框架分派层 + 漂移门禁 + 路由透明化

  - `@proteus-vue/compiler`：规则注册表升级为**分派层**（阶段三落地）——`executeRule(id, ctx)` + 规则 `apply()`（style/px-to-rpx、template/scope-attr 已登记示范）；AI 覆盖规则实现 → 编译输出即时变化（底线循环 ① 完全形态）
  - 实现 ↔ 注册表**反向漂移门禁**（tests/registry-drift）：实现引用的规则 ID 必须全部已登记，新转换决策漏登记当场报错
  - `@proteus-vue/router`：路由生成规则注册表（route/scan、path-derive、parent-explicit 等 7 条 AI 说明书）+ `--trace-router` 闭环（buildRouteTree/runGenRoutes 输出嵌套推导决策链）

### Patch Changes

- 00c9fb7: 拆包步骤 6：别名与引用面全量切换

  - vite alias / tsconfig paths 全量精确映射 `@proteus-vue/{router,runtime,shared,compiler,plugin-vite,components}`，删除泛化 `@proteus-vue` → `src/`（防误匹配）
  - 新增 `@proteus-vue/components` 精确别名（框架内置组件暂留 `src/components`，组件库 v2.0 方向）
  - create-proteus 模板 alias 同步精确化（vendored 结构）

- Updated dependencies [1bda359]
- Updated dependencies [00c9fb7]
  - @proteus-vue/shared@0.2.0-beta.0
