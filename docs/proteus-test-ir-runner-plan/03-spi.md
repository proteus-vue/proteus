# G-51 SPI 定义

## 1. TestIRRunner

```typescript
interface TestIRRunner {
  execute(suite: TestSuite, opts?: RunOptions): TestReport
}

interface RunOptions {
  defaultTimeout?: number   // 默认 5000ms（现实阈值，非 0）
  adapter?: Backend         // 可注入后端（InMemory / Native）
  stopOnFirstFailure?: boolean
}
```

**设计要点**：`execute` 为**同步**——便于在断言框架和 CI 中直接组合，无需 await 链。真运行时（NativeAdapter）的异步性由适配器内部批处理，对外仍呈现同步报告。

## 2. 数据结构

```typescript
interface TestSuite  { name: string; cases: TestCase[] }
interface TestCase {
  name: string
  // ★ L2 真机适配期的过渡执行描述：以局部闭包近似真机断言，便于在参考后端上
  //   跑通门槛与报告链路；正式断言载体为 G-44 Test IR（G-44.1：可序列化，禁闭包）
  run(adapter: Backend): boolean       // 返回 false = FAIL
  timeout?: number                     // 低于阈值且 slow=true → TIMEOUT
  requireNative?: boolean              // 后端无原生能力 → DEGRADED（不崩溃）
  exhaust?: boolean                    // 配合 adapter.quota → QUOTA_EXCEEDED
  loc?: string                         // 失败定位
}
interface TestReport {
  suite: string
  total: number                        // ★ CMP-134：必须有 total
  passed: number
  failed: number
  skipped: number
  results: TestResult[]
  summary: { total; passed; failed }
}
type TestResultStatus = 'PASS' | 'FAIL' | 'SKIP' | 'DEGRADED' | 'TIMEOUT'
interface TestResult {
  name: string
  status: TestResultStatus
  category?: 'ASSERTION' | 'ISOLATION_BREACH'   // INV-03
  message?: string
  loc?: string
  recoverable?: boolean                            // INV-04
}
```

## 3. Backend 层级

```typescript
interface Backend {
  hasNative: boolean
  quota: number
  consume(): void
}
class InMemoryBackend implements Backend { /* L1 模拟 */ }
class NativeAdapter extends InMemoryBackend {  // L2 真运行时
  hasNative = true
  runIsolated(code: string): { isolated: true; engine: string }
}
```

**L1/L2 通过同一 `Backend` 接口替换**——这就是"不绑定验证执行环境"的落地：用例代码对后端无感知。

## 4. 错误分类（7 种）

| 状态 | 含义 | 是否算 failed |
|------|------|--------------|
| PASS | 通过 | 否 |
| FAIL | 断言/隔离泄漏 | **是** |
| SKIP | 显式跳过 | 否 |
| DEGRADED | 能力缺失，优雅降级 | 否（INV-02） |
| TIMEOUT | 超时 | 是 |

`FAIL` 必带 `category`（ASSERTION / ISOLATION_BREACH）+ `loc`（INV-03）。

## 5. NativeAdapter 契约

```typescript
interface NativeAdapter extends Backend {
  runIsolated(code: string): { isolated: true; engine: string }
  // 未来扩展：
  // spawnIsolatedProcess?(pkg): ProcessHandle    // G-49 L3
  // verifySignature?(pkg, keys): boolean         // G-45/G-50 双签名
}
```

参考实现中 `runIsolated` 仅打点返回 `{ isolated: true, engine: 'EcmaVM-or-V8' }`，**真引擎待各平台实装**。

## 6. 后端矩阵

| 后端 | hasNative | runIsolated | 用途 |
|------|-----------|-------------|------|
| InMemoryBackend | false | — | L1 模拟（默认，DEGRADED 语义验证） |
| NativeAdapter | true | 打点 | L2 契约 + 参考 |
| AndroidNative | true | 真进程 | 待实装（G-49 L3） |
| HarmonyNative | true | EcmaVM | 待实装 |
| iOSNative | true | WKWebView2 | 待实装 |

## 7. 与 G-44 接口对齐（执行模型，消除歧义）

G-44（testing-framework-plan）定义的是**断言语义层**：Test IR（arrange/act/assert）+ AssertionNode，且 G-44.1 明确「断言必须可序列化为 AssertionNode；禁止把逻辑塞进测试运行器闭包」。

因此本包的准确分工是：

- **断言载体 = G-44 Test IR**（可序列化，G-44.1）——本包不引入第二套 IR，也不自行定义断言语义；
- **TestIRRunner 只负责执行环境（L1 InMemory / L2 NativeAdapter）插拔与门槛**——用例代码对后端无感知（原则 #13.52）；
- **`TestCase.run(adapter)` 是 L2 真机适配的过渡执行描述**：在 NativeAdapter 尚为契约 + 打点阶段时，以局部闭包近似「该用例在真机执行环境上的断言」，用于先跑通门槛与报告链路；各平台 NativeAdapter 实装后，用例断言收敛回 G-44 Test IR 的序列化断言，由 runner 调度到对应执行环境执行。
