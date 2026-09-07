/**
 * G-45 补丁一/二 —— 三态生命周期 + ABI 冻结协议（04/05 文档落地）
 *
 * ABI = 稳定层对插件暴露的契约：接口形状（G-28 SPI）+ 数据布局（G-43 Owned<T>）
 *       + 能力枚举（capabilities）+ 版本号 abi.major.minor.patch
 *
 * 兼容规则（05-abi-versioning §2，可执行）：
 *   兼容 ⇔ (基座.major == 插件.major) AND (基座.minor >= 插件.minor)
 *         AND 插件 features ⊆ 基座 expose 的 features
 *         AND 签名证书链同源（G-45.7）
 */

export interface AbiVersion {
  /** 破坏性变更（接口签名/数据布局/删除能力） */
  major: number
  /** 向后兼容增量（新增 capability/新增末尾字段） */
  minor: number
  /** 实现修正，契约不变 */
  patch: number
}

/** 稳定层 ABI 契约（发布构建 freezeStableLayer 时冻结） */
export interface AbiContract {
  abi: AbiVersion
  /** 基座 expose 的 feature/capability 集合 */
  features: string[]
  /** 签名证书链标识（同源校验，G-45.7） */
  signatureChain: string
}

export type AbiRejectReason =
  | 'G45_ABI_MAJOR_MISMATCH'
  | 'G45_ABI_MINOR_NEWER'
  | 'G45_ABI_FEATURE_NOT_EXPOSED'
  | 'G45_ABI_SIGN_CHAIN_MISMATCH'

export interface AbiCompatReport {
  compatible: boolean
  reason: AbiRejectReason | null
  detail?: string
}

/**
 * ABI 兼容性校验（发布构建 validateABICompat + DevHost 装载门禁双用途）。
 * 对应 ABI-01~06 conformance 用例。
 */
export function checkAbiCompat(base: AbiContract, plugin: AbiContract): AbiCompatReport {
  if (base.abi.major !== plugin.abi.major) {
    return {
      compatible: false,
      reason: 'G45_ABI_MAJOR_MISMATCH',
      detail: `base abi ${base.abi.major}.${base.abi.minor} vs plugin ${plugin.abi.major}.${plugin.abi.minor}——破坏性变更需新版本发布（05-abi-versioning §4.2）`,
    }
  }
  if (plugin.abi.minor > base.abi.minor) {
    return {
      compatible: false,
      reason: 'G45_ABI_MINOR_NEWER',
      detail: `plugin minor ${plugin.abi.minor} > base minor ${base.abi.minor}`,
    }
  }
  const missing = plugin.features.filter((f) => !base.features.includes(f))
  if (missing.length > 0) {
    return {
      compatible: false,
      reason: 'G45_ABI_FEATURE_NOT_EXPOSED',
      detail: `插件声明未 expose 的 feature：${missing.join(', ')}`,
    }
  }
  if (base.signatureChain !== plugin.signatureChain) {
    return {
      compatible: false,
      reason: 'G45_ABI_SIGN_CHAIN_MISMATCH',
      detail: '签名证书链不同源（G-45.7）',
    }
  }
  return { compatible: true, reason: null }
}

/* ================= 三态生命周期（dev / release / runtime） ================= */

export type DevHostMode = 'dev' | 'release' | 'runtime'

/** 运行态参数灰度条目（Remote Config 形态——非代码下发，G-45.10） */
export interface FeatureFlag {
  enabled: boolean
  /** 语义参数（如 Glass L1/L2/L3） */
  level?: string
}

/* ================= ABI 感知的双层 cacheKey（05-abi-versioning §5） ================= */

export interface AbiCacheKeyInput {
  frameworkVersion: string
  /** abi.major.minor 形态（如 '1.3'） */
  abi: string
  /** 所有插件 manifest 的哈希（任一 manifest 变更 → 稳定层重建） */
  backendManifestHash?: string
  /** 签名证书链哈希 */
  signatureChainHash?: string
}

/** 稳定层 cacheKey 精确化：与页面数/业务规模无关（CMP086），但 manifest/签名链变化会合理失效 */
export function stableLayerCacheKey(input: AbiCacheKeyInput): string {
  let key = `base:${input.frameworkVersion}:${input.abi}`
  if (input.backendManifestHash) key += `:m:${input.backendManifestHash}`
  if (input.signatureChainHash) key += `:s:${input.signatureChainHash}`
  return key
}
