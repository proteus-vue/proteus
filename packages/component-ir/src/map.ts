// packages/component-ir/src/map.ts
// ★G-31 B1：semantic → 各端 Backend 映射（验证「Backend 消费 semantic 而非 tag 字符串」）
//   后端实现的是「语义类型 → 原生控件」的映射，不是「标签名 → 标签名」的翻译（G-31 §5）
import type { BackendId } from '@proteus-vue/render-backend'

/** 语义类型 → 各端 Backend 控件（布局原语 + UI 原语——G-31 §3 组件清单） */
export const SEMANTIC_BACKEND_MAP: Record<string, Partial<Record<BackendId | 'web', string>>> = {
  'layout.box': { 'vue-dom': 'div', 'native-ios': 'UIView', flutter: 'Container', headless: 'box' },
  'layout.stack': { 'vue-dom': 'div.flex', 'native-ios': 'UIStackView', flutter: 'Flex', headless: 'stack' },
  'layout.grid': { 'vue-dom': 'div.grid', 'native-ios': 'UICollectionView', flutter: 'GridView', headless: 'grid' },
  'layout.fluid': { 'vue-dom': 'div.fluid', 'native-ios': 'AutoLayout', flutter: 'Wrap', headless: 'fluid' },
  'layout.adaptive': { 'vue-dom': 'dialog', 'native-ios': 'UISheet', flutter: 'showModal', headless: 'adaptive' },
  'layout.fit': { 'vue-dom': 'div.fit', 'native-ios': 'intrinsicSize', flutter: 'IntrinsicWidth', headless: 'fit' },
  'ui.text': { 'vue-dom': 'span', 'native-ios': 'UILabel', flutter: 'Text', headless: 'text' },
  'ui.button': { 'vue-dom': 'button', 'native-ios': 'UIButton', flutter: 'FilledButton', headless: 'button' },
  'ui.image': { 'vue-dom': 'img', 'native-ios': 'UIImageView', flutter: 'Image', headless: 'image' },
  'ui.input': { 'vue-dom': 'input', 'native-ios': 'UITextField', flutter: 'TextField', headless: 'input' },
  'ui.list': { 'vue-dom': 'div.list', 'native-ios': 'UITableView', flutter: 'ListView', headless: 'list' },
  'ui.nav': { 'vue-dom': 'nav', 'native-ios': 'UINavigationController', flutter: 'Navigator', headless: 'nav' },
  'capability.scan-qr': { 'vue-dom': 'dialog.scan', 'native-ios': 'AVCaptureSession', flutter: 'scanQR', headless: 'scan-qr' },
  'capability.pick-photo': { 'vue-dom': 'input.file', 'native-ios': 'UIImagePicker', flutter: 'pickPhoto', headless: 'pick-photo' },
  'capability.location': { 'vue-dom': 'geolocation', 'native-ios': 'CLLocationManager', flutter: 'getLocation', headless: 'location' },
}

/**
 * 语义 → 指定后端控件（未映射 → null，由后端自定义）
 * ★关键：Backend 映射的是 semantic 字段（layout.grid），不是 tag 字符串（p-grid）——
 *   同一 semantic 在不同后端得到不同原生控件，这就是「语义收敛 + 后端实现」
 */
export function mapSemanticToBackend(semantic: string, backendId: string): string | null {
  const row = SEMANTIC_BACKEND_MAP[semantic]
  if (!row) return null
  return row[backendId as BackendId] ?? null
}
