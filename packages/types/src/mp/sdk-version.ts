// packages/types/src/mp/sdk-version.ts
// ★types-plus-plan B8（§10）：基础库版本 ↔ typings 版本对齐
// 策略：proteus.config 的 mp.libVersion 锁定目标基础库 → MpSdkVersion 映射对应 miniprogram-api-typings 版本，
// 避免「新 API 在旧基础库」的误用。映射表为维护表（随官方发版节奏更新），未知版本回退默认并告警。
// 零依赖，纯数据 + 校验函数。

/** 版本对齐元组：libVersion = 目标基础库版本；typingsVersion = 对应官方 typings 版本 */
export interface MpSdkVersion {
  /** 如 '3.0.0'（对齐 proteus.config mp.libVersion） */
  libVersion: string
  /** 如 '5.2.3'（miniprogram-api-typings 版本） */
  typingsVersion: string
}

/** 当前安装的 miniprogram-api-typings 版本（npm 依赖锁定，见 packages/types/package.json devDeps） */
export const DEFAULT_TYPINGS_VERSION = '5.2.3'

/**
 * 基础库 → typings 版本维护表（★人工维护：随双方发版节奏更新，新基础库发布后补录；
 * 来源 = npm 发布窗口对齐，非官方权威映射——微信不发布「基础库 ↔ typings」对照表）
 * ⚠ 注意：typings 版本号与基础库版本号**不同步**（typings 3.12 发布于 2024，对应基础库 3.x 时代；
 *   typings 3.0 是 2020 年的老线，勿与基础库 3.0 混淆）
 * 未收录的 libVersion 由 resolveTypingsVersion 回退 DEFAULT_TYPINGS_VERSION 并触发告警（透明化，不静默）
 */
export const MP_SDK_VERSION_MAP: Record<string, string> = {
  // 基础库 2.29.2（2021，本框架最低要求）↔ typings 3.6.0（2022-09 稳定线，覆盖 2.29 时代后段）
  '2.29.2': '3.6.0',
  // 基础库 3.0.0（2024，Skyline 稳定）↔ typings 3.12.3（2024-08 稳定线，覆盖基础库 3.x 时代）
  '3.0.0': '3.12.3',
}

/** semver 形态校验（x.y.z 或 x.y，宽松） */
const SEMVER_RE = /^\d+\.\d+(\.\d+)?$/

/** 校验 MpSdkVersion 形状；返回错误信息数组（空 = 合法） */
export function validateMpSdkVersion(version: MpSdkVersion): string[] {
  const errors: string[] = []
  if (!SEMVER_RE.test(version.libVersion)) {
    errors.push(`libVersion 非法 semver: "${version.libVersion}"`)
  }
  if (!SEMVER_RE.test(version.typingsVersion)) {
    errors.push(`typingsVersion 非法 semver: "${version.typingsVersion}"`)
  }
  return errors
}

/**
 * 由目标基础库版本解析对应 typings 版本：
 * 命中维护表 → 表值；未收录 → DEFAULT_TYPINGS_VERSION（返回时附带 warn 标记，透明化不静默）
 */
export function resolveTypingsVersion(libVersion: string): { typingsVersion: string; mapped: boolean } {
  const known = MP_SDK_VERSION_MAP[libVersion]
  if (known) return { typingsVersion: known, mapped: true }
  return { typingsVersion: DEFAULT_TYPINGS_VERSION, mapped: false }
}
