# M8 可观测性 + CI 审计

## M8.1 依赖图谱可视化

`proteus audit module --graph` 输出 Mermaid（见 M3）。CI 产物页展示，PR 改动影响范围一目了然。

## M8.2 模块加载 Trace

对齐 Pinia/Router/API 的 `traceId` 体系：

```ts
ms.loadModule('trade')
// trace span:
// {
//   traceId: 'abc',
//   module: 'trade',
//   phase: 'load',
//   duration: 23,
//   deps: ['user', 'payment'],
//   chunkSize: 145000
// }
```

DevTools 按 traceId 串联：模块加载 → store 初始化 → 首屏渲染。

## M8.3 DevTools 模块面板

- 模块列表（状态 / 版本 / 依赖）
- 加载时间瀑布图
- 内存占用（对齐 M7.5）
- 事件流（模块间 ModuleEvent）

## M8.4 降级与回放

模块加载失败 → 自动 fallback 到骨架 / 错误边界（对齐 Component 的 `p-error-boundary`）：
```ts
ms.loadModule('trade', {
  fallback: ErrorBoundary,
  retry: 2,
})
```

失败信息进 trace，可远程复现。

## M8.5 错误边界

模块初始化抛错 → 不影响其他模块 → 上报 + 显示降级 UI。

## M8.6 CI 审计门禁

`proteus audit module` 检查项（**全部硬卡，不警告**）：

- [ ] 无循环依赖
- [ ] 无重复依赖
- [ ] 分包体积不超限
- [ ] 业务目录无 `wx.*` / `window.*` / `require` 裸调用
- [ ] 所有跨模块 import 来自 `@proteus/module` 或公共契约
- [ ] `chunk` 与 Router M7.1 一致

ESLint 插件 `eslint-plugin-proteus`：

```json
{
  "rules": {
    "proteus/no-cross-module-import": "error",
    "proteus/no-platform-api-in-business": "error"
  }
}
```

CI 脚本：

```bash
proteus audit module --ci && eslint .
```

任一失败 → PR 阻断。

## 测试

- audit 全项单测（每个检查项正常 + 违规各一组）
- ESLint 规则单测（违规代码报错、合规代码通过）
- CI 阻断验证（mock 违规 PR，断言 CI fail）
- trace 上报验证
- DevTools 面板 e2e
