/// <reference types="vite/client" />

/** p-* 组件库（@proteus-vue/components）内有 MP 兼容分支引用 wx 全局——官网复用组件库源码需带官方 typings 垫片 */
/// <reference types="miniprogram-api-typings" />

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
