// tests/capability-usage-examples.test.ts
// ★★★决策 #1087（2026-10-19）：能力页「用法」示例的**可运行性**判据。
//
// 【为什么（本轮实测的三层缺陷）】审计英文能力页的示例，29 个**同步句柄**能力写成了：
//   ```ts
//   const res = await useElement()      // ← useElement 是同步返回 CapResult
//   if (res.ok) { console.log(res.data) }
//   ```
//   ① `await` 一个同步句柄 —— 运行时虽能过（`await` 非 thenable 原样返回），但**教会了错误形状**：
//      读者会以为这些 Hook 是异步的，到处 `await`，且分不清"句柄同步取、方法才异步";
//   ② **参数名当值**：`useVideo(id)` / `useWorker(scriptPath)` —— `id` 是参数名，照抄 **ReferenceError**;
//   ③ `console.log(res.data)` 对句柄无意义（打印一堆方法，仍不知怎么用）。
//   ★中文页早已正确（`const q = useElement('box') // 同步句柄——无 await、无 res.ok`）；
//     英文页走 `generic()` 兜底 ⇒ **两条路径分叉**。根因：`handleT` 判据要求返回类型是**裸名字**，
//     而同步句柄签名为 `CapResult<X>`（带尖括号）⇒ 永不命中。
//
// 【判据】
//   ① 同步句柄的英文页**不得**出现 `await useXxx()`;
//   ② 需要实参的句柄必须给**可运行字面量**（不能出现裸参数名 `useVideo(id)`）;
//   ③ 异步 Hook 的英文页**仍应**用 `await`（不能反向改坏）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EN_DIR = path.join(ROOT, 'website/en/capabilities')

/** 从页面里取签名行（第一个 `useXxx(...): ...`） */
function signatureOf(file: string): string | null {
  const src = fs.readFileSync(file, 'utf8')
  const m = /^(use[A-Za-z0-9]+\([^)]*\)\s*:\s*[^\n]+)$/m.exec(src)
  return m ? m[1] : null
}

/** 从页面里取 Usage 代码块的第一行 */
function usageFirstLine(file: string): string | null {
  const src = fs.readFileSync(file, 'utf8')
  const m = /## Usage\n\n```ts\n([^\n]*)/.exec(src)
  return m ? m[1] : null
}

function pages(): string[] {
  return fs.readdirSync(EN_DIR).filter((f) => f.endsWith('.md')).map((f) => path.join(EN_DIR, f))
}

describe('★#1087 ① 同步句柄不得写成 await', () => {
  it('所有返回 CapResult<X>（同步句柄）的英文页，用法首行都不是 `await`', () => {
    const bad: string[] = []
    for (const f of pages()) {
      const sig = signatureOf(f)
      if (!sig) continue
      // 同步句柄 = 返回 CapResult<…> 且不是 Promise<CapResult<…>>
      const ret = sig.split(':').slice(1).join(':').trim()
      if (!/^CapResult</.test(ret)) continue
      const line = usageFirstLine(f)
      if (line && /\bawait\s+use/.test(line)) bad.push(`${path.basename(f)} → ${line.trim()}`)
    }
    expect(bad, `这些页把同步句柄当异步（await 一个非 thenable）：\n${bad.join('\n')}`).toEqual([])
  })
})

describe('★#1087 ② 需要实参的句柄必须给可运行字面量', () => {
  it('不得出现把参数名当值的调用（useVideo(id) / useWorker(scriptPath) / useCanvas(id) …）', () => {
    const PARAM_NAMES = ['id', 'scriptPath', 'src', 'kind', 'options', 'conditions']
    const bad = []
    for (const f of pages()) {
      const line = usageFirstLine(f)
      if (!line) continue
      for (const p of PARAM_NAMES) {
        // 裸参数名作实参：`useXxx(id)` / `useXxx(id, ...)`
        if (new RegExp(`use[A-Za-z0-9]+\\(\\s*${p}\\s*[,)]`).test(line)) {
          bad.push(`${path.basename(f)} → ${line.trim()}`)
          break
        }
      }
    }
    expect(bad, `这些页把**参数名**当实参（照抄会 ReferenceError）：\n${bad.join('\n')}`).toEqual([])
  })
})

describe('★#1087 ③ 异步 Hook 仍应是 await（反向保护）', () => {
  it('返回 Promise<CapResult<…>> 的英文页，用法首行保留 await', () => {
    const bad = []
    for (const f of pages()) {
      const sig = signatureOf(f)
      if (!sig) continue
      const ret = sig.split(':').slice(1).join(':').trim()
      if (!/^Promise</.test(ret)) continue
      const line = usageFirstLine(f)
      if (!line) continue
      if (!/\bawait\s+use/.test(line)) bad.push(`${path.basename(f)} → ${line.trim()}`)
    }
    expect(bad, `这些页是异步 Hook 却没 await（会被改成错误形状）：\n${bad.join('\n')}`).toEqual([])
  })
})

describe('★#1087 ④ 根因已修：同步句柄判定接受 CapResult<…> 形态', () => {
  it('生成器里同步句柄分支包含 CapResult< 判据（否则会退回 generic 兜底）', () => {
    const gen = fs.readFileSync(path.join(ROOT, 'website/scripts/gen-content.mjs'), 'utf8')
    expect(
      gen.includes('/^CapResult</.test(shape.retType)'),
      '同步句柄分支缺 `CapResult<` 判据 ⇒ 同步句柄会落到 `await` 兜底（本轮实测的真根因）',
    ).toBe(true)
  })
})
