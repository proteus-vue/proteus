// packages/slot-runtime/src/version.ts
// ★★卡 I1 · **版本协商**（Host ABI §6 的三件套，2026-09-29 首次落地为代码）
//
// 【为什么需要（卡 I1 的"为什么阻塞"原话）】多团队并行开发时**指令是契约**；
//   无规格即无法协作、无法版本协商（Host ABI §6 依赖它）。
//   ⇒ 本模块把「谁跟谁能通」变成**可判定**的，而不是靠约定。
//
// 【设计来源（照抄 Host ABI §6，不自己发明）】
//   ```c
//   typedef struct {
//     uint32_t abi_version;       // Host ABI 版本
//     uint32_t ir_version;        // IR 版本
//     uint32_t min_shell_version; // 最低宿主版本
//   } ProteusVersionInfo;
//   ```
//   强制要求（原文）：① 版本号**语义化**（禁止 commit hash 等不可比标识）；
//   ② 校验不通过 ⇒ **明确提示升级，不得静默崩溃**；③ 能力清单版本也纳入协商。
//
// 【本仓实测的两次指令流版本变更（流程实例）】
//   · v1：初版（每条消息携带全量键池/字符串池）
//   · v2：**池按需 + ref 重映射**（改字节语义 ⇒ **major**，双端必须同步；
//     未同步时 `ops_conformance` golden 当场抓出——这就是版本机制的价值）
import { OPS_VERSION } from './buffer'

/** Host ABI 版本（Host ABI §6 的三件套之一） */
export const ABI_VERSION = 1

/** IR 契约版本（与 `CompilerIR.version` 同源；变更语义时递增） */
export const IR_VERSION = 1

/**
 * ★★指令流线格式版本 —— **直接取 `OPS_VERSION`**（不另立副本）
 *
 * 【为什么必须同源（本仓纪律 #22）】若这里写一个独立的常量，那么"改协议只改一处"
 *   的约束就靠人记；而本仓已多次吃亏于"第 N 份手写副本"（绘制字段 4 份、版本号 3 处）。
 *   ⇒ 引用同一个常量：改 `buffer.ts` 的 `OPS_VERSION` ⇒ 这里自动跟随。
 */
export const OPS_WIRE_VERSION = OPS_VERSION

/**
 * ★最低兼容的宿主版本（宿主低于它 ⇒ 明确提示升级）
 *
 * 语义：**本 SDK 产出的指令流要求宿主至少是这个版本**。宿主侧对称地声明 `minShellVersion`。
 */
export const MIN_SHELL_VERSION = 1

/** 版本三件套（与 Host ABI §6 的 `ProteusVersionInfo` 逐字段对应） */
export interface ProteusVersionInfo {
  abi_version: number
  ir_version: number
  ops_wire_version: number
  min_shell_version: number
}

/** 当前 SDK 的版本声明（宿主用它做协商） */
export function versionInfo(): ProteusVersionInfo {
  return {
    abi_version: ABI_VERSION,
    ir_version: IR_VERSION,
    ops_wire_version: OPS_WIRE_VERSION,
    min_shell_version: MIN_SHELL_VERSION,
  }
}

/** 协商结果（`ok=false` 时 `reason` **必须可读**——禁静默失败，见 Host ABI §6 强制要求 ②） */
export interface VersionCheckResult {
  ok: boolean
  reason?: string
  /** 需要宿主/端升级时的**可操作**提示（不是"版本不符"四个字） */
  upgradeHint?: string
}

/**
 * ★★版本协商（**唯一实现**——两端都调它，不各写一份判断）
 *
 * @param host 宿主/端声明的版本能力
 */
export function checkHostVersion(host: {
  abiVersion?: number
  irVersion?: number
  opsWireVersion?: number
  shellVersion?: number
}): VersionCheckResult {
  // ① IR 版本：必须**同 major**（本仓 IR 契约版本是整数，故要求相等）
  if (host.irVersion !== undefined && host.irVersion !== IR_VERSION) {
    return {
      ok: false,
      reason: `IR 版本不兼容：宿主 ${host.irVersion} · SDK ${IR_VERSION}`,
      upgradeHint: host.irVersion < IR_VERSION
        ? `请升级宿主到支持 IR v${IR_VERSION} 的版本（或用与宿主匹配的 SDK）`
        : `宿主 IR 版本高于 SDK，请升级 SDK 到支持 IR v${host.irVersion}`,
    }
  }
  // ② 指令流线格式：**必须相等**（字节布局变更即不兼容——见本文件头 v1→v2 实例）
  if (host.opsWireVersion !== undefined && host.opsWireVersion !== OPS_WIRE_VERSION) {
    return {
      ok: false,
      reason: `指令流格式不兼容：宿主 ${host.opsWireVersion} · SDK ${OPS_WIRE_VERSION}`,
      upgradeHint: host.opsWireVersion < OPS_WIRE_VERSION
        ? `宿主指令流解码器过旧（v${host.opsWireVersion}）；v${OPS_WIRE_VERSION} 起「池按需 + ref 重映射」，字节语义已变`
        : `SDK 过旧（v${OPS_WIRE_VERSION}）；宿主期待 v${host.opsWireVersion}`,
    }
  }
  // ③ 宿主版本：低于最低要求 ⇒ 明确提示升级
  if (host.shellVersion !== undefined && host.shellVersion < MIN_SHELL_VERSION) {
    return {
      ok: false,
      reason: `宿主版本过低：${host.shellVersion} < 最低要求 ${MIN_SHELL_VERSION}`,
      upgradeHint: `请升级宿主到 ≥ ${MIN_SHELL_VERSION}`,
    }
  }
  // ④ ABI 版本：同样要求相等（接口语义变更即 major）
  if (host.abiVersion !== undefined && host.abiVersion !== ABI_VERSION) {
    return {
      ok: false,
      reason: `Host ABI 版本不兼容：宿主 ${host.abiVersion} · SDK ${ABI_VERSION}`,
      upgradeHint: '请对齐 Host ABI 版本（接口语义变更属 major）',
    }
  }
  return { ok: true }
}
