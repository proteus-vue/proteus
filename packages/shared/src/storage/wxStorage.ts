// packages/shared/src/storage/wxStorage.ts
// 微信小程序 Skyline 端存储（docs/proteus-pinia-plan M1 §2.3）
// 本模块是唯一允许直连 wx 存储 API 的存储实现（与 router/skyline.ts 同规则）
// ★小程序特有坑（真机归档）：
//   1. 主包体积：持久化数据占主包空间，大型播放列表建议拆云存储
//   2. 同步 API 阻塞：setStorageSync 在主线程，单次 >1MB 会卡 UI → 大对象分片
//   3. Skyline 逻辑层无 window/document：不可使用 Web-only 序列化库
//   4. storage 上限约 10MB：超限降级（警告不崩溃），读取失败返回 null
import type { StorageAdapter } from './types'

export class WxStorageAdapter implements StorageAdapter {
  constructor(private prefix = 'proteus:') {}

  async getItem(key: string): Promise<string | null> {
    try {
      if (typeof wx === 'undefined' || !wx.getStorageSync) return null
      const v = wx.getStorageSync(this.prefix + key)
      return v === '' || v === null || v === undefined ? null : String(v)
    } catch {
      // 存储满 / 主包过大等容错
      return null
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      if (typeof wx !== 'undefined' && wx.setStorageSync) {
        wx.setStorageSync(this.prefix + key, value)
      }
    } catch (err) {
      console.warn('[Proteus] wx.setStorageSync 失败（存储满？）', key, err)
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      if (typeof wx !== 'undefined' && wx.removeStorageSync) {
        wx.removeStorageSync(this.prefix + key)
      }
    } catch {
      // 容错
    }
  }

  async clear(prefix?: string): Promise<void> {
    const p = prefix ?? this.prefix
    try {
      if (typeof wx === 'undefined' || !wx.getStorageInfoSync) return
      const info = wx.getStorageInfoSync()
      for (const k of info.keys ?? []) {
        if (k.startsWith(p)) wx.removeStorageSync(k)
      }
    } catch {
      // 容错
    }
  }
}
