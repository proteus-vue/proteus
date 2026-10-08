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
import { spawn, type ChildProcess } from 'node:child_process'

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
// ★★★为什么用**子进程**而不是 setInterval（决策 #678 二次修正）：`打包 debug 宿主`/`安装到设备`
//   是 `execFileSync` **同步阻塞**（javac/d8/aapt2/adb）⇒ 主进程事件循环被占死 ⇒ 主进程的
//   `setInterval` 连一帧都跑不到 ⇒ 静止。⇒ 用**独立子进程**跑动画：主进程照常同步阻塞，
//   子进程（自己的事件循环空闲）持续写 `\r\u001b[K  ⠋ label…` ⇒ **真转圈**。
//   ★非 TTY ⇒ 不 spawn（零进程开销、日志逐行）；子进程 stdout=`inherit`（写同一个 TTY）。
const SPIN_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
/** 子进程脚本：`argv[1]`=帧数组(JSON)、`argv[2]`=label；80ms/帧写一行（cyan 帧 + dim 文案）。 */
const SPIN_CHILD_SRC =
  "const f=JSON.parse(process.argv[1]);const l=process.argv[2]||'';let i=0;" +
  "const w=()=>process.stdout.write('\\r\\u001b[K  \\u001b[36m'+f[i++%f.length]+'\\u001b[0m \\u001b[2m'+l+'…\\u001b[0m');" +
  'w();const t=setInterval(w,80);'
let spinnerChild: ChildProcess | null = null
let spinnerActive = false
/** 清掉正在转的 spinner（杀掉子进程）+ 清当前行——非 TTY 下为空操作。 */
function clearSpinner(): void {
  if (!spinnerActive) return
  spinnerActive = false
  if (spinnerChild) { try { spinnerChild.kill('SIGKILL') } catch { /* 已退出 */ } spinnerChild = null }
  if (isTTY) process.stdout.write('\r\u001b[K')
}
function startSpinner(label: string): void {
  if (!isTTY) return
  spinnerActive = true
  try {
    spinnerChild = spawn(process.execPath, ['-e', SPIN_CHILD_SRC, JSON.stringify(SPIN_FRAMES), label], {
      stdio: ['ignore', 'inherit', 'ignore'],
    })
    spinnerChild.on('error', () => { spinnerChild = null })   // spawn 失败 ⇒ 退化为无动画（不报错）
  } catch {
    spinnerChild = null
  }
  // 同步首帧兜底：子进程启动前（~50ms）也有"在跑"的提示
  process.stdout.write(`\r\u001b[K  ${cyan(SPIN_FRAMES[0])} ${dim(label + '…')}`)
}
// 父进程异常退出（Ctrl+C / 崩溃）时兜底杀子进程，避免孤儿 spinner。
process.on('exit', () => { if (spinnerChild) { try { spinnerChild.kill('SIGKILL') } catch { /* ignore */ } } })

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

/**
 * ★只开一个 spinner、**不打任何完成行**（返回 stop 函数）——给"结果自行呈现"的命令用
 *   （如 `proteus doctor`：跑完直接打报告，不想要一行 `✓ 体检中 …`）。
 *   **非 TTY ⇒ 空操作**（重定向/CI 零 ANSI、零 `\r`）；stop() 清当前行。
 */
export function beginSpinner(label: string): () => void {
  startSpinner(label)
  return () => clearSpinner()
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
