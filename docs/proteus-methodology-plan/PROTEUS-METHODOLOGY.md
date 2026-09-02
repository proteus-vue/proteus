# PROTEUS-METHODOLOGY

> **Proteus 设计方法论：统一语义收敛（Unified Semantic Convergence）**
>
> 版本：v1（2026-09-02）
> 状态：架构级哲学文档，根目录入口

---

## 0. 一句话

**Proteus 不做跨端翻译，而是定义与平台无关的语义内核；一切平台差异下沉为"后端实现细节"。**

这不是一组分散的设计原则，而是**一个思维模型在四个架构维度上的投影**。
整件事从头到尾是同一套方法论在延伸——本文把它显式提炼出来。

---

## 1. 核心公式

```
任何跨端问题 = 语义定义（框架做） + 后端实现（平台做）
```

框架只做两件事：

1. **定义"你要什么"** → 语义接口 / 中间表示（IR）
2. **定义"怎么验证你做对了"** → conformance test / 铁律 / 编译期约束

平台只做一件事：

- **提供"怎么做"** → Backend 实现

**业务开发者什么都不用做——只消费语义接口。**

---

## 2. 四个维度的统一应用

| 维度 | 语义层（框架定义） | 后端 SPI（平台实现） | 验证机制 |
|------|-------------------|---------------------|----------|
| **编译**（G-29） | Compiler IR（SFC → 中间表示） | `ProteusCompilerBackend`（Node / Rust / WASM） | IR Golden Test |
| **UI 渲染**（G-27） | VNode / LayoutConstraint IR | `ProteusRenderBackend`（VueDom / Native / Flutter / Skia） | Render Conformance |
| **原生能力**（G-28） | Capability IR（语义接口） | `ProteusNativeBackend`（iOS / Android / Harmony / Mock） | Capability Test |
| **端接入**（G-30） | Tier 模型（R + C + J 三元组） | `ProteusPlatformBackend`（任意端） | Backend Conformance |

**同一个 shape，四个投影：**

```
定义接口 → 多端实现 → conformance 强制 → 业务零感知
```

---

## 3. 五个支柱

### 支柱 ①：语义优先于实现（Principle #10 核心）

> 不翻译 API，定义语义。

传统框架的思维是"把 A 平台的 API 翻译成 B 平台的 API"——翻译永远有损。
Proteus 的思维是"定义一个与任何平台无关的语义，各平台来实现它"——零损映射。

```
传统：   Platform A API → 翻译层 → Platform B API   （有损）
Proteus：Business → 语义 IR → Backend SPI → Platform A / B / C   （无损）
```

**框架从不说"小程序 API 是标准"或"Apple 的 API 是标准"——框架自己定义的语义才是标准。**
各端 Backend 是 SPI 的实现者，不是被翻译的目标。

---

### 支柱 ②：接口与实现彻底解耦

> 业务代码只依赖接口，永远不依赖具体后端。

```
业务 ──→ 接口（框架定义）──→ 后端 A / B / C
                              ↑
                    业务不知道 A/B/C 的存在
```

- 切换后端 = 换实现，**不改接口，不改业务**
- 同一份业务代码，运行时按页面 / 按配置选择最优后端
- 这是 SPI（Service Provider Interface）模式的本质

---

### 支柱 ③：验证先于运行（编译期消灭不可能）

> 能在编译期发现的问题，绝不留到运行时。

| 传统框架 | Proteus |
|---------|---------|
| 翻译失败 → 运行时崩溃 | 语义 IR 校验 → 编译期报错 |
| 某端缺能力 → 运行时 undefined | `BackendCapabilities` → 编译期拦截 |
| 版本升级 → bridge 碎 → 线上 bug | conformance test → CI 红 |

**约束系统挂在 IR 上，不是挂在某个平台上。**
这也是 AI Agent（G-23）能安全介入的原因——它操作的是 IR，IR 上有约束。

---

### 支柱 ④：渐进式覆盖（帕累托结构）

> 80% 场景框架内置，18% 官方 Backend，1.9% 社区，0.1% 兜底。

不是"要么全做要么不做"——是分层覆盖，每一层都有明确的退出路径：

```
L1 框架内置（Top N）  → 80%   → 开发者零成本
L2 官方 Backend       → +18%  → SDK 作者写（不是业务写）
L3 社区包             → +1.9% → 审计签名
L4 自定义             → 0.1%  → 仅兜底
                        99% ✅
```

**99% 不写原生 / 不写渲染代码 / 不写编译器——是可达的工程目标，不是空头承诺。**

---

### 支柱 ⑤：方法论本身可泛化（G-30 证明）

> 如果这套方法论能同时解决编译、渲染、能力、端接入四个完全不同的问题，
> 那它就能解决**任何"跨 X"问题**。

这就是 G-30 的深层意义——它不是"又加了一个模块"，而是**证明了方法论的完备性**。

任意新问题进来，套同一个公式：

```
1. 这个问题的"语义"是什么？        → 定义 IR
2. 各端的"实现差异"是什么？        → 定义 Backend 接口
3. 怎么验证"做对了"？             → 定义 conformance
```

---

## 4. 与传统框架的方法论对比

| | 传统跨端框架 | **Proteus** |
|--|-------------|-------------|
| **核心隐喻** | 翻译（一种语言 → 另一种语言） | **抽象**（语义 → 多后端实现） |
| **标准归属** | 某个平台（微信 / Apple / Google） | **框架自己** |
| **扩展方式** | 加翻译规则 / 加 `#ifdef` 分支 | **加 Backend 实现** |
| **新端成本** | 重写映射表 | **实现 SPI 接口（~15 方法）** |
| **能力缺失** | 运行时崩溃 / 行为不一致 | **编译期拦截 / conformance 拒绝** |
| **版本演进** | 跟着平台 API 版本走 | **框架独立控制语义演进** |
| **调试体验** | 翻译后代码，报错在原生层 | **IR 层校验，错误在语义层** |
| **AI 可介入** | 无 IR，只能文本替换 | **操作 IR，强制合规** |

**传统框架是"polyfill 思维"——缺什么补什么。**
**Proteus 是"OS 抽象层思维"——定义接口，让平台来适配我。**

---

## 5. 可证明的工程断言

> **只要一个平台能提供「渲染宿主（R）+ 原生能力宿主（C）+ JS 运行时（J）」三者之一，
> 它就可以通过实现一个 Backend 接入 Proteus。**

### Tier 模型

| Tier | 条件 | 含义 |
|------|------|------|
| 1 | R + C + J | 一等公民（零代价） |
| 2 | 缺一 | 受限可用（编译期裁剪） |
| 3 | 仅 R | 纯渲染（Flutter / Skia / VR） |
| 4 | 仅 J | Headless（SSR / AI Agent） |

这不是口号——是三个维度的可证明性：

- **① 形式化**：`Platform = (R, C, J)` 三元组
- **② 可操作**：Backend 五步接入法，约 15 个 nodeOps 方法 + 跑 conformance test
- **③ 可验证**：conformance test 强制，CI 自动校验

★ **可信性证明**：B3 车机 Backend 冷启动演练——框架团队之外的人，3 天内接入一个没人预研过的端。

---

## 6. 对外一句话（Elevator Pitch）

> **"We don't translate across platforms — we define a semantic kernel,
> and let every platform implement it. Business talks to the kernel only."**
>
> 中文：**"我们不做跨端翻译，我们做跨端操作系统。语义是内核，后端是驱动——业务只和内核对话。"**

---

## 7. 设计原则速查（Principle Index）

| 编号 | 原则 | 落地 |
|------|------|------|
| #1 | 统一语义 + 后端实现 | G-27 / G-28 / G-29 / G-30 |
| #2 | 语义优先于实现 | 一切 IR 先行 |
| #3 | 接口与实现解耦 | SPI 模式 |
| #4 | 验证先于运行 | conformance + 编译期约束 |
| #5 | 渐进式覆盖 | L1/L2/L3/L4 分层 |
| #6 | 方法论可泛化 | G-30 完备性证明 |
| #7 | 显式声明 > 隐式假设 | `BackendCapabilities` |
| #8 | 编译期消灭不可能 | `@conditional` / `defineCapability` |
| #9 | 业务代码零感知后端 | `useNative()` / nodeOps |
| #10 | 一切皆可插拔 | 四层 Backend |

---

## 8. 不承诺什么（诚实边界）

| 不可接入 | 原因 |
|----------|------|
| 纯后端服务 | 不是"端" |
| 无 JS 且无渲染的裸 MCU | 三元组全缺 |
| 强实时 / 强安全隔离（航空、医疗） | 需确定性执行 |
| 封闭生态不允许嵌入 JS | Tier 3 纯渲染兜底 |

**明确边界比无限承诺更有说服力。**

---

## 9. 文档关系

```
PROTEUS-METHODOLOGY.md（本文，根目录哲学入口）
    ↑ 提炼自
proteus-architecture/（规约层：原则 + 铁律）
    ↑ 落地于
G-27 渲染后端可插拔
G-28 原生能力可插拔
G-29 编译器后端可插拔
G-30 任意端接入
    ↑ 编排于
proteus-roadmap/（M1/M2/M3）
    ↑ 叙事出口
proteus-positioning/（七杀手特性 + 对标矩阵）
```

---

## 10. 版本记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-09-02 | 首次提炼：五个支柱 + 四层 SPI + Tier 模型 + 原则速查 |

---

**"We don't translate across platforms. We define the kernel — and let platforms implement it."**
