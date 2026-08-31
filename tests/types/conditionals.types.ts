// tests/types/conditionals.types.ts
// ★types-plus-plan B1（01 §2/§6）：条件类型工具类型级断言（正例 + @ts-expect-error 负例）
// 由根 vue-tsc 校验：负例若未报错 → @ts-expect-error 未使用 → 编译失败（防漂移）
import type { ExtractByPlatform, IfPlatform, RequiredBy } from '../../packages/types/src/utils'
import type { Platform } from '../../packages/types/src/index-shared'

// ---- IfPlatform：平台为 P 时取 T，否则 never ----
const webOnly: IfPlatform<'web', string> = 'web 端类型'
const notWeb: IfPlatform<'skyline', string> = 'skyline 端取 never'
void [webOnly, notWeb]

// ---- ExtractByPlatform：从带 platform 字段的联合中抽取成员 ----
interface AdapterWeb {
  platform: 'web'
  fetch: () => Promise<unknown>
}
interface AdapterSkyline {
  platform: 'skyline'
  wxRequest: () => Promise<unknown>
}
interface AdapterApp {
  platform: 'app'
  nativeCall: () => Promise<unknown>
}
type Adapter = AdapterWeb | AdapterSkyline | AdapterApp

const webAdapter: ExtractByPlatform<Adapter, 'web'> = {
  platform: 'web',
  fetch: async () => undefined,
}
// Extract 结果应为 AdapterWeb 形状（含 fetch 且无 wxRequest）
const fetchFn: () => Promise<unknown> = webAdapter.fetch
void fetchFn

// ---- RequiredBy：指定键必选 ----
type Base = { id?: string; name?: string }
const required: RequiredBy<Base, 'id'> = { id: 'u1', name: 'n1' }
// RequiredBy 后 id 必填（缺 id 应报错）
// @ts-expect-error RequiredBy<Base,'id'> 缺 id
const missingId: RequiredBy<Base, 'id'> = { name: 'n1' }

// ---- 负例：IfPlatform 收窄错误 ----
// @ts-expect-error IfPlatform<'web', string> 是 string，不能赋 number
const wrongType: IfPlatform<'web', string> = 42

void [notWeb, required, missingId, wrongType]
void (null as unknown as Platform)
