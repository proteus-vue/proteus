# G-44 自动化测试框架 —— 第八次泛化

> **Status: Draft · 2026-09-03 · 决策 #364 整合入库**
> **Slogan: Define once, verify anywhere.**
> 本文件是 Proteus 测试体系的**方法论层**，与 G-27（渲染）、G-39（宿主运行时）、G-40（执行载体）、G-41（接入）、G-42（容器）、G-43（所有权）站在同一抽象层级。

---

## 0. 一句话定位

**G-44 不是"再引入一个测试工具"，而是把"如何验证"本身纳入 Proteus 的可插拔方法论：用统一的测试语义（Test IR）描述"期望什么行为"，通过可插拔的测试后端（TestBackend SPI）在任意执行环境中执行，产出标准化报告。**

测试代码不再绑定具体断言库、运行器或设备——**和渲染、编译、宿主、容器、所有权完全同构**。

---

## 1. 第八次泛化（核心论证）

### 1.1 前七次

| # | 不绑定什么 | 模式 |
|---|-----------|------|
| 1 | 平台 API | 定义语义 + 后端实现 |
| 2 | 渲染引擎 | 定义语义 + 后端实现 |
| 3 | 编译器 | 定义语义 + 后端实现 |
| 4 | 执行载体 | 定义语义 + 后端实现 |
| 5 | 宿主运行时 | 定义语义 + 后端实现 |
| 6 | 容器形态 | 定义语义 + 后端实现 |
| 7 | 所有权/边界资源 | 定义语义 + 后端实现 |
| 8 | **测试实现** | **定义语义（Test IR）+ 后端实现（TestBackend）** |

**同一个模式，第八次。**（原稿称第七次，漏计决策 #341 落地的所有权 G-43——修正）这不是"补一个工具"，而是**方法论的完整性要求**——若"可验证性"本身不可插拔，则前七次泛化的正确性无法被统一验证。

### 1.2 传统测试的根本问题

```
Jest 测 JS，XCTest 测 iOS，JUnit 测 Android，hypium 测鸿蒙
→ 同一行为写三套测试，维护三套，结果不可比
```

更致命的是**测试与被测对象绑死**：

| 传统 | 问题 |
|------|------|
| 断言写在测试代码里 | 换运行器就要重写 |
| 结果由各框架自报 | 格式不一，无法汇总 |
| 跨端靠人肉对齐 | G-27~G-43 七套 conformance 各自为政 |

### 1.3 Proteus 的做法（同构）

```
Test IR（描述"期望什么行为"）
   ↓
TestBackend SPI（可插拔）
   ├── NodeBackend      纯 JS 环境
   ├── JSCarrierBackend  JSI 载体（G-40）
   ├── AOTBackend       AOT 编译后（G-40）
   ├── HostBackend      真实宿主运行时（G-39）
   └── DeviceBackend    模拟器 / 真机（三维断点矩阵）
```

**同一份 Test IR，可在 Node、JSI、AOT、真机、TV 模拟器上跑，报告格式完全一致。**

---

## 2. 核心概念

### 2.1 Test IR

测试用例不是"一段调用被测函数的代码"，而是**一颗可序列化、可传输、可复现的语义树**：

```ts
interface TestIR {
  id: string                  // T-01-001
  target: { layer: 'render' | 'compile' | 'runtime' | 'carrier'
                    | 'integration' | 'ownership' | 'breakpoint' }
  arrange: IRNode             // 被测对象 / 输入（如一段 SFC、一个 IR 树）
  act: ActOp[]               // 操作序列（render / transfer / destroy ...）
  assert: AssertionNode[]    // ★ 断言语义，非代码
  profile?: Profile3D        // W × H × F（G-25）
  backend?: string           // 指定 TestBackend，缺省=全部
}
```

**关键**：`assert` 是 IR 节点（`{ kind: 'eq', path: '$.root.children[0].type', value: 'p-grid' }`），可序列化、可跨进程、可被 DevTools 可视化。

### 2.2 TestBackend SPI

```ts
interface ProteusTestBackend {
  readonly id: string                    // 'node' | 'jsi' | 'aot' | 'host' | 'device'
  readonly capabilities: BackendCaps
  run(ir: TestIR, ctx: TestContext): Promise<TestReport>
  supports(target: TestIR): boolean      // 能否执行该类用例
}
```

### 2.3 TestReporter（统一报告）

```ts
interface TestReport {
  irId: string
  backend: string
  status: 'pass' | 'fail' | 'skip' | 'xfail'
  duration: number
  assertions: { id: string; status: string; actual?: unknown; expected?: unknown }[]
  trace?: TraceNode        // 失败时的执行链，供 DevTools 定位
}
```

**所有后端产出同一结构** → 七套 conformance 首次可被一个 runner 汇总。

---

## 3. 分层测试策略（测试金字塔）

```
         /\         E2E 场景（G-25 W×H×F 全组合）
        /  \        跨层集成（Compiler→Render→Host→Carrier→Container→Ownership）
       /────\       Backend Conformance（各层 SPI）
      /______\      单元（clamp / 所有权转移 / 借用检查）
```

| 层级 | 比例 | 载体 | 来源 |
|------|------|------|------|
| 单元 | 60% | Test IR + NodeBackend | 纯函数 |
| SPI | 25% | 各层 Backend conformance | G-27~G-43 |
| 集成 | 10% | **跨层组合链路** | ★ 新增 |
| E2E | 5% | DeviceBackend + headless | 三维矩阵 |

---

## 4. 跨层集成测试（★ 体系正确性的前提）

**每一层单独 conformance 都过，但从未有人写过端到端链路测试。** G-44 首次定义：

```
Compiler(G-29) ──ir──▶ Render(G-27) ──nodeOps──▶ HostRuntime(G-39)
                                            │
                                      Carrier(G-40)
                                            │
                                     Container(G-42)
                                            │
                                     Ownership(G-43)
```

| 用例 | 验证什么 | 仅在本层可测 |
|------|---------|------------|
| INT-01 | Compiler 产出的 IR 字段，Render Backend 能消费 | ✅ 交界处 |
| INT-02 | AOT 载体下，G-43 所有权检查仍生效 | ✅ 跨 G-40×G-43 |
| INT-03 | Dispatcher 切换引擎时，Owned<T> 跨引擎转移语义 | ✅ 跨 G-41×G-43 |
| INT-04 | Container 销毁页面时，五原子 Drop 释放所有边界资源 | ✅ 跨 G-42×G-43 |
| INT-05 | TV(F=remote) 下焦点引擎可用、触摸被禁用 | ✅ 跨 G-25×G-39 |

---

## 5. 三维断点验证（G-25 首次被自动化）

### 5.1 矩阵

```
W ∈ {320, 600, 840, 1200, 1920}
H ∈ {480, 720, 1080, 1200}
F ∈ {touch, cursor, remote, dial, voice}
→ 5 × 4 × 5 = 100 profiles
```

每个 profile 一个 Test IR（**参数化生成，非手写 100 份**）：

```ts
profiles.flatMap(p => [
  assertResolveProfile(p),           // resolveProfile(W,H,F) 返回正确档位
  assertAdaptiveForm(p),             // <p-adaptive> 渲染为该 F 的原生容器
  assertInputMode(p),                // F=remote → 焦点可用 / 触摸禁用
])
```

### 5.2 无硬件测试策略

| 设备 | 测试方式（不接真硬件） |
|------|----------------------|
| TV | 焦点引擎模拟器：伪造遥控器按键序列，断言焦点移动链 |
| 手表 | 表冠滚动模拟 + 方形视口 headless |
| 车机 | 驾驶状态注入 + 语音指令 stub |
| 鸿蒙 | 分布式软总线 mock：跨设备 Owned 转移（G-43 × G-25） |

---

## 6. 铁律（G-44.1 ~ G-44.6）

| 编号 | 铁律 |
|------|------|
| G-44.1 | 断言必须可序列化为 AssertionNode；禁止把逻辑塞进测试运行器闭包 |
| G-44.2 | 任一 Backend 的 conformance FAIL → 阻断合并 |
| G-44.3 | 跨层集成测试必须 100% 通过（无"暂时跳过"） |
| G-44.4 | 同一份 Test IR 必须在 ≥2 个 Backend 上可执行（可插拔的可验证性） |
| G-44.5 | 性能基准退化 > 5% → 阻断 |
| G-44.6 | 失败报告必须含 trace 链，定位到 IR 节点 + 源码行 |

---

## 7. 与既有体系的关系

| 文档 | 关系 |
|------|------|
| G-25 三维断点 | ★ G-44 是它**首次被自动化验证**的载体 |
| G-27~G-43 | G-44 提供统一 runner，串成"全套验证" |
| G-23 AI Agent | Agent 产物须通过 TestBackend 门禁（AI005） |
| G-43 DevTools 所有权图 | 测试时可注入泄漏场景，断言 DevTools 能检出 |
| 旧 `proteus-test-framework`（Vitest/Playwright） | **降格为本框架的执行层策略**（见 `test-backend-spi.md`） |

---

## 8. 与原则 #0 的同构性

```
能力        语义原语            后端映射
渲染        Render IR        → VueDom/Flutter/Native/Skia
宿主        Runtime IR       → iOS/Android/鸿蒙/Web
测试        ★ Test IR        → Node/JSI/AOT/Host/Device
```

**G-44 是原则 #0（统一语义收敛）在"验证层"的兑现**：把"语义收敛 + 后端实现"推广到测试本身。

---

## 9. 诚实边界

1. **Test IR 不替代所有测试**：DOM 交互、视觉回归仍需 Playwright/screenshot，它们作为 DeviceBackend 的具体实现存在
2. **跨进程 trace 有损耗**：headless 能验证语义，真机才能验证性能，两者结论需分层解读
3. **参数化矩阵爆炸**：100 profiles 采用"等价类 + 边界值"裁剪，非全组合（见 `breakpoint-3d-testing.md`）

---

*规划体系：60 份 plan + 1 哲学 + 1 规约 + 1 官网（G-44 为第 60 份，2026-09-03 整合入库）*
