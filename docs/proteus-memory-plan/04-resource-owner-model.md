# 资源 Owner 模型

> 核心：**所有跨运行时资源创建时必须登记 owner，销毁时由框架自动级联释放。**

---

## Resource 统一接口

```ts
interface Resource {
  id: string
  owner: Page | Component | Session   // 必有所有者
  kind: 'image' | 'bitmap' | 'canvas'
      | 'shader' | 'socket' | 'native-peer' | 'subscription'
  retainers: RefEdge[]                 // 引用边，可构建 retainer 图
  createdAt: number
  createdStack?: string               // 调试模式：创建栈
  dispose(): void                      // 必有显式释放
}

interface RefEdge {
  from: ResourceId
  to: ResourceId
  kind: 'strong' | 'weak' | 'owned'
}
```

页面销毁时，框架遍历 `owner.children`，**级联调用 `dispose()`**。

---

## Owner 层级

```
Session (应用级，如 WebSocket 连接池)
  └─ Page (页面)
       ├─ Component (组件)
       │    └─ Effect (副作用：订阅/Timer/动画)
       ├─ ImageBitmap / Canvas / Shader
       └─ NativePeer (JSI 句柄)
```

- **父子级联**：Page 销毁 → 所有 Component 及 Effect 自动 dispose
- **弱引用例外**：全局缓存用 `WeakRef + 清理机制`，不阻断 GC
- **共享资源**（如 Shader Program 缓存）用**引用计数**，引用归零才真正释放

---

## Disposer 模式（自动释放的关键）

所有注册类 API **返回 disposer**，组件销毁时由框架自动调用：

```ts
// 事件订阅 → 返回 disposer
const off = bus.subscribe('theme', handler)
// 定时器 → 返回 disposer
const stop = useInterval(callback, 1000)
// 资源 → 返回 disposer
const dispose = gl.createBuffer(data)

onCleanup(stop)      // 注册到当前 owner
onCleanup(off)
onCleanup(dispose)
```

**`onCleanup` 是框架注入的**，开发者无需手动配对 `onUnmounted`——Compiler 也能静态校验"注册必有 cleanup"。

---

## Budget：三级内存预算

> 所有预算通过**运行时特征检测**确定，不写死 MB 常量。

```
全局预算 (device tier)
  └─ 页面预算 (per Page)
        └─ 帧预算 (per frame)
```

| 级别 | 约束对象 | 示例策略 |
|------|---------|---------|
| **帧预算** | Path/Gradient/CommandBuffer/临时中间图 | 每帧结束强制释放 |
| **页面预算** | ImageBitmap/Canvas/Shader/Subscription | 页面隐藏时 trim 不可见项 |
| **全局预算** | 图片解码池/Shader 程序缓存/Native Peer 总数 | 内存压力下 trim 可重建项 |

**设备分级**（运行时探测可用内存后确定 tier：low / mid / high），预算随 tier 缩放。

---

## 资源生命周期矩阵

| 资源 | 默认策略 | 页面隐藏 | 页面销毁 | 内存压力 |
|------|---------|---------|---------|---------|
| ImageBitmap | LRU + 降采样 | 保留可见窗口 | trim 至窗口 | 清除不可见 |
| OffscreenCanvas | 帧池复用 | 保留静态缓存 | 释放 | 释放全部临时 |
| Shader/Program | 程序缓存、引用计数 | 保留 | 释放 | 释放可重建项 |
| WebSocket | 页面级 owner | 暂停 | close | close |
| JSI/Native Peer | weak/owner | release UI refs | release native peer | release non-essential |
| Event Subscription | disposer 列表 | 保留必要项 | unsubscribe all | unsubscribe all |

---

## RAII 资源计数

对图片、Canvas、Shader、数据库游标、Socket 使用 **RAII 风格**引用计数：

```ts
class GLBuffer implements Resource {
  private refCount = 1
  retain() { this.refCount++ }
  release() {
    if (--this.refCount === 0) this.gl.deleteBuffer(this.id)
  }
}
```

- 跨层对象附加 `owner / createdStack / lastUsed / releaseReason`（调试模式）
- 开发模式下，**GC 后扫描超过阈值的 native-peer** → 疑似泄漏告警
- 压力测试验证：未使用对象**既不过早回收**（use-after-free），**也不长期残留**

---

## 与现有 plan 对齐

- **Architecture 铁律 #10**：所有跨运行时资源必须登记 owner 并实现 disposer
- **Component**：长列表只保留窗口数据，全量数据交分页仓储
- **App Renderer**：Native Peer 纳入 Resource 体系，dispose = release JSI global ref
- **Glass**：Shader/离屏缓冲归页面预算管辖
- **Performance**：内存预算并入性能预算，真机矩阵扩展 Java/Native/JS/GPU 四堆
- **DevTools**：TraceBus `memory` 域实时上报资源创建/释放/峰值
