# 类型提示全链路（Types）—— 规划与实现

> **状态**：📋 规划已落地，按分步骤执行中（roadmap v0.3「类型提示全链路」）
> **原则**：类型提示是**开发期资产**——`router.push` 跳转参数、页面 `onLoad` 参数、事件处理器参数全链路 TS 推导；
> 产物（小程序 JS）由编译器 `stripParamTypes` 剥离标注，类型永不污染产物。
> 类型来源：**页面声明（`<route>.params`）→ 编译器生成类型表 → API/页面消费**——写一处、处处推导。

## 目标形态（全链路闭环）

```vue
<!-- ① 页面声明参数（<route> 块 JSON，gen-routes 读取） -->
<route>
{
  "meta": { "title": "个人资料" },
  "params": { "id": "string", "kw": "string" }
}
</route>
<script setup lang="ts">
// ③ 页面 onLoad 参数类型（自动对应自己的路由 params）
onLoad(options: PageOnLoad<'user-profile'>) { ... }   // options.id: string 推导
// ④ 事件处理器类型
function onChange(e: InputEvent) { ... }               // e.detail.value: string
</script>
```

```ts
// ② 跳转处自动推导（name 受限 + params 类型匹配）
router.push({ name: 'user-profile', params: { id: 1 } })  // ✅ 推导
router.push({ name: 'user-profile', params: { id: 'x' } }) // ❌ 类型报错（id 应为 number）
```

## 类型生成链路

```
<route>.params（JSON 声明）
      │ gen-routes 读取（build 链前置）
      ▼
RouteParamsByName（按路由名索引的参数类型表，生成进 auto-routes.ts）
      │
      ├─► router.push 泛型（NavigateOptions<N>：name 受限 + params 匹配）
      ├─► PageOnLoad<N>（页面 onLoad 参数类型）
      └─► （步骤 6）proteus types CLI 查看
```

## 分步骤实现（每步独立提交，规模可控）

### 步骤 1：路由参数类型生成（gen-routes + `<route>.params`）

- [x] `<route>` 块解析 `params`：`{ "id": "string", "kw": "string" }`（JSON：字段名 → 类型名）
- [x] `writeAutoRoutes` 生成 `RouteParamsByName`（未声明 params 的路由为 `{}`）
- [x] 产物：`auto-routes.ts` 追加 `export interface RouteParamsByName { 'user-profile': { id?: string; from?: string; kw?: string }; ... }`
- [x] 验证：构建后类型声明存在 + `vue-tsc` 通过 + `import type { RouteParamsByName }` 可用
- 改动：`scripts/gen-routes.ts`（parseRouteBlock / writeAutoRoutes）、`src/router/types.ts`、示例 `user/profile.vue`
- 决策：#93；踩坑：文件注释里 `<route>` 字样被正则先匹配（改措辞）

### 步骤 2：`router.push` 泛型推导（API 层）

- [x] `NavigateOptions` 泛型化：`NavigateOptions<N extends keyof RouteParamsByName = keyof RouteParamsByName>`（N 受限路由名）
- [x] `push<N>(options: NavigateOptions<N>)`（name 字面量推断 → params 匹配；path 跳转 N 回退全部路由名）
- [x] 类型断言测试 `tests/types/router-params.types.ts`（正例 + 3 负例：id 类型不匹配 / 多余字段 EPC / 非路由名）
- [x] 验证：vue-tsc 全绿（含类型测试负例）+ 既有 router 15 用例不破（运行时负例 `name: 'not-exist'` 加类型断言保留）
- 改动：`src/router/types.ts`（NavigateOptions 重构 BaseNavigateOptions + 泛型）、`src/router/index.ts`（push/replace + RouteParamsByName import）、`tests/types/router-params.types.ts`
- 决策：#94；设计要点：N 默认 `keyof RouteParamsByName`（path-only 兼容）；非条件类型保证多余属性检查（EPC）生效

### 步骤 3：页面 `onLoad` 参数类型（PageOnLoad）

- [x] `src/router/types.ts` 加 `PageOnLoad<N extends keyof RouteParamsByName>`（N = 本页路由名，自动匹配参数）
- [x] runtime 加 `onLoad` 导出（Web 端 no-op 兼容，`src/runtime/index.ts` 聚合入口新增）——源码 onLoad 在 Web 端不报错
- [x] 示例页标注：user/profile.vue `onLoad((options: PageOnLoad<'user-profile'>) => ...)`（options.id 推导）
- [x] 验证：vue-tsc（含 PageOnLoad 正/负例）+ 产物 onLoad 提取 + 无类型残留（stripParamTypes 剥离）
- 改动：`src/router/types.ts`、`src/runtime/pageLifecycle.ts`（onLoad no-op + index.ts）、示例页、类型测试
- 决策：#95；踩坑：① runtime onLoad 参数签名（hook 注册 vs 参数接收，用 (options?: any) 宽松）② demo 的 `??` 残留产物（真机不支持，改显式 null 检查）

### 步骤 4：事件处理器类型（shims）

- [x] `src/shims/events.d.ts`（全局声明，无 export）：`MpEvent<TDetail>`（detail / target / currentTarget.dataset）、`MpInputEvent`（v-model handler，detail.value: string）、`TapEvent`
- [x] 示例页标注：components-demo.vue `onChange(e: MpEvent<{ value?: number }>)`（e.detail.value 推导）
- [x] 验证：vue-tsc（正例 + 单行负例）+ 产物标注剥离零残留（grep 验证）
- 改动：`src/shims/events.d.ts`、示例页、类型测试
- 决策：#96；踩坑：① d.ts 用 export 变模块（非全局）——去掉 export ② `InputEvent` 撞 DOM 内置（声明合并灾难）——改名 `MpInputEvent` ③ `@ts-expect-error` 只覆盖紧邻行（多行函数 body 错误漏）——单行负例

### 步骤 5：端到端验证 + 文档（全链路收官）

- [ ] 示例页全量标注（跳转 / onLoad / 事件三处都用上推导类型）
- [ ] 本文档从「规划」升级为「正式文档」（补全 API 参考 + 使用示例）
- [ ] roadmap「类型提示全链路」行 ✅、PROJECT_MEMORY 归档决策
- [ ] 验证：vue-tsc 全绿 + npm test + 双端构建
- 验收：全链路闭环 + 文档化

### 步骤 6（可选）：生成器单测 + `proteus types` CLI

- [ ] `tests/gen-routes.types.test.ts`：参数类型生成的快照断言
- [ ] `packages/cli` 加 `proteus types`（列出各路由参数类型表）
- 验收：类型生成有自动化回归

## 风险与对策

| 风险 | 对策 |
|---|---|
| 泛型化破坏现有调用（步骤 2） | `name` 可选 + 泛型默认回退；验收含既有 15 个 router 用例 |
| 类型标注污染产物 | `stripParamTypes` 已剥离参数标注；步骤 3 验证"标注后产物无类型残留" |
| `<route>.params` 声明漂移（改了没重跑 gen-routes） | build 链已含 gen-routes；步骤 6 生成测试兜底 |

## 文档版本

v1.0（规划落地，对应 roadmap v0.3 类型提示全链路）
