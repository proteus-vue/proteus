// website/src/stats.ts —— 官网数据单一来源（B4 验收：Showcase 数字可追溯到脚本）
// ★纪律：页面展示的一切数字必须在此登记 + 注明权威来源（禁止散落硬编码）。
//   更新流程：跑对应验证脚本 → 回填本文件 → 提交（数字与证据同源，W-4 证明先于宣称）。

export interface StatItem {
  value: string
  label: string
  /** 权威来源（验证脚本 / 文档锚点——可追溯） */
  source: string
}

export const STATS: StatItem[] = [
  { value: '38', label: '@proteus-vue/* 包', source: 'npm run check:pkg（38 包 0 error）' },
  { value: '2006', label: '单测全绿', source: 'npm test（官方门禁，e2e 排除）' },
  { value: '128', label: '语义原语 SSOT', source: 'PRIMITIVE_CATALOG（proteus audit coverage）' },
  { value: '45', label: 'implemented 语义 × 6 后端', source: 'conformance 门禁' },
  { value: '59', label: 'p-* 语义组件', source: 'proteus components:audit' },
  { value: '69', label: '编译规则 AI 说明书', source: 'listTransformRules（packages/compiler transforms 注册表）' },
  { value: '8', label: 'conformance 套件', source: 'RND/H/C/CMP/ABI/NAT-C 系列' },
  { value: '69', label: 'plan 文档', source: 'docs/*-plan 目录（board-inventory 全景索引；#385 批次后）' },
]

/** 对标矩阵（来源：docs/proteus-positioning-v3.md §6——状态标注诚实原则） */
export interface CompareRow {
  dim: string
  uniapp: string
  rn: string
  flutter: string
  proteus: string
  /** Proteus 列落地状态：✅ 已落地 / 📋 规划已入库 */
  status: '✅' | '🟡' | '📋'
}

export const COMPARE_MATRIX: CompareRow[] = [
  { dim: '渲染底座', uniapp: 'WebView', rn: '原生（锁定）', flutter: 'Skia（锁定）', proteus: '可插拔（Vue/Native/Flutter/Skia）', status: '✅' },
  { dim: '同 App 多后端', uniapp: '❌', rn: '❌', flutter: '❌', proteus: '按页面切换 + 混合渲染', status: '✅' },
  { dim: '编译器', uniapp: '锁定', rn: '锁定（Metro）', flutter: '锁定', proteus: 'SPI 可插拔（Node/Rust 一个 flag）', status: '🟡' },
  { dim: '业务写法', uniapp: 'view/text DSL', rn: 'JSX + 原生组件', flutter: 'Dart', proteus: '标准 HTML + 标准 Vue SFC', status: '✅' },
  { dim: '布局适配', uniapp: 'rpx（单位换算）', rn: 'LayoutBuilder', flutter: 'AdaptiveScaffold', proteus: '系统级柔性布局（p-*）', status: '✅' },
  { dim: '内存治理', uniapp: 'GC 兜底', rn: 'GC 兜底', flutter: 'GC + 手动', proteus: '所有权 + 借用检查编译期拦截', status: '✅' },
  { dim: 'AI 介入方式', uniapp: '无 IR，文本替换', rn: '同左', flutter: '同左', proteus: '操作 IR + 强制校验 + 自修复', status: '✅' },
  { dim: '手写原生插件', uniapp: '插件市场碰运气', rn: '必须写 Native Module', flutter: '必须写 Plugin', proteus: '语义接口 + NativeBackend', status: '📋' },
]
