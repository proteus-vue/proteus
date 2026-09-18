# G-53 SPI

## 1. 扩展 G-52 的 DeviceProfile

```typescript
interface DeviceProfile {          // G-52 已有
  id: string
  screen: { dp: number; density: number; foldable: boolean }
  os:     { api: number; engine: 'v8'|'jsc'|'hermes'|'ark' }
  input:  { primary: 'touch'|'mouse'|'keyboard'|'pen' }
  env:    { lang: string; tz: string; dark: boolean }
}

interface MobileDeviceProfile extends DeviceProfile {   // ★ G-53 新增
  vendor: 'huawei'|'apple'|'oppo'|'vivo'|'xiaomi'|'honor'|'other'
  share: number                    // 市场份额 0~1，用于覆盖率加权
  supply: DeviceSupply            // 由哪档供给
}

type DeviceSupply =
  | { kind: 'in-memory' }
  | { kind: 'web' }
  | { kind: 'ios-sim', endpoint?: string }     // 无 endpoint = 本机
  | { kind: 'android-emu' }
  | { kind: 'cloud-device', provider: string, deviceId: string }
```

## 2. 等价类（加入权重）

```typescript
interface EquivalenceClass {        // 扩展 G-52
  name: string
  devices: MobileDeviceProfile[]
  weight: number                    // 该类覆盖的市场份额
  representative(): MobileDeviceProfile   // 份额最高者
  coveredShare(): number            // Σ device.share
}
```

**代表选择原则**：取**份额最高**的设备，而非第一个（G-52 原实现取 `devices[0]`，G-53 改为按 share 排序后取首）。

## 3. SimulatorBackend（扩展 G-51 NativeAdapter）

```typescript
interface SimulatorBackend extends NativeAdapter {
  readonly tier: Tier
  readonly endpoint: string | null   // ★ 让模拟器变成"服务"
  readonly available: boolean

  boot(profile: MobileDeviceProfile): Promise<BootResult>
  runIsolated(suite: TestSuite): Promise<Report>
}

type Tier =
  | 'in-memory' | 'web'
  | 'ios-sim' | 'ios-sim-remote'
  | 'android-emu' | 'cloud-device'

interface BootResult {
  status: 'PASS' | 'SKIP'
  handle?: DeviceHandle
  reason?: string          // 'platform-unavailable' | 'endpoint-missing'
}
```

**★ 关键新增：`endpoint`**
让模拟器从"本机窗口"变成"可被远程驱动的服务"，这是解决"买不起机型"的核心。

## 4. 档位能力矩阵

```typescript
interface TierCapability {
  logic: boolean      // 纯逻辑断言
  render: boolean     // 渲染结果验证
  engine: boolean     // 真 JS 引擎行为
  hardware: boolean   // 摄像头/蓝牙/生物识别
  realRom: boolean    // 国产 ROM 深度定制行为
}
```

**诚实映射**：模拟器档 `hardware` 与 `realRom` 恒为 `false`——这不是缺陷，是边界声明。

## 5. 编排器

```typescript
interface VerificationOrchestrator {
  // 按能力需求自动选档，返回最优（或最接近的）后端
  selectTier(suite: TestSuite): { backend: SimulatorBackend; missing: string[] } | null
  execute(suite: TestSuite): Promise<OrchestratorResult>
}

interface OrchestratorResult {
  status: Result
  tier: Tier | null
  missing: string[]     // 缺失能力（DEGRADED 时非空）
  cases: number
  coverage: number      // 0 (SKIP) | 0.5 (DEGRADED) | 1 (完整)
}
```

**选档算法**：
1. 遍历后端（按优先级），找第一个**能力完全满足**的
2. 若都不满足，返回**缺失项最少**的（降级）
3. 若全不可用，返回 `null` → 上层给 `SKIP`

## 6. 覆盖率门槛

```typescript
interface CoverageGate {
  threshold: number                  // 0~1
  weightedShare(classes: EquivalenceClass[]): number   // 上限 1
  evaluate(classes, executed): {
    share: number        // 加权市场份额
    execRate: number     // 非 SKIP 占比
    score: number        // share × execRate
    pass: boolean        // score ≥ threshold
  }
}
```

## 7. 结果枚举（复用 G-51，明确 G-53 语义）

| 值 | G-53 语义 |
|----|-----------|
| `PASS` | 完整执行通过 |
| `FAIL` | 执行了但断言失败 |
| `SKIP` | **平台不可用**，未执行——不视为失败 |
| `DEGRADED` | 能力缺失，部分执行 |
| `TIMEOUT` | 超时（云真机常见） |

**★ 纪律**：平台不可用必须返回 `SKIP`，**严禁** 返回 `FAIL` 或抛异常（G-53.3）。

## 8. 错误码

| 码 | 含义 |
|----|------|
| `PLATFORM_UNAVAILABLE` | 档位不可用（如未装 Xcode） |
| `ENDPOINT_MISSING` | 远程档缺 endpoint |
| `QUOTA_EXCEEDED` | 云真机额度耗尽 → SKIP |
| `COVERAGE_BELOW_GATE` | 覆盖率低于门槛 → 阻断 |
| `TIER_CAPABILITY_MISSING` | 档位能力不足 → DEGRADED |

## 9. 云真机适配（契约，实现待各平台）

```typescript
interface CloudDeviceProvider {
  name: string
  listDevices(): Promise<MobileDeviceProfile[]>
  reserve(profile: MobileDeviceProfile): Promise<DeviceHandle>
  release(handle: DeviceHandle): Promise<void>
  quota(): Promise<{ remaining: number; unit: 'minute'|'credit' }>
}
```

**额度耗尽时返回 `QUOTA_EXCEEDED`** → 编排器降级到下一档或 SKIP，**不阻断 CI**。
