// packages/contracts/src/backend.ts
// ★#425 破 component-ir ↔ render-backend 循环依赖：BackendId 下沉到零依赖 contracts（单一来源）
//   消费：render-backend spi.ts re-export（保外部兼容）；component-ir 直连本包（type-only，无环）
/** 渲染后端标识（RenderBackend SPI——语义 → 各端原生控件的实现方枚举） */
export type BackendId =
  | 'vue-dom'
  | 'flutter'
  | 'native-ios'
  | 'native-android'
  | 'native-harmony'
  | 'skyline' // 微信小程序原生渲染引擎
  | 'skia'
  | 'canvas2d'
  | 'headless'
