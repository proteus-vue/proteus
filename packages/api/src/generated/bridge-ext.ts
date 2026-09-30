// packages/api/src/generated/bridge-ext.ts
// ⚠️ **本文件由 `node scripts/gen-bridge-ext.mjs` 生成，勿手改**（`--check` 接门禁，漂移即红）
//
// 来源：`packages/api/src/bridge-decls/*.ts`（声明式能力定义——「声明一下接口」就是全部工作量）
// 判据：声明 → 生成 → 由 capability.ts **真实合并进 bridge**（生成物在运行路径上，不是摆设）

import type { CapabilityBridge, WxLike } from '../capability'
import type { BridgeErrorCtor } from '../bridge-decl'

/** 本文件覆盖的能力数（供门禁/测试断言"生成物非空且与声明同数"） */
export const GENERATED_BRIDGE_COUNT = 2

/** MP 侧：声明式生成的能力桥（由 createCapabilityBridge 合并进 wxBridge 结果） */
export function mpBridgeExt(wx: WxLike, CapErrorCtor: BridgeErrorCtor): Partial<CapabilityBridge> {
  return {
    // C83 useKeepScreenOn：屏幕常亮开关（MP wx.setKeepScreenOn / Web Screen Wake Lock）。Web 端需页面可见 + 安全上下文；隐藏时系统自动释放。
    setKeepScreenOn: (on: boolean) =>
      new Promise((resolve, reject) => {
        if (typeof wx.setKeepScreenOn !== 'function') return reject(new CapErrorCtor('screen.keep-on.unsupported', 'wx.setKeepScreenOn 缺失'))
        wx.setKeepScreenOn({
          keepScreenOn: on,
          success: () => resolve(),
          fail: (e: unknown) => reject(new CapErrorCtor('screen.keep-on.failed', 'wx.setKeepScreenOn 失败', e)),
        })
      }),
    // C84 useOpenDocument：文档预览（MP wx.openDocument / Web window.open）。★Web 诚实边界：PDF/图片/文本由浏览器内联预览，office 格式通常转为下载（取决于浏览器能力）；MP 需传平台临时文件路径（如 wxfile://…）。
    openDocument: (filePath: string) =>
      new Promise((resolve, reject) => {
        if (typeof wx.openDocument !== 'function') return reject(new CapErrorCtor('document.open.unsupported', 'wx.openDocument 缺失'))
        wx.openDocument({
          filePath: filePath,
          success: () => resolve(),
          fail: (e: unknown) => reject(new CapErrorCtor('document.open.failed', 'wx.openDocument 失败', e)),
        })
      }),
  }
}

/** Web 侧：声明式生成的能力桥（由 createCapabilityBridge 合并进 webBridge 结果） */
export function webBridgeExt(g: typeof globalThis, CapErrorCtor: BridgeErrorCtor): Partial<CapabilityBridge> {
  const nav = (g as { navigator?: { wakeLock?: { request(type?: string): Promise<unknown> } } }).navigator
  return {
    // C83 useKeepScreenOn：屏幕常亮开关（MP wx.setKeepScreenOn / Web Screen Wake Lock）。Web 端需页面可见 + 安全上下文；隐藏时系统自动释放。
    setKeepScreenOn: (() => {
      let sentinel: unknown = null
      return async (on: boolean) => {
        if (!(nav?.wakeLock)) throw new CapErrorCtor('screen.keep-on.unsupported', "Screen Wake Lock 不可用（需安全上下文 + 浏览器支持）")
        if (on) {
          if (sentinel) return
          sentinel = await nav.wakeLock.request('screen')
        } else {
          if (!sentinel) return
          await (sentinel as { release(): Promise<void> }).release()
          sentinel = null
        }
      }
    })(),
    // C84 useOpenDocument：文档预览（MP wx.openDocument / Web window.open）。★Web 诚实边界：PDF/图片/文本由浏览器内联预览，office 格式通常转为下载（取决于浏览器能力）；MP 需传平台临时文件路径（如 wxfile://…）。
    openDocument: async (filePath: string) => {
      if (!(typeof g.open === 'function')) throw new CapErrorCtor('document.open.unsupported', "window.open 不可用（非浏览器运行环境？）")
      const r = await g.open(filePath, '_blank')
      if (!r) throw new CapErrorCtor('document.open.failed', "新窗口被浏览器拦截（预览须由用户手势触发）")
    },
  }
}
