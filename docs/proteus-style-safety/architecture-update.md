# Architecture 规约更新（G-16）

> 合并进 `proteus-architecture.md` 的变更说明。

---

## 1. 新增执行位：G-16

| 字段 | 值 |
|------|---|
| ID | G-16 |
| 名称 | Style Runtime Safety（全端样式运行时安全） |
| 优先级 | P1 |
| 归属 | Architecture 原则 #10 + Compiler + Runtime + DevTools |
| 依赖 | G-01（Architecture）、CSS 兼容矩阵、App Renderer、Compiler IR |
| 状态 | Plan（待 M1 启动） |

---

## 2. 原则 #10 补充

**原原则 #10：**
> 框架定义统一语义，各端用原生方式实现。不允许引入跨端自绘布局引擎。语义一致优先于像素一致。

**补充条款（#10.1）：**

> **所有样式值必须经语义层校验后才可抵达原生渲染管线。**
> 禁止 `:style` 直通任意 CSS 属性；只允许白名单属性 + `p-*` 语义组件 + Theme token。
> 框架在编译期与运行时双重保证，五端原生 API 绝无非法参数。

**新增反例：**

- ❌ 允许任意 CSS 属性直通 `:style`（绕过语义层）
- ❌ 不做运行时校验（JSI 直调 crash 风险）
- ❌ 用 `!important`（框架禁用）
- ❌ 动态 `display: inline-flex`（必须用 `<p-flex>`）

---

## 3. 全局铁律新增

> **G-16（样式安全）**：任何样式值在编译期或运行期必经 Style Validator；五端原生闸门作为纵深防御。**样式崩溃 ≠ 白屏，降级优先。**

---

## 4. 全景图更新

```
原全景图（Layer 1 语义层）：
┌─────────────────────────────────────────┐
│  Layer 1: 语义层 (Semantics Layer)      │
│  - p-* 组件语义                         │
│  - 布局语义 (p-flex/p-stack)            │
│  - 设计令牌 (Theme/FontScale)           │
│  - ★ 新增：样式值安全语义（G-16）        │
└────────────────────┬────────────────────┘
                     ↓ Compiler IR
┌─────────────────────────────────────────┐
│  Layer 2: 各端原生实现                  │
│  - Web / Skyline / iOS / Android / 鸿蒙 │
└─────────────────────────────────────────┘
```

---

## 5. 与现有规约章节的关系

| 章节 | 变更 |
|------|------|
| 原则 #10 | 补充 #10.1（样式安全条款）+ 反例 |
| 铁律 | 新增 G-16 |
| 执行位清单 | 新增 G-16（P1） |
| 全景图 | Layer 1 新增"样式值安全语义" |
| CSS 兼容矩阵 | 无变更（本方案消费矩阵） |
| App Renderer | `patchStyle` 接入 Validator |
| Compiler | 新增 style-safety transform |
| DevTools | 新增 Style Safety 面板 |

**全部为新增/接入，无破坏性改动。**

---

## 6. 设计决策记录（ADR）

### ADR-016：样式安全放哪里？

**决策：** 三层防线（编译期 + 运行时 + 原生闸门），而非单一 lint。

**理由：**
- 仅 lint → 运行时动态值仍裸奔（RN 现状）
- 仅运行时 → 性能开销 + 崩溃后才发现
- 编译期 + 运行时 + 原生闸门 → 纵深防御，任一生效即安全

**后果：**
- 编译期覆盖越全，运行时开销越小
- 静态推导覆盖率成为关键指标（> 80%）

---

## 7. 合并检查清单

- [ ] `proteus-architecture.md` 原则 #10 补充 #10.1
- [ ] 铁律新增 G-16
- [ ] 执行位清单新增 G-16（P1）
- [ ] 全景图 Layer 1 更新
- [ ] ADR-016 录入 `adr/` 目录
- [ ] `proteus-positioning.md` 第 5 章"六大杀手特性"补充"全端样式运行时安全"
- [ ] `proteus-css-compat` 主文档交叉引用本方案
- [ ] `proteus-app-renderer-plan` 03-renderer-pipeline 更新 `patchStyle`
- [ ] CI 新增 `check-style-report.mjs`

---

## 8. 对定位文档的影响

`proteus-positioning.md` 对标矩阵新增一行：

| 能力 | uni-app x | RN | Flutter | **Proteus** |
|------|-----------|-----|---------|------------|
| 运行时样式安全 | ⚠️ ucss 子集 | ❌ | ✅ 编译期 | ✅ 编译+运行+原生三层 |

→ **Proteus = 唯一同时做到"原生渲染 + Vue 生态 + 运行时样式安全"的框架。**
