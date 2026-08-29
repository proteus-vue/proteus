# 测试、迁移与快照

---

## 1. 测试分层

| 层 | 内容 | 工具 |
|----|------|------|
| 单元 | transform / capability / composables | Vitest |
| 组件 | 交互 + 快照（双端 IR） | Vitest + @vue/test-utils |
| 跨端契约 | 同一用例跑 Web + Skyline mock | Vitest projects |
| E2E | 真实 Skyline（开发者工具 CLI）+ Web | Playwright + miniprogram-ci |

---

## 2. 快照规范

每个组件维护 **两份快照**：
- `*.web.snap`：编译后 DOM 结构
- `*.skyline.snap`：编译后 WXML 结构 + setData 调用序列

快照即契约，PR 变更快照必须人工 review。

---

## 3. 跨端测试矩阵

| 组件 | Web | Skyline | Worklet | 降级 |
|------|-----|---------|---------|------|
| p-view | ✅ | ✅ | — | ✅ |
| p-scroll-view | ✅ | ✅ | — | ✅ |
| p-popup | ✅ | ✅ | ✅ | ✅ |
| p-toast | ✅ | ✅ | ✅ | ✅ |
| p-player-bar | ✅ | ✅（appBar）| — | ✅ |

每行一个 test suite，capability mock 覆盖两条分支。

---

## 4. 迁移策略（存量项目）

### 4.1 基础标签迁移（codemod）
```
div → p-view
span → p-text
img → p-image
scroll-view（手写）→ p-scroll-view
```
工具：`jscodeshift` + 自定义 transform，跑完自动 PR。

### 4.2 业务组件接入
- `p-player-bar`：替换手动全局挂载 → `mountMpApp({ appBar })`
- `p-payment-sheet`：替换内联支付弹层

### 4.3 零破坏性
- 旧组件名保留一个 minor 版本做 alias + deprecation warn
- 矩阵文件记录每个废弃项移除版本

---

## 5. 验收
- 每个组件单元测试覆盖率 ≥ 85%
- 跨端矩阵全部绿色
- codemod 跑通真实存量项目 ≥ 1 个
- 快照变更 PR 均经人工 review
