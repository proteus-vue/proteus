# G-45-E3：SPI 接口冻结 + NAT-C Conformance 套件

> 与 G-37（RenderBackend SPI）/ G-38（CompilerBackend SPI）/ G-39（HostRuntime SPI）同形设计：接口冻结 → conformance 强制 → 实现指南。

---

## 1. ProteusDevHost SPI（基座侧，~14 方法）

```ts
/** G-45.1：基座只实现此接口 + 装载协议，禁止静态依赖任何具体插件 */
interface ProteusDevHost {
  /* ---- 模块生命周期 ---- */
  loadModule(mod: DynamicBackendModule): Promise<LoadReport>
  unloadModule(id: string): Promise<boolean>
  listBackends(): BackendRecord[]
  capabilityOf(capability: string): CapabilityRecord | null

  /* ---- 转发桩（编译器为业务生成） ---- */
  createStub(capability: string, method: string): ForwardingStub
  registerFallback(capability: string, impl: DegradedImpl): void

  /* ---- 推送通道（B3，模拟器中为函数注入） ---- */
  connectDevServer(opts: { url: string; token: string }): Promise<Channel>
  onPush(handler: (mod: DynamicBackendModule) => Promise<LoadReport>): void

  /* ---- 可观测（G-36 TraceBus 同源） ---- */
  getMetrics(): HostMetrics
  on(event: DevHostEvent, cb: (payload: any) => void): void
}

interface LoadReport {
  id: string | null
  version: string | null
  ok: boolean
  reason: 'G45_MANIFEST_INCOMPLETE' | 'G45_SIGN' | 'G45_CONFORMANCE_COVERAGE'
        | 'G45_CONFORMANCE_FAIL' | 'G45_FACTORY_THROWN' | null
  conformance: { name: string; pass: boolean }[]
  replayed: number          // 本次装载回放的 pending 调用数
}

interface HostMetrics {
  loadedModules: number; rejectedModules: number; upgrades: number; unloads: number
  replayedTotal: number; fallbacks: number; pendingNow: number; pendingPeak: number
  baseRebuildCount: number   // ★ 恒为 0（动态路径），>0 即违规（CMP086 关联检查）
  events: number
}
```

## 2. DynamicBackendModule 契约（插件侧）

```ts
interface DynamicBackendModule {
  manifest: {
    id: string                    // 插件唯一 id（如 'scanner'）
    version: string               // semver（热升级比较用）
    capabilities: string[]        // 声明的能力集（G-28 capability 语义，必须诚实——G-37.3 同源）
    signature: string             // 签名（G-42 网关同源；CMP084）
    minHostVersion?: string       // 基座最低版本要求
    priority?: number             // 同能力多插件时的 Adapter Registry 优先级（复用 G-28 registry 语义）
  }
  /** 语义快检用例：每能力 ≥1（CMP087）；Test IR 形态（G-44），可序列化可跨端 */
  conformance: ConformanceCase[]
  /** 工厂：返回 G-28 NativeBackend SPI 实现 */
  factory(env: { host: ProteusDevHost }): NativeBackend
}
```

## 3. NAT-C Conformance 套件（装载门禁 + CI 双用）

> 第八套 conformance（沿 G-44 计数：RND/H/C/CMP 系之后）。**同一套用例两个用途**：① 设备端装载快检（秒级，只跑本模块）；② CI 全量门禁（插件仓库每次提交跑全套）。

| 编号 | 名称 | 断言 |
|------|------|------|
| NAT-C-01 | manifest 完整 | id/version/capabilities 齐备（CMP084） |
| NAT-C-02 | 签名有效 | 签名校验通过（CMP084） |
| NAT-C-03 | 覆盖率充分 | conformance 用例数 ≥ capabilities 数（CMP087） |
| NAT-C-04 | shape 契约 | 每能力返回值 shape 与声明一致（CMP085，CMP074 思想） |
| NAT-C-05 | 错误语义 | 失败路径返回 CapError 而非抛同步异常（G-32.3 同源） |
| NAT-C-06 | 超时语义 | 异步调用有超时上限且可取消（G-39.5 同源） |
| NAT-C-07 | 资源释放 | unload 后无残留句柄（G-43 所有权图 0 孤儿） |
| NAT-C-08 | 热升级无感 | vN → vN+1 切换期间 pending 调用全部回放成功（C-03/C-06） |

## 4. 推送协议（B3 定义，此处冻结语义）

```
dev server → 设备：{ type: 'module-push', manifest, bundle: ArrayBuffer, signature }
设备 → dev server：{ type: 'load-report', ...LoadReport }   // 秒级回传，CLI 可见
语义：push 不重启 JS 上下文；装载失败不污染能力注册表（C-05 机器证明）
安全：通道必须 TLS + token；bundle 必须签名（CMP088 审计日志）
```

## 5. 实现指南（B4/B5 摘要）

- **Android**：`DexClassLoader(dexPath, optimizedDirectory, librarySearchPath, parent)` 装载插件 DEX；`System.load()` 装载插件 .so；manifest 校验 + 签名（SHA-256 with RSA）；conformance 用例在设备端 JSEngine 执行
- **iOS**：插件构建为动态 framework target 并入 dev shell（增量编译 + 重签）；conformance 用例随 bundle 内嵌执行；诚实标注 Tier B
- **鸿蒙**：HSP 动态共享包 + `dynamicPluginManager`（若基础库版本支持）或 Stage 模型 ability 级动态化
