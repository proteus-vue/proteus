// src/runtime/setDataBridge.ts
// 响应式 → setData 批量桥接（P5-1）
// 核心：按页面粒度收集脏路径，在 batchWindow（16ms ≈ 1 帧）内合并多次变更为一次 setData；
// 路径合并（父覆盖子）+ 值比较去重（对比上次已推送值），直击 uni-app 全量大对象 setData 痛点。
import config from '../../proteus.config'
import { adapter } from '../platform'

interface DirtyRecord {
  /** 数据路径，如 "list[0].name" */
  path: string
  value: unknown
}

/** 判断 child 是否为 parent 的后代路径（支持点号与数组下标两种分隔） */
function isChildPath(parent: string, child: string): boolean {
  return child.startsWith(parent + '.') || child.startsWith(parent + '[')
}

class SetDataBridge {
  /** key = 页面路径，value = 脏路径 → 记录 */
  private dirty = new Map<string, Map<string, DirtyRecord>>()
  /** key = 页面路径，value = 上次已推送的值（值去重用） */
  private lastValues = new Map<string, Map<string, unknown>>()
  private timer: ReturnType<typeof setTimeout> | null = null

  /** 标记某个页面/组件的某个数据路径为脏 */
  markDirty(pagePath: string, dataPath: string, value: unknown): void {
    // 1. 值比较去重：与上次已推送的值相同 → 跳过
    if (this.lastValues.get(pagePath)?.get(dataPath) === value) return

    let map = this.dirty.get(pagePath)
    if (!map) {
      map = new Map()
      this.dirty.set(pagePath, map)
    }

    // 2. 路径合并（父覆盖子）：
    //    - 已有祖先路径脏 → 子路径被覆盖，跳过
    for (const existing of map.keys()) {
      if (isChildPath(existing, dataPath)) return
    }
    //    - 新路径是已有脏路径的祖先 → 移除被覆盖的子路径
    for (const existing of [...map.keys()]) {
      if (isChildPath(dataPath, existing)) map.delete(existing)
    }

    map.set(dataPath, { path: dataPath, value })
    this.scheduleFlush()
  }

  /** 调度批量刷新 */
  private scheduleFlush(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), config.setDataBridge.batchWindow)
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
      // 记录本次推送值，供值比较去重
      let last = this.lastValues.get(pagePath)
      if (!last) {
        last = new Map()
        this.lastValues.set(pagePath, last)
      }
      for (const [path, value] of Object.entries(data)) last.set(path, value)
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

export const setDataBridge = new SetDataBridge()
