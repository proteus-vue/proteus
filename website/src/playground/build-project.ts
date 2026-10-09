// website/src/playground/build-project.ts —— 多文件项目 → 可挂载组件（决策 #700 · Playground 第二档）
//
// 【做什么】把虚拟文件树编成**真实 ESM 模块图**并挂载：
//   ① 每个 `.vue` 经 `@vue/compiler-sfc` 编成 **ESM 模块**（`inlineTemplate`，保留 import 语句）；
//   ② 改写模块说明符：`vue` → **宿主单例 shim**（所有文件共享一个 Vue 运行时）；相对路径 → 目标文件的
//      **blob URL**（递归构建，模块图）；裸包名 → `https://esm.sh/<spec>`（外部 ESM 依赖）；
//   ③ `import(entry blob URL)` → 根组件 → 真实 Vue 挂载。
//
// 【为什么用 blob URL + 动态 import（可行性已 spike 证实）】浏览器原生 ESM 能 `import(blob:)` 且能
//   `import('https://esm.sh/...')`（CORS 由 esm.sh 提供）⇒ 无需自研模块加载器/打包器。
//
// 【诚实边界（降级第二档，非 WebContainer）】
//   · 依赖走 **esm.sh 外部 CDN**（非浏览器内 npm 安装）；离线时该 import 失败 ⇒ 明确报错。
//   · **仅相对路径依赖 + 裸包名**；`vue` 强制宿主单例（其余包各自实例，不保证与 Vue 同实例）。
//   · **不支持循环 import**（模块图按依赖序构建，遇环报错——诚实，不静默）。
//   · 文件限 `.vue` / `.js`（`.ts` 不支持——按 JS 解析）。
import { parse, compileScript, compileTemplate, compileStyle, type SFCDescriptor } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import type { Component } from 'vue'
import { GLOBAL_COMPONENTS } from './global-components'
import type { PlaygroundProject } from './project'

/** 外部 ESM 依赖的 CDN（可换 jsdelivr 等；单一常量便于调整） */
const ESM_CDN = (spec: string): string => `https://esm.sh/${spec}`
/** 供模块图共享宿主 Vue 的全局键 */
const VUE_GLOBAL_KEY = '__PROTEUS_PG_VUE__'

/* ───────────────────────── 纯函数（可单测，零浏览器依赖） ───────────────────────── */

/** 稳定短哈希（scope id / 模块 id 用；同源码 ⇒ 同 id） */
export function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** POSIX 路径归一（仅 `.`/`..`/空段） */
function normalizePath(p: string): string {
  const parts: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/**
 * 把**相对说明符**解析为项目内文件路径（含扩展名候选）；`vue`/裸包名/绝对 URL ⇒ null（非文件）。
 * 解析候选：精确 → +.vue → +.js → +/index.vue → +/index.js。
 */
export function resolveModulePath(spec: string, fromPath: string, files: Record<string, unknown>): string | null {
  if (!spec.startsWith('.')) return null
  const baseDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : ''
  const joined = normalizePath(baseDir ? `${baseDir}/${spec}` : spec)
  const cands = [joined, `${joined}.vue`, `${joined}.js`, `${joined}/index.vue`, `${joined}/index.js`]
  for (const c of cands) if (Object.prototype.hasOwnProperty.call(files, c)) return c
  return null
}

/**
 * 改写模块里的**静态 import/export … from '…'** 说明符。`resolve(spec, kind)` 返回新说明符。
 *   ★返回的字符串仍含原始 import 语句（只是说明符被替换）——由调用方再 blob 化。
 */
export function rewriteModuleSpecifiers(esm: string, resolve: (spec: string) => string): string {
  const RE = /(\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/g
  return esm.replace(RE, (m, pre: string, spec: string) => `${pre}${JSON.stringify(resolve(spec))}`)
}

/**
 * `.vue` 源码 → ESM 模块字符串（+ scoped CSS）。
 *   ★`inlineTemplate`：模板内联进 render（无需单独 compileTemplate；要求无真 TS 注解）。
 *   ★scopeId：scoped 时把组件标为 `data-v-<id>`（配合 compileStyle 改写）。
 */
export function compileVueToEsm(path: string, src: string, id: string): { esm: string; css: string } {
  const { descriptor, errors } = parse(src, { filename: path })
  if (errors && errors.length) throw new Error(errors[0]!.message ?? 'SFC 解析失败')
  if (!descriptor.template) throw new Error('缺 <template>')
  const scoped = descriptor.styles.some((s) => s.scoped)
  const css = compileStyles(descriptor, id)
  const scopeId = `data-v-${id}`
  if (descriptor.scriptSetup || descriptor.script) {
    if (descriptor.scriptSetup) descriptor.scriptSetup.lang = undefined
    if (descriptor.script) descriptor.script.lang = undefined
    let esm = compileScript(descriptor, { id, inlineTemplate: true }).content
    esm = esm.replace(/export\s+default\s+/, 'const __pg_component = ')
    if (scoped) esm += `\n__pg_component.__scopeId = ${JSON.stringify(scopeId)};\n`
    esm += 'export default __pg_component;\n'
    return { esm, css }
  }
  // 无 script：仅模板
  const tpl = compileTemplate({ source: descriptor.template.content, filename: path, id, scoped, compilerOptions: { mode: 'module' } })
  if (tpl.errors && tpl.errors.length) throw new Error(String(tpl.errors[0]))
  const body = tpl.code.replace(/export\s+function\s+render/, 'function render')
  const tail = scoped ? `{ render, __scopeId: ${JSON.stringify(scopeId)} }` : '{ render }'
  return { esm: `${body}\nexport default ${tail};\n`, css }
}

function compileStyles(descriptor: SFCDescriptor, id: string): string {
  let css = ''
  for (const s of descriptor.styles) {
    try {
      const r = compileStyle({ source: s.content, filename: 'playground.vue', id, scoped: !!s.scoped })
      if (!r.errors || r.errors.length === 0) css += r.code + '\n'
    } catch {
      /* 单块样式编译失败 ⇒ 跳过该块（预览仍出结构 + 其余样式） */
    }
  }
  return css
}

/* ───────────────────────── 模块图构建（浏览器） ───────────────────────── */

let vueShimUrl: string | null = null
/** 宿主 Vue 单例 shim：一个 ESM 模块，`export default Vue` + 逐个具名导出（从宿主 Vue 命名空间派生） */
function vueShim(): string {
  if (vueShimUrl) return vueShimUrl
  ;(globalThis as unknown as Record<string, unknown>)[VUE_GLOBAL_KEY] = Vue
  const names = Object.keys(Vue).filter((k) => k !== 'default' && /^[A-Za-z_$][\w$]*$/.test(k))
  const decls = names.map((n) => `export const ${n} = __V.${n};`).join('\n')
  const src = `const __V = globalThis.${VUE_GLOBAL_KEY};\nexport default __V;\n${decls}\n`
  vueShimUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
  return vueShimUrl
}

/** 构建项目的模块图 → 根组件 + 全量 CSS */
export async function buildProject(project: PlaygroundProject): Promise<{ component: Component; css: string }> {
  const files = project.files
  const cssAll: string[] = []
  const urlCache = new Map<string, string>()
  const building = new Set<string>()

  async function build(path: string): Promise<string> {
    const cached = urlCache.get(path)
    if (cached) return cached
    if (building.has(path)) throw new Error(`不支持循环 import：${path}`)
    const src = files[path]?.content
    if (src == null) throw new Error(`缺文件：${path}`)
    building.add(path)
    let esm: string
    if (path.endsWith('.vue')) {
      const r = compileVueToEsm(path, src, 'pg' + hash(`${path}:${src}`))
      esm = r.esm
      if (r.css) cssAll.push(r.css)
    } else {
      esm = src // .js（含 .ts 的 JS 子集——真 TS 不支持）
    }
    // 解析每个说明符（可能是递归构建子模块）
    const specs = [...esm.matchAll(/(?:\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]!)
    const urlBySpec = new Map<string, string>()
    for (const spec of specs) {
      if (urlBySpec.has(spec)) continue
      if (spec === 'vue') urlBySpec.set(spec, vueShim())
      else if (/^https?:\/\//.test(spec)) urlBySpec.set(spec, spec)
      else {
        const target = resolveModulePath(spec, path, files)
        urlBySpec.set(spec, target ? await build(target) : ESM_CDN(spec))
      }
    }
    const rewritten = rewriteModuleSpecifiers(esm, (spec) => urlBySpec.get(spec) ?? spec)
    const url = URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' }))
    building.delete(path)
    urlCache.set(path, url)
    return url
  }

  const entryUrl = await build(project.entry)
  const mod = (await import(/* @vite-ignore */ entryUrl)) as { default: Component }
  if (!mod?.default) throw new Error('入口模块未默认导出组件')
  return { component: mod.default, css: cssAll.join('\n') }
}

/** 构建并挂载到容器；返回卸载函数。调用方负责清空容器/错误处理。 */
export async function mountProject(container: HTMLElement, project: PlaygroundProject): Promise<{ unmount: () => void; css: string }> {
  const { component, css } = await buildProject(project)
  container.innerHTML = ''
  const app = Vue.createApp(component)
  for (const [name, comp] of Object.entries(GLOBAL_COMPONENTS)) app.component(name, comp)
  app.mount(container)
  return { unmount: () => app.unmount(), css }
}
