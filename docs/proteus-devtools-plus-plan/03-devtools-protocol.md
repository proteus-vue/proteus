# DevTools 协议与 Style Safety 可视化

## 1. 协议栈

```
Chrome DevTools ←CDP→ Debug Bridge(Node) ←WS→ App Runtime → JSI → Native
```

## 2. Vue DevTools 适配 Custom Renderer

组件树 = 原生 View 树的可视化（差异化）。

## 3. Style Safety 可视化（差异化亮点）

DevTools 面板显示：
- 每条样式经哪个闸门放行（语义/编译/运行时/原生）
- 被拒绝/降级的样式（联动 G-16）
- 各端原生值映射

> "编译透明"原则的直接体验。

## 4. 原生视图检查器

- 选中组件 → 高亮原生 View
- 查看 JSI HostObject 引用（联动 Memory G-06 LeakRegistry）

## 5. 严格规则

| 编号 | 规则 | 处理 |
|------|------|------|
| HMR001 | HMR 期间副作用未清理 | warn |
| HMR002 | 原生 binding 变更必须安全 reload | 自动 |
| HMR003 | 状态丢失检测 | warn |
