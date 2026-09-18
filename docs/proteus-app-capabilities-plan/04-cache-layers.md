# 04 · 缓存分层管理：模型与淘汰策略

## 1. 四层模型

```
L0  内存热层  MemoryCache   —— WeakRef + LRU，进程内，O(1)
L1  内存冷层  InMemoryCold  —— StrongRef 小池，跨组件复用
L2  磁盘层    DiskCache     —— MMKV/IndexedDB/文件，持久化
L3  网络层    Network       —— 首次/过期回源 + ETag/Last-Modified
```

## 2. 读写流程

```
GET key:
  L0 hit?  → 返回 + 提升为热
  L1 hit?  → 返回 + 复制到 L0
  L2 hit?  → 返回 + 反序列化 + 填充 L0
  L3 fetch → 写入 L2 + L0 → 返回

SET key, value:
  写 L0（LRU 检查）
  异步写 L2（不阻塞调用方）
  触发字节预算检查
```

## 3. 字节预算（对接 Memory Plan 的 Budget）

```typescript
interface CacheBudget {
  L0: number  // 内存热层上限（MB）
  L1: number  // 内存冷层上限（MB）
  L2: number  // 磁盘上限（MB）
}

// 设备分级（运行时特征检测，不虚构绝对值）
function detectTier(): 'low' | 'mid' | 'high' {
  const mem = runtime.totalMemory
  if (mem < 2_000) return 'low'   // <2GB
  if (mem < 4_000) return 'mid'   // <4GB
  return 'high'
}

const BUDGETS: Record<Tier, CacheBudget> = {
  low:  { L0: 4,  L1: 2,  L2: 20  },
  mid:  { L0: 8,  L1: 4,  L2: 50  },
  high: { L0: 16, L1: 8,  L2: 100 },
}
```

**原则**：预算由运行时特征检测决定（对齐 Memory Plan「不虚构 MB 红线」）。

## 4. 淘汰策略

| 层 | 触发 | 策略 |
|----|------|------|
| L0 | 满 | **LRU** 淘汰到 L1（保留强引用一小段时间） |
| L1 | 满 | 弱引用回收 / 丢弃（**不写盘，避免主线程阻塞**） |
| L2 | 满 | **TTL + LRU** 组合：先淘汰过期，再淘汰最久未访问 |
| 启动 | L2 超预算 | **异步清理**（不阻塞首帧） |

## 5. 过期与一致性

- **TTL**：`set(key, value, { ttl })`，`get` 时检查过期 → 触发后台刷新（stale-while-revalidate）
- **显式失效**：`cache.delete(key)` / `cache.clear(prefix)`
- **订阅**：`cache.on('evict', (key, reason) => ...)`（对接 Memory Plan 的 LeakRegistry）
- **跨端同步**：可选 `sync: true` → 通过后台推送/广播通知其他端失效（Web ↔ App）

## 6. 各层原生实现

| 层 | iOS | Android | 鸿蒙 | Web | Skyline |
|----|-----|---------|------|-----|---------|
| **L0** | `NSCache` | `LruCache` | `LinkedHashMap` + `SoftReference` | `Map` + `WeakRef` | `Map`（JS 堆） |
| **L2** | 文件/`Codable` | **MMKV** / DataStore | `Preferences`/文件 | IndexedDB | `wx.setStorage`（10MB 上限） |
| **序列化** | `Codable`(二进制) | MMKV(二进制) | protobuf/json | JSON | JSON |

**关键选择**：
- **Android 用 MMKV**（腾讯开源）：性能远超 SharedPreferences，支持跨进程、增量更新、AES 加密 —— 正好对接 Proteus 的"腾讯生态"定位
- **iOS 用 `NSCache`**：自动响应内存警告（`didReceiveMemoryWarning`）→ 自动清空，无需手动
- **Skyline 受 10MB 上限**：大文件（图片/视频）走 `wx.saveFile` 文件系统，不走 storage

## 7. 对接 Memory Plan

- **`Resource` 接口**：缓存条目实现 `Disposable`，Owner Epoch 过期时自动释放
- **LeakRegistry**：缓存条目可被弱引用追踪，检测"已 evict 但仍被业务强引用"的泄漏
- **字节预算**：`Budget.consume('cache:L2', bytes)` → 超预算触发淘汰
- **销毁事务**：页面 `onUnload` → `cache.clearScope(pageId)`（作用域缓存自动清理）

## 8. 冷启动优化（对接 IFR / AOT）

```typescript
// app.config.ts
export default defineApp({
  cache: {
    preheat: ['user:me', 'config:app', 'dict:region'],  // 启动时后台预取
    strategy: 'stale-while-revalidate',
  },
})
```

- **AOT 阶段**：生成预取指令清单
- **首帧后**：`requestIdleCallback` / `queueMicrotask` 触发后台拉取
- **骨架屏期间**：缓存命中 → 骨架秒变真实内容（对接 memorial-skeleton 的 IFR 方案）

## 9. lint 规则

```
CACHE001: 禁止直接使用 wx.setStorage/localStorage.setItem（绕过分层）
CACHE002: 缓存键应带版本前缀（如 v1:user:123），便于整体失效
CACHE003: 大对象（>100KB）应拆分 key，按需失效
CACHE004: 主线程不做大量序列化（交给 Worker / Codable 异步）
CACHE005: 敏感数据（token）必须加密存储（MMKV/AES）
```

## 10. 验收

- [ ] L0 命中率 >95%，读取 <1ms
- [ ] 超预算时异步清理，不阻塞首帧
- [ ] 内存警告（iOS `didReceiveMemoryWarning`）→ L0 自动清空
- [ ] 进程重启后 L2 数据可用（持久化生效）
- [ ] 淘汰后内存回落（LeakRegistry 验证，对接 Memory Plan）
- [ ] 骨架→内容无闪烁（对接 IFR）
- [ ] 大文件（图片）走文件系统，不走 KV（Skyline 10MB 上限）
