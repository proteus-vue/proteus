// tests/doc-type-refs.test.ts
// ★★★#1124：**文档类型引用**的判据（用户点名："自定义签名没有单独说明，比如 UploadSpec、
//   AbortSignalLike，参数表/属性表里用到了，但没有详细说明，开发者会很懵"）
//
// 【要证明什么（四件）】
//   ① **四个来源都收**：参数类型 / **参数对象的属性类型** / 返回值类型 / 页级属性方法
//      ★第二条最容易漏——参数表里渲染了 `upload: UploadSpec`，但收集时没看属性层 ⇒ 无说明段；
//   ② **悬空检查不假红**：本仓的四种说明形态（`**\`X\`**` / `### \`X\`` / `#### \`X\` 的方法` / `### X`）
//      都要被认作"已解释"（首版只认前两种 ⇒ 19 个本来有说明的页面被判红）；
//   ③ **内置类型不算**：`Promise` / `Uint8Array` / `AbortSignal` 等不需要本项目解释；
//   ④ **门禁真的接上**：`gen-content --check` 在出现悬空引用时**非 0 退出**
//      （本轮逐层假红排查证明：只有"内容变少"这类缺陷没法靠 drift 比对发现）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

type Iface = { props: Array<{ name: string; type: string; optional?: boolean; doc?: string }>; methods: Array<{ name: string; sig: string; doc?: string }>; doc?: string }

async function lib() {
  return (await import('../website/scripts/lib/type-refs.mjs')) as unknown as {
    collectPageTypeRefs: (p: Record<string, unknown>) => string[]
    findUnexplainedTypes: (md: string, ifaces: Record<string, Iface>) => string[]
    findUnregisteredTypes: (md: string, exported: Set<string>, ifaces: Record<string, Iface>) => string[]
    TS_BUILTINS: Set<string>
  }
}

/** 造一个最小接口表（模拟 real：FetchConfig.upload → UploadSpec）。 */
function table(): Record<string, Iface> {
  return {
    FetchConfig: {
      doc: 'useFetch 配置',
      props: [
        { name: 'url', type: 'string' },
        { name: 'upload', type: 'UploadSpec' },
        { name: 'signal', type: 'AbortSignalLike' },
      ],
      methods: [],
    },
    UploadSpec: {
      doc: '流式上传规格',
      props: [{ name: 'path', type: 'string' }, { name: 'boundary', type: 'string' }],
      methods: [],
    },
    AbortSignalLike: {
      doc: '最小取消信号契约',
      props: [{ name: 'aborted', type: 'boolean' }],
      methods: [],
    },
    FetchResult: {
      doc: '结果联合类型',
      props: [{ name: 'ok', type: 'boolean' }],
      methods: [],
    },
  }
}

describe('★#1124 类型引用收集 · 四个来源', () => {
  it('★参数类型 + 返回值类型', async () => {
    const { collectPageTypeRefs } = await lib()
    const got = collectPageTypeRefs({
      sigLine: 'useFetch<T = unknown>(url: string, config?: FetchConfig): Promise<FetchResult<T>>',
      ifaces: table(),
    })
    expect(got, '★参数类型未收').toContain('FetchConfig')
    expect(got, '★返回值类型未收').toContain('FetchResult')
  })

  it('★★参数对象的**属性**类型也要收（这一层最容易漏）', async () => {
    const { collectPageTypeRefs } = await lib()
    const got = collectPageTypeRefs({
      sigLine: 'useFetch<T = unknown>(url: string, config?: FetchConfig): Promise<FetchResult<T>>',
      ifaces: table(),
    })
    expect(got, '★property 层的 UploadSpec 未收 ⇒ 页面上引用了但无说明段').toContain('UploadSpec')
    expect(got, '★property 层的 AbortSignalLike 未收').toContain('AbortSignalLike')
  })

  it('页级属性/方法签名也收', async () => {
    const { collectPageTypeRefs } = await lib()
    const got = collectPageTypeRefs({
      ifaces: table(),
      allMethods: [{ sig: 'connect(): Promise<UploadSpec>' }],
      allProps: [{ type: 'AbortSignalLike' }],
    })
    expect(got).toContain('UploadSpec')
    expect(got).toContain('AbortSignalLike')
  })

  it('内置类型不返回（Promise / Uint8Array / AbortSignal 不该被要求解释）', async () => {
    const { collectPageTypeRefs } = await lib()
    const got = collectPageTypeRefs({ sigLine: 'f(x: Promise<Uint8Array>): AbortSignal', ifaces: table() })
    expect(got).toEqual([])
  })
})

describe('★#1124 悬空引用检查 · 不假红也不漏', () => {
  it('★引用了但没说明 ⇒ 报缺失', async () => {
    const { findUnexplainedTypes } = await lib()
    const md = ['## 参数', '', '| `config` | `FetchConfig` | 否 | — |'].join('\n')
    expect(findUnexplainedTypes(md, table())).toContain('FetchConfig')
  })

  it('★四种说明形态都认（首版只认两种 ⇒ 19 页假红）', async () => {
    const { findUnexplainedTypes } = await lib()
    const forms = [
      '**`UploadSpec`** — 流式上传规格',
      '### `UploadSpec`',
      '#### `UploadSpec` 的方法',
      '### UploadSpec',
    ]
    for (const form of forms) {
      const md = ['| `u` | `UploadSpec` | 否 | — |', '', form].join('\n')
      expect(findUnexplainedTypes(md, table()), `形态未被认作"已解释"：${form}`).toEqual([])
    }
  })

  it('内置类型出现在反引号里不算悬空', async () => {
    const { findUnexplainedTypes } = await lib()
    const md = '| `data` | `Uint8Array` | 否 | 裸字节 |\n| `s` | `AbortSignal` | 否 | 原生 |'
    expect(findUnexplainedTypes(md, table())).toEqual([])
  })

  it('ifaces 里没有的名字不管（不是本项目的类型）', async () => {
    const { findUnexplainedTypes } = await lib()
    const md = '| `x` | `SomethingExternal` | 否 | — |'
    expect(findUnexplainedTypes(md, table())).toEqual([])
  })
})

describe('★★#1133 第 5 个引用来源：结果的属性类型', () => {
  it('★FetchOk.meta?: FetchMeta ⇒ 必须被收进 refs（否则页面报"未解释的类型"）', async () => {
    const ifaces = {
      FetchOk: { props: [{ name: 'ok', type: 'true', optional: false, doc: '' }, { name: 'meta', type: 'FetchMeta', optional: true, doc: '' }], methods: [] },
      FetchMeta: { props: [{ name: 'totalMs', type: 'number', optional: false, doc: '' }], methods: [] },
    }
    const names = (await lib()).collectPageTypeRefs({
      sigLine: 'useFetch<T>(url: string, config?: FetchConfig): Promise<FetchResult<T>>',
      ifaces,
      allMethods: [],
      allProps: [],
    })
    // ★FetchOk 是联合别名 FetchResult<T> 的成功支 ⇒ 按命名约定展开后必须看到 FetchMeta
    expect(names, '★结果属性类型未收集 ⇒ 页面会出现未解释类型').toContain('FetchMeta')
  })

  it('返回值没有 *Result ⇒ 不多收（避免把无关接口拖进页面）', async () => {
    const ifaces = {
      Something: { props: [{ name: 'x', type: 'Other', optional: false, doc: '' }], methods: [] },
      Other: { props: [], methods: [] },
    }
    const names = (await lib()).collectPageTypeRefs({ sigLine: 'doIt(): Promise<void>', ifaces })
    expect(names).toEqual([])
  })
})

describe('★#1124 门禁接线（生成器真的会判红）', () => {
  const GEN = 'website/scripts/gen-content.mjs'

  it('★★生成器必须用 collectPageTypeRefs（不是旧的 collectRefTypes）', () => {
    const s = read(GEN)
    expect(s, '★生成器未用四来源收集 ⇒ 属性层的类型仍会漏').toMatch(/collectPageTypeRefs\(\{\s*sigLine/)
    // 不能再退回旧形态（只收 method/prop 签名）
    expect(s.includes('collectRefTypes([...allMethods.map((m) => m.sig), ...allProps.map((p) => p.type)], ifaces)')).toBe(false)
  })

  it('★★悬空检查必须真的会失败（非 0 退出）', () => {
    const s = read(GEN)
    expect(s, '缺 findUnexplainedTypes 调用').toMatch(/findUnexplainedTypes\(/)
    // 必须并入 collapsed 通路（该通路在 check 模式 exit 1）
    const idx = s.indexOf('findUnexplainedTypes(')
    const seg = s.slice(Math.max(0, idx - 400), idx + 400)
    expect(seg, '★悬空结果没有进入 collapsed ⇒ 门禁不会红').toMatch(/collapsed\.push/)
    expect(s, '★collapsed 通路必须 exit 1').toMatch(/collapsed\.length[\s\S]{0,600}process\.exit\(1\)/)
  })

  it('接口解析支持 readonly（否则 AbortSignalLike.aborted 这类属性整行丢失）', () => {
    // ★#1161：抽取器已移到 lib/type-shapes.mjs（gen-content 过 1000 行棘轮）
    const s = read('website/scripts/lib/type-shapes.mjs')
    expect(s, '★属性正则不支持 readonly').toMatch(/\(\?:readonly\\s\+\)\?/)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ★★★#1161：**数据源漏登记**判据（用户实测："官网 `FetchCacheMode` 还是没有单独说明，
//   上次不是做了门禁吗？"——上次的门禁确实在，但它只检查 `ifaces` 里**已有**的类型，
//   而该类型所在的源文件根本没登记 ⇒ 集合外的形态永远不被检查。这是"门禁只覆盖已知集合"的经典盲区。）
// ══════════════════════════════════════════════════════════════════════════════
describe('★★★#1161 生成器数据源覆盖（`FetchCacheMode` 长期无说明的根因）', () => {
  const GEN = 'website/scripts/gen-content.mjs'
  it('★★★`capability-fetch-cache.ts` 必须在生成器源集合里', () => {
    // 该文件定义 FetchCacheMode / FetchCacheStatus / FetchCacheMeta（缓存三件套）。
    // 不登记 ⇒ 三者不进 ifaces ⇒ findUnexplainedTypes 的 `if (!ifaces[n]) continue` 静默跳过它们。
    const s = read(GEN)
    // ★不能写 `\[([\s\S]*?)\]`——列表项里有 `'a', 'b'` 这种引号内容，非贪婪会提前在第一个 `]`
    //   之外的地方截断（实测：拿到的是半段 ⇒ 判据自己假红）。改为"数组开始到 `]\n  let apiSrc`"。
    const m = s.match(/const API_SRC_FILES = \[([\s\S]*?)\n\s*\]/)
    expect(m, '找不到 API_SRC_FILES').toBeTruthy()
    expect(m![1], '★能力缓存类型源未登记 ⇒ 缓存相关类型在官网上永远没有说明').toContain('capability-fetch-cache.ts')
  })

  it('★★★数据源覆盖检查必须**扫全仓**导出类型（不能拿 API_SRC_FILES 当基准）', () => {
    // ★这是本判据的核心：用被测清单做判据基准 = "用被测对象证明自己正确"。
    // ★#1161：形态抽取已移到 lib/type-shapes.mjs ⇒ 枚举实现也在那里；gen-content 只管调用。
    const libSrc = read('website/scripts/lib/type-shapes.mjs')
    expect(libSrc, '缺全仓导出类型枚举').toMatch(/collectExportedTypeNames/)
    expect(libSrc, '★导出枚举必须扫 readdirSync(apiSrcDir) 而不是只用 API_SRC_FILES').toMatch(
      /readdirSync\(apiSrcDir\)[\s\S]{0,300}export\\s\+\(\?:interface\|type\|class\)/,
    )
    const s = read(GEN)
    expect(s, '缺 findUnregisteredTypes 调用（新门禁没接上）').toMatch(/findUnregisteredTypes\(md,\s*exportedTypeNames,\s*ifaces\)/)
  })

  it('★`findUnregisteredTypes` 语义：抽不到 ⇒ 报；抽到 ⇒ 不报；非本项目 ⇒ 不报', async () => {
    const { findUnregisteredTypes } = await lib()
    const exported = new Set(['FetchCacheMode', 'SomeApi'])
    const ifaces = { SomeApi: { props: [] } } as unknown as Record<string, Iface>
    const md = '`FetchCacheMode` 与 `SomeApi` 以及 `Promise`'
    const miss = findUnregisteredTypes(md, exported, ifaces)
    expect(miss, '★导出但抽不到 ⇒ 必须报（这正是 FetchCacheMode 的形态）').toEqual(['FetchCacheMode'])
    expect(miss, '抽到的不得报').not.toContain('SomeApi')
    expect(miss, '内置类型不得报').not.toContain('Promise')
  })

  it('★说明段内**叙述性提及**不算悬空引用（避免"别名指向谁"的说明被判红）', async () => {
    // 实测场景：`### \`AppLifecycle\`` 的 doc 里写"定义在 capability-app.ts 的 `AppLifecycleHandle`"，
    // 那段话本身就是解释；若要求 `AppLifecycleHandle` 也有独立段 ⇒ 逼人写重复段落（假红）。
    const { findUnregisteredTypes } = await lib()
    const exported = new Set(['AppLifecycleHandle'])
    const md = ['### `AppLifecycle`', '', '定义在 `AppLifecycleHandle`，此处仅做别名导出。', '', '## 用法'].join('\n')
    expect(findUnregisteredTypes(md, exported, {})).toEqual([])
  })

  it('★★★字符串字面量联合类型必须能抽成"取值枚举"（FetchCacheMode 的核心）', () => {
    const libSrc = read('website/scripts/lib/type-shapes.mjs')
    expect(libSrc, '★未抽取字符串字面量联合 ⇒ 枚举类型只有裸名字').toMatch(/export function stringLiteralUnion/)
    expect(libSrc, '★缺取值表渲染原语').toMatch(/export function renderUnionTable/)
    const s = read(GEN)
    const calls = s.match(/renderUnionTable\(lines,\s*ti,\s*escMd\)/g) ?? []
    expect(calls.length, `★取值表只在 ${calls.length} 处渲染（h2/h3 两条路径都要有）`).toBeGreaterThanOrEqual(2)
  })

  it('★★★`stringLiteralUnion` 行为：纯字面量联合 ⇒ 取值表；混合/非字面量 ⇒ null', async () => {
    // ★行为判据（不依赖源码文本）：变异"恒返回 null"时这条必红。
    const { stringLiteralUnion } = (await import('../website/scripts/lib/type-shapes.mjs')) as unknown as {
      stringLiteralUnion: (rhs: string) => string[] | null
    }
    expect(stringLiteralUnion("'a' | 'b' | 'c'")).toEqual(['a', 'b', 'c'])
    expect(stringLiteralUnion("'default' | \"no-store\"")).toEqual(['default', 'no-store'])
    expect(stringLiteralUnion("'auto' | SomeType"), '★混合联合不是枚举（含类型名）').toBeNull()
    expect(stringLiteralUnion('SomeType'), '★无字面量 ⇒ null').toBeNull()
  })

  it('★★★`FetchCacheMode` 在官网上有**独立的取值说明段**（端到端回归）', () => {
    const md = read('website/content/capabilities/fetch.md')
    expect(md, '★缺 FetchCacheMode 说明段').toMatch(/^### `FetchCacheMode`$/m)
    // 六个取值每个都要有一行（不只列名字——要带语义）
    for (const v of ['default', 'no-store', 'reload', 'no-cache', 'force-cache', 'only-if-cached']) {
      expect(md, `★取值 ${v} 未出现在取值表`).toMatch(new RegExp("\\| `'" + v + "'` \\|", ''))
    }
    // ★逐值说明必须来自源码 JSDoc（不是 `—` 占位）
    expect(md, '★取值表全是 `—`（JSDoc 里没有逐值语义）').toMatch(/\| `'no-store'` \| [^—]/)
  })

  it('★★`CapError` 必须有属性表（class 抽取 + 构造参数属性）', () => {
    const libSrc = read('website/scripts/lib/type-shapes.mjs')
    expect(libSrc, '★抽取器只认 interface，class 抽不到 ⇒ CapError 无属性表').toMatch(
      /export \(\?:interface\|class\)/,
    )
    expect(libSrc, '★未抽 class 构造参数属性（parameter properties）').toMatch(
      /export function parameterProperties/,
    )
    const md = read('website/content/capabilities/fetch.md')
    expect(md, '★CapError 段缺 code 属性').toMatch(/^\| `code` \| `string`/m)
  })
})
