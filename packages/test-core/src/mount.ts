// packages/test-core/src/mount.ts
// ★test-framework：统一测试 API —— mountComponent 双端统一挂载（03-component-integration.md §环境）
// Web：@vue/compiler-sfc 编译 SFC → @vue/test-utils mount（happy-dom 真实渲染）
// MP：mountMpComponent（逻辑层 + WXML 双断言，不真实渲染）
// ★同一份 SFC 源码 → 两端挂载 → 统一断言（06 铁律：状态共用、DOM 各自断言）
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { transform } from 'esbuild'
import type { Component } from 'vue'
import { mountMpComponent } from './mount-mp'
import type { MpComponentInstance } from './mount-mp'
import type { CompileOptions } from '@proteus-vue/compiler'

export interface MountComponentOptions {
  platform: 'web' | 'mp'
  /** web：组件 props（透传 @vue/test-utils mount） */
  props?: Record<string, unknown>
  /** web：全局配置（plugins 等，透传 mount global） */
  global?: Record<string, unknown>
  /** mp：编译选项（透传 mountMpComponent） */
  compileOptions?: CompileOptions
}

/** 统一挂载结果：Web wrapper 或 MP 逻辑层实例 */
export type MountedHost = VueWrapper | MpComponentInstance

/**
 * ★SFC 源码 → 组件对象（Web 端）：compileScript + compileTemplate 标准双段编译
 * ★环境要求：happy-dom（plan §3）——esbuild 的 TextEncoder instanceof 检查在 jsdom 崩（跨 realm），happy-dom 保留 node 全局
 * ★不启用 inlineTemplate：script setup 的 setup() 返回 __returned__（绑定对象）→ setupState 代理 → vm 可读状态/调用方法
 *   （inlineTemplate 时 setup 返回 render 函数，绑定不暴露，vm.count 为 undefined——状态断言无从谈起）
 * ★script 与 template 分开 transform/执行：`const __returned__` 是 setup 内部局部，模块顶层无法引用；
 *   两段各自是完整模块 → 组件对象 + render 函数在 JS 侧组装（避免依赖 esbuild 产物命名）
 */
function evalVueModule(code: string, vueNs: Record<string, unknown>): Record<string, unknown> {
  let c = code.replace(/require\(["']vue["']\)/g, '__VUE__')
  // 其余裸依赖 require → MVP 限制报错（stores 等请用 import .vue + mountWebComponent）
  if (/require\(/.test(c)) {
    const m = c.match(/require\([^)]*\)/m)
    throw new Error(`[test-core] SFC 含非 vue 依赖（${m ? m[0] : '?'}）——统一 API web 分支当前仅支持 vue import`)
  }
  const mod: { exports: Record<string, unknown> } = { exports: {} }
  new Function('module', 'exports', '__VUE__', c)(mod, mod.exports, vueNs)
  return mod.exports
}

export async function sfcToComponent(source: string, filename = 'Anonymous.vue'): Promise<Component> {
  const { descriptor } = parse(source, { filename })
  const id = 'data-v-test'
  const script = compileScript(descriptor, { id })
  // 模板编译需脚本绑定元数据（bindingMetadata）：{{ count }} → $setup.count 而非 _ctx.count
  const template = compileTemplate({
    source: descriptor.template?.content ?? '',
    filename,
    id,
    compilerOptions: { bindingMetadata: script.bindings },
  })
  // esbuild：剥离 TS（compileScript 产物保留类型标注，如 render 参数 (_ctx: any)）
  // ★format cjs：module.exports / export 由 esbuild 原生处理（esm 的 export { x as default } 字符串替换易残留）
  const vueNs = (await import('vue')) as Record<string, unknown>
  const { code: scriptCode } = await transform(script.content, { loader: 'ts', format: 'cjs', target: 'es2020' })
  const { code: tplCode } = await transform(template.code, { loader: 'ts', format: 'cjs', target: 'es2020' })
  const component = evalVueModule(scriptCode, vueNs).default as Component & { render?: unknown }
  const render = evalVueModule(tplCode, vueNs).render
  component.render = render
  return component
}

/** Web 端挂载（happy-dom / jsdom + @vue/test-utils）：SFC 源码 → mount */
export async function mountWebComponent(source: string, options: { props?: Record<string, unknown>; global?: Record<string, unknown> } = {}): Promise<VueWrapper> {
  const component = await sfcToComponent(source)
  return mount(component, { props: options.props as never, global: options.global as never })
}

/** MP 统一 host：逻辑层实例（data/setData/方法）展开 + wxml 顶层暴露——stateOf/textOf 直接可用 */
export type UnifiedMpHost = MpComponentInstance & { wxml: string }

/**
 * ★统一挂载入口：同一份 SFC 源码 → Web（真实渲染）或 MP（逻辑 + WXML）
 * 返回 MountedHost——配合 stateOf/textOf（统一断言）+ tap（事件触发）跨端复用用例
 */
export async function mountComponent(source: string, options: MountComponentOptions): Promise<MountedHost> {
  if (options.platform === 'web') {
    return mountWebComponent(source, { props: options.props, global: options.global })
  }
  // ★归一化：mountMpComponent 返回 { instance, wxml, ... }，统一 host 摊平 instance + wxml
  // 深层断言（js/context/config）仍可直接用 mountMpComponent
  const { instance, wxml } = mountMpComponent(source, options.compileOptions)
  return { ...instance, wxml }
}
