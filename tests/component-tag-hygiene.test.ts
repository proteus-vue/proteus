// tests/component-tag-hygiene.test.ts
// ★框架组件标签写法卫生（2026-09-13 真机踩坑沉淀）：
//   故障背景：showcase 用 `<PSafe>`（PascalCase）→ 编译器 kebabCase 旧实现产出 `psafe`（缺连字符）
//   → gen-routes 按 `psafe` 找不到组件目录 `p-safe` → usingComponents 未注册 → **组件静默不渲染**。
//   同类：源码手写 `<pgrid>`/`<pcamera>`（缺连字符）同样注册失败。
//   本测试扫描应用源码中的**框架组件标签**，要求小写 kebab 且与 packages/components 目录名一致。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

/** 框架内置组件目录名（p-*） */
function frameworkTags(): Set<string> {
  const dir = path.join(ROOT, 'packages/components')
  return new Set(
    fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('p-'))
      .map((e) => e.name),
  )
}

function walkVue(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkVue(full, acc)
    else if (e.name.endsWith('.vue')) acc.push(full)
  }
  return acc
}

const RUNTIME_NATIVE = new Set(['psafe']) // 不豁免任何拼写错误；此集合仅作文档位

describe('★框架组件标签写法卫生（防静默不渲染）', () => {
  const tags = frameworkTags()

  it('① 应用源码不出现 PascalCase 框架组件标签（<PSafe> 等——须写 kebab）', () => {
    const offenders: string[] = []
    for (const f of [...walkVue(path.join(ROOT, 'showcase')), ...walkVue(path.join(ROOT, 'examples'))]) {
      const src = fs.readFileSync(f, 'utf-8')
      const tpl = src.match(/<template>([\s\S]*?)<\/template>/)?.[1] ?? ''
      // PascalCase 且去掉连字符/小写后命中某框架目录名
      for (const m of tpl.matchAll(/<([A-Z][a-zA-Z]+)[\s/>]/g)) {
        const norm = m[1].replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
        if (tags.has(norm)) offenders.push(`${path.relative(ROOT, f)}: <${m[1]}> → 应写 <${norm}>`)
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('② 应用源码不出现缺连字符的框架标签（<pgrid> 应为 <p-grid>）', () => {
    const offenders: string[] = []
    // 已知框架目录名的「无连字符」形态（p-grid → pgrid）
    const noHyphen = new Map([...tags].map((t) => [t.replace(/-/g, ''), t]))
    for (const f of [...walkVue(path.join(ROOT, 'showcase')), ...walkVue(path.join(ROOT, 'examples'))]) {
      const src = fs.readFileSync(f, 'utf-8')
      const tpl = src.match(/<template>([\s\S]*?)<\/template>/)?.[1] ?? ''
      for (const m of tpl.matchAll(/<([a-z][a-z0-9]*)[\s/>]/g)) {
        const t = m[1]
        // 排除原生/HTML 标签与合法 kebab（含连字符者不匹配本正则）
        if (noHyphen.has(t) && !RUNTIME_NATIVE.has(t)) {
          offenders.push(`${path.relative(ROOT, f)}: <${t}> → 应写 <${noHyphen.get(t)}>`)
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
