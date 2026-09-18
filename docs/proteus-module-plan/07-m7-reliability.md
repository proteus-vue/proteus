# M7 可靠性加固

## M7.1 循环依赖检测（编译期硬卡）

DependencyGraph 在 CI 必跑，发现环直接 fail build。错误信息含环路径 + 修复建议（提取公共模块 / 改用事件）。

## M7.2 共享依赖去重

- **主包 `common/`** 放 vue、pinia、公共工具
- `proteus audit module --duplicates` 扫描：同一库出现在 ≥2 个分包 → 报错
- Web 端 Rollup `manualChunks` 自动提取（见 M4）

## M7.3 懒加载 + 骨架占位

```ts
// 模块懒加载（带骨架屏）
const trade = await ms.loadModule('trade', {
  fallback: () => <TradeSkeleton />,
})
```

- 编译期生成 `preloadRule`（Skyline）或 `modulepreload`（Web）
- 骨架屏自动生成（对齐 Component 层的 `p-skeleton`）

## M7.4 隔离沙箱

每个模块的服务实例在独立作用域，避免全局污染：

```ts
// 模块桶执行在沙箱
const sandbox = createSandbox({ moduleName, allowedAPIs })
sandbox.run(moduleFactory)
```

禁止模块桶直接访问 `getApp()` / `window` — 只能通过 `ms` 提供的 API。

## M7.5 内存泄漏守护

- 模块 `destroy` 时自动清理：定时器、事件监听、store 订阅
- DevTools 记录模块实例数，超阈值告警
- 长列表场景（trade 订单列表）验证 dispose 后内存回落

## M7.6 分包体积监控

| 指标 | 阈值 | 动作 |
|------|------|------|
| 单分包大小 | > 1.5MB | warn |
| 单分包大小 | > 2MB | error（微信限制） |
| 总分包大小 | > 16MB | error |
| 主包大小 | > 1.8MB | warn |

CI 跑 `proteus analyze size` 输出各分包体积报告。

## 测试

- 循环依赖 CI 拦截验证
- 重复依赖检测验证
- 懒加载 + 骨架渲染验证
- 内存泄漏检测（反复 init/destroy 100 次，内存稳定）
- 分包体积超限报错验证
