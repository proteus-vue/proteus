/**
 * 示例：车机 Backend 配置（G-30 B3 演练用）
 * 用 capabilities.schema.json 校验
 */
import { defineBackend } from '@proteus/core'

export default defineBackend({
  name: 'car',
  tier: 2, // 受限可用：有渲染 + 有蓝牙/USB，但无相机、无小程序环境

  capabilities: {
    // ---- 渲染（Tier 3+ 必填） ----
    render: {
      layout: 'native',       // 走系统布局（车机 UI 框架）
      supportsShadow: false,  // 车机 GPU 受限，不支持投影
      supportsBlur: false,    // 不支持毛玻璃（性能考虑）
      maxTextureSize: 2048
    },

    // ---- 原生能力（L1/L2/L3） ----
    navigate:   { supported: true,  level: 'L1' },
    storage:    { supported: true,  level: 'L1' },
    network:    { supported: true,  level: 'L1' },
    'platform.info': { supported: true, level: 'L1' },
    lifecycle:  { supported: true,  level: 'L1' },

    scanQR:     { supported: false, level: 'L2', reason: 'no camera SDK',     fallback: 'manual-input' },
    camera:     { supported: false, level: 'L2', reason: 'no camera hardware', fallback: 'manual-input' },
    nfc:        { supported: false, level: 'L2', reason: 'no NFC chip' },

    bluetooth:  { supported: true,  level: 'L2', requiresPermission: 'bluetooth' },
    usb:        { supported: true,  level: 'L2' },
    'spatial-audio': { supported: true, level: 'L2' },

    share:      { supported: false, level: 'L1', reason: 'no system share sheet' }, // ← conformance 会警告：L1 应全实现
    ar:         { supported: false, level: 'L2', reason: 'no AR runtime' },

    // ---- 编译后端 ----
    compiler: {
      target: 'rust',  // 车机端用 Rust 编译后端（G-29），启动快、内存省
      wasm: false
    }
  }
})
