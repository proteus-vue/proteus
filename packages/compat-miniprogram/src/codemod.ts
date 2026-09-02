// packages/compat-miniprogram/src/codemod.ts
// ★G-31 B6（proteus-component-semantics-plan migration.md §3）：`migrateMpSource` 纯函数迁移转换器
//   codemod 覆盖（幂等，跑两次结果一致——对齐 migrate-types 文本级规则集）：
//   ① 标签自动替换（AUTO_CODEMOD_TAGS：view→p-box 等 1:1）
//   ② 同步存储直改（wx.setStorageSync → useStorage().set，G-32 C15 目标 Hook；compat 层提供 useStorage 委托）
//   ③ 回调式 API 标注（wx.request({success}) 等 → [proteus-migrate:manual] 注释——原代码保留 compat 层兜底可跑）
//   ④ 语义识别标签标注（scroll-view/swiper → manual 注释——AI 辅助还原布局语义）
import { AUTO_CODEMOD_TAGS, MANUAL_TAGS, isManualTag } from './tags'

export const MANUAL_MARK = '[proteus-migrate:manual]'
const COMMENT_MARK = '[proteus-migrate:manual]'

/** 回调式 wx API 检测（success/fail/complete 回调体 + 目标映射提示） */
const CALLBACK_APIS: Array<{ re: RegExp; target: (m: string) => string }> = [
  { re: /\bwx\.request\s*\(/, target: () => 'wx.request → await useFetch(url)' },
  { re: /\bwx\.navigateTo\s*\(/, target: () => 'wx.navigateTo → router.push({ name, params })（路由名需建表）' },
  { re: /\bwx\.scanCode\s*\(/, target: () => 'wx.scanCode → native.scanQR()（awaitify）' },
  { re: /\bwx\.login\s*\(/, target: () => 'wx.login → auth.login()（链路合并）' },
  { re: /\bwx\.getLocation\s*\(/, target: () => 'wx.getLocation → useLocation()' },
  { re: /\bwx\.showModal\s*\(/, target: () => 'wx.showModal → platform.ui.showModal（Promise）' },
  { re: /\bwx\.showActionSheet\s*\(/, target: () => 'wx.showActionSheet → platform.ui.showActionSheet（Promise）' },
]

/** 行内命中任意手动标签（scroll-view/swiper 等——语义识别） */
function findManualTag(line: string): string | null {
  const m = line.match(/<([a-zA-Z][\w-]*)[\s/>]/)
  if (!m) return null
  return isManualTag(m[1]) ? m[1] : null
}

/**
 * 迁移单个文件文本（幂等——跑两次结果一致）：
 * 1) 标签自动替换（view/button/input 等 1:1 → p-*）
 * 2) 同步存储 → useStorage()
 * 3) 回调式 API（wx.request({success}) 等）→ manual 标注（原代码保留，compat 层兜底可跑）
 * 4) 语义识别标签（scroll-view/swiper）→ manual 标注（AI 辅助还原布局语义）
 */
export function migrateMpSource(source: string): string {
  let out = source
  // —— ① 标签自动替换（幂等：替换后 p-* 不再匹配原标签）——
  for (const [mpTag, proteusTag] of Object.entries(AUTO_CODEMOD_TAGS)) {
    // 开放标签：<view 后跟空白|>|/（排除 viewer/view2 前缀）；幂等：替换后不再含 <view
    out = out.replace(new RegExp(`<${mpTag}(?=[\\s>/])`, 'g'), `<${proteusTag}`)
    // 闭合标签：</view>
    out = out.replace(new RegExp(`</${mpTag}\\s*>`, 'g'), `</${proteusTag}>`)
  }

  // —— ② 同步存储直改（幂等：wx.xxxSync 替换后不再命中）——
  out = out.replace(/\bwx\.setStorageSync\s*\(([^;]+)\)/g, 'useStorage().set($1)')
  out = out.replace(/\bwx\.getStorageSync\s*\(([^;]+)\)/g, 'useStorage().get($1)')
  out = out.replace(/\bwx\.removeStorageSync\s*\(([^;]+)\)/g, 'useStorage().remove($1)')
  out = out.replace(/\bwx\.clearStorageSync\s*\(/g, 'useStorage().clear()')

  // —— ③④ 逐行标注（幂等：行本身或上一行输出已含 manual mark 则跳过）——
  const lines = out.split('\n')
  const result: string[] = []
  for (const line of lines) {
    if (line.includes(COMMENT_MARK)) {
      result.push(line)
      continue
    }
    // ★幂等关键：标注是独立行——run2 时上一行输出已是标注（本行是它注释的代码行）→ 跳过不重复标
    const prevIsMark = result.length > 0 && result[result.length - 1].includes(COMMENT_MARK)
    const indent = line.match(/^\s*/)?.[0] ?? ''
    // ③ 回调式 API（success/fail 回调体）
    let annotated = false
    for (const { re, target } of CALLBACK_APIS) {
      if (re.test(line) && /success\s*[:=]/.test(line)) {
        if (!prevIsMark) result.push(`${indent}// ${COMMENT_MARK} ${target(line)}`)
        annotated = true
        break
      }
    }
    if (annotated) {
      result.push(line)
      continue
    }
    // ④ 语义识别标签
    const manualTag = findManualTag(line)
    if (manualTag && !prevIsMark) {
      result.push(`${indent}<!-- ${COMMENT_MARK} <${manualTag}> → ${MANUAL_TAGS[manualTag]}（语义识别，AI 辅助） -->`)
    }
    result.push(line)
  }
  return result.join('\n')
}

/** 迁移统计（报告用） */
export interface MigrationStats {
  tagsReplaced: number
  storageReplaced: number
  manualAnnotations: number
}

/** 统计迁移量（在 migrateMpSource 后调用——基于前后差异计数） */
export function countMigration(source: string, migrated: string): MigrationStats {
  // ★[proteus-migrate:manual] 含方括号——不能 new RegExp（字符类），用 split 计数
  const manualAnnotations = migrated.split(COMMENT_MARK).length - 1
  let tagsReplaced = 0
  for (const mpTag of Object.keys(AUTO_CODEMOD_TAGS)) {
    const before = (source.match(new RegExp(`<${mpTag}(?=[\\s>/])`, 'g')) ?? []).length
    const after = (migrated.match(new RegExp(`<${mpTag}(?=[\\s>/])`, 'g')) ?? []).length
    tagsReplaced += before - after
  }
  const storageReplaced = (migrated.match(/useStorage\(\)\.(set|get|remove|clear)\(/g) ?? []).length
  return { tagsReplaced, storageReplaced, manualAnnotations }
}