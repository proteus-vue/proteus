// packages/consistency/src/probes/web.iife.ts
// Web 探针的**浏览器注入入口**（IIFE）：`page.addScriptTag` 后经
// `window.__proteusWebProbe` 调用（Playwright / CDP 场景；不是发布面——不进 package exports 的语义面）。
import { collectWebGeometry, collectWebStyle } from './web'
import { validateGeometrySnapshot, validateStyleSnapshot, serializeGeometry } from '../snapshot'

;(globalThis as unknown as Record<string, unknown>).__proteusWebProbe = {
  collectWebGeometry,
  collectWebStyle,
  validateGeometrySnapshot,
  validateStyleSnapshot,
  serializeGeometry,
}
