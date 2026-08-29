# CI 审计规则明细（M8）

> `proteus audit component` 是组件层的**硬门禁**：CI 与本地 pre-commit 均可运行，规则不通过则阻断合并。
> 与 Pinia `audit store`、Router `audit route`、API `audit api` 并列，统一 Proteus 治理。

---

## 1. 规则清单

### 架构违规（error）
| ID | 规则 | 检测方式 |
|----|------|----------|
| `no-platform-api` | 组件内不得直接 `wx.*` / `document.*` / `window.*` | AST 扫描 import + 调用 |
| `no-business-logic` | 业务组件不得调用 `api.*`（只允许组合 + emit） | 依赖图分析 |
| `no-global-leak` | 全局组件（appBar）不得持有页面级引用 | 生命周期扫描 |
| `matrix-complete` | 矩阵条目覆盖率 100% | 脚本比对组件目录与矩阵文件 |
| `transform-synced` | 每个组件 `transform.ts` 与 `*.ir.md` 一致 | IR schema 校验 |

### 质量（warning，可配置为 error）
| ID | 规则 | 说明 |
|----|------|------|
| `degradation-covered` | 每个 ⚠️/❌ 映射必须有单测 | 矩阵标记 ↔ 快照文件 |
| `no-vfor-without-listview` | 长列表必须用 `p-list-view` | 静态分析 v-for 长度估算 |
| `no-sync-storage-in-component` | 组件内禁止 `wx.setStorageSync` | 对齐 API A3 异步原则 |
| `no-inline-style-hot-path` | 高频更新不得内联 `:style` | 需走 Worklet/shared |

---

## 2. 实现建议

- 基于 **ESLint 自定义规则** + **jscodeshift**（AST）+ **Node 脚本**（矩阵覆盖率）
- 配置文件：`proteus.config.ts` 的 `components.audit`
```ts
export default defineConfig({
  components: {
    audit: {
      level: { 'no-platform-api': 'error', 'degradation-covered': 'warning' },
      strict: process.env.CI === 'true',
    },
  },
})
```

---

## 3. 与 trace / DevTools 集成
- 审计结果可导出 JSON，供 DevTools "Proteus Health" 面板展示
- 与 `--trace-transform` 同一输出目录 `.proteus/audit.json`
- CI 失败时在 PR 评论中贴出违规定位（文件:行号 + 规则说明 + 修复建议）

---

## 4. 豁免机制（谨慎使用）
- `// proteus-ignore rule:no-platform-api -- reason:xxx` 单行豁免，需评审
- 全局豁免仅限 `runtime/` 层（L2），业务目录不允许

---

## 5. 验收
- 所有 error 规则在空仓库跑通（零误报基线）
- 故意写违规代码 → CI 阻断 ✅
- 矩阵覆盖率脚本与真实组件目录一致
- 审计耗时 < 10s（不拖慢开发体验）
