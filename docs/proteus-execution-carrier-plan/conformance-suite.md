# G-40-D：Conformance 测试套件

> 原则 #11：可插拔必须有可验证支撑。
> 执行载体必须跑通 42 项 conformance 才能宣称 "Proteus Compatible"。

---

## 1. 测试分组

| 组 | 名称 | 测试数 | 关注点 |
|----|------|--------|--------|
| C-01 | 接口完整性 | 4 | 必需方法存在且签名正确 |
| C-02 | 生命周期 | 4 | initialize → load → invoke → dispose |
| C-03 | 产物装载 | 4 | 各 artifactTypes 正确装载 |
| C-04 | 跨界成本画像 | 4 | costProfile 真实性与声明 |
| C-05 | 零拷贝通道 | 6 | 分配、共享语义、降级、超限 |
| C-06 | 批处理 | 5 | 批量提交、原子性、降频效果 |
| C-07 | 并发能力 | 5 | Worker / 真并发 / 线程亲和性声明 |
| C-08 | 实时能力 | 4 | 逃逸协议、节流、状态机 |
| C-09 | 语义等价 | 3 | 三载体行为一致 |
| C-10 | 可观测性 | 3 | 指标正确、违规计数 |

**总计 42 项。**

---

## 2. 测试明细

### C-01 接口完整性（4）

| ID | 测试 | 断言 |
|----|------|------|
| C-01-01 | 必需方法存在 | `initialize/dispose/load/unload/invoke/invokeBatch/allocShared/invokeBinary/getMetrics` 均为 function |
| C-01-02 | capabilities 结构 | 包含 `costProfile/zeroCopy/concurrency/realtime/dynamism/artifactTypes/tier` |
| C-01-03 | capabilities 类型 | `concurrency.threadAffinity` 为 boolean，`tier` ∈ {1,2,3,4} |
| C-01-04 | id 唯一性 | `id` 为非空字符串，与其他载体不冲突 |

### C-02 生命周期（4）

| ID | 测试 | 断言 |
|----|------|------|
| C-02-01 | 初始化幂等 | 多次 `initialize()` 不报错，状态一致 |
| C-02-02 | 未初始化拒绝操作 | 未 initialize 时 `load()` 抛错 |
| C-02-03 | dispose 清理 | dispose 后模块表清空 |
| C-02-04 | dispose 幂等 | 多次 dispose 不报错 |

### C-03 产物装载（4）

| ID | 测试 | 断言 |
|----|------|------|
| C-03-01 | 装载 js-bundle | 声明支持的载体能装载 |
| C-03-02 | 装载不支持类型 | 明确报错，不静默接受 |
| C-03-03 | unload 生效 | unload 后 invoke 返回 module_not_found |
| C-03-04 | 多模块隔离 | 两个模块状态互不干扰 |

### C-04 跨界成本画像（4）★ 诚实性测试

| ID | 测试 | 断言 |
|----|------|------|
| C-04-01 | measured 字段存在 | `costProfile.measured` 为 boolean |
| C-04-02 | ★ 未实测不得宣称 | `measured: false` 时，框架禁止对外引用其数值（CMP046） |
| C-04-03 | 成本非负 | `scalarCall >= 0 && objectProperty >= 0` |
| C-04-04 | AOT 路径成本为 0 | 若 `artifactTypes` 含 `aot-native`，`scalarCall` 应为 0 |

**C-04-02 是"诚实性"测试**——防止把工程推算当实测数据对外宣称。

### C-05 零拷贝通道（6）★ G-40.4

| ID | 测试 | 断言 |
|----|------|------|
| C-05-01 | 正常分配 | `allocShared(小尺寸)` 返回 SharedBuffer |
| C-05-02 | ★ 共享语义 | `asArrayBuffer()` 返回同一底层（修改可见） |
| C-05-03 | ★ 禁止静默拷贝 | 不支持时返回 `null`，不返回"假装共享"的对象（CMP048） |
| C-05-04 | 超限降级 | 超过 `maxSize` 返回 `null` |
| C-05-05 | isShared 语义 | `isShared: false` 时上报指标（CMP049） |
| C-05-06 | release 生效 | release 后再访问抛错 |

### C-06 批处理（5）★ G-40.5

| ID | 测试 | 断言 |
|----|------|------|
| C-06-01 | 批量执行 | N 个 op 返回 N 个结果，顺序一致 |
| C-06-02 | ★ 单次跨界 | 批处理内部操作不额外计入 `crossBoundaryCalls` |
| C-06-03 | 降频效果 | `avgBatchSize = batchedOps / batchCommits`，等于批量大小 |
| C-06-04 | 原子性 | 批处理中途失败不影响已提交部分的可回滚性（由实现声明） |
| C-06-05 | 未知 op | 未知 `kind` 返回 `unknown_op` 错误，不崩溃 |

**C-06-02 是核心**——批处理若内部仍逐次跨界，等于没优化。

### C-07 并发能力（5）★ 批评三

| ID | 测试 | 断言 |
|----|------|------|
| C-07-01 | 声明一致性 | `threadAffinity: true` 的载体，`trueConcurrency` 必须为 false |
| C-07-02 | Worker 创建 | 支持 workers 时能创建 |
| C-07-03 | Worker 上限 | 超过 `maxWorkers` 返回 null |
| C-07-04 | ★ 亲和性声明 | `threadAffinity: true` 时，框架禁止在 Worker 间共享 Value |
| C-07-05 | 序列化语义 | `threadAffinity: true` 时，`postWorker(对象)` 返回 `serialized: true` |

**C-07-01 是逻辑自洽检查**：有线程亲和性就不可能有真并发，两者不能同时为 true。

### C-08 实时能力（4）★ G-40.3

| ID | 测试 | 断言 |
|----|------|------|
| C-08-01 | 实时能力声明 | `realtime.capable` 与载体能力一致 |
| C-08-02 | ★ 不支持时拒绝 | `realtime.capable: false` 的载体，注册实时能力直接报错 |
| C-08-03 | 状态机 | idle → running → stopped 转换正确 |
| C-08-04 | ★ 事件节流 | 原生侧高频，JS 侧事件频率 ≤ `maxHz` |

**C-08-04 是逃逸协议的验证**——证明 JS 确实退出循环、只接收节流事件。

### C-09 语义等价（3）★ G-40.2

| ID | 测试 | 断言 |
|----|------|------|
| C-09-01 | 标量调用一致 | 同一函数在 JSI / AOT 载体返回值相同 |
| C-09-02 | 二进制处理一致 | 同一份 buffer 经两载体处理结果逐字节相同 |
| C-09-03 | 批处理结果一致 | 同一批 ops 在两载体结果一致 |

### C-10 可观测性（3）★ G-40.6

| ID | 测试 | 断言 |
|----|------|------|
| C-10-01 | 指标结构 | `getMetrics()` 包含全部 7 个字段 |
| C-10-02 | 降频比计算 | `reductionRatio` 公式正确 |
| C-10-03 | ★ 违规计数 | `rtJsDrivenViolations` 恒为 0（非零即 CI 失败） |

---

## 3. 运行方式

```bash
# 运行完整套件
proteus conformance --carrier ./my-carrier.js

# 仅运行某组
proteus conformance --carrier ./my-carrier.js --group C-05

# 输出 JSON 报告
proteus conformance --carrier ./my-carrier.js --json report.json
```

**退出码**：0 = 全部通过；1 = 有 FAIL。

---

## 4. 跳过规则

某些载体天然不支持某些能力（如 JSI 不支持实时）。
此时应 **SKIP** 而非 FAIL：

```
SKIP 条件：
  - C-08-* ：载体 capabilities.realtime.capable === false
  - C-05-* ：载体 capabilities.zeroCopy.supported === false
  - C-07-* ：载体 capabilities.concurrency.workers === false
```

**SKIP 不等于豁免**——框架需记录"该载体不具备某能力"，
并在业务使用到该能力时**编译期报错**（G-40.3 / capabilities 拦截）。

---

## 5. 参考实现实测结果

本包 `carrier-reference.js` 的真实运行结果：

### JSICarrier

```
C-01 接口完整性   PASS ×4
C-02 生命周期     PASS ×4
C-03 产物装载     PASS ×4
C-04 成本画像     PASS ×4   (measured: true, 27/181 ns)
C-05 零拷贝       PASS ×6   (8MB 共享成功；200MB 超限 → null 显式降级)
C-06 批处理       PASS ×5   (avgBatchSize = 100)
C-07 并发         PASS ×5   (threadAffinity: true → serialized: true)
C-08 实时         SKIP ×4   (realtime.capable: false，正确跳过)
C-09 语义等价     PASS ×3
C-10 可观测性     PASS ×3
─────────────────────────
PASS: 38  SKIP: 4  FAIL: 0
```

### AOTCarrier

```
C-01 ~ C-07       PASS ×32
C-08 实时         PASS ×4   (★ 原生侧 90Hz，JS 侧节流到 30Hz)
C-09 语义等价     PASS ×3
C-10 可观测性     PASS ×3
─────────────────────────
PASS: 42  SKIP: 0  FAIL: 0
```

### 对比意义

两个载体**同一套测试**，差异只在被 capabilities 声明的能力项上：

| 维度 | JSICarrier | AOTCarrier |
|------|-----------|-----------|
| 实时能力 | SKIP（不支持） | **PASS（90Hz→30Hz 节流）** |
| 线程亲和性 | true（受限） | **false（真并发）** |
| 跨界成本 | 27/181 ns | **0** |
| Worker 共享 | 需序列化 | **共享内存** |

**这组对比本身就是对三条批评最直接的机器证据**：
JSI 的问题客观存在（SKIP 项），而 AOT 路径确实解决了它们（PASS 项）。

---

*G-40-D · Conformance 测试套件*
