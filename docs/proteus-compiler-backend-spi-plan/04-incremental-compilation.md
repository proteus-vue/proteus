# G-38 增量编译协议

> 增量编译是**编译后端独有的核心价值**（渲染后端无此概念）。本文定义 `IncrementalSession` 的完整协议。

## 1. 为什么需要增量编译

全量构建：parse + transform + emit **全部文件**。
增量构建：仅重算**变更文件 + 受影响的反向依赖**。

```
中型项目：1000 个源文件
修改 1 个 → 全量 30s / 增量 < 1s
```

## 2. 核心接口

```typescript
interface IncrementalSession {
  readonly id: string

  // 变更通知
  invalidate(file: string): void
  invalidateAll(): void

  // 重算（返回差分 IR）
  recompute(): IRModuleDiff

  // 依赖查询
  getDependencies(file: string): string[]
  getDependents(file: string): string[]

  // 持久化
  commit(): void
  rollback(): void

  // 状态
  getStats(): SessionStats
  dispose(): void
}
```

## 3. 文件依赖图

```
         App.sfc
        /       \
   Header.sfc   Cart.sfc
                    |
              ProductCard.sfc
```

`invalidate('ProductCard.sfc')` → 反向依赖追踪 → 重算 `Cart.sfc` + `App.sfc`，**其余 997 个文件不动**。

## 4. 签名缓存

```
cacheKey(file) = hash(source) + hash(backendVersion) + hash(transformOptions)
```

- 缓存命中 → 跳过 parse + transform，直接复用 IR
- 签名变化 → 进入重算队列

## 5. 生命周期

```
createIncrementalSession(cacheDir)
        │
        ▼
  ┌────────────┐     invalidate(F)     ┌────────────┐
  │  Initial   │ ──────────────────────▶ │  Dirty     │
  └────────────┘                        └────┬───────┘
                                              │ recompute()
                                              ▼
                                       ┌────────────┐
                                       │  Recomputing│
                                       └────┬───────┘
                                            │ diff
                                            ▼
                                       ┌────────────┐   commit()   ┌──────────┐
                                       │  Updated   │ ────────────▶ │ Committed │
                                       └────────────┘              └──────────┘
                                            │ rollback()
                                            ▼
                                       ┌────────────┐
                                       │  RolledBack │
                                       └────────────┘
```

## 6. `IRModuleDiff` 结构

```typescript
interface IRModuleDiff {
  readonly changed: ComponentIRNode[]   // 变更节点
  readonly removed: string[]           // 移除节点 id
  readonly added: ComponentIRNode[]    // 新增节点
  readonly affectedFiles: string[]     // 受影响文件（用于 emit 增量）
}
```

下游 G-37 RenderBackend 可直接消费此 diff 做**局部 DOM 更新**（避免整树重渲染）。

## 7. 冲突解决

| 场景 | 处理 |
|------|------|
| 同一文件被 invalidate 两次 | 合并为一次重算 |
| 依赖环 | 报告诊断，不无限循环 |
| 缓存文件损坏 | 自动失效，全量重算该文件 |
| 会话过期（backend 升级） | `backendVersion` 变化 → 全量失效 |

## 8. 与 G-29 的协同

G-29「编译器可插拔」承诺**增量替换**：parse / transform / emit 可独立换后端。

增量会话的**缓存层**也必须可移植：

```
Node 后端建立的缓存 → Rust 后端应能复用（同源 hash）
```

这要求 `getCacheKey` 算法**跨后端一致**（写入 `Compiler IR 标准`），否则切换后端会触发全量重建，违背增量语义。

## 9. Conformance 关联（C-06）

| ID | 断言 |
|----|------|
| C-06-01 | 首次全量构建建立依赖图 |
| C-06-02 | 修改单文件 → 仅重算该文件 + 反向依赖 |
| C-06-03 | 缓存命中跳过 parse + transform |
| C-06-04 | `invalidate` → `recompute` 返回正确 diff |
| C-06-05 | `commit / rollback` 语义正确 |

## 10. 实现参考

### Node 后端

```typescript
class NodeIncrementalSession implements IncrementalSession {
  private depGraph = new Map<string, Set<string>>()
  private cache = new Map<string, IRNode>()
  private dirty = new Set<string>()

  invalidate(file: string) { this.dirty.add(file) }

  recompute(): IRModuleDiff {
    const queue = [...this.dirty]
    const affected = new Set<string>()

    // 反向依赖传播
    while (queue.length) {
      const f = queue.shift()!
      affected.add(f)
      for (const [file, deps] of this.depGraph) {
        if (deps.has(f) && !affected.has(file)) queue.push(file)
      }
    }

    const changed: IRNode[] = []
    for (const f of affected) {
      const key = this.getCacheKey(f)
      if (this.cache.has(key)) continue  // 命中
      changed.push(this.transformFile(f))
    }

    this.dirty.clear()
    return { changed, removed: [], added: [], affectedFiles: [...affected] }
  }

  commit() { /* 持久化到 cacheDir */ }
  rollback() { /* 恢复上一快照 */ }
}
```

### Rust 后端

- 依赖图用 `petgraph`
- 并行重算：`rayon::par_iter`
- 缓存：`sled` / `rocksdb`
- **关键**：与 Node 后端产出语义等价（C-04-05, C-09-02）

## 11. 可观测性

```typescript
interface SessionStats {
  filesTotal: number
  filesChanged: number
  cacheHits: number
  cacheMisses: number
  recomputeMs: number
  emitMs: number
}
```

指标：`compiler_incremental_cache_hit_ratio`、`compiler_recompute_duration_seconds`。
