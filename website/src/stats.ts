// website/src/stats.ts —— 官网数据单一来源（B4 验收：Showcase 数字可追溯到脚本）
// ★纪律：页面展示的一切数字必须在此登记 + 注明权威来源（禁止散落硬编码）。
//   更新流程：跑对应验证脚本 → 回填本文件 → 提交（数字与证据同源，W-4 证明先于宣称）。
//
// ★★2026-09-20 整体校准 + 加门禁：此前本文件与页面**长期漂移**（实测 8 项里 7 项过时：
//   包数 40/41 两处并存、单测 2966→3441、原语 176→183、组件 66→76、规则 106→111、
//   plan 81→85、conformance 8→10），且 Home.vue 的 Hero 与英文层**各自硬编码**，同一页面出现两个数。
//   根治两件事：① 本文件补 `id`（门禁按 id 重算）与 `labelEn`（英文页从同一数组派生，不再另立一份）；
//   ② 新增 `website/scripts/check-stats.ts`（`pnpm check:stats`）——凡**可机器重算**的项，
//      与源码实际值逐项比对，不符即 CI 红。这样「数字过时」不再能静默上线。

export interface StatItem {
  /** 稳定标识——门禁（check-stats）按 id 重算并比对 value */
  id: 'packages' | 'tests' | 'primitives' | 'implemented' | 'components' | 'rules' | 'conformance' | 'plans'
  value: string
  label: string
  /** 英文文案（与中文**同值**——只翻标签，避免两套数字各自漂移） */
  labelEn: string
  /** 权威来源（验证脚本 / 文档锚点——可追溯） */
  source: string
  /** 英文来源说明（与 source 同值同源） */
  sourceEn: string
}

export const STATS: StatItem[] = [
  {
    id: 'packages',
    value: '41',
    label: '@proteus-vue/* 包',
    labelEn: '@proteus-vue/* packages',
    source: 'pnpm check:pkg（41 包 0 error；41 个 packages/* 目录）',
    sourceEn: 'pnpm check:pkg (41 packages, 0 errors; 41 packages/* dirs)',
  },
  {
    id: 'tests',
    value: '3447',
    label: '单测全绿',
    labelEn: 'unit tests green',
    // ★唯一「需跑全量」的项：门禁不重跑（代价高），由发布前手动核对——其余项均机器重算
    source: 'pnpm test（官方门禁，排除 e2e；291 文件 / 3447 用例）',
    sourceEn: 'pnpm test (official gate, e2e excluded; 291 files / 3447 cases)',
  },
  {
    id: 'primitives',
    value: '184',
    label: '语义原语 SSOT',
    labelEn: 'semantic primitives SSOT',
    source: 'PRIMITIVE_CATALOG.length（@proteus-vue/component-ir）',
    sourceEn: 'PRIMITIVE_CATALOG.length (@proteus-vue/component-ir)',
  },
  {
    id: 'implemented',
    value: '65',
    label: 'implemented 语义 × 6 端',
    labelEn: 'implemented semantics × 6 ends',
    // 6 端 = vue-dom / skyline / native-ios / native-android / native-harmony / flutter；
    // SEMANTIC_BACKEND_MAP 另含 headless（参考后端，不属「端」）
    source: 'implementedPrimitives().length × SEMANTIC_BACKEND_MAP 的 6 个端键（另有 headless 参考后端）',
    sourceEn: 'implementedPrimitives().length × 6 end keys in SEMANTIC_BACKEND_MAP (plus the headless reference backend)',
  },
  {
    id: 'components',
    value: '77',
    label: '语义组件（p-* / pg-glass / virtual-list）',
    labelEn: 'semantic components (p-* / pg-glass / virtual-list)',
    source: 'proteus components:audit packages/components（76 组件全部通过）',
    sourceEn: 'proteus components:audit packages/components (76 components, all passing)',
  },
  {
    id: 'rules',
    value: '111',
    label: '编译规则 AI 说明书',
    labelEn: 'compiler rules (AI-readable catalog)',
    source: 'listTransformRules().length（@proteus-vue/compiler transforms 注册表）',
    sourceEn: 'listTransformRules().length (@proteus-vue/compiler transforms registry)',
  },
  {
    id: 'conformance',
    value: '10',
    label: 'conformance 套件入口',
    labelEn: 'conformance suite entry modules',
    // 计数规则明确化（原「8」无对应规则且与实际不符）：packages/*/src/*conformance*.ts 文件数
    source: 'packages/*/src/*conformance*.ts（RND/H/C/CMP/ABI/NAT-C 系列）',
    sourceEn: 'packages/*/src/*conformance*.ts (RND/H/C/CMP/ABI/NAT-C series)',
  },
  {
    id: 'plans',
    value: '85',
    label: 'plan 文档',
    labelEn: 'plan documents',
    source: 'docs/*-plan 目录（board-inventory 全景索引）',
    sourceEn: 'docs/*-plan dirs (board-inventory index)',
  },
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
