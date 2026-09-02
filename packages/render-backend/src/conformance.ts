// packages/render-backend/src/conformance.ts
// ★G-27 B1 conformance test：验证后端接口完整性（M1 退出标准 3——能验证假 Backend 的接口完整性）
//   后端实现者跑 runBackendConformance(backend) 自检：必选方法存在 + createElement 唯一句柄 +
//   能力声明枚举合法 + 可选方法类型；行为正确性由官方后端自带单测兜底（headless/vue-dom 单测）。
//   零依赖纯逻辑。
import type { ProteusRenderBackend } from './spi'

export interface ConformanceCheck {
  name: string
  pass: boolean
  detail?: string
}

export interface ConformanceResult {
  ok: boolean
  checks: ConformanceCheck[]
}

const LAYOUT_VALUES = ['yoga', 'native', 'none']
const GLASS_VALUES = ['L3', 'L2', 'L1', 'none']
const BLUR_VALUES = ['true', 'approximate', 'none']
const ANIMATION_VALUES = ['native', 'js', 'none']
const INPUT_VALUES = ['touch', 'cursor', 'remote', 'dial', 'voice']

const REQUIRED_METHODS: Array<keyof ProteusRenderBackend> = ['createElement', 'insert', 'remove', 'patchProp', 'setText']
const OPTIONAL_METHODS: Array<keyof ProteusRenderBackend> = [
  'querySelector',
  'measure',
  'layout',
  'scheduleFrame',
  'flush',
  'dispatchInput',
  'onMount',
  'onUnmount',
  'registerExternalTexture',
  'unregisterExternalTexture',
]

/**
 * 后端接口完整性自检（RND002：后端必须通过 conformance test）
 * - 必选方法缺失 → fail（detail 指明缺失方法）
 * - createElement 两次调用须返回不同句柄（唯一性）
 * - capabilities 枚举值非法 → fail
 * - 可选方法存在时须为函数
 */
export function runBackendConformance(backend: ProteusRenderBackend): ConformanceResult {
  const checks: ConformanceCheck[] = []

  function check(name: string, pass: boolean, detail?: string): void {
    checks.push({ name, pass, detail })
  }

  // 1. 身份声明
  check('id', typeof backend.id === 'string' && backend.id.length > 0, `id=${String(backend.id)}`)
  check('version', typeof backend.version === 'string' && backend.version.length > 0, `version=${String(backend.version)}`)

  // 2. 必选方法存在且为函数
  for (const m of REQUIRED_METHODS) {
    const fn = backend[m]
    check(`method.${String(m)}`, typeof fn === 'function', typeof fn === 'function' ? undefined : `缺失方法 ${String(m)}`)
  }

  // 3. createElement 唯一句柄（多次调用返回不同引用）
  let unique = true
  try {
    const a = backend.createElement({ type: 'view', props: {}, children: [] })
    const b = backend.createElement({ type: 'view', props: {}, children: [] })
    unique = a !== b
  } catch (e) {
    unique = false
    check('createElement.unique', false, 'createElement 抛错: ' + (e as Error).message)
  }
  if (!checks.some((c) => c.name === 'createElement.unique')) {
    check('createElement.unique', unique, unique ? undefined : '两次调用返回相同句柄（非唯一）')
  }

  // 4. 能力声明枚举合法
  const caps = backend.capabilities
  if (!caps) {
    check('capabilities', false, '缺失 capabilities 声明')
  } else {
    check('capabilities.layout', LAYOUT_VALUES.indexOf(caps.layout) >= 0, `layout=${String(caps.layout)}`)
    check('capabilities.glass', GLASS_VALUES.indexOf(caps.glass) >= 0, `glass=${String(caps.glass)}`)
    check('capabilities.blur', BLUR_VALUES.indexOf(caps.blur) >= 0, `blur=${String(caps.blur)}`)
    check('capabilities.animation', ANIMATION_VALUES.indexOf(caps.animation) >= 0, `animation=${String(caps.animation)}`)
    const badInput = (caps.input || []).filter((i) => INPUT_VALUES.indexOf(i) < 0)
    check('capabilities.input', badInput.length === 0, badInput.length ? `非法 input 类型: ${badInput.join(',')}` : undefined)
  }

  // 5. 可选方法存在时须为函数
  for (const m of OPTIONAL_METHODS) {
    const fn = backend[m]
    if (fn !== undefined && fn !== null && typeof fn !== 'function') {
      check(`optional.${String(m)}`, false, `可选方法 ${String(m)} 非函数`)
    }
  }

  return { ok: checks.every((c) => c.pass), checks }
}
