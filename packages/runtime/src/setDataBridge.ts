// src/runtime/setDataBridge.ts
// 响应式 → setData 批量桥接（P5-1 + v0.4 深度优化 + 拆包解耦）
// 核心：按页面粒度收集脏路径，在 batchWindow（16ms ≈ 1 帧）内合并多次变更为一次 setData；
// 路径合并（父覆盖子）+ 值比较去重（对比上次已推送值）+ **深层对象/数组 diff**（变更递归
// 出叶路径补丁，只推送变化的子路径——直击 uni-app 全量大对象 setData 痛点）。
// ★拆包解耦（docs/packages.md 步骤 1）：不再依赖 proteus.config——batchWindow 由工厂注入（默认 16）
import { adapter } from '@proteus-vue/shared'

export interface SetDataBridgeOptions {
  /** 批量合并窗口 ms（默认 16 ≈ 1 帧） */
  batchWindow?: number
}

interface DirtyRecord {
  /** 数据路径，如 "list[0].name" */
  path: string
  value: unknown
}

/** 判断 child 是否为 parent 的后代路径（支持点号与数组下标两种分隔） */
function isChildPath(parent: string, child: string): boolean {
  return child.startsWith(parent + '.') || child.startsWith(parent + '[')
}

/** 可参与深层 diff 的对象（普通对象 / 数组；null/Date 等按标量） */
function isDiffable(v: unknown): boolean {
  return v !== null && typeof v === 'object'
}

/**
 * 递归 diff 旧值 vs 新值，产出对象路径级补丁（只含变化的叶路径）
 * - 对象：逐键递归（删除的键也产出，值为 undefined）
 * - 数组：逐下标递归（长度变化部分整体替换）
 * - 标量：整体替换
 */
function diffPaths(base: string, oldVal: unknown, newVal: unknown): Array<{ path: string; value: unknown }> {
  if (oldVal === newVal) return []
  if (isDiffable(oldVal) && isDiffable(newVal)) {
    if (Array.isArray(oldVal) && Array.isArray(newVal)) {
      const out: Array<{ path: string; value: unknown }> = []
      const max = Math.max(oldVal.length, newVal.length)
      for (let i = 0; i < max; i++) {
        if (oldVal[i] === newVal[i]) continue
        out.push(...diffPaths(`${base}[${i}]`, oldVal[i], newVal[i]))
      }
      return out
    }
    if (!Array.isArray(oldVal) && !Array.isArray(newVal)) {
      const out: Array<{ path: string; value: unknown }> = []
      const keys = new Set([...Object.keys(oldVal as object), ...Object.keys(newVal as object)])
      for (const k of keys) {
        const ov = (oldVal as Record<string, unknown>)[k]
        const nv = (newVal as Record<string, unknown>)[k]
        if (ov === nv) continue
        out.push(...diffPaths(`${base}.${k}`, ov, nv))
      }
      return out
    }
  }
  // 类型变化 / 标量 / 混合：整体替换
  return [{ path: base, value: newVal }]
}

/** 展开对象/数组为全部叶路径（首次推送 / 无旧值基准时：无 diff 可做，直接叶路径补丁） */
function flattenPaths(base: string, value: unknown): Array<{ path: string; value: unknown }> {
  if (isDiffable(value)) {
    if (Array.isArray(value)) {
      const out: Array<{ path: string; value: unknown }> = []
      value.forEach((item, i) => out.push(...flattenPaths(`${base}[${i}]`, item)))
      return out.length ? out : [{ path: base, value }]
    }
    const out: Array<{ path: string; value: unknown }> = []
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(...flattenPaths(`${base}.${k}`, v))
    }
    return out.length ? out : [{ path: base, value }]
  }
  return [{ path: base, value }]
}

class SetDataBridge {
  private batchWindow: number
  /** key = 页面路径，value = 脏路径 → 记录 */
  private dirty = new Map<string, Map<string, DirtyRecord>>()
  /** key = 页面路径，value = 上次已推送的值（值去重 + 深层 diff 的旧值基准） */
  private lastValues = new Map<string, Map<string, unknown>>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(batchWindow = 16) {
    this.batchWindow = batchWindow
  }

  /** 标记某个页面/组件的某个数据路径为脏 */
  markDirty(pagePath: string, dataPath: string, value: unknown): void {
    const last = this.lastValues.get(pagePath)?.get(dataPath)
    // 深层 diff（v0.4）：对象/数组变更递归出叶路径补丁（只推送变化子路径）
    let patches: Array<{ path: string; value: unknown }>
    if (isDiffable(value)) {
      patches = isDiffable(last) ? diffPaths(dataPath, last, value) : flattenPaths(dataPath, value)
    } else {
      // 标量：值比较去重
      if (last === value) return
      patches = [{ path: dataPath, value }]
    }
    if (!patches.length) return
    for (const p of patches) this.addDirty(pagePath, p.path, p.value)
    // 记录完整新值（作为下次 diff 的旧值基准）
    let lastMap = this.lastValues.get(pagePath)
    if (!lastMap) {
      lastMap = new Map()
      this.lastValues.set(pagePath, lastMap)
    }
    lastMap.set(dataPath, value)
  }

  /** 重置桥接状态（测试隔离用） */
  reset(): void {
    this.dirty.clear()
    this.lastValues.clear()
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** 单条脏路径入队（路径合并：父覆盖子 / 子覆盖父） */
  private addDirty(pagePath: string, dataPath: string, value: unknown): void {
    let map = this.dirty.get(pagePath)
    if (!map) {
      map = new Map()
      this.dirty.set(pagePath, map)
    }
    // 已有祖先路径脏 → 子路径被覆盖，跳过
    for (const existing of map.keys()) {
      if (isChildPath(existing, dataPath)) return
    }
    // 新路径是已有脏路径的祖先 → 移除被覆盖的子路径
    for (const existing of [...map.keys()]) {
      if (isChildPath(dataPath, existing)) map.delete(existing)
    }
    map.set(dataPath, { path: dataPath, value })
    this.scheduleFlush()
  }

  /** 调度批量刷新 */
  private scheduleFlush(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), this.batchWindow)
  }

  /** 执行批量 setData */
  private flush(): void {
    this.timer = null
    for (const [pagePath, dirtyMap] of this.dirty) {
      const page = adapter.getCurrentPages().find((p) => p.route === pagePath)
      if (!page?.setData) continue
      const data: Record<string, unknown> = {}
      for (const { path, value } of dirtyMap.values()) data[path] = value
      page.setData(data)
    }
    this.dirty.clear()
  }

  /** 立即刷新（同步，用于 onUnload 等场景） */
  flushSync(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.flush()
  }
}

/** 工厂（拆包后由入口/插件注入 batchWindow）；默认单例导出保持兼容 */
export function createSetDataBridge(opts: SetDataBridgeOptions = {}): SetDataBridge {
  return new SetDataBridge(opts.batchWindow ?? 16)
}

export const setDataBridge = createSetDataBridge()
