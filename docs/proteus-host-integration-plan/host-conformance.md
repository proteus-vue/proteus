# Host Conformance（G-41）

> **怎么验证一个宿主"接对了"。**
> 32 项测试，H-01 ~ H-08。**失败数为 0 才允许上线（CMP058）。**

---

## 运行方式

```bash
node host-reference.cjs          # 运行参考实现 + 全套 conformance
# 输出： PASS=32  FAIL=0  SKIP=0
# 退出码：0（合规）/ 1（不合规）
```

真实宿主：

```bash
proteus conformance --host ./MyHost --backend ios-uikit
```

---

## 测试组

### H-01 接入完整性（4 项）

| ID | 断言 |
|----|------|
| H-01-01 | HostRuntime 已注册且状态为 `running` |
| H-01-02 | ExecutionCarrier 已注册 |
| H-01-03 | RenderBackend 已注册 |
| H-01-04 | ★ 全部注册发生在 `bootstrap()` 之前（G-41.6） |

### H-02 生命周期（4 项）

| ID | 断言 |
|----|------|
| H-02-01 | `suspend()` → 状态 `suspended` |
| H-02-02 | `resume()` → 状态 `running` |
| H-02-03 | `createWorker()` 产生独立线程 |
| H-02-04 | `destroy()` 清理队列/timer/worker |

### H-03 ★ 引擎可切换性（4 项）

**这是整套架构的验收核心。**

| ID | 断言 |
|----|------|
| H-03-01 | 同一 SFC 在 Backend A 渲染成功 |
| H-03-02 | `switchBackend()` 生效 |
| H-03-03 | 同一 SFC 在 Backend B 渲染成功（**源码零改动**） |
| H-03-04 | ★ 两引擎 **IR 快照完全一致** |

**H-03-04 的意义**：只要"同一份 IR 在两个引擎下都能渲染"，就机器证明了"Vue 代码不变、引擎可换"。

### H-04 职责边界（5 项）

| ID | 断言 | 对应铁律 |
|----|------|---------|
| H-04-01 | 后端按 `semantic` 分发，拒绝无 semantic 节点 | G-37.1 |
| H-04-02 | 未知原语被拦截（应在编译期） | G-32.2 |
| H-04-03 | 框架不直接建线程（委托 `runtime.createWorker`） | G-41.1 |
| H-04-04 | 引擎代码无 `vue` / `@vue/*` import | G-41.3 |
| H-04-05 | 宿主代码无 IR 字段分支判断 | G-41.2 |

**H-04-04 / H-04-05 是静态可扫描的**，已可纳入 CI（正则匹配 import / `semantic ===`）。

### H-05 热切换（4 项）

| ID | 断言 |
|----|------|
| H-05-01 | 热切换后 `currentBackend` 变更 |
| H-05-02 | 热切换后可重新渲染 |
| H-05-03 | 切回原 Backend 仍正确 |
| H-05-04 | `capabilities.rehydrate` 已声明 |

### H-06 混合渲染（4 项）

| ID | 断言 |
|----|------|
| H-06-01 | 同页面可持有多个 Backend 实例 |
| H-06-02 | `p-canvas` 可指定 `engine`（语义属性） |
| H-06-03 | 降级策略写入 IR（`degradation` 字段） |
| H-06-04 | Dispatcher 单实例支持多后端（方案 B） |

### H-07 能力契约（4 项）

| ID | 断言 |
|----|------|
| H-07-01 | Carrier 声明 `threadAffinity` |
| H-07-02 | JSI 受限、AOT 不受限（G-40） |
| H-07-03 | AOT 跨界成本为 0 |
| H-07-04 | 实时能力仅在 AOT 可用 |

### H-08 错误降级（3 项）

| ID | 断言 |
|----|------|
| H-08-01 | 未知原语抛错，**不静默** |
| H-08-02 | 缺失 `semantic` 时后端拒绝渲染 |
| H-08-03 | `destroy` 后状态为 `destroyed` |

---

## 跳过规则

无能力项必须 SKIP，不得伪装 PASS（对齐 G-27/G-38/G-39/G-40 的诚实原则）：

```
Tier 2/3 宿主（如 TV/Watch）可 SKIP:
  H-06-*  混合渲染（若 Backend 不支持）
  H-07-04 实时能力（若 carrier 为 JSI）
```

**SKIP 必须在报告中显式列出 reason**，不得省略。

---

## CI 集成

```yaml
- name: Host Conformance
  run: |
    node host-reference.cjs
    # 退出码非 0 即阻断
```

**CMP058**：宿主上线前必须 `runConformance().failed === 0`。

---

## 与既有 conformance 的关系

| 层 | 套件 | 项数 |
|----|------|------|
| G-27 渲染后端 | Render Conformance | 42 |
| G-38 编译器 | Compiler Conformance | 42 |
| G-39 宿主运行时 | Runtime Conformance | 42 |
| G-40 执行载体 | Carrier Conformance | 42 |
| **G-41 宿主接入** | **Host Conformance** | **32** |

**G-41 是唯一"跨层"的套件**——它验证的是三方的**组合正确性**，而非单个插槽。
