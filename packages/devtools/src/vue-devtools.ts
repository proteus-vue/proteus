// packages/devtools/src/vue-devtools.ts
// ★接入 Vue 官方 DevTools：把 Proteus 事件流 → Vue DevTools Timeline 面板（@vue/devtools-api 8.x）
//   浏览器扩展装 Vue DevTools → Timeline 面板出现 "Proteus" layer → 编译/路由/API/生命周期事件可见
//   （组件树 / Pinia 状态由 Vue DevTools 原生展示——Proteus Web 端即标准 Vue 应用，零代码）
// ★安全降级：setupDevtoolsPlugin 在无扩展/无 hook 时不调用回调 → 生产零开销（对齐 plan 铁律 2）
// ★结构类型注入：api 形状兼容 @vue/devtools-api 的 DevtoolsApi（addTimelineLayer/addTimelineEvent），可 mock 单测
import type { TraceEvent } from '@proteus-vue/devtools-runtime'
import type { DevtoolsSource } from './source'

/** @vue/devtools-api DevtoolsApi 的结构类型（只取 Timeline 能力面） */
export interface VueDevtoolsApiLike {
  addTimelineLayer(options: { id: string; label: string; color?: number }): void
  addTimelineEvent(options: { layerId: string; event: unknown }): void
}

export interface VueDevtoolsTimelineOptions {
  /** Proteus 事件源（TraceBus 直连 / WS-CDP / mock） */
  source: DevtoolsSource
  /** layer 颜色（Vue DevTools Timeline 色板，缺省紫蓝） */
  color?: number
}

export interface VueDevtoolsTimeline {
  /** 卸载：取消事件订阅 */
  dispose(): void
  /** 已注册的 layer id */
  readonly layerId: string
}

const LAYER_ID = 'proteus'

/** 事件 → Vue DevTools TimelineEvent（按 traceId 分组——同链路事件归组） */
function toTimelineEvent(e: TraceEvent): unknown {
  return {
    time: e.timestamp,
    title: e.source + '.' + e.name,
    subtitle: e.phase,
    data: {
      source: e.source,
      name: e.name,
      phase: e.phase,
      traceId: e.traceId,
      payload: e.payload,
    },
    groupId: e.traceId ?? e.source,
  }
}

/**
 * 接入 Vue 官方 DevTools：注册 'proteus' Timeline layer，把事件流推送为 Timeline 事件。
 * 用法（应用侧）：setupDevtoolsPlugin({ id: 'proteus', label: 'Proteus', app }, (api) => {
 *   installProteusTimeline(api, { source })
 * })
 */
export function installProteusTimeline(api: VueDevtoolsApiLike, options: VueDevtoolsTimelineOptions): VueDevtoolsTimeline {
  api.addTimelineLayer({ id: LAYER_ID, label: 'Proteus', color: options.color ?? 11101205 })
  const off = options.source.onEvent((e: TraceEvent) => {
    api.addTimelineEvent({ layerId: LAYER_ID, event: toTimelineEvent(e) })
  })
  return {
    dispose: off,
    get layerId() {
      return LAYER_ID
    },
  }
}
