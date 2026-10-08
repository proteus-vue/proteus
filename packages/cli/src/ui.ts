// packages/cli/src/ui.ts —— ★CLI 终端输出样式（2026-10-08 · 用户「终端界面视觉体验优化」）
//
// 【为什么有它】`proteus dev` / `build --package` 的输出此前是**一屏平铺的 `[proteus] …`**，
//   且外部工具（javac/keytool/esbuild）的**原始 stderr 直接漏到终端** ⇒ 又吵又没层次，
//   与 Vite/Next/Flutter 这类"步骤 + 耗时 + 汇总"的观感差一截。
//   本模块把输出收成：**头部（命令/目标）→ 逐步 ✓ + 耗时 → 汇总/提示**，并把长连接/热刷打成
//   带时间戳的单行事件。
//
// 【设计取舍（对齐本仓"日志要能被 grep/重定向"的纪律）】
//   · **TTY 感知**：非 TTY（重定向/CI）或 `NO_COLOR` ⇒ **纯文本零 ANSI**（`check:*` 门禁扫输出不炸）；
//   · **步骤加载动画**：`step()` 在 **TTY** 下转一个 spinner（等待期有"在跑"的反馈，用户诉求）；
//     非 TTY ⇒ 不转、不打 `\r`（重定向/CI 日志仍是逐行）；
//   · 符号约定：`✓` 成功（绿）· `✗` 失败（红）· `•` 信息 · `⚠` 警告 · `⟳` 事件。
const isTTY = (() => {
  try { return process.stdout.isTTY === true && !process.env.NO_COLOR && process.env.TERM !== 'dumb' } catch { return false }
})()

const wrap = (code: number) => (s: string): string => (isTTY ? `\u001b[${code}m${s}\u001b[0m` : s)
export const dim = wrap(2)
export const bold = wrap(1)
export const cyan = wrap(36)
export const green = wrap(32)
export const yellow = wrap(33)
export const red = wrap(31)
export const gray = wrap(90)

// ── 步骤加载动画（spinner）──────────────────────────────────────────────
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
let spinnerTimer: NodeJS.Timeout | null = null
let spinnerActive = false
/** 清掉正在转的 spinner 行（其它输出/步骤结束前调）——非 TTY 下为空操作。 */
function clearSpinner(): void {
  if (!spinnerActive) return
  spinnerActive = false
  if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null }
  if (isTTY) process.stdout.write('\r\u001b[K')
}
function startSpinner(label: string): void {
  if (!isTTY) return
  let i = 0
  spinnerActive = true
  spinnerTimer = setInterval(() => {
    process.stdout.write(`\r\u001b[K  ${cyan(SPIN[i++ % SPIN.length])} ${dim(label + '…')}`)
  }, 80)
  spinnerTimer.unref?.()   // 不阻止进程退出
}

/** 命令头部：`◆ Proteus dev · android · 项目名`（前后留空行，界定一次运行） */
export function header(title: string, sub?: string): void {
  clearSpinner()
  console.log('')
  console.log(`${bold('◆ Proteus')} ${cyan(title)}${sub ? dim(`  ${sub}`) : ''}`)
  console.log('')
}

/** 一个"步骤"：**TTY 下构造即转 spinner**（等待反馈）；`done()` ⇒ `✓ label  extra · 356ms`；`fail()` ⇒ 红。 */
export interface Step {
  done(extra?: string): void
  fail(reason: string): void
  /** 不打完成行、只追加一条缩进信息（用于需要多行说明的步骤） */
  note(msg: string): void
}
export function step(label: string): Step {
  const t0 = Date.now()
  const ms = (): string => (isTTY ? dim(`${Date.now() - t0}ms`) : `${Date.now() - t0}ms`)
  startSpinner(label)
  return {
    done(extra) {
      clearSpinner()
      console.log(`  ${green('✓')} ${label}${extra ? dim(`  ${extra}`) : ''}  ${ms()}`)
    },
    fail(reason) {
      clearSpinner()
      console.log(`  ${red('✗')} ${label}  ${red(reason)}`)
    },
    note(msg) {
      clearSpinner()
      console.log(`    ${gray(msg)}`)
    },
  }
}

/** 独立一行：`✓/•/⚠/✗` + 文本（无耗时）——先清 spinner 行再打。 */
export const ok = (msg: string): void => { clearSpinner(); console.log(`  ${green('✓')} ${msg}`) }
export const info = (msg: string): void => { clearSpinner(); console.log(`  ${gray('•')} ${msg}`) }
export const warn = (msg: string): void => { clearSpinner(); console.log(`  ${yellow('⚠')} ${msg}`) }
export const fail = (msg: string): void => { clearSpinner(); console.log(`  ${red('✗')} ${msg}`) }

/** 长连接/热刷事件：`[12:34:56] ⟳ bundle v2（59ms · change:pages/index.vue）` */
export function event(msg: string): void {
  clearSpinner()
  const t = new Date().toLocaleTimeString('en-GB', { hour12: false })
  console.log(`${dim(`[${t}]`)} ${cyan('⟳')} ${msg}`)
}

/** 收尾提示（dim；如「Ctrl+C 退出」/下一步命令） */
export const hint = (msg: string): void => { clearSpinner(); console.log(`  ${dim(msg)}`) }
