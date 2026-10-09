#!/usr/bin/env node
// scripts/check-android-runtime-aar-fresh.mjs —— ★★Android runtime AAR **新鲜度**门禁（决策 #721）
//
// 【为什么要这道门禁（本仓真实教训）】runtime AAR 是**已入库的二进制**（`packages/cli/templates-host/prebuilt/android/proteus-runtime.aar`），
//   由 `hosts/android/build-runtime-aar.sh` **手动**重建。改了 `hosts/android/.../runtime/*.java`（如 #714 的
//   `drainDevFrameStats`、#719 的 `highlightNode` 调用）却**忘了重建 AAR** ⇒ CLI 生成的宿主壳**编译不过**
//   （"找不到符号"）——它**已经出过两次事故**（#685 AAR 陈旧、#721 壳源+AAR 双陈旧 ⇒ 用户"三个功能全无"全是这个）。
//   ⇒ "接线不靠记忆"：把"runtime 源码内容 ↔ AAR 内含的方法面"做成机器判据。
//
// 【判据（内容哈希，非 mtime——git 克隆下 mtime 不可靠）】`build-runtime-aar.sh` 构建成功时把当时
//   `runtime/*.java` 的**内容哈希**写进 `prebuilt/android/proteus-runtime.sources.sha256`；本门禁**重算**并比对。
//   不一致 ⇒ 红：源码改了、AAR 没重建（跑 `bash hosts/android/build-runtime-aar.sh`）。
//   ★诚实边界：本门禁只锁 **Java runtime 源**（`highlightNode`/`drainDevFrameStats` 这类"壳引用的方法面"在此）；
//     native（.so）漂移由 `check:host-abi-aar` 的符号断言另锁。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RT_SRC = path.join(ROOT, 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime')
const AAR = path.join(ROOT, 'packages/cli/templates-host/prebuilt/android/proteus-runtime.aar')
const STAMP = path.join(ROOT, 'packages/cli/templates-host/prebuilt/android/proteus-runtime.sources.sha256')

/** runtime 源的内容哈希（按文件名排序、逐个喂内容 ⇒ 与文件 mtime/顺序无关） */
export function runtimeSourcesHash() {
  const files = fs.readdirSync(RT_SRC).filter((f) => f.endsWith('.java')).sort()
  const h = crypto.createHash('sha256')
  for (const f of files) { h.update(f); h.update('\0'); h.update(fs.readFileSync(path.join(RT_SRC, f))); h.update('\0') }
  return h.digest('hex')
}

function main() {
  if (!fs.existsSync(AAR)) {
    console.error(`✗ 缺 runtime AAR：${path.relative(ROOT, AAR)}——跑 bash hosts/android/build-runtime-aar.sh`)
    process.exit(1)
  }
  if (!fs.existsSync(STAMP)) {
    console.error(`✗ 缺 AAR 源指纹：${path.relative(ROOT, STAMP)}——跑 bash hosts/android/build-runtime-aar.sh（会写入指纹）`)
    process.exit(1)
  }
  const want = fs.readFileSync(STAMP, 'utf-8').trim()
  const got = runtimeSourcesHash()
  if (want !== got) {
    console.error('')
    console.error('✗ Android runtime AAR 已陈旧：runtime 源改了但 AAR 没重建')
    console.error(`    源指纹（当前）: ${got}`)
    console.error(`    指纹（AAR 建于）: ${want}`)
    console.error('    修复：bash hosts/android/build-runtime-aar.sh   （重建 AAR + 同步 CLI 随包副本）')
    console.error('    ★后果（本仓实测 2 次）：CLI 生成的宿主壳引用新方法却编译不过（"找不到符号"）')
    process.exit(1)
  }
  console.log('✅ Android runtime AAR 新鲜（源指纹与 AAR 构建期一致）')
}

if (import.meta.url === `file://${process.argv[1]}`) main()
