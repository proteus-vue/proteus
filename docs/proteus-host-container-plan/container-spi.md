# HostContainer SPI 接口定义

> **定位**: G-42 接口规范
> **同形性**: 与 G-27 RenderBackend / G-39 HostRuntime / G-40 Carrier 共用同一套设计语言

---

## 1. 核心接口

```typescript
/**
 * Proteus 宿主容器 SPI
 * 位于 HostRuntime(G-39) 之上，管理页面组织与生命周期
 */
interface ProteusHostContainer {
  // === 身份与能力 ===
  readonly id: string                    // 'stack' | 'superapp' | 'miniprogram' | ...
  readonly version: string
  readonly capabilities: ContainerCapabilities

  // === 生命周期 ===
  initialize(ctx: ContainerContext): Promise<void>
  dispose(): void

  // === 页面管理 ===
  createPage(config: PageConfig): PageHandle
  mountPage(handle: PageHandle): Promise<void>
  unmountPage(handle: PageHandle): Promise<void>
  destroyPage(handle: PageHandle): Promise<DestroyReport>

  // === 页面栈（StackContainer 核心） ===
  push(config: PageConfig): Promise<PageHandle>
  pop(): Promise<PageHandle | null>
  getCurrent(): PageHandle | null
  getStackDepth(): number

  // === 业务沙箱（SuperAppContainer 核心） ===
  createSandbox(bizId: string, manifest: BizManifest): Promise<BusinessSandbox>
  destroySandbox(bizId: string): Promise<DestroyReport>
  listSandboxes(): readonly BusinessSandbox[]

  // === 资源治理 ===
  readonly quota: QuotaManager
  onMemoryPressure(cb: (level: PressureLevel) => void): void

  // === 事件 ===
  on(event: ContainerEvent, handler: (payload: any) => void): void
}
```

---

## 2. 能力声明

```typescript
interface ContainerCapabilities {
  readonly pageStack: boolean          // 支持页面栈
  readonly multiBusiness: boolean      // 支持多业务沙箱
  readonly crashIsolation: 1 | 2 | 3 | 0   // 0=无，1-3=三级
  readonly resourceQuota: boolean      // 支持资源配额
  readonly keepAlive: boolean          // 支持 keep-alive
  readonly windowManagement: boolean   // 支持多窗口
  readonly embedded: boolean           // 支持嵌入式
}
```

**六种容器的能力画像**：

| 容器 | pageStack | multiBusiness | crashIsolation | quota | keepAlive |
|------|-----------|---------------|----------------|-------|-----------|
| SinglePage | ❌ | ❌ | 0 | ❌ | ❌ |
| Stack | ✅ | ❌ | 0 | 弱 | ✅ |
| **SuperApp** | ✅ | ✅ | **2** | ✅ | ✅ |
| MiniProgram | ✅ | ✅ | 1 | ✅ | ✅ |
| Window | ✅ | ❌ | 0 | 弱 | ✅ |
| Embedded | ❌ | ❌ | 0 | ❌ | ❌ |

---

## 3. 页面句柄

```typescript
interface PageHandle {
  readonly pageId: string
  readonly irId: string                 // IR 实例 ID（唯一真相）
  readonly state: PageState
  readonly mountPoint: unknown | null   // Backend 提供的原生挂载点
  readonly resourcePool: ResourcePool   // 框架代管资源
  readonly eventRegistry: EventRegistry
}

type PageState =
  | 'created' | 'mounted' | 'hidden'
  | 'destroyed' | 'crashed'
```

---

## 4. 框架代管资源池（G-42.3 核心）

```typescript
interface ResourcePool {
  // 定时器（业务用 pageContext.timer，不裸用 setTimeout）
  timer(fn: () => void, ms: number, opts?: TimerOptions): TimerHandle
  interval(fn: () => void, ms: number): TimerHandle

  // 事件监听
  on(target: EventTarget, type: string, fn: Function): UnbindFn
  bus(topic: string, fn: Function): UnbindFn

  // 网络（可取消）
  fetch(url: string, init?: RequestInit): CancellablePromise<Response>

  // 订阅
  subscribe(store: any, fn: Function): UnbindFn

  // 统一释放
  releaseAll(): ReleaseReport
}
```

**页面销毁时 `resourcePool.releaseAll()` 自动执行**——业务无需手动清理。

---

## 5. 销毁报告（G-42.2 五原子）

```typescript
interface DestroyReport {
  readonly pageId: string
  readonly steps: readonly DestroyStep[]   // 必须为 5 步
  readonly leaked: readonly LeakItem[]
  readonly reclaimedBytes: number
  readonly durationMs: number
}

type DestroyStep =
  | 'unmount'            // ① 卸载 Backend 挂载点
  | 'unbindEvents'       // ② 解绑事件/手势
  | 'releaseResources'   // ③ 清定时器/订阅
  | 'destroyIR'          // ④ 销毁 IR 实例
  | 'releaseQuota'       // ⑤ 归还内存配额
```

**铁律 G-42.2**：`steps.length !== 5` → 抛错，不允许部分执行。

---

## 6. 配额管理

```typescript
interface QuotaManager {
  request(bytes: number): QuotaHandle | null   // 超限返回 null
  release(handle: QuotaHandle): void
  readonly usage: QuotaUsage
  readonly pressure: PressureLevel
}

type PressureLevel = 'normal' | 'warning' | 'critical'

interface QuotaUsage {
  readonly usedBytes: number
  readonly limitBytes: number
  readonly pageCount: number
  readonly sandboxCount: number
}
```

---

## 7. 容器策略配置

```typescript
interface StackPolicy {
  maxDepth: number                 // 默认 10
  overflowStrategy: 'destroy-oldest' | 'reject' | 'flatten'
  keepAlive: {
    maxCount: number               // 默认 3
    memoryBudgetBytes: number      // 默认 64MB
  }
}

interface SuperAppPolicy extends StackPolicy {
  sandbox: {
    defaultMemoryBytes: number     // 默认 128MB
    maxSandboxes: number           // 默认 8
  }
  crash: {
    isolationLevel: 1 | 2 | 3
    autoRestart: boolean
    maxRestartCount: number
  }
  security: {
    requireSignature: boolean
    capabilityWhitelist: readonly string[]
  }
}
```

---

## 8. 与 G-39 HostRuntime 的边界

| 能力 | HostRuntime (G-39) | HostContainer (G-42) |
|------|-------------------|---------------------|
| 线程 / 事件循环 | ✅ **拥有** | 调用 |
| 执行载体 | ✅ **提供** | 使用 |
| 原生桥 | ✅ **拥有** | 调用 |
| 页面栈 | ❌ | ✅ **拥有** |
| 业务沙箱 | ❌ | ✅ **拥有** |
| 资源配额 | 提供底层能力 | ✅ **策略与治理** |
| IR / Diff | ❌ 禁止 | ❌ 禁止（只管生命周期时机） |

**容器调用运行时，运行时不感知容器。**
