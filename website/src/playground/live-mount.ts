// website/src/playground/live-mount.ts —— ★Playground 实时预览：SFC 源码 → 真实 Vue 组件 → 真实 DOM
//
// 【回答什么（决策 #699 / 用户「Playground 是否有条件升级为大厂那种标准 Playground」）】
//   大厂 Playground 的第一根支柱 = **实时可视化预览**（写即见真渲染）。此前 Playground 的 Render
//   Tab 只出**渲染树 JSON**（`renderIRTree` 的 VueDom 后端产物——那棵树不含样式，因为样式在 CIR/语义树）。
//   ⇒ 本模块走**真实 Vue 编译 + 挂载**（`@vue/compiler-sfc` 浏览器内直跑，与编辑器语法高亮同源），
//   把源码里的 `p-*` 组件按官网同一份注册表解析，产出**真实 DOM**。
//
// 【诚实边界（tier-1）】
//   · 仅支持 `<template>` +（可选）`<script setup>`；`<script setup>` 的 import **仅限 `vue`**（其余导入
//     在浏览器内无法解析 ⇒ 明确报错，不静默）。`<style scoped>` 已编译注入（scope id 生效）。
//   · `lang="ts"` 会被**按 JS 解析**（对齐官方 Playground 的"仅剥离类型"边界）；若用户写了真 TS 注解
//     ⇒ 解析失败 ⇒ 返回 error（如实）。
import { parse, compileScript, compileTemplate, compileStyle, type SFCDescriptor } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import type { Component } from 'vue'
import { GLOBAL_COMPONENTS } from './global-components'

const SCOPED_PREFIX = 'data-v-'

/** 编译 SFC 源码为可挂载的 Vue 组件（+ 提取的 scoped CSS）。任何不支持形态 ⇒ throw（调用方显示 error）。 */
export function compileSfc(source: string): { component: Component; css: string } {
  const filename = 'playground.vue'
  const { descriptor, errors } = parse(source, { filename })
  if (errors && errors.length) throw new Error(errors[0]!.message ?? 'SFC 解析失败')
  if (!descriptor.template) throw new Error('缺少 <template>——实时预览需要模板')

  const id = 'data-v-pg' + hash(source)
  const css = compileStyles(descriptor, id)

  const hasScript = !!(descriptor.scriptSetup || descriptor.script)
  let component: Component
  if (hasScript) {
    // 按 JS 解析（tier-1 边界）：剥离 <script setup lang="ts"> 的 lang
    if (descriptor.scriptSetup) descriptor.scriptSetup.lang = undefined
    if (descriptor.script) descriptor.script.lang = undefined
    let code = compileScript(descriptor, { id, inlineTemplate: true }).content
    // ★先重写 vue 导入（`__VUE__` 解构），再查残留——否则连 vue 自身的 import 也会被误判为"不支持"
    code = rewriteVueImports(code)
    const leftover = code.match(/^\s*import\s.*$/gm)
    if (leftover && leftover.length) {
      throw new Error('实时预览仅支持从 `vue` 导入（其余依赖在浏览器内无法解析）：' + leftover[0].trim())
    }
    code = code.replace(/export\s+default\s+/, 'module.exports = ')
    const mod: { exports: unknown } = { exports: {} }
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', '__VUE__', code)(mod, mod.exports, Vue)
    component = mod.exports as Component
  } else {
    // 模板专属组件：compileTemplate → render 函数
    const tpl = compileTemplate({
      source: descriptor.template.content,
      filename,
      id,
      scoped: descriptor.styles.some((s) => s.scoped),
      compilerOptions: { mode: 'module' },
    })
    if (tpl.errors && tpl.errors.length) throw new Error(String(tpl.errors[0]))
    const code = rewriteVueImports(tpl.code).replace(/export\s+function\s+render/, 'function render') + '\nmodule.exports = { render }'
    const mod: { exports: unknown } = { exports: {} }
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', '__VUE__', code)(mod, mod.exports, Vue)
    component = mod.exports as Component
  }
  if (descriptor.styles.some((s) => s.scoped)) (component as { __scopeId?: string }).__scopeId = SCOPED_PREFIX + id
  return { component, css }
}

/** 把 `<script setup>` 产物的 `import { a as b } from 'vue'` 重写为从 `__VUE__` 解构（Vue 自身确定性输出形态） */
function rewriteVueImports(code: string): string {
  return code.replace(/import\s*\{([^}]*)\}\s*from\s*['"]vue['"];?/g, (_m, names: string) => {
    const mapped = names
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const p = s.split(/\s+as\s+/)
        return p.length === 2 ? `${p[0]}: ${p[1]}` : s
      })
      .join(', ')
    return `const { ${mapped} } = __VUE__;`
  })
}

/** 编译 `<style>`（含 scoped）为可注入的 CSS；scoped 选择器改写为 [data-v-<id>] */
function compileStyles(descriptor: SFCDescriptor, id: string): string {
  let css = ''
  for (const s of descriptor.styles) {
    try {
      const r = compileStyle({ source: s.content, filename: 'playground.vue', id, scoped: !!s.scoped })
      if (!r.errors || r.errors.length === 0) css += r.code + '\n'
    } catch {
      /* 单块样式编译失败 ⇒ 跳过该块（预览仍出结构与其余样式） */
    }
  }
  return css
}

/** 稳定短哈希（scope id 用；同一源码 ⇒ 同一 id，避免重挂时样式串味） */
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * 把源码挂载到给定容器（真实 Vue 应用）。返回卸载函数。调用方负责清空容器/错误处理。
 *   ★每个预览新建独立 app（组件是动态编译的，不能复用官网主 app 的组件表之外的实例）。
 */
export function mountPreview(container: HTMLElement, source: string): { unmount: () => void; css: string } {
  const { component, css } = compileSfc(source)
  container.innerHTML = ''
  const app = Vue.createApp(component)
  for (const [name, comp] of Object.entries(GLOBAL_COMPONENTS)) app.component(name, comp)
  app.mount(container)
  return { unmount: () => app.unmount(), css }
}
