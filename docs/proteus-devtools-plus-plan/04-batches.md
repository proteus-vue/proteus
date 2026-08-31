# 分批策略（G-19 / M1-M4）

| 批次 | 内容 | 依赖 | 可单测 |
|------|------|------|--------|
| **M1** | HMR Runtime + WebSocket + Vue HMR 适配 | Compiler B1, CLI M1 | ✅（Web 端，jsdom） |
| **M2** | DevTools 桥接（CDP + Style Safety 可视化） | CLI M2 | ✅ |
| **M3** | 原生侧安全 reload（iOS/Android/鸿蒙） | App Renderer M2/M3 | 🔶 |
| **M4** | 原生视图检查器 + LeakRegistry 集成 | Memory M4 | 🔶 |

## M1 Prompt 模板

```
实现 @proteus-vue/hmr 运行时（Web 端优先，纯逻辑可单测）：

【目标】
1. HMR Runtime：接收增量 IR chunk，调用 Vue import.meta.hot API 替换组件
2. WebSocket 客户端：连接 Dev Server，接收 HMR payload
3. 状态保留：组件替换保持 useState/ref 状态（Flutter Hot Reload 体验）
4. 原生侧 stub：定义安全 reload 接口（M3 实现）

【验收】
- 单元测试（jsdom）：模拟文件变更 → 验证 patch 正确、状态保留
- 性能：< 100ms 推送→渲染
- 遵循原则 #3（编译透明）：HMR 过程可观测
```

## 架构更新

- 新增执行位 **G-19**（P0）
- 原则 #3（编译透明）落地为 DevTools 可视化
- 全景图新增「工具链层：CLI / Compiler / DevTools」
