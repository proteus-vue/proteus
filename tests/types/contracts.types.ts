// tests/types/contracts.types.ts
// ★架构规约 L0 / types-plan §07：跨层 DTO 契约类型级断言（正例 + @ts-expect-error 负例）
// 由根 vue-tsc 校验：负例若未报错 → @ts-expect-error 未使用 → 编译失败（防漂移）
import type { ApiResponse, CapabilityDescriptor, RouteMeta, RouteRecord, StoreSnapshot, RouteTransition } from '@proteus-vue/contracts'
// types 包 re-export 兼容（消费方经 @proteus-vue/types 零改动）
import type { RouteRecord as TSRouteRecord, RouteMeta as TSRouteMeta, RouteTransition as TSRouteTransition } from '@proteus-vue/types'
import type { RouteTransition as TSSharedTransition } from '@proteus-vue/types'

// ---- 正例：RouteRecord 形状（name/path/component 必填） ----
const route: RouteRecord = {
  name: 'user-profile',
  path: '/pages/user/profile',
  component: '/pages/user/profile.vue',
  meta: { title: '个人资料', transition: 'halfScreen', requiresAuth: true },
  subPackage: 'user',
}
const transition: RouteTransition = route.meta?.transition ?? 'none'
void [route, transition]

// ---- types re-export 一致性（同名必同义，铁律 #9） ----
const viaTypes: TSRouteRecord = route
const viaMeta: TSRouteMeta = route.meta ?? {}
const viaShared: TSRouteTransition = transition
const viaShared2: TSSharedTransition = transition
void [viaTypes, viaMeta, viaShared, viaShared2]

// ---- ApiResponse / StoreSnapshot / CapabilityDescriptor ----
const resp: ApiResponse<{ ok: boolean }> = { data: { ok: true }, status: 200, headers: { 'x-test': '1' } }
const snap: StoreSnapshot = { id: 'player', state: { volume: 0.8 }, timestamp: 1700000000000 }
const cap: CapabilityDescriptor = { id: 'clipboard', tier: 2, platforms: ['web', 'skyline'], source: 'capabilities/clipboard.capability.ts' }
void [resp, snap, cap]

// ---- 负例：缺必填字段 / 类型错误 ----
// @ts-expect-error RouteRecord 缺 component
const badRoute: RouteRecord = { name: 'x', path: '/x' }
// @ts-expect-error RouteRecord.name 须为 string
const badName: RouteRecord = { name: 42, path: '/x', component: '/x.vue' }
// @ts-expect-error RouteMeta.transition 是枚举（'fade' 非法）
const badTransition: RouteMeta = { transition: 'fade' }
// @ts-expect-error ApiResponse.data 与泛型不符
const badResp: ApiResponse<number> = { data: 'str', status: 200 }
// @ts-expect-error CapabilityDescriptor.tier 须为 number
const badCap: CapabilityDescriptor = { id: 'x', tier: 'L2', platforms: [] }

void [badRoute, badName, badTransition, badResp, badCap]
