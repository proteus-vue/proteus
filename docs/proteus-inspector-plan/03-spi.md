# G-57 SPI

## 1. 核心接口

```typescript
interface InspectorService {
  // L0：通用运行时（始终可用）
  collectL0(): L0Snapshot
  // L1：语义增强（可降级）
  collectL1(): L1Snapshot
  // L2：框架语义（可降级）
  collectL2(): L2Snapshot
  // 统一入口（需鉴权）
  inspect(token?: string): InspectResult
}
```

## 2. 数据结构

```typescript
// L0 —— 裸指标，宿主提供
interface L0Snapshot {
  layer: 'L0'
  metrics: Record<string, number | string | object>
}

// L1 —— 打了框架标签的 L0
interface L1Metric {
  value: number | string | object
  backend: string | null   // 走哪个 SPI 后端
  layer: string | null     // 属于哪一层
  domain: string | null    // 哪个隔离域
  annotated: boolean       // 是否被成功标注
}
interface L1Snapshot {
  layer: 'L1'
  degraded: boolean
  reason?: string          // 'topology-missing'
  coverage?: number        // 0..1
  metrics: Record<string, L1Metric>
}

// L2 —— 框架独占语义
interface L2Snapshot {
  layer: 'L2'
  degraded: boolean
  reason?: string          // 'introspector-missing'
  data: {
    spiBackends: SpiBackend[]
    layerViolations: Violation[]
    isolationDomains: Domain[]
    conformance: ConformanceResult[]
  } | null
}
```

## 3. 服务扩展注册

```typescript
interface ServiceExtensionRegistry {
  register(method: string, handler: ServiceExtensionHandler): string
  call(method: string, params?: object): Promise<any | null>
  has(method: string): boolean
  list(): string[]
}
```

**命名规范（强制）：**

| 规则 | 说明 |
|------|------|
| 前缀 | 必须 `ext.` 开头 |
| 命名空间 | `ext.<package>.<command>`，至少两段 |
| 唯一性 | 重复注册抛错 |
| 调用 | 必须携带 `isolateId` |
| 未注册 | 返回 `null`，**不抛异常** |

## 4. 框架拓扑（L1 的知识源）

```typescript
interface FrameworkTopology {
  backends: Record<string, string>   // symbol -> backendId
  layers:   Record<string, string>   // symbol -> layerId
  domains:  Record<string, string>   // symbol -> domainId
  backendOf(symbol): string | null
  layerOf(symbol): string | null
  domainOf(symbol): string | null
  covers(symbol): boolean            // 能否标注
}
```

**拓扑从哪来？** 框架的 SPI 注册表和分层声明——
这是框架**编译期就知道**的静态知识，运行时直接查表，零开销。

## 5. 错误码

| 码 | 含义 |
|----|------|
| `UNAUTHORIZED` | token 无效 |
| `NOT_AVAILABLE_IN_RELEASE` | Release 构建不提供 |
| `TOPOLOGY_MISSING` | L1 降级原因 |
| `INTROSPECTOR_MISSING` | L2 降级原因 |
| `EXTENSION_ALREADY_REGISTERED` | 重复注册 |
| `INVALID_EXTENSION_NAME` | 命名不合规 |
