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

- [ ] `<route>` 块解析 `params`：`{ "id": "string", "kw": "string" }`（JSON：字段名 → 类型名）
- [ ] `writeAutoRoutes` 生成 `RouteParamsByName`（未声明 params 的路由为 `{}`）
- [ ] 产物：`auto-routes.ts` 追加 `export interface RouteParamsByName { 'user-profile': { id: string; kw: string }; ... }`
- [ ] 验证：构建后类型声明存在 + `vue-tsc` 通过 + `import type { RouteParamsByName }` 可用
- 改动：`scripts/gen-routes.ts`（parseRouteBlock / writeAutoRoutes）、`src/router/types.ts`
- 验收：`auto-routes.ts` 含参数类型表，`npm run build:mp` + `vue-tsc` 全绿

### 步骤 2：`router.push` 泛型推导（API 层）

- [ ] `NavigateOptions` 泛型化：`push<N extends keyof RouteParamsByName>(options: NavigateOptions<N>)`
- [ ] `NavigateOptions<N> = Omit<Base, 'name'|'params'> & { name?: N; params?: RouteParamsByName[N] }`（path 跳转 name 缺省、params 放宽，**兼容现有调用**）
- [ ] 新增类型断言测试 `tests/types/router-params.types.ts`（正例 + `// @ts-expect-error` 负例）
- [ ] 验证：类型测试 + 既有 `tests/router.test.ts`（15 用例）不破
- 改动：`src/router/types.ts`、`src/router/index.ts`（push/replace）
- 验收：vue-tsc 全绿 + router 运行时测试全过

### 步骤 3：页面 `onLoad` 参数类型（PageOnLoad）

- [ ] `src/router/types.ts` 加 `export type PageOnLoad<N extends keyof RouteParamsByName> = RouteParamsByName[N]`
- [ ] 示例页标注（forms / components-demo 选一页 `onLoad(options: PageOnLoad<'...'>)`）
- [ ] 验证：标注页 vue-tsc + 负例（多余字段报错）；产物无类型残留（stripParamTypes 剥离）
- 改动：types.ts + 示例页 + 测试
- 验收：类型推导生效 + 产物行为不变

### 步骤 4：事件处理器类型（shims）

- [ ] `src/shims/events.d.ts`：`MpEvent<TDetail>`（detail / currentTarget.dataset）、`InputEvent = MpEvent<{ value: string }>`（v-model handler）、`TapEvent`
- [ ] 示例页事件处理器标注 `e: InputEvent` / `e: MpEvent<...>`
- [ ] 验证：vue-tsc + 误用负例
- 改动：shims + 示例页
- 验收：事件参数有类型提示

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
