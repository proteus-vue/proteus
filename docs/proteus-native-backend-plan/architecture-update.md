# Architecture Update — G-28

> 合并进 `proteus-architecture` 规约的变更集。

## 1. 新增模块：G-28 原生能力可插拔架构

**目标：99% 业务场景无需手写原生插件。**

## 2. 原则 #10 泛化

原：统一语义 + 原生实现（渲染层）
扩：**统一语义 + 原生实现（渲染层 + 原生能力层）**

```
原则 #10
  ├── G-27 ProteusRenderBackend   → 怎么画
  └── G-28 ProteusNativeBackend   → 怎么调原生能力
```

## 3. 执行位表新增

| ID | 模块 | 状态 | 依赖 |
|----|------|------|------|
| G-28 | 原生能力可插拔 | planned | G-21, G-24, G-27 |

## 4. 铁律（新增）

- **G-28.1**：业务代码禁止平台判断或原生 SDK 直接调用 → 一律走 `useNative()`
- **G-28.2**：官方 Backend 必须三端实现 + 语义版本化（任一端缺失 = CI 红）
- **G-28.3**：新增常用能力须有 ≥3 端真实实现才进 L1

## 5. 规则（NAT 系列）

| 规则 | 内容 |
|------|------|
| NAT001 | 能力调用必须声明权限 reason |
| NAT002 | 未声明 capability → 编译期 `BACKEND_NOT_INSTALLED` |
| NAT003 | 不支持的能力 → 运行时 `CAPABILITY_UNSUPPORTED`，业务须兜底 |
| NAT004 | 社区包须签名审计，未签名需 `--allow-unsafe` |
| NAT005 | 包体积：L1 内置 ≤ 60KB gzip，单 L2 ≤ 30KB |

## 6. 全景图补充

```
┌─ Vue 响应式 / SFC / 编译期 ─────────────┐
│  SFC → Compiler → Semantic IR            │
└──────────────┬───────────────────────────┘
               │
    ┌──────────┴──────────┐
    ↓                     ↓
ProteusRenderBackend   ProteusNativeBackend   ← G-27 + G-28
(Vue/Flutter/Native/   (iOS/Android/Harmony/
 Skia/Headless)         Mock/Web)
```

## 7. 引用文件

- `01-native-backend-architecture.md` — 主文档
- `02-native-backend-spi.md` — SPI 定义
- `03-capability-catalog.md` — Top 30 清单
- `04-compiler-automation.md` — 编译期生成
- `05-backend-package-spec.md` — 包规范
- `06-ecosystem-governance.md` — 生态治理
- `07-integration-batches.md` — 分批落地
