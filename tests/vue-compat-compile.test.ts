// tests/vue-compat-compile.test.ts
// ★2026-09-08 立项（proteus-compiler-vue-align-plan）P0 Step 3：编译器接线——<script setup> 的 vue 命名导入查「Vue 全集基准线」，
//   aligned 静默翻译 / partial·unsupported+degrade 编译期警告 / unsupported 无降级 抛 CompilerError（反黑盒 fail-closed）。
import { describe, it, expect } from 'vitest'
import { compileVueSfc, CompilerError } from '../packages/compiler/src/index'

const opts = { px2rpx: true, rpxRatio: 2 }

function makeSfc(imports: string, setup: string, template = '<template><view>{{x}}</view></template>') {
  return `<script setup lang="ts">\n${imports}\n${setup}\n</script>\n${template}`
}

describe('编译器接线：vue 命名导入 × Vue 全集基准线', () => {
  it('aligned API（ref/computed/onMounted 等）→ 正常编译（无 CompilerError）', () => {
    const src = makeSfc(
      "import { ref, computed, watch } from 'vue'",
      "const x = ref(0)\nconst y = computed(() => x.value + 1)\nwatch(x, () => {})",
    )
    const r = compileVueSfc(src, { filename: 'pages/probe.vue', ...opts })
    expect(r.js).toContain('x: 0') // ref → data
    expect(r.js).toMatch(/proteusWatchX/) // watch → proteusWatchX 方法
    // computed 未在模板引用为死代码（Vue 惰性）——不生成 proteusCalcY，属正常；aligned 不产生 Vue API 警告
    expect(r.warnings.filter((w) => w.includes('Vue API'))).toEqual([])
  })

  it('unsupported 无降级（getCurrentInstance）→ 抛 CompilerError（反黑盒 fail-closed）', () => {
    const src = makeSfc(
      "import { getCurrentInstance } from 'vue'",
      "const inst = getCurrentInstance()",
    )
    expect(() => compileVueSfc(src, { filename: 'pages/probe.vue', ...opts })).toThrow(CompilerError)
    // 报错信息含 API 名 + 替代建议
    try {
      compileVueSfc(src, { filename: 'pages/probe.vue', ...opts })
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).toContain('getCurrentInstance')
      expect((e as Error).message).toContain('单独立项框架语义 API')
    }
  })

  it('unsupported 无降级（h / createApp / useSlots）→ 抛 CompilerError', () => {
    for (const api of ['h', 'createApp', 'useSlots']) {
      const src = makeSfc(`import { ${api} } from 'vue'`, 'const x = 1')
      expect(() => compileVueSfc(src, { filename: `p-${api}.vue`, ...opts }), `${api} 应抛 CompilerError`).toThrow(CompilerError)
    }
  })

  it('partial（onErrorCaptured / onBeforeUnmount）→ 编译期警告（不抛错，带 note）', () => {
    // onErrorCaptured 在矩阵为 partial（degrade）→ warning
    const src = makeSfc(
      "import { onErrorCaptured } from 'vue'",
      "onErrorCaptured(() => { return false })",
    )
    const r = compileVueSfc(src, { filename: 'pages/probe.vue', ...opts })
    expect(r.warnings.some((w) => w.includes('onErrorCaptured') && w.includes('Vue API'))).toBe(true)
  })

  it('现有 aligned 生态（provide/inject）正常不收 Vue API 警告', () => {
    const src = makeSfc(
      "import { provide } from 'vue'",
      "provide('k', 1)",
    )
    const r = compileVueSfc(src, { filename: 'pages/probe.vue', ...opts })
    expect(r.warnings.filter((w) => w.includes('Vue API'))).toEqual([])
  })
})
