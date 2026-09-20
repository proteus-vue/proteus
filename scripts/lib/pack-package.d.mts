// scripts/lib/pack-package.d.mts —— pack-package.mjs 的类型声明（与 component-props.d.mts 同约定）
//
// 用法（模块）：
//   import { packPackage, cleanupPack } from '../../scripts/lib/pack-package.mjs'
// 说明：本仓唯一打包实现（pnpm pack；字节确定 → integrity 可与 registry 的 dist.integrity 直接比对）。
//   详见 .mjs 文件头（含 2026-09-20 components 丢件事故的完整根因与「打包器/上传器分离」的决策）。

/** 打包结果 */
export interface PackedPackage {
  /** 产出的 tarball 绝对路径 */
  tgz: string
  /** 包内文件清单（相对路径，已排序；不含 package.json 自身） */
  files: string[]
  /** tarball 的 sha512 integrity（npm `dist.integrity` 同格式） */
  integrity: string
  /** tarball 字节数 */
  size: number
  /** tarball 所在目录 */
  dest: string
  /** dest 是否由 packPackage 自建（true → cleanupPack 会删除它） */
  ownedDest: boolean
}

/** 用 pnpm 打包指定包目录（opts.dest 缺省时自建临时目录） */
export declare function packPackage(pkgDir: string, opts?: { dest?: string }): PackedPackage

/** 清理 packPackage 自建的临时目录（调用方传 dest 时不动——那是调用方的目录） */
export declare function cleanupPack(p: PackedPackage | null | undefined): void

/** sha512 integrity（npm `dist.integrity` 格式：`sha512-<base64>`） */
export declare function integrityOf(buf: Buffer | Uint8Array): string
