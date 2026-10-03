// tests/toast-queue.test.ts —— ★★★GP4-a（2026-10-03）：**Toast 队列**语义回归锁
//
// 【这张卡补的是什么】《全局挂载点方案》§1 痛点表里的第一条：
//   `uni.showToast` 是**全局单例**（样式固定、类型仅四种、**无法管理顺序**——连续触发行为未定义）。
//   本模块把它换成**有序队列**：FIFO / 上限与丢弃策略 / 手动关闭 / 常驻 / 幂等 / 可观测统计。
//
// 【★判据设计（每条都做"破坏性可验"——改坏必红）】
//   ① FIFO 顺序（连续 10 条按序：第 N 条的 seq 严格递增）
//   ② 时长推进（到点自动关闭并上位下一条）
//   ③ duration=0 常驻（不自动关；手动可关）
//   ④ 三种丢弃策略（drop-oldest / drop-newest / replace——各自的可观测结果不同）
//   ⑤ dropped 统计（"丢弃可观测"——不静默丢）
//   ⑥ 幂等（同 id 不重复入队）
//   ⑦ hideToast 双位置（当前/等待区）
//   ⑧ clearToasts 全清
//   ⑨ 订阅事件序列（show/queue/dismiss/drop/clear——宿主与诊断的契约）
//   ⑩ fail-closed（无 text 抛错——不静默）
//
// ★时间处理：用 vitest 假定时器（不 sleep——本仓红线）驱动时长推进。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  showToast, hideToast, clearToasts, configureToast,
  toastSnapshot, toastStats, toastConfig, subscribeToast,
  __resetToastForTest,
} from '../packages/runtime/src/toast'
import type { ToastEvent } from '../packages/runtime/src/toast'

beforeEach(() => {
  __resetToastForTest()
  vi.useFakeTimers()
})
afterEach(() => {
  __resetToastForTest()
  vi.useRealTimers()
})

describe('★GP4-a ① FIFO 顺序（核心判据：连续 10 条按序显示，不互相覆盖）', () => {
  it('连发 10 条 → 第 1 条立即显示，其余 9 条排队（顺序 = 入队顺序）', () => {
    for (let i = 1; i <= 10; i++) showToast({ text: `第${i}条`, duration: 100 })
    const snap = toastSnapshot()
    expect(snap.current?.text, '第 1 条立即显示').toBe('第1条')
    expect(snap.queue.map((t) => t.text), '等待区按入队顺序').toEqual([
      '第2条', '第3条', '第4条', '第5条', '第6条', '第7条', '第8条', '第9条', '第10条',
    ])
  })

  it('★按序推进：每过一个时长，显示下一条（不跳跃、不并行）', () => {
    // ★订阅回调**携带完整快照**（每次 notify 都有 current）——故这里记录"显示过的**不同**条目"
    //   （按 id 去重）：入队事件也会带 current，直接 push 会把同一条记 5 次（本用例首版即如此写错）。
    const seen: string[] = []
    const seenIds = new Set<string>()
    subscribeToast((snap) => {
      if (snap.current && !seenIds.has(snap.current.id)) {
        seenIds.add(snap.current.id)
        seen.push(snap.current.text)
      }
    })
    for (let i = 1; i <= 5; i++) showToast({ text: `第${i}条`, duration: 100 })
    expect(seen, '初始只显示第 1 条').toEqual(['第1条'])
    for (let i = 2; i <= 5; i++) {
      vi.advanceTimersByTime(100)
      expect(toastSnapshot().current?.text, `第 ${i} 条应上位`).toBe(`第${i}条`)
    }
    // 任意时刻只有一个 current（不并行显示）
    expect(toastSnapshot().queue, '走完 5 条后等待区空').toEqual([])
    expect(toastSnapshot().current?.text).toBe('第5条')
  })

  it('★序号单调（宿主/诊断判断"按序"的机器判据）', () => {
    for (let i = 1; i <= 4; i++) showToast({ text: `x${i}` })
    const seqs = [toastSnapshot().current!.seq, ...toastSnapshot().queue.map((t) => t.seq)]
    for (let i = 1; i < seqs.length; i++) expect(seqs[i], 'seq 严格递增').toBeGreaterThan(seqs[i - 1]!)
  })
})

describe('★GP4-a ②③ 时长：到点自动关 / duration=0 常驻', () => {
  it('duration 到点自动关闭并上位下一条', () => {
    showToast({ text: 'A', duration: 50 })
    showToast({ text: 'B', duration: 50 })
    expect(toastSnapshot().current?.text).toBe('A')
    vi.advanceTimersByTime(50)
    expect(toastSnapshot().current?.text, 'A 到点 → B 上位').toBe('B')
  })

  it('★duration=0 = 常驻（不自动关，直到手动）——计时器绝不启动', () => {
    showToast({ text: '常驻', duration: 0 })
    vi.advanceTimersByTime(100000)
    expect(toastSnapshot().current?.text, '常驻条目 100 秒后仍在').toBe('常驻')
    expect(toastStats().dismissed, '未被自动关闭').toBe(0)
  })

  it('默认时长 2000ms（未传 duration）', () => {
    showToast({ text: '默认' })
    vi.advanceTimersByTime(1999)
    expect(toastSnapshot().current, '1999ms 时仍在').toBeTruthy()
    vi.advanceTimersByTime(1)
    expect(toastSnapshot().current, '2000ms 到 → 关').toBeNull()
  })
})

describe('★GP4-a ④⑤ 上限与丢弃策略（防刷屏 + 丢弃可观测）', () => {
  it('drop-oldest（默认）：等待区满 ⇒ 丢**排队最久**的，新消息进队尾', () => {
    configureToast({ maxSize: 2, policy: 'drop-oldest' })
    showToast({ text: 'cur', duration: 0 })
    showToast({ text: 'q1' })
    showToast({ text: 'q2' })
    showToast({ text: 'q3' }) // q1 被丢
    expect(toastSnapshot().queue.map((t) => t.text), 'q1 被丢，q2/q3 留下').toEqual(['q2', 'q3'])
    expect(toastStats().dropped, '丢弃计数 +1（可观测）').toBe(1)
  })

  it('drop-newest：等待区满 ⇒ 丢**新来的**（保护既有顺序）', () => {
    configureToast({ maxSize: 2, policy: 'drop-newest' })
    showToast({ text: 'cur', duration: 0 })
    showToast({ text: 'q1' })
    showToast({ text: 'q2' })
    showToast({ text: 'q3' }) // q3 被丢
    expect(toastSnapshot().queue.map((t) => t.text), '既有两条不受影响').toEqual(['q1', 'q2'])
    expect(toastStats().dropped).toBe(1)
  })

  it('★replace：清空等待区 + **打断当前**（"必须立刻可见"的语义）', () => {
    configureToast({ maxSize: 2, policy: 'replace' })
    showToast({ text: 'cur', duration: 0 })
    showToast({ text: 'q1' })
    showToast({ text: 'q2' })
    showToast({ text: '紧急' }) // 打断
    const snap = toastSnapshot()
    expect(snap.current?.text, '紧急 立即显示（打断 cur）').toBe('紧急')
    expect(snap.queue, '等待区被清空').toEqual([])
    expect(toastStats().dropped, 'cur + q1 + q2 计入丢弃（3）').toBe(3)
  })

  it('★丢弃是**事件可观测**的（不是静默丢——订阅方能看见 drop 事件）', () => {
    const events: ToastEvent[] = []
    subscribeToast((_s, e) => events.push(e))
    configureToast({ maxSize: 1, policy: 'drop-oldest' })
    showToast({ text: 'cur', duration: 0 })
    showToast({ text: 'q1', id: 'will-drop' })
    showToast({ text: 'q2' })
    const drops = events.filter((e) => e.kind === 'drop')
    expect(drops.length).toBe(1)
    expect(drops[0]!.id, '被丢的 id 可追溯').toBe('will-drop')
    expect(drops[0]!.reason).toBe('max-size')
  })

  it('maxSize<1 归 1（"等待区至少能放一条"——不做无意义配置）', () => {
    configureToast({ maxSize: 0 })
    expect(toastConfig().maxSize).toBe(1)
  })
})

describe('★GP4-a ⑥ 幂等：同 id 不重复入队', () => {
  it('同 id 第二次调用不生效（防"响应了两次请求弹两条"）', () => {
    const id1 = showToast({ text: '首条', id: 'login-required', duration: 0 })
    const id2 = showToast({ text: '重复', id: 'login-required' })
    expect(id1).toBe(id2)
    expect(toastSnapshot().current?.text, '仍是首条').toBe('首条')
    expect(toastSnapshot().queue, '未重复入队').toEqual([])
  })

  it('等待区内的同 id 也不重复', () => {
    showToast({ text: 'cur', duration: 0 })
    showToast({ text: 'q', id: 'dup' })
    showToast({ text: 'q again', id: 'dup' })
    expect(toastSnapshot().queue.length, '等待区只有一条').toBe(1)
  })
})

describe('★GP4-a ⑦⑧ 手动关闭：当前 / 等待区 / 全清', () => {
  it('hideToast() 不传 id → 关当前并上位', () => {
    showToast({ text: 'A', duration: 0 })
    showToast({ text: 'B', duration: 0 })
    hideToast()
    expect(toastSnapshot().current?.text).toBe('B')
  })

  it('hideToast(id) 指向当前 → 关当前', () => {
    const id = showToast({ text: 'A', duration: 0 })
    showToast({ text: 'B', duration: 0 })
    hideToast(id)
    expect(toastSnapshot().current?.text).toBe('B')
  })

  it('★hideToast(id) 指向等待区 → 仅移除（该条永不显示）', () => {
    showToast({ text: 'cur', duration: 0 })
    showToast({ text: 'q1', id: 'kill-me' })
    showToast({ text: 'q2' })
    hideToast('kill-me')
    expect(toastSnapshot().queue.map((t) => t.text), 'kill-me 已移除').toEqual(['q2'])
    expect(toastSnapshot().current?.text, '当前不受影响').toBe('cur')
  })

  it('clearToasts：当前 + 等待区全清（"导航离开/登出"的收口）', () => {
    showToast({ text: 'cur', duration: 0 })
    showToast({ text: 'q1' })
    clearToasts()
    const snap = toastSnapshot()
    expect(snap.current).toBeNull()
    expect(snap.queue).toEqual([])
  })

  it('★关闭后计时器已清（不留悬挂 timer——否则下一条会被"上一次的定时器"提前关掉）', () => {
    showToast({ text: 'A', duration: 1000 })
    hideToast()
    showToast({ text: 'B', duration: 1000 })
    vi.advanceTimersByTime(999)
    expect(toastSnapshot().current?.text, 'B 不该被 A 的旧定时器影响').toBe('B')
  })
})

describe('★GP4-a ⑨⑩ 订阅事件 / fail-closed', () => {
  it('事件序列：queue（入队）→ show（上位）→ dismiss（时长到）', () => {
    const events: ToastEvent[] = []
    subscribeToast((_s, e) => events.push(e))
    showToast({ text: 'cur', duration: 30 })
    showToast({ text: 'q1', duration: 30 })
    vi.advanceTimersByTime(30)
    const kinds = events.map((e) => e.kind)
    expect(kinds[0], '首条直接 show').toBe('show')
    expect(kinds).toContain('queue')
    expect(kinds).toContain('dismiss')
    expect(events.find((e) => e.kind === 'dismiss')?.reason).toBe('duration')
  })

  it('订阅者可退订（宿主 onUnmounted 用；退订后不再收事件）', () => {
    let count = 0
    const unsub = subscribeToast(() => {
      count++
    })
    showToast({ text: 'a' })
    const after = count
    unsub()
    showToast({ text: 'b' })
    expect(count, '退订后不再增加').toBe(after)
  })

  it('★fail-closed：无 text 抛错（静默不显示是最坏结果——让调用点立即看到）', () => {
    expect(() => showToast({ text: '' as unknown as string })).not.toThrow()
    expect(() => showToast(undefined as never)).toThrow(/需要 text/)
    expect(() => showToast({ text: 123 as never })).toThrow(/需要 text/)
  })

  it('订阅者抛错不影响队列推进（宿主渲染失败不拖垮逻辑层）', () => {
    subscribeToast(() => {
      throw new Error('宿主炸了')
    })
    showToast({ text: 'a', duration: 10 })
    showToast({ text: 'b', duration: 10 })
    vi.advanceTimersByTime(10)
    expect(toastSnapshot().current?.text, '队列照常推进').toBe('b')
  })
})

describe('★GP4-a 统计口径（shown/dropped/dismissed）', () => {
  it('shown 只计**真正显示过**的（排队未显示的不计）', () => {
    showToast({ text: 'a', duration: 0 })
    showToast({ text: 'b' })
    showToast({ text: 'c' })
    expect(toastStats().shown, '只有 a 显示过').toBe(1)
  })

  it('三计数互不混淆（shown/dropped/dismissed 各记各的）', () => {
    configureToast({ maxSize: 1, policy: 'drop-oldest' })
    showToast({ text: 'a', duration: 0 }) // shown=1
    showToast({ text: 'b' }) // queue
    showToast({ text: 'c' }) // drop b → dropped=1
    hideToast() // dismiss a → dismissed=1, shown b=2
    const st = toastStats()
    expect(st.shown).toBe(2)
    expect(st.dropped).toBe(1)
    expect(st.dismissed).toBe(1)
  })
})
