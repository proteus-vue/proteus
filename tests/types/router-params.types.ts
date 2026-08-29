// tests/types/router-params.types.ts
// 类型提示全链路步骤 2：router.push 泛型推导（name 受限 + params 类型匹配）
// 本文件仅类型断言（vue-tsc 检查），不运行——`// @ts-expect-error` 行在类型不匹配时应报错
// 运行验证：npx vue-tsc --noEmit（纳入全项目类型检查）
import { router } from '../../src/router'

// ✅ 正例：命名路由 + 匹配参数（user-profile 声明 { id?: string; from?: string }）
router.push({ name: 'user-profile', params: { id: '42' } })
router.push({ name: 'user-profile', params: { id: '42', from: 'index' } })

// ✅ 正例：无参数路由 / path 跳转
router.push({ name: 'index' })
router.push({ name: 'user-profile' })
router.push({ path: '/pages/forms', params: { any: 'ok' } })

// ✅ 正例：name 受限于路由名
router.push({ name: 'forms' })

// ❌ 负例：参数类型不匹配（id 应为 string，number 报错）
// @ts-expect-error user-profile 的 id 声明为 string
router.push({ name: 'user-profile', params: { id: 42 } })

// ❌ 负例：未声明参数字段（多余属性，非条件类型 → EPC 生效）
// @ts-expect-error user-profile 未声明 extra 参数
router.push({ name: 'user-profile', params: { extra: 'x' } })

// ❌ 负例：未知路由名报错（name 受限为路由名）
// @ts-expect-error 非路由名
router.push({ name: 'not-a-route' })

// ============ 步骤 3：页面 onLoad 参数类型（PageOnLoad） ============
import type { PageOnLoad } from '../../src/router/types'

// ✅ 正例：onLoad 参数匹配本路由声明
const opts: PageOnLoad<'user-profile'> = { id: '1', from: 'index' }
void opts

// ❌ 负例：参数类型不匹配
// @ts-expect-error user-profile 的 id 声明为 string
const badOpts: PageOnLoad<'user-profile'> = { id: 42 }
void badOpts

// ❌ 负例：非路由名
// @ts-expect-error 非路由名不能作为 PageOnLoad 泛型参数
const badName: PageOnLoad<'not-a-route'> = {}
void badName

// ============ 步骤 4：事件处理器类型（MpEvent / MpInputEvent / TapEvent） ============
// MpEvent/MpInputEvent/TapEvent 是全局声明（src/shims/events.d.ts），无需 import

// ✅ 正例：MpInputEvent → e.detail.value: string
function onInput(e: MpInputEvent): string {
  return e.detail.value
}
void onInput

// ✅ 正例：TapEvent → e.currentTarget.dataset.url
function onTap(e: TapEvent): string {
  return e.currentTarget.dataset.url
}
void onTap

// ✅ 正例：泛型 MpEvent<TDetail> 自定义 detail
function onCustom(e: MpEvent<{ value?: number }>): number | undefined {
  return e.detail.value
}
void onCustom

// ❌ 负例：MpInputEvent 的 detail.value 是 string，赋 number 报错
// @ts-expect-error detail.value 是 string
const badInput: number = (null as unknown as MpInputEvent).detail.value
void badInput

export {}
