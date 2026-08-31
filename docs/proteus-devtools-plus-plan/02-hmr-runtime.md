# HMR 运行时细节

## 1. 增量更新流程

```
保存文件 → Compiler 增量 → IR chunk → WS → HMR Runtime
  → Vue Reconciler patch → Custom Renderer → 原生 View（不重建）
```

走 Vue `import.meta.hot`，组件替换保持状态。

## 2. 原生侧安全 reload

JSI binding 变更 → 保存路由栈（Router G-32 序列化）+ 页面状态 → reload → 恢复。

## 3. 性能预算

| 指标 | 预算 |
|------|------|
| HMR 编译 | < 50ms |
| 推送→渲染 | < 100ms |
| 安全 reload | < 2s |
| DevTools 开销 | < 5% CPU |
