# transforms 契约规范（路由相关）

> **配套**：`proteus-pinia-plan/` 的 transforms 规范（沿用同一套 AI 可读契约）
> **本文件**：聚焦路由相关 transforms，是 `00-overview` 第 5 节 `transforms/` 目录的详细契约

---

## 1. 定位

`packages/router/transforms/` 里的每个文件 = **一条"源码 → 路由表/产物"的确定性规则**，AI 可读、可改、可新增。

对齐框架原则：**编译层零黑盒，每条规则独立可关，产物可追溯到源码。**

## 2. 文件结构模板

```ts
/**
 * transform-route-block.ts
 *
 * 【职责】从 .vue 的 <route> 自定义块提取路由信息
 *
 * 【输入】SFC descriptor.customBlocks（来自 @vue/compiler-sfc）
 * 【输出】RouteBlock（见 types.ts）
 *
 * 【映射示例】
 *   <route>{ "path": "/home", "meta": { "transition": "slideUp" } }</route>
 *     → RouteBlock { path: "/home", meta: { transition: "slideUp" }, loc: {...} }
 *
 * 【Skyline 注意】
 *   - mp 端 children 会被平铺为 pages（见 transform-nested-children.ts）
 *   - transition 映射见 transform-transition.ts
 *
 * 【可关】proteus.config.ts → router.transforms['route-block'] = false
 */
export function transformRouteBlock(
  customBlocks: SFCBlock[],
  context: TransformContext
): RouteBlock[] {
  // ... 实现（见 01-m1-route-parser.md）
}
```

**AI 契约（JSDoc 必填字段）**：
- `@职责`：一句话
- `@输入`：类型 + 来源
- `@输出`：类型
- `@映射示例`：输入 → 输出（具体代码）
- `@Skyline 注意` / `@Web 注意` / `@App 注意`：平台差异（如有）
- `@可关`：配置开关路径

## 3. 现有 transform 清单（对齐 M1-M6）

| 文件 | 职责 | 里程碑 | 可关开关 |
|------|------|--------|----------|
| `transform-route-block.ts` | 提取 `<route>` 块 → RouteBlock | M1 | `router.transforms['route-block']` |
| `transform-nested-children.ts` | path 推导 / `parent` → children 树 | M2 | `router.transforms['nested']` |
| `transform-meta-merge.ts` | 全局 + 页面 meta 合并 | M2 | `router.transforms['meta-merge']` |
| `transform-transition.ts` | transition → 三端转场映射（**共享枚举**）| M3-M5 | `router.transforms['transition']` |
| `transform-lazy.ts` | lazy → 三端代码分割语义 | M3-M5 | `router.transforms['lazy']` |
| `transform-redirect.ts` | redirect → 三端实现 | M6 | `router.transforms['redirect']` |
| `transform-tabbar.ts` | tabBar 配置 → 三端产物 | M6 | `router.transforms['tabbar']` |

## 4. `--trace-transform` 集成

每条 transform 在执行时（开启 `--trace-router`）输出：
```
[route-block] src/pages/home/Home.vue:2 → RouteBlock(path="/home")
[nested]     /home + /home/profile → parent/child
[transition] meta.transition="slideUp" → web:slide-up | mp:slideUp | app:presentModal
[meta-merge] title ← Home.vue:2 (page); transition ← defaults (global)
```

`--trace-transform` 输出可直接用 `--output json` 存为 CI artifact，供 AI 排查"我的 `<route>` 被编译成了什么"。

## 5. 规则可关性（核心差异化）

`proteus.config.ts`：
```ts
export default defineConfig({
  router: {
    transforms: {
      'route-block': true,     // 默认开
      'nested': true,
      'transition': true,
      'meta-merge': false,     // 用户可关（极端定制场景）
    }
  }
})
```

**语义**：关掉 `meta-merge` → codegen 不再合并全局默认，用户完全自控。
**约束**：核心规则（`route-block`、`nested`）建议不可关，避免产物结构破碎；只有"有默认行为的加工类"规则可关。

## 6. AI 新增 transform 的流程（"自我成长"落地）

1. 用户在 Cursor/CLI 描述需求："把 `<sticky-header>` 映射为 Skyline `position:sticky`"
2. AI 读 `transforms/` 目录，理解 JSDoc 契约（第 2 节模板）
3. AI 新建 `transform-sticky-header.ts`，按模板写 + 加单测
4. 在 `transforms/index.ts` 注册
5. 跑 `--trace-transform` 验证产物
6. PR 合并

**这就是"框架自我成长"在路由层的体现**：AI 能安全地给路由编译加能力，不破坏现有规则。

## 7. 与 Pinia transforms 的关系

- 同目录体系：`proteus/transforms/` 是根，`packages/router/transforms/` 是子命名空间
- 共享工具：`transforms/_utils/trace.ts`（trace 输出）、`transforms/_utils/schema.ts`（校验）
- `--trace-transform` 统一开关同时覆盖 router + pinia + 其他模块

---

## LLM 执行提示

> 本文件是**规范**，不是实现任务。B1-B7 执行时按此契约写代码即可。新增 transform 时**先复制第 2 节模板**，再填实现。
