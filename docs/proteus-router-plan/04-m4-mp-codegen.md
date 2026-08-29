# M4 — 小程序端 codegen（pages.json + routeType）

> **里程碑**：M4（B4）
> **输入依赖**：`02-m2-route-tree.md`（RouteNode[]）
> **产出**：`packages/router/src/codegen/mp.ts`、生成 `dist/mp/app.json`（含 pages + routeType）
> **LLM 批次**：B4

---

## 1. 目标

把 `RouteNode[]` 编译为 **Skyline / glass-easel** 的 `app.json`：
- `pages` 数组（每个页面对一条）
- `pages[].routeType` / `openType`（转场映射）
- 每个页的 `.json`（`componentFramework`、`renderer`、`styleIsolation`）

## 2. Skyline 路由约束（关键坑）

- **小程序是 MPA**：每个页独立 `Page()`，`children` **不能原生嵌套** → 平铺为 `pages` 数组，嵌套信息降级为 `meta.__parent`（供运行时 tabBar / layout 使用）
- **`lazyCodeLoading: "requiredComponents"`**：配合按需注入
- **转场**：`routeType` 字段（`slide`、`slideUp`、`halfScreen`、`scaleDown` 等），在 `app.json` 的页配置里声明
- **`redirect`**：小程序无原生 redirect，需在 `App.onLaunch` / 页面 `onLoad` 里 `wx.redirectTo` 模拟（见 M6）

## 3. 映射规则

### 3.1 平铺 pages

```ts
// RouteNode[] → app.json.pages
function toPages(nodes: RouteNode[]): AppPageConfig[] {
  return flatten(nodes).map(node => ({
    path: node.path,                       // /home → pages/home/home
    routeType: node.meta.transition ?? 'slide',  // ← 转场映射点
    // Skyline 必填
    componentFramework: 'glass-easel',
    renderer: 'skyline',
    styleIsolation: 'isolated',
    lazyCodeLoading: 'requiredComponents',
  }))
}
```

`/home` → 产物路径 `pages/home/home`（约定：`pages/{name}/{name}`）。`name` 取自 `RouteNode.name` 或 path 最后一段。

### 3.2 routeType 映射表（核心，对齐 Web / App）

| `<route>.meta.transition` | `app.json` routeType | 说明 |
|---------------------------|----------------------|------|
| `slideUp` | `slideUp` | 底部上滑（半屏/全屏）|
| `slideDown` | `slideDown` | 下滑关闭 |
| `halfScreen` | `halfScreen` | 半屏弹层（wx://bottom-sheet）|
| `scaleDown` | `scaleDown` | 缩小露出下层 |
| `slide`（默认）| `slide` | 标准右滑 |
| `none` | 不声明 | 无动画 |

映射写在 `transforms/transform-transition.ts`，**三端共用同一份枚举**，保证一致性。

### 3.3 嵌套降级

```json
{
  "pages": [
    { "path": "pages/home/home", "routeType": "slideUp" },
    { "path": "pages/user/user", "routeType": "slide" },
    { "path": "pages/user/profile/profile", "routeType": "slide" }
  ],
  "tabBar": { "...": "..." }   // M6 由 router.tabBar 生成
}
```

`/user` 与 `/user/profile` 的父子关系：小程序不原生支持，故 **`children` 信息不进 app.json**，改由 `meta.__parent: "user"` 保留，运行时（tabBar / layout 组件）消费。

## 4. codegen 实现 `mp.ts`

```ts
export function generateMpConfig(nodes: RouteNode[], tabBar?: TabBarConfig): string {
  const pages = flatten(nodes).map(toPageConfig)
  return JSON.stringify({
    pages,
    tabBar: tabBar ?? undefined,
    componentFramework: 'glass-easel',
    renderer: 'skyline',
    lazyCodeLoading: 'requiredComponents',
  }, null, 2)
}

function toPageConfig(node: RouteNode): AppPageConfig {
  return {
    path: pathToMp(node.path, node.name),
    routeType: TRANSITION_MAP[node.meta.transition] ?? 'slide',
    componentFramework: 'glass-easel',
    renderer: 'skyline',
    styleIsolation: 'isolated',
  }
}
```

产物直接写 `dist/mp/app.json`，与现有编译器四件套输出合并（**不覆盖用户手写字段**，合并策略：`<route>` 优先）。

## 5. `lazy` 处理（小程序差异）

- `<route>` 的 `lazy` 在小程序端**固定解释为 `lazyCodeLoading` 粒度**：`lazy: true` → 页面按需加载（默认行为）
- Skyline 不支持 Web 那种 `() => import()` 代码分割，故 **小程序端忽略 `lazy` 的"异步组件"语义**，仅保留字段供配置
- 明确写在文档里，避免用户误以为小程序也能懒加载组件

## 6. 与现有编译器集成

- 现有四件套编译器已生成 `app.json` 骨架 → 本 codegen **只负责"路由相关字段"**，通过合并函数注入：
  ```ts
  mergeAppJson(existing, routerGenerated)
  ```
- 合并冲突规则：`<route>` 字段 > 用户手写 `app.json` 同名字段 > 默认值

## 7. 测试

- 快照：`app.json` 内容稳定
- routeType 映射：每个 transition 枚举值都有用例
- 嵌套降级：`/a`、`/a/b` → `pages` 平铺，`meta.__parent` 保留
- 合并：`existing.appJson` 有自定义字段不被覆盖

---

## LLM 执行提示（B4）

> 读 `00-overview.md` + `02-m2-route-tree.md` + 本文件。只实现 mp codegen + routeType 映射，**先 mock RouteNode[]**，跑通快照；合并逻辑用 fixtures 验证不破坏用户手写 app.json。
