// packages/contracts/src/mount-layers.ts
// ═══════════ ★★★GP1-a（2026-10-03）：**三层挂载**（mount layer）契约 ═══════════
//
// 【这一层是什么】《Proteus_全局挂载点与App根组件方案》§3 的三层模型：
//   `Global`（跨页面存活：主题/播放器/悬浮球）· `Page`（页面栈）· `Overlay`（Toast/弹窗）。
//   它是**挂载维度**——回答"这些节点属于哪个挂载区、层间谁在谁之上"。
//
// 【★★与 `layers.ts` 的**正交**关系（GP1-b 硬要求：不得混用同一套数值）】
//
//   ┌─ 层间（本文件）  mountLayer：global < page < overlay   —— **编译期固定、不可配置**
//   └─ 层内（layers.ts）layer-primitive：content<navigation<mask<popout（WeUI 四层，1/10/100/1000）
//
//   两者是**两个独立维度**：`Global 层里的一个 Popout` 与 `Page 层里的一个 Popout`
//   在**层内**是同一档（都是 popout），但在**层间**前者永远在后者之下。
//   ⇒ 任何把两者塞进同一套数值的方案都是错的（会破坏"层间顺序编译期固定"）。
//
// 【★为什么**零新指令**（GP1-a 的核心结论）】
//   本仓内核的 z-order **真源 = 树序（声明顺序）**（见 `layers.ts` LAYER_MAPPING 注释：
//   "android.translationZ 与 ios.zPosition 的真源当前是树序"）。
//   ⇒ 层间顺序**用树序表达**即可：Global 节点在最前、Page 居中、Overlay 最后——**内核零改动**。
//   `mountLayer` 标记是**编译期事实**（方案 §3.2 硬约束 C1：声明式、可枚举），
//   供 ① 编译期校验（C1/C2/C3）② 宿主分容器（未来做独立表面时）③ 诊断/调试 消费。
//   ★反例（明确否决）：新增 `SET_MOUNT_LAYER` 指令——那要三端内核 + 全部宿主跟着改，
//     而它想表达的"顺序"内核**已经理解**（树序）。为已有语义造新指令 = 架构冗余。
//
// 【CSS z-index 场景的**域偏移**（唯一需要数值的地方）】
//   Web / MP 用 CSS z-index 表达层内层级（1/10/100/1000）。若**不加偏移**，跨层比较会出事：
//   `Global 的 navigation(10)` > `Page 的 content(1)` ⇒ 全局导航浮在页面之上——但层间语义是
//   Page 盖住 Global ⇒ **顺序颠倒**（静默、跨端不一致）。
//   ⇒ 有效 z-index = `mountLayerDomainOffset(层)` + `layerValueFor(层内原语, 端)`。
//   每层留 `MOUNT_LAYER_DOMAIN` 空间（层内最大值 popout=1000 + 弹层栈上限 16 ⇒ 余量充裕）。
//   ★诚实边界：App 自绘端**不用**这个偏移（树序是真源，内核尚无 zOrder 字段）——
//     它服务 web/mp 现状 + 未来内核接入 zOrder 时的既定契约（与 layers.ts 的诚实边界同款）。

/**
 * 挂载层封闭集（方案 §3.1）。
 * ★不可扩展（与 `LAYER_PRIMITIVES` 同一纪律）：新增层 = 改方案 + 改本文件 + 改映射表。
 */
export const MOUNT_LAYERS = ['global', 'page', 'overlay'] as const

export type MountLayer = (typeof MOUNT_LAYERS)[number]

/**
 * 层间顺序（**编译期固定、不可配置**——方案 §3.3 硬约束）。
 * 数值只用于**排序与域偏移计算**，不作为"层级"直接下发给任何渲染端（那会与层内四层混用）。
 */
export const MOUNT_LAYER_ORDER: Record<MountLayer, number> = {
  global: 0,
  page: 1,
  overlay: 2,
}

/**
 * 每层占用的 z-index 域宽（层间偏移的步长）。
 * ★取值理由：层内最大是 `layer-popout`(1000) + 弹层栈上限 16 ⇒ 约 1016；
 *   取 1_000_000 留出四个数量级余量（未来层内扩档也不会撞域）。
 */
export const MOUNT_LAYER_DOMAIN = 1_000_000

/**
 * 层的 **z-index 域偏移**（CSS 场景用；App 自绘端不用——见文件头注）。
 * 有效值 = 本偏移 + 层内原语值（`layerValueFor`）。
 */
export function mountLayerDomainOffset(layer: MountLayer): number {
  return MOUNT_LAYER_ORDER[layer] * MOUNT_LAYER_DOMAIN
}

/**
 * 层语义（**对外表述与诊断用**）。
 * ★`lifetime` 一栏是**分端诚实**的落点：`global` 在自绘端"随 App"，在 MP 端
 *   **每页一份实例**（方案 §1.2-bis——小程序每页独立渲染树）；`perDevice` 字段标注该差异。
 */
export const MOUNT_LAYER_SEMANTICS: Record<
  MountLayer,
  {
    zh: string
    /** 生命周期（自绘端） */
    lifetimeApp: string
    /** 生命周期（MP 端——★与自绘端**不同**，诚实标注） */
    lifetimeMp: string
    /** 典型内容 */
    examples: string
    /** 是否拦截交互（默认） */
    intercepts: boolean
  }
> = {
  global: {
    zh: '全局层：跨页面存活（主题容器 / 悬浮球 / 播放器 / 网络状态条）',
    lifetimeApp: '随 App（永不随页面销毁）',
    lifetimeMp: '★**每页一份实例**（页面栈 N 层 = N 份；状态共享、实例不共享——方案 §1.2-bis）',
    examples: '主题容器 · 全局悬浮球 · 音乐播放条 · 网络状态条',
    intercepts: false,
  },
  page: {
    zh: '页面层：路由栈的内容（缺省层——未标记的节点都属这里）',
    lifetimeApp: '随路由栈（页面销毁即回收）',
    lifetimeMp: '随页面（每页一棵独立树）',
    examples: '页面内容 · 导航栏 · 吸顶栏',
    intercepts: false,
  },
  overlay: {
    zh: '浮层：临时出现、最上层、拦截交互（Toast / 弹窗 / 登录拦截）',
    lifetimeApp: '显式控制（弹层栈管理）',
    lifetimeMp: '显式控制（当前页内的 root-portal）',
    examples: 'Toast · Loading · 登录失效弹窗 · 操作菜单',
    intercepts: true,
  },
}

/**
 * ★★★**C2：Global 层节点数上限**（方案 §3.2 硬约束；**每页**口径见方案 §1.2-bis）。
 *
 * 【为什么有限制】Global 层**常驻内存**（自绘端永不销毁 / MP 端每页一份 × N）
 *   ⇒ 无限膨胀会拖垮超级应用。32 是**建议值**（GP0/实测后校准——见任务卡 GP2-c）。
 */
export const GLOBAL_LAYER_NODE_LIMIT = 32

/**
 * ★**C1 的机器可读判据**：层声明只允许出现在 **App.vue** 的 `<template>` 中。
 *
 * 【为什么是硬约束（方案 §3.2）】若开放运行时 `insertGlobal(vnode)`，全局层会成为
 *   **新逃生口**——conformance 与 AI 可校验同时失效，且失效是**静默的**。
 *   与"不开放任意原生调用"同一条原则：**收敛模型适用于可枚举的声明，不适用于任意运行时行为**。
 *
 * @param filename 源文件名
 * @returns 该文件是否允许声明三层挂载点
 */
export function isMountLayerDeclarableFile(filename: string): boolean {
  // 认文件名 `App.vue` 与**平台变体** `App.<平台>.vue`（大小写不敏感、允许路径前缀）——
  // ★变体必须放行：`App.mp.vue`/`App.web.vue` 是同一逻辑文件的按端形态（本仓平台变体机制），
  //   拦掉变体 = MP/其它端拿到变体文件时 C1 误报（且"只能在 App.vue 声明"的语义并未被保护得更好）。
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? ''
  return /^app(\.[a-z0-9]+)?\.vue$/i.test(base)
}

/**
 * 三层挂载的**框架标签**（方案 §3.2 的声明形态；Vue 标准模板里写这些标签 ⇒ 编译期转层标记）。
 *
 * ★它们是**逻辑容器**（自身**不产元素**——与 `Transition`/`KeepAlive` 同族）：
 *   层是"挂载区"而不是"盒子"；用户要布局容器请自己包 `<view>`。
 *   ★`app-root` 是 App.vue 的根（等价于页面模板的根 view），不属任何挂载层（它是层的**父**）。
 */
export const MOUNT_LAYER_TAGS: Record<string, MountLayer | 'root'> = {
  'app-root': 'root',
  'global-layer': 'global',
  'page-layer': 'page',
  'overlay-layer': 'overlay',
}

/** 反查：挂载层 → 其框架标签名（诊断文案用） */
export function mountLayerTagOf(layer: MountLayer): string {
  return `${layer}-layer`
}

/**
 * ★★★GP3-b1（2026-10-03）：**Global 层共享状态模块的产物路径**（MP 每页注入通道）。
 *
 * 【为什么用共享模块而不是 `getApp().globalData`】`globalData` 是否存在于 app.js **取决于
 *   用户入口怎么写**（极简模式下骨架不含它）——依赖它 = 依赖用户手写形态（脆弱）。
 *   而**小程序 require 缓存**（同路径同实例）是本仓已验证的机制（vendor 单例化就靠它，
 *   见 plugin-vue 的 `VENDOR_SINGLETONS` 注释）⇒ 共享模块是**自包含**的状态通道：
 *   "实例每页一份、状态一份"（与官方 `custom-tab-bar` 同模式）。
 */
export const GLOBAL_LAYER_STATE_MODULE = '_proteus/global-layer.js'

/* ═══════════════════════════════════════════════════════════════════════════
 * ★★★GP3-c（2026-10-03）：**自绘端（App）的层容器契约**——内核树里的三层容器怎么摆。
 *
 * 【为什么需要这份契约（两端不能各写一遍）】Android 与 iOS 宿主都要"在屏幕树里建三层容器"，
 *   若各写各的，就是**同一件事两份实现**（本仓纪律：修一份等于没修，已为此付过代价）。
 *   ⇒ 层容器的 **id 分配 / 树序 / 几何口径** 都从这里取（两端宿主只做"照此建树"）。
 *
 * 【★层间顺序 = 树序（不是 z-index）】内核**没有** z-order 字段（实测：`style.rs`/`node.rs`
 *   零命中 `z_index`/`zIndex`）⇒ 顺序唯一真源是**子节点的声明序**（GP1-a 的"零新指令"结论）。
 *   ⇒ 三层容器按 `global → page → overlay` **依次挂到屏根**（后挂的在上）。
 *   ★这与 Web 端（层容器 z-index 域偏移）**机制不同但语义相同**——两端各自用"宿主的最自然表达"：
 *     · 自绘端：树序（内核原生语义，零额外字段）
 *     · Web：CSS z-index（DOM 的原生语义）
 *   两者都满足"层间顺序编译期固定、不可配置"，且都是**零新指令/零新字段**。
 *
 * 【几何口径：层容器必须**铺满屏**且不参与内容布局】容器是**纯容器**（无背景/无内边距/无裁剪——
 *   裁剪与否由层内元素自己声明），几何取屏的全尺寸 ⇒ 层内容可用**屏坐标系**绝对定位
 *   （与《单位系统与舍入规范》一致：几何值在**内核**里算，出口即物理像素整数）。
 *   ★诚实边界：`overlay` 层**不吃事件**（容器本身不拦）——拦截由层内元素（遮罩）自己声明，
 *     遵守"层不拦截交互"契约（见 MOUNT_LAYER_SEMANTICS.intercepts）。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 屏根下三层容器的**节点 id 偏移**（屏根 id + 偏移 = 该层容器 id；两端宿主同源取用） */
export const MOUNT_LAYER_NODE_OFFSET: Record<MountLayer, number> = {
  global: 1,
  page: 2,
  overlay: 3,
}

/**
 * 计算某个挂载层的容器节点 id。
 *
 * @param screenRootId 屏根节点 id（宿主 `screen.mount` 时分配）
 * @param layer 层名
 * @returns 该层容器的节点 id
 * @throws 非法 id（非正整数）⇒ 抛错不静默（"算出个 0 然后整层不显示"是最坏形态）
 */
export function mountLayerNodeId(screenRootId: number, layer: MountLayer): number {
  if (!Number.isInteger(screenRootId) || screenRootId <= 0) {
    throw new Error(`mountLayerNodeId: screenRootId 必须是正整数（收到 ${String(screenRootId)}）`)
  }
  return screenRootId + MOUNT_LAYER_NODE_OFFSET[layer]
}

/**
 * 层容器的**建树计划**（宿主消费：转成各自的内核 `create` 请求节点）。
 *
 * ★**为什么是偏移量而不是绝对 id**：屏根 id 由**宿主**在 `screen.mount` 时分配
 *   （执行器不知道，也不该知道——那是宿主的内部分配策略）⇒ 计划里只给 `nodeOffset`，
 *   宿主算 `id = 自己分配的根 id + nodeOffset`。这样契约与宿主的分配策略**解耦**。
 */
export interface MountLayerContainerPlan {
  layer: MountLayer
  /** 节点 id 相对屏根的**偏移**（宿主：`id = screenRootId + nodeOffset`） */
  nodeOffset: number
  /** 树序（升序 = 挂载序 = **层叠序**；`global`(0) 在下、`overlay`(2) 在上） */
  order: number
  /** 几何口径：铺满屏（层内容用屏坐标系绝对定位） */
  frame: 'fullscreen'
}

/**
 * 生成**层容器建树计划**（三层，按 `order` 升序）——执行器随 `screen.mount` 下发，宿主照此建树。
 *
 * 【宿主侧用法】建屏根后，对每个计划项建一个容器节点：
 *   `id = rootId + nodeOffset`、`parentId = rootId`、`position: absolute`、
 *   宽高 = 屏尺寸（`frame: 'fullscreen'`）⇒ **按数组顺序**加入 `nodes`
 *   ⇒ 内核**树序即层序**（内核无 z-order 字段，实测零命中 ⇒ 树序是唯一真源）。
 *   ★宿主**不得**自行决定层的顺序/偏移（那是契约的事——两端必须一致，否则两端层序会漂）。
 */
export function mountLayerContainerPlans(): MountLayerContainerPlan[] {
  return [...MOUNT_LAYERS]
    .sort((a, b) => MOUNT_LAYER_ORDER[a] - MOUNT_LAYER_ORDER[b])
    .map((layer) => ({
      layer,
      nodeOffset: MOUNT_LAYER_NODE_OFFSET[layer],
      order: MOUNT_LAYER_ORDER[layer],
      frame: 'fullscreen' as const,
    }))
}

/**
 * ★层容器的**命中语义**（GP3-c 验收："不申请任何敏感权限即可使用默认能力" /
 *   "全局层跨页面存活，路由切换不重建"）。
 *
 * | 层 | 参与布局 | 吃事件 | 跨路由存活 |
 * |---|---|---|---|
 * | global | 否（纯容器，内容自定位） | 否（内容自己声明） | ✅ **是**（宿主在切屏时**不重建**它） |
 * | page | 否 | 否 | ❌（随屏） |
 * | overlay | 否 | 否 | ❌（随屏） |
 *
 * ★**跨路由存活怎么落地（宿主职责，本契约只声明口径）**：自绘端"屏 = 树内子树"（M5），
 *   切屏 = `display` 切换 ⇒ **global 层容器不在被切的那棵子树里**（它在屏根下、与页面子树平级）
 *   ⇒ 切屏天然不动它。这正是"三层挂载"在自绘端**比 MP 更强**的地方（MP 要每页注入）。
 */
export const MOUNT_LAYER_HOST_CONTRACT = {
  /** 层容器**不参与内容布局**（纯容器：无背景/内边距/裁剪） */
  participatesInLayout: false,
  /** 层容器**自身不拦事件**（拦截由层内元素声明——保持 intercepts 语义） */
  interceptsEvents: false,
  /** 跨路由存活（切屏不重建）的层——**仅 global** */
  survivesRouteChange: 'global' as MountLayer,
  /** 层容器的定位方式（自绘端：绝对定位 + 全屏 frame） */
  positioning: 'absolute-fullscreen' as const,
} as const
