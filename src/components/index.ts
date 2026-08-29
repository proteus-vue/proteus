// src/components/index.ts —— 框架内置组件聚合导出
// Web 端：import { VirtualList, PView, PListView } from '@proteus/components'（拆包步骤 6 精确别名 → src/components）
// MP 端：无需 import，标签 <virtual-list>/<p-view> 由 gen-routes 自动解析框架组件（/proteus/...）
// 新增内置组件：在此聚合导出 + 插件/路由自动支持（src/components/ 扫描与 /proteus/ 前缀已就绪）
// 组件层契约/能力（组件库落地评估 v2 B1）：contracts / runtime 供 Web 端 import
import VirtualList from './virtual-list/index.vue'
import PView from './p-view/index.vue'
import PText from './p-text/index.vue'
import PImage from './p-image/index.vue'
import PButton from './p-button/index.vue'
import PScrollView from './p-scroll-view/index.vue'
import PListView from './p-list-view/index.vue'
import PInput from './p-input/index.vue'
import PTextarea from './p-textarea/index.vue'

export { VirtualList, PView, PText, PImage, PButton, PScrollView, PListView, PInput, PTextarea }
export { COMPONENT_TAG_PREFIX, EVENT_NAMES, SLOT_NAMES } from './contracts'
export type { BaseProps } from './contracts'
