// packages/test-core/src/probe-assert.ts —— ★框架元素探针断言原语（2026-09-14）
//
// 为什么需要：组件内部节点对自动化工具**不可达**（glass-easel 隔离；Skyline 无 selectAllComponents），
//   因此「组件内部是否可见 / 是否可滚 / 几何是否合理」这类断言**无法用工具元素查询表达**。
//   探针（runtime/probe + 编译器注入 + driver.probes）把组件自测量数据送到测试侧后，
//   本模块提供**契约化断言**——让每个组件对齐都能以「几何/可滚性」为门禁，而不是靠人眼截图。
//
// 三条原语覆盖本轮真实踩过的坑：
//   assertProbeScrollable —— 内容溢出但滚不动（横向塌成一条线 / 容器无高度）
//   assertProbeGeometry   —— 尺寸塌陷（height 0 / width 0）、撑开不足
//   assertProbeVisible    —— 存在但不可见（display/visibility/opacity）
//
// 用法：
//   const h = await assertProbeScrollable(driver, 'hscroll', 'x')   // 断言横向真的可滚
//   const g = await assertProbeGeometry(driver, 'my-scroll', { minHeight: 40 })
//   await assertProbeVisible(driver, 'icon1')
import type { TestDriver, ProbeRecord } from './driver/types'

export interface ProbeProbeOptions {
  /** 等待重试（探针在 ready + 150ms 二次采集，冷启动可能稍晚） */
  retries?: number
  /** 重试间隔 ms */
  intervalMs?: number
}

/** 取单条探针（带重试——探针采集有 ready/150ms 两次，避免假阴性） */
export async function getProbe(driver: TestDriver, pid: string, opts: ProbeProbeOptions = {}): Promise<ProbeRecord> {
  const retries = opts.retries ?? 8
  const interval = opts.intervalMs ?? 300
  for (let i = 0; i < retries; i++) {
    const list = await driver.probes(pid)
    const hit = list.find((p) => p.pid === pid) ?? list[0]
    if (hit) return hit
    await driver.waitFor(interval)
  }
  throw new Error(
    `[test-core/probe] 未读到组件探针「${pid}」——排查：① 组件是否经 Proteus 编译器编译（探针随编译注入）；` +
      `② 是否开启探针（driver.enableProbes() 或 PROTEUS_DEBUG=1 构建，或组件传了 pid）；③ 组件是否已挂载`,
  )
}

/**
 * ★断言组件**可滚动**（内容溢出方向可滚）——判据：scrollWidth/scrollHeight > 容器宽/高。
 * 这是「横向塌成一条线 / 容器无尺寸」类 bug 的**直接判据**（工具查不到组件内部 scroll 尺寸）。
 * @param axis 'x' 横向 / 'y' 纵向（缺省 x）
 */
export async function assertProbeScrollable(
  driver: TestDriver,
  pid: string,
  axis: 'x' | 'y' = 'x',
  opts: ProbeProbeOptions = {},
): Promise<ProbeRecord> {
  const p = await getProbe(driver, pid, opts)
  if (!p.rect) throw new Error(`[test-core/probe] 「${pid}」无几何数据（rect=null）——组件可能未渲染`)
  if (!p.scroll) throw new Error(`[test-core/probe] 「${pid}」无滚动数据（scroll=null）——非滚动容器？`)
  const content = axis === 'x' ? p.scroll.scrollWidth : p.scroll.scrollHeight
  const viewport = axis === 'x' ? p.rect.width : p.rect.height
  if (!(content > viewport + 1)) {
    throw new Error(
      `[test-core/probe] 「${pid}」${axis} 轴**不可滚**：内容 ${Math.round(content)} ≤ 容器 ${Math.round(viewport)}` +
        `——内容未溢出（子项被压缩/容器塌陷/未撑开）。rect=${JSON.stringify(p.rect)} scroll=${JSON.stringify(p.scroll)}`,
    )
  }
  return p
}

/** ★断言组件几何约束（尺寸塌陷 / 撑开是否达标） */
export async function assertProbeGeometry(
  driver: TestDriver,
  pid: string,
  expect: { minWidth?: number; minHeight?: number; maxHeight?: number; maxWidth?: number },
  opts: ProbeProbeOptions = {},
): Promise<ProbeRecord> {
  const p = await getProbe(driver, pid, opts)
  const r = p.rect
  if (!r) throw new Error(`[test-core/probe] 「${pid}」无几何数据（rect=null）——组件未渲染或未可见`)
  const checks: Array<[string, number | undefined, number, 'min' | 'max']> = [
    ['width', expect.minWidth, r.width, 'min'],
    ['height', expect.minHeight, r.height, 'min'],
    ['height', expect.maxHeight, r.height, 'max'],
    ['width', expect.maxWidth, r.width, 'max'],
  ]
  for (const [dim, bound, actual, kind] of checks) {
    if (bound === undefined) continue
    const ok = kind === 'min' ? actual >= bound - 0.5 : actual <= bound + 0.5
    if (!ok) {
      throw new Error(
        `[test-core/probe] 「${pid}」${dim} ${actual} 不满足 ${kind} ${bound}——rect=${JSON.stringify(r)}`,
      )
    }
  }
  return p
}

/** ★断言组件节点**可见**（存在且 style 未隐藏；style 为空时仅按有几何判定） */
export async function assertProbeVisible(driver: TestDriver, pid: string, opts: ProbeProbeOptions = {}): Promise<ProbeRecord> {
  const p = await getProbe(driver, pid, opts)
  if (!p.rect) throw new Error(`[test-core/probe] 「${pid}」不可见：无几何（rect=null）`)
  if (p.rect.width <= 0 || p.rect.height <= 0) {
    throw new Error(`[test-core/probe] 「${pid}」不可见：几何为零 ${JSON.stringify(p.rect)}`)
  }
  const st = p.style ?? {}
  if (st.display === 'none') throw new Error(`[test-core/probe] 「${pid}」不可见：display:none`)
  if (st.visibility === 'hidden') throw new Error(`[test-core/probe] 「${pid}」不可见：visibility:hidden`)
  if (st.opacity !== undefined && Number(st.opacity) === 0) throw new Error(`[test-core/probe] 「${pid}」不可见：opacity:0`)
  return p
}
