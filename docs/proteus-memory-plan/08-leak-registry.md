# 泄漏注册表（Leak Registry）

> 把"对象是否仍被使用"从隐式闭包关系 → **显式 owner + 生命周期状态 + 可查询的引用图**。

---

## 核心数据结构

```ts
class LeakRegistry {
  // owner epoch（HMR/页面重建时递增）
  private epoch = 0

  // 所有已注册资源（调试模式保留强引用用于快照；生产用 WeakRef）
  private resources = new Map<ResourceId, WeakRef<Resource>>

  // 引用边，用于构建 retainer 图
  private edges = new Map<ResourceId, RefEdge[]>()

  // owner → 其下所有资源的反向索引（级联销毁用）
  private ownerIndex = new Map<OwnerId, Set<ResourceId>>()

  register(res: Resource) {
    this.resources.set(res.id, new WeakRef(res))
    this.ownerIndex.getOrAdd(res.owner.id).add(res.id)
  }

  revokeEpoch(oldEpoch: number) {
    // HMR：撤销旧 epoch 的所有 effect
    for (const eff of this.effects) {
      if (eff.ownerEpoch <= oldEpoch) eff.dispose()
    }
  }
}
```

---

## 三种注册方式

### 1. 自动注册（框架内部资源）

`createImageBitmap` / `createGLBuffer` / `createNativePeer` 等**框架 API 自动登记**，开发者无感。

### 2. 声明式注册（开发者资源）

```ts
// 类 VueUse 的 composable 风格
const buffer = useResource(() => gl.createBuffer(data), buf => buf.dispose())
const ws = useWebSocket('/api')   // 内部自动 onCleanup(ws.close)
```

`useResource(factory, disposer)` 把资源和当前 owner 绑定。

### 3. 手动注册（第三方集成）

```ts
const reg = useLeakRegistry()
const cursor = db.query(sql)
reg.onDispose(() => cursor.close())
```

---

## WeakRef + 清理机制

- **全局缓存 / 单例**不得直接持有组件/View 强引用 → 一律 `WeakRef`
- 配套 `FinalizationRegistry` 监听回收，做**遗留资源兜底释放**：

```ts
const cleanup = new FinalizationRegistry((resId: ResourceId) => {
  // JS 对象已被 GC，但 native 侧可能仍持 global ref → 兜底 release
  native.releaseIfHeld(resId)
})
```

- 调试模式下**禁用 WeakRef**（保留强引用），以便抓 retainer 图

---

## Retainer 图（诊断核心）

退出页面 + GC 后，对仍未回收的对象构建 retainer 链：

```
PageA (should be dead)
  ← held by: globalEventBus.listeners[0].ctx
  ← held by: globalEventBus
  ← root: global
```

→ 直接定位"为什么还活着"，输出：
- 引用根（global / singleton / closure）
- 距离（链长度）
- retained size

CI 将 retainer 链报告作为**门禁产物**（详见 `09-diagnostics-ci.md`）。

---

## Owner Epoch 详细机制

见 `03-page-teardown.md`。补充：

```ts
interface Effect {
  id: string
  ownerEpoch: number
  dispose: () => void
  kind: 'subscription' | 'timer' | 'animation' | 'io' | 'native-listener'
}

class EffectRegistry {
  private effects: Effect[] = []

  add(eff: Omit<Effect, 'id'>) {
    this.effects.push({ ...eff, id: uid() })
  }

  revokeBefore(epoch: number) {
    const stale = this.effects.filter(e => e.ownerEpoch < epoch)
    stale.forEach(e => e.dispose())
    this.effects = this.effects.filter(e => e.ownerEpoch >= epoch)
  }
}
```

- **HMR accept** 时：`epoch++` → `revokeBefore(epoch)` 批量撤销旧副作用
- **页面关闭**时：同机制撤销该页所有 effect
- 原生侧持 `ownerEpoch`，陈旧事件**静默丢弃**（不抛异常、不泄漏）

---

## 调试模式 vs 生产模式

| 能力 | 调试 | 生产 |
|------|------|------|
| 强引用保留（可快照） | ✅ | ❌（用 WeakRef） |
| 创建栈记录 | ✅ | ❌ |
| retainer 图构建 | ✅ | ❌（仅计数） |
| 泄漏断言（afterDestroy） | ✅ | ❌（仅 warn） |
| 性能开销 | 较高 | 接近零 |

通过 `import.meta.env.DEV` 或运行时 feature flag 切换。
