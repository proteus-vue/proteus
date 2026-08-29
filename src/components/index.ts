// src/components/index.ts —— 框架内置组件聚合导出
// Web 端：import { VirtualList } from '@proteus/components'（拆包步骤 6 精确别名 → src/components）
// MP 端：无需 import，标签 <virtual-list> 由 gen-routes 自动解析框架组件（/proteus/...）
// 新增内置组件：在此聚合导出 + 插件/路由自动支持（src/components/ 扫描与 /proteus/ 前缀已就绪）
import VirtualList from './virtual-list/index.vue'

export { VirtualList }
