// packages/plugin-vite/src/tag-scan.ts —— 模板标签扫描 + 框架组件引用闭包（共享 SSOT）
//
// ★2026-09-18 抽出：此前「页面模板 → 用到的标签」有两处独立实现
//   （gen-routes 的 collectComponents 用于生成 usingComponents；插件需另一份用于决定**输出哪些组件**）——
//   两份口径必然漂移。抽为单一实现，两侧共用。
//
// ★同时修复框架级体积缺陷：此前插件**无条件输出全部 76 个组件**（607 KB）到每个应用，
//   即使该应用只用 3 个 —— 本模块给出「实际引用集合」供按需输出（含组件间传递依赖闭包）。
import fs from 'node:fs'
import path from 'node:path'

/** 抽取 `<template>` 块正文（跳过注释 / script / style / 嵌套 template 深度） */
export function extractTemplateBody(src: string): string {
  const n = src.length
  let i = 0
  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) return ''
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4)
      i = e < 0 ? n : e + 3
      continue
    }
    // <script ...> / <style ...> 整块跳过
    const block = /^<(script|style)\b/i.exec(src.slice(lt, lt + 32))
    if (block) {
      const tag = block[1].toLowerCase()
      const end = src.toLowerCase().indexOf(`</${tag}`, lt + block[0].length)
      if (end < 0) return ''
      const gt = src.indexOf('>', end)
      i = gt < 0 ? n : gt + 1
      continue
    }
    if (/^<template[\s>]/i.test(src.slice(lt, lt + 16))) {
      const gt = src.indexOf('>', lt)
      if (gt < 0) return ''
      let depth = 1
      let j = gt + 1
      while (j < n) {
        const l2 = src.indexOf('<', j)
        if (l2 < 0) return src.slice(gt + 1)
        if (src.startsWith('<!--', l2)) {
          const e = src.indexOf('-->', l2 + 4)
          j = e < 0 ? n : e + 3
          continue
        }
        const seg = src.slice(l2, l2 + 16)
        if (/^<\/template[\s>]/i.test(seg)) {
          depth--
          if (depth === 0) return src.slice(gt + 1, l2)
          j = l2 + '</template>'.length
          continue
        }
        if (/^<template[\s>]/i.test(seg)) {
          depth++
          const g2 = src.indexOf('>', l2)
          j = g2 < 0 ? n : g2 + 1
          continue
        }
        j = l2 + 1
      }
      return src.slice(gt + 1)
    }
    i = lt + 1
  }
  return ''
}

/**
 * 扫描模板正文中出现的全部标签名（kebab 化；跳过注释块）。
 * PascalCase（`<PSafe>`）→ kebab（`p-safe`）——★旧正则只匹配小写开头，
 * 导致 `<PSafe>` 完全跳过扫描（既不注册也不告警 → 组件静默不渲染，showcase 踩坑）。
 */
export function extractTags(tpl: string): Set<string> {
  const out = new Set<string>()
  let idx = 0
  while (idx < tpl.length) {
    const lt = tpl.indexOf('<', idx)
    if (lt < 0) break
    if (tpl.startsWith('<!--', lt)) {
      const e = tpl.indexOf('-->', lt + 4)
      idx = e < 0 ? tpl.length : e + 3
      continue
    }
    if (tpl.startsWith('</', lt)) {
      idx = lt + 2
      continue
    }
    const mm = /^([A-Za-z][\w-]*)/.exec(tpl.slice(lt + 1))
    if (!mm) {
      idx = lt + 1
      continue
    }
    const raw = mm[1]
    out.add(/[A-Z]/.test(raw) ? raw.replace(/\B([A-Z])/g, '-$1').toLowerCase() : raw)
    idx = lt + 1 + mm[0].length
  }
  return out
}

/**
 * ★编译器**产出**的组件标签（源码模板中不存在，由 compiler lowering 生成）。
 * 必须计入引用集合，否则按需输出会把这些组件漏掉 → 运行时不渲染（真 bug）。
 *
 * 与 gen-routes 的 collectComponents 同源规则（两处必须一致）：
 *   源码含**形状变化动画**的 SVG（cx/r/d/stroke-dashoffset 等）→ 编译器 lowering 为 `<p-svg-canvas>`。
 */
export function collectCompilerEmittedTags(templateBody: string): Set<string> {
  const out = new Set<string>()
  if (/<(?:svg|circle|rect|ellipse|path|line|polyline|polygon)[\s>][\s\S]*?<animate\b/i.test(templateBody)) {
    const shapeAnim =
      /<animate\s[^>]*attributeName\s*=\s*["'](cx|cy|r|rx|ry|x|y|width|height|d|points|stroke-dashoffset|stroke-dasharray)["']/i
    if (shapeAnim.test(templateBody)) out.add('p-svg-canvas')
  }
  return out
}

/** 解析框架组件标签 → 组件目录（`${componentsDir}/<tag>/index.vue` 或 `<tag>.vue`）；无则 null */
function resolveComponentFile(componentsDir: string, tag: string): string | null {
  // ★2026-09-19 修前缀硬编码（真机暴露）：此前要求 `tag.startsWith('p-')`，
  //   而本仓组件有 **`pg-` 前缀**（pg-glass，G-07 液态玻璃统一入口）——被判定为「非框架组件」
  //   直接 return null → 按需输出把它静默剔除（产物只有 index.json，缺 js/wxml/wxss）
  //   → 真机报 `pages/system-glass.json: usingComponents["pg-glass"] 未找到组件**、模拟器启动失败**。
  //   判据改为**目录/文件真实存在**（本函数随后就会 existsSync）——不再依赖命名前缀假设；
  //   非框架标签（div/view 等）自然落到 existsSync 失败 → 仍返回 null。
  //   注：`p-`/`pg-` 之外的未来前缀同样自动覆盖，无需再改此处。
  const dirIndex = path.join(componentsDir, tag, 'index.vue')
  if (fs.existsSync(dirIndex)) return dirIndex
  const flat = path.join(componentsDir, `${tag}.vue`)
  if (fs.existsSync(flat)) return flat
  return null
}

/**
 * 计算页面**实际引用**的框架组件目录集合（含组件间传递依赖闭包）。
 *
 * 用途：MP 产物只输出用到的组件（而非全量 76 个 = 607 KB）——对每个真实应用都是可观瘦身。
 *   ★诚实边界：仅识别**静态模板标签**。运行时动态拼标签不受支持（MP 本就无 `<component :is>`，
 *   编译器已对 `<component :is>` 显式告警）——若确有非常规用法，可用 `components.emit: 'all'` 关闭本优化。
 *
 * @param pageFiles  页面源文件绝对路径（主包 + 分包，**须已排除 webOnly 页面**）
 * @param componentsDir 框架组件根目录
 * @returns 组件目录名集合（如 `p-view`）；空集表示「未引用任何框架组件」
 */
export function collectUsedFrameworkComponents(
  pageFiles: readonly string[],
  componentsDir: string,
): Set<string> {
  const used = new Set<string>()
  const visitedFiles = new Set<string>()
  const queue: string[] = [...pageFiles]

  while (queue.length) {
    const file = queue.pop() as string
    if (visitedFiles.has(file)) continue
    visitedFiles.add(file)
    if (!fs.existsSync(file)) continue

    let tags: Set<string>
    const body = (() => {
      try {
        return extractTemplateBody(fs.readFileSync(file, 'utf-8'))
      } catch {
        return ''
      }
    })()
    try {
      tags = extractTags(body)
      // ★补编译器产出标签（源码模板中无该标签——须与 gen-routes 同源）
      for (const t of collectCompilerEmittedTags(body)) tags.add(t)
    } catch {
      // 读/解析失败 → 保守跳过（不因单个文件异常漏掉其他）
      continue
    }

    for (const tag of tags) {
      if (used.has(tag)) continue
      const compFile = resolveComponentFile(componentsDir, tag)
      if (!compFile) continue
      used.add(tag)
      // 传递依赖：组件模板里可能再用其他框架组件
      queue.push(compFile)
    }
  }
  return used
}
