# G-58 API 版本化

> **API 一旦发布就是长期契约。**
> 本章解决的核心问题：**如何让 API 演进而不破坏老插件。**

---

## 1. 两个标杆，各学一半

| 来源 | 机制 | 学什么 |
|------|------|--------|
| **Zed** | WIT 文件按版本并存（`since_v0_0_1` → `since_v0_8_0`） | **版本化路由** |
| **VSCode** | `enabledApiProposals` 提案机制 | **提案 opt-in + 禁止发布** |

**Zed 解决了"演进"，VSCode 解决了"未稳定前不承诺"。**
两者互补，本份同时采纳。

---

## 2. WIT 版本化（学 Zed）

### 2.1 机制

每个 API 版本对应**一个独立的 WIT 文件**：

```
api/
  since_v0_1_0.wit    初始稳定：贡献点、主题、片段
  since_v0_2_0.wit    面板贡献、命令
  since_v0_3_0.wit    kernel.spiTopology、kernel.layerRules
  since_v0_4_0.wit    kernel.conformance、device 能力
```

Zed 官方说明其效果：

> "This ensures **backward compatibility for older extensions**
> while allowing the API to evolve."

### 2.2 为什么这个机制有效

传统做法是"改 API + 保留兼容分支"，结果是：

```
API 里塞满 if (version < x) { ... } else { ... }
```

**WIT 版本化把兼容性问题从"代码分支"变成"文件并存"**：

| | 传统 | WIT 版本化 |
|---|------|-----------|
| 老插件行为 | 靠运行时分支判断 | **直接用老 WIT**，行为确定 |
| 新增 API | 塞进现有接口 | 只在**新版本文件**里加 |
| 删除 API | 不敢删 | **新版本不含它**，老版本保留 |

> **API 只增不改，是向后兼容的最简实现。**

### 2.3 版本演进实例（Zed 实证）

```
v0.1.0  初始稳定 API；基础 LSP 与主题
v0.5.0  Project 与 KeyValueStore delegates
v0.6.0  Slash commands、Context Servers、HTTP client
v0.8.0  DAP 增强、Task templates、HTTP response streams
```

观察：**每个版本都是"加东西"，没有"改东西"。**

---

## 3. 提案 API 机制（学 VSCode）

### 3.1 为什么需要

稳定 API 的代价（VSCode 官方原文）：

> "once we introduce an API, **we cannot easily change it anymore**."

所以必须在"稳定"之前留一个**可反悔**的阶段。

### 3.2 机制

```toml
# plugin.toml
[api]
minVersion = "0.4.0"
proposals = ["deviceInputV2"]   # ← 提案 API
```

VSCode 的规则同样适用于本份：

> "Proposed APIs are **subject to change**, only available in
> Insiders distribution and **should not be used in published extensions**."

**本份的硬性约束（INV-EX-08）**：

```
声明了 proposals 的插件 → 可本地开发、可调试
                       → ❌ 不得发布到插件市场
```

**这是发布期强制校验，不是君子协定。**

### 3.3 提案的五阶段（学 VSCode）

```
① API Idea        是否复用既有概念？是否多个用例？
② Proposal        提出，须向后兼容，须符合 API 指南
③ Implemented     实现 + 征求反馈（可频繁变更）
④ Feedback        根据真实使用迭代
⑤ Finalization    有多用例 + 非平凡示例 → 转稳定
```

VSCode 明确警告：

> "there isn't any guarantee that there won't be further changes
> or that the proposal will become stable
> (e.g. in rare circumstances, we might even **deprecate** the proposed API)"

**提案可能死在半路——这正是它存在的意义。**

---

## 4. 版本号规则

| 层级 | 含义 | 示例 |
|------|------|------|
| **主版本** | 不兼容变更（**本份禁止对已稳定 API 做**） | 0.x → 1.0 |
| **次版本** | 新增 API（**唯一允许的稳定演进方式**） | 0.1 → 0.2 |
| **修订** | 文档/实现修正，无接口变化 | 0.1.0 → 0.1.1 |

### 铁律

```
已稳定的 WIT 版本 = 冻结，永不修改
新增能力        = 新开一个次版本文件
不兼容变更      = 只能发生在提案阶段
```

---

## 5. 废弃策略

VSCode 的做法：

> "Deprecated API: Marked with `@deprecated`, but **still functional**"
> 并有 `IExtHostApiDeprecationService` **追踪与上报使用情况**

本份采纳：

| 阶段 | 行为 |
|------|------|
| 标记废弃 | 文档中标注，运行时**照常工作** |
| 上报统计 | 宿主记录哪些插件仍在用 |
| 移除 | **至少跨一个主版本**，且需使用量归零 |

> **废弃不等于移除。** 静默移除老 API 是生态信任的最大杀手。

---

## 6. 兼容性校验时机

```
安装期  → 校验 minVersion 是否存在对应 WIT
         校验 proposals 是否合法
         校验 proposals 是否已用于发布（禁止）
激活期  → 路由到对应版本 WIT
运行期  → 越权返回 denied，不做版本猜测
```

**所有版本问题在安装期暴露，不留到运行时。**

---

## 7. 诚实标注

| 项 | 状态 |
|----|------|
| WIT 版本化机制 | ✅ 有 Zed 实证，机制成熟 |
| 提案 API 机制 | ✅ 有 VSCode 实证 |
| **Studio 的具体 API 面** | ⚠️ **本份只定机制，未定全部接口** |
| 废弃 API 的实际移除流程 | ⚠️ 需市场侧统计能力配合，未设计 |

**不要宣称"插件 API 已完成"** —— 完成的是**机制**，接口面待填充。
