# G-55 SPI

## 1. HostAdapter（宿主适配器）

```typescript
interface HostAdapter {
  readonly id: 'vscode' | 'zed' | 'neovim' | 'cli' | 'web'
  readonly tier: number                    // 能力档位，越高越强
  supports(cap: Capability): boolean       // 元数据查询，不做副作用
  translate(protocol: string, msg: unknown): Envelope   // 只翻译
}
```

**铁律 G-55.2：适配器只做翻译，零业务逻辑。**
违反后果：每换一个 IDE 就行为分歧。

## 2. KnowledgeProvider（内核，唯一实现）

```typescript
interface KnowledgeProvider {
  indexAll(): number                       // 全量索引，返回 touched
  indexIncremental(changed: string[]): number
  semanticGoto(symbol: string): GotoResult
  layeringCheck(): Violation[]
  dependencyGraph(): { nodes, edges, cycles }
  deviceImpact(changed: string[]): ImpactResult
  renderPreview(backends: string[]): PreviewResult
  metrics(): Metrics
}
```

该接口一经发布即**冻结**（G-55.5）。新增宿主适配器不得改动此接口。

## 3. 宿主选型

```typescript
function pickAdapter(adapters: HostAdapter[], cap: Capability): PickResult
// → { status:'OK', adapter } | { status:'SKIP', reason }
// 关键：无适配器支持时返回 SKIP，不抛异常、不返回 FAIL
```

## 4. 性能预算

```typescript
interface PerfBudget {
  coldIndexMaxRatio: number      // 全量索引 O(N)，不允许超线性
  incrementalMaxTouched: number  // 单文件改动受影响上限
  gotoRecomputeAfterCache: number // 缓存命中后必须为 0
  cacheMaxEntries: number
  minHitRate: number
}
```

**★ G-55.6：性能断言必须确定性。**
用**操作计数**（touched / recompute / hitRate）判定，
不用墙钟时间。墙钟仅作观测，超阈值只 `warn` 不阻断 CI——
否则必然 flaky。

## 5. 错误码

- `ADAPTER_UNAVAILABLE` → SKIP
- `BUDGET_EXCEEDED`     → 阻断（确定性计数超预算）
- `KERNEL_API_CHANGED`  → 阻断（架构试金石失败）
