# G-59 SPI

## 1. L0 激活契约

```typescript
type ActivationEvent =
  | { kind: 'onCommand';     id: string }
  | { kind: 'onLanguage';    id: string }
  | { kind: 'workspaceContains'; glob: string }
  | { kind: 'onStartup' }              // 受预算约束
  // ❌ 不存在 '*'

interface ActivationContract {
  events: ActivationEvent[]
  budget: { perPlugin: number; total: number }
  validate(events: ActivationEvent[]): ContractResult
  estimate(plugins: DeclaredPlugin[]): CostEstimate
}

type ContractResult =
  | { ok: true;  cost: number }
  | { ok: false; reason: 'WILDCARD_FORBIDDEN' | 'OVER_BUDGET' }
```

## 2. L1 版本契约

```typescript
interface ApiVersioning {
  available: string[]                       // 并存的版本
  resolve(declared: string): string | null  // 老版本仍可解析
  breakingRate(from: string, to: string): number
}
```

## 3. L2 数据敏感度（核心）

```typescript
type DataTier = 'public' | 'workspace' | 'credentials' | 'secrets'

interface DataPolicy {
  tierOf(api: string): DataTier             // 未知 API → 'secrets'（保守默认）
  grant(plugin: string, tier: DataTier): void
  permits(plugin: string, api: string): boolean
}
```

**★ `tierOf` 的保守默认**：未登记的 API 一律按 `secrets` 处理。
新 API 不断出现，**白名单追不上，默认保守才追得上**。

## 4. L3 信任契约

```typescript
interface TrustLedger {
  install(plugin: string, codeHash: string): void
  check(plugin: string, currentHash: string): TrustState
  audit(plugin: string, api: string, tier: DataTier): void
}

type TrustState =
  | 'installed'      // 哈希匹配
  | 'reauth-required' // 哈希变化 → 撤销 capability
  | 'unknown'
```

## 5. L4 治理契约

```typescript
interface GovernancePolicy {
  assertBuiltinParity(builtin: Manifest, thirdParty: Manifest): boolean
  deprecate(api: string, replacement: string | null): DeprecationResult
}
```

**`deprecate` 的 replacement 为 null 时必须拒绝**——
直接对应 Webview UI Toolkit 的教训（归档且无替代）。

## 6. 错误码

| 码 | 含义 |
|----|------|
| `WILDCARD_FORBIDDEN` | 声明了 `*`，拒绝加载 |
| `OVER_BUDGET` | 单插件或全局超预算 |
| `TIER_DENIED` | 未授予对应数据敏感度 |
| `REAUTH_REQUIRED` | 代码哈希变化，需重新授权 |
| `DEPRECATE_NO_REPLACEMENT` | 废弃未提供替代方案 |
| `BUILTIN_PARITY_VIOLATION` | 内置插件 capability 超额 |

## 7. 与 G-58 的接口关系

G-58 的 `CapabilitySet` **保留**，但判定逻辑升级：

```
G-58: permits(plugin, api) = capabilities.has(api)
G-59: permits(plugin, api) = grantedTiers.has(tierOf(api))
```

前者按 API 列举（追不上），后者按数据分级（收敛）。
