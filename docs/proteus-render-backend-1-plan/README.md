# Proteus 可插拔渲染后端架构（G-27）

> **一句话**：不自研布局/渲染，构建渲染后端无关的上层模型，任意引擎（Vue/Flutter/原生/Skia/SSR）通过 `ProteusRenderBackend` SPI 插拔。

## 文档

- `01-render-backend-architecture.md` ★ 主文档
- `02-backend-spi.md` 接口规范
- `03-official-backends.md` 五个官方后端
- `04-integration-synergy.md` 跨体系协同
- `05-batches.md` 落地分批
- `architecture-update.md` 规约更新

打包：`bash pack.sh` → `proteus-render-backend.zip`
校验：`bash verify.sh`
