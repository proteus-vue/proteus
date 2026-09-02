# G-40-A：执行载体 SPI 规范

> 定义"执行环境"这个插槽的接口契约。与 G-27（渲染）、G-38（编译）、G-39（宿主运行时）同形。

---

## 1. 接口总览

```typescript
/**
 * 执行载体 SPI
 * 任何能执行 Proteus 逻辑产物的环境，实现此接口即可作为执行载体
 */
interface ProteusExecutionCarrier {
  readonly id: string          // 'jsi-hermes' | 'jsi-jsc' | 'aot-llvm' | 'wasm' | ...
  readonly capabilities: CarrierCapabilities

  // === 生命周期 ===
  initialize(config: CarrierConfig): Promise<void>
  dispose(): void

  // === 产物装载 ===
  load(artifact: CompiledArtifact): ModuleHandle
  unload(handle: ModuleHandle): void

  // === 执行 ===
  invoke(handle: ModuleHandle, exportName: string, args: unknown[]): unknown
  invokeAsync(handle: ModuleHandle, exportName: string, args: unknown[]): Promise<unknown>

  // === ★ 批处理（降低跨界成本）===
  invokeBatch(ops: CarrierOp[]): CarrierResult[]

  // === ★ 零拷贝通道 ===
  allocShared(size: number): SharedBuffer | null   // null = 不支持零拷贝
  invokeBinary(handle: ModuleHandle, exportName: string, buf: SharedBuffer): SharedBuffer | null

  // === 并发 ===
  createWorker?(entry: ModuleHandle): WorkerHandle | null
  postWorker?(worker: WorkerHandle, msg: unknown): void
  terminateWorker?(worker: WorkerHandle): void

  // === 可观测（G-40.6）===
  getMetrics(): CarrierMetrics
}
```

---

## 2. Capabilities 声明

```typescript
interface CarrierCapabilities {
  /** 跨界成本画像（ns/次，实测值，非估算） */
  costProfile: {
    scalarCall: number        // 标量调用单次成本
    objectProperty: number    // HostObject 属性访问单次成本
    measured: boolean         // ★ 是否为实测值（false 时禁止对外宣称）
  }

  /** 零拷贝能力 */
  zeroCopy: {
    supported: boolean
    mechanism: 'arraybuffer' | 'sharedarraybuffer' | 'native-pointer' | 'none'
    maxSize: number           // 零拷贝上限（bytes），超过降级
  }

  /** 并发能力 ★ 批评三的核心 */
  concurrency: {
    /** 是否支持真并发（多线程访问共享状态） */
    trueConcurrency: boolean
    /** Runtime 是否有线程亲和性限制 */
    threadAffinity: boolean
    /** 是否支持 Worker */
    workers: boolean
    /** 最大 Worker 数 */
    maxWorkers: number
  }

  /** 实时能力 ★ G-40.3 相关 */
  realtime: {
    /** 能否承载实时循环（音频/传感器/游戏） */
    capable: boolean
    /** 实时线程优先级支持 */
    realtimePriority: boolean
  }

  /** 动态性 */
  dynamism: {
    hotReload: boolean        // 热更新
    eval: boolean             // 动态求值
    dynamicImport: boolean    // 动态导入
  }

  /** 支持的产物类型 */
  artifactTypes: ('js-bundle' | 'bytecode' | 'aot-native' | 'wasm')[]

  /** Tier 等级（对应 G-30） */
  tier: 1 | 2 | 3 | 4
}
```

### 关键字段说明

**`costProfile.measured`**——这是诚实的强制项。
未实测的成本数据**禁止对外宣称**（CMP046）。避免把工程推算当性能承诺。

**`concurrency.threadAffinity`**——直接对应批评三。
JSI 载体此项必为 `true`，AOT 载体为 `false`。
**框架根据此字段决定实时能力是否能走 JS 驱动路径**（G-40.3 机器检查依据）。

---

## 3. 三条参考路径的 Capabilities

### 3.1 JSI（默认）

```typescript
const jsiHermes: CarrierCapabilities = {
  costProfile: { scalarCall: 27, objectProperty: 181, measured: true },
  zeroCopy: { supported: true, mechanism: 'arraybuffer', maxSize: 64 * 1024 * 1024 },
  concurrency: { trueConcurrency: false, threadAffinity: true, workers: true, maxWorkers: 4 },
  realtime: { capable: false, realtimePriority: false },  // ★ 批评三
  dynamism: { hotReload: true, eval: true, dynamicImport: true },
  artifactTypes: ['js-bundle', 'bytecode'],
  tier: 1
}
```

### 3.2 AOT（原生）

```typescript
const aotNative: CarrierCapabilities = {
  costProfile: { scalarCall: 0, objectProperty: 0, measured: true },  // 无边界
  zeroCopy: { supported: true, mechanism: 'native-pointer', maxSize: Infinity },
  concurrency: { trueConcurrency: true, threadAffinity: false, workers: true, maxWorkers: 32 },
  realtime: { capable: true, realtimePriority: true },   // ★ 批评三的解
  dynamism: { hotReload: false, eval: false, dynamicImport: false },
  artifactTypes: ['aot-native'],
  tier: 1
}
```

### 3.3 WASM

```typescript
const wasm: CarrierCapabilities = {
  costProfile: { scalarCall: 10, objectProperty: 12, measured: false },  // 待实测
  zeroCopy: { supported: true, mechanism: 'arraybuffer', maxSize: 2 * 1024 * 1024 * 1024 },
  concurrency: { trueConcurrency: false, threadAffinity: false, workers: true, maxWorkers: 8 },
  realtime: { capable: false, realtimePriority: false },
  dynamism: { hotReload: true, eval: false, dynamicImport: true },
  artifactTypes: ['wasm'],
  tier: 2
}
```

---

## 4. 批处理接口（G-40.5）

```typescript
type CarrierOp =
  | { kind: 'load';    artifact: CompiledArtifact; ref: string }
  | { kind: 'invoke';  handle: Handle; exportName: string; args: unknown[] }
  | { kind: 'read';    handle: Handle; prop: string }
  | { kind: 'write';   handle: Handle; prop: string; value: unknown }
  | { kind: 'binary';  handle: Handle; exportName: string; bufRef: string }

interface CarrierResult {
  ok: boolean
  value?: unknown
  error?: { code: string; message: string }
}

/**
 * 批处理提交：一次跨界执行多个操作
 * 这是降低跨界成本的核心接口
 */
invokeBatch(ops: CarrierOp[]): CarrierResult[]
```

### 收益模型

```
旧范式：N 次操作 = N 次跨界
新范式：N 次操作 = 1 次跨界 + 1 次批量序列化

平衡点：N × cost_call  >  cost_call + cost_serialize(N)
```

当 N > 5 时批处理几乎总是更优（具体阈值需实测）。

---

## 5. 零拷贝通道（G-40.4）

```typescript
interface SharedBuffer {
  readonly byteLength: number
  /** 获取底层字节视图 —— 实现必须保证零拷贝语义 */
  asArrayBuffer(): ArrayBuffer
  /** 释放（引用计数） */
  release(): void
  /** 是否被底层实现真正共享（false = 降级为拷贝） */
  readonly isShared: boolean
}

/**
 * 分配共享缓冲区
 * @returns null 表示不支持零拷贝，调用方必须降级
 */
allocShared(size: number): SharedBuffer | null
```

### 实现约束

| 约束 | 说明 |
|------|------|
| **CMP047** | `asArrayBuffer()` 不得 `.slice()`，必须返回底层视图 |
| **CMP048** | 不支持时必须返回 `null`，**禁止静默拷贝** |
| **CMP049** | `isShared: false` 时必须上报指标（G-40.6） |

**CMP048 是关键**——静默降级为零拷贝会让调用方以为零成本，
实际仍在拷贝，这是"性能谎言"的源头。

---

## 6. 可观测性（G-40.6）

```typescript
interface CarrierMetrics {
  /** 跨界调用次数 */
  crossBoundaryCalls: number
  /** 批处理提交次数 */
  batchCommits: number
  /** 批处理包含的操作总数 */
  batchedOps: number
  /** 跨界降频比 = batchedOps / (crossBoundaryCalls + batchCommits) */
  reductionRatio: number
  /** 零拷贝请求次数 / 命中次数 */
  zeroCopyRequests: number
  zeroCopyHits: number
  /** 零拷贝命中率 */
  zeroCopyHitRate: number
  /** 实时能力是否走了 JS 驱动（违规计数，应恒为 0）*/
  rtJsDrivenViolations: number
}
```

**`rtJsDrivenViolations` 应恒为 0**——任何非零值都是 G-40.3 违规，
CI 应直接判失败。

---

## 7. 与 G-39 的关系

```
ProteusHostRuntime (G-39)
    │
    ├── createEngine(config) → JSEngine
    │        ↑
    │        这里返回的应该是一个 ProteusExecutionCarrier
    │        （G-39 接口需微调：返回类型从 JSEngine → ExecutionCarrier）
    │
    ├── createWorker(script) → WorkerHandle
    │        ↑
    │        复用 Carrier 的 createWorker
    │
    └── registerNativeHandler / invokeNative
             ↑
             零拷贝通道在此实现
```

### 对 G-39 的修正建议

G-39 中 `createEngine(config): JSEngine` 的返回类型**应改为**：

```typescript
// G-39 原定义（需修正）
createEngine(config: EngineConfig): JSEngine

// G-40 建议修正为
createEngine(config: CarrierConfig): ProteusExecutionCarrier
```

**理由**：`JSEngine` 这个类型和命名**隐含了"一定是 JS 引擎"**，
与 G-40 的载体抽象矛盾。改为 `ProteusExecutionCarrier` 后，
AOT / WASM 载体才能合法接入。

这是一处**必要的前向兼容修正**，需在 G-39 修订时同步。

---

## 8. 编号与避让

| 项 | 编号 | 避让检查 |
|----|------|---------|
| 铁律 | G-40.1 – G-40.6 | 避让 G-39.1-6 ✓ |
| 补充规则 | CMP044 – CMP050 | 避让 G-39 CMP035-043 ✓ |

---

*G-40-A · 执行载体 SPI*
