# TestBackend SPI —— 可插拔测试后端

> 配套：`G-44-testing-framework.md` §2.2

---

## 1. 接口

```ts
interface BackendCaps {
  carrier?: 'node' | 'jsi' | 'aot'            // G-40
  runtime?: 'ios' | 'android' | 'harmony' | 'web'
  formFactors: FormFactor[]                    // G-25
  hasRealDevice: boolean
  supportsLeakDetection: boolean
}

interface TestContext {
  profile?: Profile3D
  carrier?: string
  timeout: number
  trace: boolean
}

interface ProteusTestBackend {
  readonly id: string
  readonly capabilities: BackendCaps
  supports(target: TestIR): boolean
  run(ir: TestIR, ctx: TestContext): Promise<TestReport>
}
```

---

## 2. 官方后端

| Backend | 执行环境 | 适用 | 实现要点 |
|---------|---------|------|---------|
| **NodeBackend** | node:test | 单元 / SPI / 集成 | 默认，零依赖 |
| **JSCarrierBackend** | JSI 运行时 | G-40 载体测试 | 通过 G-39 HostRuntime 驱动 |
| **AOTBackend** | 编译后原生 | G-40 AOT 路径 | 验证语义等价（与 Node 结果比对） |
| **HostBackend** | 真实宿主 | G-39/G-41 | iOS/Android/鸿蒙 |
| **DeviceBackend** | 模拟器/真机 | E2E / 三维矩阵 | 无硬件用模拟器（见 §5） |

---

## 3. 执行层策略（旧框架的归属）

**旧 `proteus-test-framework`（Vitest/Playwright/automator）降格为 DeviceBackend 的具体实现**：

| 旧层 | 新归属 |
|------|--------|
| L1 单元（Vitest） | **NodeBackend** 的默认运行器 |
| L2 编译快照（jest-snapshot） | NodeBackend + `assert: 'match'` |
| L3 组件（happy-dom + @vue/test-utils） | NodeBackend 的 DOM 模拟 |
| L4 Web E2E（Playwright） | **DeviceBackend('web')** |
| L4 小程序 E2E（automator） | DeviceBackend('mp') |

**铁律**：DeviceBackend 负责"端专属分叉"，Test IR 与断言保持端无关。

---

## 4. conformance runner（统一汇总）

```ts
class ConformanceRunner {
  constructor(private backends: ProteusTestBackend[]) {}
  async runSuite(suite: TestIR[]): Promise<SuiteReport> {
    const reports: TestReport[][] = await Promise.all(
      this.backends.map(b => this.runOn(suite, b))
    )
    return new SuiteReporter().merge(reports)  // 标准化汇总
  }
}
```

**效果**：渲染(G-27) + 编译(G-29/38) + 宿主运行时(G-39) + 执行载体(G-40) + 接入(G-41) + 容器(G-42) + 所有权(G-43) = **七套 conformance 首次可由一个 runner 产出一份报告**。

---

## 5. 无硬件策略

| 设备 | 模拟方式 | 断言内容 |
|------|---------|---------|
| TV(F=remote) | 焦点引擎 stub + 按键序列注入 | 焦点移动链正确 |
| 手表(F=dial) | 方形视口(390×390) + 表冠事件 | 单列 + 并发症区域 |
| 车机(F=voice) | 驾驶状态注入 + TTS stub | driving-safe 降级 |
| 鸿蒙 | 软总线 mock（多"设备"同进程） | 跨设备 Owned 转移 |

**原则**：语义正确性可在 headless 验证；性能/真机交互须 HostBackend，结论分层解读。

---

## 6. 失败报告（trace）

```ts
interface TraceNode {
  layer: string
  op: ActOp
  state?: unknown
  children?: TraceNode[]
}
```

失败时必须回链到：**IR 节点 id + 源码行号 + 各 Backend 差异**（若跨 Backend 结果不一致，这是高价值 bug 信号）。

---

*接口定义见此文件。矩阵用例见 `breakpoint-3d-testing.md`，CI 编排见 `ci-pipeline.md`。*
