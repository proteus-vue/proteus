# G-30 规则：任意端接入铁律

> 配套 `G-30-universal-backend.md`，进规约铁律总表。

---

## 原则泛化

**原则 #10（统一语义 + 后端实现）** —— 泛化至"任意端"：

> 框架核心只定义语义 IR 与 SPI 契约；**所有端通过实现 Backend 接入，禁止在核心代码中硬编码端差异。**

---

## 铁律

### G-30.1 单一 IR 约束（核心）

> 所有端必须消费**同一份 IR** 并通过**同一份 conformance test**。
> **禁止"某端特例化"**——即禁止 `if (platform === 'xxx')` 出现在框架核心。

- 允许：Backend 内部按需实现
- 禁止：核心 Compiler / Runtime 针对特定端写分支

### G-30.2 开放封闭（接入边界）

> 新增端 = **新增 Backend 包**，**禁止修改框架核心代码**。

- 判定：加鸿蒙、加车机，应只新增 `@proteus/backend-xxx`，不动 `@proteus/core`
- 例外：仅 IR 本身扩展（需 RFC + 版本协商）

### G-30.3 显式能力声明（capabilities）

> 每个 Backend **必须显式声明** `capabilities`（supported / unsupported + reason）。
> **禁止隐式假设**"某端一定有/没有某能力"。

```ts
capabilities: {
  scanQR: { supported: false, reason: 'no camera SDK' },
  share: { supported: true }
}
```

### G-30.4 降级可见（Tier-aware）

> Tier 2/3/4（受限端）的降级路径**必须在编译期可用**，通过 `@conditional` 或显式 fallback。
> **禁止"该端默默失败 / 运行时才崩"**。

---

## 能力分级规则（映射到 G-28 NAT 规则）

| 能力分级 | 含义 | 端覆盖要求 |
|----------|------|-----------|
| **L1 内置**（框架默认） | 99% 端都有 | 任一 Tier 1 端必须实现 |
| **L2 条件**（按端可选） | 部分端有 | capabilities 声明，编译期裁剪 |
| **L3 扩展**（独立包） | 长尾 / 特定生态 | 独立 Backend 包，社区可贡献 |

> 注：L1/L2/L3 沿用 G-28 能力模型，G-30 将其泛化到"端"维度。

---

## conformance test 规则

每个 Backend 包**必须**包含并通过：

1. **IR 语义等价测试**：同一 IR → 该端输出符合预期结构
2. **capabilities 一致性**：声明 vs 实际实现一致（无虚假 supported）
3. **降级路径测试**：L2 缺失能力 → 编译期报错 / `@conditional` 生效
4. **性能基准**（可选，Tier 1 必填）：帧率 / 内存 / 启动基线

**CI 红条件**：任一 conformance 项失败 → 该 Backend 版本不得发布。

---

## 与既有规则的关系

- **G-27 RND 规则**：渲染后端可插拔 → G-30.1 是其在"任意端"下的强化
- **G-28 NAT 规则**：原生能力即语义 → G-30.3 capabilities 直接复用
- **G-29 CMP 规则**：编译后端可插拔 → G-30 要求**每个端可选编译后端**（Tier-aware 编译）
- **原则 #10**：统一语义 + 后端实现 → G-30 是其终极兑现

---

## 版本与状态

- **Status**：Draft
- **引入版本**：Proteus v0.x（规划中）
- **Owner**：Architecture SIG
- **需评审项**：
  - [ ] Tier 分级阈值（Tier 2 的"受限"具体范围）
  - [ ] conformance test 的最小用例集
  - [ ] B3 车机 Backend 演练的实际工作量估算
