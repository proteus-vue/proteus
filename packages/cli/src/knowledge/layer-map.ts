// packages/cli/src/knowledge/layer-map.ts
// ★★G-54 M0（决策 #1153）：**架构分层映射表——唯一真源**
//
// 【为什么需要这张表（缺口实证）】
//   `docs/proteus-architecture-facade-plan/00-architecture.md` §1 定义了 L0–L5 分层与
//   「L(n) 只能依赖 L(<n)」铁律，但这份分层**只活在文档表格里**：
//   · `packages/*/package.json` 没有任何 layer/rank 字段（grep 零命中）；
//   · 文档注册表用的还是旧包名（`pinia` / `devtools-panel` / `vite-plugin` / `test-utils`），
//     与磁盘真名（`pinia-sync` / `devtools` / `plugin-vite` / `test-core`）不一致。
//   ⇒ 任何"越层诊断"都只能靠人眼看文档，**机器无法判定**。本文件把分层变成可校验数据。
//
// 【与文档的关系（不是另立一套）】
//   分档口径取自 00-architecture.md §1（L0 类型契约 / L1 编译内核 / L2 运行时 /
//   L3 基建 / L4 横切 / L5 验证+门面）；文档里没有的新包按**职责 + 依赖方向**归位，
//   并保证「依赖方 rank ≥ 被依赖方 rank」——这条由 tests/knowledge-kernel.test.ts 强制。
//
// 【零依赖】纯数据 + 纯类型（与 contracts/layers.ts 同款）——可被 CLI / 门禁 / 未来 Studio 共用。
//
// ★★维护纪律：新增包必须在本表登记（`resolveLayer` 返回 null ⇒ 测试红）。
//   这正是 #1139「索引过期比没有索引更糟」的落地：宁可红，不要静默 unknown 当 L0。

/** 架构分层（六档，取自 00-architecture.md §1） */
export const ARCH_LAYERS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'] as const
export type ArchLayer = (typeof ARCH_LAYERS)[number]

/**
 * 层号（**越小越底层**）。
 * ★与 G-55 `06-kernel-daemon.md` §6 的 `rank` 同义：`diff = rank(被依赖方) - rank(依赖方)`。
 */
export const LAYER_RANK: Record<ArchLayer, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
  L5: 5,
}

/** 层的人类可读名（诊断输出用；与文档同词） */
export const LAYER_LABEL: Record<ArchLayer, string> = {
  L0: '类型契约',
  L1: '编译内核',
  L2: '运行时',
  L3: '基建',
  L4: '横切',
  L5: '验证+门面',
}

/**
 * 包 → 层映射（**磁盘真名**：`packages/<dir>` 下的目录名，不是 package.json 的 name）。
 *
 * ★为什么用目录名做 key：目录名是磁盘真源，`name` 字段可能与目录不一致（如 `pinia-sync`），
 *   而 scope / 门禁 / glob 全部按目录表达。
 *
 * ★各层收录依据：
 *   · L0：纯类型 / 纯数据 / 零内部依赖的公共基座（被所有层依赖，不得反向依赖任何人）
 *   · L1：编译期内核（SFC → IR → codegen、排版核心、样式安全）
 *   · L2：运行时（状态 / 路由 / 组件 / 渲染后端 / 能力 / 交互原语）
 *   · L3：基建（CLI / 构建插件 / 调试工具 / 协议服务）
 *   · L4：横切（安全 / 国际化——被多侧复用，故高于运行时）
 *   · L5：验证 + 门面（测试框架 / Agent / 文档引擎 / 脚手架——只消费、不被运行时依赖）
 */
export const PACKAGE_LAYERS: Readonly<Record<string, ArchLayer>> = {
  // ── L0 类型契约 ────────────────────────────────────────────────
  contracts: 'L0',
  types: 'L0',
  shared: 'L0', // 通用工具 + 运行时共享（零内部依赖）
  tokens: 'L0', // 设计 token（纯数据）

  // ── L1 编译内核 ────────────────────────────────────────────────
  compiler: 'L1',
  'compiler-backend': 'L1',
  'compiler-backend-rust': 'L1',
  'component-ir': 'L1',
  'slot-runtime': 'L1',
  'css-compat': 'L1',
  'style-safety': 'L1',
  'layout-core': 'L1', // App 排版核心（原生 taffy 绑定层）

  // ── L2 运行时 ──────────────────────────────────────────────────
  runtime: 'L2',
  router: 'L2',
  module: 'L2',
  api: 'L2',
  capabilities: 'L2',
  'app-config': 'L2',
  'pinia-sync': 'L2',
  components: 'L2',
  'built-in-components': 'L2',
  'render-backend': 'L2',
  'renderer-app': 'L2',
  fluid: 'L2',
  gesture: 'L2',
  icons: 'L2',
  glass: 'L2',
  shader: 'L2',
  animation: 'L2',
  worklet: 'L2',
  desktop: 'L2',
  // ★devtools-runtime 归 L2 而非 L3：`components`（L2）依赖它（采集埋点在组件内），
  //   若放 L3 则 L2→L3 越层。它是**运行时采集层**（TraceBus），不是调试 UI。
  'devtools-runtime': 'L2',
  'compat-miniprogram': 'L2',
  web: 'L2',
  hmr: 'L2',

  // ── L3 基建 ────────────────────────────────────────────────────
  cli: 'L3',
  'plugin-vite': 'L3',
  devtools: 'L3',
  'dev-host': 'L3',
  mcp: 'L3',
  consistency: 'L3',

  // ── L4 横切 ────────────────────────────────────────────────────
  security: 'L4',
  i18n: 'L4',

  // ── L5 验证 + 门面 ─────────────────────────────────────────────
  'test-core': 'L5',
  'test-ir': 'L5',
  agent: 'L5',
  docs: 'L5',
  'create-proteus': 'L5',
}

/** 全部已登记的包目录名（按层排序，供诊断输出） */
export function packagesInLayer(layer: ArchLayer): string[] {
  return Object.entries(PACKAGE_LAYERS)
    .filter(([, l]) => l === layer)
    .map(([p]) => p)
    .sort()
}
