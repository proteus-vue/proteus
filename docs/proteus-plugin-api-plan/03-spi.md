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

## 3.5 Provider 范式（学 VS Code 的能力插槽）

> 参考 VS Code 的 **Provider 模型**——但只抄"接口形状"，不抄它的运行时信任模型（那部分由 04 的
> capability 模型覆盖）。这是 VS Code 扩展体系里**最值得抄的一块**：它把"宿主问、插件答"
> 变成标准接口，于是同一个插槽可以有多份实现共存、可替换、可 conformance 化。

**与贡献点的区别（别混）**：

| | 贡献点（contributes） | Provider |
|---|---|---|
| 方向 | 插件 → 宿主（push 声明） | 宿主 → 插件（pull 回调） |
| 时机 | 加载时读一次 | 用户触发时按需调用（**懒，且可超时**） |
| 典型 | 菜单项、快捷键、主题 | 格式化、补全、跳转定义 |
| 失败语义 | 声明非法 ⇒ 安装失败 | 单次失败 ⇒ **降级到下一实现**，不杀插件 |

```typescript
// ★ 不新增顶层 SPI 类型（守 G-58「仅 4 类型」）：Provider 是 ContributionPoints 的一个字段，
//   具体实现方法由 Tier 1/2 的运行时导入函数承担（WASM 侧 export，宿主侧 link）。
interface ContributionPoints {
  // ... 既有字段见 §3 ...
  providers?: ProviderDecl[]
}

interface ProviderDecl {
  /** 插槽种类——有限枚举，新增须走 API 版本（见 05） */
  kind: ProviderKind
  /** 同 kind 多份实现的排序；小者优先。相同时按插件 id 字典序（可复现） */
  priority?: number
  /** 触发条件（见 §3.6 when 子句）；缺省 = 总是可被调用 */
  when?: WhenClause
}

type ProviderKind =
  // ---- 编辑器语义插槽（Studio 现有 IPC 通道的插件化出口）----
  | 'documentFormatting'   // format.rs（prettier）→ 返回整篇文本
  | 'completion'           // diag_complete（tsserver）
  | 'hover'                // diag_quickinfo
  | 'definition'           // diag_definition
  | 'reference'            // diag_references
  | 'rename'               // diag_rename
  | 'documentSymbol'       // diag_symbols
  | 'diagnostics'          // diag（tsserver + eslint）
  | 'foldingRange'         // 现由 CodeMirror foldGutter 直接算，尚无通道
  | 'codeAction'           // 尚无通道（未来）
```

**为什么把 Studio 现有 8 条 IPC 通道都归到 Provider**：

这 8 条（`format` / `complete` / `quickinfo` / `definition` / `references` / `rename` / `symbols` /
`diag`）现在都是**宿主内写死的固定命令**，各自独立接线。归一到 Provider 后：

- **G-58.1「内置功能必须走插件 API」**有了具体落点：内置实现 = priority 更小的 Provider
- 可被第三方插件**替换或叠加**（例如 rustfmt 提供 `documentFormatting`，只对 `when: 'editorLangId == rust'` 生效）
- 一次 conformance 覆盖全部实现（同一套断言，内置与插件都要过）

> ★ 这不改变权限模型：Provider 只是"谁来答"，能不能答仍由 `capabilities` 决定
> （`documentFormatting` 需要 `spawnProcess` 或纯计算，取决于实现形态）。

> **诚实边界（必须连同本文一起读）**：§3.5~§3.8 是**范式补充**，`reference-impl.cjs`
> 的自测（104/104）**尚未覆盖** Provider 路由、when 求值、激活事件校验、version 比对这四项。
> 也就是说：这四块的"机制已定义"成立，"已模拟验证"不成立。改造落地时须同步补用例，
> 否则会重复本仓反复踩过的"判据通过 ≠ 功能可用"。

---

## 3.6 when 子句与激活事件（VS Code 的两个必要件）

### when 子句

```typescript
type WhenClause = string   // 例：'editorLangId == rust && !editorHasSelection'
```

用途：菜单可见性（`menus[].when`）、快捷键生效条件（`keybindings[].when`）、Provider 触发条件。

**Studio 现状**：`keybindings.ts` 只有 `ActionScope = 'global' | 'terminal'`——粗到无法表达
"这条快捷键只在 Rust 文件里生效"。插件一旦变多，这个粒度必然不够。

**可用上下文键（首批，须与宿主实现一一对应，不许多造）**：

| key | 取值 |
|---|---|
| `editorLangId` | 当前文档语言 id（同 `languages.json` 的值） |
| `editorHasSelection` | `true` / `false` |
| `editorIsDirty` | `true` / `false` |
| `workspaceRoot` 末段目录名 | 字符串（用于按项目定制） |
| `deviceAttached` | `true` / `false` |

### 激活事件

G-59 禁了 `activationEvents: ["*"]`，但**没给合法枚举** ⇒ 那条禁令目前是空的。本份补齐：

```typescript
type ActivationEvent =
  | 'onStartup'                      // ★ 需在安装页显式提示"启动即加载"，默认不建议
  | `onLanguage:${string}`
  | `onCommand:${string}`
  | `onView:${string}`
  | `workspaceContains:${string}`
```

**校验规则**（安装闸）：空数组或含 `*` ⇒ 拒绝安装；含未登记项 ⇒ 拒绝安装。

---

## 3.7 运行时上下文（★ 不属于 SPI 类型，属 Tier 1/2 的导入函数）

> 这些是**插件代码看到的东西**，不是 manifest 的一部分。因此不计入 G-58「仅 4 类型」的约束。

```typescript
interface ExtensionContext {
  subscriptions: Disposable[]   // 卸载/禁用时按序 dispose——对应 G-59「去激活对称审计」
  globalState: Memento          // 跨 workspace 的键值存储
  workspaceState: Memento       // 本 workspace
  secrets: SecretStorage        // 敏感存储：独立加密区，绝不写进 settings.json
}
```

**`Disposable` 为什么必须有**：G-59 要求"禁用 ≠ 卸载，二者都要得到同样的清理"。没有统一的
dispose 协议，插件注册的 Provider / 命令 / 监听就会在禁用后残留——这正是 VS Code 生态里
"禁用后快捷键还在响应"那类缺陷的来源。

---

## 3.8 文档版本号（修正 Studio 现状的一个具体缺陷）

Studio 现在的"诊断是否过期"用**时间戳比较**（`editedAt > diagAt` / `editedAt > savedAt`，决策 #1417/#1418）：

- 同一毫秒内的两次编辑会漏判（`mtime_us` 用微秒就是为了绕这个，但内存侧仍是毫秒级时钟）
- 时间戳只能回答"谁更晚"，回答不了"回包对应的是第几版文档"

VS Code 的做法更可靠：**文档带单调递增 `version`**，请求携带 version，回包时比对。

```typescript
interface DocumentSnapshot {
  uri: string
  version: number      // ★ 单调递增，每次 docChanged +1（不是时间戳）
  languageId: string
  text: string
}
```

**协议要求**：Provider 的请求必须带 `version`；回包若 `version !== 当前 version` ⇒ **丢弃**，
不按行号映射（行号已失效）。这条比时间戳判定更硬，建议在 Provider 化改造时一并替换。

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
