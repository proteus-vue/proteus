/// <reference types="vite/client" />

/** p-* 组件库（@proteus-vue/components）内有 MP 兼容分支引用 wx 全局——官网复用组件库源码需带官方 typings 垫片 */
/// <reference types="miniprogram-api-typings" />

/** ★平台编译期宏（构建期由插件替换为该平台字面量；见 packages/compiler/src/platform-macros.ts）
 *  官网复用组件库源码（`@proteus-vue/components` → `../src/components`），组件内 `const isWeb = __WEB__`
 *  等宏在**类型检查阶段**需声明，否则 vue-tsc 报 TS2304（此前官网 build 因此失败——既有缺陷，非本轮引入）。 */
declare const __MP__: boolean
declare const __WEB__: boolean
declare const __NATIVE__: boolean
declare const __IOS__: boolean
declare const __ANDROID__: boolean
declare const __HARMONY__: boolean
declare const __TARGET__: 'web' | 'mp' | 'ios' | 'android' | 'harmony' | 'native'
/** 调试开关 / Skyline 渲染开关（vite define 注入） */
declare const __PROTEUS_DEBUG__: boolean
declare const __PROTEUS_SKYLINE__: boolean

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

/** @proteus-vue/docs vite 插件虚拟模块：.md import → 文档组件模块（构建期解析，运行时零解析） */
declare module '*.md' {
  import type { DocsModule } from '@proteus-vue/docs/vite'
  const doc: DocsModule
  export default doc
  export const frontmatter: DocsModule['frontmatter']
  export const title: string
  export const html: string
  export const tocFlat: DocsModule['tocFlat']
}
