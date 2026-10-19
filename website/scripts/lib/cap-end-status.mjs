// website/scripts/lib/cap-end-status.mjs
// ★★★决策 #1089（2026-10-19）：能力「逐端状态」判定的**唯一实现**（页面表 + 总览汇总共用）。
//
// 【为什么要抽出来】判定原来只写在 `gen-content.mjs` 的两个渲染循环里（中文一套、英文一套），
//   总览页要做"全端兼容进度"就得**再算第三遍**——那正是 #1088 刚清掉的"同一事实写两遍"。
//   抽出后：每页的「兼容进度」表与总览的汇总表**必然一致**（同一次判定、同一个桶）。
//
// 【判定口径（数据来源都是源码/构建事实，不是手写清单）】
//   · 微信小程序：hook 依赖的桥方法是否都在 `wxBridge` 里
//   · Web：是否都在 `webBridge` 里（无桥依赖 ⇒ 平台桥默认注入）
//   · iOS / Android / 鸿蒙：`appEndStatus()`（读宿主源码，见 harmony-host-keys.mjs）
//   · Flutter / 快应用 / Headless：端注册表 `website/src/ends.ts` 的状态 + 固定说明
//
// 【状态四档】✅ 直接可用 · ⚠️ 端已落地但桥未提供 → 调用返回 `*.unsupported` 显式降级 ·
//   🟡 能力桥未接线 · ⬜ 端未开始（含 📋 规划已入库，汇总时并入"未开始"）。
import { appEndStatus } from './harmony-host-keys.mjs'
import { loadPureShellMembers } from './bridge-impl-reality.mjs'

/** ends.ts 的文档状态 → 四档标记 */
export const STATUS_MARK = { '✅ 已落地': '✅', '🟡 部分落地': '🟡', '📋 规划已入库': '📋', '⬜ 未开始': '⬜' }

/**
 * 逐端状态（某能力 × 全部端）。
 *
 * @param {object} o
 * @param {Array} o.ends            端注册表（website/src/ends.ts）
 * @param {string[]} o.refs         该能力 hook 依赖的桥方法名
 * @param {string} o.mpEquiv        小程序等价（zh 原文；EN 调用方传已降级文本）
 * @param {Set<string>} o.wxKeys    wxBridge 实有方法
 * @param {Set<string>} o.webKeys   webBridge 实有方法
 * @param {string} o.root           仓库根（读宿主源码用）
 * @param {string} o.capSlug        能力 slug（如 `keyboard`）
 * @param {Set<string>} o.appBridgeKeys   App 宿主桥方法集
 * @param {Set<string>} o.pushCapabilities 推送型能力（还需壳真的推）
 * @param {Set<string>} o.verified  真机已验证能力
 * @param {boolean} [o.en]          英文文案
 * @param {object} [o.enNotes]      `CAP_SHARED_EN.endNote`（英文文案 SSOT，必填 when en）
 * @returns {Record<string, { status: string, note: string }>} 键 = 端 id
 */
export function capabilityEndStatuses({
  ends, refs, mpEquiv, wxKeys, webKeys, root, capSlug,
  appBridgeKeys, pushCapabilities, verified, en = false, enNotes,
}) {
  if (en && !enNotes) throw new Error('[cap-end-status] 英文模式必须传 enNotes（避免文案写第二遍）')
  const wxMissing = refs.filter((r) => !wxKeys.has(r))
  const webMissing = refs.filter((r) => !webKeys.has(r))
  // ★#1090：桥成员**存在但方法体是纯空壳**（全部出口 unsupported、零平台调用）⇒ 恒 Err。
  //   仅"名字存在"就判 ✅ 会对外谎报（实测 Web 侧 11 处、MP 侧 1 处）。
  //   ★惰性内化：只需 `root`，调用方不必传（生成器是存量棘轮，多一行就超线）。
  const wxShellsHit = refs.filter((r) => shellsFor(root, 'mp')?.has(r))
  const webShellsHit = refs.filter((r) => shellsFor(root, 'web')?.has(r))
  const shellText = en ? SHELL_NOTE.en : SHELL_NOTE.zh
  const out = {}
  for (const end of ends) {
    let status = STATUS_MARK[end.status] ?? '⬜'
    let note
    switch (end.id) {
      case 'mp-weixin':
        if (wxShellsHit.length) {
          status = '⚠️'
          note = shellText.mp(wxShellsHit)
        } else {
          status = wxMissing.length ? '⚠️' : '✅'
          note = en
            ? enNotes.mp(wxMissing, mpEquiv)
            : (wxMissing.length ? `wx 桥未提供 ${wxMissing.join('/')} → Err 显式降级` : `wx 桥 → ${mpEquiv}`)
        }
        break
      case 'web':
        if (!refs.length) {
          note = en ? enNotes.webNoRefs : 'webBridge 平台桥（wx 缺席时默认注入）'
        } else if (webShellsHit.length) {
          status = '⚠️'
          note = shellText.web(webShellsHit)
        } else if (webMissing.length) {
          status = '⚠️'
          note = en ? enNotes.webMissing(webMissing) : `webBridge 未提供 ${webMissing.join('/')} → Err 显式降级（平台无直通 API）`
        } else {
          note = en ? enNotes.webOk : 'webBridge 实现（平台 API 直连）'
        }
        break
      case 'headless':
        note = en ? enNotes.headless : 'mock 桥注入（测试 / SSR 档）'
        break
      case 'flutter':
        note = en ? enNotes.flutter : '同一 JS 逻辑层——能力桥未接线'
        break
      case 'quick-app':
        note = en ? enNotes['quick-app'] : '端未开始'
        break
      case 'app-ios':
      case 'app-android':
      case 'app-harmony': {
        const a = appEndStatus(root, end.id === 'app-ios' ? 'ios' : end.id === 'app-android' ? 'android' : 'harmony', refs, appBridgeKeys, {
          capSlug, pushCapabilities, verified, en,
        })
        status = a.status
        note = a.note
        break
      }
      default:
        note = en ? enNotes.prototype : '渲染核心已落地——能力桥未接线'
    }
    out[end.id] = { status, note }
  }
  return out
}

/**
 * 汇总桶：把四档标记折叠成统计口径（总览页用）。
 * `📋 规划已入库` 并入 `planned`——对外都是"这个端还用不了"。
 */
export function bucketOf(status) {
  if (status === '✅') return 'ok'
  if (status === '⚠️') return 'degrade'
  if (status === '🟡') return 'unwired'
  return 'planned'
}

// ══════════════════════════════════════════════════════════════════
// 总览页的「全端兼容进度」汇总（#1089）
//   ★与逐页「兼容进度」表**同一份判定**（上面 capabilityEndStatuses）——不再另算一遍。
//   ★放在 lib 而不是 gen-content.mjs：生成器是 2300+ 行的存量棘轮（只减不增）。
// ══════════════════════════════════════════════════════════════════

/**
 * 汇总：端维度的四档计数 + 类别×端的 ✅/总数 矩阵。
 * @param {object} o 与 capabilityEndStatuses 同源的输入（另需 caps / hookRefs / catOf / capOrder）
 * @returns {{ endRows: Array, catRows: Array }}
 */
export function capabilityCoverage({ caps, ends, hookRefs, wxKeys, webKeys, catOf, capOrder, en = false, enNotes, root, appBridgeKeys, pushCapabilities, verified }) {
  const endIds = ends.map((e) => e.id)
  const zero = () => Object.fromEntries(endIds.map((id) => [id, 0]))
  const sums = { ok: zero(), degrade: zero(), unwired: zero(), planned: zero() }
  const catOrder = []
  const catAcc = {}
  for (const c of caps) {
    const hook = c.api.replace('()', '')
    const refs = hookRefs[hook] ?? []
    const capSlug = c.semantic.replace('capability.', '')
    const st = capabilityEndStatuses({
      ends, refs, mpEquiv: c.mpEquiv, wxKeys, webKeys, root, capSlug,
      appBridgeKeys, pushCapabilities, verified, en, enNotes,
    })
    const cat = catOf[c.semantic]
    if (!catAcc[cat]) { catAcc[cat] = { total: 0, ok: zero() }; catOrder.push(cat) }
    catAcc[cat].total++
    for (const id of endIds) {
      const b = bucketOf(st[id].status)
      sums[b][id]++
      if (b === 'ok') catAcc[cat].ok[id]++
    }
  }
  catOrder.sort((a, b) => capOrder.indexOf(a) - capOrder.indexOf(b))
  return {
    endRows: ends.map((e) => ({
      id: e.id, name: e.name, total: caps.length,
      ok: sums.ok[e.id], degrade: sums.degrade[e.id], unwired: sums.unwired[e.id], planned: sums.planned[e.id],
    })),
    catRows: catOrder.map((cat) => ({ cat, total: catAcc[cat].total, ok: catAcc[cat].ok })),
  }
}

/**
 * 汇总渲染（中英共用同一实现：列数/行数必须一致，否则 check:en-drift 会红）。
 * @param {string[]} idx     输出行累加器
 * @param {object} cov       capabilityCoverage() 的结果
 * @param {object} o         文案与标签（h2/intro/cols/h3/catIntro/catCols/endName/catName）
 */
export function renderCoverage(idx, cov, o) {
  idx.push(o.h2)
  idx.push('')
  idx.push(o.intro)
  idx.push('')
  idx.push(o.cols)
  idx.push('|---|---|---|---|---|---|')
  for (const r of cov.endRows) {
    const pct = r.total ? Math.round((r.ok / r.total) * 100) : 0
    idx.push(`| ${o.endName(r)} | ${r.ok} | ${r.degrade} | ${r.unwired} | ${r.planned} | ${pct}% |`)
  }
  idx.push('')
  idx.push(o.h3)
  idx.push('')
  idx.push(o.catIntro)
  idx.push('')
  idx.push(o.catCols)
  idx.push('|---|' + '---|'.repeat(cov.endRows.length))
  for (const cr of cov.catRows) {
    idx.push(`| ${o.catName(cr.cat)} | ${cov.endRows.map((r) => `${cr.ok[r.id]}/${cr.total}`).join(' | ')} |`)
  }
  idx.push('')
}

/**
 * ★#1090：一次性加载 Web / MP 两端的「纯空壳」桥成员集合（生成器只留一行调用）。
 * 判据实现在 `bridge-impl-reality.mjs`；这里只做装配——生成器是存量棘轮文件（只减不增）。
 * @param {string} root 仓库根
 * @returns {{WEB_SHELLS: Set<string>, MP_SHELLS: Set<string>}}
 */
export function loadBridgeShells(root) {
  return { WEB_SHELLS: loadPureShellMembers(root, 'web'), MP_SHELLS: loadPureShellMembers(root, 'mp') }
}

// ══════════════════════════════════════════════════════════════════
// 「纯空壳」桥成员（#1090）—— 惰性加载 + 文案，**生成器零感知**
//   ★为什么内化：判定所需的只有 `root`（已传），而生成器是存量棘轮文件（只减不增）。
//     让调用方逐处传 `wxShells/webShells/shellNotes` 会让 4 个调用点各 +1 行 ⇒ 越界。
// ══════════════════════════════════════════════════════════════════

const shellCache = new Map()

/** 某端的纯空壳桥成员集（按 root 缓存）。 */
function shellsFor(root, end) {
  if (!root) return undefined
  const key = root + '::' + end
  if (!shellCache.has(key)) shellCache.set(key, loadPureShellMembers(root, end))
  return shellCache.get(key)
}

/** 纯空壳的端说明文案（中英各一版；与页面表同源，不写第二份）。 */
export const SHELL_NOTE = {
  zh: {
    mp: (names) => `wx 桥 ${names.join('/')} 是纯空壳（恒 Err，无平台对接）→ 显式降级`,
    web: (names) => `webBridge ${names.join('/')} 是纯空壳（全部出口 unsupported）→ 恒 Err`,
  },
  en: {
    mp: (names) => `wx bridge ${names.join('/')} is a pure shell (always rejects, no platform integration) → explicit Err`,
    web: (names) => `webBridge ${names.join('/')} is a pure shell (every path returns unsupported, no platform integration) → always Err`,
  },
}

/**
 * ★#1090：能力页「兼容进度」的状态口径（中英共用一份事实——各端判据严格度不同，必须在页面上说清）。
 * 放在 lib 而不是生成器：后者是存量棘轮文件（只减不增）。
 */
export const CAP_LEGEND_ZH = '> 状态口径：✅ 端已落地·本能力可用；⚠️ 端已落地·桥未提供**或桥是纯空壳**→Err 显式降级（方法存在但每一条路径都返回 unsupported 不算可用）；🟡 能力桥未接线；⬜ 端未开始。★**各端判据严格度不同**：微信/Web 要求桥方法存在**且方法体真有平台对接**；iOS/Android 要求 App 桥工厂里有该方法；鸿蒙要求 JS 桥 + 宿主分派**双证据**。端架构对照见 [端与成熟度](/docs/framework/ends-matrix)。'
