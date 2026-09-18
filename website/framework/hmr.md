---
title: HMR 双通道
order: 41
group: 运行期
---

# HMR 双通道

跨端热更新有两条通道，面向不同的产物形态：

| 通道 | 端 | 机制 |
|---|---|---|
| **Web HMR** | web | **Vite HMR 原生**——组件在 vite 模块图内，`@vitejs/plugin-vue` 热替换零成本（见 [Web 运行时](/docs/framework/runtime-web)） |
| **MP HMR** | 小程序 | **`@proteus-vue/hmr` 自定义 dev-server**——小程序页面**不在 vite 模块图**（transform 不触发，vite dev/build --watch 无效），需自定义文件监听 |

## MP HMR：`@proteus-vue/hmr` 体系

包分层（`@proteus-vue/hmr` 主入口 + `dev-server` 子路径）：

| 模块 | 导出 | 角色 |
|---|---|---|
| `@proteus-vue/hmr/dev-server` | `createHmrDevServer(options)` | **服务端**：文件监听 + WS 广播（examples `scripts/dev-mp.ts` 使用） |
| `@proteus-vue/hmr` | `createHmrClient` | **客户端**：接 WS、分发事件 |
| `@proteus-vue/hmr` | `createVueHotAdapter` | Vue 组件热替换适配（`accept` / 状态保留语义） |
| `@proteus-vue/hmr` | `createHmrRuntime` | 运行时统一：批量事件 → 安全应用 |
| `@proteus-vue/hmr` | `createSafeReload` | **安全重载**（保留运行态的重载策略） |
| `@proteus-vue/hmr` | `HmrPayload` | 载荷类型：`{ id, file, type, action, timestamp, code }` |

## dev-mp 双通道实战（examples/scripts/dev-mp.ts）

```
monitor pages/subpackages/src/config/框架组件
  → 防抖 → ① 产物重建（gen-routes + vite build → dist/mp-weixin，微信开发者工具自动刷新）
           ② HMR 广播（变更 .vue → compileVueSfc 增量编译 → WS 推送 HmrPayload）
```

```ts
import { createHmrDevServer } from '@proteus-vue/hmr/dev-server'

const hmr = createHmrDevServer({
  port: Number(process.env.PROTEUS_HMR_PORT ?? 5174),
  watchRoots: [...],     // 页面/分包/共享模块/配置/框架组件
  debounceMs: 300,
  compile: incrementalCompile,  // 变更 .vue → compileVueSfc → HmrPayload[]
  appInfo: () => ({ routes }),  // DevTools 面板路由表
})
```

- 监听启动：`[dev-mp] HMR dev server 就绪：ws://127.0.0.1:5174（PROTEUS_HMR_PORT 可改）`
- **产物重建与 HMR 广播双通道并行**：前者给微信开发者工具（模拟器刷新），后者给连接的 HMR Runtime / DevTools 面板
- 非 `.vue` 变更只走重建通道；`.vue` 增量编译失败 → warn 不阻断

## 连接面（HMR 客户端 → DevTools）

`HmrPayload` 经 WS 推给客户端（`createHmrClient`）→ `createHmrRuntime` 批量安全应用；`type: 'vue', action: 'update'` 走 Vue 热适配。DevTools 面板经同一通道消费更新事件（可视化 HMR 活动）。

## 诚实边界

- MP 产物重建是**整包重编**（vite build），HMR 广播只针对变更 `.vue` 的**逻辑层代码段**（`compileVueSfc` 的 js 产物）——WXML/WXSS 变更靠开发者工具刷新生效
- `@proteus-vue/hmr` 是 dev 通道基础设施，生产产物不含（devDeps）

## 下一步

- [小程序运行时](/docs/framework/runtime-mp)：setData 桥与产物形态
- [调试与可观测](/docs/framework/debugging)：DevTools 消费 HMR 事件
