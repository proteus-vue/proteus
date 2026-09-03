// website/src/playground/compile.ts —— Playground 编译包装（浏览器端直跑 @proteus-vue/compiler）
// compiler 零 node 内置依赖（peer 仅 @vue/compiler-sfc/dom，均 browser-safe）——浏览器内实时编译成立
// ★透明编译（W-4 证明先于宣称）：产物 + 决策 trace + 规则说明书同屏，绝不伪造输出
import { compileVueSfc, explainTransform, listTransformRules } from '@proteus-vue/compiler'
import type { TransformTraceEvent } from '@proteus-vue/compiler'

export interface PlaygroundCompileResult {
  wxml: string
  js: string
  wxss: string
  warnings: string[]
  /** 本次编译实际触发的规则（trace 事件） */
  trace: TransformTraceEvent[]
  /** 规则说明书目录（AI 说明书——透明编译的展示核心） */
  ruleCount: number
  error: string | null
}

export function compileLive(source: string): PlaygroundCompileResult {
  try {
    const result = compileVueSfc(source, { filename: 'playground.vue', px2rpx: true })
    const explained = explainTransform(source, { filename: 'playground.vue' })
    return {
      wxml: result.wxml,
      js: result.js,
      wxss: result.wxss,
      warnings: [...result.warnings],
      trace: explained.events,
      ruleCount: listTransformRules().length,
      error: null,
    }
  } catch (e) {
    return {
      wxml: '', js: '', wxss: '',
      warnings: [],
      trace: [],
      ruleCount: listTransformRules().length,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/** 默认演示 SFC：覆盖 v-if→wx:if / v-for→wx:for / @tap→bindtap / px→rpx / 插值 全核心转换 */
export const DEMO_SOURCE = `<script setup lang="ts">
import { ref } from 'vue'

const count = ref(0)
const visible = ref(true)
const items = ref(['语义内核', '可插拔后端', '透明编译'])

function handleTap() {
  count.value++
}
</script>

<template>
  <div class="demo">
    <h1>Hello Proteus</h1>
    <p v-if="visible">tapped {{ count }} times</p>
    <button @tap="handleTap">tap me</button>
    <ul>
      <li v-for="(item, i) in items" :key="i">{{ item }}</li>
    </ul>
  </div>
</template>

<style>
.demo { padding: 24px 32px; }
h1 { font-size: 20px; color: #333; }
</style>
`
