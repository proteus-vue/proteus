# 分批策略（G-34 / M1-M4）

> **★实现状态（2026-08-31）**：**M1 已落地**——`@proteus-vue/hmr`（HMR payload 协议 + Runtime 分派/状态保留/HMR001-003 规则 + Vue import.meta.hot 适配 + WS 客户端重连 + 安全 reload stub + 批量合并优化 <100ms 基准 + dev-server 子路径 WS/watch/增量编译回调注入 + dev-mp 接入 E2E 闭环，27 用例）；**M2 已落地**——`@proteus-vue/hmr/cdp` 子路径（createCdpBridge：CDP 命令子集 Runtime.*/Proteus.* 自定义域 + TraceBus/HMR 事件 → CDP 消息转译 + StyleGateRecord 缓冲）+ `@proteus-vue/hmr/style-gate` 子路径（collectStyleGateRecords：白名单→校验→平台收窄闸门链 + 五端原生值映射可视化数据源，联动 runtime/style-safety）+ 14 用例全绿 + check:pkg 23 包 0 error；M3/M4 待 G-22（原生侧）。

| 批次 | 内容 | 依赖 | 可单测 | 状态 |
|------|------|------|--------|------|
| **M1** | HMR Runtime + WebSocket + Vue HMR 适配 | Compiler B1, CLI M1 | ✅（Web 端，jsdom） | ✅ **已落地**（@proteus-vue/hmr，2026-08-31） |
| **M2** | DevTools 桥接（CDP + Style Safety 可视化） | CLI M2 | ✅ | ✅ **已落地**（@proteus-vue/hmr/cdp + /style-gate，2026-08-31） |
| **M3** | 原生侧安全 reload（iOS/Android/鸿蒙） | App Renderer M2/M3 | 🔶 | 🔶 待 G-22 |
| **M4** | 原生视图检查器 + LeakRegistry 集成 | Memory M4 | 🔶 | 🔶 待 G-22 |

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

- 新增执行位 **G-34**（P0）
- 原则 #3（编译透明）落地为 DevTools 可视化
- 全景图新增「工具链层：CLI / Compiler / DevTools」
