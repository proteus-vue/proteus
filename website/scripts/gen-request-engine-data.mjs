#!/usr/bin/env node
// website/scripts/gen-request-engine-data.mjs —— ★★★Phylax（请求治理层）产品页的**数据同源生成器**
//
// 【为什么（与 gen-css-engine-data.mjs 同一纪律）】`/phylax` 产品页要展示判据条数、
//   痛点覆盖、包结构、两条通道——这些是**机器产物**（`docs/generated/request-engine-numbers.json`，
//   由 `scripts/gen-request-engine-numbers.mjs` 从各源读出）。
//   页面若手写数字，产物一动页面就"说谎"（本仓亲历：白皮书三处数字静默漂移、无门禁覆盖）。
//   ⇒ SSOT = 上面那份 json；本脚本产出 `website/src/data/request-engine-page.ts`（生成物，勿手改）；
//     `--check` 供 CI/verify 防漂移。
//
// 用法：node website/scripts/gen-request-engine-data.mjs          # 生成
//       node website/scripts/gen-request-engine-data.mjs --check  # 门禁（漂移 exit 1）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const NUMBERS = path.join(ROOT, 'docs/generated/request-engine-numbers.json')
const OUT_TS = path.join(ROOT, 'website/src/data/request-engine-page.ts')
const CHECK = process.argv.includes('--check')

if (!fs.existsSync(NUMBERS)) {
  console.error(`✗ 缺 ${path.relative(ROOT, NUMBERS)}——先跑 node scripts/gen-request-engine-numbers.mjs`)
  process.exit(1)
}

const N = JSON.parse(fs.readFileSync(NUMBERS, 'utf8'))

/**
 * 页面叙事骨架（**非数字**部分，手写是允许的——它讲的是"为什么"，不是"多少"）。
 * ★数字一律从 N 取，这里不出现任何计数。
 */
const PAGE = {
  codename: 'Phylax',
  codenameZh: '守卫',
  codenameNote:
    'Phylax（φύλαξ）= 古希腊的守卫/守备官。本层不是"替你把请求发出去"（那是传输层），'
    + '而是"守住边界、验明身份、留下记录"——这正是它的职责范围。',
  numbers: N,
  /** 三个不可让步的判断（页面的论点骨架） */
  claims: [
    {
      no: '01',
      zh: '超时不是失败，是需要去查的状态。',
      en: 'A timeout is not a failure. It is a state to reconcile.',
      bodyZh: '主流库把超时归入失败，业务于是重试——对支付来说这就是重复扣款。本层把结果分成三态：确定成功 / 确定失败 / **结果未知**。判不出来时保守归入 unknown，宁可让业务多查一次单。',
      bodyEn: 'Mainstream libraries classify a timeout as failure, so the business retries — which for payments means charging twice. This layer splits results into three states: success, failed, and **unknown**. When we cannot tell, we err on unknown: better one extra reconciliation than one duplicate charge.',
    },
    {
      no: '02',
      zh: '加固不能只做在一条通道上。',
      en: 'Hardening one channel hardens nothing.',
      bodyZh: '平台给 HTTP 配了白名单、审计、配额，业务换个 API（useWebSocket）就全绕过。而 WS 在审计里看着"只是条连接"，却能无限期收发——最适合把数据悄悄外传。⇒ 本层的策略链对两条通道同时生效。',
      bodyEn: 'The platform allowlists, audits and quotas HTTP. The business switches one API call to useWebSocket and bypasses all of it. And a WebSocket looks like "just a connection" in the audit log while being able to send and receive indefinitely — the ideal shape for quiet exfiltration. So the policy chain applies to both channels.',
    },
    {
      no: '03',
      zh: '多租户下，"相同请求"是个危险的定义。',
      en: 'Under multi-tenancy, "identical request" is a dangerous definition.',
      bodyZh: '去重键只含 method+url+body 时，A、B 两个业务请求同一接口、各带自己的 Authorization ⇒ 键相同 ⇒ 被合并 ⇒ A 拿到 B 的应答。反过来把全部 header 进键，追踪头又会让去重永不命中。⇒ 只收"会改变应答内容"的身份头，并且配了拦截器时干脆不去重。',
      bodyEn: 'With a key of method+url+body only, tenants A and B calling the same endpoint with their own Authorization headers collide into one request — A receives B\'s response. Put every header in the key instead, and per-request tracing headers make deduplication never hit. So we include only identity headers that change the response, and skip deduplication entirely when interceptors are configured.',
    },
  ],
  /** 三态（页面的核心可视化） */
  outcomes: [
    { id: 'success', zh: '确定成功', en: 'Succeeded', zhHint: '正常走', enHint: 'Proceed', tone: 'ok' },
    { id: 'failed', zh: '确定失败', en: 'Failed', zhHint: '请求没被处理，可重试', enHint: 'Never processed — retry is safe', tone: 'bad' },
    { id: 'unknown', zh: '结果未知', en: 'Unknown', zhHint: '可能已生效，去查单，不要重试', enHint: 'May have taken effect — reconcile, do not retry', tone: 'warn' },
  ],
  /** 两条通道的对照（策略链覆盖面） */
  channelRows: [
    { zh: '域名白名单', en: 'Domain allowlist', http: true, ws: true },
    { zh: '业务隔离（bizId）', en: 'Business isolation (bizId)', http: true, ws: true },
    { zh: '调用审计', en: 'Call audit', http: true, ws: true },
    { zh: '并发/连接配额', en: 'Concurrency / connection quota', http: true, ws: true },
    { zh: '载荷进日志', en: 'Payload in logs', http: false, ws: false },
  ],
  /** 三层结构（页面要讲清"内核与产品层为什么分开"） */
  layers: [
    {
      zh: '@proteus-vue/request', en: '@proteus-vue/request',
      zhRole: 'Vue 产品层 · vue 为 peerDependency', enRole: 'Vue product layer · vue as peerDependency',
      zhWhat: 'useQuery / useMutation / useRequest —— 只做响应式容器、竞态裁决、卸载取消',
      enWhat: 'useQuery / useMutation / useRequest — reactive container, race adjudication, unmount cancel only',
    },
    {
      zh: '@proteus-vue/api/request', en: '@proteus-vue/api/request',
      zhRole: '策略内核 · 平台中立 · 零 vue 依赖', enRole: 'Policy kernel · platform-neutral · zero Vue',
      zhWhat: '三态 · 幂等 · 断路器 · 离线队列 · 审计 · 脱敏 · 配额',
      enWhat: 'tri-state · idempotency · breaker · offline queue · audit · redaction · quota',
    },
    {
      zh: 'useFetch → bridge.request → 三端宿主', en: 'useFetch → bridge.request → three hosts',
      zhRole: '传输层', enRole: 'Transport',
      zhWhat: 'OkHttp / URLSession / RCP —— 本层不重实现传输',
      enWhat: 'OkHttp / URLSession / RCP — this layer does not reimplement transport',
    },
  ],
  /** 边界（对外表述纪律：写清不做什么） */
  boundaries: [
    { zh: '不接支付渠道 SDK（微信/支付宝/Apple IAP）——只管请求可靠性语义', en: 'No payment SDK integration (WeChat Pay / Alipay / Apple IAP) — reliability semantics only' },
    { zh: '不做 schema / OpenAPI 代码生成', en: 'No schema / OpenAPI code generation' },
    { zh: '断路器与配额是进程内状态，跨进程共享需宿主支持', en: 'Breaker and quota are in-process; cross-process sharing needs host support' },
    { zh: '脱敏是字段名匹配，不是内容识别', en: 'Redaction is field-name matching, not content detection' },
    { zh: 'unknown 之后能否正确处置是业务的责任——本层只保证状态诚实', en: 'Whether code handles unknown correctly is the business\'s responsibility — this layer only keeps the state honest' },
  ],
  /** 相关入口 */
  links: [
    { zh: '使用手册', en: 'Cookbook', to: '/docs/system/14-request-quickstart' },
    { zh: '设计理由', en: 'Design rationale', to: '/docs/system/13-request-governance' },
    { zh: 'useFetch（单请求门面）', en: 'useFetch (single-request facade)', to: '/docs/capability/fetch' },
  ],
}

const header =
  '// ⚠️ AUTO-GENERATED by website/scripts/gen-request-engine-data.mjs — DO NOT EDIT.\n'
  + '// SSOT：docs/generated/request-engine-numbers.json\n'
  + '// 重新生成：node website/scripts/gen-request-engine-data.mjs · 防漂移门禁：pnpm check:request-engine-data\n'

const ts = header + 'export const REQUEST_ENGINE_PAGE = ' + JSON.stringify(PAGE, null, 2) + ' as const\n'

if (CHECK) {
  if (!fs.existsSync(OUT_TS)) {
    console.error(`✗ 缺 ${path.relative(ROOT, OUT_TS)}——先跑 node website/scripts/gen-request-engine-data.mjs`)
    process.exit(1)
  }
  if (fs.readFileSync(OUT_TS, 'utf8') !== ts) {
    console.error('✗ Phylax 产品页数据与 SSOT 不一致（页面数字会谎报）')
    console.error('    修复：node website/scripts/gen-request-engine-data.mjs')
    process.exit(1)
  }
  console.log(`✅ Phylax 产品页数据与 SSOT 一致（判据 ${N.criteria.total} 条）`)
} else {
  fs.mkdirSync(path.dirname(OUT_TS), { recursive: true })
  fs.writeFileSync(OUT_TS, ts)
  console.log(`✅ 已生成 ${path.relative(ROOT, OUT_TS)}（判据 ${N.criteria.total} 条 · ${N.criteria.files} 组）`)
}
