# Proteus G-28 — 原生能力可插拔架构

> 目标：**99% 的业务场景不需要开发者手写原生插件。**

把 G-27 的 SPI 方法论从「渲染」泛化到「一切原生能力」：开发者只调语义接口（`useNative().scanQR()`），各端 Backend 提供原生实现，Compiler 自动生成权限清单。

## 文档清单

| 文件 | 内容 |
|------|------|
| `01-native-backend-architecture.md` | ★ 主文档：四层能力模型 / 99% 可达性 / 对照 |
| `02-native-backend-spi.md` | `ProteusNativeBackend` SPI / Capabilities / 版本协商 |
| `03-capability-catalog.md` | Top 30 能力清单 + 五端映射 |
| `04-compiler-automation.md` | `app.config` → 权限清单 + Backend 注册 + Tree-shaking |
| `05-backend-package-spec.md` | Backend 包目录 / 注册契约 / 签名审计 |
| `06-ecosystem-governance.md` | 官方 vs 社区 / 质量门禁 / 贡献流程 |
| `07-integration-batches.md` | 跨 plan 协同 / B1-B6 / 单测 / 体积预算 |
| `architecture-update.md` | 规约合并：G-28 + 原则#10 泛化 + 铁律 + NAT 规则 |

## 一句话

> 渲染有 `ProteusRenderBackend`，原生能力就有 `ProteusNativeBackend` —— 同一个原则 #10，业务零原生代码。

## 打包

```bash
bash pack.sh
```

详见各文档。
