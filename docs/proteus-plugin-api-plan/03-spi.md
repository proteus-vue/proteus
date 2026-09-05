# G-58 SPI

> **本份新增 4 个类型，其余全部复用。**
> 延续 SPI-First 复利：第 21 次泛化的增量极小。

---

## 1. 新增类型清单

| 类型 | 用途 |
|------|------|
| `PluginManifest` | 插件清单（plugin.toml 的运行时表示） |
| `Capability` | 能力授权单元 |
| `ApiVersionSpec` | API 版本规范（WIT 版本化） |
| `PluginHost` | 插件宿主（编排加载/授权/运行/限额） |

---

## 2. PluginManifest

```typescript
interface PluginManifest {
  id: string                    // 全局唯一，反向域名
  name: string
  version: string
  tier: 0 | 1 | 2               // ★ 声明式 / WASM / 外部进程

  // ---- Tier 1/2 才需要 ----
  wasm?: { path: string; sha256: string }     // Tier 1
  process?: { command: string; args: string[] } // Tier 2

  // ---- API 版本（★ 决定路由到哪个 WIT 版本）----
  api: {
    minVersion: string          // 例如 "0.1.0"
    proposals?: string[]        // 提案 API，仅开发期可用
  }

  // ---- 权限声明（★ 默认零权限）----
  capabilities: Capability[]

  // ---- 贡献点 ----
  contributes: ContributionPoints

  // ---- 资源限额（Tier 1/2）----
  limits?: {
    memoryMB?: number           // 默认 64
    cpuMsPerCall?: number       // 默认 50
    timeoutMs?: number          // 默认 5000
  }
}
```

---

## 3. ContributionPoints（贡献点）

```typescript
interface ContributionPoints {
  // ---- Tier 0：纯数据，零代码 ----
  themes?:        ThemeDef[]
  iconThemes?:    IconThemeDef[]
  snippets?:      Record<string, SnippetFile>
  keybindings?:   KeybindingDef[]
  menus?:         MenuDef[]
  configuration?: ConfigSchema

  // ---- Tier 1/2：需要代码 ----
  commands?:      CommandDef[]
  languages?:     LanguageDef[]
  debuggers?:     DebuggerDef[]
  taskTemplates?: TaskTemplateDef[]

  // ---- ★ Studio 特有（框架语义）----
  panels?:          PanelContribution[]      // G-56 面板
  knowledgeViews?:  KnowledgeViewDef[]       // G-54 六项能力
  assertionSuites?: AssertionSuiteDef[]      // G-54 conformance
}
```

**Tier 0 与 Tier 1/2 的分界线很清晰**：
前者是**数据**，宿主读取后直接应用；后者是**行为**，需要运行时。

> 判断标准：**能不能用 JSON 表达完？**
> 能 → Tier 0，不该写代码。

---

## 4. Capability（能力授权单元）

```typescript
type Capability =
  // 通用
  | { kind: 'readWorkspace' }                 // 读工作区文件（经宿主代理）
  | { kind: 'writeWorkspace'; paths: string[] }
  | { kind: 'network';       hosts: string[] } // ★ 白名单，非任意
  | { kind: 'spawnProcess';  commands: string[] }

  // 框架语义（★ G-54 六项能力对第三方开放）
  | { kind: 'kernel.spiTopology' }
  | { kind: 'kernel.layerRules' }
  | { kind: 'kernel.conformance' }
  | { kind: 'kernel.deviceImpact' }

  // 设备（G-53/54）
  | { kind: 'device.attach';  runtimes: string[] }
  | { kind: 'device.input' }                  // 输入注入，高危

  // 高权限（★ 需显式确认）
  | { kind: 'runExternalProcess' }            // Tier 2 专用
```

### 授权原则

```
默认            = 零权限
清单声明        = 安装时展示给用户
运行时越权      = 拒绝 + 记录，不崩溃
```

**网络能力强制 host 白名单**——禁止 `{ kind: 'network' }` 不带 hosts。
这是直接针对 VSCode"扩展可任意联网"的修正。

---

## 5. ApiVersionSpec（WIT 版本化）

```typescript
interface ApiVersionSpec {
  version: string                    // 语义化版本
  wit: string                        // WIT 接口定义（WASM Component Model）
  stable: boolean                    // false = 提案 API
  supersedes?: string                // 被哪个版本取代
}

interface ApiRouter {
  // 按插件声明的 minVersion 路由到对应 WIT 版本
  resolve(minVersion: string): ApiVersionSpec

  // ★ 提案 API 校验
  validateProposals(proposals: string[]): ProposalCheck
}

type ProposalCheck =
  | { ok: true }
  | { ok: false; reason: 'unknown-proposal' | 'not-stable-for-publish' }
```

### 版本演进规则（学 Zed）

```
v0.1.0  初始稳定 API：基础贡献点 + 主题 + 片段
v0.2.0  面板贡献 + 命令
v0.3.0  kernel.spiTopology / kernel.layerRules
v0.4.0  kernel.conformance + device 能力
（未来按需增版，老版本永不删除）
```

**关键机制**：每个版本一个独立 WIT 文件，
老插件继续用旧版本，**新功能只在新增版本里提供**。

> 这比 "修改现有 API + 保留兼容分支" 干净得多——
> **API 只增不改，是向后兼容的最简实现。**

---

## 6. PluginHost

```typescript
interface PluginHost {
  // 生命周期
  install(manifest: PluginManifest, source: PluginSource): Promise<InstallResult>
  activate(pluginId: string): Promise<ActivationResult>
  suspend(pluginId: string): Promise<void>
  uninstall(pluginId: string): Promise<void>

  // ★ 能力探测：元数据查询，禁用"发请求试探"
  supports(cap: Capability): boolean

  // 运行时
  invoke(pluginId: string, call: PluginCall): Promise<PluginResult>

  // 治理
  getUsage(pluginId: string): ResourceUsage
  killPlugin(pluginId: string, reason: string): Promise<void>

  // ★ 架构试金石：内核 API 面快照
  apiSurface(): string[]
}
```

### ★ `supports()` 为什么必须是元数据查询

**这是 G-54 踩过的坑，本份必须继承教训。**

G-54 初版用"发一个 `payload: null` 的真实请求"来探测能力，
结果在内核里直接崩溃。

> **用有副作用的调用探测能力，本身就是设计错误。**

`supports(cap)` 是**纯元数据查询**，零副作用、零网络、零内核调用。
这条已写成 INV-EX-07 并在参考实现中断言。

---

## 7. PluginResult 语义（延续 G-51）

```typescript
type PluginResult =
  | { status: 'ok';        value: unknown }
  | { status: 'degraded';  value: unknown; reason: string }  // 能力缺失
  | { status: 'skipped';   reason: string }                  // 未启用
  | { status: 'denied';    capability: Capability }          // ★ 越权
  | { status: 'error';     error: PluginError }
```

**`denied` 是本份新增**——它不是错误，是**权限系统的正常输出**。

> 越权被拒 ≠ 插件坏了。宿主应记录并继续运行，不终止插件。
