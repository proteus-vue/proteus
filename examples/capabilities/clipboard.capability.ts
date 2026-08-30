// examples/capabilities/clipboard.capability.ts —— 剪贴板能力（platform-plan B1 demo）
// 业务依赖"能力"不依赖"平台"：页面 useCapability('clipboard') + isSupported 探测
// 平台 adapter 集中在此文件（web: navigator.clipboard / skyline: wx.setClipboardData）
// ★MP 端接入：描述文件含 @proteus-vue/capabilities 依赖（第三方）→ B0 共享模块跳过编译（剥离警告）——
//   capability 包在 MP 的打包接入待"含第三方依赖共享模块放行"（module-plan 后续批次）
import { defineCapability } from '@proteus-vue/capabilities'
import type { CapabilityAPI } from '@proteus-vue/capabilities'

/** 能力 API 契约（跨平台统一——两端实现类型一致） */
export interface ClipboardAPI extends CapabilityAPI {
  write(text: string): boolean | Promise<boolean>
}

export default defineCapability<ClipboardAPI>({
  meta: { id: 'clipboard', tier: 2, name: '剪贴板', permissions: [] },
  adapters: {
    web: () => ({
      platform: 'web',
      create: (): ClipboardAPI => ({
        isSupported: () => typeof navigator !== 'undefined' && typeof navigator.clipboard !== 'undefined',
        write: async (text: string) => {
          await navigator.clipboard.writeText(text)
          return true
        },
      }),
    }),
    skyline: () => ({
      platform: 'skyline',
      create: (): ClipboardAPI => ({
        isSupported: () => typeof wx !== 'undefined' && typeof wx.setClipboardData === 'function',
        write: (text: string) => {
          wx.setClipboardData({ data: text })
          return true
        },
      }),
    }),
  },
})
