# 可观测性与工程治理（M8）

> 与 Pinia M8、Router M8、API M8 共用统一的 Proteus Observability Layer：traceId + trace 报告 + DevTools + CI 审计。

---

## 1. 渲染追踪

```ts
// 组件渲染埋点（dev 仅）
componentRender('p-list-view', {
  durationMs: 1.2,
  itemCount: 1000,
  strategy: 'recycle',
})
```

- 采样率可配（默认 dev 全量，prod 1%）
- 与 API 请求 trace、路由导航 trace 共享 `traceId`，一次用户操作可串联

---

## 2. 错误边界（对齐 `p-error-boundary`）

错误来源：
- Vue `errorCaptured` / `onErrorCaptured`
- Skyline 全局 `App.onError`
- `applyAnimatedStyle` / Worklet 异常

上报字段：
```ts
{
  traceId, component, lifecycle, error, propsDigest,
  capabilitySnapshot, route, // Router navTrace
}
```

敏感字段自动剔除（对齐 API M8 脱敏）。

---

## 3. DevTools（可选子包 `@proteus/devtools`）

面板能力：
- 组件树（Web = Vue DevTools 扩展；Skyline = 序列化快照）
- 渲染次数 / 耗时热力
- Pinia store 联动（选中组件 → 高亮其消费的 state）
- 状态快照导入/导出（与 Pinia M8.2 互通）
- 时间旅行：开发/灰度可用，生产禁用

---

## 4. CI 审计规则（`proteus audit component`）

| 规则 | 严重级 | 说明 |
|------|--------|------|
| `no-platform-api` | error | 组件内直接 `wx.*`/`document.*` |
| `no-business-logic` | error | 业务组件调用 `api.*`（只允许组合/emit） |
| `no-global-leak` | error | 全局组件持有页面引用 |
| `degradation-covered` | warning | 每个 ⚠️/❌ 必须有单测 |
| `matrix-complete` | error | 矩阵条目覆盖率 100% |
| `transform-synced` | error | `transform.ts` 与 `*.ir.md` 一致 |

实现：基于 ESLint + 自定义规则 + 矩阵覆盖率脚本。

---

## 5. 版本与迁移

- 组件 breaking change → RFC + codemod（见 `08`）
- 废弃 Prop：先 `warning` 一个 minor，再移除
- 矩阵文件 `01-component-matrix.md` 是版本兼容性的唯一依据

---

## 6. 验收
- 一次操作的全链路 trace 可在 DevTools 复现
- CI 审计规则全部覆盖且可本地运行
- 错误边界覆盖 100% 内置组件
- 组件版本迁移有 codemod + 回归测试
