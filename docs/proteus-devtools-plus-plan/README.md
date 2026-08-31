# Proteus HMR & DevTools

> 第 35 份 plan · 执行位 **G-34** · P0

## 定位

JSI 架构下的毫秒级 HMR + 透明调试 —— 让"编译透明"原则落到开发体验。

## 文档清单

| 文件 | 内容 |
|------|------|
| `01-hmr-devtools.md` | ★ 主文档：三层 HMR/DevTools 协议/可视化/对标 |
| `02-hmr-runtime.md` | HMR 运行时细节 + 安全 reload |
| `03-devtools-protocol.md` | CDP 桥接 + Style Safety 可视化 |
| `04-batches.md` | M1-M4 分批 + Prompt 模板 + 架构更新 |

## 差异化

- Style Safety 可视化（G-31 闸门可见）
- 原生视图检查器（组件 ↔ 原生 View 映射）
- JSI HostObject 引用查看（LeakRegistry）

## 关联

Compiler、CLI(G-33)、Style Safety(G-31)、Memory(G-06)、Router(G-32)
