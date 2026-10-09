// website/src/playground/global-components.ts —— ★p-* 语义组件全局注册表（单一事实源）
//
// 【为什么单列（决策 #699）】官网主应用（`main.ts`）与 Playground**实时预览**（`PreviewMount.vue`）
//   都要把 `p-*` 标签注册成真实组件——此前注册表内联在 main.ts，预览若各写一份会**漂移**
//   （预览里缺一个 p-* ⇒ 演示源码在该组件处静默失败）。⇒ 提取为唯一事实源，两处共用。
import type { App, Component } from 'vue'
import {
  PView,
  PZone,
  PFormfactor,
  PText,
  PHeading,
  PGrid,
  PStack,
  PButton,
  PDivider,
  PPage,
  PSidebar,
  PSplit,
  PSegment,
  PToast,
  PAnimate,
  PgGlass,
} from '@proteus-vue/components'

/** 全局注册的 p-* 组件表（官网与 Playground 预览共用） */
export const GLOBAL_COMPONENTS: Record<string, Component> = {
  'p-view': PView as unknown as Component,
  'p-zone': PZone as unknown as Component,
  'p-formfactor': PFormfactor as unknown as Component,
  'p-text': PText as unknown as Component,
  'p-heading': PHeading as unknown as Component,
  'p-grid': PGrid as unknown as Component,
  'p-stack': PStack as unknown as Component,
  'p-button': PButton as unknown as Component,
  'p-divider': PDivider as unknown as Component,
  'p-page': PPage as unknown as Component,
  'p-sidebar': PSidebar as unknown as Component,
  'p-split': PSplit as unknown as Component,
  'p-segment': PSegment as unknown as Component,
  'p-toast': PToast as unknown as Component,
  'p-animate': PAnimate as unknown as Component,
  'pg-glass': PgGlass as unknown as Component,
}

/** 把 p-* 组件批量注册到 app（官网主应用与预览宿主共用） */
export function installGlobalComponents(app: App): void {
  for (const [name, comp] of Object.entries(GLOBAL_COMPONENTS)) app.component(name, comp)
}
