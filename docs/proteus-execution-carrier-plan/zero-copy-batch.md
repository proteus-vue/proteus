# G-40-C：零拷贝通道与批处理差分

> 回应两个批评：跨界成本不为零（批评一）、字符串默认拷贝（批评二）。

---

## 第一部分：零拷贝通道契约

### 1. 数据分类与通道选择

| 类别 | 典型数据 | 大小 | 通道 | 拷贝语义 |
|------|---------|------|------|---------|
| **标量** | ID、状态码、布尔 | < 100 B | 常规 JSI | 拷贝（可忽略） |
| **结构化小数据** | 表单、配置项 | < 4 KB | 常规 + 批处理 | 拷贝（可接受） |
| **★ 大块二进制** | 图片、音频 PCM、视频帧 | > 4 KB | **ArrayBuffer** | **零拷贝** |
| **★ 结构化大数据** | IR diff 树、大型列表 | > 4 KB | **ArrayBuffer + 二进制编码** | **零拷贝** |

### 2. 为什么字符串通道不可用

JSI 中 `jsi::String` ↔ `std::string` 的转换**默认是拷贝**：

```cpp
// jsi::String → std::string（拷贝）
std::string s = jsString.utf8(runtime);   // 分配新内存 + 拷贝

// std::string → jsi::String（拷贝）
jsi::String js = jsi::String::createFromUtf8(runtime, s);  // 又一次拷贝
```

**一次往返 = 两次拷贝。** 对于 10MB 的图片数据，这是 20MB 的内存搬运。

**唯一能共享底层字节的通道是 `jsi::ArrayBuffer`：**

```cpp
// ArrayBuffer 可以获取底层指针，实现零拷贝
auto buf = jsArrayBuffer.getPointer(runtime);   // 直接指针，无拷贝
```

### 3. G-40.4 铁律

> **超过 4KB 的数据跨界传输，必须使用 `ArrayBuffer` / `SharedArrayBuffer`，
> 禁止走字符串通道。**

### 4. 接口契约

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

interface ProteusNativeBridge {
  // 标量/小数据（< 4KB）
  invoke<T>(name: string, args: unknown[]): Promise<T>

  // ★ 大块数据（强制零拷贝语义）
  invokeBinary(name: string, buffer: SharedBuffer, meta?: unknown): Promise<SharedBuffer>
}
```

### 5. 实现约束（关键）

| 编号 | 约束 | 理由 |
|------|------|------|
| **CMP047** | `asArrayBuffer()` 不得 `.slice()`，必须返回底层视图 | `.slice()` 就是拷贝，违背零拷贝语义 |
| **CMP048** | 不支持时必须返回 `null`，**禁止静默拷贝** | 静默降级 = 性能谎言 |
| **CMP049** | `isShared: false` 时必须上报指标 | 可观测性要求 |

**CMP048 是最关键的**——如果实现不支持零拷贝却悄悄拷贝，
调用方以为零成本，实际仍在拷贝。这比不支持更糟。

### 6. Capabilities 声明

```typescript
interface ZeroCopyCapabilities {
  zeroCopy: {
    supported: boolean
    mechanism: 'arraybuffer' | 'sharedarraybuffer' | 'native-pointer' | 'none'
    maxSize: number      // 零拷贝上限，超过降级
  }
}
```

不支持零拷贝时：
- Compiler/运行时**必须记录指标**
- 可选降级到拷贝路径（但需显式决策，非静默）

### 7. 各端零拷贝支持

| 端 | 机制 | 上限 | 备注 |
|----|------|------|------|
| iOS (JSC) | ArrayBuffer | 较大 | 可通过 `JSObjectGetArrayBufferBytesPtr` 取指针 |
| Android (Hermes) | ArrayBuffer | 较大 | Hermes 对 ArrayBuffer 有优化 |
| Harmony | ArrayBuffer / native-pointer | 大 | ArkTS 支持 native buffer |
| Web | ArrayBuffer / SharedArrayBuffer | 2GB (SAB) | SAB 需 cross-origin isolation |
| Flutter (dart:ffi) | native-pointer | 无限 | ffi 直接传指针，真零拷贝 |
| AOT | native-pointer | 无限 | 无边界，直接共享内存 |

---

## 第二部分：批处理差分接口

### 8. 现状问题

传统 nodeOps 范式：**一次属性变更一次跨界**

```
setProp(A) → 跨界 → setProp(B) → 跨界 → ... → N 次跨界
```

按 HostObject 路径 181 ns/次计：

| 单帧属性变更数 | 跨界次数 | 纯跨界开销 |
|---------------|---------|-----------|
| 10 | 10 | 1.81 μs |
| 100 | 100 | **18.1 μs** |
| 500 | 500 | **90.5 μs** ← 超过一帧预算（16.7ms 的 0.5%，但仍显著） |

### 9. 批处理化方案

G-27 的 `ProteusRenderBackend` 增加批处理接口：

```typescript
interface ProteusRenderBackend {
  // 现有单节点操作（保留，用于简单场景/调试）
  updateNode(handle: NodeHandle, changes: IRDiff): void

  // ★ 新增：批处理提交（必须实现）
  commitBatch(ops: RenderOp[]): void
}

type RenderOp =
  | { kind: 'create';   node: ComponentIRNode; parent: Handle; at: number }
  | { kind: 'update';   handle: Handle; changes: IRDiff }
  | { kind: 'delete';   handle: Handle }
  | { kind: 'insert';   parent: Handle; child: Handle; at: number }
  | { kind: 'remove';   parent: Handle; child: Handle }
  | { kind: 'setStyle'; handle: Handle; style: StyleIR }
  | { kind: 'setText';  handle: Handle; text: string }
```

**一帧的所有变更聚合为一个 `RenderOp[]`，一次跨界提交。**

### 10. 收益模型

```
旧范式成本 = N × cost_call
新范式成本 = cost_call + cost_serialize(N)

批处理更优的条件：
  N × cost_call > cost_call + cost_serialize(N)
  即 (N-1) × cost_call > cost_serialize(N)
```

若 `cost_serialize` 约为 `0.2 × cost_call per op`（乐观估计）：

| N | 旧范式 | 新范式 | 收益 |
|---|--------|--------|------|
| 5 | 905 ns | 362 ns | 2.5× |
| 10 | 1810 ns | 543 ns | 3.3× |
| 100 | 18100 ns | 3801 ns | 4.8× |
| 500 | 90500 ns | 18181 ns | 5.0× |

> ⚠️ **这是基于假设参数的推算，不是实测结论。**
> `cost_serialize` 的实际值取决于 diff 树大小和序列化实现。
> **M1 必须建立跨界成本基准测试，用真实数据替换此表。**

### 11. G-40.5 铁律

> **所有 RenderBackend 必须实现 `commitBatch`。
> 框架默认走批处理路径，单节点操作仅用于调试/回退。**

### 12. 与 G-27 的关系

这是对 G-27 `ProteusRenderBackend` 的**增量扩展**，不是替换：

```
G-27 原接口（18 + 1 可选方法）
    ↓ 增加
G-40 新增：commitBatch(ops: RenderOp[])
    ↓ 结果
G-27 接口变为 18 + 1 必需（commitBatch）+ 1 可选（applyLayout）
```

**向后兼容**：已有 Backend 若未实现 `commitBatch`，
框架可回退到循环调用单节点操作（但需记录指标并告警）。

### 13. 批处理的额外收益：原子性

除了性能，批处理还带来**原子性**：

```
单节点操作：更新到一半崩溃 → UI 处于中间态（撕裂）
批处理提交：要么全应用，要么全不应用 → UI 始终一致
```

这与 IR diff 的语义天然契合——**diff 本来就是一个原子的变更集**。

---

## 第三部分：组合策略

### 14. 三层降本组合

```
第一层：批处理差分      → 降低跨界频次（N 次 → 1 次）
第二层：零拷贝通道      → 降低单次跨界的数据搬运成本
第三层：AOT 路径        → 消除跨界本身
```

三层可叠加，按场景选择：

| 场景 | 推荐组合 |
|------|---------|
| 常规 UI 更新 | 批处理 |
| 大列表/图片 | 批处理 + 零拷贝 |
| 高频动画 | 批处理 + AOT |
| 实时音频 | AOT + 原生闭环（不走跨界） |
| 首帧渲染 | AOT + 预编译产物 |

### 15. 可观测性（G-40.6）

```typescript
interface CarrierMetrics {
  crossBoundaryCalls: number
  batchCommits: number
  batchedOps: number
  /** 跨界降频比 = batchedOps / (crossBoundaryCalls + batchCommits) */
  reductionRatio: number
  zeroCopyRequests: number
  zeroCopyHits: number
  zeroCopyHitRate: number
  rtJsDrivenViolations: number   // 应恒为 0
}
```

**关键指标**：
- `reductionRatio` —— 批处理有效性，目标 > 10
- `zeroCopyHitRate` —— 零拷贝有效性，目标 > 0.9
- `rtJsDrivenViolations` —— **应恒为 0**，非零即 CI 失败

---

## 16. 诚实边界

| 不承诺 | 说明 |
|--------|------|
| 批处理收益的具体倍数 | 需实测，上表为推算 |
| 零拷贝在所有端可用 | 依赖端能力，不支持时显式降级 |
| 批处理能解决单帧超时 | 若单帧计算本身超时，批处理无济于事 |
| AOT 路径无成本 | 构建时长、动态性损失是真实代价 |

**所有性能数字在 M1 基准测试前，禁止对外宣称。**

---

*G-40-C · 零拷贝通道与批处理差分*
