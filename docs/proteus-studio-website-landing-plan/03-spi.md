# G-60 SPI

## 1. 文档版本注册表

```typescript
type VersionStatus = 'active' | 'maintenance' | 'deprecated' | 'archived'

interface VersionMeta {
  id: string
  status: VersionStatus
  released: string
  eol?: string
}

interface VersionRegistry {
  resolve(alias: string): string | null      // 'latest' → '0.4'；未知 → null
  statusOf(v: string): VersionStatus
  shouldIndex(v: string): boolean            // deprecated/archived → false
  bannerFor(v: string, page: string): Banner | null
  retentionCandidates(): string[]            // 超出 keepActive 的 archived 候选
}
```

### `resolve` 语义（★ 关键）

| 输入 | 输出 | 说明 |
|------|------|------|
| `'latest'` | 当前 active 版本 id | 别名 |
| `'0.4'` | `'0.4'` | 已存在版本原样返回 |
| `'9.9'` | **`null`** | **未知版本返回 null，不猜测、不静默降级** |

> **为什么不静默降级到 latest？**
> 用户点的是旧链接，静默跳到新版会让他**以为看的就是他要的版本**，
> 然后按新版 API 写代码，跑在旧版上报错。
> 正确做法：**明确 404 + 提供版本选择**，与 G-51 的 `SKIP ≠ PASS` 同源。

## 2. 版本横幅

```typescript
interface Banner {
  level: 'info' | 'warning' | 'archived'
  version: string
  status: VersionStatus
  eol?: string
  linkToLatest: string    // 最新版等价页深链
}
```

`linkToLatest` 必须是**等价页**（同一 path，切到 latest 版本），
不是首页——P2.3 明确要求"direct link to the equivalent current page"。

## 3. 导航树与断链

```typescript
interface DocPage {
  path: string          // 'guide/install'
  title: string
  links: string[]       // 页内所有内部链接
  shared?: boolean      // 是否来自 /shared
}

interface DocTree {
  routes(): string[]
  brokenLinks(): BrokenLink[]
}

interface BrokenLink {
  from: string
  to: string
  reason: 'missing' | 'empty'
}
```

**断链是官网最常见的腐烂形式**——页面改名了，引用它的十个地方没改。
这个必须**机器检测**，不能靠人记得。

## 4. API 规格（插件 API 文档的数据源）

```typescript
interface ApiParam {
  name: string
  type: string
  required: boolean
  description?: string
}

interface ApiEntry {
  name: string           // 'ext.proteus.spi.backends'
  since: string          // '0.4'  ← WIT 版本并存
  tier: 0 | 1 | 2        // G-58 三层插件形态
  capability?: string    // 所需 capability
  params: ApiParam[]
  returns: string
  description?: string
}

interface ApiSpec {
  version: string
  entries: ApiEntry[]
  hash(): string          // 内容哈希，用于漂移检测
}

interface GeneratedDoc {
  sourceHash: string      // 生成时记录的 spec.hash()
  pages: DocPage[]
}
```

## 5. 漂移检测

```typescript
interface DriftResult {
  status: 'fresh' | 'stale'
  expected?: string
  actual?: string
}

function checkDrift(spec: ApiSpec, doc: GeneratedDoc): DriftResult
```

**`stale` 必须阻断 CI**，不是警告。理由见 G-59 对"警告会被忽略"的论证：
> 警告会被忽略——作者为求功能可靠，理性地选 `activationEvents: *`。
> 个体理性导致集体劣化，只有硬拒绝能把成本内部化。

## 6. 规格差异

```typescript
interface SpecChange {
  name: string
  kind: 'added' | 'removed' | 'changed'
  breaking: boolean
  detail: string
}

interface SpecDiff {
  added: string[]
  removed: string[]
  changed: SpecChange[]
  breaking: SpecChange[]      // ← CI 阻断判据
}

function diffSpecs(oldSpec: ApiSpec, newSpec: ApiSpec): SpecDiff
function lintSpec(spec: ApiSpec): LintIssue[]   // 缺描述/缺必填说明 → issue
```

### 破坏性判定表

| 变更 | kind | breaking |
|------|------|----------|
| 新增 API | added | 否 |
| 移除 API | removed | **是** |
| 新增必填参数 | changed | **是** |
| 新增可选参数 | changed | 否 |
| 返回类型收窄 | changed | **是** |
| 返回类型放宽 | changed | 否 |
| 仅改描述 | changed | 否 |

## 7. 下载矩阵

```typescript
interface Artifact {
  target: 'linux' | 'windows' | 'darwin'
  arch: 'x86_64' | 'aarch64' | 'i686' | 'armv7'
  version: string
  url: string
  signature: string        // 必填，缺失即拒绝
  releaseNotes: string
}

interface DownloadMatrix {
  pick(target: string, arch: string): Artifact | null
}

function updaterEndpoint(tpl: string, v: string, target: string, arch: string): string
// 'https://x.dev/{{target}}/{{arch}}/{{current_version}}' → 变量替换
```

**`pick` 未命中返回 `null`，不猜测、不降级到近似平台**。
理由与 `resolve` 相同：**错误的下载比没有下载更危险**——
用户装上跑不起来的包，会归咎于产品质量。

## 8. 错误码

| 码 | 含义 |
|----|------|
| `DOC_DRIFT` | 文档与 spec 不一致 |
| `SPEC_BREAKING` | 检测到破坏性变更 |
| `SPEC_LINT` | spec 质量问题（缺描述等） |
| `VERSION_UNKNOWN` | 未知版本 |
| `ARTIFACT_NOT_FOUND` | 无匹配产物 |
| `ARTIFACT_UNSIGNED` | 产物缺签名 |
| `LINK_BROKEN` | 内部断链 |
