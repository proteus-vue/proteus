// src/shims/vue.d.ts
// .vue 模块声明 —— 供 .ts 文件 import 组件（如 src/components/index.ts 聚合导出）
// vue-tsc 对 .vue 文件内部 import .vue 原生支持；.ts 文件需要此声明
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
