# 10 · 分批执行策略

## 执行原则（防撑爆）

> **一次 LLM 调用 = overview + 当前 Batch 文件 + 直接依赖**
> **绝不一次喂入整套文档**

---

## Batch 划分

### B1 · Capability 契约（M1）
**文件**：`01-m1-capability-contract.md`
**产出**：
- `Capability` / `CapabilityAPI` 类型
- `defineCapability`
- `useCapability`
- capability 描述文件规范

**依赖**：无
**Prompt 策略**：一次只实现一个能力（clipboard）

---

### B2 · Adapter Registry（M2）
**文件**：`02-m2-adapter-registry.md`
**产出**：
- `CapabilityRegistry`
- adapter 注册/选择逻辑
- 优先级与 fallback

**依赖**：B1
**Prompt 策略**：先手写 registry，再补自动扫描

---

### B3 · 编译期分叉（M3）
**文件**：`03-m3-build-time-dispatch.md`
**产出**：
- `capability-manifest.json` 生成
- Vite/Rollup 分平台构建
- Tree-shaking 规则

**依赖**：B1, B2
**Prompt 策略**：先 Web + Skyline 两平台，App 后补

---

### B4 · 运行时降级（M4）
**文件**：`04-m4-runtime-fallback.md`
**产出**：
- `UnsupportedAPI`
- fallback 链
- 错误模型

**依赖**： B2
**Prompt 策略**：覆盖全部降级路径单测

---

### B5 · 平台模块规范（M5）
**文件**：`05-m5-platform-modules.md`
**产出**：
- 目录结构
- clipboard / share adapter 三端实现
- 平台入口 `entry.ts`

**依赖**： B1-B4
**Prompt 策略**：一个能力跑通三端

---

### B6 · 可靠性（M7）
**文件**：`06-m7-reliability.md`
**依赖**： API 层（Request）、Pinia（权限缓存）

---

### B7 · 可观测（M8）
**文件**：`07-m8-observability.md`
**依赖**： TraceId、DevTools 基础设施

---

### B8 · 回归测试（M8 测试）
**文件**：`08-testing-regression.md`
**依赖**： B1-B5
**Prompt 策略**：先 3 个能力 × 3 平台矩阵

---

### B9 · 迁移 + CI
**文件**：`09-migration-ci.md`
**依赖**： 全部稳定

---

## Prompt 模板（示例）

```
你正在实现 Proteus 的 Capability 契约（M1）。
只阅读以下文件：
- 00-overview.md（快速回顾）
- 01-m1-capability-contract.md

要求：
1. 实现 defineCapability / useCapability
2. 以 clipboard 为示例
3. 写单测覆盖 isSupported / fallback
4. 不写任何平台判断逻辑
5. 产物需可被 --trace-capability 输出
```

---

## 进度追踪

| Batch | 状态 | 平台覆盖 |
|-------|------|---------|
| B1 | ✅ | — |
| B2 | ✅ | — |
| B3 | ⏳ | Web/Skyline |
| B4 | ⏳ | 全部 |
| B5 | ⏳ | Web/Skyline/App |
| B6-B9 | ⏳ | 超级应用 |

---

## 验收总入口

- 业务代码无 `#ifdef`
- 三端 capability 行为契约一致
- CI `proteus audit capability` 全绿
- 新增平台能力不需修改业务代码
