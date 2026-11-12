#!/usr/bin/env node
/**
 * check-tauri-handlers.mjs —— 检查 **`#[tauri::command]` 定义了但没列进 `generate_handler!`**（决策 #1439）
 *
 * 【为什么需要】
 *   决策 #1435 给跳转定义加了 `read_text_external`（读仓库外文件），函数写了、`cargo build` 也过了，
 *   但**忘了把它加进 `tauri::generate_handler![...]`** ⇒ 真机一跳外部定义就红字
 *   `Command read_text_external not found`。
 *
 *   `#[tauri::command]` 只是生成 wrapper，**注册表才是运行时的事实**；漏了编译期完全看不出来，
 *   只有真机调用才暴露。这类"编译通过、运行才发现"的漏，必须用静态检查兜住。
 *
 * 用法：`node scripts/check-tauri-handlers.mjs`（有问题退出码 1）
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, '..', 'packages', 'studio', 'src')

/* 去掉注释：注释里的 `// fn xxx` 会被正则误抓（第一次跑就遇到过） */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

/* ★扫**整个 src/**：命令不只在 main.rs（`diag.rs` 里还有 8 个），只查 main.rs 会漏一半 */
const rsFiles = readdirSync(srcDir).filter((f) => f.endsWith('.rs'))
const mainCode = strip(readFileSync(join(srcDir, 'main.rs'), 'utf8'))
const defined = rsFiles.flatMap((f) => {
  const code = f === 'main.rs' ? mainCode : strip(readFileSync(join(srcDir, f), 'utf8'))
  const direct = [...code.matchAll(/#\[tauri::command\]\s*\n\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g)].map((m) => m[1])
  /* ★宏生成的命令（`define_blocking_cmd!(diag_rename, …)`）：名字在宏调用里，
     直接正则匹配不到 ⇒ 不认它就会漏掉这 5 个的注册校验。 */
  const viaMacro = [...code.matchAll(/define_blocking_cmd!\(\s*(\w+)/g)].map((m) => m[1])
  return [...direct, ...viaMacro]
})

/* ★决策 #1488：装配搬进了 `app_setup.rs`，`generate_handler!` 不再是 main.rs 的专属。
   这里改成"全 src 找第一个含 generate_handler 的文件"——判据跟着**代码的真实位置**走，
   而不是跟着历史记忆走（否则搬家一次就假红一次）。 */
const setupFile = rsFiles.find((f) =>
  /generate_handler!\s*\[/.test(f === 'main.rs' ? mainCode : strip(readFileSync(join(srcDir, f), 'utf8'))),
)
const setupCode = setupFile
  ? setupFile === 'main.rs'
    ? mainCode
    : strip(readFileSync(join(srcDir, setupFile), 'utf8'))
  : ''
const listMatch = /generate_handler!\s*\[([\s\S]*?)\]/.exec(setupCode)
if (!listMatch) {
  console.error('✗ 找不到 generate_handler![...]')
  process.exit(1)
}
const registered = listMatch[1]
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => s.split('::').pop())

const missing = defined.filter((d) => !registered.includes(d))

if (missing.length) {
  console.error(`✗ tauri 命令未注册（定义了但不在 generate_handler! 里）：${missing.join(', ')}`)
  console.error('  运行时前端调用会报 "Command xxx not found"，而 cargo build 不会报错。')
  process.exit(1)
}
console.log(`✓ tauri 命令注册完整：${defined.length} 个 #[tauri::command] 全部在 generate_handler! 中`)
