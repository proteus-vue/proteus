# G-51 架构：TestIRRunner 与三层验证

## 1. 三层验证体系

```
L0  文档自检     selfcheck.js        结构完整性（G-50 已有）
L1  IR 模拟      TestIRRunner       不依赖原生后端，验证 IR 语义
L2  真运行时     NativeAdapters     真进程 / 真引擎 / 真签名
```

**三阶梯度（文档 → 模拟 → 真机）**：每一阶门槛递增，前一阶是后一阶的回归测试。

- **任何一层都不可替代**：文档自检只证明"写了"；模拟证明 IR 语义但对真隔离无能为力；真机才能验证 G-49 进程级隔离真的生效。

## 2. 核心接口

```typescript
interface TestIRRunner {
  execute(suite: TestSuite, opts?: RunOptions): TestReport   // 同步，便于组合
}
interface TestSuite  { name: string; cases: TestCase[] }
interface TestCase   { name: string; run(adapter): boolean; timeout?: number; requireNative?: boolean; exhaust?: boolean; loc?: string }
interface TestReport { suite; total; passed; failed; skipped; results[]; summary }
```

就一个方法 `execute`。G-51 的全部工作围绕它：TestSuite/TestCase/TestReport 结构（复用 G-44）、NativeAdapter 契约、三阶梯度、门槛机制。

## 3. NativeAdapter 矩阵

| 平台 | 真运行时后端 | 隔离机制 | G-49 对应 |
|------|-------------|---------|----------|
| Android | `android:process` + WebView 独立数据目录 | 独立进程 | L3 |
| HarmonyOS | `ArkRuntime` / `EcmaVM` 多实例 | VM 实例隔离 | L3 |
| iOS | WKWebView2 + WebContent 进程 | 系统级（诚实边界） | L3（语义等价，机制不同 / CMP-117） |

`NativeAdapter extends InMemoryBackend`：`hasNative=true`，提供 `runIsolated(code)` 钩子。

## 4. 八条不变量（与 conformance.md INV-01~08 一致）

```
INV-01  同一 TestSuite 在 L1/L2 结果可比
INV-02  能力缺失 → 降级(DEGRADED) ≠ 崩溃        ← G-46 RSC-01 精神贯穿测试基础设施
INV-03  FAIL 必有 category + loc
INV-04  超时 / 资源超限可恢复（recoverable）
INV-05  真运行时隔离泄漏可检测（G-49 ISOLATION_BREACH）
INV-06  报告可序列化、可 diff（CI 门槛）
INV-07  Runner 自身有回归（runner-regression.gold）
INV-08  接缝切换 + 隔离检测 组合命题（= G-47 INV-05 ∧ G-51 INV-05，见 conformance.md §4）
```

## 5. 门槛机制（梯度）

```
模拟(L1) 覆盖率 100% → 真机(L2) 覆盖率逐步提升
L2 不要求一步到位：先跑通 G-49 sandbox 子集，再扩到 G-46/47/48/50
任何 L2 失败 → 先降级(DEGRADED) 报告，不阻塞 L1 回归
```

## 6. 与既有体系关系

| | G-44 Test IR | G-51 |
|--|--|--|
| 关注 | IR 结构与协议 | 执行引擎 + 真运行时验证 |
| 关系 | G-44 ⊂ G-51 | **扩展，不重写** |

G-51 不重写 G-44，只在它上面加执行层。断言载体始终是 G-44 Test IR（可序列化，G-44.1 禁闭包）；`TestCase.run(adapter)` 为 L2 真机适配期的过渡执行描述。是否扩展 G-44 的 IR 协议，由 G-51 实施期结论决定——**不擅自改动既有体系**。

## 7. 诚实边界

- G-51 ≠ 完整 Conformance 框架（G-44 才是），只是**可运行的种子 + 真验证入口**
- NativeAdapter 是契约 + 参考实现，真进程/引擎/签名待各平台实装
- 不承诺真机能跑通所有 G-46/47/48/50 用例——门槛机制就是为此
