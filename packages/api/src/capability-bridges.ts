// packages/api/src/capability-bridges.ts —— 能力层**平台桥实现**（自 capability.ts 拆出 · 决策 #870）
//   wxBridge / webBridge 两套平台实现 + 其私有助手（存储/文件系统/进度句柄/NFC/性能条目归一）。
//   ★全部平台桥集中在本文件：唯一跨桥可变状态 `idleSeq` 由 wxBridge/webBridge 共享——
//   ES 模块的 import 绑定只读，拆分到两个文件会导致 `++idleSeq` 编译错误，故不可再分。
//   契约在 capability-types.ts；工厂/Hook 在 capability.ts。★纯机械搬迁，行为零变化。
import { detectRuntime } from '@proteus-vue/shared'
import { createAppLifecycleCapabilities, detectAppHost, getHostLifecycleBus, installAppEventSource, installPageEmitBridge, installWebEventSources, installWxAppEventBridge } from './capability-app'
import { BRIDGE_DECLS } from './bridge-decls/index'
import type { RequestResponse } from '@proteus-vue/types/api-types'
import { CapError, capErr, capOk, wrap } from './capability-types'
import type { BackgroundEvent, BannerAdHandle, BleDevice, BluetoothAPI, CacheManagerState, CalendarEvent, CanvasContext, CanvasExportOptions, CanvasGradientLike, CanvasNode, CanvasPatternLike, CanvasTextMetrics, CapResult, CapabilityBridge, CompatStorage, ElementFieldsResult, ElementRect, ElementScrollOffset, FSAdapter, FileStat, FileSystemBridge, IntersectionHandle, IntersectionResult, InterstitialAdHandle, KeyboardInfo, LivePlayState, MapCircle, MapContextBridge, MapMarker, MapPolyline, MediaFile, MediaQueryCondition, MediaQueryResult, MediaTrackInfo, NFCAPI, NdefHandle, NetworkType, NfcAdapter, NfcTag, NfcTagHandle, NotificationConstructor, OffscreenCanvasHandle, PerformanceEntry, PermissionState, PhotoResult, PreDownloadTask, PrivacySetting, RecordOptions, RewardedVideoAdHandle, SavedFileInfo, ShippingAddress, TCPSocketHandle, UDPSocketHandle, VKSessionState, VideoResult, WasmModuleHandle, WeRunData, WebAssemblyAPI, WifiInfo, WxInnerAudioContextLike, WxLike, WxNfcTagLike, WxPerformanceEntryLike, WxPreDownloadTaskLike, WxRecorderManagerLike, WxSelectorQueryLike, WxStatsLike, WxVideoContextLike } from './capability-types'
/** 内存存储兜底（wx sync 存储缺失 / Node / SSR） */
function memoryStorage(): CompatStorage {
  const mem = new Map<string, string>()
  return {
    get: <T>(key: string) => {
      const raw = mem.get(key)
      if (raw === undefined) return undefined
      try {
        return JSON.parse(raw) as T
      } catch {
        return undefined
      }
    },
    set: (key, value) => {
      mem.set(key, JSON.stringify(value))
    },
    remove: (key) => {
      mem.delete(key)
    },
    clear: () => {
      mem.clear()
    },
    // ★能力颗粒度对齐：异步/批量/info（内存实现同步语义包装 CapResult）
    setAsync: (key, value) => {
      mem.set(key, JSON.stringify(value))
      return Promise.resolve(capOk(undefined))
    },
    getAsync: <T,>(key: string) => {
      const raw = mem.get(key)
      if (raw === undefined) return Promise.resolve(capOk<T | undefined>(undefined))
      try {
        return Promise.resolve(capOk<T | undefined>(JSON.parse(raw) as T))
      } catch {
        return Promise.resolve(capOk<T | undefined>(undefined))
      }
    },
    removeAsync: (key) => {
      mem.delete(key)
      return Promise.resolve(capOk(undefined))
    },
    clearAsync: () => {
      mem.clear()
      return Promise.resolve(capOk(undefined))
    },
    info: () =>
      Promise.resolve(
        capOk({ keys: [...mem.keys()], currentSize: [...mem.values()].reduce((n, v) => n + v.length, 0), limitSize: 10 * 1024 * 1024 }),
      ),
    batchGet: (keys) =>
      Promise.resolve(
        capOk(
          keys.map((k) => {
            const raw = mem.get(k)
            let value: unknown
            try {
              value = raw === undefined ? undefined : JSON.parse(raw)
            } catch {
              value = undefined
            }
            return { key: k, value }
          }),
        ),
      ),
    batchSet: (kvList) => {
      kvList.forEach((kv) => mem.set(kv.key, JSON.stringify(kv.value)))
      return Promise.resolve(capOk(undefined))
    },
  }
}

/** wx 存储适配（sync 存储缺失 → 内存兜底） */
function wxStorage(wx: WxLike): CompatStorage {
  if (typeof wx.setStorageSync !== 'function') return memoryStorage()
  const sync: Pick<CompatStorage, 'get' | 'set' | 'remove' | 'clear'> = {
    get: <T>(key: string) => (wx.getStorageSync ? (wx.getStorageSync(key) as T) : undefined),
    set: (key, value) => {
      if (wx.setStorageSync) wx.setStorageSync(key, value)
    },
    remove: (key) => {
      if (wx.removeStorageSync) wx.removeStorageSync(key)
    },
    clear: () => {
      if (wx.clearStorageSync) wx.clearStorageSync()
    },
  }
  // ★能力颗粒度对齐：异步 API（缺 wx 异步 → 用同步结果包装；保证契约一致不 Err）
  const pAsync = <T>(fn: (resolve: (r: T) => void, reject: (e: unknown) => void) => void, code = 'storage.failed'): Promise<CapResult<T>> =>
    new Promise<CapResult<T>>((resolve) => fn((r) => resolve(capOk(r)), (e) => resolve(capErr<T>(code, (e as { errMsg?: string })?.errMsg || '存储操作失败', e))))
  return {
    ...sync,
    setAsync: (key, value) => (wx.setStorage ? pAsync<void>((res, rej) => wx.setStorage!({ key, data: value, success: () => res(undefined as never), fail: rej })) : Promise.resolve(capOk(sync.set(key, value)))),
    getAsync: <T,>(key: string) => (wx.getStorage ? pAsync<T | undefined>((res, rej) => wx.getStorage!({ key, success: (r) => res(r.data as T), fail: rej })) : Promise.resolve(capOk(sync.get<T>(key)))),
    removeAsync: (key) => (wx.removeStorage ? pAsync<void>((res, rej) => wx.removeStorage!({ key, success: () => res(undefined as never), fail: rej })) : Promise.resolve(capOk(sync.remove(key)))),
    clearAsync: () => (wx.clearStorage ? pAsync<void>((res, rej) => wx.clearStorage!({ success: () => res(undefined as never), fail: rej })) : Promise.resolve(capOk(sync.clear()))),
    info: () =>
      wx.getStorageInfo
        ? pAsync<{ keys: string[]; currentSize: number; limitSize: number }>((res, rej) => wx.getStorageInfo!({ success: (r) => res({ keys: r.keys ?? [], currentSize: r.currentSize ?? 0, limitSize: r.limitSize ?? 0 }), fail: rej }))
        : Promise.resolve(capOk({ keys: [], currentSize: 0, limitSize: 0 })),
    batchGet: (keys) =>
      wx.batchGetStorage
        ? pAsync<Array<{ key: string; value: unknown }>>((res, rej) => wx.batchGetStorage!({ keyList: keys, success: (r) => res((r.kvList ?? []).map((kv) => ({ key: kv.key, value: kv.value }))), fail: rej }))
        : Promise.resolve(capOk(keys.map((k) => ({ key: k, value: sync.get(k) })))),
    batchSet: (kvList) =>
      wx.batchSetStorage
        ? pAsync<void>((res, rej) => wx.batchSetStorage!({ kvList, success: () => res(undefined as never), fail: rej }))
        : Promise.resolve(capOk(kvList.forEach((kv) => sync.set(kv.key, kv.value)) as unknown as void)),
  }
}

/** web 内存文件系统（C43 降级：可读写但非持久——无标准同步 FS 时的诚实降级） */
function memoryFileSystem(): FileSystemBridge {
  // ★能力颗粒度对齐：Web/SSR 内存降级——实现完整 FileSystemBridge（目录语义用 '/' 前缀 key 模拟）
  const mem = new Map<string, string>()
  const dirs = new Set<string>()
  const isDir = (path: string): boolean => dirs.has(path)
  const dirPrefix = (path: string): string => (path.endsWith('/') ? path : path + '/')
  const childrenOf = (path: string): string[] => {
    const pfx = dirPrefix(path)
    const out = new Set<string>()
    for (const k of mem.keys()) {
      if (k.startsWith(pfx)) out.add(k.slice(pfx.length).split('/')[0] as string)
    }
    for (const d of dirs) {
      if (d !== path && d.startsWith(pfx)) out.add(d.slice(pfx.length).split('/')[0] as string)
    }
    return [...out]
  }
  const statOf = (path: string): FileStat => {
    const v = mem.get(path)
    const directory = isDir(path)
    return { size: v ? v.length : 0, mode: 0, lastAccessedTime: 0, lastModifiedTime: 0, isDirectory: directory, isFile: !directory }
  }
  const asyncOk = (): Promise<void> => Promise.resolve()
  return {
    readFile: (path) =>
      new Promise((resolve, reject) => {
        const v = mem.get(path)
        if (v === undefined) return reject(new CapError('file-system.read-failed', `内存文件不存在: ${path}`))
        resolve(v)
      }),
    writeFile: (path, data) => {
      mem.set(path, data)
      return asyncOk()
    },
    appendFile: (path, data) => {
      mem.set(path, (mem.get(path) ?? '') + data)
      return asyncOk()
    },
    copyFile: (src, dest) => {
      if (!mem.has(src)) return Promise.reject(new CapError('file-system.copy-failed', `内存文件不存在: ${src}`))
      mem.set(dest, mem.get(src) as string)
      return asyncOk()
    },
    rename: (o, n) => {
      if (!mem.has(o)) return Promise.reject(new CapError('file-system.rename-failed', `内存文件不存在: ${o}`))
      mem.set(n, mem.get(o) as string)
      mem.delete(o)
      return asyncOk()
    },
    remove: (path) => {
      mem.delete(path)
      return asyncOk()
    },
    exists: (path) => Promise.resolve(mem.has(path) || isDir(path)),
    stat: (path) => {
      if (!mem.has(path) && !isDir(path)) return Promise.reject(new CapError('file-system.stat-failed', `不存在: ${path}`))
      return Promise.resolve(statOf(path))
    },
    mkdir: (path) => {
      dirs.add(path)
      return asyncOk()
    },
    rmdir: (path) => {
      dirs.delete(path)
      return asyncOk()
    },
    readdir: (path) => Promise.resolve(childrenOf(path)),
    getFileInfo: (path) => {
      if (!mem.has(path)) return Promise.reject(new CapError('file-system.info-failed', `内存文件不存在: ${path}`))
      const v = mem.get(path) as string
      return Promise.resolve({ size: v.length, digest: String(v.length) })
    },
    saveFile: (temp) => Promise.resolve(temp),
    getSavedFileList: () => Promise.resolve([...mem.keys()].map((p) => ({ filePath: p, size: (mem.get(p) ?? '').length, createTime: 0 }))),
    removeSavedFile: (path) => {
      mem.delete(path)
      return asyncOk()
    },
    unzip: () => Promise.reject(new CapError('file-system.unsupported', 'web 内存降级不支持解压')),
    readFileSync: (path) => {
      const v = mem.get(path)
      if (v === undefined) throw new CapError('file-system.read-failed', `内存文件不存在: ${path}`)
      return v
    },
    writeFileSync: (path, data) => {
      mem.set(path, data)
    },
    existsSync: (path) => mem.has(path) || isDir(path),
    statSync: (path) => {
      if (!mem.has(path) && !isDir(path)) throw new CapError('file-system.stat-failed', `不存在: ${path}`)
      return statOf(path)
    },
    readdirSync: (path) => childrenOf(path),
    mkdirSync: (path) => {
      dirs.add(path)
    },
    renameSync: (o, n) => {
      if (!mem.has(o)) throw new CapError('file-system.rename-failed', `内存文件不存在: ${o}`)
      mem.set(n, mem.get(o) as string)
      mem.delete(o)
    },
    unlinkSync: (path) => {
      mem.delete(path)
    },
    copyFileSync: (src, dest) => {
      if (!mem.has(src)) throw new CapError('file-system.copy-failed', `内存文件不存在: ${src}`)
      mem.set(dest, mem.get(src) as string)
    },
    appendFileSync: (path, data) => {
      mem.set(path, (mem.get(path) ?? '') + data)
    },
  }
}

/** wx 文件系统桥（getFileSystemManager 子集——readFile/writeFile/unlink/access） */
function normStats(st: WxStatsLike): FileStat {
  return {
    size: st.size ?? 0,
    mode: st.mode ?? 0,
    lastAccessedTime: st.lastAccessedTime ?? 0,
    lastModifiedTime: st.lastModifiedTime ?? 0,
    isDirectory: typeof st.isDirectory === 'function' ? st.isDirectory() : false,
    isFile: typeof st.isFile === 'function' ? st.isFile() : true,
  }
}

function wxFileSystem(wx: WxLike): FileSystemBridge {
  const fs = wx.getFileSystemManager?.()
  const need = (fn: unknown, name: string): void => {
    if (typeof fn !== 'function') throw new CapError('file-system.unsupported', 'wx FileSystemManager.' + name + ' 缺失')
  }
  const prom = <T>(fn: (cb: { success: (r: never) => void; fail: (e: unknown) => void }) => void, code = 'file-system.failed'): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      fn({
        success: (r: never) => resolve(r as T),
        fail: (e: unknown) => reject(new CapError(code, (e as { errMsg?: string })?.errMsg || 'wx 文件操作失败', e)),
      })
    })
  const ok = (fn: () => void, code = 'file-system.failed'): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      try {
        fn()
        resolve()
      } catch (e) {
        reject(new CapError(code, (e as { errMsg?: string })?.errMsg || 'wx 文件操作失败', e))
      }
    })
  const guard = <T>(fn: () => T, code = 'file-system.failed'): CapResult<T> => {
    try {
      return capOk(fn())
    } catch (e) {
      return capErr<T>(e instanceof CapError ? e.code : code, e instanceof Error ? e.message : String(e), e)
    }
  }

  const read = (path: string): Promise<string> =>
    new Promise((resolve, reject) => {
      if (!fs?.readFile) return reject(new CapError('file-system.unsupported', 'wx FileSystemManager.readFile 缺失'))
      fs.readFile({ filePath: path, encoding: 'utf8', success: (r) => resolve(String(r.data)), fail: (e) => reject(new CapError('file-system.read-failed', 'wx 读文件失败', e)) })
    })
  const write = (path: string, data: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!fs?.writeFile) return reject(new CapError('file-system.unsupported', 'wx FileSystemManager.writeFile 缺失'))
      fs.writeFile({ filePath: path, data, encoding: 'utf8', success: () => resolve(), fail: (e) => reject(new CapError('file-system.write-failed', 'wx 写文件失败', e)) })
    })
  const remove = (path: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!fs?.unlink) return reject(new CapError('file-system.unsupported', 'wx FileSystemManager.unlink 缺失'))
      fs.unlink({ filePath: path, success: () => resolve(), fail: (e) => reject(new CapError('file-system.remove-failed', 'wx unlink 失败', e)) })
    })
  const exists = (path: string): Promise<boolean> =>
    new Promise((resolve) => {
      if (!fs?.access) {
        resolve(false)
        return
      }
      fs.access({ path, success: () => resolve(true), fail: () => resolve(false) })
    })

  // 异步操作（缺 API → reject 显式 Err）
  const append = (path: string, data: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!fs?.appendFile) return reject(new CapError('file-system.unsupported', 'FileSystemManager.appendFile 缺失'))
      fs.appendFile({ filePath: path, data, encoding: 'utf8', success: () => resolve(), fail: (e) => reject(new CapError('file-system.append-failed', '追加失败', e)) })
    })
  const copy = (src: string, dest: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!fs?.copyFile) return reject(new CapError('file-system.unsupported', 'FileSystemManager.copyFile 缺失'))
      fs.copyFile({ srcPath: src, destPath: dest, success: () => resolve(), fail: (e) => reject(new CapError('file-system.copy-failed', '复制失败', e)) })
    })
  const rename = (o: string, n: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!fs?.rename) return reject(new CapError('file-system.unsupported', 'FileSystemManager.rename 缺失'))
      fs.rename({ oldPath: o, newPath: n, success: () => resolve(), fail: (e) => reject(new CapError('file-system.rename-failed', '重命名失败', e)) })
    })
  const stat = (path: string): Promise<FileStat> =>
    new Promise((resolve, reject) => {
      if (!fs?.stat) return reject(new CapError('file-system.unsupported', 'FileSystemManager.stat 缺失'))
      fs.stat({ path, success: (r) => resolve(normStats(r)), fail: (e) => reject(new CapError('file-system.stat-failed', 'stat 失败', e)) })
    })
  const mkdir = (path: string, recursive = false): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!fs?.mkdir) return reject(new CapError('file-system.unsupported', 'FileSystemManager.mkdir 缺失'))
      fs.mkdir({ dirPath: path, recursive, success: () => resolve(), fail: (e) => reject(new CapError('file-system.mkdir-failed', '创建目录失败', e)) })
    })
  const rmdir = (path: string, recursive = false): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!fs?.rmdir) return reject(new CapError('file-system.unsupported', 'FileSystemManager.rmdir 缺失'))
      fs.rmdir({ dirPath: path, recursive, success: () => resolve(), fail: (e) => reject(new CapError('file-system.rmdir-failed', '删除目录失败', e)) })
    })
  const readdir = (path: string): Promise<string[]> =>
    new Promise((resolve, reject) => {
      if (!fs?.readdir) return reject(new CapError('file-system.unsupported', 'FileSystemManager.readdir 缺失'))
      fs.readdir({ dirPath: path, success: (r) => resolve(r.files ?? []), fail: (e) => reject(new CapError('file-system.readdir-failed', '读目录失败', e)) })
    })
  const getFileInfo = (path: string, digestAlgorithm = 'md5'): Promise<{ size: number; digest: string }> =>
    new Promise((resolve, reject) => {
      if (!fs?.getFileInfo) return reject(new CapError('file-system.unsupported', 'FileSystemManager.getFileInfo 缺失'))
      fs.getFileInfo({ filePath: path, digestAlgorithm, success: (r) => resolve({ size: r.size, digest: r.digest }), fail: (e) => reject(new CapError('file-system.info-failed', 'getFileInfo 失败', e)) })
    })
  const saveFile = (temp: string): Promise<string> =>
    new Promise((resolve, reject) => {
      if (!fs?.saveFile) return reject(new CapError('file-system.unsupported', 'FileSystemManager.saveFile 缺失'))
      fs.saveFile({ tempFilePath: temp, success: (r) => resolve(r.savedFilePath), fail: (e) => reject(new CapError('file-system.save-failed', 'saveFile 失败', e)) })
    })
  const getSavedFileList = (): Promise<SavedFileInfo[]> =>
    new Promise((resolve, reject) => {
      if (!fs?.getSavedFileList) return reject(new CapError('file-system.unsupported', 'FileSystemManager.getSavedFileList 缺失'))
      fs.getSavedFileList({ success: (r) => resolve((r.fileList ?? []).map((f) => ({ filePath: f.filePath, size: f.size, createTime: f.createTime }))), fail: (e) => reject(new CapError('file-system.list-failed', 'getSavedFileList 失败', e)) })
    })
  const removeSavedFile = (path: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!fs?.removeSavedFile) return reject(new CapError('file-system.unsupported', 'FileSystemManager.removeSavedFile 缺失'))
      fs.removeSavedFile({ filePath: path, success: () => resolve(), fail: (e) => reject(new CapError('file-system.remove-failed', 'removeSavedFile 失败', e)) })
    })
  const unzip = (zip: string, target: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!fs?.unzip) return reject(new CapError('file-system.unsupported', 'FileSystemManager.unzip 缺失'))
      fs.unzip({ zipFilePath: zip, targetPath: target, success: () => resolve(), fail: (e) => reject(new CapError('file-system.unzip-failed', '解压失败', e)) })
    })

  // Sync 变体（缺 API → 抛，由 FSAdapter 包 CapResult）
  const req = (fn: unknown, name: string): void => need(fn, name)
  return {
    readFile: read,
    writeFile: write,
    appendFile: append,
    copyFile: copy,
    rename,
    remove,
    exists,
    stat,
    mkdir,
    rmdir,
    readdir,
    getFileInfo,
    saveFile,
    getSavedFileList,
    removeSavedFile,
    unzip,
    readFileSync: (path) => {
      req(fs?.readFileSync, 'readFileSync')
      return String((fs!.readFileSync as (o: { filePath: string; encoding?: string }) => string | ArrayBuffer)({ filePath: path, encoding: 'utf8' }))
    },
    writeFileSync: (path, data) => {
      req(fs?.writeFileSync, 'writeFileSync')
      ;(fs!.writeFileSync as (o: { filePath: string; data: string; encoding?: string }) => void)({ filePath: path, data, encoding: 'utf8' })
    },
    existsSync: (path) => {
      if (!fs?.accessSync) throw new CapError('file-system.unsupported', 'FileSystemManager.accessSync 缺失')
      try {
        ;(fs.accessSync as (o: { path: string }) => void)({ path })
        return true
      } catch {
        return false
      }
    },
    statSync: (path) => {
      req(fs?.statSync, 'statSync')
      return normStats((fs!.statSync as (o: { path: string }) => WxStatsLike)({ path }))
    },
    readdirSync: (path) => {
      req(fs?.readdirSync, 'readdirSync')
      return (fs!.readdirSync as (o: { dirPath: string }) => string[])({ dirPath: path }) ?? []
    },
    mkdirSync: (path, recursive = false) => {
      req(fs?.mkdirSync, 'mkdirSync')
      ;(fs!.mkdirSync as (o: { dirPath: string; recursive?: boolean }) => void)({ dirPath: path, recursive })
    },
    renameSync: (o, n) => {
      req(fs?.renameSync, 'renameSync')
      ;(fs!.renameSync as (x: { oldPath: string; newPath: string }) => void)({ oldPath: o, newPath: n })
    },
    unlinkSync: (path) => {
      req(fs?.unlinkSync, 'unlinkSync')
      ;(fs!.unlinkSync as (x: { filePath: string }) => void)({ filePath: path })
    },
    copyFileSync: (src, dest) => {
      req(fs?.copyFileSync, 'copyFileSync')
      ;(fs!.copyFileSync as (x: { srcPath: string; destPath: string }) => void)({ srcPath: src, destPath: dest })
    },
    appendFileSync: (path, data) => {
      req(fs?.appendFileSync, 'appendFileSync')
      ;(fs!.appendFileSync as (x: { filePath: string; data: string; encoding?: string }) => void)({ filePath: path, data, encoding: 'utf8' })
    },
  }
  void prom
  void ok
  void guard
}

export function wxBridge(wx: WxLike): CapabilityBridge {
  // ★★MP 端生命周期能力（2026-09-30 改走共享总线——见 getAppLifecycle/getPageLifecycle 注释）：
  //   懒建总线 + 装两个事件源（应用级=wx 全局 API；页面级=编译产物派发），只装一次。
  const mpLifecycleCaps = (() => {
    const bus = getHostLifecycleBus()
    // ★幂等（模块加载时已装一次；此处兜底"外部先建桥"的路径——重复安装只覆盖同一全局函数）
    installWxAppEventBridge(bus, wx)
    installPageEmitBridge(bus)
    return createAppLifecycleCapabilities(bus, CapError)
  })()
  return {
    getLocation: () =>
      new Promise((resolve, reject) => {
        if (!wx.getLocation) return reject(new CapError('location.unsupported', 'wx.getLocation 缺失'))
        wx.getLocation({
          success: (r) => resolve(r),
          fail: (e) => reject(new CapError('location.failed', 'wx.getLocation 失败', e)),
        })
      }),
    vibrate: (durationMs) =>
      new Promise((resolve, reject) => {
        if (!wx.vibrateShort) return reject(new CapError('vibrate.unsupported', 'wx.vibrateShort 缺失'))
        wx.vibrateShort({ fail: () => reject(new CapError('vibrate.failed', 'wx.vibrateShort 失败')) })
        resolve() // 短震无回调，直接成功（durationMs>0 短震语义）
      }),
    getNetwork: () =>
      new Promise((resolve, reject) => {
        // ★诚实降级（对齐 G-32.3 显式错误）：能力缺失必须 Err，不虚构在线状态
        if (!wx.getNetworkType) return reject(new CapError('network.unsupported', 'wx.getNetworkType 缺失'))
        wx.getNetworkType({ success: (r) => resolve({ online: true, type: normalizeNetwork(r.networkType) }), fail: () => reject(new CapError('network.failed', 'wx.getNetworkType 失败')) })
      }),
    readClipboard: () =>
      new Promise((resolve, reject) => {
        if (!wx.getClipboardData) return reject(new CapError('clipboard.read.unsupported', 'wx.getClipboardData 缺失'))
        wx.getClipboardData({ success: (r) => resolve(r.data), fail: () => reject(new CapError('clipboard.read.failed', '读取剪贴板失败')) })
      }),
    setClipboard: (text) =>
      new Promise((resolve, reject) => {
        if (!wx.setClipboardData) return reject(new CapError('clipboard.write.unsupported', 'wx.setClipboardData 缺失'))
        wx.setClipboardData({ data: text, success: () => resolve(), fail: () => reject(new CapError('clipboard.write.failed', '写入剪贴板失败')) })
      }),
    getScreen: async () => {
      const info = wx.getSystemInfoSync?.()
      if (!info) throw new CapError('screen.unsupported', 'wx.getSystemInfoSync 缺失')
      return { width: info.screenWidth, height: info.screenHeight, dpr: info.pixelRatio, orientation: 'portrait' }
    },
    getDevice: async () => {
      const info = wx.getSystemInfoSync?.()
      if (!info) throw new CapError('device.unsupported', 'wx.getSystemInfoSync 缺失')
      return { platform: info.platform, model: info.model, os: 'unknown', version: info.system }
    },
    getBattery: () =>
      new Promise((resolve, reject) => {
        if (!wx.getBatteryInfo) return reject(new CapError('battery.unsupported', 'wx.getBatteryInfo 缺失'))
        wx.getBatteryInfo({ success: (r) => resolve({ level: r.level / 100, charging: r.isCharging }) })
      }),
    getOrientation: () =>
      new Promise((resolve, reject) => {
        // ★诚实降级：缺失必须 Err，不虚构朝向
        if (!wx.onDeviceOrientationChange) return reject(new CapError('orientation.unsupported', 'wx.onDeviceOrientationChange 缺失'))
        wx.onDeviceOrientationChange((r) => resolve({ type: r.value === 'landscape' ? 'landscape' : 'portrait', angle: 0 }))
      }),
    share: async (options) => {
      if (!wx.shareAppMessage) throw new CapError('share.unsupported', 'wx.shareAppMessage 缺失')
      wx.shareAppMessage({ title: options.title })
    },
    // ★G-32 B3 续：request → wx.request 回调桥
    request: (config) =>
      new Promise((resolve, reject) => {
        if (!wx.request) return reject(new CapError('fetch.unsupported', 'wx.request 缺失'))
        wx.request({
          url: config.url,
          method: config.method,
          data: config.data,
          header: config.headers,
          success: (r) =>
            resolve({
              data: r.data,
              status: r.statusCode,
              headers: r.header ?? {},
              config,
            }),
          fail: (e) => reject(new CapError('fetch.failed', 'wx.request 失败', e)),
        })
      }),
    getStorage: () => wxStorage(wx),
    // ★G-32 B3 三期：新增能力（wx → Result；缺能力 → CapError 降级）
    readSensor: (kind) =>
      // ★修复：读到首帧后解除监听（原实现永久挂 on* → 泄漏；wx.off* 存在则调用）
      new Promise((resolve, reject) => {
        if (kind === 'compass') {
          if (!wx.onCompassChange) return reject(new CapError('sensor.compass.unsupported', 'wx.onCompassChange 缺失'))
          const h = (r: { direction?: number }): void => {
            if (wx.offCompassChange) wx.offCompassChange(h)
            resolve({ kind, heading: typeof r.direction === 'number' ? r.direction : 0, timestamp: Date.now() })
          }
          wx.onCompassChange(h)
          return
        }
        if (kind === 'gyroscope') {
          if (!wx.onGyroscopeChange) return reject(new CapError('sensor.gyroscope.unsupported', 'wx.onGyroscopeChange 缺失'))
          const h = (r: { x: number; y: number; z: number }): void => {
            if (wx.offGyroscopeChange) wx.offGyroscopeChange(h)
            resolve({ kind, x: r.x, y: r.y, z: r.z, timestamp: Date.now() })
          }
          wx.onGyroscopeChange(h)
          return
        }
        if (!wx.onAccelerometerChange) return reject(new CapError('sensor.accelerometer.unsupported', 'wx.onAccelerometerChange 缺失'))
        const h = (r: { x: number; y: number; z: number }): void => {
          if (wx.offAccelerometerChange) wx.offAccelerometerChange(h)
          resolve({ kind, x: r.x, y: r.y, z: r.z, timestamp: Date.now() })
        }
        wx.onAccelerometerChange(h)
      }),
    // ★能力颗粒度对齐：传感器流启停（start/stop 显式生命周期）
    startSensor: (kind) =>
      new Promise((resolve, reject) => {
        const start = kind === 'compass' ? wx.startCompass : kind === 'gyroscope' ? wx.startGyroscope : wx.startAccelerometer
        if (typeof start !== 'function') return reject(new CapError('sensor.' + kind + '.unsupported', 'wx.start' + kind + ' 缺失'))
        start({ success: () => resolve(), fail: (e: unknown) => reject(new CapError('sensor.start-failed', '传感器启动失败', e)) })
      }),
    stopSensor: (kind) =>
      new Promise((resolve, reject) => {
        const stop = kind === 'compass' ? wx.stopCompass : kind === 'gyroscope' ? wx.stopGyroscope : wx.stopAccelerometer
        if (typeof stop !== 'function') return reject(new CapError('sensor.' + kind + '.unsupported', 'wx.stop' + kind + ' 缺失'))
        stop({ success: () => resolve(), fail: (e: unknown) => reject(new CapError('sensor.stop-failed', '传感器停止失败', e)) })
      }),
    // ★能力颗粒度对齐：持续推送（on*Change 挂接 → cb；返回取消订阅）
    subscribeSensor: (kind, cb) => {
      if (kind === 'compass') {
        if (!wx.onCompassChange) return () => {}
        const h = (r: { direction?: number }): void => cb({ kind, heading: typeof r.direction === 'number' ? r.direction : 0, timestamp: Date.now() })
        wx.onCompassChange(h)
        return () => {
          if (wx.offCompassChange) wx.offCompassChange(h)
        }
      }
      if (kind === 'gyroscope') {
        if (!wx.onGyroscopeChange) return () => {}
        const h = (r: { x: number; y: number; z: number }): void => cb({ kind, x: r.x, y: r.y, z: r.z, timestamp: Date.now() })
        wx.onGyroscopeChange(h)
        return () => {
          if (wx.offGyroscopeChange) wx.offGyroscopeChange(h)
        }
      }
      if (!wx.onAccelerometerChange) return () => {}
      const h = (r: { x: number; y: number; z: number }): void => cb({ kind, x: r.x, y: r.y, z: r.z, timestamp: Date.now() })
      wx.onAccelerometerChange(h)
      return () => {
        if (wx.offAccelerometerChange) wx.offAccelerometerChange(h)
      }
    },
    getBrightness: () =>
      new Promise((resolve, reject) => {
        if (!wx.getScreenBrightness) return reject(new CapError('brightness.unsupported', 'wx.getScreenBrightness 缺失'))
        wx.getScreenBrightness({ success: (r) => resolve(r.value) })
      }),
    setBrightness: (value) =>
      new Promise((resolve, reject) => {
        if (!wx.setScreenBrightness) return reject(new CapError('brightness.unsupported', 'wx.setScreenBrightness 缺失'))
        wx.setScreenBrightness({ value, fail: () => reject(new CapError('brightness.failed', 'wx.setScreenBrightness 失败')) })
        resolve()
      }),
    makePhoneCall: (phoneNumber) =>
      new Promise((resolve, reject) => {
        if (!wx.makePhoneCall) return reject(new CapError('phone-call.unsupported', 'wx.makePhoneCall 缺失'))
        wx.makePhoneCall({
          phoneNumber,
          success: () => resolve(),
          fail: () => reject(new CapError('phone-call.failed', 'wx.makePhoneCall 失败')),
        })
      }),
    checkBiometricSupport: () =>
      new Promise((resolve, reject) => {
        if (!wx.checkIsSupportFingerPrint) return reject(new CapError('biometric.unsupported', 'wx.checkIsSupportFingerPrint 缺失'))
        wx.checkIsSupportFingerPrint({
          success: (r) => resolve(r.isSupported === true),
          fail: () => reject(new CapError('biometric.unsupported', 'wx 指纹检测失败')),
        })
      }),
    authenticateBiometric: (options) =>
      new Promise((resolve, reject) => {
        if (!wx.startSoterAuthentication) return reject(new CapError('biometric.unsupported', 'wx.startSoterAuthentication 缺失'))
        wx.startSoterAuthentication({
          requestAuthModes: ['fingerPrint'],
          success: () => resolve(true),
          fail: () => reject(new CapError('biometric.failed', '生物识别认证失败', options)),
        })
      }),
    requestPayment: (config) =>
      new Promise((resolve, reject) => {
        if (!wx.requestPayment) return reject(new CapError('payment.unsupported', 'wx.requestPayment 缺失'))
        wx.requestPayment({
          timeStamp: config.timeStamp,
          nonceStr: config.nonceStr,
          package: config.package,
          signType: config.signType,
          paySign: config.paySign,
          success: () => resolve({ provider: 'wx', transactionId: config.nonceStr }),
          fail: (e) => reject(new CapError('payment.failed', 'wx.requestPayment 失败', e)),
        })
      }),
    login: (provider) =>
      new Promise((resolve, reject) => {
        if (!wx.login) return reject(new CapError('login.unsupported', 'wx.login 缺失'))
        wx.login({
          success: (r) => resolve({ provider: provider ?? 'wx', code: r.code }),
          fail: (e) => reject(new CapError('login.failed', 'wx.login 失败', e)),
        })
      }),
    scanQR: () =>
      new Promise((resolve, reject) => {
        if (!wx.scanCode) return reject(new CapError('qr-code.unsupported', 'wx.scanCode 缺失'))
        wx.scanCode({ success: (r) => resolve(r.result), fail: (e) => reject(new CapError('qr-code.failed', 'wx.scanCode 失败', e)) })
      }),
    // ★G-32 B3 四期：websocket / upload / download / analytics / log / file-system
    connectWebSocket: (url, protocols) =>
      new Promise((resolve, reject) => {
        if (!wx.connectSocket) return reject(new CapError('websocket.unsupported', 'wx.connectSocket 缺失'))
        const task = wx.connectSocket({ url, protocols: protocols ?? [] })
        if (!task) return reject(new CapError('websocket.failed', 'wx.connectSocket 返回空'))
        let settled = false
        task.onError?.(() => {
          if (!settled) {
            settled = true
            reject(new CapError('websocket.failed', 'wx.connectSocket 连接失败'))
          }
        })
        task.onOpen?.(() => {
          if (settled) return
          settled = true
          resolve({
            send: (data) => task.send?.({ data }),
            close: (code, reason) => task.close?.({ code, reason }),
            on: (event, handler) => {
              if (event === 'open') task.onOpen?.(() => handler())
              else if (event === 'message') task.onMessage?.((r) => handler({ data: r.data }))
              else if (event === 'close') task.onClose?.((r) => handler({ code: r.code, reason: r.reason }))
              else if (event === 'error') task.onError?.((e) => handler(e))
              return () => undefined
            },
          })
        })
      }),
    upload: (options, onProgress) =>
      new Promise((resolve, reject) => {
        if (!wx.uploadFile) return reject(new CapError('upload.unsupported', 'wx.uploadFile 缺失'))
        if (!options.filePath) return reject(new CapError('upload.failed', 'wx 上传缺少 filePath'))
        const task = wx.uploadFile({
          url: options.url,
          filePath: options.filePath,
          name: options.name ?? 'file',
          formData: options.formData,
          header: options.headers,
          timeout: options.timeout,
          success: (r) => resolve({ status: r.statusCode, data: r.data }),
          fail: (e) => reject(new CapError('upload.failed', 'wx.uploadFile 失败', e)),
        })
        task?.onProgressUpdate?.((r) => onProgress?.(r.progress))
      }),
    download: (url, options, onProgress) =>
      new Promise((resolve, reject) => {
        if (!wx.downloadFile) return reject(new CapError('download.unsupported', 'wx.downloadFile 缺失'))
        const task = wx.downloadFile({
          url,
          header: options?.headers,
          timeout: options?.timeout,
          success: (r) => resolve({ status: r.statusCode, path: r.tempFilePath, data: r.tempFilePath }),
          fail: (e) => reject(new CapError('download.failed', 'wx.downloadFile 失败', e)),
        })
        task?.onProgressUpdate?.((r) => onProgress?.(r.progress))
      }),
    track: (name, params) =>
      new Promise((resolve) => {
        if (!wx.reportEvent) {
          resolve()
          return
        }
        wx.reportEvent({ event: name, data: params })
        resolve()
      }),
    log: (level, message, data) =>
      new Promise((resolve) => {
        const fn = console[level]
        if (typeof fn === 'function') fn(message, data !== undefined ? data : '')
        resolve()
      }),
    getFileSystem: () => wxFileSystem(wx),
    // ★G-32 B3 五期：notification / contact / calendar / app-lifecycle / archive / shortcut
    subscribeMessage: (templateId) =>
      new Promise((resolve, reject) => {
        if (!wx.requestSubscribeMessage) return reject(new CapError('notification.unsupported', 'wx.requestSubscribeMessage 缺失'))
        wx.requestSubscribeMessage({
          tmplIds: [templateId],
          success: (r) => {
            const status = r[templateId] ?? 'reject'
            resolve({ templateId, granted: status === 'accept', status })
          },
          fail: (e) => reject(new CapError('notification.failed', 'wx.requestSubscribeMessage 失败', e)),
        })
      }),
    subscribeDeviceMessage: (templateId) =>
      new Promise((resolve, reject) => {
        if (!wx.requestSubscribeDeviceMessage) return reject(new CapError('notification.unsupported', 'wx.requestSubscribeDeviceMessage 缺失'))
        wx.requestSubscribeDeviceMessage({
          tmplIds: [templateId],
          success: (r) => {
            const status = (r ?? {})[templateId] ?? 'reject'
            resolve({ templateId, granted: status === 'accept', status })
          },
          fail: (e) => reject(new CapError('notification.failed', 'wx.requestSubscribeDeviceMessage 失败', e)),
        })
      }),
    openCustomerService: (corpId, url) =>
      new Promise((resolve, reject) => {
        if (!wx.openCustomerServiceChat) return reject(new CapError('notification.unsupported', 'wx.openCustomerServiceChat 缺失'))
        wx.openCustomerServiceChat({ corpId, extInfo: { url }, success: () => resolve(), fail: (e) => reject(new CapError('notification.failed', '打开客服失败', e)) })
      }),
    chooseContact: () =>
      new Promise((resolve, reject) => {
        if (!wx.chooseContact) return reject(new CapError('contact.unsupported', 'wx.chooseContact 缺失'))
        wx.chooseContact({
          success: (r) => resolve((r.contactList ?? []).map((c) => ({ name: c.name, phone: c.phone, email: c.email }))),
          fail: (e) => reject(new CapError('contact.failed', 'wx.chooseContact 失败', e)),
        })
      }),
    addCalendarEvent: (event) =>
      new Promise((resolve, reject) => {
        if (!wx.addPhoneCalendar) return reject(new CapError('calendar.unsupported', 'wx.addPhoneCalendar 缺失'))
        wx.addPhoneCalendar({
          title: event.title,
          startTime: event.startTime,
          endTime: event.endTime,
          alarms: event.alarms,
          location: event.location,
          description: event.description,
          success: () => resolve(),
          fail: (e) => reject(new CapError('calendar.failed', 'wx.addPhoneCalendar 失败', e)),
        })
      }),
    // ★★2026-09-30 修实缺：此前 MP 桥**手写** phase/订阅，且 `getPageLifecycle` 用了
    //   **不存在**的 `wx.onPageShow?.()`（官方无此全局 API ⇒ 永远不触发、静默失效）。
    //   现在 MP 端与其他端**共用同一条总线**（capability-app 的事件面）：
    //     · 应用级 ← `installWxAppEventBridge`（wx.onAppShow/onHide/onError/… 真实全局 API）
    //     · 页面级 ← `installPageEmitBridge`（编译产物在 Page 钩子里派发——wx 无全局页面事件）
    getAppLifecycle: () => mpLifecycleCaps.getAppLifecycle(),
    compressFile: (options) =>
      new Promise((resolve, reject) => {
        if (!wx.compressFile) return reject(new CapError('archive.unsupported', 'wx.compressFile 缺失'))
        wx.compressFile({
          src: options.src,
          dest: options.dest,
          quality: options.quality,
          success: () => resolve(),
          fail: (e) => reject(new CapError('archive.failed', 'wx.compressFile 失败', e)),
        })
      }),
    addShortcut: () =>
      new Promise((resolve, reject) => {
        if (!wx.addToDesktop) return reject(new CapError('shortcut.unsupported', 'wx.addToDesktop 缺失'))
        wx.addToDesktop({ success: () => resolve(), fail: (e) => reject(new CapError('shortcut.failed', 'wx.addToDesktop 失败', e)) })
      }),
    // ★G-32 B3 六期：page-lifecycle / bluetooth / nfc / camera / microphone / keyboard
    getPageLifecycle: () => mpLifecycleCaps.getPageLifecycle(),
    // ★能力颗粒度对齐：C36 蓝牙 BLE 富接口（连接/服务/特征值/通知/发现——原实现仅状态探测）
    //   打开适配器 → 返回 BluetoothAPI（方法统一 Promise<CapResult<T>>；订阅返回取消函数；缺 API → 方法级 Err）
    getBluetooth: async () => {
      if (!wx.openBluetoothAdapter) throw new CapError('bluetooth.unsupported', 'wx.openBluetoothAdapter 缺失')
      await new Promise<void>((resolve, reject) => {
        wx.openBluetoothAdapter!({
          success: () => resolve(),
          // ★诚实降级：适配器开启失败 = 不可用（不谎报 supported:true）
          fail: (e: unknown) => reject(new CapError('bluetooth.unavailable', (e as { errMsg?: string })?.errMsg || 'wx.openBluetoothAdapter 失败')),
        })
      })
      const need = (fn: unknown, name: string): void => {
        if (typeof fn !== 'function') throw new CapError('bluetooth.unsupported', 'wx.' + name + ' 缺失')
      }
      // 便捷：把 wx 回调式 API 包成 Promise（失败 reject CapError）
      type WxCb<r> = { success?: (res: r) => void; fail?: (e: unknown) => void }
      // opt 宽松（wx 各 API 参数形状各异）；运行时补 success/fail 回调，故用 unknown 断言注入
      const call = <r>(fn: (opt: Record<string, unknown>) => void, opt: Record<string, unknown> = {}, errCode = 'bluetooth.failed'): Promise<r> =>
        new Promise<r>((resolve, reject) => {
          fn({
            ...opt,
            success: (res: r) => resolve(res),
            fail: (e: unknown) => reject(new CapError(errCode, (e as { errMsg?: string })?.errMsg || 'ble 操作失败')),
          })
        })
      const cap = <T>(p: Promise<T>): Promise<CapResult<T>> => p.then((data) => capOk(data), (e) => capErr(e instanceof CapError ? e.code : 'bluetooth.failed', e instanceof Error ? e.message : String(e), e))
      const mapDev = (d: { name?: string; deviceId?: string; RSSI?: number }): BleDevice => ({ deviceId: d.deviceId ?? '', name: d.name ?? 'unnamed', RSSI: d.RSSI })
      const listDevices = async (): Promise<BleDevice[]> => {
        if (!wx.getBluetoothDevices) return []
        const r = await call<{ devices?: Array<{ name?: string; deviceId?: string; RSSI?: number }> }>((o) => wx.getBluetoothDevices!(o as never))
        return (r.devices ?? []).map(mapDev)
      }
      const api: BluetoothAPI = {
        supported: true,
        available: true,
        devices: (await listDevices()).map((d) => d.name),
        close: () => cap(wx.closeBluetoothAdapter ? call<void>((o) => wx.closeBluetoothAdapter!(o)) : Promise.reject(new CapError('bluetooth.unsupported', 'wx.closeBluetoothAdapter 缺失'))),
        getAdapterState: () =>
          cap(
            wx.getBluetoothAdapterState
              ? call<{ available: boolean; discovering: boolean }>((o) => wx.getBluetoothAdapterState!(o as never))
              : Promise.resolve({ available: true, discovering: false }),
          ),
        startDiscovery: (allowDuplicatesKey = false) =>
          cap(wx.startBluetoothDevicesDiscovery ? call<void>((o) => wx.startBluetoothDevicesDiscovery!({ ...(o as object), allowDuplicatesKey })) : Promise.reject(new CapError('bluetooth.unsupported', 'wx.startBluetoothDevicesDiscovery 缺失'))),
        stopDiscovery: () => cap(wx.stopBluetoothDevicesDiscovery ? call<void>((o) => wx.stopBluetoothDevicesDiscovery!(o)) : Promise.resolve()),
        getDevices: () => cap(listDevices()),
        getConnectedDevices: () =>
          cap(
            wx.getConnectedBluetoothDevices
              ? call<{ devices?: Array<{ name?: string; deviceId?: string }> }>((o) => wx.getConnectedBluetoothDevices!(o as never)).then((r) => (r.devices ?? []).map(mapDev))
              : listDevices(),
          ),
        connect: (deviceId) => cap(wx.createBLEConnection ? call<void>((o) => wx.createBLEConnection!({ ...(o as object), deviceId })) : Promise.reject(new CapError('bluetooth.unsupported', 'wx.createBLEConnection 缺失'))),
        disconnect: (deviceId) => cap(wx.closeBLEConnection ? call<void>((o) => wx.closeBLEConnection!({ ...(o as object), deviceId })) : Promise.resolve()),
        getServices: (deviceId) =>
          cap(
            wx.getBLEDeviceServices
              ? call<{ services?: Array<{ uuid: string; isPrimary?: boolean }> }>((o) => wx.getBLEDeviceServices!({ ...(o as object), deviceId })).then((r) => (r.services ?? []).map((sv) => ({ uuid: sv.uuid, isPrimary: sv.isPrimary ?? true })))
              : Promise.reject(new CapError('bluetooth.unsupported', 'wx.getBLEDeviceServices 缺失')),
          ),
        getCharacteristics: (deviceId, serviceId) =>
          cap(
            wx.getBLEDeviceCharacteristics
              ? call<{ characteristics?: Array<{ uuid: string; properties?: { read?: boolean; write?: boolean; notify?: boolean; indicate?: boolean } }> }>((o) => wx.getBLEDeviceCharacteristics!({ ...(o as object), deviceId, serviceId })).then((r) =>
                  (r.characteristics ?? []).map((c) => ({ uuid: c.uuid, properties: { read: !!c.properties?.read, write: !!c.properties?.write, notify: !!c.properties?.notify, indicate: !!c.properties?.indicate } })),
                )
              : Promise.reject(new CapError('bluetooth.unsupported', 'wx.getBLEDeviceCharacteristics 缺失')),
          ),
        read: (deviceId, serviceId, characteristicId) =>
          cap(
            wx.readBLECharacteristicValue
              ? call<{ value?: ArrayBuffer }>((o) => wx.readBLECharacteristicValue!({ ...(o as object), deviceId, serviceId, characteristicId })).then((r) => r.value ?? new ArrayBuffer(0))
              : Promise.reject(new CapError('bluetooth.unsupported', 'wx.readBLECharacteristicValue 缺失')),
          ),
        write: (deviceId, serviceId, characteristicId, value) =>
          cap(
            wx.writeBLECharacteristicValue
              ? call<void>((o) => wx.writeBLECharacteristicValue!({ ...(o as object), deviceId, serviceId, characteristicId, value }))
              : Promise.reject(new CapError('bluetooth.unsupported', 'wx.writeBLECharacteristicValue 缺失')),
          ),
        setNotify: (deviceId, serviceId, characteristicId, state) =>
          cap(
            wx.notifyBLECharacteristicValueChange
              ? call<void>((o) => wx.notifyBLECharacteristicValueChange!({ ...(o as object), deviceId, serviceId, characteristicId, state }))
              : Promise.reject(new CapError('bluetooth.unsupported', 'wx.notifyBLECharacteristicValueChange 缺失')),
          ),
        getRSSI: (deviceId) =>
          cap(
            wx.getBLEDeviceRSSI
              ? call<{ RSSI: number }>((o) => wx.getBLEDeviceRSSI!({ ...(o as object), deviceId })).then((r) => r.RSSI)
              : Promise.reject(new CapError('bluetooth.unsupported', 'wx.getBLEDeviceRSSI 缺失')),
          ),
        // 订阅：wx 的 on*/off* 成对；返回取消函数（无 API → 空订阅，不抛）
        onDeviceFound: (cb) => {
          if (!wx.onBluetoothDeviceFound) return () => {}
          const h = (r: { devices?: Array<{ name?: string; deviceId?: string; RSSI?: number }> }): void => cb((r.devices ?? []).map(mapDev))
          wx.onBluetoothDeviceFound(h)
          return () => {
            if (wx.offBluetoothDeviceFound) wx.offBluetoothDeviceFound(h)
          }
        },
        onConnectionStateChange: (cb) => {
          if (!wx.onBLEConnectionStateChange) return () => {}
          const h = (r: { deviceId: string; connected: boolean }): void => cb(r.deviceId, r.connected)
          wx.onBLEConnectionStateChange(h)
          return () => {
            if (wx.offBLEConnectionStateChange) wx.offBLEConnectionStateChange(h)
          }
        },
        onCharacteristicValueChange: (cb) => {
          if (!wx.onBLECharacteristicValueChange) return () => {}
          const h = (r: { deviceId: string; serviceId: string; characteristicId: string; value: ArrayBuffer }): void => cb(r.deviceId, r.serviceId, r.characteristicId, r.value)
          wx.onBLECharacteristicValueChange(h)
          return () => {
            if (wx.offBLECharacteristicValueChange) wx.offBLECharacteristicValueChange(h)
          }
        },
      }
      void need // 语义保留：需要时可显式断言
      return api
    },
    // ★能力颗粒度对齐修复：C16 权限（wxBridge 原缺失 → usePermission 在小程序端恒 Err）
    //   语义映射：wx.getSetting().authSetting[scope] === true → granted；false + 有记录 → denied；无记录 → prompt
    getPermission: (permission) =>
      new Promise((resolve, reject) => {
        if (!wx.getSetting) return reject(new CapError('permission.unsupported', 'wx.getSetting 缺失'))
        wx.getSetting({
          success: (r) => {
            const scope = permission.startsWith('scope.') ? permission : 'scope.' + permission
            const auth = r.authSetting ?? {}
            const has = Object.prototype.hasOwnProperty.call(auth, scope)
            const state: PermissionState['state'] = auth[scope] === true ? 'granted' : has ? 'denied' : 'prompt'
            resolve({ permission, state })
          },
          fail: (e: unknown) => reject(new CapError('permission.failed', (e as { errMsg?: string })?.errMsg || 'wx.getSetting 失败')),
        })
      }),
    // ★能力颗粒度对齐：C37 NFC 富接口（HCE 卡模拟 + 消息收发；原仅状态探测）
    getNfc: () =>
      new Promise((resolve) => {
        const build = (supported: boolean, available: boolean): NFCAPI => {
          const cap = <T,>(p: Promise<T>): Promise<CapResult<T>> => p.then((d) => capOk(d), (e) => capErr<T>(e instanceof CapError ? e.code : 'nfc.failed', e instanceof Error ? e.message : String(e), e))
          const run = (fn: unknown, name: string, opt?: Record<string, unknown>): Promise<void> =>
            new Promise<void>((res, rej) => {
              if (typeof fn !== 'function') return rej(new CapError('nfc.unsupported', 'wx.' + name + ' 缺失'))
              ;(fn as (o?: Record<string, unknown>) => void)({ ...opt, success: () => res(), fail: (e: unknown) => rej(new CapError('nfc.failed', 'wx ' + name + ' 失败', e)) })
            })
          return {
            supported,
            available,
            startHCE: (aidList) => cap(run(wx.startHCE, 'startHCE', { aidList })),
            stopHCE: () => cap(run(wx.stopHCE, 'stopHCE')),
            sendHCEMessage: (data) => cap(run(wx.sendHCEMessage, 'sendHCEMessage', { data })),
            onHCEMessage: (cb) => {
              if (!wx.onHCEMessage) return () => {}
              wx.onHCEMessage(cb)
              return () => {
                if (wx.offHCEMessage) wx.offHCEMessage(cb)
              }
            },
            onHCEStateChange: (cb) => {
              if (!wx.onHCEStateChange) return () => {}
              const h = (r: { available: boolean }): void => cb(r.available)
              wx.onHCEStateChange(h)
              return () => {}
            },
            // ★能力颗粒度对齐：读卡模式（wx.getNFCAdapter）
            getAdapter: () => buildNfcAdapter(wx),
          }
        }
        if (!wx.getHCEState) {
          resolve(build(false, false))
          return
        }
        wx.getHCEState({
          success: () => resolve(build(true, true)),
          fail: () => resolve(build(true, false)),
        })
      }),
    getCamera: () =>
      new Promise((resolve, reject) => {
        if (!wx.authorize && !wx.createCameraContext) {
          return reject(new CapError('camera.unsupported', 'wx 摄像头能力缺失'))
        }
        const supported = !!wx.createCameraContext || !!wx.authorize
        if (!wx.authorize) {
          resolve({ kind: 'camera', supported, granted: true })
          return
        }
        wx.authorize({ scope: 'scope.camera', success: () => resolve({ kind: 'camera', supported: true, granted: true }), fail: () => resolve({ kind: 'camera', supported, granted: false }) })
      }),
    getMicrophone: () =>
      new Promise((resolve, reject) => {
        if (!wx.authorize && !wx.getRecorderManager) {
          return reject(new CapError('microphone.unsupported', 'wx 录音能力缺失'))
        }
        const supported = !!wx.getRecorderManager || !!wx.authorize
        if (!wx.authorize) {
          resolve({ kind: 'microphone', supported, granted: true })
          return
        }
        wx.authorize({ scope: 'scope.record', success: () => resolve({ kind: 'microphone', supported: true, granted: true }), fail: () => resolve({ kind: 'microphone', supported, granted: false }) })
      }),
    // ★能力颗粒度对齐：C1 相机操作（wx.createCameraContext(id) → takePhoto/startRecord/stopRecord/setZoom/onCameraFrame）
    createCameraContext: (id: string) => {
      if (typeof wx.createCameraContext !== 'function') throw new CapError('camera.unsupported', 'wx.createCameraContext 缺失')
      const ctx = wx.createCameraContext(id)
      const call = <r>(fn: unknown, name: string, opt: Record<string, unknown> = {}): Promise<CapResult<r>> =>
        new Promise<CapResult<r>>((resolve) => {
          if (typeof fn !== 'function') return resolve(capErr<r>('camera.unsupported', 'CameraContext.' + name + ' 缺失'))
          ;(fn as (o: Record<string, unknown>) => void)({ ...opt, success: (res: r) => resolve(capOk(res)), fail: (e: unknown) => resolve(capErr<r>('camera.failed', 'wx 相机 ' + name + ' 失败', e)) })
        })
      return {
        takePhoto: (quality = 'normal') =>
          call<{ tempImagePath?: string; width: number; height: number }>(ctx.takePhoto, 'takePhoto', { quality }).then((r) => (r.ok ? capOk({ tempImagePath: r.data.tempImagePath, width: r.data.width ?? 0, height: r.data.height ?? 0 }) : r)),
        startRecord: () => call<void>(ctx.startRecord, 'startRecord'),
        stopRecord: () =>
          call<{ tempThumbPath?: string; tempVideoPath?: string; duration: number; size: number }>(ctx.stopRecord, 'stopRecord').then((r) => (r.ok ? capOk({ tempThumbPath: r.data.tempThumbPath, tempVideoPath: r.data.tempVideoPath, duration: r.data.duration ?? 0, size: r.data.size ?? 0 }) : r)),
        setZoom: (zoom: number) => call<void>(ctx.setZoom, 'setZoom', { zoom }),
        onCameraFrame: (cb) => {
          if (typeof ctx.onCameraFrame !== 'function') return () => {}
          ctx.onCameraFrame(cb)
          return () => {}
        },
      }
    },
    // ★能力颗粒度对齐：C2 录音操作（wx.getRecorderManager() → start/stop/pause/resume + 事件）
    getRecorder: () => {
      if (typeof wx.getRecorderManager !== 'function') throw new CapError('microphone.unsupported', 'wx.getRecorderManager 缺失')
      const mgr = wx.getRecorderManager()
      const okRun = (fn: unknown, name: string, opt?: Record<string, unknown>): Promise<CapResult<void>> =>
        Promise.resolve().then(() => {
          if (typeof fn !== 'function') return capErr<void>('microphone.unsupported', 'RecorderManager.' + name + ' 缺失')
          try {
            ;(fn as (o?: Record<string, unknown>) => void)(opt)
            return capOk(undefined)
          } catch (e) {
            return capErr<void>('microphone.failed', 'wx 录音 ' + name + ' 失败', e)
          }
        })
      const evMap: Record<string, string> = { start: 'onStart', stop: 'onStop', pause: 'onPause', resume: 'onResume', error: 'onError' }
      return {
        start: (options?: RecordOptions) => okRun(mgr.start, 'start', options as Record<string, unknown> | undefined),
        stop: () => okRun(mgr.stop, 'stop'),
        pause: () => okRun(mgr.pause, 'pause'),
        resume: () => okRun(mgr.resume, 'resume'),
        on: (event: 'start' | 'stop' | 'pause' | 'resume' | 'error', cb: (payload: unknown) => void) => {
          const fn = mgr[evMap[event] as keyof WxRecorderManagerLike]
          if (typeof fn !== 'function') return () => {}
          ;(fn as (c: (p: unknown) => void) => void)(cb)
          return () => {}
        },
        onFrameRecorded: (cb) => {
          if (typeof mgr.onFrameRecorded !== 'function') return () => {}
          mgr.onFrameRecorded(cb)
          return () => {}
        },
      }
    },
    getKeyboard: () => {
      let info: KeyboardInfo = { height: 0, visible: false }
      const cbs: Array<(i: KeyboardInfo) => void> = []
      if (typeof wx.onKeyboardHeightChange === 'function') {
        wx.onKeyboardHeightChange((r) => {
          info = { height: r.height, visible: r.height > 0 }
          cbs.forEach((cb) => cb(info))
        })
      }
      return {
        info,
        onChange: (cb) => {
          cbs.push(cb)
          return () => {
            const i = cbs.indexOf(cb)
            if (i >= 0) cbs.splice(i, 1)
          }
        },
      }
    },
    // ★G-32 B3 七期：wx 桥新增能力（map / background / socket-task / cookie / face-id / mini-program；
    //   sms / iap / data-channel / embedded / live / extension 无 wx 开放 API → 缺省 undefined → Hook Err 诚实降级）
    createMap: (id) => {
      if (typeof wx.createMapContext !== 'function') throw new CapError('map.unsupported', 'wx.createMapContext 缺失')
      const ctx = wx.createMapContext(id)
      // ★能力颗粒度对齐：C4 地图控制器全量（覆盖物/视野/坐标/移动标记 + 事件）
      //   缺 ctx API → 对应方法 Err（诚实）；事件订阅返回取消函数
      // 桥层返回原始 Promise（MapContextBridge）；CapResult 包装在 hook 层（useMap）
      const call = <r>(fn: unknown, name: string, opt: Record<string, unknown> = {}): Promise<r> =>
        new Promise<r>((resolve, reject) => {
          if (typeof fn !== 'function') return reject(new CapError('map.unsupported', 'MapContext.' + name + ' 缺失'))
          ;(fn as (o: Record<string, unknown>) => void)({
            ...opt,
            success: (res: r) => resolve(res),
            fail: (e: unknown) => reject(new CapError('map.failed', 'wx 地图 ' + name + ' 失败', e)),
          })
        })
      return {
        getRegion: () =>
          call<{ latitude: number; longitude: number; scale?: number }>(ctx.getRegion, 'getRegion').then((r) => ({ latitude: r.latitude, longitude: r.longitude, scale: r.scale })),
        moveTo: (latitude: number, longitude: number, scale?: number) => call<void>(ctx.moveTo, 'moveTo', { latitude, longitude, scale }),
        moveToLocation: () => call<void>(ctx.moveToLocation, 'moveToLocation'),
        includePoints: (points: Array<{ latitude: number; longitude: number }>, padding?: number[]) => call<void>(ctx.includePoints, 'includePoints', { points, padding }),
        translateMarker: (opt: { markerId: number; destination: { latitude: number; longitude: number }; rotate?: number; duration?: number }) => call<void>(ctx.translateMarker, 'translateMarker', opt),
        addMarkers: (markers: MapMarker[]) => call<void>(ctx.addMarkers, 'addMarkers', { markers }),
        removeMarkers: (ids: number[]) => call<void>(ctx.removeMarkers, 'removeMarkers', { markerIds: ids }),
        addPolylines: (polylines: MapPolyline[]) => call<void>(ctx.addPolylines, 'addPolylines', { polylines }),
        removePolylines: (ids: number[]) => call<void>(ctx.removePolylines, 'removePolylines', { polylineIds: ids }),
        addCircles: (circles: MapCircle[]) => call<void>(ctx.addCircles, 'addCircles', { circles }),
        removeCircles: (ids: number[]) => call<void>(ctx.removeCircles, 'removeCircles', { circleIds: ids }),
        getScale: () => call<{ scale: number }>(ctx.getScale, 'getScale').then((r) => r.scale),
        openMapApp: (opt: { latitude: number; longitude: number; name?: string }) => call<void>(ctx.openMapApp, 'openMapApp', opt),
        on: (event: 'regionchange' | 'markerTap' | 'updated', cb: (payload: unknown) => void) => {
          if (typeof ctx.on !== 'function') return () => {}
          ctx.on(event, cb)
          return () => {
            if (typeof ctx.off === 'function') ctx.off(event, cb)
          }
        },
        // ★能力颗粒度对齐：MapContext 剩余 21 方法（查询/视野/覆盖物/图层）
        getCenterLocation: () => call<{ latitude: number; longitude: number }>(ctx.getCenterLocation, 'getCenterLocation'),
        getRotate: () => call<{ rotate: number }>(ctx.getRotate, 'getRotate').then((r) => r.rotate),
        getSkew: () => call<{ skew: number }>(ctx.getSkew, 'getSkew').then((r) => r.skew),
        fromScreenLocation: (x, y) => call<{ latitude: number; longitude: number }>(ctx.fromScreenLocation, 'fromScreenLocation', { x, y }),
        toScreenLocation: (latitude, longitude) => call<{ x: number; y: number }>(ctx.toScreenLocation, 'toScreenLocation', { latitude, longitude }),
        setCenterOffset: (offset) => call<void>(ctx.setCenterOffset, 'setCenterOffset', { offset }),
        setBoundary: (boundaries) => call<void>(ctx.setBoundary, 'setBoundary', { boundaries }),
        moveAlong: (opt) => call<void>(ctx.moveAlong, 'moveAlong', opt),
        addArc: (arc) => call<void>(ctx.addArc, 'addArc', { ...arc, start: arc.start, end: arc.end }),
        eraseLines: (ids) => call<void>(ctx.eraseLines, 'eraseLines', { eraseOptions: ids.map((id) => ({ id })) }),
        initMarkerCluster: (enable) => call<void>(ctx.initMarkerCluster, 'initMarkerCluster', { enableCluster: enable }),
        setLocMarkerIcon: (iconPath) => call<void>(ctx.setLocMarkerIcon, 'setLocMarkerIcon', { iconPath }),
        addCustomLayer: (layer) => call<void>(ctx.addCustomLayer, 'addCustomLayer', { ...layer, layerId: layer.layerId ?? layer.id }),
        removeCustomLayer: (layerId) => call<void>(ctx.removeCustomLayer, 'removeCustomLayer', { layerId }),
        addVisualLayer: (layer) => call<void>(ctx.addVisualLayer, 'addVisualLayer', { ...layer, layerId: layer.layerId ?? layer.id }),
        removeVisualLayer: (layerId) => call<void>(ctx.removeVisualLayer, 'removeVisualLayer', { layerId }),
        executeVisualLayerCommand: (command) => call<{ result: string }>(ctx.executeVisualLayerCommand, 'executeVisualLayerCommand', { command: command.command ?? '', layerId: command.layerId ?? '' }).then((r) => r.result),
        addGroundOverlay: (overlay) => call<void>(ctx.addGroundOverlay, 'addGroundOverlay', { ...overlay, id: overlay.id }),
        updateGroundOverlay: (overlay) => call<void>(ctx.updateGroundOverlay, 'updateGroundOverlay', { ...overlay, id: overlay.id }),
        removeGroundOverlay: (overlayId) => call<void>(ctx.removeGroundOverlay, 'removeGroundOverlay', { id: overlayId }),
      }
    },
    // ★能力颗粒度对齐：C25 后台/宿主生命周期全事件面（原仅 visible/hidden）
    getBackground: () => {
      const cbs: Array<(e: BackgroundEvent) => void> = []
      const emit = (type: BackgroundEvent['type']) => cbs.forEach((cb) => cb({ type, time: Date.now() }))
      if (typeof wx.onAppHide === 'function') wx.onAppHide(() => emit('enter-background'))
      if (typeof wx.onAppShow === 'function') wx.onAppShow(() => emit('enter-foreground'))
      // 通用订阅助手：wx.onXxx 存在 → 挂接并返回 off（无 off 则 no-op 取消）；缺失 → no-op 取消
      // Raw=wx 回调原始载荷；Out=对外暴露类型（可同形或经 map 提取）
      const sub = <Raw, Out>(onName: keyof WxLike, cb: (out: Out) => void, map: (r: Raw) => Out): (() => void) => {
        const on = wx[onName]
        if (typeof on !== 'function') return () => {}
        const h = (r: Raw): void => cb(map(r))
        ;(on as unknown as (c: (r: Raw) => void) => void)(h)
        return () => {
          // wx 各 on* 对应 off* 命名不同；本处理保守：无显式 off 表 → 不解除（生命周期事件常驻，影响可忽略）
        }
      }
      return {
        onEvent: (cb) => {
          cbs.push(cb)
          return () => {
            const i = cbs.indexOf(cb)
            if (i >= 0) cbs.splice(i, 1)
          }
        },
        onMemoryWarning: (cb) => sub<{ level: number }, number>('onMemoryWarning', cb, (r) => r.level),
        onThemeChange: (cb) => sub<{ theme: 'dark' | 'light' }, 'dark' | 'light'>('onThemeChange', cb, (r) => r.theme),
        onWindowResize: (cb) => sub<{ size: { windowWidth: number; windowHeight: number } }, { windowWidth: number; windowHeight: number }>('onWindowResize', cb, (r) => r.size),
        onError: (cb) => sub<string, string>('onError', cb, (r) => r),
        onUnhandledRejection: (cb) => sub<{ reason: string; promise: Promise<unknown> }, { reason: string; promise: Promise<unknown> }>('onUnhandledRejection', cb, (r) => r),
        onNetworkStatusChange: (cb) => sub<{ isConnected: boolean; networkType: string }, { isConnected: boolean; networkType: string }>('onNetworkStatusChange', cb, (r) => r),
        getLaunchOptions: async () => {
          if (typeof wx.getLaunchOptionsSync !== 'function') return capErr<Record<string, unknown>>('background.unsupported', 'wx.getLaunchOptionsSync 缺失')
          try {
            return capOk(wx.getLaunchOptionsSync())
          } catch (e) {
            return capErr<Record<string, unknown>>('background.failed', e instanceof Error ? e.message : String(e))
          }
        },
        getEnterOptions: async () => {
          if (typeof wx.getEnterOptionsSync !== 'function') return capErr<Record<string, unknown>>('background.unsupported', 'wx.getEnterOptionsSync 缺失')
          try {
            return capOk(wx.getEnterOptionsSync())
          } catch (e) {
            return capErr<Record<string, unknown>>('background.failed', e instanceof Error ? e.message : String(e))
          }
        },
      }
    },
    // ★能力颗粒度对齐：C20 日历 API（增删查；查询无开放 API → Err）
    // ★C51 小程序热更新（wx.getUpdateManager）
    getUpdateManager: () => {
      if (typeof wx.getUpdateManager !== 'function') throw new CapError('update.unsupported', 'wx.getUpdateManager 缺失')
      const mgr = wx.getUpdateManager()
      const subs: { ready: Array<() => void>; failed: Array<(m: string) => void>; check: Array<(h: boolean) => void> } = { ready: [], failed: [], check: [] }
      mgr.onUpdateReady(() => subs.ready.forEach((cb) => cb()))
      mgr.onUpdateFailed((r) => subs.failed.forEach((cb) => cb(r?.errMsg ?? 'update failed')))
      return {
        checkUpdate: () =>
          new Promise<CapResult<{ hasUpdate: boolean }>>((resolve) => {
            try {
              mgr.onCheckForUpdate((r) => {
                subs.check.forEach((cb) => cb(r.hasUpdate))
                resolve(capOk({ hasUpdate: r.hasUpdate }))
              })
            } catch (e) {
              resolve(capErr('update.failed', e instanceof Error ? e.message : String(e)))
            }
          }),
        onCheckForUpdate: (cb) => { subs.check.push(cb); return () => { const i = subs.check.indexOf(cb); if (i >= 0) subs.check.splice(i, 1) } },
        onUpdateReady: (cb) => { subs.ready.push(cb); return () => { const i = subs.ready.indexOf(cb); if (i >= 0) subs.ready.splice(i, 1) } },
        onUpdateFailed: (cb) => { subs.failed.push(cb); return () => { const i = subs.failed.indexOf(cb); if (i >= 0) subs.failed.splice(i, 1) } },
        applyUpdate: () => Promise.resolve(capOk(mgr.applyUpdate() as undefined)),
      }
    },
    // ★颗粒度对齐 C3：C52 相册（wx.chooseMedia/saveImageToPhotosAlbum/previewMedia）
    getAlbum: () => ({
      pick: (options) =>
        new Promise<CapResult<MediaFile[]>>((resolve) => {
          if (typeof wx.chooseMedia !== 'function') return resolve(capErr('album.unsupported', 'wx.chooseMedia 缺失'))
          const mediaType = options?.mediaType === 'all' ? ['image', 'video'] : options?.mediaType ? [options.mediaType] : ['image']
          wx.chooseMedia({
            count: options?.count ?? 1,
            mediaType,
            sourceType: options?.source ? [options.source] : ['album', 'camera'],
            success: (r) =>
              resolve(
                capOk(
                  r.tempFiles.map((f) => ({
                    tempFilePath: f.tempFilePath,
                    type: (f.duration != null ? 'video' : 'image') as MediaFile['type'],
                    size: f.size,
                    duration: f.duration,
                    width: f.width,
                    height: f.height,
                  })),
                ),
              ),
            fail: (e) => resolve(capErr('album.failed', '选择媒体失败', e)),
          })
        }),
      saveImage: (filePath) =>
        new Promise<CapResult<void>>((resolve) => {
          if (typeof wx.saveImageToPhotosAlbum !== 'function') return resolve(capErr('album.unsupported', 'wx.saveImageToPhotosAlbum 缺失'))
          wx.saveImageToPhotosAlbum({ filePath, success: () => resolve(capOk(undefined)), fail: (e) => resolve(capErr('album.save-failed', '保存图片失败（需 scope.writePhotosAlbum 授权）', e)) })
        }),
      saveVideo: (filePath) =>
        new Promise<CapResult<void>>((resolve) => {
          if (typeof wx.saveVideoToPhotosAlbum !== 'function') return resolve(capErr('album.unsupported', 'wx.saveVideoToPhotosAlbum 缺失'))
          wx.saveVideoToPhotosAlbum({ filePath, success: () => resolve(capOk(undefined)), fail: (e) => resolve(capErr('album.save-failed', '保存视频失败（需 scope.writePhotosAlbum 授权）', e)) })
        }),
      preview: (urls, current) =>
        new Promise<CapResult<void>>((resolve) => {
          if (typeof wx.previewMedia !== 'function') return resolve(capErr('album.unsupported', 'wx.previewMedia 缺失'))
          wx.previewMedia({ urls, current, success: () => resolve(capOk(undefined)), fail: (e) => resolve(capErr('album.failed', '预览失败', e)) })
        }),
    }),
    // ★颗粒度对齐 C3：C53 Worker（wx.createWorker）
    createWorker: (scriptPath) => {
      if (typeof wx.createWorker !== 'function') throw new CapError('worker.unsupported', 'wx.createWorker 缺失')
      const w = wx.createWorker(scriptPath)
      return {
        postMessage: (message) => w.postMessage(message),
        onMessage: (cb) => { w.onMessage(cb); return () => { /* wx Worker onMessage 无对应 off；随 terminate 释放 */ } },
        terminate: () => w.terminate(),
      }
    },
    // ★颗粒度对齐 C3 批 2：C54 收货地址（wx.chooseAddress）
    chooseAddress: () =>
      new Promise<ShippingAddress>((resolve, reject) => {
        if (typeof wx.chooseAddress !== 'function') return reject(new CapError('address.unsupported', 'wx.chooseAddress 缺失'))
        wx.chooseAddress({
          success: (r) => resolve({ userName: r.userName, postalCode: r.postalCode, provinceName: r.provinceName, cityName: r.cityName, countyName: r.countyName, detailInfo: r.detailInfo, nationalCode: r.nationalCode, telNumber: r.telNumber }),
          fail: (e) => reject(new CapError('address.failed', '选择收货地址失败', e)),
        })
      }),
    // ★颗粒度对齐 C3 批 2：C55 WiFi（wx.getConnectedWifi/getWifiList/connectWifi）
    getWifi: () => {
      const map = (w: { SSID: string; BSSID: string; secure: boolean; signalStrength: number; frequency?: number }): WifiInfo => ({ SSID: w.SSID, BSSID: w.BSSID, secure: w.secure, signalStrength: w.signalStrength, frequency: w.frequency })
      return {
        getConnected: () =>
          new Promise<CapResult<WifiInfo>>((resolve) => {
            if (typeof wx.getConnectedWifi !== 'function') return resolve(capErr('wifi.unsupported', 'wx.getConnectedWifi 缺失'))
            wx.getConnectedWifi({ success: (r) => resolve(capOk(map(r.wifi))), fail: (e) => resolve(capErr('wifi.failed', '获取当前 WiFi 失败', e)) })
          }),
        list: () =>
          new Promise<CapResult<WifiInfo[]>>((resolve) => {
            if (typeof wx.getWifiList !== 'function' || typeof wx.onGetWifiList !== 'function') return resolve(capErr('wifi.unsupported', 'wx.getWifiList/onGetWifiList 缺失'))
            let settled = false
            wx.onGetWifiList((r) => {
              if (settled) return
              settled = true
              resolve(capOk((r.wifiList ?? []).map(map)))
            })
            if (typeof wx.startWifi === 'function') wx.startWifi({})
            wx.getWifiList({})
          }),
        connect: (SSID, password) =>
          new Promise<CapResult<void>>((resolve) => {
            if (typeof wx.connectWifi !== 'function') return resolve(capErr('wifi.unsupported', 'wx.connectWifi 缺失（iOS 不支持程序化连接）'))
            wx.connectWifi({ SSID, password, success: () => resolve(capOk(undefined)), fail: (e) => resolve(capErr('wifi.connect-failed', '连接 WiFi 失败', e)) })
          }),
      }
    },
    // ★颗粒度对齐 C3 批 2：C56 微信运动（wx.getWeRunData）
    getWeRunData: () =>
      new Promise<WeRunData>((resolve, reject) => {
        if (typeof wx.getWeRunData !== 'function') return reject(new CapError('werun.unsupported', 'wx.getWeRunData 缺失'))
        wx.getWeRunData({
          success: (r) => resolve({ encryptedData: r.encryptedData, iv: r.iv, cloudID: r.cloudID }),
          fail: (e) => reject(new CapError('werun.failed', '获取微信运动数据失败（需 scope.werun 授权 + 后端解密）', e)),
        })
      }),
    // ★组件实例 API 对齐（2026-09-12）：C57 画布（wx.createCanvasContext / SelectorQuery node / canvasToTempFilePath / createOffscreenCanvas）
    createCanvas: (id) => {
      const canvasId = id.replace(/^#/, '')
      // 旧接口 CanvasContext（方法名已对齐官方）——wx 直接返回；缺 API → 各方法级 Err
      const makeContext = (): CapResult<CanvasContext> => {
        if (typeof wx.createCanvasContext !== 'function') return capErr('canvas.unsupported', 'wx.createCanvasContext 缺失')
        const raw = wx.createCanvasContext(canvasId) as Record<string, unknown>
        const call = (name: string, ...args: unknown[]): void => {
          const fn = raw[name]
          if (typeof fn === 'function') (fn as (...a: unknown[]) => void).apply(raw, args)
        }
        return capOk({
          setFillStyle: (c) => call('setFillStyle', c),
          setStrokeStyle: (c) => call('setStrokeStyle', c),
          setLineWidth: (w) => call('setLineWidth', w),
          setLineCap: (v) => call('setLineCap', v),
          setLineJoin: (v) => call('setLineJoin', v),
          setMiterLimit: (v) => call('setMiterLimit', v),
          setGlobalAlpha: (a) => call('setGlobalAlpha', a),
          setShadow: (x, y, b, c) => call('setShadow', x, y, b, c),
          setLineDash: (p, o) => call('setLineDash', p, o),
          setFontSize: (s) => call('setFontSize', s),
          setTextAlign: (v) => call('setTextAlign', v),
          setTextBaseline: (v) => call('setTextBaseline', v),
          setTransform: (a, b, c, d, e, f) => call('setTransform', a, b, c, d, e, f),
          save: () => call('save'),
          restore: () => call('restore'),
          translate: (x, y) => call('translate', x, y),
          rotate: (r) => call('rotate', r),
          scale: (x, y) => call('scale', x, y),
          beginPath: () => call('beginPath'),
          closePath: () => call('closePath'),
          moveTo: (x, y) => call('moveTo', x, y),
          lineTo: (x, y) => call('lineTo', x, y),
          arc: (x, y, r, s, e, cc) => call('arc', x, y, r, s, e, cc),
          arcTo: (x1, y1, x2, y2, r) => call('arcTo', x1, y1, x2, y2, r),
          quadraticCurveTo: (cpx, cpy, x, y) => call('quadraticCurveTo', cpx, cpy, x, y),
          bezierCurveTo: (a, b, c, d, e, f) => call('bezierCurveTo', a, b, c, d, e, f),
          rect: (x, y, w, h) => call('rect', x, y, w, h),
          fill: () => call('fill'),
          stroke: () => call('stroke'),
          clip: () => call('clip'),
          fillRect: (x, y, w, h) => call('fillRect', x, y, w, h),
          strokeRect: (x, y, w, h) => call('strokeRect', x, y, w, h),
          clearRect: (x, y, w, h) => call('clearRect', x, y, w, h),
          fillText: (t, x, y, mw) => call('fillText', t, x, y, mw),
          measureText: (t) => {
            if (typeof raw.measureText !== 'function') return { width: 0 }
            return (raw.measureText as (s: string) => CanvasTextMetrics)(t)
          },
          drawImage: (img, ...args) => call('drawImage', img, ...args),
          createLinearGradient: (x0, y0, x1, y1) => {
            if (typeof raw.createLinearGradient !== 'function') return { addColorStop: () => {} }
            return (raw.createLinearGradient as (...a: number[]) => CanvasGradientLike)(x0, y0, x1, y1)
          },
          createCircularGradient: (x, y, r) => {
            if (typeof raw.createCircularGradient !== 'function') return { addColorStop: () => {} }
            return (raw.createCircularGradient as (x: number, y: number, r: number) => CanvasGradientLike)(x, y, r)
          },
          createPattern: (img, rep) => {
            if (typeof raw.createPattern !== 'function') return null
            return (raw.createPattern as (i: unknown, r: string) => CanvasPatternLike)(img, rep)
          },
          draw: (reserve, cb) => {
            const done = typeof reserve === 'function' ? reserve : cb
            const keep = typeof reserve === 'boolean' ? reserve : undefined
            if (typeof raw.draw === 'function') (raw.draw as (r?: boolean, c?: () => void) => void)(keep, done)
            else if (done) done()
          },
        })
      }
      const queryNode = (): Promise<CanvasNode> =>
        new Promise<CanvasNode>((resolve, reject) => {
          if (typeof wx.createSelectorQuery !== 'function') return reject(new CapError('canvas.unsupported', 'wx.createSelectorQuery 缺失（type=2d 节点不可用）'))
          const q = wx.createSelectorQuery()
          const sel = q.select?.('#' + canvasId)
          if (!sel || typeof sel.fields !== 'function') return reject(new CapError('canvas.unsupported', 'SelectorQuery.fields 缺失'))
          sel.fields({ node: true, size: true }, () => {})
          if (typeof q.exec !== 'function') return reject(new CapError('canvas.unsupported', 'SelectorQuery.exec 缺失'))
          q.exec((res: unknown) => {
            const first = Array.isArray(res) ? (res[0] as { node?: CanvasNode } | undefined) : (res as { node?: CanvasNode } | undefined)
            if (first?.node) resolve(first.node)
            else reject(new CapError('canvas.node-missing', '未取得 canvas 节点（需 <canvas type="2d" id="…">）'))
          })
        })
      const exportImage = (options?: CanvasExportOptions): Promise<CapResult<string>> =>
        new Promise<CapResult<string>>((resolve) => {
          if (typeof wx.canvasToTempFilePath !== 'function') return resolve(capErr('canvas.unsupported', 'wx.canvasToTempFilePath 缺失'))
          wx.canvasToTempFilePath({
            canvasId,
            ...options,
            success: (r: unknown) => resolve(capOk((r as { tempFilePath: string }).tempFilePath)),
            fail: (e: unknown) => resolve(capErr('canvas.export-failed', '导出画布失败', e)),
          })
        })
      return {
        id: canvasId,
        createContext: makeContext,
        node: () => wrap(queryNode()),
        toTempFilePath: exportImage,
        toDataURL: (options) =>
          exportImage(options).then(async (r) => {
            if (!r.ok) return r
            const fsm = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : undefined
            if (!fsm?.readFile) return capErr<string>('canvas.unsupported', 'wx.getFileSystemManager.readFile 缺失（无法转 base64）')
            return await new Promise<CapResult<string>>((resolve) => {
              fsm.readFile!({
                filePath: r.data,
                encoding: 'base64',
                success: (rr) => resolve(capOk('data:image/png;base64,' + String(rr.data))),
                fail: (e) => resolve(capErr<string>('canvas.export-failed', '读取临时文件失败', e)),
              })
            })
          }),
        offscreen: (width, height, type = '2d') => {
          if (typeof wx.createOffscreenCanvas !== 'function') return capErr<OffscreenCanvasHandle>('canvas.unsupported', 'wx.createOffscreenCanvas 缺失')
          const off = wx.createOffscreenCanvas({ type, width, height }) as { width: number; height: number; getContext: (t: string) => unknown }
          return capOk({
            width: off.width,
            height: off.height,
            getContext: (t: '2d' | 'webgl') => off.getContext(t) as CanvasContext | null,
          })
        },
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C58 元素查询（wx.createSelectorQuery）
    createElementQuery: (id) => {
      // ★★框架元素探针回落（2026-09-14）：页面级 SelectorQuery **查不到自定义组件内部节点**
      //   （glass-easel 隔离；Skyline 无 selectAllComponents）。组件自测量后写全局探针注册表
      //   （`__PROTEUS_PROBES__`，见 runtime/probe + 编译器注入）→ 工具查不到时回落读取，
      //   使 useElement（框架 API）也能读组件内部几何（而非只能绕过 API 直查 DOM）。
      const probeFallback = (sel?: string): Record<string, number> | null => {
        try {
          const g = (globalThis ?? {}) as Record<string, unknown>
          const reg = g.__PROTEUS_PROBES__ as Record<string, { rect?: Record<string, number> | null }> | undefined
          if (!reg) return null
          const token = (sel ?? '').replace(/^[#.]/, '')
          const hit = reg[token]
          return hit && hit.rect ? hit.rect : null
        } catch {
          return null
        }
      }
      const norm = (sel?: string): string => {
        const s = sel ?? id ?? ''
        return s.startsWith('#') ? s : s ? '#' + s : ''
      }
      const execOne = <T,>(build: (q: WxSelectorQueryLike) => void, sel?: string): Promise<CapResult<T>> =>
        new Promise<CapResult<T>>((resolve) => {
          if (typeof wx.createSelectorQuery !== 'function') {
            const fb = probeFallback(sel)
            return fb ? resolve(capOk(fb as T)) : resolve(capErr<T>('element.unsupported', 'wx.createSelectorQuery 缺失'))
          }
          const q = wx.createSelectorQuery()
          try {
            build(q)
          } catch (e) {
            return resolve(capErr<T>('element.failed', 'SelectorQuery 构建失败', e))
          }
          if (typeof q.exec !== 'function') return resolve(capErr<T>('element.unsupported', 'SelectorQuery.exec 缺失'))
          q.exec((res: unknown) => {
            const first = Array.isArray(res) ? res[0] : res
            if (first == null) {
              // ★工具查不到（组件内部节点）→ 回落探针注册表
              const fb = probeFallback(sel)
              if (fb) return resolve(capOk(fb as T))
              return resolve(capErr<T>('element.not-found', '未查询到元素'))
            }
            resolve(capOk(first as T))
          })
        })
      const execMany = <T,>(selectors: string[], build: (q: WxSelectorQueryLike, sel: string) => void): Promise<CapResult<T[]>> =>
        new Promise<CapResult<T[]>>((resolve) => {
          if (typeof wx.createSelectorQuery !== 'function') return resolve(capErr<T[]>('element.unsupported', 'wx.createSelectorQuery 缺失'))
          const q = wx.createSelectorQuery()
          try {
            for (const sel of selectors) build(q, sel)
          } catch (e) {
            return resolve(capErr<T[]>('element.failed', 'SelectorQuery 构建失败', e))
          }
          if (typeof q.exec !== 'function') return resolve(capErr<T[]>('element.unsupported', 'SelectorQuery.exec 缺失'))
          q.exec((res: unknown) => {
            const arr = Array.isArray(res) ? res : []
            resolve(capOk(arr as T[]))
          })
        })
      return {
        boundingClientRect: (selector) => execOne<ElementRect>((q) => {
          const s = q.select?.(norm(selector))
          s?.boundingClientRect?.()
        }, selector),
        scrollOffset: (selector) => execOne<ElementScrollOffset>((q) => {
          const s = q.select?.(norm(selector))
          s?.scrollOffset?.()
        }, selector),
        fields: (options, selector) => execOne<ElementFieldsResult>((q) => {
          const s = q.select?.(norm(selector))
          s?.fields?.({ ...options })
        }, selector),
        size: (selector) =>
          execOne<ElementRect>((q) => {
            const s = q.select?.(norm(selector))
            s?.boundingClientRect?.()
          }, selector).then((r) => (r.ok ? capOk({ width: r.data.width ?? 0, height: r.data.height ?? 0 }) : (r as unknown as CapResult<{ width: number; height: number }>))),
        batch: (selectors) => execMany<ElementRect>(selectors, (q, sel) => q.select?.(norm(sel))?.boundingClientRect?.()),
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C59 交叉观察（wx.createIntersectionObserver）
    createIntersection: (options) => {
      const make = wx.createIntersectionObserver
      const obs = typeof make === 'function' ? make.call(wx, undefined, options) : undefined
      const handle: IntersectionHandle = {
        relativeTo: (selector, margins) => {
          obs?.relativeTo?.(selector, margins)
          return handle
        },
        relativeToViewport: (margins) => {
          obs?.relativeToViewport?.(margins)
          return handle
        },
        observe: (targetSelector, cb) => {
          obs?.observe?.(targetSelector, (res) => cb(res as IntersectionResult))
          return handle
        },
        disconnect: () => {
          obs?.disconnect?.()
        },
      }
      return handle
    },
    // ★组件实例 API 对齐（2026-09-12）：C60 媒体查询（wx.createMediaQueryObserver）
    createMediaQuery: () => {
      const obs = typeof wx.createMediaQueryObserver === 'function' ? wx.createMediaQueryObserver() : undefined
      return {
        observe: (condition, cb) => {
          if (!obs?.observe) {
            cb({ matches: false })
            return
          }
          obs.observe({ ...condition }, (res) => cb({ matches: !!res.matches }))
        },
        disconnect: () => {
          obs?.disconnect?.()
        },
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C61 视频控制器（wx.createVideoContext）
    createVideo: (id) => {
      const ctx = typeof wx.createVideoContext === 'function' ? wx.createVideoContext(id.replace(/^#/, '')) : undefined
      const run = (fn: unknown, name: string, ...args: unknown[]): Promise<CapResult<void>> =>
        Promise.resolve().then(() => {
          if (typeof fn !== 'function') return capErr<void>('video.unsupported', 'VideoContext.' + name + ' 缺失')
          try {
            ;(fn as (...a: unknown[]) => void).apply(ctx, args)
            return capOk(undefined)
          } catch (e) {
            return capErr<void>('video.failed', '视频 ' + name + ' 失败', e)
          }
        })
      const evMap: Record<string, string> = { play: 'onPlay', pause: 'onPause', ended: 'onEnded', timeupdate: 'onTimeUpdate', error: 'onError', fullscreenchange: 'onFullScreenChange' }
      return {
        play: () => run(ctx?.play, 'play'),
        pause: () => run(ctx?.pause, 'pause'),
        stop: () => run(ctx?.stop, 'stop'),
        seek: (position) => run(ctx?.seek, 'seek', position),
        playbackRate: (rate) => run(ctx?.playbackRate, 'playbackRate', rate),
        requestFullScreen: (options) => run(ctx?.requestFullScreen, 'requestFullScreen', options),
        exitFullScreen: () => run(ctx?.exitFullScreen, 'exitFullScreen'),
        sendDanmu: (danmu) => run(ctx?.sendDanmu, 'sendDanmu', danmu),
        on: (event, cb) => {
          const fn = ctx?.[evMap[event] as keyof WxVideoContextLike]
          if (typeof fn !== 'function') return () => {}
          ;(fn as (c: (p: unknown) => void) => void)(cb)
          return () => {}
        },
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C62 音频控制器（wx.createInnerAudioContext）
    createAudio: (src) => {
      if (typeof wx.createInnerAudioContext !== 'function') throw new CapError('audio.unsupported', 'wx.createInnerAudioContext 缺失')
      const ac = wx.createInnerAudioContext()
      if (src) ac.src = src
      const run = (fn: unknown, name: string, ...args: unknown[]): Promise<CapResult<void>> =>
        Promise.resolve().then(() => {
          if (typeof fn !== 'function') return capErr<void>('audio.unsupported', 'InnerAudioContext.' + name + ' 缺失')
          try {
            ;(fn as (...a: unknown[]) => void).apply(ac, args)
            return capOk(undefined)
          } catch (e) {
            return capErr<void>('audio.failed', '音频 ' + name + ' 失败', e)
          }
        })
      const evMap: Record<string, string> = { canplay: 'onCanplay', play: 'onPlay', pause: 'onPause', stop: 'onStop', ended: 'onEnded', timeupdate: 'onTimeUpdate', error: 'onError' }
      return {
        play: (s) => {
          if (s) ac.src = s
          return run(ac.play, 'play')
        },
        pause: () => run(ac.pause, 'pause'),
        stop: () => run(ac.stop, 'stop'),
        seek: (position) => run(ac.seek, 'seek', position),
        setVolume: (v) => { ac.volume = v },
        setLoop: (v) => { ac.loop = v },
        get currentTime() { return ac.currentTime ?? 0 },
        get duration() { return ac.duration ?? 0 },
        get paused() { return ac.paused ?? false },
        destroy: () => ac.destroy?.(),
        on: (event, cb) => {
          const fn = ac[evMap[event] as keyof WxInnerAudioContextLike]
          if (typeof fn !== 'function') return () => {}
          ;(fn as (c: (p: unknown) => void) => void)(cb as (p: unknown) => void)
          return () => {}
        },
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C63 直播推流控制器（wx.createLivePusherContext）
    createLivePusher: (id) => {
      const ctx = typeof wx.createLivePusherContext === 'function' ? wx.createLivePusherContext(id.replace(/^#/, '')) : undefined
      const call = (fn: unknown, name: string, opt?: Record<string, unknown>): Promise<CapResult<void>> =>
        new Promise<CapResult<void>>((resolve) => {
          if (typeof fn !== 'function') return resolve(capErr<void>('live-pusher.unsupported', 'LivePusherContext.' + name + ' 缺失'))
          try {
            ;(fn as (o?: Record<string, unknown>) => void)({ ...opt, success: () => resolve(capOk(undefined)), fail: (e: unknown) => resolve(capErr<void>('live-pusher.failed', '推流 ' + name + ' 失败', e)) })
          } catch (e) {
            resolve(capErr<void>('live-pusher.failed', '推流 ' + name + ' 失败', e))
          }
        })
      return {
        start: () => call(ctx?.start, 'start'),
        stop: () => call(ctx?.stop, 'stop'),
        pause: () => call(ctx?.pause, 'pause'),
        resume: () => call(ctx?.resume, 'resume'),
        switchCamera: () => call(ctx?.switchCamera, 'switchCamera'),
        toggleTorch: () => call(ctx?.toggleTorch, 'toggleTorch'),
        snapshot: () =>
          new Promise<CapResult<string>>((resolve) => {
            if (typeof ctx?.snapshot !== 'function') return resolve(capErr<string>('live-pusher.unsupported', 'LivePusherContext.snapshot 缺失'))
            ctx.snapshot({ success: (r: unknown) => resolve(capOk((r as { tempImagePath?: string }).tempImagePath ?? '')), fail: (e: unknown) => resolve(capErr<string>('live-pusher.failed', '推流截图失败', e)) })
          }),
        sendMessage: (msg) =>
          new Promise<CapResult<void>>((resolve) => {
            if (typeof ctx?.sendMessage !== 'function') return resolve(capErr<void>('live-pusher.unsupported', 'LivePusherContext.sendMessage 缺失'))
            ctx.sendMessage({ msg, success: () => resolve(capOk(undefined)), fail: (e: unknown) => resolve(capErr<void>('live-pusher.failed', '发送 SEI 消息失败', e)) })
          }),
        on: (event, cb) => {
          if (typeof ctx?.on !== 'function') return () => {}
          ctx.on(event, cb)
          return () => {
            if (typeof ctx?.off === 'function') ctx.off(event, cb)
          }
        },
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C64 广告（wx.createRewardedVideoAd/createInterstitialAd/createBannerAd）
    getAd: () => {
      const cache = new Map<string, unknown>()
      const ensure = <T,>(key: string, make: () => T): T => {
        if (!cache.has(key)) cache.set(key, make())
        return cache.get(key) as T
      }
      return {
        rewardedVideo: (adUnitId) =>
          ensure('rv:' + adUnitId, (): RewardedVideoAdHandle => {
            if (typeof wx.createRewardedVideoAd !== 'function') throw new CapError('ad.unsupported', 'wx.createRewardedVideoAd 缺失')
            const ad = wx.createRewardedVideoAd({ adUnitId })
            return {
              load: () => Promise.resolve(ad.load?.()).then(() => capOk(undefined), (e) => capErr<void>('ad.failed', '加载激励视频失败', e)),
              show: () => Promise.resolve(ad.show?.()).then(() => capOk(undefined), (e) => capErr<void>('ad.failed', '展示激励视频失败', e)),
              onLoad: (cb) => { ad.onLoad?.(cb); return () => ad.offLoad?.(cb) },
              onClose: (cb) => { ad.onClose?.((res) => cb({ isEnded: !!res.isEnded })); return () => ad.offClose?.() },
              onError: (cb) => { ad.onError?.(cb); return () => ad.offError?.() },
              off: () => ad.destroy?.(),
            }
          }),
        interstitial: (adUnitId) =>
          ensure('int:' + adUnitId, (): InterstitialAdHandle => {
            if (typeof wx.createInterstitialAd !== 'function') throw new CapError('ad.unsupported', 'wx.createInterstitialAd 缺失')
            const ad = wx.createInterstitialAd({ adUnitId })
            return {
              load: () => Promise.resolve(ad.load?.()).then(() => capOk(undefined), (e) => capErr<void>('ad.failed', '加载插屏广告失败', e)),
              show: () => Promise.resolve(ad.show?.()).then(() => capOk(undefined), (e) => capErr<void>('ad.failed', '展示插屏广告失败', e)),
              onLoad: (cb) => { ad.onLoad?.(cb); return () => {} },
              onClose: (cb) => { ad.onClose?.(cb); return () => {} },
              onError: (cb) => { ad.onError?.(cb); return () => {} },
              destroy: () => ad.destroy?.(),
            }
          }),
        banner: (options) =>
          ensure('banner:' + options.adUnitId, (): BannerAdHandle => {
            if (typeof wx.createBannerAd !== 'function') throw new CapError('ad.unsupported', 'wx.createBannerAd 缺失')
            const ad = wx.createBannerAd({ adUnitId: options.adUnitId, style: options.style })
            return {
              show: () => Promise.resolve(ad.show?.()).then(() => capOk(undefined), (e) => capErr<void>('ad.failed', '展示横幅广告失败', e)),
              hide: () => Promise.resolve().then(() => { ad.hide?.(); return capOk(undefined) }),
              destroy: () => ad.destroy?.(),
              onLoad: (cb) => { ad.onLoad?.(cb); return () => {} },
              onResize: (cb) => { ad.onResize?.(cb); return () => {} },
              onError: (cb) => { ad.onError?.(cb); return () => {} },
            }
          }),
      }
    },
    // ★权威标尺缺口 C65：隐私协议（wx.getPrivacySetting / openPrivacyContract / requirePrivacyAuthorize / onNeedPrivacyAuthorization）
    getPrivacy: () => ({
      getSetting: () =>
        new Promise<CapResult<PrivacySetting>>((resolve) => {
          if (typeof wx.getPrivacySetting !== 'function') return resolve(capErr('privacy.unsupported', 'wx.getPrivacySetting 缺失'))
          wx.getPrivacySetting({
            success: (r) => resolve(capOk({ needAuthorization: !!r.needAuthorization, privacyContractName: r.privacyContractName ?? '' })),
            fail: (e) => resolve(capErr('privacy.failed', '查询隐私授权状态失败', e)),
          })
        }),
      openContract: () =>
        new Promise<CapResult<void>>((resolve) => {
          if (typeof wx.openPrivacyContract !== 'function') return resolve(capErr('privacy.unsupported', 'wx.openPrivacyContract 缺失'))
          wx.openPrivacyContract({ success: () => resolve(capOk(undefined)), fail: (e) => resolve(capErr('privacy.failed', '打开隐私协议页失败', e)) })
        }),
      requireAuthorize: () =>
        new Promise<CapResult<boolean>>((resolve) => {
          if (typeof wx.requirePrivacyAuthorize !== 'function') return resolve(capErr('privacy.unsupported', 'wx.requirePrivacyAuthorize 缺失'))
          wx.requirePrivacyAuthorize({ success: () => resolve(capOk(true)), fail: (e) => resolve(capErr('privacy.denied', '用户拒绝隐私授权', e)) })
        }),
      onNeedAuthorization: (cb) => {
        if (typeof wx.onNeedPrivacyAuthorization !== 'function') return () => {}
        wx.onNeedPrivacyAuthorization(cb)
        return () => {
          if (typeof wx.offNeedPrivacyAuthorization === 'function') wx.offNeedPrivacyAuthorization(cb)
        }
      },
    }),
    // ★权威标尺缺口 C66：性能（wx.getPerformance / reportPerformance）
    getPerformance: () => {
      const perf = typeof wx.getPerformance === 'function' ? wx.getPerformance() : undefined
      return {
        getEntries: (entryType) =>
          Promise.resolve().then(() => {
            if (typeof perf?.getEntries !== 'function') return capErr<PerformanceEntry[]>('performance.unsupported', 'wx.getPerformance().getEntries 缺失')
            const list = perf.getEntries()
            const filtered = entryType ? list.filter((e) => e.entryType === entryType) : list
            return capOk(filtered.map(normalizePerfEntry))
          }),
        getEntriesByName: (name, entryType) =>
          Promise.resolve().then(() => {
            if (typeof perf?.getEntriesByName !== 'function') return capErr<PerformanceEntry[]>('performance.unsupported', 'Performance.getEntriesByName 缺失')
            return capOk(perf.getEntriesByName(name, entryType).map(normalizePerfEntry))
          }),
        createObserver: () => {
          const obs = typeof perf?.createObserver === 'function' ? perf.createObserver() : undefined
          return {
            observe: (cb, entryTypes) => {
              if (typeof obs?.observe !== 'function') return
              obs.observe((entries) => cb(entries.map(normalizePerfEntry)), entryTypes)
            },
            disconnect: () => obs?.disconnect?.(),
          }
        },
        setBufferSize: (size) => perf?.setBufferSize?.(size),
        report: (id, value, dimensions) =>
          Promise.resolve().then(() => {
            if (typeof wx.reportPerformance !== 'function') return capErr<void>('performance.unsupported', 'wx.reportPerformance 缺失')
            try {
              wx.reportPerformance(id, value, dimensions)
              return capOk(undefined)
            } catch (e) {
              return capErr<void>('performance.failed', '上报性能指标失败', e)
            }
          }),
      }
    },
    // ★权威标尺缺口 C67：预加载（wx.preloadAssets / preloadSkylineView / preloadWebview / preDownloadSubpackage）
    getPreload: () => ({
      assets: (data) =>
        new Promise<CapResult<void>>((resolve) => {
          if (typeof wx.preloadAssets !== 'function') return resolve(capErr('preload.unsupported', 'wx.preloadAssets 缺失'))
          wx.preloadAssets({ data, success: () => resolve(capOk(undefined)), fail: (e) => resolve(capErr('preload.failed', '预加载资源失败', e)) })
        }),
      skylineView: () =>
        new Promise<CapResult<void>>((resolve) => {
          if (typeof wx.preloadSkylineView !== 'function') return resolve(capErr('preload.unsupported', 'wx.preloadSkylineView 缺失'))
          wx.preloadSkylineView({ success: () => resolve(capOk(undefined)), fail: (e) => resolve(capErr('preload.failed', '预加载 Skyline 视图失败', e)) })
        }),
      webview: () =>
        new Promise<CapResult<void>>((resolve) => {
          if (typeof wx.preloadWebview !== 'function') return resolve(capErr('preload.unsupported', 'wx.preloadWebview 缺失'))
          wx.preloadWebview({ success: () => resolve(capOk(undefined)), fail: (e) => resolve(capErr('preload.failed', '预加载 WebView 失败', e)) })
        }),
      subpackage: (packageType) =>
        new Promise<CapResult<PreDownloadTask>>((resolve) => {
          if (typeof wx.preDownloadSubpackage !== 'function') return resolve(capErr('preload.unsupported', 'wx.preDownloadSubpackage 缺失'))
          const holder: { task?: WxPreDownloadTaskLike } = {}
          try {
            holder.task = wx.preDownloadSubpackage({
              packageType,
              success: () => resolve(capOk(makeProgressHandle(holder))),
              fail: (e: unknown) => resolve(capErr('preload.failed', '预下载分包失败', e)),
            })
          } catch (e) {
            return resolve(capErr('preload.failed', '预下载分包失败', e))
          }
        }),
    }),
    // ★权威标尺缺口 C68：图像编辑（wx.cropImage / wx.editImage）
    getImageEdit: () => ({
      crop: (src, cropScale) =>
        new Promise<CapResult<string>>((resolve) => {
          if (typeof wx.cropImage !== 'function') return resolve(capErr('image-edit.unsupported', 'wx.cropImage 缺失'))
          wx.cropImage({ src, cropScale, success: (r) => resolve(capOk(r.tempFilePath)), fail: (e: unknown) => resolve(capErr('image-edit.failed', '裁剪图片失败', e)) })
        }),
      edit: (src) =>
        new Promise<CapResult<string>>((resolve) => {
          if (typeof wx.editImage !== 'function') return resolve(capErr('image-edit.unsupported', 'wx.editImage 缺失'))
          wx.editImage({ src, success: (r) => resolve(capOk(r.tempFilePath)), fail: (e: unknown) => resolve(capErr('image-edit.failed', '编辑图片失败', e)) })
        }),
    }),
    // ★权威标尺缺口 C69：网络底层（wx.createUDPSocket / createTCPSocket）
    getSocket: () => {
      const makeUdp = (): UDPSocketHandle => {
        if (typeof wx.createUDPSocket !== 'function') throw new CapError('socket.unsupported', 'wx.createUDPSocket 缺失')
        const s = wx.createUDPSocket()
        return {
          bind: (port) =>
            Promise.resolve().then(() => {
              if (typeof s.bind !== 'function') return capErr<void>('socket.unsupported', 'UDPSocket.bind 缺失')
              try {
                s.bind(port)
                return capOk(undefined)
              } catch (e) {
                return capErr<void>('socket.failed', 'UDP bind 失败', e)
              }
            }),
          connect: (address, port) =>
            Promise.resolve().then(() => {
              if (typeof s.connect !== 'function') return capErr<void>('socket.unsupported', 'UDPSocket.connect 缺失')
              try {
                s.connect({ address, port })
                return capOk(undefined)
              } catch (e) {
                return capErr<void>('socket.failed', 'UDP connect 失败', e)
              }
            }),
          send: (address, port, message, broadcast) =>
            new Promise<CapResult<void>>((resolve) => {
              if (typeof s.send !== 'function') return resolve(capErr('socket.unsupported', 'UDPSocket.send 缺失'))
              s.send({ address, port, message, setBroadcast: broadcast, success: () => resolve(capOk(undefined)), fail: (e: unknown) => resolve(capErr('socket.failed', 'UDP 发送失败', e)) })
            }),
          write: (address, port, message) =>
            Promise.resolve().then(() => {
              if (typeof s.write !== 'function') return capErr<void>('socket.unsupported', 'UDPSocket.write 缺失')
              try {
                s.write({ address, port, message })
                return capOk(undefined)
              } catch (e) {
                return capErr<void>('socket.failed', 'UDP write 失败', e)
              }
            }),
          onMessage: (cb) => {
            if (typeof s.onMessage !== 'function') return () => {}
            const h = (res: { message: ArrayBuffer; remoteInfo: { address: string; port: number; family?: string } }): void =>
              cb({ message: res.message, remoteAddress: res.remoteInfo?.address ?? '', remotePort: res.remoteInfo?.port ?? 0, family: res.remoteInfo?.family })
            s.onMessage(h)
            return () => s.offMessage?.(h)
          },
          onError: (cb) => {
            if (typeof s.onError !== 'function') return () => {}
            s.onError(cb)
            return () => s.offError?.(cb)
          },
          close: () =>
            Promise.resolve().then(() => {
              try {
                s.close?.()
                return capOk(undefined)
              } catch (e) {
                return capErr<void>('socket.failed', 'UDP 关闭失败', e)
              }
            }),
        }
      }
      const makeTcp = (): TCPSocketHandle => {
        if (typeof wx.createTCPSocket !== 'function') throw new CapError('socket.unsupported', 'wx.createTCPSocket 缺失')
        const s = wx.createTCPSocket()
        return {
          connect: (options) =>
            new Promise<CapResult<void>>((resolve) => {
              if (typeof s.connect !== 'function') return resolve(capErr('socket.unsupported', 'TCPSocket.connect 缺失'))
              try {
                s.connect(options)
                resolve(capOk(undefined))
              } catch (e) {
                resolve(capErr('socket.failed', 'TCP connect 失败', e))
              }
            }),
          write: (data) =>
            Promise.resolve().then(() => {
              if (typeof s.write !== 'function') return capErr<void>('socket.unsupported', 'TCPSocket.write 缺失')
              try {
                s.write(data)
                return capOk(undefined)
              } catch (e) {
                return capErr<void>('socket.failed', 'TCP 写入失败', e)
              }
            }),
          onMessage: (cb) => {
            if (typeof s.onMessage !== 'function') return () => {}
            s.onMessage(cb)
            return () => s.offMessage?.(cb as (...a: never[]) => void)
          },
          onConnect: (cb) => {
            if (typeof s.onConnect !== 'function') return () => {}
            s.onConnect(cb)
            return () => s.offConnect?.(cb)
          },
          onError: (cb) => {
            if (typeof s.onError !== 'function') return () => {}
            s.onError(cb)
            return () => s.offError?.(cb)
          },
          onClose: (cb) => {
            if (typeof s.onClose !== 'function') return () => {}
            s.onClose(cb)
            return () => s.offClose?.(cb)
          },
          close: () =>
            Promise.resolve().then(() => {
              try {
                s.close?.()
                return capOk(undefined)
              } catch (e) {
                return capErr<void>('socket.failed', 'TCP 关闭失败', e)
              }
            }),
        }
      }
      return { udp: makeUdp, tcp: makeTcp }
    },
    // ★权威标尺缺口 C70：媒体高级（wx.createMediaContainer / createVideoDecoder / createMediaAudioPlayer）
    getMediaProcessing: () => ({
      container: () => {
        if (typeof wx.createMediaContainer !== 'function') throw new CapError('media-processing.unsupported', 'wx.createMediaContainer 缺失')
        const c = wx.createMediaContainer()
        const run = (fn: unknown, name: string, ...args: unknown[]): Promise<CapResult<void>> =>
          Promise.resolve().then(() => {
            if (typeof fn !== 'function') return capErr<void>('media-processing.unsupported', 'MediaContainer.' + name + ' 缺失')
            try {
              ;(fn as (...a: unknown[]) => void).apply(c, args)
              return capOk(undefined)
            } catch (e) {
              return capErr<void>('media-processing.failed', 'MediaContainer.' + name + ' 失败', e)
            }
          })
        return {
          addTrack: (track) => run(c.addTrack, 'addTrack', track),
          removeTrack: (track) => run(c.removeTrack, 'removeTrack', track),
          extractDataSource: (src) =>
            new Promise<CapResult<MediaTrackInfo[]>>((resolve) => {
              if (typeof c.extractDataSource !== 'function') return resolve(capErr('media-processing.unsupported', 'MediaContainer.extractDataSource 缺失'))
              c.extractDataSource({ source: src, success: (r: { tracks?: unknown[] }) => resolve(capOk((r.tracks ?? []) as MediaTrackInfo[])), fail: (e: unknown) => resolve(capErr('media-processing.failed', '分离轨道失败', e)) })
            }),
          export: () =>
            new Promise<CapResult<string>>((resolve) => {
              if (typeof c.export !== 'function') return resolve(capErr('media-processing.unsupported', 'MediaContainer.export 缺失'))
              c.export({ success: (r: unknown) => resolve(capOk((r as { tempFilePath?: string }).tempFilePath ?? '')), fail: (e: unknown) => resolve(capErr('media-processing.failed', '导出视频失败', e)) })
            }),
          destroy: () => c.destroy?.(),
        }
      },
      videoDecoder: () => {
        if (typeof wx.createVideoDecoder !== 'function') throw new CapError('media-processing.unsupported', 'wx.createVideoDecoder 缺失')
        const d = wx.createVideoDecoder()
        return {
          start: (options) =>
            Promise.resolve(d.start?.({ ...options })).then(() => capOk(undefined), (e) => capErr<void>('media-processing.failed', '视频解码 start 失败', e)),
          getFrameData: () =>
            Promise.resolve().then(() => {
              if (typeof d.getFrameData !== 'function') return capErr<{ data: ArrayBuffer; width?: number; height?: number }>('media-processing.unsupported', 'VideoDecoder.getFrameData 缺失')
              try {
                return capOk(d.getFrameData())
              } catch (e) {
                return capErr<{ data: ArrayBuffer; width?: number; height?: number }>('media-processing.failed', '取帧失败', e)
              }
            }),
          seek: (position) => Promise.resolve(d.seek?.(position)).then(() => capOk(undefined), (e) => capErr<void>('media-processing.failed', 'seek 失败', e)),
          stop: () => Promise.resolve(d.stop?.()).then(() => capOk(undefined), (e) => capErr<void>('media-processing.failed', '解码停止失败', e)),
        }
      },
      audioPlayer: () => {
        if (typeof wx.createMediaAudioPlayer !== 'function') throw new CapError('media-processing.unsupported', 'wx.createMediaAudioPlayer 缺失')
        const p = wx.createMediaAudioPlayer()
        return {
          addAudioSource: (src, startTime) => Promise.resolve(p.addAudioSource?.(src, startTime)).then(() => capOk(undefined), (e) => capErr<void>('media-processing.failed', '添加音源失败', e)),
          removeAudioSource: (src) => Promise.resolve(p.removeAudioSource?.(src)).then(() => capOk(undefined), (e) => capErr<void>('media-processing.failed', '移除音源失败', e)),
          start: () => Promise.resolve(p.start?.()).then(() => capOk(undefined), (e) => capErr<void>('media-processing.failed', '混音播放失败', e)),
          stop: () => Promise.resolve(p.stop?.()).then(() => capOk(undefined), (e) => capErr<void>('media-processing.failed', '停止失败', e)),
          destroy: () => p.destroy?.(),
        }
      },
    }),
    // ★权威标尺缺口 C71：录屏/截屏
    getScreenCapture: () => ({
      getRecordingState: () =>
        new Promise<CapResult<'on' | 'off'>>((resolve) => {
          if (typeof wx.getScreenRecordingState !== 'function') return resolve(capErr('screen-capture.unsupported', 'wx.getScreenRecordingState 缺失'))
          wx.getScreenRecordingState({ success: (r) => resolve(capOk(r.state)), fail: (e: unknown) => resolve(capErr('screen-capture.failed', '查询录屏状态失败', e)) })
        }),
      onRecordingStateChange: (cb) => {
        if (typeof wx.onScreenRecordingStateChanged !== 'function') return () => {}
        wx.onScreenRecordingStateChanged((r) => cb(r.state))
        return () => {
          if (typeof wx.offScreenRecordingStateChanged === 'function') wx.offScreenRecordingStateChanged()
        }
      },
      onUserCapture: (cb) => {
        if (typeof wx.onUserCaptureScreen !== 'function') return () => {}
        wx.onUserCaptureScreen(cb)
        return () => {
          if (typeof wx.offUserCaptureScreen === 'function') wx.offUserCaptureScreen()
        }
      },
      isPictureInPictureActive: () =>
        Promise.resolve().then(() => {
          if (typeof wx.checkIsPictureInPictureActive !== 'function') return capErr<boolean>('screen-capture.unsupported', 'wx.checkIsPictureInPictureActive 缺失')
          try {
            return capOk(!!wx.checkIsPictureInPictureActive())
          } catch (e) {
            return capErr<boolean>('screen-capture.failed', '查询画中画状态失败', e)
          }
        }),
    }),
    // ★权威标尺缺口 C72：缓存管理
    createCacheManager: (options) => {
      if (typeof wx.createCacheManager !== 'function') throw new CapError('cache-manager.unsupported', 'wx.createCacheManager 缺失')
      const cm = wx.createCacheManager(options as { maxAge?: number; mode?: string; origin?: string })
      const run = (fn: unknown, name: string, ...args: unknown[]): Promise<CapResult<void>> =>
        Promise.resolve().then(() => {
          if (typeof fn !== 'function') return capErr<void>('cache-manager.unsupported', 'CacheManager.' + name + ' 缺失')
          try {
            ;(fn as (...a: unknown[]) => void).apply(cm, args)
            return capOk(undefined)
          } catch (e) {
            return capErr<void>('cache-manager.failed', 'CacheManager.' + name + ' 失败', e)
          }
        })
      return {
        rules: [],
        addRules: (rules) =>
          Promise.resolve().then(() => {
            if (typeof cm.addRules !== 'function') return capErr<string[]>('cache-manager.unsupported', 'CacheManager.addRules 缺失')
            try {
              return capOk(cm.addRules(rules.map((r) => ({ url: r.pattern, method: r.method, maxAge: r.maxAge }))))
            } catch (e) {
              return capErr<string[]>('cache-manager.failed', '添加缓存规则失败', e)
            }
          }),
        deleteRules: (ids) => run(cm.deleteRules, 'deleteRules', ids),
        clearRules: () => run(cm.clearRules, 'clearRules'),
        start: () => run(cm.start, 'start'),
        stop: () => run(cm.stop, 'stop'),
        deleteCache: (id) => run(cm.deleteCache, 'deleteCache', id),
        deleteCaches: (ids) => run(cm.deleteCaches, 'deleteCaches', ids),
        clearCaches: () => run(cm.clearCaches, 'clearCaches'),
        getState: () => ({ mode: (cm.mode as CacheManagerState['mode']) ?? 'always', state: cm.state ?? 0, origin: cm.origin, maxAge: cm.maxAge }),
        on: (event, cb) => {
          if (typeof cm.on !== 'function') return () => {}
          cm.on(event, cb)
          return () => cm.off?.(event, cb as (...a: never[]) => void)
        },
      }
    },
    // ★权威标尺缺口 C73：空闲调度
    getIdle: () => ({
      request: (cb, timeout) =>
        Promise.resolve().then(() => {
          if (typeof wx.requestIdleCallback !== 'function') return capErr<number>('idle.unsupported', 'wx.requestIdleCallback 缺失')
          try {
            // wx 不返回 id（回调即执行）——用递增计数模拟 cancel 句柄
            const id = ++idleSeq
            wx.requestIdleCallback((res) => cb({ timeRemaining: () => res.timeRemaining ?? 0, didTimeout: !!res.didTimeout }), timeout !== undefined ? { timeout } : undefined)
            return capOk(id)
          } catch (e) {
            return capErr<number>('idle.failed', 'requestIdleCallback 失败', e)
          }
        }),
      cancel: (id) =>
        Promise.resolve().then(() => {
          if (typeof wx.cancelIdleCallback !== 'function') return capErr<void>('idle.unsupported', 'wx.cancelIdleCallback 缺失')
          try {
            wx.cancelIdleCallback(id)
            return capOk(undefined)
          } catch (e) {
            return capErr<void>('idle.failed', '取消空闲回调失败', e)
          }
        }),
    }),
    // ★权威标尺缺口 C74：窗口
    getWindow: () => ({
      setSize: (width, height) =>
        new Promise<CapResult<void>>((resolve) => {
          if (typeof wx.setWindowSize !== 'function') return resolve(capErr('window.unsupported', 'wx.setWindowSize 缺失（仅 PC 端支持）'))
          wx.setWindowSize({ width, height, success: () => resolve(capOk(undefined)), fail: (e: unknown) => resolve(capErr('window.failed', '设置窗口大小失败', e)) })
        }),
    }),
    // ★权威标尺缺口 C75：导航卸载拦截
    getNavigationGuard: () => ({
      enable: (message) =>
        new Promise<CapResult<void>>((resolve) => {
          if (typeof wx.enableAlertBeforeUnload !== 'function') return resolve(capErr('navigation-guard.unsupported', 'wx.enableAlertBeforeUnload 缺失'))
          wx.enableAlertBeforeUnload({ message, success: () => resolve(capOk(undefined)), fail: (e: unknown) => resolve(capErr('navigation-guard.failed', '开启卸载确认失败', e)) })
        }),
      disable: () =>
        new Promise<CapResult<void>>((resolve) => {
          if (typeof wx.disableAlertBeforeUnload !== 'function') return resolve(capErr('navigation-guard.unsupported', 'wx.disableAlertBeforeUnload 缺失'))
          wx.disableAlertBeforeUnload({ success: () => resolve(capOk(undefined)), fail: (e: unknown) => resolve(capErr('navigation-guard.failed', '关闭卸载确认失败', e)) })
        }),
    }),
    // ★权威标尺缺口 C76：AR/XR（wx.createVKSession / isVKSupport）
    getAR: () => ({
      createSession: (options) => {
        if (typeof wx.createVKSession !== 'function') throw new CapError('ar.unsupported', 'wx.createVKSession 缺失')
        const s = wx.createVKSession({ track: {}, version: 'v2', ...(options as Record<string, unknown>) })
        return {
          state: () => (s.state ?? 0) as VKSessionState,
          start: () =>
            Promise.resolve().then(() => {
              if (typeof s.start !== 'function') return capErr<void>('ar.unsupported', 'VKSession.start 缺失')
              try {
                s.start()
                return capOk(undefined)
              } catch (e) {
                return capErr<void>('ar.failed', '启动 AR 会话失败', e)
              }
            }),
          stop: () =>
            Promise.resolve().then(() => {
              if (typeof s.stop !== 'function') return capErr<void>('ar.unsupported', 'VKSession.stop 缺失')
              try {
                s.stop()
                return capOk(undefined)
              } catch (e) {
                return capErr<void>('ar.failed', '停止 AR 会话失败', e)
              }
            }),
          destroy: () => s.destroy?.(),
          on: (event, cb) => {
            if (typeof s.on !== 'function') return () => {}
            s.on(event, cb)
            return () => s.off?.(event, cb as (...a: never[]) => void)
          },
          requestAnimationFrame: (cb) => (typeof s.requestAnimationFrame === 'function' ? s.requestAnimationFrame(cb as (t: number, f: unknown) => void) : 0),
          cancelAnimationFrame: (handle) => s.cancelAnimationFrame?.(handle),
          getVKFrame: (width, height) => (typeof s.getVKFrame === 'function' ? s.getVKFrame(width, height) : undefined),
        }
      },
      isSupported: (version = 'v2') =>
        Promise.resolve().then(() => {
          if (typeof wx.isVKSupport !== 'function') return capErr<boolean>('ar.unsupported', 'wx.isVKSupport 缺失')
          try {
            return capOk(!!wx.isVKSupport(version))
          } catch (e) {
            return capErr<boolean>('ar.failed', '查询 VK 支持失败', e)
          }
        }),
    }),
    // ★权威标尺缺口 C77：iBeacon
    getBeacon: () => ({
      onServiceChange: (cb) => {
        if (typeof wx.onBeaconServiceChange !== 'function') return () => {}
        wx.onBeaconServiceChange(cb)
        return () => {
          if (typeof wx.offBeaconServiceChange === 'function') wx.offBeaconServiceChange()
        }
      },
      onUpdate: (cb) => {
        if (typeof wx.onBeaconUpdate !== 'function') return () => {}
        wx.onBeaconUpdate(cb)
        return () => {
          if (typeof wx.offBeaconUpdate === 'function') wx.offBeaconUpdate()
        }
      },
    }),
    // ★权威标尺缺口 C78：局域网服务 mDNS
    getLocalService: () => ({
      onFound: (cb) => {
        if (typeof wx.onLocalServiceFound !== 'function') return () => {}
        wx.onLocalServiceFound(cb)
        return () => {
          if (typeof wx.offLocalServiceFound === 'function') wx.offLocalServiceFound()
        }
      },
      onLost: (cb) => {
        if (typeof wx.onLocalServiceLost !== 'function') return () => {}
        wx.onLocalServiceLost(cb)
        return () => {
          if (typeof wx.offLocalServiceLost === 'function') wx.offLocalServiceLost()
        }
      },
      onResolveFail: (cb) => {
        if (typeof wx.onLocalServiceResolveFail !== 'function') return () => {}
        wx.onLocalServiceResolveFail(cb)
        return () => {
          if (typeof wx.offLocalServiceResolveFail === 'function') wx.offLocalServiceResolveFail()
        }
      },
      onDiscoveryStop: (cb) => {
        if (typeof wx.onLocalServiceDiscoveryStop !== 'function') return () => {}
        wx.onLocalServiceDiscoveryStop(cb)
        return () => {
          if (typeof wx.offLocalServiceDiscoveryStop === 'function') wx.offLocalServiceDiscoveryStop()
        }
      },
    }),
    // ★权威标尺缺口 C79：翻译
    getTranslation: () => ({
      onTrigger: (cb) => {
        if (typeof wx.onUserTriggerTranslation !== 'function') return () => {}
        wx.onUserTriggerTranslation(cb)
        return () => {
          if (typeof wx.offUserTriggerTranslation === 'function') wx.offUserTriggerTranslation()
        }
      },
      onOff: (cb) => {
        if (typeof wx.onUserOffTranslation !== 'function') return () => {}
        wx.onUserOffTranslation(() => cb())
        return () => {
          if (typeof wx.offUserOffTranslation === 'function') wx.offUserOffTranslation()
        }
      },
    }),
    // ★权威标尺缺口 C80：分享海报
    getPoster: () => ({
      onGenerate: (cb) => {
        if (typeof wx.onGeneratePoster !== 'function') return () => {}
        wx.onGeneratePoster(cb)
        return () => {
          if (typeof wx.offGeneratePoster === 'function') wx.offGeneratePoster()
        }
      },
    }),
    // ★权威标尺缺口 C81：设备能力探测
    getDeviceCapability: () => ({
      supportsHevc: () =>
        new Promise<CapResult<boolean>>((resolve) => {
          if (typeof wx.checkDeviceSupportHevc !== 'function') return resolve(capErr('device-capability.unsupported', 'wx.checkDeviceSupportHevc 缺失'))
          wx.checkDeviceSupportHevc({ success: (r: { supportHevc: boolean }) => resolve(capOk(!!r.supportHevc)), fail: (e: unknown) => resolve(capErr('device-capability.failed', '查询 HEVC 支持失败', e)) })
        }),
    }),
    // ★C82 WASM（MP 端）：微信 `WXWebAssembly.instantiate(path, imports)`——**只收代码包路径**。
    //   与 Web 标准的差异（见 WebAssemblyAPI 头）：无 compile/validate；不支持字节加载。
    /** ★C48 宿主上下文（MP：provider=weixin + 基础库版本；被嵌入场景的宿主自述） */
    getHostContext: () => ({
      provider: 'weixin',
      version: (() => {
        try {
          if (typeof wx.getSystemInfoSync !== 'function') return undefined
          const info = wx.getSystemInfoSync() as { SDKVersion?: string }
          return info?.SDKVersion
        } catch {
          return undefined
        }
      })(),
      capabilities: ['navigateToMiniProgram', 'share', 'subscribe-message', 'update', 'worker'],
    }),
    /** ★C50 扩展加载（MP 无插件加载 API——需宿主扩展壳；诚实 Err 且给出路） */
    loadExtension: (extensionId) =>
      Promise.reject(
        new CapError(
          'extension.unsupported',
          `小程序端无插件加载 API（请求 ${extensionId}）——需宿主扩展壳（同层渲染/动态组件），见 docs/proteus-platform-plan`,
        ),
      ),
    getWebAssembly: () => ({
      supportsStreaming: false, // MP 只收路径，不支持字节/流式编译（能力位，供调用方免于按平台名分支）
      supportsPathLoad: true,
      instantiate: (source, options) => {
        if (!('path' in source)) {
          return Promise.resolve(
            capErr<WasmModuleHandle>(
              'webassembly.unsupported',
              'MP 端 WXWebAssembly 只接受代码包路径（.wasm / .wasm.br）——请传 { path }；字节加载请用 Web/App 端',
            ),
          )
        }
        // ★★官方形态：`WXWebAssembly` 是**全局对象**，不是 `wx` 的成员。
        //   官方文档原文：「从基础库 v2.13.0 开始，小程序可以在**全局访问并使用 WXWebAssembly 对象**」。
        //   【本仓实测教训（2026-09-29）】首版只查 `wx.WXWebAssembly` —— 取证时读到的是"全局"，
        //     实现却按"wx 成员"写 ⇒ **真机上能力会不可用**（单测里我同时 stub 了 wx 上有该字段，
        //     所以单测全绿而真机必错 —— 典型的"取证了但没把结论用上"）。
        //   ⇒ 两个位置都查（全局优先，回落 wx 成员以兼容可能的注入形态）。
        const gAny = globalThis as { WXWebAssembly?: { instantiate?: (p: string, i?: Record<string, Record<string, unknown>>) => Promise<{ exports: Record<string, unknown> }> } }
        const W = gAny.WXWebAssembly ?? wx.WXWebAssembly
        if (!W || typeof W.instantiate !== 'function') {
          return Promise.resolve(
            capErr<WasmModuleHandle>(
              'webassembly.unsupported',
              '全局 WXWebAssembly.instantiate 缺失（需基础库 v2.13.0+）',
            ),
          )
        }
        return W.instantiate(source.path, options?.imports)
          .then((inst): CapResult<WasmModuleHandle> =>
            capOk({
              exports: (inst?.exports ?? {}) as Record<string, unknown>,
              fromPath: true,
              dispose: () => {
                /* WASM 实例由 GC 回收（MP 侧无显式释放 API）——保留统一出口供未来池化 */
              },
            }),
          )
          .catch((e: unknown): CapResult<WasmModuleHandle> => capErr('webassembly.failed', 'WXWebAssembly.instantiate 失败', e))
      },
      // ★compile / validate **有意不实现**：MP 端无此二能力。
      //   不实现 = 属性为 undefined ⇒ 调用方 `if (wasm.compile)` 探测即得 false（诚实，不撒谎）。
    }),
    getCalendar: () => ({
      add: (event) =>
        new Promise<CapResult<void>>((resolve) => {
          if (!wx.addPhoneCalendar) return resolve(capErr('calendar.unsupported', 'wx.addPhoneCalendar 缺失'))
          wx.addPhoneCalendar({ ...event, success: () => resolve(capOk(undefined)), fail: (e) => resolve(capErr('calendar.failed', '添加日程失败', e)) })
        }),
      remove: (eventId) =>
        new Promise<CapResult<void>>((resolve) => {
          if (!wx.removePhoneCalendar) return resolve(capErr('calendar.unsupported', 'wx.removePhoneCalendar 缺失'))
          wx.removePhoneCalendar({ eventId, success: () => resolve(capOk(undefined)), fail: (e) => resolve(capErr('calendar.failed', '删除日程失败', e)) })
        }),
      list: () => Promise.resolve(capErr<CalendarEvent[]>('calendar.unsupported', '小程序无日历查询开放 API（仅写）')),
    }),
    createSocketTask: (url) => {
      if (typeof wx.connectSocket !== 'function') throw new CapError('socket-task.unsupported', 'wx.connectSocket 缺失')
      const task = wx.connectSocket({ url })
      let connected = false
      if (task && typeof task.onOpen === 'function') task.onOpen(() => (connected = true))
      const messageCbs: Array<(data: string) => void> = []
      if (task && typeof task.onMessage === 'function') {
        task.onMessage((r) => {
          const data = typeof r.data === 'string' ? r.data : ''
          messageCbs.forEach((cb) => cb(data))
        })
      }
      return {
        send: (data) =>
          new Promise<void>((resolve, reject) => {
            if (!task || typeof task.send !== 'function') return reject(new CapError('socket-task.unsupported', 'SocketTask.send 缺失'))
            task.send({ data })
            resolve()
          }),
        close: (code, reason) =>
          new Promise<void>((resolve, reject) => {
            if (!task || typeof task.close !== 'function') return reject(new CapError('socket-task.unsupported', 'SocketTask.close 缺失'))
            task.close({ code, reason })
            resolve()
          }),
        onMessage: (cb) => {
          messageCbs.push(cb)
          return () => {
            const i = messageCbs.indexOf(cb)
            if (i >= 0) messageCbs.splice(i, 1)
          }
        },
        isConnected: () => connected,
      }
    },
    getCookieJar: () => {
      const store = wxStorage(wx)
      const COOKIE_KEY = '__proteus_cookies'
      const load = (): Record<string, string> => {
        const raw = store.get<Record<string, string>>(COOKIE_KEY)
        return raw !== undefined ? raw : {}
      }
      return {
        get: (name) => load()[name],
        set: (name, value) => {
          const all = load()
          all[name] = value
          store.set(COOKIE_KEY, all)
        },
        remove: (name) => {
          const all = load()
          delete all[name]
          store.set(COOKIE_KEY, all)
        },
        list: () => load(),
      }
    },
    authenticateFaceID: (prompt) =>
      new Promise((resolve, reject) => {
        if (typeof wx.startSoterAuthentication !== 'function') return reject(new CapError('face-id.unsupported', 'wx.startSoterAuthentication 缺失'))
        wx.startSoterAuthentication({
          requestAuthModes: ['facial'],
          authContent: prompt,
          success: () => resolve(true),
          fail: () => resolve(false),
        })
      }),
    navigateMiniProgram: (options) =>
      new Promise((resolve, reject) => {
        if (typeof wx.navigateToMiniProgram !== 'function') return reject(new CapError('mini-program.unsupported', 'wx.navigateToMiniProgram 缺失'))
        wx.navigateToMiniProgram({
          appId: options.appId,
          path: options.path,
          extraData: options.extraData,
          success: () => resolve(),
          fail: (e) => reject(new CapError('mini-program.failed', 'wx 跳小程序失败', e)),
        })
      }),
    // ★能力颗粒度对齐：C49 直播观看端（wx.createLivePlayerContext(roomId) → 播放控制全套）
    joinLiveRoom: (options) => {
      // 缺 API → 返回「全 reject 桥」（useLive 为 Promise 型 hook：方法级 Err 而非抛）
      if (typeof wx.createLivePlayerContext !== 'function') {
        const noSupport = (): Promise<never> => Promise.reject(new CapError('live.unsupported', 'wx.createLivePlayerContext 缺失（live-player 组件需直播类目）'))
        return { play: noSupport, pause: noSupport, resume: noSupport, stop: noSupport, mute: () => {}, snapshot: noSupport, requestFullScreen: noSupport, exitFullScreen: noSupport, status: () => 'stopped' as const, onStateChange: () => () => {} }
      }
      const ctx = wx.createLivePlayerContext(options.roomId)
      let state: LivePlayState = 'stopped'
      const stateCbs: Array<(s: LivePlayState) => void> = []
      const setState = (s: LivePlayState): void => {
        state = s
        stateCbs.forEach((cb) => cb(s))
      }
      const run = (fn: unknown, name: string, opt?: Record<string, unknown>): Promise<void> =>
        new Promise<void>((res, rej) => {
          if (typeof fn !== 'function') return rej(new CapError('live.unsupported', 'LivePlayerContext.' + name + ' 缺失'))
          ;(fn as (o?: Record<string, unknown>) => void)({ ...opt, success: () => res(), fail: (e: unknown) => rej(new CapError('live.failed', 'wx 直播 ' + name + ' 失败', e)) })
        })
      // 生命周期回调驱动状态
      if (ctx.onPlay) ctx.onPlay(() => setState('playing'))
      if (ctx.onPause) ctx.onPause(() => setState('paused'))
      if (ctx.onStop) ctx.onStop(() => setState('stopped'))
      if (ctx.onError) ctx.onError(() => setState('error'))
      return {
        play: () => run(ctx.play, 'play'),
        pause: () => run(ctx.pause, 'pause'),
        resume: () => run(ctx.resume, 'resume'),
        stop: () => run(ctx.stop, 'stop'),
        mute: () => {
          if (typeof ctx.mute === 'function') ctx.mute({})
        },
        snapshot: () =>
          new Promise<string>((res, rej) => {
            if (typeof ctx.snapshot !== 'function') return rej(new CapError('live.unsupported', 'LivePlayerContext.snapshot 缺失'))
            ctx.snapshot({ success: (r) => res(r.tempImagePath), fail: (e: unknown) => rej(new CapError('live.failed', '截图失败', e)) })
          }),
        requestFullScreen: (direction) => run(ctx.requestFullScreen, 'requestFullScreen', { direction }),
        exitFullScreen: () => run(ctx.exitFullScreen, 'exitFullScreen'),
        status: () => state,
        onStateChange: (cb) => {
          stateCbs.push(cb)
          return () => {
            const i = stateCbs.indexOf(cb)
            if (i >= 0) stateCbs.splice(i, 1)
          }
        },
      }
    },
  }
}

/** ★能力颗粒度对齐：NFC 读卡模式桥（wx.getNFCAdapter → 发现标签 + 各技术类型连接）
 *   缺 getNFCAdapter → 全方法 Err（诚实降级）。各连接句柄方法统一 Promise<CapResult<T>>。 */
function buildNfcAdapter(wx: WxLike): NfcAdapter {
  const noAdapter = <T,>(op: string): Promise<CapResult<T>> => Promise.resolve(capErr<T>('nfc.unsupported', 'wx.getNFCAdapter 缺失（' + op + ' 不可用）'))
  if (typeof wx.getNFCAdapter !== 'function') {
    return {
      startDiscovery: () => noAdapter('startDiscovery'),
      stopDiscovery: () => noAdapter('stopDiscovery'),
      onDiscovered: () => () => {},
      connectNdef: () => noAdapter('getNdef'),
      connectIsoDep: () => noAdapter('getIsoDep'),
      connectNfcA: () => noAdapter('getNfcA'),
      connectNfcB: () => noAdapter('getNfcB'),
      connectNfcF: () => noAdapter('getNfcF'),
      connectNfcV: () => noAdapter('getNfcV'),
      connectMifareClassic: () => noAdapter('getMifareClassic'),
      connectMifareUltralight: () => noAdapter('getMifareUltralight'),
    }
  }
  const adapter = wx.getNFCAdapter()
  const cap = <T,>(p: Promise<T>): Promise<CapResult<T>> => p.then((d) => capOk(d), (e) => capErr<T>(e instanceof CapError ? e.code : 'nfc.failed', e instanceof Error ? e.message : String(e), e))
  const run = (fn: unknown, name: string, opt?: Record<string, unknown>): Promise<void> =>
    new Promise<void>((res, rej) => {
      if (typeof fn !== 'function') return rej(new CapError('nfc.unsupported', 'NFCAdapter.' + name + ' 缺失'))
      ;(fn as (o?: Record<string, unknown>) => void)({ ...opt, success: () => res(), fail: (e: unknown) => rej(new CapError('nfc.failed', 'NFC ' + name + ' 失败', e)) })
    })
  const makeTag = (getter: () => WxNfcTagLike | undefined, name: string): Promise<CapResult<NfcTagHandle>> =>
    cap(
      (async () => {
        const tag = getter()
        if (!tag) throw new CapError('nfc.unsupported', 'NFCAdapter.' + name + ' 缺失')
        await run(tag.connect, name + '.connect')
        const handle: NfcTagHandle = {
          connect: () => cap(run(tag.connect, name + '.connect')),
          close: () => cap(run(tag.close, name + '.close')),
          isConnected: () => (typeof tag.isConnected === 'function' ? tag.isConnected() : false),
          setTimeout: (timeout) => cap(run(tag.setTimeout, name + '.setTimeout', { timeout })),
          transceive: (data) =>
            new Promise<CapResult<ArrayBuffer>>((res) => {
              if (typeof tag.transceive !== 'function') return res(capErr('nfc.unsupported', name + '.transceive 缺失'))
              tag.transceive!({ data, success: (r) => res(capOk(r.data)), fail: (e: unknown) => res(capErr('nfc.failed', 'transceive 失败', e)) })
            }),
        }
        return handle
      })(),
    )
  const makeNdef = (): Promise<CapResult<NdefHandle>> =>
    cap(
      (async () => {
        const tag = adapter.getNdef ? adapter.getNdef() : undefined
        if (!tag) throw new CapError('nfc.unsupported', 'NFCAdapter.getNdef 缺失')
        await run(tag.connect, 'Ndef.connect')
        const base = await makeTag(() => tag, 'Ndef')
        if (!base.ok) throw new CapError(base.error.code, base.error.message)
        const handle: NdefHandle = {
          ...base.data,
          writeNdefMessage: (message) =>
            new Promise<CapResult<void>>((res) => {
              if (typeof tag.writeNdefMessage !== 'function') return res(capErr('nfc.unsupported', 'Ndef.writeNdefMessage 缺失'))
              tag.writeNdefMessage({ records: message.records, success: () => res(capOk(undefined)), fail: (e) => res(capErr('nfc.failed', '写 NDEF 失败', e)) })
            }),
          onNdefMessage: (cb) => {
            if (typeof tag.onNdefMessage !== 'function') return () => {}
            tag.onNdefMessage(cb)
            return () => {
              if (typeof tag.offNdefMessage === 'function') tag.offNdefMessage(cb)
            }
          },
        }
        return handle
      })(),
    )
  return {
    startDiscovery: () => cap(run(adapter.startDiscovery, 'startDiscovery')),
    stopDiscovery: () => cap(run(adapter.stopDiscovery, 'stopDiscovery')),
    onDiscovered: (cb) => {
      if (typeof adapter.onDiscovered !== 'function') return () => {}
      const h = (r: { id: ArrayBuffer; techs: string[]; messages?: unknown[] }): void => cb({ id: r.id, techs: r.techs ?? [], messages: r.messages as NfcTag['messages'] })
      adapter.onDiscovered(h)
      return () => {
        if (typeof adapter.offDiscovered === 'function') adapter.offDiscovered(h)
      }
    },
    connectNdef: () => makeNdef(),
    connectIsoDep: () => makeTag(() => adapter.getIsoDep?.(), 'IsoDep'),
    connectNfcA: () => makeTag(() => adapter.getNfcA?.(), 'NfcA'),
    connectNfcB: () => makeTag(() => adapter.getNfcB?.(), 'NfcB'),
    connectNfcF: () => makeTag(() => adapter.getNfcF?.(), 'NfcF'),
    connectNfcV: () => makeTag(() => adapter.getNfcV?.(), 'NfcV'),
    connectMifareClassic: () => makeTag(() => adapter.getMifareClassic?.(), 'MifareClassic'),
    connectMifareUltralight: () => makeTag(() => adapter.getMifareUltralight?.(), 'MifareUltralight'),
  }
}

function normalizeNetwork(t: string): NetworkType['type'] {
  if (t === 'wifi') return 'wifi'
  if (t === '2g' || t === '3g' || t === '4g' || t === '5g' || t === 'unknown') return 'cellular'
  return 'unknown'
}

/** wx PerformanceEntry → 归一（C66） */
function normalizePerfEntry(e: WxPerformanceEntryLike): PerformanceEntry {
  return { name: e.name, entryType: e.entryType, duration: e.duration ?? 0, startTime: e.startTime, fileList: e.fileList, moduleName: e.moduleName }
}

/** 预下载任务 → 进度订阅句柄（C67；holder 惰性读 task——success 回调可能早于赋值返回） */
function makeProgressHandle(holder: { task?: WxPreDownloadTaskLike }): PreDownloadTask {
  return {
    onProgressUpdate: (cb) => {
      const task = holder.task
      if (typeof task?.onProgressUpdate !== 'function') return () => {}
      task.onProgressUpdate(cb)
      return () => {}
    },
  }
}

/** requestIdleCallback 句柄计数（wx 不返回 id——用递增计数模拟 cancel 语义） */
let idleSeq = 0

/** Web 桥（navigator / window.screen / matchMedia——SSR/Node 安全探测） */
export function webBridge(g: typeof globalThis & { navigator?: Navigator & { getBattery?: () => Promise<unknown> } }): CapabilityBridge {
  const nav = g.navigator as (Navigator & { getBattery?: () => Promise<unknown> }) | undefined
  const sc = (g as { screen?: Screen }).screen
  // ★★Web 端生命周期能力（2026-09-30 改走共享总线——与 MP/App 同构）：
  //   装 Web 事件源（visibilitychange/resize/scroll/beforeunload）+ 取扩展句柄。
  //   三端同一总线 ⇒ 事件面不因端而异（此前 Web 手写 3 事件、与扩展面分叉）。
  const webLifecycleCaps = (() => {
    const bus = getHostLifecycleBus()
    installWebEventSources(bus, g as never)
    return createAppLifecycleCapabilities(bus, CapError)
  })()
  return {
    getLocation: () =>
      new Promise((resolve, reject) => {
        const geo = nav?.geolocation
        if (!geo) return reject(new CapError('location.unsupported', 'geolocation 不支持'))
        geo.getCurrentPosition(
          (pos) =>
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              altitude: pos.coords.altitude ?? undefined,
              speed: pos.coords.speed ?? undefined,
            }),
          (e) => reject(new CapError('location.failed', 'geolocation 失败', e)),
          { timeout: 8000 },
        )
      }),
    vibrate: async (durationMs) => {
      if (!nav?.vibrate) throw new CapError('vibrate.unsupported', 'navigator.vibrate 不支持')
      nav.vibrate(durationMs)
    },
    getNetwork: async () => {
      const online = typeof nav?.onLine === 'boolean' ? nav.onLine : true
      return { online, type: online ? 'unknown' : 'none' }
    },
    readClipboard: async () => {
      const clip = nav?.clipboard
      if (!clip?.readText) throw new CapError('clipboard.read.unsupported', 'navigator.clipboard.readText 不支持')
      try {
        return await clip.readText()
      } catch (e) {
        throw new CapError('clipboard.read.failed', '剪贴板读取被拒（需要权限/聚焦）', e)
      }
    },
    setClipboard: async (text) => {
      const clip = nav?.clipboard
      if (!clip?.writeText) throw new CapError('clipboard.write.unsupported', 'navigator.clipboard.writeText 不支持')
      await clip.writeText(text)
    },
    getScreen: async () => {
      if (!sc) throw new CapError('screen.unsupported', 'window.screen 不存在（SSR）')
      const orientation = typeof matchMedia === 'function' && matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait'
      return { width: sc.width ?? 0, height: sc.height ?? 0, dpr: g.devicePixelRatio ?? 1, orientation }
    },
    getDevice: async () => {
      const ua = typeof nav?.userAgent === 'string' ? nav.userAgent : ''
      const isIOS = /iPhone|iPad/.test(ua)
      const isAndroid = /Android/.test(ua)
      const platform = isIOS ? 'ios' : isAndroid ? 'android' : 'web'
      return { platform, model: isIOS ? 'iPhone' : isAndroid ? 'Android' : 'Web', os: ua, version: 'unknown', browser: 'web' }
    },
    getBattery: async () => {
      const battery = nav?.getBattery
      if (!battery) throw new CapError('battery.unsupported', 'navigator.getBattery 不支持')
      const info = (await battery.call(nav)) as { level?: number; charging?: boolean; chargingTime?: number; dischargingTime?: number } | null
      if (!info) throw new CapError('battery.failed', 'getBattery 返回空')
      return {
        level: typeof info.level === 'number' ? info.level : 1,
        charging: info.charging === true,
        chargingTime: info.chargingTime,
        dischargingTime: info.dischargingTime,
      }
    },
    getOrientation: async () => {
      if (typeof matchMedia !== 'function') return { type: 'portrait', angle: 0 }
      const mq = matchMedia('(orientation: landscape)')
      return { type: mq.matches ? 'landscape' : 'portrait', angle: 0 }
    },
    share: async (options) => {
      const share = nav?.share
      if (!share) throw new CapError('share.unsupported', 'navigator.share 不支持（需 HTTPS + 用户手势）')
      await share({ title: options.title, text: options.text, url: options.url })
    },
    // ★G-32 B3 续：request → fetch 桥（RequestResponse 契约）
    request: async (config) => {
      if (typeof g.fetch !== 'function') throw new CapError('fetch.unsupported', 'fetch 不支持（Node<18/SSR）')
      const url = encodedUrl(config.url, config.params)
      const resp = await g.fetch(url, {
        method: config.method ?? 'GET',
        headers: config.headers as Record<string, string> | undefined,
        body: config.data !== undefined ? JSON.stringify(config.data) : undefined,
      })
      if (!resp.ok) throw new CapError('fetch.failed', `HTTP ${resp.status}`)
      const text = await resp.text()
      let data: unknown = text
      try {
        data = JSON.parse(text)
      } catch {
        /* 非 JSON 原样 */
      }
      const headers: Record<string, string> = {}
      resp.headers.forEach((v, k) => {
        headers[k] = v
      })
      return { data, status: resp.status, headers, config }
    },
    getPermission: async (permission) => {
      const perms = nav?.permissions
      if (!perms?.query) throw new CapError('permission.unsupported', 'navigator.permissions 不支持')
      let result: PermissionState
      try {
        const st = await perms.query({ name: permission as PermissionName })
        result = { permission, state: st.state as PermissionState['state'] }
      } catch (e) {
        // 未知权限名 → 视为 prompt（非拒绝）
        result = { permission, state: 'prompt' }
        void e
      }
      return result
    },
    getStorage: () => {
      const ls = (g as { localStorage?: Storage }).localStorage
      if (!ls || typeof ls.getItem !== 'function') return memoryStorage()
      const readOne = <T,>(key: string): T | undefined => {
        const raw = ls.getItem(key)
        if (raw === null) return undefined
        try {
          return JSON.parse(raw) as T
        } catch {
          return undefined
        }
      }
      const store: CompatStorage = {
        get: readOne,
        set: (key, value) => ls.setItem(key, JSON.stringify(value)),
        remove: (key) => ls.removeItem(key),
        clear: () => ls.clear(),
        // ★能力颗粒度对齐：异步/批量/info（localStorage 同步语义包装 CapResult）
        setAsync: (key, value) => {
          ls.setItem(key, JSON.stringify(value))
          return Promise.resolve(capOk(undefined))
        },
        getAsync: <T,>(key: string) => Promise.resolve(capOk(readOne<T>(key))),
        removeAsync: (key) => {
          ls.removeItem(key)
          return Promise.resolve(capOk(undefined))
        },
        clearAsync: () => {
          ls.clear()
          return Promise.resolve(capOk(undefined))
        },
        info: () => Promise.resolve(capOk({ keys: Object.keys(ls), currentSize: 0, limitSize: 5 * 1024 * 1024 })),
        batchGet: (keys) => Promise.resolve(capOk(keys.map((k) => ({ key: k, value: readOne(k) })))),
        batchSet: (kvList) => {
          kvList.forEach((kv) => ls.setItem(kv.key, JSON.stringify(kv.value)))
          return Promise.resolve(capOk(undefined))
        },
      }
      return store
    },
    // ★G-32 B3 三期：新增能力（web——无标准 API 的能力（亮度/电话/支付/登录/扫码）缺省 undefined → Hook Err('<cap>.unsupported')
    readSensor: (kind) =>
      new Promise((resolve, reject) => {
        const gany = g as {
          addEventListener?: (t: string, cb: (e: unknown) => void) => void
          removeEventListener?: (t: string, cb: (e: unknown) => void) => void
        }
        if (typeof gany.addEventListener !== 'function') {
          return reject(new CapError('sensor.unsupported', '无事件监听环境（SSR/Node）'))
        }
        // 车内一次性读取：devicemotion（加速/陀螺）或 deviceorientation（罗盘）首个事件即 resolve
        const eventName = kind === 'compass' ? 'deviceorientation' : 'devicemotion'
        let settled = false
        const handler = (e: unknown) => {
          if (settled) return
          settled = true
          cleanup()
          const ev = e as {
            accelerationIncludingGravity?: { x?: number; y?: number; z?: number }
            webkitCompassHeading?: number
            alpha?: number | null
          }
          if (kind === 'compass') {
            const heading = typeof ev.webkitCompassHeading === 'number' ? ev.webkitCompassHeading : typeof ev.alpha === 'number' ? 360 - ev.alpha : 0
            resolve({ kind, heading, timestamp: Date.now() })
            return
          }
          const a = ev.accelerationIncludingGravity
          resolve({ kind, x: a ? a.x : undefined, y: a ? a.y : undefined, z: a ? a.z : undefined, timestamp: Date.now() })
        }
        const cleanup = () => {
          if (typeof gany.removeEventListener === 'function') gany.removeEventListener(eventName, handler)
          clearTimeout(timer)
        }
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          cleanup()
          reject(new CapError('sensor.timeout', '传感器事件超时（需设备支持/用户授权）'))
        }, 1500)
        gany.addEventListener(eventName, handler)
      }),
    checkBiometricSupport: async () => {
      // WebAuthn 可用性 = 平台支持指纹/面容的入口（真正硬件支持由系统认证时判定）
      const cred = (g as { PublicKeyCredential?: unknown }).PublicKeyCredential
      return typeof cred === 'function'
    },
    authenticateBiometric: async (options) => {
      const cred = (g as { PublicKeyCredential?: unknown }).PublicKeyCredential
      if (typeof cred !== 'function') throw new CapError('biometric.unsupported', 'WebAuthn 不支持（需 HTTPS/现代浏览器）')
      const creds = nav?.credentials
      if (!creds || typeof creds.get !== 'function') throw new CapError('biometric.unsupported', 'navigator.credentials.get 缺失')
      try {
        await creds.get({
          publicKey: {
            challenge: new Uint8Array(32),
            rpId: typeof g.location === 'object' && g.location ? g.location.hostname || 'localhost' : 'localhost',
            userVerification: 'required',
            timeout: 60000,
          },
        })
        return true
      } catch (e) {
        throw new CapError('biometric.failed', 'WebAuthn 认证失败/用户取消', e)
      }
    },
    // ★G-32 B3 四期：web 实现（websocket=WebSocket / upload=fetch FormData / download=fetch blob / log=console；analytics 无标准 API → 缺省；file-system=内存降级）
    connectWebSocket: (url, protocols) =>
      new Promise((resolve, reject) => {
        const WS = (g as { WebSocket?: new (u: string, p?: string[]) => unknown }).WebSocket
        if (typeof WS !== 'function') return reject(new CapError('websocket.unsupported', 'WebSocket 不支持'))
        let ws
        try {
          ws = new WS(url, protocols && protocols.length ? protocols : undefined)
        } catch (e) {
          return reject(new CapError('websocket.failed', 'WebSocket 构造失败', e))
        }
        const target = ws as {
          send?: (d: string | ArrayBuffer) => void
          close?: (code?: number, reason?: string) => void
          addEventListener?: (t: string, cb: (e?: unknown) => void) => void
          removeEventListener?: (t: string, cb: (e?: unknown) => void) => void
        }
        let settled = false
        target.addEventListener?.('open', () => {
          if (settled) return
          settled = true
          resolve({
            send: (data) => target.send?.(data),
            close: (code, reason) => target.close?.(code, reason),
            on: (event, handler) => {
              const cb = (e?: unknown) => handler(e)
              if (event === 'message') target.addEventListener?.('message', cb)
              else if (event === 'error') target.addEventListener?.('error', cb)
              else if (event === 'close') target.addEventListener?.('close', cb)
              else target.addEventListener?.(event, cb)
              return () => target.removeEventListener?.(event, cb)
            },
          })
        })
        target.addEventListener?.('error', () => {
          if (!settled) {
            settled = true
            reject(new CapError('websocket.failed', 'WebSocket 连接失败'))
          }
        })
      }),
    upload: async (options, onProgress) => {
      const form = new FormData()
      const file = options.file ?? new Blob([''], { type: 'application/octet-stream' })
      form.append(options.name ?? 'file', file)
      if (options.formData) {
        for (const k of Object.keys(options.formData)) form.append(k, options.formData[k])
      }
      const headers = { ...(options.headers ?? {}) }
      const resp = await g.fetch(options.url, { method: 'POST', headers, body: form })
      const text = await resp.text()
      let data: unknown = text
      try {
        data = JSON.parse(text)
      } catch {
        /* 非 JSON 原样 */
      }
      onProgress?.(100)
      return { status: resp.status, data, progress: 100 }
    },
    download: async (url, options, onProgress) => {
      const resp = await g.fetch(url, { headers: options?.headers })
      const rt = options?.responseType ?? 'blob'
      if (rt === 'text') {
        const text = await resp.text()
        onProgress?.(100)
        return { status: resp.status, data: text, progress: 100 }
      }
      if (rt === 'json') {
        const text = await resp.text()
        let data: unknown = text
        try {
          data = JSON.parse(text)
        } catch {
          /* 非 JSON 原样 */
        }
        onProgress?.(100)
        return { status: resp.status, data, progress: 100 }
      }
      const blob = await resp.blob()
      onProgress?.(100)
      return { status: resp.status, data: blob, progress: 100 }
    },
    // C34 analytics：web 无标准事件上报 API（sendBeacon 需服务端约定）→ 缺省（useAnalytics 返回 Err）
    log: async (level, message, data) => {
      const fn = console[level]
      if (typeof fn === 'function') fn(message, data !== undefined ? data : '')
    },
    // C43 file-system：web 无标准同步 FS（OPFS 受限/需安全上下文）→ 内存降级（可读写，非持久）
    getFileSystem: () => memoryFileSystem(),
    // ★能力颗粒度对齐：web 直播观看端（无标准对等 → 诚实 Err 句柄）
    joinLiveRoom: () => {
      // 桥层返回原始 Promise（reject）——hook 的 wrap 转为 Err
      const noWeb = (op: string): Promise<never> => Promise.reject(new CapError('live.unsupported', 'Web 端直播 ' + op + ' 无标准对等'))
      return {
        play: () => noWeb('play'),
        pause: () => noWeb('pause'),
        resume: () => noWeb('resume'),
        stop: () => noWeb('stop'),
        mute: () => {},
        snapshot: () => noWeb('snapshot'),
        requestFullScreen: () => noWeb('requestFullScreen'),
        exitFullScreen: () => noWeb('exitFullScreen'),
        status: () => 'stopped' as const,
        onStateChange: () => () => {},
      }
    },
    // ★G-32 B3 五期：web 实现（notification=Notification API / app-lifecycle=visibilitychange+load；contact/calendar/archive/shortcut 无标准 → 缺省降级 Err）
    subscribeMessage: async (templateId) => {
      const N = (g as { Notification?: NotificationConstructor }).Notification
      if (typeof N !== 'function') throw new CapError('notification.unsupported', 'Notification API 不支持（需 HTTPS/现代浏览器）')
      if (!N.requestPermission) throw new CapError('notification.unsupported', 'Notification.requestPermission 缺失')
      const status = await N.requestPermission()
      return { templateId, granted: status === 'granted', status }
    },
    // ★能力颗粒度对齐：web 设备订阅消息/客服会话（无标准对等 → 诚实 Err）
    subscribeDeviceMessage: () => Promise.reject(new CapError('notification.unsupported', 'Web 端无设备订阅消息对等')),
    openCustomerService: () => Promise.reject(new CapError('notification.unsupported', 'Web 端无客服会话对等')),
    // ★★2026-09-30 改走共享总线（与 MP/App 同构——见 installWebEventSources 注释）：
    //   此前 Web 桥**手写**一套自己的订阅（只有 3 个事件），与 MP/App 的扩展事件面分叉。
    getAppLifecycle: () => webLifecycleCaps.getAppLifecycle(),
    // ★G-32 B3 六期：web 实现（page-lifecycle=visibilitychange / bluetooth·nfc=特性探测 / camera·mic=getUserMedia / keyboard=visualViewport 启发式）
    getPageLifecycle: () => webLifecycleCaps.getPageLifecycle(),
    getBluetooth: async () => {
      // Web Bluetooth：仅特性探测（真实请求需用户手势 + 权限）——诚实降级
      const nav = g.navigator as { bluetooth?: unknown } | undefined
      const supported = typeof nav?.bluetooth === 'object' && nav.bluetooth !== null
      // ★能力颗粒度对齐：返回完整 BluetoothAPI；Web 的 BLE 操作无标准对等 → 每个操作诚实 Err（不虚构）
      const noWeb = <T,>(op: string): Promise<CapResult<T>> => Promise.resolve(capErr<T>('bluetooth.unsupported', 'Web 端 BLE ' + op + ' 无标准对等（需 Web Bluetooth 用户手势）'))
      return {
        supported,
        available: supported,
        devices: [],
        close: () => Promise.resolve(capOk(undefined)),
        getAdapterState: () => Promise.resolve(capOk({ available: supported, discovering: false })),
        startDiscovery: () => noWeb('startDiscovery'),
        stopDiscovery: () => Promise.resolve(capOk(undefined)),
        getDevices: () => Promise.resolve(capOk([])),
        getConnectedDevices: () => Promise.resolve(capOk([])),
        connect: () => noWeb('connect'),
        disconnect: () => noWeb('disconnect'),
        getServices: () => noWeb('getServices'),
        getCharacteristics: () => noWeb('getCharacteristics'),
        read: () => noWeb('read'),
        write: () => noWeb('write'),
        setNotify: () => noWeb('setNotify'),
        getRSSI: () => noWeb('getRSSI'),
        onDeviceFound: () => () => {},
        onConnectionStateChange: () => () => {},
        onCharacteristicValueChange: () => () => {},
      }
    },
    getNfc: async () => {
      const supported = typeof (g as { NDEFReader?: unknown }).NDEFReader === 'function'
      // ★能力颗粒度对齐：web 返完整 NFCAPI（HCE 无标准对等 → 诚实 Err）
      const noWeb = <T,>(op: string): Promise<CapResult<T>> => Promise.resolve(capErr<T>('nfc.unsupported', 'Web 端 NFC ' + op + ' 无标准对等'))
      const noAdapter = (): NfcAdapter => ({
        startDiscovery: () => noWeb('startDiscovery'),
        stopDiscovery: () => noWeb('stopDiscovery'),
        onDiscovered: () => () => {},
        connectNdef: () => noWeb('getNdef'),
        connectIsoDep: () => noWeb('getIsoDep'),
        connectNfcA: () => noWeb('getNfcA'),
        connectNfcB: () => noWeb('getNfcB'),
        connectNfcF: () => noWeb('getNfcF'),
        connectNfcV: () => noWeb('getNfcV'),
        connectMifareClassic: () => noWeb('getMifareClassic'),
        connectMifareUltralight: () => noWeb('getMifareUltralight'),
      })
      return {
        supported,
        available: supported,
        startHCE: () => noWeb('startHCE'),
        stopHCE: () => noWeb('stopHCE'),
        sendHCEMessage: () => noWeb('sendHCEMessage'),
        onHCEMessage: () => () => {},
        onHCEStateChange: () => () => {},
        getAdapter: noAdapter,
      }
    },
    getCamera: async () => {
      const nav = g.navigator as (Navigator & { mediaDevices?: { getUserMedia?: (c: Record<string, unknown>) => Promise<{ getTracks(): Array<{ stop(): void }> }> } }) | undefined
      const gu = nav?.mediaDevices?.getUserMedia
      if (typeof gu !== 'function') return { kind: 'camera' as const, supported: false, granted: false }
      try {
        const stream = await gu({ video: { facingMode: 'user' } })
        stream.getTracks().forEach((t) => t.stop())
        return { kind: 'camera' as const, supported: true, granted: true }
      } catch {
        return { kind: 'camera' as const, supported: true, granted: false }
      }
    },
    getMicrophone: async () => {
      const nav = g.navigator as (Navigator & { mediaDevices?: { getUserMedia?: (c: Record<string, unknown>) => Promise<{ getTracks(): Array<{ stop(): void }> }> } }) | undefined
      const gu = nav?.mediaDevices?.getUserMedia
      if (typeof gu !== 'function') return { kind: 'microphone' as const, supported: false, granted: false }
      try {
        const stream = await gu({ audio: true })
        stream.getTracks().forEach((t) => t.stop())
        return { kind: 'microphone' as const, supported: true, granted: true }
      } catch {
        return { kind: 'microphone' as const, supported: true, granted: false }
      }
    },
    // ★能力颗粒度对齐：web 相机操作（诚实 Err——拍照/录像需 canvas/MediaRecorder 后续批次）
    createCameraContext: () => {
      const noWeb = <T,>(op: string): Promise<CapResult<T>> => Promise.resolve(capErr<T>('camera.unsupported', 'Web 端相机 ' + op + ' 未实现（需 canvas/MediaRecorder，后续批次）'))
      return {
        takePhoto: () => noWeb<PhotoResult>('takePhoto'),
        startRecord: () => noWeb<void>('startRecord'),
        stopRecord: () => noWeb<VideoResult>('stopRecord'),
        setZoom: () => noWeb<void>('setZoom'),
        onCameraFrame: () => () => {},
      }
    },
    getRecorder: () => {
      const noWeb = <T,>(op: string): Promise<CapResult<T>> => Promise.resolve(capErr<T>('microphone.unsupported', 'Web 端录音 ' + op + ' 未实现（需 MediaRecorder，后续批次）'))
      return {
        start: () => noWeb<void>('start'),
        stop: () => noWeb<void>('stop'),
        pause: () => noWeb<void>('pause'),
        resume: () => noWeb<void>('resume'),
        on: () => () => {},
        onFrameRecorded: () => () => {},
      }
    },
    getKeyboard: () => {
      let info: KeyboardInfo = { height: 0, visible: false }
      const cbs: Array<(i: KeyboardInfo) => void> = []
      const vv = (g as { visualViewport?: { height?: number; addEventListener?: (t: string, cb: () => void) => void; removeEventListener?: (t: string, cb: () => void) => void } }).visualViewport
      const ih = (g as { innerHeight?: number }).innerHeight ?? 0
      if (vv && typeof vv.addEventListener === 'function') {
        const onresize = () => {
          const vh = vv.height ?? 0
          const visible = vh > 0 && vh < ih * 0.6
          info = { height: visible ? ih - vh : 0, visible }
          cbs.forEach((cb) => cb(info))
        }
        vv.addEventListener('resize', onresize)
      }
      return {
        info,
        onChange: (cb) => {
          cbs.push(cb)
          return () => {
            const i = cbs.indexOf(cb)
            if (i >= 0) cbs.splice(i, 1)
          }
        },
      }
    },
    // ★G-32 B3 七期：web 桥新增能力（background=visibilitychange / socket-task=WebSocket / cookie=document.cookie /
    //   face-id=WebAuthn；map / sms / iap / mini-program / data-channel / embedded / live / extension 无 web 标准 →
    //   缺省 undefined → Hook Err 诚实降级）
    getBackground: () => {
      const cbs: Array<(e: BackgroundEvent) => void> = []
      const doc = (g as { document?: { hidden?: boolean; addEventListener?: (t: string, cb: () => void) => void } }).document
      if (doc && typeof doc.addEventListener === 'function') {
        doc.addEventListener('visibilitychange', () => {
          cbs.forEach((cb) => cb({ type: doc.hidden ? 'enter-background' : 'enter-foreground', time: Date.now() }))
        })
      }
      const sub = <T,>(add: unknown, event: string, cb: (r: T) => void): (() => void) => {
        if (typeof add !== 'function') return () => {}
        const h = (e: unknown): void => cb(e as T)
        ;(add as (t: string, c: (e: unknown) => void) => void)(event, h)
        return () => {}
      }
      const w = g as { addEventListener?: unknown }
      const win = (g as { window?: { addEventListener?: unknown; getLaunchOptions?: () => Record<string, unknown> } }).window
      return {
        onEvent: (cb) => {
          cbs.push(cb)
          return () => {
            const i = cbs.indexOf(cb)
            if (i >= 0) cbs.splice(i, 1)
          }
        },
        onMemoryWarning: () => () => {},
        onThemeChange: (cb) => {
          const mm = (g as { matchMedia?: (q: string) => { matches: boolean; addEventListener?: (t: string, c: (e: { matches: boolean }) => void) => void } }).matchMedia
          if (typeof mm !== 'function') return () => {}
          const mql = mm('(prefers-color-scheme: dark)')
          if (mql.addEventListener) mql.addEventListener('change', (e) => cb(e.matches ? 'dark' : 'light'))
          return () => {}
        },
        onWindowResize: (cb) => {
          const add = (win && win.addEventListener) || w.addEventListener
          if (typeof add !== 'function') return () => {}
          const h = (): void => cb({ windowWidth: (g as { innerWidth?: number }).innerWidth ?? 0, windowHeight: (g as { innerHeight?: number }).innerHeight ?? 0 })
          ;(add as (t: string, c: () => void) => void)('resize', h)
          return () => {}
        },
        onError: (cb) => sub<string | ErrorEvent>(w.addEventListener, 'error', (e) => cb(String((e as { message?: string })?.message ?? e))),
        onUnhandledRejection: (cb) => sub<PromiseRejectionEvent>(w.addEventListener, 'unhandledrejection', (e) => cb({ reason: String((e as { reason?: unknown })?.reason ?? ''), promise: (e as { promise?: Promise<unknown> })?.promise ?? Promise.resolve() })),
        onNetworkStatusChange: (cb) => {
          const add = (g as { addEventListener?: unknown }).addEventListener
          if (typeof add !== 'function') return () => {}
          const h = (): void => cb({ isConnected: (g as { navigator?: { onLine?: boolean } }).navigator?.onLine !== false, networkType: 'unknown' })
          ;(add as (t: string, c: () => void) => void)('online', h)
          ;(add as (t: string, c: () => void) => void)('offline', h)
          return () => {}
        },
        getLaunchOptions: async () => capErr<Record<string, unknown>>('background.unsupported', 'Web 端无启动参数对等'),
        getEnterOptions: async () => capErr<Record<string, unknown>>('background.unsupported', 'Web 端无进入参数对等'),
      }
    },
    // ★能力颗粒度对齐：C20 日历（web 无标准 → 诚实 Err）
    getCalendar: () => ({
      add: () => Promise.resolve(capErr<void>('calendar.unsupported', 'Web 端无日历写入对等')),
      remove: () => Promise.resolve(capErr<void>('calendar.unsupported', 'Web 端无日历删除对等')),
      list: () => Promise.resolve(capErr<CalendarEvent[]>('calendar.unsupported', 'Web 端无日历查询对等')),
    }),
    createSocketTask: (url) => {
      const WS = (g as { WebSocket?: new (u: string) => unknown }).WebSocket
      if (typeof WS !== 'function') throw new CapError('socket-task.unsupported', 'WebSocket 不支持')
      const ws = new WS(url) as {
        send?: (d: string) => void
        close?: (code?: number, reason?: string) => void
        addEventListener?: (t: string, cb: (e?: unknown) => void) => void
        removeEventListener?: (t: string, cb: (e?: unknown) => void) => void
      }
      let connected = false
      const messageCbs: Array<(data: string) => void> = []
      ws.addEventListener?.('open', () => (connected = true))
      ws.addEventListener?.('message', (e) => {
        const payload = e ? (e as { data?: unknown }).data : ''
        const data = typeof payload === 'string' ? payload : ''
        messageCbs.forEach((cb) => cb(data))
      })
      return {
        send: (data) =>
          new Promise<void>((resolve, reject) => {
            if (!ws.send) return reject(new CapError('socket-task.unsupported', 'WebSocket.send 缺失'))
            ws.send(data)
            resolve()
          }),
        close: (code, reason) =>
          new Promise<void>((resolve, reject) => {
            if (!ws.close) return reject(new CapError('socket-task.unsupported', 'WebSocket.close 缺失'))
            ws.close(code, reason)
            resolve()
          }),
        onMessage: (cb) => {
          messageCbs.push(cb)
          return () => {
            const i = messageCbs.indexOf(cb)
            if (i >= 0) messageCbs.splice(i, 1)
          }
        },
        isConnected: () => connected,
      }
    },
    getCookieJar: () => {
      const doc = (g as { document?: { cookie?: string } }).document
      const readAll = (): Record<string, string> => {
        const out: Record<string, string> = {}
        if (doc && typeof doc.cookie === 'string') {
          for (const part of doc.cookie.split(';')) {
            const idx = part.indexOf('=')
            if (idx > 0) {
              const name = part.slice(0, idx).trim()
              const value = part.slice(idx + 1).trim()
              if (name) out[name] = decodeURIComponent(value)
            }
          }
        }
        return out
      }
      return {
        get: (name) => readAll()[name],
        set: (name, value, maxAge) => {
          if (doc) doc.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}` + (maxAge !== undefined ? `; max-age=${maxAge}` : '') + '; path=/'
        },
        remove: (name) => {
          if (doc) doc.cookie = `${encodeURIComponent(name)}=; max-age=0; path=/`
        },
        list: () => readAll(),
      }
    },
    // ★颗粒度对齐 C3：web 相册 / Worker
    getAlbum: () => ({
      pick: (options) =>
        new Promise<CapResult<MediaFile[]>>((resolve) => {
          const doc = (g as { document?: { createElement?: (t: string) => HTMLInputElement } }).document
          if (!doc || typeof doc.createElement !== 'function') return resolve(capErr('album.unsupported', 'Web 无 DOM 环境（SSR）——相册选择不可用'))
          const input = doc.createElement('input')
          input.type = 'file'
          input.accept = options?.mediaType === 'video' ? 'video/*' : options?.mediaType === 'image' ? 'image/*' : 'image/*,video/*'
          if ((options?.count ?? 1) > 1) input.multiple = true
          input.onchange = () => {
            const files = Array.from(input.files ?? [])
            if (!files.length) return resolve(capErr('album.cancelled', '未选择文件'))
            const urls = (g as { URL?: { createObjectURL?: (f: unknown) => string } }).URL
            resolve(
              capOk(
                files.slice(0, options?.count ?? 1).map((f) => ({
                  tempFilePath: urls && typeof urls.createObjectURL === 'function' ? urls.createObjectURL(f) : '',
                  type: (f.type.startsWith('video') ? 'video' : 'image') as MediaFile['type'],
                  size: f.size,
                })),
              ),
            )
          }
          input.click()
        }),
      saveImage: () => Promise.resolve(capErr<void>('album.unsupported', 'Web 无系统相册写入标准 API（可用 <a download> 替代）')),
      saveVideo: () => Promise.resolve(capErr<void>('album.unsupported', 'Web 无系统相册写入标准 API（可用 <a download> 替代）')),
      preview: () => Promise.resolve(capErr<void>('album.unsupported', 'Web 预览由宿主组件承载（lightbox），无标准 API')),
    }),
    createWorker: (scriptPath) => {
      const W = (g as { Worker?: new (p: string) => Worker }).Worker
      if (typeof W !== 'function') throw new CapError('worker.unsupported', 'Web Worker 不可用（SSR 或受限环境）')
      const w = new W(scriptPath)
      return {
        postMessage: (message) => w.postMessage(message),
        onMessage: (cb) => {
          const h = (e: MessageEvent): void => cb(e.data)
          w.addEventListener('message', h as EventListener)
          return () => w.removeEventListener('message', h as EventListener)
        },
        terminate: () => w.terminate(),
      }
    },
    authenticateFaceID: async (prompt) => {
      const cred = (g as { PublicKeyCredential?: unknown }).PublicKeyCredential
      if (typeof cred !== 'function') return false
      const creds = nav?.credentials
      if (!creds || typeof creds.get !== 'function') return false
      try {
        await creds.get({
          publicKey: {
            challenge: new Uint8Array(32),
            rpId: typeof g.location === 'object' && g.location ? g.location.hostname || 'localhost' : 'localhost',
            userVerification: 'required',
            timeout: 60000,
          },
        })
        return true
      } catch {
        void prompt
        return false
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C57 画布（web HTMLCanvasElement + 标准 2D 上下文适配 / OffscreenCanvas）
    createCanvas: (id) => {
      const canvasId = id.replace(/^#/, '')
      const doc = (g as { document?: Document }).document
      let cached: HTMLCanvasElement | null = null
      const resolveEl = (): HTMLCanvasElement | null => {
        if (cached) return cached
        if (!doc || typeof doc.querySelector !== 'function') return null
        const byId = typeof doc.getElementById === 'function' ? doc.getElementById(canvasId) : null
        cached = (byId as HTMLCanvasElement | null) ?? (doc.querySelector(`#${canvasId}`) as HTMLCanvasElement | null) ?? (doc.querySelector(canvasId.startsWith('.') || canvasId.includes('[') ? canvasId : `canvas.${canvasId}`) as HTMLCanvasElement | null)
        return cached
      }
      const exportImage = (options?: CanvasExportOptions): Promise<CapResult<string>> => {
        const el = resolveEl()
        if (!el || typeof el.toDataURL !== 'function') return Promise.resolve(capErr<string>('canvas.unsupported', '未找到 canvas 元素（web 端需 id/选择器命中）'))
        const type = options?.fileType === 'jpg' ? 'image/jpeg' : 'image/png'
        const quality = options?.quality
        // 裁剪导出：有源区域参数且元素可用 drawImage 时走离屏重绘
        const wantCrop = options && (options.x || options.y || options.width || options.height || options.destWidth || options.destHeight)
        if (wantCrop && typeof doc?.createElement === 'function') {
          try {
            const w = options?.destWidth ?? options?.width ?? el.width
            const h = options?.destHeight ?? options?.height ?? el.height
            const off = doc.createElement('canvas')
            off.width = w
            off.height = h
            const octx = off.getContext('2d')
            if (octx) {
              octx.drawImage(el, options?.x ?? 0, options?.y ?? 0, options?.width ?? el.width, options?.height ?? el.height, 0, 0, w, h)
              return Promise.resolve(capOk(off.toDataURL(type, quality)))
            }
          } catch (e) {
            return Promise.resolve(capErr<string>('canvas.export-failed', '导出画布失败', e))
          }
        }
        try {
          return Promise.resolve(capOk(el.toDataURL(type, quality)))
        } catch (e) {
          return Promise.resolve(capErr<string>('canvas.export-failed', '导出画布失败（可能被跨域图片污染）', e))
        }
      }
      return {
        id: canvasId,
        createContext: () => {
          const el = resolveEl()
          if (!el || typeof el.getContext !== 'function') return capErr<CanvasContext>('canvas.unsupported', '未找到 canvas 元素（web 端需 id/选择器命中）')
          const ctx = el.getContext('2d') as CanvasRenderingContext2D | null
          if (!ctx) return capErr<CanvasContext>('canvas.unsupported', 'getContext(2d) 返回空')
          let lineDash: number[] = []
          const applyDash = (): void => {
            if (typeof (ctx as { setLineDash?: (p: number[]) => void }).setLineDash === 'function') ctx.setLineDash(lineDash)
          }
          return capOk({
            setFillStyle: (c) => { ctx.fillStyle = c },
            setStrokeStyle: (c) => { ctx.strokeStyle = c },
            setLineWidth: (w) => { ctx.lineWidth = w },
            setLineCap: (v) => { ctx.lineCap = v },
            setLineJoin: (v) => { ctx.lineJoin = v },
            setMiterLimit: (v) => { ctx.miterLimit = v },
            setGlobalAlpha: (a) => { ctx.globalAlpha = a },
            setShadow: (x, y, b, c) => { ctx.shadowOffsetX = x; ctx.shadowOffsetY = y; ctx.shadowBlur = b; if (c) ctx.shadowColor = c },
            setLineDash: (p, o) => { lineDash = o ? [o, ...p] : p; applyDash() },
            setFontSize: (s) => {
              const cur = ctx.font || '10px sans-serif'
              ctx.font = cur.replace(/^\d+(\.\d+)?px/, `${s}px`)
              if (!/px/.test(ctx.font)) ctx.font = `${s}px sans-serif`
            },
            setTextAlign: (v) => { ctx.textAlign = v },
            setTextBaseline: (v) => { ctx.textBaseline = v === 'normal' ? 'alphabetic' : v },
            setTransform: (a, b, c, d, e, f) => ctx.setTransform(a, b, c, d, e, f),
            save: () => ctx.save(),
            restore: () => ctx.restore(),
            translate: (x, y) => ctx.translate(x, y),
            rotate: (r) => ctx.rotate(r),
            scale: (x, y) => ctx.scale(x, y),
            beginPath: () => ctx.beginPath(),
            closePath: () => ctx.closePath(),
            moveTo: (x, y) => ctx.moveTo(x, y),
            lineTo: (x, y) => ctx.lineTo(x, y),
            arc: (x, y, r, s, e, cc) => ctx.arc(x, y, r, s, e, cc),
            arcTo: (x1, y1, x2, y2, r) => ctx.arcTo(x1, y1, x2, y2, r),
            quadraticCurveTo: (cpx, cpy, x, y) => ctx.quadraticCurveTo(cpx, cpy, x, y),
            bezierCurveTo: (a, b, c, d, e, f) => ctx.bezierCurveTo(a, b, c, d, e, f),
            rect: (x, y, w, h) => ctx.rect(x, y, w, h),
            fill: () => ctx.fill(),
            stroke: () => ctx.stroke(),
            clip: () => ctx.clip(),
            fillRect: (x, y, w, h) => ctx.fillRect(x, y, w, h),
            strokeRect: (x, y, w, h) => ctx.strokeRect(x, y, w, h),
            clearRect: (x, y, w, h) => ctx.clearRect(x, y, w, h),
            fillText: (t, x, y, mw) => (mw === undefined ? ctx.fillText(t, x, y) : ctx.fillText(t, x, y, mw)),
            measureText: (t) => {
              const m = ctx.measureText(t)
              return { width: m.width, height: (m as { actualBoundingBoxAscent?: number }).actualBoundingBoxAscent }
            },
            drawImage: (img, ...args) => {
              // 对齐官方重载：3 参（dx,dy）/ 5 参（dx,dy,dw,dh）/ 9 参（裁剪）；字符串路径 web 端不支持同步绘制
              if (typeof img === 'string') return
              const i = img as CanvasImageSource
              if (args.length === 2) ctx.drawImage(i, args[0], args[1])
              else if (args.length === 4) ctx.drawImage(i, args[0], args[1], args[2], args[3])
              else if (args.length === 8) ctx.drawImage(i, args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7])
            },
            createLinearGradient: (x0, y0, x1, y1) => ctx.createLinearGradient(x0, y0, x1, y1),
            createCircularGradient: (x, y, r) => ctx.createRadialGradient(x, y, 0, x, y, r),
            createPattern: (img, rep) => (typeof img === 'string' ? null : ctx.createPattern(img as CanvasImageSource, rep)),
            draw: (reserve, cb) => {
              // web 即时绘制——无异步提交；回调对齐 wx 的 draw 完成语义
              const done = typeof reserve === 'function' ? reserve : cb
              if (done) done()
            },
          })
        },
        node: () => {
          const el = resolveEl()
          if (!el) return Promise.resolve(capErr<CanvasNode>('canvas.unsupported', '未找到 canvas 元素（web 端需 id/选择器命中）'))
          const raf = (g as { requestAnimationFrame?: (cb: (t: number) => void) => number }).requestAnimationFrame
          const caf = (g as { cancelAnimationFrame?: (h: number) => void }).cancelAnimationFrame
          return Promise.resolve(capOk({
            width: el.width,
            height: el.height,
            getContext: (t: '2d' | 'webgl') => el.getContext(t),
            requestAnimationFrame: raf ? (cb) => raf(cb) : undefined,
            cancelAnimationFrame: caf ? (h) => caf(h) : undefined,
          }))
        },
        toTempFilePath: exportImage,
        toDataURL: exportImage,
        offscreen: (width, height, type = '2d') => {
          const OC = (g as { OffscreenCanvas?: new (w: number, h: number) => { width: number; height: number; getContext: (t: string) => unknown } }).OffscreenCanvas
          if (typeof OC === 'function') {
            const off = new OC(width, height)
            return capOk({ width: off.width, height: off.height, getContext: (t: '2d' | 'webgl') => off.getContext(t) as CanvasContext | null })
          }
          if (doc && typeof doc.createElement === 'function') {
            const el = doc.createElement('canvas')
            el.width = width
            el.height = height
            return capOk({ width, height, getContext: (t: '2d' | 'webgl') => (el.getContext(t) as unknown) as CanvasContext | null })
          }
          return capErr<OffscreenCanvasHandle>('canvas.unsupported', 'Web 无 OffscreenCanvas 且无 document（SSR）')
        },
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C58 元素查询（web querySelector + getBoundingClientRect）
    createElementQuery: (id) => {
      const doc = (g as { document?: Document }).document
      const norm = (sel?: string): string => {
        const s = sel ?? id ?? ''
        return s.startsWith('#') || s.includes('.') || s.includes('[') ? s : s ? '#' + s : ''
      }
      const pick = (sel?: string): Element | null => {
        if (!doc || typeof doc.querySelector !== 'function') return null
        const s = norm(sel)
        if (!s) return null
        try {
          return doc.querySelector(s)
        } catch {
          return null
        }
      }
      const rectOf = (el: Element): ElementRect => {
        const r = el.getBoundingClientRect()
        return { id: (el as HTMLElement).id || undefined, dataset: (el as HTMLElement).dataset as unknown as Record<string, unknown>, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
      }
      return {
        boundingClientRect: (selector) => {
          const el = pick(selector)
          if (!el) return Promise.resolve(capErr<ElementRect>('element.not-found', '未找到元素（web 端需 id/选择器命中）'))
          return Promise.resolve(capOk(rectOf(el)))
        },
        scrollOffset: (selector) => {
          const el = pick(selector)
          if (!el) return Promise.resolve(capErr<ElementScrollOffset>('element.not-found', '未找到元素（web 端需 id/选择器命中）'))
          const h = el as HTMLElement
          return Promise.resolve(capOk({ id: h.id || undefined, dataset: h.dataset as unknown as Record<string, unknown>, scrollTop: h.scrollTop ?? 0, scrollLeft: h.scrollLeft ?? 0 }))
        },
        fields: (options, selector) => {
          const el = pick(selector)
          if (!el) return Promise.resolve(capErr<ElementFieldsResult>('element.not-found', '未找到元素（web 端需 id/选择器命中）'))
          const h = el as HTMLElement
          const r = h.getBoundingClientRect()
          const out: ElementFieldsResult = { id: h.id || undefined, dataset: h.dataset as unknown as Record<string, unknown> }
          if (options.node) out.node = { width: (h as HTMLCanvasElement).width ?? Math.round(r.width), height: (h as HTMLCanvasElement).height ?? Math.round(r.height), getContext: (t: string) => (h as HTMLCanvasElement).getContext?.(t as '2d') }
          if (options.rect || options.size) {
            out.left = r.left; out.top = r.top; out.right = r.right; out.bottom = r.bottom; out.width = r.width; out.height = r.height
          }
          if (options.scrollOffset) {
            out.scrollTop = h.scrollTop ?? 0; out.scrollLeft = h.scrollLeft ?? 0
          }
          if (options.computedStyle && typeof g.getComputedStyle === 'function') {
            const cs = g.getComputedStyle(el)
            for (const key of options.computedStyle) out[camel(key)] = cs.getPropertyValue(key)
          }
          return Promise.resolve(capOk(out))
        },
        size: (selector) => {
          const el = pick(selector)
          if (!el) return Promise.resolve(capErr<{ width: number; height: number }>('element.not-found', '未找到元素（web 端需 id/选择器命中）'))
          const r = el.getBoundingClientRect()
          return Promise.resolve(capOk({ width: r.width, height: r.height }))
        },
        batch: (selectors) =>
          Promise.resolve(capOk(selectors.map((sel) => {
            const el = pick(sel)
            return el ? rectOf(el) : null
          }))),
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C59 交叉观察（web IntersectionObserver）
    createIntersection: (options) => {
      const IO = (g as { IntersectionObserver?: new (cb: (entries: unknown[]) => void, opts?: unknown) => { observe: (el: Element) => void; unobserve?: (el: Element) => void; disconnect: () => void } }).IntersectionObserver
      const callbacks = new Map<Element, (res: IntersectionResult) => void>()
      const io = typeof IO === 'function' ? new IO((entries) => {
        for (const ent of entries as Array<{ target: Element; intersectionRatio: number; time: number; intersectionRect: { left: number; top: number; right: number; bottom: number; width: number; height: number }; boundingClientRect: DOMRectReadOnly }>) {
          const cb = callbacks.get(ent.target)
          if (!cb) continue
          const b = ent.boundingClientRect
          cb({
            id: (ent.target as HTMLElement).id || undefined,
            dataset: (ent.target as HTMLElement).dataset as unknown as Record<string, unknown>,
            intersectionRatio: ent.intersectionRatio,
            intersectionRect: ent.intersectionRect,
            boundingClientRect: { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height },
            relativeRect: ent.intersectionRect,
            time: ent.time,
          })
        }
      }, { threshold: options?.thresholds ?? [0] }) : undefined
      const handle: IntersectionHandle = {
        relativeTo: (selector) => {
          // web IntersectionObserver 的 root 需在构造时确定；此处记录供自定义实现扩展（标准实现以视口为参照）
          const doc = (g as { document?: Document }).document
          doc?.querySelector?.(selector)
          return handle
        },
        relativeToViewport: () => handle,
        observe: (targetSelector, cb) => {
          const doc = (g as { document?: Document }).document
          const el = doc?.querySelector?.(targetSelector)
          if (!el || !io) return handle
          callbacks.set(el, cb)
          io.observe(el)
          return handle
        },
        disconnect: () => {
          callbacks.clear()
          io?.disconnect?.()
        },
      }
      return handle
    },
    // ★组件实例 API 对齐（2026-09-12）：C60 媒体查询（web matchMedia）
    createMediaQuery: () => {
      const mm = (g as { matchMedia?: (q: string) => MediaQueryList }).matchMedia
      const subs = new Set<{ mql: MediaQueryList; cb: (r: MediaQueryResult) => void; h: () => void }>()
      return {
        observe: (condition, cb) => {
          const query = conditionToQuery(condition)
          if (typeof mm !== 'function' || !query) {
            cb({ matches: false })
            return
          }
          const mql = mm(query)
          const h = (): void => cb({ matches: mql.matches })
          mql.addEventListener?.('change', h)
          subs.add({ mql, cb, h })
          cb({ matches: mql.matches })
        },
        disconnect: () => {
          for (const s of subs) s.mql.removeEventListener?.('change', s.h)
          subs.clear()
        },
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C61 视频控制器（web HTMLVideoElement）
    createVideo: (id) => {
      const doc = (g as { document?: Document }).document
      const el = doc?.getElementById?.(id.replace(/^#/, '')) as HTMLVideoElement | null
      const run = (op: string, fn: () => unknown): Promise<CapResult<void>> =>
        new Promise<CapResult<void>>((resolve) => {
          if (!el) return resolve(capErr<void>('video.not-found', '未找到 <video> 元素（web 端需 id 命中）'))
          try {
            const r = fn()
            // play() 返回 Promise
            if (r && typeof (r as Promise<void>).then === 'function') return void (r as Promise<void>).then(() => resolve(capOk(undefined)), (e) => resolve(capErr<void>('video.failed', '视频 ' + op + ' 失败', e)))
            resolve(capOk(undefined))
          } catch (e) {
            resolve(capErr<void>('video.failed', '视频 ' + op + ' 失败', e))
          }
        })
      const evMap: Record<string, string> = { play: 'play', pause: 'pause', ended: 'ended', timeupdate: 'timeupdate', error: 'error', fullscreenchange: 'fullscreenchange' }
      return {
        play: () => run('play', () => el?.play()),
        pause: () => run('pause', () => el?.pause()),
        stop: () => run('stop', () => { if (el) { el.pause(); el.currentTime = 0 } }),
        seek: (position) => run('seek', () => { if (el) el.currentTime = position }),
        playbackRate: (rate) => run('playbackRate', () => { if (el) el.playbackRate = rate }),
        requestFullScreen: () => run('fullscreen', () => el?.requestFullscreen?.()),
        exitFullScreen: () => run('exitFullScreen', () => doc?.exitFullscreen?.()),
        sendDanmu: () => Promise.resolve(capErr<void>('video.unsupported', 'Web 无弹幕标准 API（由宿主视图承载）')),
        on: (event, cb) => {
          if (!el) return () => {}
          const h = (e: Event): void => cb(e)
          el.addEventListener(evMap[event] ?? event, h)
          return () => el.removeEventListener(evMap[event] ?? event, h)
        },
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C62 音频控制器（web Audio 元素）
    createAudio: (src) => {
      const A = (g as { Audio?: new (src?: string) => HTMLAudioElement }).Audio
      if (typeof A !== 'function') throw new CapError('audio.unsupported', 'web Audio 不可用（SSR/受限环境）')
      const el = new A(src)
      const run = (op: string, fn: () => unknown): Promise<CapResult<void>> =>
        new Promise<CapResult<void>>((resolve) => {
          try {
            const r = fn()
            if (r && typeof (r as Promise<void>).then === 'function') return (r as Promise<void>).then(() => resolve(capOk(undefined)), (e) => resolve(capErr<void>('audio.failed', '音频 ' + op + ' 失败', e)))
            resolve(capOk(undefined))
          } catch (e) {
            resolve(capErr<void>('audio.failed', '音频 ' + op + ' 失败', e))
          }
        })
      return {
        play: (s) => { if (s) el.src = s; return run('play', () => el.play()) },
        pause: () => run('pause', () => el.pause()),
        stop: () => run('stop', () => { el.pause(); el.currentTime = 0 }),
        seek: (position) => run('seek', () => { el.currentTime = position }),
        setVolume: (v) => { el.volume = v },
        setLoop: (v) => { el.loop = v },
        get currentTime() { return el.currentTime },
        get duration() { return el.duration || 0 },
        get paused() { return el.paused },
        destroy: () => { try { el.pause(); el.src = '' } catch { /* noop */ } },
        on: (event, cb) => {
          const map: Record<string, string> = { canplay: 'canplay', play: 'play', pause: 'pause', stop: 'pause', ended: 'ended', timeupdate: 'timeupdate', error: 'error' }
          const h = (e: Event): void => cb(e)
          el.addEventListener(map[event] ?? event, h)
          return () => el.removeEventListener(map[event] ?? event, h)
        },
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C63 直播推流（web 无标准 → 各方法 Err 诚实降级）
    createLivePusher: () => {
      const noWeb = <T,>(op: string): Promise<CapResult<T>> => Promise.resolve(capErr<T>('live-pusher.unsupported', 'Web 无标准推流 API（' + op + ' 需宿主桥承载）'))
      return {
        start: () => noWeb<void>('start'),
        stop: () => noWeb<void>('stop'),
        pause: () => noWeb<void>('pause'),
        resume: () => noWeb<void>('resume'),
        switchCamera: () => noWeb<void>('switchCamera'),
        toggleTorch: () => noWeb<void>('toggleTorch'),
        snapshot: () => noWeb<string>('snapshot'),
        sendMessage: () => noWeb<void>('sendMessage'),
        on: () => () => {},
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C64 广告（web 无广告联盟标准 → 创建时 throw）
    getAd: () => ({
      rewardedVideo: () => { throw new CapError('ad.unsupported', 'Web 无广告联盟标准 API（需宿主接入自建广告桥）') },
      interstitial: () => { throw new CapError('ad.unsupported', 'Web 无广告联盟标准 API（需宿主接入自建广告桥）') },
      banner: () => { throw new CapError('ad.unsupported', 'Web 无广告联盟标准 API（需宿主接入自建广告桥）') },
    }),
    // ★权威标尺缺口 C65：隐私协议（web 无微信隐私协议标准 → 各方法 Err 诚实降级；Cookie 同意由宿主自建）
    getPrivacy: () => {
      const noWeb = <T,>(op: string): Promise<CapResult<T>> => Promise.resolve(capErr<T>('privacy.unsupported', 'Web 无微信隐私协议标准 API（' + op + ' 由宿主自建 Cookie 同意/协议页）'))
      return {
        getSetting: () => noWeb<PrivacySetting>('getSetting'),
        openContract: () => noWeb<void>('openContract'),
        requireAuthorize: () => noWeb<boolean>('requireAuthorize'),
        onNeedAuthorization: () => () => {},
      }
    },
    // ★权威标尺缺口 C66：性能（web performance.getEntries* 承接条目读取；上报无对等后端 → Err）
    getPerformance: () => {
      const perf = (g as { performance?: Performance }).performance
      const webType = (t?: string): string => (t === 'navigation' || t === 'render' || t === 'script' ? 'resource' : t ?? '')
      const toEntry = (e: PerformanceEntry): PerformanceEntry => ({ name: e.name, entryType: e.entryType as PerformanceEntry['entryType'], duration: e.duration, startTime: e.startTime })
      return {
        getEntries: (entryType) =>
          Promise.resolve().then(() => {
            if (!perf || (typeof perf.getEntriesByType !== 'function' && typeof perf.getEntries !== 'function')) return capErr<PerformanceEntry[]>('performance.unsupported', 'web performance API 不可用')
            if (entryType && typeof perf.getEntriesByType === 'function') {
              return capOk(perf.getEntriesByType(webType(entryType)).map((e) => toEntry(e as unknown as PerformanceEntry)))
            }
            const list = typeof perf.getEntries === 'function' ? perf.getEntries() : []
            const filtered = entryType ? list.filter((e) => e.entryType === entryType) : list
            return capOk(filtered.map((e) => toEntry(e as unknown as PerformanceEntry)))
          }),
        getEntriesByName: (name, entryType) =>
          Promise.resolve().then(() => {
            if (!perf || typeof perf.getEntriesByName !== 'function') return capErr<PerformanceEntry[]>('performance.unsupported', 'web performance API 不可用')
            return capOk(perf.getEntriesByName(name, entryType ? webType(entryType) : undefined).map((e) => toEntry(e as unknown as PerformanceEntry)))
          }),
        createObserver: () => {
          const PO = (g as { PerformanceObserver?: new (cb: (list: { getEntries: () => PerformanceEntry[] }) => void) => { observe: (o: { entryTypes: string[] }) => void; disconnect: () => void } }).PerformanceObserver
          const holder: { obs?: { observe: (o: { entryTypes: string[] }) => void; disconnect: () => void } } = {}
          return {
            observe: (cb, entryTypes) => {
              if (typeof PO !== 'function') return
              holder.obs = new PO((list) => cb(list.getEntries().map((e) => toEntry(e as unknown as PerformanceEntry))))
              try {
                holder.obs.observe({ entryTypes: (entryTypes ?? ['resource', 'mark', 'measure']).map(webType) })
              } catch {
                /* 不支持的 entryType 忽略 */
              }
            },
            disconnect: () => holder.obs?.disconnect(),
          }
        },
        setBufferSize: () => {
          /* web 无缓冲区设置 */
        },
        report: () => Promise.resolve(capErr<void>('performance.unsupported', 'Web 无微信性能监控上报后端（report 需小程序平台）')),
      }
    },
    // ★权威标尺缺口 C67：预加载（web 无标准预加载 API → 各方法 Err 诚实降级；可用 <link rel=preload>/动态 import）
    getPreload: () => {
      const noWeb = <T,>(op: string): Promise<CapResult<T>> => Promise.resolve(capErr<T>('preload.unsupported', 'Web 无标准预加载 API（' + op + ' 可用 <link rel=preload> 或动态 import 替代）'))
      return {
        assets: () => noWeb<void>('assets'),
        skylineView: () => noWeb<void>('skylineView'),
        webview: () => noWeb<void>('webview'),
        subpackage: () => noWeb<PreDownloadTask>('subpackage'),
      }
    },
    // ★权威标尺缺口 C68：图像编辑（web 无微信编辑 UI → Err 诚实降级；可用 canvas 自实现裁剪）
    getImageEdit: () => {
      const noWeb = <T,>(op: string): Promise<CapResult<T>> => Promise.resolve(capErr<T>('image-edit.unsupported', 'Web 无微信图像编辑 UI（' + op + ' 可用 canvas 自实现）'))
      return {
        crop: () => noWeb<string>('crop'),
        edit: () => noWeb<string>('edit'),
      }
    },
    // ★权威标尺缺口 C69：网络底层（web 浏览器不支持裸 UDP/TCP → Err 诚实降级；可用 WebSocket/WebRTC）
    getSocket: () => {
      const noUdp = (): never => {
        throw new CapError('socket.unsupported', 'Web 浏览器不支持裸 UDP（可用 WebRTC DataChannel 或宿主桥）')
      }
      const noTcp = (): never => {
        throw new CapError('socket.unsupported', 'Web 浏览器不支持裸 TCP（可用 WebSocket 或宿主桥）')
      }
      return { udp: noUdp, tcp: noTcp }
    },
    // ★权威标尺缺口 C70：媒体高级（web：VideoDecoder 走 WebCodecs；container/audioPlayer 无标准 → 创建时 throw）
    getMediaProcessing: () => ({
      container: () => {
        throw new CapError('media-processing.unsupported', 'Web 无标准媒体合成容器（可用 WebCodecs + canvas 编排）')
      },
      audioPlayer: () => {
        throw new CapError('media-processing.unsupported', 'Web 无标准多音源混音播放器（可用 WebAudio）')
      },
      videoDecoder: () => {
        const VD = (g as { VideoDecoder?: new (init: unknown) => { configure: (c: unknown) => void; decode: (chunk: unknown) => void; flush: () => Promise<void>; close: () => void } }).VideoDecoder
        // ★诚实边界：WebCodecs VideoDecoder 需要 EncodedVideoChunk（需 demux 层），此处给「能力可用但需宿主配合」的诚实句柄
        return {
          start: () =>
            Promise.resolve().then(() => {
              if (typeof VD !== 'function') return capErr<void>('media-processing.unsupported', 'Web 无 WebCodecs VideoDecoder')
              return capOk(undefined)
            }),
          getFrameData: () =>
            Promise.resolve(capErr<{ data: ArrayBuffer; width?: number; height?: number }>('media-processing.unsupported', 'Web 端需 EncodedVideoChunk（demux 由宿主/库提供）——getFrameData 无直通')),
          seek: () => Promise.resolve(capErr<void>('media-processing.unsupported', 'Web 端 seek 需宿主 demux 支持')),
          stop: () => Promise.resolve(capOk(undefined)),
        }
      },
    }),
    // ★权威标尺缺口 C71：录屏/截屏（web 无标准 → Err；MediaDevices.getDisplayMedia 仅支持用户主动共享探测）
    getScreenCapture: () => {
      const noWeb = <T,>(op: string): Promise<CapResult<T>> => Promise.resolve(capErr<T>('screen-capture.unsupported', 'Web 无标准录屏状态 API（' + op + ' 需宿主/平台支持）'))
      return {
        getRecordingState: () => noWeb<'on' | 'off'>('getRecordingState'),
        onRecordingStateChange: () => () => {},
        onUserCapture: () => () => {},
        isPictureInPictureActive: () =>
          Promise.resolve().then(() => {
            const doc = (g as { document?: Document }).document
            if (doc && typeof (doc as { pictureInPictureElement?: unknown }).pictureInPictureElement !== 'undefined') {
              return capOk(Boolean((doc as { pictureInPictureElement?: unknown }).pictureInPictureElement))
            }
            return capErr<boolean>('screen-capture.unsupported', 'Web 无画中画状态 API（document.pictureInPictureElement 不可用）')
          }),
      }
    },
    // ★权威标尺缺口 C72：缓存管理（web 无对等 → 创建时 throw；可用 Service Worker/Cache Storage）
    createCacheManager: () => {
      throw new CapError('cache-manager.unsupported', 'Web 无微信请求缓存管理器（可用 Service Worker / Cache Storage）')
    },
    // ★权威标尺缺口 C73：空闲调度（web requestIdleCallback；Safari 缺省 → setTimeout 兜底）
    getIdle: () => {
      const ric = (g as { requestIdleCallback?: (cb: (d: { timeRemaining: () => number; didTimeout: boolean }) => void, o?: { timeout?: number }) => number }).requestIdleCallback
      const cic = (g as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback
      return {
        request: (cb, timeout) =>
          Promise.resolve().then(() => {
            if (typeof ric === 'function') {
              const id = ric((d) => cb({ timeRemaining: () => d.timeRemaining(), didTimeout: d.didTimeout }), timeout !== undefined ? { timeout } : undefined)
              return capOk(id)
            }
            // 兜底：setTimeout（deadline.timeRemaining 恒 0）
            const st = (g as { setTimeout?: (fn: () => void, ms?: number) => number }).setTimeout
            if (typeof st !== 'function') return capErr<number>('idle.unsupported', 'web 无 requestIdleCallback/setTimeout')
            const id = st(() => cb({ timeRemaining: () => 0, didTimeout: false }), timeout ?? 0)
            return capOk(id as unknown as number)
          }),
        cancel: (id) =>
          Promise.resolve().then(() => {
            if (typeof cic === 'function') {
              cic(id)
              return capOk(undefined)
            }
            const ct = (g as { clearTimeout?: (id: number) => void }).clearTimeout
            if (typeof ct === 'function') {
              ct(id)
              return capOk(undefined)
            }
            return capErr<void>('idle.unsupported', 'web 无 cancelIdleCallback/clearTimeout')
          }),
      }
    },
    // ★权威标尺缺口 C74：窗口（web 无标准 setWindowSize → Err）
    getWindow: () => ({
      setSize: () => Promise.resolve(capErr<void>('window.unsupported', 'Web 无标准窗口尺寸设置 API（window.resizeTo 仅限弹出窗口）')),
    }),
    // ★权威标尺缺口 C75：导航卸载拦截（web beforeunload 承接）
    getNavigationGuard: () => {
      const handlerRef: { h?: (e: BeforeUnloadEvent) => void } = {}
      type WinLike = { addEventListener?: (t: string, h: (e: BeforeUnloadEvent) => void) => void; removeEventListener?: (t: string, h: (e: BeforeUnloadEvent) => void) => void }
      const win = (g as WinLike & { window?: WinLike })
      const target: WinLike = typeof win.addEventListener === 'function' ? win : (win.window ?? win)
      return {
        enable: (message) =>
          Promise.resolve().then(() => {
            if (typeof target.addEventListener !== 'function') return capErr<void>('navigation-guard.unsupported', 'web 无 beforeunload 事件')
            handlerRef.h = (e) => {
              e.preventDefault()
              e.returnValue = message
            }
            target.addEventListener('beforeunload', handlerRef.h)
            return capOk(undefined)
          }),
        disable: () =>
          Promise.resolve().then(() => {
            if (handlerRef.h && typeof target.removeEventListener === 'function') target.removeEventListener('beforeunload', handlerRef.h)
            handlerRef.h = undefined
            return capOk(undefined)
          }),
      }
    },
    // ★权威标尺缺口 C76：AR/XR（web 无对等视觉算法 → createSession throw；isSupported 恒 false）
    getAR: () => ({
      createSession: () => {
        throw new CapError('ar.unsupported', 'Web 无微信视觉算法会话（可用 WebXR / 第三方 CV 库）')
      },
      isSupported: () => Promise.resolve(capOk(false)),
    }),
    // ★权威标尺缺口 C77：iBeacon（web 无对等 → 空订阅；可用 Web Bluetooth）
    getBeacon: () => ({
      onServiceChange: () => () => {},
      onUpdate: () => () => {},
    }),
    // ★权威标尺缺口 C78：局域网 mDNS（web 无标准 → 空订阅）
    getLocalService: () => ({
      onFound: () => () => {},
      onLost: () => () => {},
      onResolveFail: () => () => {},
      onDiscoveryStop: () => () => {},
    }),
    // ★权威标尺缺口 C79：翻译（web 无对等 → 空订阅；可用 Translation API）
    getTranslation: () => ({
      onTrigger: () => () => {},
      onOff: () => () => {},
    }),
    // ★权威标尺缺口 C80：分享海报（web 无对等 → 空订阅）
    getPoster: () => ({
      onGenerate: () => () => {},
    }),
    // ★权威标尺缺口 C81：设备能力探测（web MediaSource.isTypeSupported 兜底）
    getDeviceCapability: () => ({
      supportsHevc: () =>
        Promise.resolve().then(() => {
          const MS = (g as { MediaSource?: { isTypeSupported?: (t: string) => boolean } }).MediaSource
          if (MS && typeof MS.isTypeSupported === 'function') {
            return capOk(MS.isTypeSupported('video/mp4; codecs="hvc1"') || MS.isTypeSupported('video/mp4; codecs="hev1"'))
          }
          return capErr<boolean>('device-capability.unsupported', 'web 无 MediaSource.isTypeSupported')
        }),
    }),
    // ★C82 WASM（Web 端 / App-iOS JSC 同形）：标准 `WebAssembly`——收字节，compile/validate 齐备。
    //   ★App-iOS 走本分支的依据：JSC 内建标准 WebAssembly（本机+真机实测 validate(true) + add(2,40)=42）；
    //     ★App-Android 不走本分支：QuickJS 内建无 WASM ⇒ 由**宿主 wasm3** 提供（见 capability-app.ts
    //     的 getWebAssembly 宿主优先路径——真机实测同样跑出 42）。
    /** ★C47 跳其他小程序：Web 无等价（小程序平台概念）→ 诚实 Err */
    navigateMiniProgram: () =>
      Promise.reject(
        new CapError('mini-program.unsupported', 'Web 无"跳其他小程序"概念（该 API 属小程序平台）——Web 请用 window.open 或前端路由'),
      ),
    /** ★C48 宿主上下文（Web：provider=web + 可选构建版本 meta） */
    getHostContext: () => ({
      provider: 'web',
      version: (() => {
        try {
          const doc = (g as { document?: { querySelector?: (s: string) => { getAttribute?: (n: string) => string | null } | null } }).document
          const meta = doc?.querySelector?.('meta[name="proteus-build"]')
          return meta?.getAttribute?.('content') ?? undefined
        } catch {
          return undefined
        }
      })(),
      capabilities: ['share', 'clipboard', 'wasm', 'worker'],
    }),
    /** ★C50 扩展加载（Web：**动态 import** —— 真实实现；只接受模块 URL 形态） */
    loadExtension: (extensionId) => {
      const id = String(extensionId)
      // 安全边界：只接受相对/绝对路径或 http(s) URL —— 不接受裸标识符（避免任意解析）
      if (!/^(https?:|\/|\.\/|\.\.\/)/.test(id)) {
        return Promise.reject(
          new CapError(
            'extension.unsupported',
            `Web 端 loadExtension 只接受模块 URL（收到 ${id}）——请传 './ext/foo.js' 或 'https://…/foo.js'`,
          ),
        )
      }
      return import(/* @vite-ignore */ id)
    },
    /** ★C51 更新管理（Web：Service Worker 更新流；无 SW → 诚实 Err 且给出路） */
    getUpdateManager: () => {
      type SwReg = { installing?: unknown; waiting?: { postMessage?: (m: unknown) => void } }
      const sw = (g as { navigator?: { serviceWorker?: { getRegistration?: () => Promise<unknown> } } }).navigator?.serviceWorker
      const noSw = (): string =>
        'Web 无 Service Worker（未注册 SW 的站点无法运行时更新）——静态站点请用构建哈希/ETag 轮询'
      return {
        checkUpdate: () =>
          Promise.resolve()
            .then(async () => {
              if (!sw?.getRegistration) return capErr<{ hasUpdate: boolean }>('update.unsupported', noSw())
              const reg = (await sw.getRegistration()) as SwReg | undefined
              if (!reg) return capErr<{ hasUpdate: boolean }>('update.unsupported', noSw())
              return capOk({ hasUpdate: !!(reg.installing || reg.waiting) })
            })
            .catch((e) => capErr<{ hasUpdate: boolean }>('update.failed', '检查更新失败', e)),
        applyUpdate: () =>
          Promise.resolve()
            .then(async () => {
              if (!sw?.getRegistration) return capErr<void>('update.unsupported', noSw())
              const reg = (await sw.getRegistration()) as SwReg | undefined
              if (!reg?.waiting) {
                return capErr<void>('update.not-ready', '无等待中的新版本（applyUpdate 需 checkUpdate 报告 hasUpdate 后调用）')
              }
              // ★标准语义：向 waiting worker 发 skipWaiting ⇒ 新版本激活（页面 reload 后换装）
              reg.waiting.postMessage?.({ type: 'SKIP_WAITING' })
              return capOk(undefined)
            })
            .catch((e) => capErr<void>('update.failed', '应用更新失败', e)),
        // Web 无对应事件（SW updatefound 在 registration 级）——诚实空订阅
        onCheckForUpdate: () => () => undefined,
        onUpdateReady: () => () => undefined,
        onUpdateFailed: () => () => undefined,
      }
    },
    getWebAssembly: () => {
      const WASM = (g as { WebAssembly?: typeof WebAssembly }).WebAssembly
      if (!WASM) {
        // 环境无 WebAssembly（老浏览器 / 无 JS 引擎宿主）→ 能力位全 false，调用即 Err
        return {
          supportsStreaming: false,
          supportsPathLoad: false,
          instantiate: () =>
            Promise.resolve(capErr<WasmModuleHandle>('webassembly.unsupported', '当前环境无全局 WebAssembly')),
        }
      }
      return {
        supportsStreaming: true, // 标准 WebAssembly 接受 BufferSource（`instantiate(bytes)`）
        supportsPathLoad: false, // 标准入口不收代码包路径（MP 独有形态）
        instantiate: (source, options) => {
          if (!('bytes' in source)) {
            return Promise.resolve(
              capErr<WasmModuleHandle>(
                'webassembly.unsupported',
                'Web/App 端接受字节码（请传 { bytes }）；代码包路径是 MP 独有形态（WXWebAssembly）',
              ),
            )
          }
          const buf = source.bytes instanceof Uint8Array ? source.bytes : new Uint8Array(source.bytes)
          return WASM.instantiate(buf as unknown as BufferSource, options?.imports as WebAssembly.Imports | undefined)
            .then((res): CapResult<WasmModuleHandle> =>
              capOk({
                // instantiate(bytes) 返回 { module, instance }；这里统一取 instance.exports
                exports: ((res as { instance?: { exports: Record<string, unknown> } }).instance?.exports ?? {}) as Record<string, unknown>,
                fromPath: false,
                dispose: () => {
                  /* WASM 实例由 GC 回收——保留统一出口供未来池化 */
                },
              }),
            )
            .catch((e: unknown): CapResult<WasmModuleHandle> => capErr('webassembly.failed', 'WebAssembly.instantiate 失败', e))
        },
        compile: (bytes) =>
          Promise.resolve()
            .then(() => WASM.compile(bytes as unknown as BufferSource))
            .then((m): CapResult<unknown> => capOk(m))
            .catch((e: unknown): CapResult<unknown> => capErr('webassembly.failed', 'WebAssembly.compile 失败', e)),
        validate: (bytes) =>
          Promise.resolve()
            .then(() => {
              const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
              return capOk(WASM.validate(buf as unknown as BufferSource))
            })
            .catch((e: unknown): CapResult<boolean> => capErr('webassembly.failed', 'WebAssembly.validate 失败', e)),
      }
    },
  }
}

/** camelCase（computedStyle 键） */
function camel(k: string): string {
  return k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

/** 媒体查询条件 → media query 串（web matchMedia） */
function conditionToQuery(c: MediaQueryCondition): string {
  const parts: string[] = []
  if (c.minWidth !== undefined) parts.push(`(min-width: ${c.minWidth}px)`)
  if (c.maxWidth !== undefined) parts.push(`(max-width: ${c.maxWidth}px)`)
  if (c.width !== undefined) parts.push(`(width: ${c.width}px)`)
  if (c.minHeight !== undefined) parts.push(`(min-height: ${c.minHeight}px)`)
  if (c.maxHeight !== undefined) parts.push(`(max-height: ${c.maxHeight}px)`)
  if (c.height !== undefined) parts.push(`(height: ${c.height}px)`)
  if (c.orientation) parts.push(`(orientation: ${c.orientation})`)
  return parts.join(' and ')
}

/** params → query 拼接（useFetch） */
function encodedUrl(url: string, params?: Record<string, unknown>): string {
  if (!params) return url
  const qs = Object.keys(params)
    .filter((k) => params[k] !== undefined)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
    .join('&')
  if (!qs) return url
  return url + (url.includes('?') ? '&' : '?') + qs
}

/** 运行时探测（★SSOT：@proteus-vue/shared.detectRuntime——window 前置守卫）：
 *  真·小程序运行时 → wx 桥；否则 web 桥（含 web 上 @proteus-vue/web 的 wx 模拟层——不误选 wx 窄桥）
 *
 *  ★★NC1（2026-09-30）：**声明式能力桥**在此合并——手写桥先展开，再用生成物覆盖/补齐声明过的能力。
 *    · 合并顺序：手写在前、生成在后 ⇒ 声明是对该能力的**权威定义**（同一方法名以声明为准）；
 *    · 生成物为空时行为与合并前**完全一致**（`...(undefined)` 不改变对象）；
 *    · 覆盖能力数可由 `BRIDGE_DECLS.length` 断言（生成物含 `GENERATED_BRIDGE_COUNT` 供测试对账）。 */
/**
 * ★★安装页面/应用生命周期事件源（**必须在模块加载时调用**——不能等业务调 Hook）。
 *
 * 【为什么时序是关键（真机 e2e 抓出的实缺）】页面钩子（`Page.onShow/onHide/onReady…`）在
 *   **页面创建时**就触发，早于业务代码调用 `usePageLifecycle()`。若派发桥等到"首次调桥"才装，
 *   那么**首屏的 load/show/ready 事件全部丢失**（订阅者晚一步，早事件永久错过）。
 *   ⇒ 本函数在模块加载时立刻装（幂等），`createCapabilityBridge` 内也调一次（防外部先建桥的路径）。
 */
export function installLifecycleEventSources(): void {
  const g = globalThis as { wx?: WxLike }
  // App 宿主（壳注入标识）走壳事件；MP 走 wx 全局 API + 产物派发；Web 由 web 桥的 visibilitychange 自管
  const bus = getHostLifecycleBus()
  // ★★App 端（壳注入标识）：装**壳推通道**——`HostLifecycleEvents.forwardToJs` 消费。
  //   ★这里曾是**提前 return**（`if (detectAppHost()) return`），而那会让下面的
  //     `installAppEventSource` 在 App 端**永不执行**——恰恰是 App 端最需要的通道！
  //     （真机验证抓出：App 端 memory-warning/theme-change/resize 全丢）
  if (detectAppHost()) {
    installAppEventSource(bus)
    return
  }
  if (g.wx) {
    installWxAppEventBridge(bus, g.wx)
    installPageEmitBridge(bus)
  }
  // Web 端也装（壳推通道对 Web 无害；且 SSR/容器环境可能注入壳标识）
  installAppEventSource(bus)
}


// ★★模块加载即装（见函数注释：页面钩子早于业务调用——晚装会丢首屏事件）
installLifecycleEventSources()
