# G-40 铁律与补充规则

> 编号避让检查：G-39 使用 G-39.1–6 + CMP035–043。
> 本文件使用 **G-40.1–6 + CMP044–050**，无冲突。

---

## 一、铁律（G-40.1 – G-40.6）

### G-40.1 执行载体无关性

> **业务代码不得假设 JS 运行时存在。**

**禁止项**（Compiler IR 层静态扫描，命中即编译错误）：

| # | 禁止 | 原因 |
|---|------|------|
| 1 | 直接使用 `window` / `globalThis` | AOT 路径无此全局对象 |
| 2 | 使用 `eval` / `new Function` | AOT 路径无法动态求值 |
| 3 | 依赖 `setTimeout` 精确时序 | 各载体调度模型不同 |
| 4 | 直接操作 `jsi::Value` / `jsi::Runtime` | 直接违反载体抽象 |
| 5 | 依赖 `Promise` 微任务顺序做同步 | 各载体调度顺序可能不同 |
| 6 | 使用 `Proxy` 做运行时拦截 | AOT 需静态分析 |

**检查时机**：编译期（G-38 transform 阶段）+ CI lint。

---

### G-40.2 三条路径语义等价

> **同一份源码，在 JSI / AOT / WASM 三条路径下必须产出语义等价的行为。**

这是 G-38.2（编译器产物语义等价）在**执行层**的延伸。

**验证**：三载体跑同一 conformance 测试集（C-09 组），行为差异即为 bug。

**已知例外**（必须显式记录）：

| 差异 | 原因 | 处理 |
|------|------|------|
| 动态特性（eval） | AOT 天然不支持 | G-40.1 已静态禁止，故不构成差异 |
| 浮点精度 | 原生/JS 浮点实现差异 | 允许 ULP 级差异，禁止业务依赖精确相等 |
| 调度时序 | 各载体调度器不同 | 业务禁止依赖精确时序（G-40.1-3） |

---

### G-40.3 实时能力禁止 JS 驱动 ★

> **实时能力（音频、高频传感器、游戏循环、视频帧处理）
> 必须在原生线程闭环运行，禁止由 JS 侧驱动循环。**

**判定标准**：回调周期 < 100ms **或** 吞吐 > 1MB/s → 实时类。

**开放给 JS 的仅三个动作**：`configure` / `start` / `stop` + `onEvent` 订阅。

**机器检查**：
- 静态：扫描 `setInterval`/`rAF` 包裹的原生调用 → 编译错误
- 运行时：`threadAffinity: true` 的载体禁止注册实时能力
- 指标：`rtJsDrivenViolations` 恒为 0，非零即 CI 失败

详见 `realtime-escape.md`。

---

### G-40.4 大块数据强制零拷贝

> **超过 4KB 的数据跨界传输，必须使用 `ArrayBuffer` / `SharedArrayBuffer`，
> 禁止走字符串通道。**

**理由**：JSI 中字符串转换默认拷贝，一次往返两次拷贝。

**接口**：`invokeBinary(name, buffer, meta)` / `allocShared(size)`。

详见 `zero-copy-batch.md`。

---

### G-40.5 RenderBackend 必须支持批处理

> **所有 RenderBackend 必须实现 `commitBatch(ops: RenderOp[])`。
> 框架默认走批处理路径，单节点操作仅用于调试/回退。**

**核心约束**：批处理内部操作**不得**逐次跨界（C-06-02）。

**向后兼容**：未实现的 Backend 回退到循环调用，但需记录指标并告警。

详见 `zero-copy-batch.md`。

---

### G-40.6 执行载体可观测

> **载体必须暴露 `getMetrics()`，且 `rtJsDrivenViolations` 恒为 0。**

**指标**：

```typescript
interface CarrierMetrics {
  crossBoundaryCalls: number
  batchCommits: number
  batchedOps: number
  avgBatchSize: number       // batchedOps / batchCommits
  reductionRatio: number     // 操作数 / 跨界次数
  zeroCopyRequests: number
  zeroCopyHits: number
  zeroCopyHitRate: number
  rtJsDrivenViolations: number   // ★ 恒为 0
}
```

**CI 门禁**：`rtJsDrivenViolations > 0` → 构建失败。

---

## 二、补充规则（CMP044 – CMP050）

### CMP044 载体必须声明 capabilities

> **执行载体必须在初始化前提供完整 `CarrierCapabilities`，
> 缺失字段视为不支持（而非"支持"）。**

**理由**：默认"支持"会导致运行时崩溃；默认"不支持"会触发编译期拦截，更安全。

---

### CMP045 实时能力分类强制

> **能力后端（G-28）注册时必须声明是否属于实时类。
> 实时类能力在 `threadAffinity: true` 的载体上禁止 JS 驱动注册。**

**分类依据**：回调周期 < 100ms 或 吞吐 > 1MB/s。

---

### CMP046 未实测数据禁止对外宣称 ★

> **`costProfile.measured: false` 的载体的性能数值，
> 禁止出现在任何对外文档、官网、benchmark 中。**

**理由**：防止把工程推算当性能承诺。这是"证明先于宣称"（W-4）的底线。

**执行**：官网构建时扫描 benchmark 数据源，若来源载体 `measured: false` 则构建失败。

---

### CMP047 零拷贝不得 slice

> **`SharedBuffer.asArrayBuffer()` 必须返回底层视图，禁止 `.slice()`。**

**理由**：`.slice()` 就是拷贝，违背零拷贝语义，且是静默的。

**检测**：conformance C-05-02 验证修改可见性。

---

### CMP048 不支持零拷贝时必须显式降级 ★

> **载体不支持零拷贝时，`allocShared()` 必须返回 `null`，
> 禁止返回"伪装成共享"的拷贝对象。**

**理由**：静默拷贝比不支持更糟——调用方以为零成本，实际仍在拷贝。
这是"性能谎言"的源头。

**检测**：conformance C-05-03。

---

### CMP049 零拷贝降级必须上报

> **`isShared: false` 或 `allocShared` 返回 `null` 时，
> 必须计入 `zeroCopyRequests` / `zeroCopyHits` 指标。**

**理由**：可观测性要求（G-40.6）。让"降级了多少"成为可量化的事实。

---

### CMP050 批处理操作不得逐次跨界

> **`commitBatch` / `invokeBatch` 内部处理单个 op 时，
> 不得再次触发跨界计数。整批提交只计一次跨界。**

**理由**：若内部仍逐次跨界，批处理就失去了意义——这是最容易犯的实现错误。

**检测**：conformance C-06-02（本包参考实现即在此处发现并修复了 bug）。

---

## 三、编号登记与避让

| 编号范围 | 归属 | 状态 |
|---------|------|------|
| G-39.1 – G-39.6 | G-39 宿主运行时 | 已占用 |
| **G-40.1 – G-40.6** | **G-40 执行载体** | **本文件** |
| CMP035 – CMP043 | G-39 宿主运行时 | 已占用 |
| **CMP044 – CMP050** | **G-40 执行载体** | **本文件** |

**冲突检查**：无重叠 ✓

---

## 四、与原则的关系

| 铁律 | 源自原则 |
|------|---------|
| G-40.1 载体无关性 | 原则 #0 支柱①（语义优先） |
| G-40.2 语义等价 | 原则 #0 支柱③（验证先于运行）+ G-38.2 |
| G-40.3 实时逃逸 | 原则 #0 支柱②（接口与实现解耦） |
| G-40.4 零拷贝 | 原则 #0 支柱④（渐进覆盖，能力显式声明） |
| G-40.5 批处理 | 原则 #0 支柱③（验证先于运行） |
| G-40.6 可观测 | 原则 #11（可插拔必须有可验证支撑） |

**G-40 是原则 #0 在"执行层"的第五次投影**，与 G-31/32（语义入口）、
G-27/37（渲染）、G-29/38（编译）、G-28（能力）、G-30/39（端/运行时）同构。

---

*G-40 铁律与补充规则*
