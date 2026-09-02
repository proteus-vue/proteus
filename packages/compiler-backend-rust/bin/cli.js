#!/usr/bin/env node
// bin/cli.js —— @proteus-vue/compiler-backend-rust 的 npm bin 壳
//   G-29 B2 RustBackend：透传调用 cargo 构建出的 proteus-cc-rust 二进制
//   （release 优先；未构建 → cargo build --release 后执行；G-29.1 语义等价 CLI）
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CRATE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function findBinary() {
  const release = path.join(CRATE_DIR, 'target', 'release', 'proteus-cc-rust')
  if (fs.existsSync(release)) return release
  const debug = path.join(CRATE_DIR, 'target', 'debug', 'proteus-cc-rust')
  if (fs.existsSync(debug)) return debug
  return undefined
}

let bin = findBinary()
if (!bin) {
  // 首次：cargo build --release（可复现 + 体积小）
  execFileSync('cargo', ['build', '--release'], { cwd: CRATE_DIR, stdio: 'inherit' })
  bin = findBinary()
}
if (!bin) {
  console.error('[compiler-backend-rust] cargo 构建失败：未找到 proteus-cc-rust 二进制')
  process.exit(1)
}

// 透传 CLI 参数（compile <file.vue> [--pretty]）
try {
  execFileSync(bin, process.argv.slice(2), { stdio: 'inherit' })
} catch (e) {
  process.exit(typeof e.status === 'number' ? e.status : 1)
}