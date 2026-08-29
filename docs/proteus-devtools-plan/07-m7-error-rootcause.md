# M7 — 异常根因分析

## 目标

一次失败 → 自动串联"哪个请求失败 → 哪个 action 调用 → 哪个守卫拦截 → 哪个页面渲染"，定位根因。

## 错误链构建

每个 `phase: 'error'` 事件携带 `traceId` + `spanId`，按 `parentSpanId` 回溯完整调用链：

```
api.error (status 401)
  ↑ causedBy
store.action (login.refresh)
  ↑ causedBy
router.guard (beforeEach → requiresAuth)
  ↑ causedBy
lifecycle.coreReady (init auth)
```

## UI：根因面板

- **链路图**：纵向树，根因节点高亮（颜色深浅 = 深度）
- **每节点**：名称 + payload + 源码定位 + 发生时间
- **影响范围**：列出受影响的 store / 页面 / 组件（通过 span 依赖推导）
- **复现脚本**：一键生成最小复现序列（导航步骤 + 操作），可导出分享

## 归因规则

1. 优先标记 `phase: 'error'` 的叶子节点为根因候选
2. 同一 `traceId` 内多个 error → 按 `timestamp` 取最早为根因
3. 已知模式库（可扩展插件）：
   - `401` → "token 失效，检查 auth 守卫"
   - `ChunkLoadError` → "分包加载失败，检查网络/分包配置"
   - `capability.unsupported` → "当前平台不支持，缺 fallback"

## 与 API / Pinia 联动

- API 拦截器在 error 时调用 `bus.emit({ source:'api', phase:'error', traceId })`
- Pinia action 用 `wrapAction` 自动捕获 throw，关联当前 span

## 验收

- 构造"401 → 守卫取消导航"场景，根因面板准确指向 `coreReady` 的 token 刷新失败
- 复现脚本可在新会话重放并复现同一错误
- 无 error 时面板为空，不误报
