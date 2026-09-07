# Proteus 应用级能力解决方案

> 全局主题切换 · 动态字体缩放 · 缓存分层管理  
> 配套：`proteus-app-renderer-plan` / `proteus-css-compat` / `proteus-memory-plan` / `proteus-design-principle`

## 核心判断

**主题 / 字体 / 缓存 —— 三个"单端都有现成 API，但跨五端 + 响应式 + 高性能 + 不卡 + 不漏内存组合起来，没有任何框架做过统一收敛"的能力。**

Proteus 的解法：**定义统一语义，映射到各端最强原生实现**（继承 Architecture 原则 #10）。

## 文档清单

| 文件 | 内容 |
|------|------|
| `01-app-capabilities.md` | **主文档**：问题定义 / 三能力语义模型 / 五端映射 / 协同 / 对标 / 分批 |
| `02-theme-five-end.md` | 主题：token 规范 + 五端实现（Web/Skyline/iOS/Android/鸿蒙） |
| `03-font-scale-five-end.md` | 字体：Dynamic Type / sp / fontScale / Large Content Viewer |
| `04-cache-layers.md` | 缓存：L0/L1/L2/L3 四层 + 字节预算 + 淘汰 + MMKV/Codable |
| `05-api-design.md` | 业务零样板 API + TypeScript 类型 |
| `06-compiler-integration.md` | 编译期优化（静态 token / CSS 变量 / AOT 预取） |
| `07-benchmark-comparison.md` | 对标 uni-app x / RN / Flutter |
| `08-migration-anti.md` | 迁移指南 + 反例清单 + FAQ |
| `09-strict-rules.md` | `--strict-app-capabilities` lint 规则 |
| `10-benchmark-budgets.md` | 性能预算 + 真机五端验收矩阵 |
| `11-batches.md` | G-27/G-28 分批 + Prompt 模板 |

## 关键差异化（Proteus 独有）

| 能力 | 竞品痛点 | Proteus 方案 |
|------|---------|-------------|
| 主题 | uni-app 多文件多概念 + 静默失败 + 闪屏 | **单文件 + 编译期优化 + 静态分析 + 无闪屏** |
| 字体 | RN 靠 useMemo 手动，全局关闭是反模式 | **CSS 变量 GPU 联动 + 禁止全局关闭** |
| 缓存 | 全部单层 + 无预算 + OOM 风险 | **四层 + 字节预算 + 对接 Memory Plan** |
| 组合 | 竞品各自为政 | **六能力声明式组合（主题/字体/缓存/纪念日/骨架/Glass/安全区）** |

## 执行位

- **G-27 Theme (P1)** · **G-27 FontScale (P1)** · **G-28 Cache (P1)**
- M1 三项全部**零依赖**，可同期启动

详见 `01-app-capabilities.md` §7、§11。

## 校验

```bash
sha256sum -c CHECKSUM.md
```
