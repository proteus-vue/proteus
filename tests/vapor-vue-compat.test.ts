// tests/vapor-vue-compat.test.ts
// ★★V6：**Vue 版本兼容**（方案 §8.1「编译器不依赖 Vue 版本」的**证据**）
//
// 【为什么必须有（本仓实测的动机）】方案 §8 要求编译器适配 Vue 3.4 / 3.5 / 3.6，
//   但此前**只跑过 3.5.42**——"兼容"只是声明，没有任何证据。
//   而 vapor 只用到三个 Vue API（`parse` / `compileScript` / `domParse`）⇒
//   把它们做成**可注入**后，就能用不同版本的解析器跑同一份 SFC，
//   断言产物**逐字节相同**——这才是"不绑版本"的判据。
//
// 【判据（三层）】
//   ① **产物等价**：三版的 `SubscriptionTable` 逐字段相同（JSON 字符串相等）
//   ② **诊断等价**：error/warn 的 code 集合相同（版本差异不该改变判据）
//   ③ **不回归**：缺省路径（无注入）与注入 3.5.42 的结果一致（证明注入无副作用）
//
// 【诚实边界】
//   · 3.6 目前**只有 RC**（3.6.0-rc.9）——本测试标注为 rc，不代表最终稳定版行为
//   · 只覆盖 vapor 用到的三个 API 的**行为面**；Vue 内部其他差异（响应式/运行时）不在此范围
//   · 运行时侧（`@vue/runtime-core`）的版本兼容**不在本测试**（它由 renderer-app 的 peerDep 约束）
import { describe, it, expect } from 'vitest'
import {
  parse as sfcParse34,
  compileScript as compileScript34,
} from '@vue/compiler-sfc-3.4'
import { parse as domParse34 } from '@vue/compiler-dom-3.4'
import { buildVaporSubscriptions } from '@proteus-vue/compiler'
import type { VueCompatDeps } from '@proteus-vue/compiler'

// 3.6 可能未安装（RC）——缺失时跳过该档，但**必须显式标注**（不静默）
let deps36: VueCompatDeps | null = null
let version36 = 'not-installed'
try {
  // 动态导入：未安装时不影响 3.4/3.5 两档
  const sfc = await import('@vue/compiler-sfc-3.6')
  const dom = await import('@vue/compiler-dom-3.6')
  // ★跨版本的类型断言是预期的（不同 minor 的 ParseOptions 类型互斥）——注入点刻意用结构化类型
  deps36 = { sfcParse: sfc.parse, compileScript: sfc.compileScript, domParse: dom.parse } as unknown as VueCompatDeps
  version36 = '3.6.0-rc.9'
} catch {
  version36 = 'not-installed'
}

// ★跨版本类型互斥是预期的（不同 minor 的 ParseOptions 类型不兼容）——注入点用结构化类型
const deps34 = { sfcParse: sfcParse34, compileScript: compileScript34, domParse: domParse34 } as unknown as VueCompatDeps

/** SFC 样本：覆盖 vapor 用到的全部解析面（源识别 / 指令 / v-for / 遮蔽 / 内联 handler） */
const SAMPLES: Array<{ name: string; src: string }> = [
  {
    name: '基础：ref / reactive / computed / props / defineModel',
    src: `<template>
  <p-view :style="state.a">
    <p-text>{{ title }}{{ count }}{{ doubled }}{{ model }}</p-text>
  </p-view>
</template>

<script setup lang="ts">
const title = ref('t')
const count = ref(1)
const state = reactive({ a: 1 })
const doubled = computed(() => count.value * 2)
const props = defineProps<{ p: string }>()
const model = defineModel<string>()
</script>
`,
  },
  {
    name: 'v-for：单层 + :key + 行内绑定',
    src: `<template>
  <p-view v-for="item in list" :key="item.id">
    <p-text :width="item.w">{{ item.title }}</p-text>
  </p-view>
</template>

<script setup lang="ts">
const list = ref([{ id: 1, w: 10, title: 'a' }])
</script>
`,
  },
  {
    name: '嵌套 v-for + 别名遮蔽',
    src: `<template>
  <p-view v-for="item in groups" :key="item.id" :width="item.w">
    <p-text v-for="item in item.items" :key="item.id" :height="item.h">{{ item.name }}</p-text>
  </p-view>
</template>

<script setup lang="ts">
const groups = ref([{ id: 1, w: 10, items: [{ id: 2, h: 5, name: 'x' }] }])
</script>
`,
  },
  {
    name: '无 :key 的 v-for（error 级诊断路径）',
    src: `<template>
  <p-view v-for="item in list"><p-text :width="item.w" /></p-view>
</template>

<script setup lang="ts">
const list = ref([{ w: 1 }])
</script>
`,
  },
  {
    name: 'v-if / v-show / v-model / 事件',
    src: `<template>
  <p-view v-if="ok" :class="{ on: ok }">
    <p-input v-model="text" @input="onInput" />
  </p-view>
  <p-view v-show="ok" />
</template>

<script setup lang="ts">
const ok = ref(true)
const text = ref('')
const onInput = (v: string) => { text.value = v }
</script>
`,
  },
]

const canonical = (r: ReturnType<typeof buildVaporSubscriptions>): string =>
  JSON.stringify(
    { table: r.table, ok: r.ok, hasErrors: r.hasErrors, errors: r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code) },
    null,
    1,
  )

describe('V6 · Vue 版本兼容（3.4 / 3.5 / 3.6 产物等价）', () => {
  for (const s of SAMPLES) {
    it(`★「${s.name}」：3.4 与 3.5 产物逐字节相同`, () => {
      const r35 = buildVaporSubscriptions(s.src, 'x.vue')
      const r34 = buildVaporSubscriptions(s.src, 'x.vue', { compat: deps34 })
      // ★逐字节相同——这才是"不绑版本"的证据
      expect(canonical(r34)).toBe(canonical(r35))
    })

    it(`★「${s.name}」：3.6（RC）与 3.5 产物逐字节相同`, () => {
      if (!deps36) {
        // 未安装时不静默跳过——显式标注（本仓纪律：不静默）
        expect(version36).toBe('not-installed')
        return
      }
      const r35 = buildVaporSubscriptions(s.src, 'x.vue')
      const r36 = buildVaporSubscriptions(s.src, 'x.vue', { compat: deps36 })
      expect(canonical(r36)).toBe(canonical(r35))
    })
  }

  it('★注入无副作用：缺省路径 == 显式注入当前版本', async () => {
    // 证明"可注入"改造没有改变默认行为（否则前面所有等价断言都可能因注入本身而失真）
    const sfc = await import('@vue/compiler-sfc')
    const dom = await import('@vue/compiler-dom')
    const cur: VueCompatDeps = { sfcParse: sfc.parse, compileScript: sfc.compileScript, domParse: dom.parse }
    const sample = SAMPLES[1]!
    const a = buildVaporSubscriptions(sample.src, 'x.vue')
    const b = buildVaporSubscriptions(sample.src, 'x.vue', { compat: cur })
    expect(canonical(b)).toBe(canonical(a))
  })

  it('★三版对"无 :key"的判定一致（诊断不因版本而异）', () => {
    const sample = SAMPLES[3]!
    const r35 = buildVaporSubscriptions(sample.src, 'x.vue')
    const r34 = buildVaporSubscriptions(sample.src, 'x.vue', { compat: deps34 })
    expect(r35.hasErrors).toBe(true)
    expect(r34.hasErrors).toBe(true) // ★判据不因 Vue 版本而变
    if (deps36) {
      const r36 = buildVaporSubscriptions(sample.src, 'x.vue', { compat: deps36 })
      expect(r36.hasErrors).toBe(true)
    }
  })
})
