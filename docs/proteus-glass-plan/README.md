# Proteus Glass — 液态玻璃跨端能力

> 归属：基建层 / 横切能力（与 Security、i18n 同级）
> 执行位：G-29（依赖 Component G-06 + App Renderer G-22 + Compiler IR）
> 状态：v1.0 落地执行文档

## 一句话定位

**用统一声明式 API，在各端映射到该端所能达到的最强玻璃实现。**

Web / 小程序 Skyline 无法调用系统级玻璃 API，只能靠 `backdrop-filter` + Shader 模拟；
iOS / 鸿蒙 / Android 原生端可解锁系统级特效。因此**不存在"一套代码三端像素级相同"**，
框架承诺的是：**L1 基础玻璃三端必达、API 统一、质感随平台尽力提升。**

## 文档清单

| # | 文件 | 核心内容 |
|---|------|---------|
| 01 | research-report | 三平台能力调研结论 + 可行性判定 |
| 02 | architecture | L1/L2/L3 分层 + `<pg-glass>` API 设计 |
| 03 | capability-matrix | iOS/鸿蒙/Android/Web/Skyline 能力矩阵 |
| 04 | mapping-ios | iOS UIGlassEffect 映射 + 版本守门 |
| 05 | mapping-harmony | 鸿蒙 ArkUI blur/fractal 映射（重点深耕） |
| 06 | mapping-android | Android RenderEffect 映射 + ROM 边界 |
| 07 | mapping-web-skyline | backdrop-filter + Shader 模拟 |
| 08 | degradation | 降级策略（设备/版本/性能三级） |
| 09 | presets | 预设清单（navigationBar/modal/card/...） |
| 10 | compiler-integration | Compiler IR + `--trace-glass` |
| 11 | audit-performance | `proteus audit glass` + 性能预算 |
| 12 | batches | M1-M6 分批 + Prompt 模板 |
| 13 | migration-boundary | 明确不做项 + 迁移路径 |

## 铁律

1. **L1 必达**：blur + tint + radius + border 在所有目标端一致可用
2. **单入口**：业务只写 `<pg-glass>`，禁止平台分支散落页面
3. **降级不崩溃**：任何端能力不足时降级为实色，禁止白屏/黑块
4. **无障碍优先**：`prefers-reduced-transparency` 自动关闭玻璃
5. **系统级仅在原生端**：L3 只对 iOS/鸿蒙/Android 开放，Web/Skyline 停在 L1-L2

详见 `02-architecture.md`。
