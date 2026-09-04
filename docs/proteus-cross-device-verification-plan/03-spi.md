# G-52 SPI

## 1. 核心接口

```typescript
interface DeviceMatrixRunner {
  executeOn(matrix: DeviceMatrix, suite: TestSuite): Promise<MatrixReport>
}
```

与 G-51 `TestIRRunner.execute()` 同构 —— G-52 是 G-51 在"设备维度"的推广。

## 2. 数据结构

```typescript
interface DeviceProfile {
  id: string
  screen: { dp: number; density: number; foldable: boolean }
  os:     { api: number; engine: 'v8'|'jsc'|'hermes'|'ark' }
  input:  { primary: 'touch'|'mouse'|'keyboard'|'pen' }
  env:    { lang: string; tz: string; dark: boolean }
}

interface DeviceEquivalenceClass {
  name: string
  devices: DeviceProfile[]
  representative(): DeviceProfile   // 代表采样
  deviation(reports): number        // 类内最大偏差
}

interface DriftFingerprint {
  screen: string; os: string; input: string; env: string
}

interface MatrixReport {
  entries:   { device: string; result: any }[]
  normalized: { [deviceId: string]: number }
  drifts:    { class: string; deviation: number; attribution: 'screen'|'os'|'input'|'env' }[]
}
```

## 3. 归一化规则

| 字段 | 归一化 |
|------|--------|
| screen.dp | 保留，四舍五入 1 位 |
| screen.density | 取整（2.75 → 3） |
| os.engine | 枚举标准化 |
| 数值结果 | toFixed(3) |

## 4. 云端接口（契约，本份不实现）

```typescript
interface ProfileSource {
  listEquivalenceClasses(): Promise<DeviceEquivalenceClass[]>
  reserve(profileId): Promise<DeviceHandle>   // 租用真机
  release(handle): Promise<void>
}
```

## 5. 错误码

- `DRIFT_EXCEEDED`    等价类内偏差 > ε
- `ATTRIBUTION_FAILED` 漂移无法归因到四维
- `PROFILE_UNKNOWN`    未知设备 profile
