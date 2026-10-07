// packages/cli/src/config-validate.ts
// ★types-plan B5：配置校验器（validateConfig）——手写校验（铁律 #1：不引入 zod 等运行时依赖）
// 放 CLI 侧（对齐 component-audit/i18n-check 治理工具模式）；ProteusConfig 类型在 @proteus-vue/types
// ★★★2026-10-08 配置模型 v4（决策 #641）：**按端分区**——校验对象为**归一后的 v4 形态**
//   （config:check 先经 resolveProteusConfig 归一，故 v3 旧文件自动通过并提示迁移）。
// 错误码：CONFIG_INVALID_ROOT / CONFIG_MISSING_REQUIRED / CONFIG_INVALID_TYPE / CONFIG_INVALID_ENUM / CONFIG_UNKNOWN_FIELD

import { checkConfigLayerViolations, AUDIT_RULE_IDS, AUDIT_SEVERITIES } from '@proteus-vue/types'

export interface ConfigValidationError {
  code: string
  path: string
  message: string
}

export type ConfigValidationResult = { ok: true } | { ok: false; errors: ConfigValidationError[] }

/** 顶层必填字段：字段名 → 期望类型（'object' 需非 null 对象） */
const REQUIRED_FIELDS: Array<[string, string]> = [
  ['targets', 'object'],
  ['pagesDir', 'string'],
]

/** 顶层已知字段白名单（未知字段 = 拼写错误，阻断）——v4 只剩跨端共享面 */
const KNOWN_FIELDS = new Set(['version', 'targets', 'pagesDir', 'app', 'router', 'compiler', 'layout', 'budget', 'vite', 'audit', 'gates'])

/** 已知目标端键（targets.<key>） */
const KNOWN_TARGETS = new Set(['web', 'mp', 'ios', 'android', 'harmony'])

/** router 段已知子键白名单 */
const ROUTER_SECTION_FIELDS = new Set(['routesOutput', 'subPackages', 'customRoute', 'tabBar', 'pages', 'meta'])

/** 共享 app 身份已知子键 */
const APP_IDENTITY_FIELDS = new Set(['name', 'version', 'buildNumber'])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** 分包数组校验 */
function validateSubPackages(v: unknown, path: string, errors: ConfigValidationError[]): void {
  if (!Array.isArray(v)) {
    errors.push({ code: 'CONFIG_INVALID_TYPE', path, message: `${path} 应为数组` })
    return
  }
  for (let i = 0; i < v.length; i++) {
    const sp = v[i]
    if (!isPlainObject(sp) || typeof sp.root !== 'string') {
      errors.push({ code: 'CONFIG_INVALID_TYPE', path: `${path}[${i}].root`, message: `分包 ${i} 的 root 必须为字符串（如 "src/subpackages/order"）` })
    }
  }
}

/** customRoute 校验 */
function validateCustomRoute(v: unknown, path: string, errors: ConfigValidationError[]): void {
  if (!isPlainObject(v)) {
    errors.push({ code: 'CONFIG_INVALID_TYPE', path, message: `${path} 应为对象（{ registerPresets?, builders? }）` })
    return
  }
  if (v.registerPresets !== undefined && typeof v.registerPresets !== 'boolean') {
    errors.push({ code: 'CONFIG_INVALID_TYPE', path: `${path}.registerPresets`, message: `${path}.registerPresets 应为 boolean` })
  }
  if (v.builders !== undefined) {
    if (!isPlainObject(v.builders)) {
      errors.push({ code: 'CONFIG_INVALID_TYPE', path: `${path}.builders`, message: `${path}.builders 应为 Record<string, string>（builder 名 → 预设源码文件）` })
    } else {
      for (const [name, file] of Object.entries(v.builders)) {
        if (typeof file !== 'string') {
          errors.push({ code: 'CONFIG_INVALID_TYPE', path: `${path}.builders.${name}`, message: `${path}.builders.${name} 应为字符串（预设源码文件路径）` })
        }
      }
    }
  }
}

const posInt = (path: string, v: unknown, errors: ConfigValidationError[]) => {
  if (v !== undefined && (!Number.isInteger(v) || (v as number) < 1)) errors.push({ code: 'CONFIG_INVALID_TYPE', path, message: `${path} 应为正整数` })
}
const strArr = (path: string, v: unknown, errors: ConfigValidationError[]) => {
  if (v !== undefined && (!Array.isArray(v) || !v.every((x) => typeof x === 'string'))) errors.push({ code: 'CONFIG_INVALID_TYPE', path, message: `${path} 应为字符串数组` })
}
const optStr = (path: string, v: unknown, errors: ConfigValidationError[]) => {
  if (v !== undefined && typeof v !== 'string') errors.push({ code: 'CONFIG_INVALID_TYPE', path, message: `${path} 应为字符串` })
}
const optBool = (path: string, v: unknown, errors: ConfigValidationError[]) => {
  if (v !== undefined && typeof v !== 'boolean') errors.push({ code: 'CONFIG_INVALID_TYPE', path, message: `${path} 应为 boolean` })
}
const optEnum = (path: string, v: unknown, allowed: string[], errors: ConfigValidationError[]) => {
  if (v !== undefined && !allowed.includes(v as string)) errors.push({ code: 'CONFIG_INVALID_ENUM', path, message: `${path} 仅支持 ${allowed.map((x) => `'${x}'`).join(' / ')}` })
}

/** 校验 targets 各端（v4 按端分区） */
function validateTargets(targets: Record<string, unknown>, errors: ConfigValidationError[]): void {
  let declared = 0
  for (const k of Object.keys(targets)) {
    if (!KNOWN_TARGETS.has(k)) {
      errors.push({ code: 'CONFIG_UNKNOWN_FIELD', path: `targets.${k}`, message: `未知目标端 "${k}"（合法：${[...KNOWN_TARGETS].join(' / ')}）` })
      continue
    }
    if (targets[k] !== undefined) {
      if (!isPlainObject(targets[k])) {
        errors.push({ code: 'CONFIG_INVALID_TYPE', path: `targets.${k}`, message: `targets.${k} 应为对象` })
        continue
      }
      declared++
    }
  }
  if (declared === 0) {
    errors.push({ code: 'CONFIG_MISSING_REQUIRED', path: 'targets', message: 'targets 至少声明一个端（web/mp/ios/android/harmony）' })
  }

  // mp 段：appid 必填 + 类型
  const mp = targets.mp
  if (isPlainObject(mp)) {
    if (typeof mp.appid !== 'string' || !mp.appid) {
      errors.push({ code: 'CONFIG_MISSING_REQUIRED', path: 'targets.mp.appid', message: 'targets.mp.appid 必填（小程序 AppID）' })
    }
    if (mp.renderer !== undefined && mp.renderer !== 'skyline' && mp.renderer !== 'webview') {
      errors.push({ code: 'CONFIG_INVALID_ENUM', path: 'targets.mp.renderer', message: `targets.mp.renderer 仅支持 "skyline" / "webview"，实际 ${JSON.stringify(mp.renderer)}` })
    }
    if (mp.style !== undefined) {
      const st = mp.style
      if (!isPlainObject(st)) errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'targets.mp.style', message: 'targets.mp.style 应为对象（{ px2rpx?, rpxRatio? }）' })
      else {
        if (st.px2rpx !== undefined && typeof st.px2rpx !== 'boolean') errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'targets.mp.style.px2rpx', message: 'targets.mp.style.px2rpx 应为 boolean' })
        if (st.rpxRatio !== undefined && typeof st.rpxRatio !== 'number') errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'targets.mp.style.rpxRatio', message: 'targets.mp.style.rpxRatio 应为 number' })
      }
    }
    if (mp.setDataBridge !== undefined) {
      const sdb = mp.setDataBridge
      if (!isPlainObject(sdb)) errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'targets.mp.setDataBridge', message: 'targets.mp.setDataBridge 应为对象（{ batchWindow?, perComponent? }）' })
      else {
        if (sdb.batchWindow !== undefined && typeof sdb.batchWindow !== 'number') errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'targets.mp.setDataBridge.batchWindow', message: 'targets.mp.setDataBridge.batchWindow 应为 number' })
        if (sdb.perComponent !== undefined && typeof sdb.perComponent !== 'boolean') errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'targets.mp.setDataBridge.perComponent', message: 'targets.mp.setDataBridge.perComponent 应为 boolean' })
      }
    }
    if (mp.globalStyle !== undefined && typeof mp.globalStyle !== 'string') {
      errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'targets.mp.globalStyle', message: 'targets.mp.globalStyle 应为字符串（CSS 文件路径）' })
    }
    if (mp.page !== undefined) {
      const pg = mp.page
      if (!isPlainObject(pg)) errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'targets.mp.page', message: 'targets.mp.page 应为对象（{ autoScrollContainer?, webviewPages? }）' })
      else {
        if (pg.autoScrollContainer !== undefined && typeof pg.autoScrollContainer !== 'boolean') errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'targets.mp.page.autoScrollContainer', message: 'targets.mp.page.autoScrollContainer 应为 boolean' })
        if (pg.webviewPages !== undefined && (!Array.isArray(pg.webviewPages) || !pg.webviewPages.every((x) => typeof x === 'string'))) errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'targets.mp.page.webviewPages', message: 'targets.mp.page.webviewPages 应为字符串数组' })
      }
    }
    if (mp.skylineLayout !== undefined && !isPlainObject(mp.skylineLayout)) {
      errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'targets.mp.skylineLayout', message: 'targets.mp.skylineLayout 应为对象（对齐开关布尔值）' })
    }
    if (mp.profileBoundary !== undefined) {
      const pb = mp.profileBoundary
      if (!isPlainObject(pb)) errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'targets.mp.profileBoundary', message: "targets.mp.profileBoundary 应为对象（{ level?: 'error' | 'warn' | 'off' }）" })
      else if (pb.level !== undefined && !['error', 'warn', 'off'].includes(pb.level as string)) {
        errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'targets.mp.profileBoundary.level', message: "targets.mp.profileBoundary.level 应为 'error' / 'warn' / 'off'" })
      }
    }
  }

  // android 段：正整数 + 字符串数组 + 应用标志
  const and = targets.android
  if (isPlainObject(and)) {
    posInt('targets.android.versionCode', and.versionCode, errors)
    posInt('targets.android.minSdk', and.minSdk, errors)
    posInt('targets.android.targetSdk', and.targetSdk, errors)
    strArr('targets.android.permissions', and.permissions, errors)
    optEnum('targets.android.orientation', and.orientation, ['portrait', 'landscape', 'unspecified'], errors)
    optStr('targets.android.icon', and.icon, errors)
    optStr('targets.android.launchPage', and.launchPage, errors)
    optStr('targets.android.theme', and.theme, errors)
    optStr('targets.android.networkSecurityConfig', and.networkSecurityConfig, errors)
    optStr('targets.android.appCategory', and.appCategory, errors)
    optBool('targets.android.allowBackup', and.allowBackup, errors)
    optBool('targets.android.largeHeap', and.largeHeap, errors)
    optBool('targets.android.hardwareAccelerated', and.hardwareAccelerated, errors)
    optBool('targets.android.supportsRtl', and.supportsRtl, errors)
    optBool('targets.android.usesCleartextTraffic', and.usesCleartextTraffic, errors)
  }
  // ios 段：字符串 / 数组 / 布尔 + 隐私说明对象
  const ios = targets.ios
  if (isPlainObject(ios)) {
    strArr('targets.ios.orientations', ios.orientations, errors)
    if (ios.deviceFamily !== undefined && (!Array.isArray(ios.deviceFamily) || !ios.deviceFamily.every((x) => Number.isInteger(x)))) {
      errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'targets.ios.deviceFamily', message: 'targets.ios.deviceFamily 应为整数数组（1=iPhone / 2=iPad）' })
    }
    optStr('targets.ios.bundleId', ios.bundleId, errors)
    optStr('targets.ios.displayName', ios.displayName, errors)
    optStr('targets.ios.version', ios.version, errors)
    optStr('targets.ios.buildNumber', ios.buildNumber, errors)
    optStr('targets.ios.minimumOSVersion', ios.minimumOSVersion, errors)
    optStr('targets.ios.launchPage', ios.launchPage, errors)
    optEnum('targets.ios.userInterfaceStyle', ios.userInterfaceStyle, ['light', 'dark', 'automatic'], errors)
    optStr('targets.ios.statusBarStyle', ios.statusBarStyle, errors)
    optBool('targets.ios.statusBarHidden', ios.statusBarHidden, errors)
    strArr('targets.ios.urlSchemes', ios.urlSchemes, errors)
    optStr('targets.ios.appCategory', ios.appCategory, errors)
    optBool('targets.ios.requiresFullScreen', ios.requiresFullScreen, errors)
    optStr('targets.ios.developmentRegion', ios.developmentRegion, errors)
    if (ios.privacyUsageDescriptions !== undefined) {
      const pud = ios.privacyUsageDescriptions
      if (!isPlainObject(pud)) {
        errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'targets.ios.privacyUsageDescriptions', message: 'targets.ios.privacyUsageDescriptions 应为对象（NSXxxUsageDescription → 用途字符串）' })
      } else {
        for (const [k, v] of Object.entries(pud)) {
          if (typeof v !== 'string') errors.push({ code: 'CONFIG_INVALID_TYPE', path: `targets.ios.privacyUsageDescriptions.${k}`, message: `privacyUsageDescriptions.${k} 应为字符串` })
          else if (!/^NS[A-Za-z]+UsageDescription$/.test(k)) errors.push({ code: 'CONFIG_INVALID_KEY', path: `targets.ios.privacyUsageDescriptions.${k}`, message: `键 "${k}" 应为完整 plist 键名（形如 NSCameraUsageDescription）` })
        }
      }
    }
  }
  // harmony 段：正整数 + 字符串数组 + 图标/类目/方向
  const hm = targets.harmony
  if (isPlainObject(hm)) {
    posInt('targets.harmony.versionCode', hm.versionCode, errors)
    strArr('targets.harmony.deviceTypes', hm.deviceTypes, errors)
    strArr('targets.harmony.permissions', hm.permissions, errors)
    optStr('targets.harmony.icon', hm.icon, errors)
    optStr('targets.harmony.appCategory', hm.appCategory, errors)
    optStr('targets.harmony.orientation', hm.orientation, errors)
  }
}

/** 校验 v4 ProteusConfig（纯函数；返回错误码 + 字段路径，供 CLI/CI 门禁消费） */
export function validateConfig(config: unknown): ConfigValidationResult {
  const errors: ConfigValidationError[] = []
  if (!isPlainObject(config)) {
    return { ok: false, errors: [{ code: 'CONFIG_INVALID_ROOT', path: '', message: '配置必须是对象（proteus.config.ts 默认导出）' }] }
  }
  const cfg = config as Record<string, unknown>

  for (const [field, type] of REQUIRED_FIELDS) {
    const v = cfg[field]
    if (v === undefined) {
      errors.push({ code: 'CONFIG_MISSING_REQUIRED', path: field, message: `缺少必填字段 ${field}` })
    } else if (type === 'object' ? !isPlainObject(v) : typeof v !== type) {
      errors.push({ code: 'CONFIG_INVALID_TYPE', path: field, message: `${field} 应为 ${type}，实际 ${Array.isArray(v) ? 'array' : typeof v}` })
    }
  }

  // targets（按端分区）
  if (isPlainObject(cfg.targets)) {
    validateTargets(cfg.targets as Record<string, unknown>, errors)
  }

  // 共享 app 身份（构建期写原生工程文件）
  if (cfg.app !== undefined) {
    if (!isPlainObject(cfg.app)) {
      errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'app', message: 'app 应为对象（{ name?, version?, buildNumber? }）' })
    } else {
      for (const k of Object.keys(cfg.app as Record<string, unknown>)) {
        if (!APP_IDENTITY_FIELDS.has(k)) errors.push({ code: 'CONFIG_UNKNOWN_FIELD', path: `app.${k}`, message: `app 段未知字段 "${k}"（合法：${[...APP_IDENTITY_FIELDS].join(' / ')}）` })
      }
    }
  }

  // router 段（项目级路由管理）：子键白名单 + 类型校验
  if (cfg.router !== undefined) {
    if (!isPlainObject(cfg.router)) {
      errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'router', message: 'router 应为对象（项目级路由管理段）' })
    } else {
      const router = cfg.router as Record<string, unknown>
      for (const k of Object.keys(router)) {
        if (!ROUTER_SECTION_FIELDS.has(k)) {
          errors.push({ code: 'CONFIG_UNKNOWN_FIELD', path: `router.${k}`, message: `router 段未知字段 "${k}"（合法字段：${[...ROUTER_SECTION_FIELDS].join(' / ')}）` })
        }
      }
      if (router.routesOutput !== undefined && typeof router.routesOutput !== 'string') {
        errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'router.routesOutput', message: 'router.routesOutput 应为字符串（路由表产物路径）' })
      }
      if (router.subPackages !== undefined) validateSubPackages(router.subPackages, 'router.subPackages', errors)
      if (router.customRoute !== undefined) validateCustomRoute(router.customRoute, 'router.customRoute', errors)
      if (router.tabBar !== undefined) {
        const tb = router.tabBar as Record<string, unknown>
        if (!isPlainObject(tb)) {
          errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'router.tabBar', message: 'router.tabBar 应为对象（{ color?, selectedColor?, list }）' })
        } else if (!Array.isArray(tb.list)) {
          errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'router.tabBar.list', message: 'router.tabBar.list 应为数组（{ name, text, icon? }）' })
        } else {
          for (let i = 0; i < tb.list.length; i++) {
            const item = tb.list[i]
            if (!isPlainObject(item) || typeof item.name !== 'string' || typeof item.text !== 'string') {
              errors.push({ code: 'CONFIG_INVALID_TYPE', path: `router.tabBar.list[${i}]`, message: `tab 项 ${i} 须为 { name: string, text: string, icon?: string }` })
            }
          }
        }
      }
    }
  }

  // audit（D-2 dogfooding 门禁）
  if (cfg.audit !== undefined) {
    const audit = cfg.audit as Record<string, unknown>
    if (!isPlainObject(audit)) {
      errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'audit', message: 'audit 应为对象（{ dir?, rules? }）' })
    } else {
      if (audit.dir !== undefined && typeof audit.dir !== 'string') {
        errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'audit.dir', message: 'audit.dir 应为字符串（被审计页面目录）' })
      }
      if (audit.rules !== undefined) {
        const rules = audit.rules as Record<string, unknown>
        if (!isPlainObject(rules)) {
          errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'audit.rules', message: 'audit.rules 应为对象（规则 id → severity）' })
        } else {
          for (const [ruleId, sev] of Object.entries(rules)) {
            if (!AUDIT_RULE_IDS.includes(ruleId as never)) {
              errors.push({ code: 'CONFIG_UNKNOWN_FIELD', path: `audit.rules.${ruleId}`, message: `未知 D-2 规则 "${ruleId}"（合法规则：${AUDIT_RULE_IDS.join(' / ')}）` })
            } else if (!AUDIT_SEVERITIES.includes(sev as never)) {
              errors.push({ code: 'CONFIG_INVALID_ENUM', path: `audit.rules.${ruleId}`, message: `规则 ${ruleId} 级别仅支持 ${AUDIT_SEVERITIES.join(' / ')}，实际 ${JSON.stringify(sev)}` })
            }
          }
        }
      }
    }
  }

  // gates（统一门禁开关）
  if (cfg.gates !== undefined) {
    const gates = cfg.gates as Record<string, unknown>
    if (!isPlainObject(gates)) {
      errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'gates', message: 'gates 应为对象（{ disabled?: string[] }）' })
    } else if (gates.disabled !== undefined) {
      if (!Array.isArray(gates.disabled) || !gates.disabled.every((x) => typeof x === 'string')) {
        errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'gates.disabled', message: 'gates.disabled 应为门禁/聚合域 id 字符串数组' })
      }
    }
  }

  // layout（柔性布局编译参数）
  if (cfg.layout !== undefined) {
    const lay = cfg.layout as Record<string, unknown>
    if (!isPlainObject(lay)) {
      errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'layout', message: 'layout 应为对象（{ designWidth?, fluidViewport? }）' })
    } else if (lay.designWidth !== undefined && typeof lay.designWidth !== 'number') {
      errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'layout.designWidth', message: 'layout.designWidth 应为数字' })
    }
  }

  // 未知顶层字段
  for (const k of Object.keys(cfg)) {
    if (!KNOWN_FIELDS.has(k)) {
      errors.push({ code: 'CONFIG_UNKNOWN_FIELD', path: k, message: `未知字段 "${k}"（可能拼写错误；合法字段：${[...KNOWN_FIELDS].join(' / ')}）` })
    }
  }
  // 跨层隐式依赖检测
  for (const e of checkConfigLayerViolations(cfg)) {
    const topField = e.path.split('.')[0]
    if (!KNOWN_FIELDS.has(topField)) continue
    errors.push(e)
  }

  return errors.length ? { ok: false, errors } : { ok: true }
}
