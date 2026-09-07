# G-54 SPI

## 1. 能力内核（唯一，IDE 无关）

```typescript
interface FrameworkKnowledgeProvider {
  // ① IR 结构 → 语义导航
  resolveCall(site: CallSite): ResolvedTarget | null

  // ② 分层规则 → 越层诊断
  checkLayering(from: Layer, to: Layer): LayeringVerdict

  // ③ 断言 → 内联定位
  locateAssertion(id: string): CodeLocation | null

  // ④ SPI 拓扑 → 依赖图 + 循环检测
  buildGraph(): SpiGraph            // { nodes, edges, cycles[] }

  // ⑤ 设备等价类 → 影响面
  affectedDevices(spiId: string): DeviceClass[]

  // ⑥ 渲染语义 → 多形态预览
  previewVariants(nodeId: string): Variant[]
}
```

**六个方法，全部是纯查询**——无副作用、无 IO，因此可在任意 IDE 内同步调用。

## 2. 协议层

```typescript
interface ProtocolAdapter {
  readonly id: 'lsp' | 'dap' | 'rpc' | 'cli' | 'raw'
  readonly priority: number
  isAvailable(): boolean
  dispatch(req: ToolRequest): ToolResponse | SKIP
}
```

**返回值语义（沿用 G-51 Result 枚举）**：

| 值 | 含义 |
|----|------|
| `ToolResponse` | 成功 |
| `SKIP` | 该协议不支持此能力 → **降级，不算失败** |
| `DEGRADED` | 能力受限但可用 |

## 3. 请求/响应

```typescript
interface ToolRequest {
  capability: CapabilityId     // 六项之一
  payload: unknown
}

interface ToolResponse {
  adapter: string
  data: unknown
  degraded?: boolean
}
```

## 4. 适配器注册表

```typescript
class AdapterRegistry {
  register(a: ProtocolAdapter): void
  pick(cap: CapabilityId): ProtocolAdapter   // 按 priority 选首个可用
  dispatch(req: ToolRequest): ToolResponse   // 全不可用 → raw
}
```

**`pick` 全不可用时不抛异常，返回 `raw` 适配器**（内核直调）。

## 5. 错误码

| 码 | 场景 |
|----|------|
| `CAP_UNKNOWN` | 未知能力 → SKIP |
| `CAP_UNSUPPORTED` | 协议不支持 → 降级 |
| `GRAPH_CYCLE` | 依赖图存在环（**可检测，非崩溃**） |
| `LAYER_VIOLATION` | 越层调用 |
| `TARGET_NOT_FOUND` | 导航目标不存在 → null（非错误） |

## 6. 后端矩阵

| 适配器 | 平台 | 优先级 |
|--------|------|--------|
| LSP | 全 IDE | 10 |
| RPC | 框架自研面板 | 20 |
| DAP | 调试场景 | 30 |
| CLI | 无 IDE / CI | 40 |
| raw | 兜底 | 99 |
