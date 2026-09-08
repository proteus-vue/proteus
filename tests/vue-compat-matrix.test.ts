// tests/vue-compat-matrix.test.ts
// ★2026-09-08 立项（proteus-compiler-vue-align-plan）：「Vue 全能力」基准线 SSOT 门禁。
// 覆盖：①矩阵完整性（名称唯一/必填字段/状态合法/unsupported·partial 有 note/来源）
//      ②vueCompatStatus / vueCompatLevel 规则（用户规则：unsupported+degrade→warning、无→error；partial→warning；aligned→none）
//      ③代表性 Vue 能力状态断言（aligned 核心/partial 受限/unsupported 反黑盒）
//      ④防漂移：关键 API 必须登记 + 漂移检测（改 matrix 必须先改本测试）
import { describe, it, expect } from 'vitest'
import { VUE_COMPAT_MATRIX, VUE_COMPAT_UNKNOWN, vueCompatStatus, vueCompatLevel } from '../packages/compiler/src/vue-compat'

const STATUSES = ['aligned', 'partial', 'unsupported'] as const

describe('Vue 全能力基准线 SSOT（proteus-compiler-vue-align-plan）', () => {
  it('名称全局唯一 + group/status 合法', () => {
    const names = VUE_COMPAT_MATRIX.map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
    for (const e of VUE_COMPAT_MATRIX) {
      expect(STATUSES).toContain(e.status)
      expect(['reactivity', 'component', 'lifecycle', 'template', 'sfc']).toContain(e.group)
    }
  })

  it('unsupported/partial 必须带 note（反黑盒：替代建议/原因），aligned 必带 source', () => {
    for (const e of VUE_COMPAT_MATRIX) {
      if (e.status !== 'aligned') {
        expect(e.note, `${e.name}（${e.status}）缺 note`).toBeTruthy()
      }
      expect(e.source, `${e.name} 缺 source`).toBeTruthy()
    }
  })

  it('unsupported 必须有 degrade 标志（undefined=无降级→error；true=有降级→warning）——用户规则 2', () => {
    for (const e of VUE_COMPAT_MATRIX) {
      if (e.status === 'unsupported') {
        // degrade 可为 undefined（无降级，error）或 true（有降级，warning）；不允许 false 歧义
        expect(e.degrade === undefined || e.degrade === true).toBe(true)
      }
    }
  })

  it('vueCompatLevel 规则（用户规则）：aligned→none；partial→warning；unsupported+degrade→warning；unsupported 无 degrade→error', () => {
    // aligned
    expect(vueCompatLevel({ ...VUE_COMPAT_UNKNOWN, name: 'ref', status: 'aligned', source: 'x' })).toBe('none')
    // partial → warning
    expect(vueCompatLevel({ ...VUE_COMPAT_UNKNOWN, name: 'p', status: 'partial', note: 'x', source: 'x' })).toBe('warning')
    // unsupported + degrade → warning
    expect(vueCompatLevel({ ...VUE_COMPAT_UNKNOWN, name: 'u1', status: 'unsupported', degrade: true, note: 'x', source: 'x' })).toBe('warning')
    // unsupported 无 degrade → error
    expect(vueCompatLevel({ ...VUE_COMPAT_UNKNOWN, name: 'u2', status: 'unsupported', note: 'x', source: 'x' })).toBe('error')
  })

  it('vueCompatStatus：已登记返回条目；未登记返回 VUE_COMPAT_UNKNOWN（unsupported 无降级→error，反黑盒兜底）', () => {
    expect(vueCompatStatus('ref').status).toBe('aligned')
    expect(vueCompatStatus('getCurrentInstance').status).toBe('unsupported')
    expect(vueCompatStatus('fn-name-xx').name).toBe(VUE_COMPAT_UNKNOWN.name)
    expect(vueCompatLevel(vueCompatStatus('fn-name-xx'))).toBe('error')
  })

  it('代表性能力状态（对齐框架既定基线）', () => {
    // aligned：书写面核心（vue-compat §1 主路径）+ reactivity-runtime spke 对齐的 reactive 族/守卫
    for (const a of ['ref', 'computed', 'watch', 'onMounted', 'defineProps', 'defineEmits', 'defineExpose', 'withDefaults', 'v-if', 'v-for', 'v-model', '<script setup>', '<style scoped>', 'provide', 'inject', 'nextTick', 'version', 'unref', 'toValue', 'isRef', 'watchEffect', 'watchPostEffect', 'watchSyncEffect', 'reactive', 'readonly', 'shallowReactive', 'shallowReadonly', 'isReactive', 'isReadonly', 'isProxy', 'isShallow', 'toRaw']) {
      expect(vueCompatStatus(a).status, `${a} 应为 aligned`).toBe('aligned')
    }
    // partial：语义受限（advance Batch 平台限制）——含 Step2 校准后降级项
    for (const p of ['onUpdated', 'onErrorCaptured', 'onBeforeUnmount', 'v-text', 'v-pre', 'v-once', 'defineSlots', 'defineComponent', 'defineModel', 'useModel']) {
      expect(vueCompatStatus(p).status, `${p} 应为 partial`).toBe('partial')
    }
    // unsupported：运行时对内 API / 动态渲染 / 无对等平台能力——含 Step2 校准（运行时守卫/内部渲染助手/宏未对齐降 unsupported 无降级→error）
    for (const u of ['getCurrentInstance', 'useSlots', 'useAttrs', 'h', 'createApp', '<component :is>', '自定义指令', 'resolveComponent', 'renderSlot', 'mergeProps', 'toHandlers', 'withCtx', 'withScopeId', 'toRef', 'toRefs', 'defineOptions', 'effect', 'stop', 'proxyRefs', 'customRef', 'markRaw', 'toRef']) {
      expect(vueCompatStatus(u).status, `${u} 应为 unsupported`).toBe('unsupported')
      // 反黑盒：must 有 note；且按用户规则（无降级 → error）
      expect(vueCompatLevel(vueCompatStatus(u))).toBe('error')
    }
  })

  it('用户决策 1（b）：运行时对内 API 归 unsupported 反黑盒（不翻译成框架标准）', () => {
    for (const u of ['getCurrentInstance', 'useSlots', 'useAttrs', 'h', 'createApp', 'proxyRefs', 'effectScope']) {
      expect(vueCompatStatus(u).status).toBe('unsupported')
      expect(vueCompatStatus(u).note, `${u} 应带替代建议/原因`).toBeTruthy()
    }
  })

  it('漂移护栏：修改 matrix 必须同步本测试（关键 API 落网清单一处不漏）', () => {
    // 防"删了 aligned 核心仍全绿"——固化代表性子集，删/改状态即红
    const core = VUE_COMPAT_MATRIX.filter((e) => e.status === 'aligned').map((e) => e.name)
    for (const must of ['ref', 'computed', 'watch', 'onMounted', 'defineProps']) {
      expect(core).toContain(must)
    }
  })
})
