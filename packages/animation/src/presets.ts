// packages/animation/src/presets.ts
// ★★Morpheus（MA1）—— **预设库**（"开箱即用" = 预设，不是参数；Morpheus §6）
//
// 【为什么不暴露参数】开发者的真实需求不是"能配 spring 的 damping"，而是
//   **"这个列表项飞到详情页" —— 一句话能写出来**。⇒ 预设优先，参数兜底。
//
// 【★与微信 routeType 对齐（§6.2）】仓库已支持 `routeType: 'wx://bottom-sheet'` 等；
//   本预设库的**语义与之对齐**（见每个预设的 `wxRouteType` 字段）——降低开发者认知负担，
//   且便于双端一致（同一份源码在 MP 走 Skyline 的 routeType，在 App 走 Morpheus 预设）。
//
// 【分层（哪些是"转场"、哪些是"元素动画"）】
//   · `route.*`  —— **页面级转场**（进场页 + 出场页两个"节点"）；对应 §5-bis 的合成属性路径；
//   · `list.*`   —— **布局动画**（FLIP：几何在内核，零跨边界；对应 §5 的招牌能力）；
//   · `easing.*` —— **手感预设**（弹簧参数；避免开发者手调）。
import type { AnimDecl, CurveName } from './types'
// ★手感预设的**单一事实来源**已抽到 `easing.ts`（原因见该文件头：编排层与预设库都要用它，
//   留在本文件会与 choreography 形成循环依赖）——本处重导出，既有 `import { easing }` 不变。
import { easing } from './easing'
// ★编排预设（`choreograph.*`）挂在 `presets` 同一导出面上（"预设优先"哲学一致）。
//   依赖方向：presets → choreography → easing/compile/bitmap-font ⇒ **无环**
//   （choreography 不反向 import presets——若将来要反向引用，请把共享常量下沉到独立模块）。
import { choreograph } from './choreography'

export { easing }

/* ────────────────────────── 路由转场预设 ────────────────────────── */

/** 转场预设：**进场页 + 出场页**两组声明（"对谁做"由编译期绑定，见 `compileRoute`） */
export interface RouteTransitionSpec {
  /** 预设名 */
  name: string
  /** 对齐的微信 routeType（语义来源，§6.2）；`null` = 本端特有 */
  wxRouteType: string | null
  /** 进场页（新页面）的动画 */
  enter: AnimDecl[]
  /** 出场页（旧页面）的动画（可选——不是所有转场都动它） */
  exit: AnimDecl[]
  /**
   * ★★**语义角色**（缺省 `'push'`）——决定 `routeTransitionBatches` 在 **back 方向**如何绑定两组声明。
   *
   * 【为什么必须有这个字段（产品页演示取证抓出的真缺陷）】两类预设的角色约定**不同**：
   *   · `'push'`（对称型，默认）：`enter` = 进场页动作、`exit` = 出场页动作（都是"前进"语义）。
   *     back 方向 = **角色互换 + 反向播放**（镜像对）。例：`slideUp` / `scaleDown` / `bottomSheet`。
   *   · `'dismiss'`（退场型）：`exit` **直接描述"被关闭页"的动作**——这是 **pop 语义**的预设
   *     （对齐微信 `routeType: 'slideDown'` 的"下滑关闭"）。`enter` 通常为空（下层页本就静止）。
   *     back 方向 = `exit` **原样**作用于 outgoing（被关闭页），`enter` 原样作用于 incoming。
   *
   * ★**按 `'push'` 推导 `'dismiss'` 预设会把动作绑到错的页上**——实测：`slideDown` 的 back
   *   变成"**下层页从下方升上来**"（而正确的"下滑关闭"是**被关闭页向下滑出**）——方向完全相反。
   */
  role?: 'push' | 'dismiss'
  /** 是否不透明（`false` ⇒ 需要下层可见，如半屏弹窗） */
  opaque: boolean
  /** 名义时长（毫秒；供宿主做超时/编排参考） */
  durationMs: number
}

const DUR = 300

/**
 * **路由转场预设**（4 个，语义与微信 routeType 对齐）
 *
 * 用法（一句话）：
 * ```ts
 * import { presets, compileRoute } from '@proteus-vue/animation'
 * const spec = presets.route.bottomSheet()          // 半屏弹窗
 * const batch = compileRoute(spec, { enter: 101, exit: 100 })
 * // → 整批喂给引擎：node.animStart(JSON.stringify({ anims: batch.anims }))
 * ```
 */
export const route = {
  /**
   * **半屏弹窗**（从底部滑入）—— 对齐 `wx://bottom-sheet`
   *
   * ★为什么"只动进场页"：弹窗场景下旧页面**保持不动**（背景被遮罩压暗即可）——
   *   动它反而会让用户误以为页面在跳。这与微信 `wx://bottom-sheet` 的行为一致。
   */
  bottomSheet(opts: { distance?: number; durationMs?: number; spring?: boolean } = {}): RouteTransitionSpec {
    const dist = opts.distance ?? 400
    const dur = opts.durationMs ?? DUR
    const enter: AnimDecl[] = opts.spring
      ? [{ kind: 'translateY', from: dist, to: 0, spring: easing.smooth }]
      : [{ kind: 'translateY', from: dist, to: 0, curve: 'easeOut', durationMs: dur }]
    return { name: 'bottomSheet', wxRouteType: 'wx://bottom-sheet', enter, exit: [], opaque: false, durationMs: dur }
  },

  /**
   * **全屏向上推入**（新页从下方推入，旧页被推出）—— 对齐 `wx://upwards`
   */
  slideUp(opts: { distance?: number; durationMs?: number; exitParallax?: number } = {}): RouteTransitionSpec {
    const dist = opts.distance ?? 800
    const dur = opts.durationMs ?? DUR
    const parallax = opts.exitParallax ?? 0.3
    return {
      name: 'slideUp',
      wxRouteType: 'wx://upwards',
      enter: [{ kind: 'translateY', from: dist, to: 0, curve: 'easeOut', durationMs: dur }],
      // 旧页向反方向让位（视差）+ 轻微淡出——这是"推入"的层次感来源
      exit: [
        { kind: 'translateY', from: 0, to: -dist * parallax, curve: 'easeOut', durationMs: dur },
        { kind: 'opacity', from: 1, to: 1 - parallax, curve: 'easeOut', durationMs: dur },
      ],
      opaque: true,
      durationMs: dur,
    }
  },

  /**
   * **下滑关闭**（dismiss：当前页向下滑出，露出下层页）—— 对齐统一枚举的 `slideDown`
   *
   * 【与 `slideUp` 的方向关系】`slideUp` 是"推入"（新页从下往上），`slideDown` 是"弹出/关闭"
   *   （当前页从上往下）——两者是**相反**的位移方向，对应统一枚举 `RouteTransition` 的两个成员
   *   （Web 侧 `WEB_TRANSITION_MAP.slideDown = 'slide-down'`、MP 侧 `routeType: 'slideDown'`）。
   *
   * ★注意 `enter`/`exit` 的语义：本预设描述的是**被关闭页（exit）下滑**；
   *   `enter` 留空（下层页本就静止——动它会让"关闭"看起来像"又推了一页"）。
   */
  slideDown(opts: { distance?: number; durationMs?: number } = {}): RouteTransitionSpec {
    const dist = opts.distance ?? 800
    const dur = opts.durationMs ?? 300
    return {
      name: 'slideDown',
      wxRouteType: null, // ★诚实边界：微信 routeType 里没有"下滑关闭"这个预设（dismiss 由导航栈语义表达）
      // ★★`role: 'dismiss'`（退场型）——`exit` 描述的是**被关闭页**的下滑动作（pop 语义）。
      //   没有它时 back 推导会把 `exit` 反向绑给"返回目标页"⇒ 视觉变成"下层页升上来"（方向反了）。
      role: 'dismiss',
      enter: [],
      exit: [
        { kind: 'translateY', from: 0, to: dist, curve: 'easeIn', durationMs: dur },
        { kind: 'opacity', from: 1, to: 0.8, curve: 'easeIn', durationMs: dur },
      ],
      opaque: false, // 下滑时下层页可见
      durationMs: dur,
    }
  },

  /**
   * **缩放下沉**（新页从底部放大进入，旧页下沉）—— 对齐 `wx://zoom`
   */
  zoom(opts: { durationMs?: number; fromScale?: number; fromOffsetY?: number } = {}): RouteTransitionSpec {
    const dur = opts.durationMs ?? DUR
    const sc = opts.fromScale ?? 0.92
    const offY = opts.fromOffsetY ?? 60
    return {
      name: 'zoom',
      wxRouteType: 'wx://zoom',
      enter: [
        { kind: 'scale', from: sc, to: 1, curve: 'easeOut', durationMs: dur },
        { kind: 'translateY', from: offY, to: 0, curve: 'easeOut', durationMs: dur },
        { kind: 'opacity', from: 0.6, to: 1, curve: 'easeOut', durationMs: dur },
      ],
      // 旧页"下沉"（缩小 + 变暗）——视觉上像被压到下面
      exit: [
        { kind: 'scale', from: 1, to: 0.96, curve: 'easeOut', durationMs: dur },
        { kind: 'opacity', from: 1, to: 0.7, curve: 'easeOut', durationMs: dur },
      ],
      opaque: true,
      durationMs: dur,
    }
  },

  /**
   * **iOS 风格模态**（从底部滑入 + 轻微缩放）—— 对齐 `wx://cupertino-modal`
   *
   * 与 `bottomSheet` 的差别：模态是**全屏**（距离 = 屏幕高），且**带阻尼感**（弹簧）。
   */
  cupertinoModal(opts: { distance?: number } = {}): RouteTransitionSpec {
    const dist = opts.distance ?? 800
    return {
      name: 'cupertinoModal',
      wxRouteType: 'wx://cupertino-modal',
      enter: [{ kind: 'translateY', from: dist, to: 0, spring: easing.smooth }],
      exit: [{ kind: 'scale', from: 1, to: 0.92, curve: 'easeInOut', durationMs: 250 }],
      opaque: true,
      durationMs: 350,
    }
  },
} as const

/* ────────────────────────── 元素/列表预设 ────────────────────────── */

/** 列表让位预设（映射到内核 FLIP；`durationMs`/`curve`/`staggerMs` 即 `flip_start` 的三个参数） */
export interface ListShiftSpec {
  name: string
  /** 补间时长（毫秒） */
  durationMs: number
  curve: CurveName
  /** 交错延迟（毫秒）：>0 ⇒ 按新位置自上而下级联（"列表让位"的层次感） */
  staggerMs: number
}

/** 元素动画预设（对**单个节点**做的入场/退场；编译期绑定目标） */
export interface ElementSpec {
  name: string
  decls: AnimDecl[]
  durationMs: number
}

/**
 * ★**共享元素预设**（跨元素飞行；几何由**内核**算，见 `presets.element.sharedElement`）
 *
 * 不含 `decls`——它不走"声明→指令"那条路（多条 animDecl 本来也表达不了"从源矩形到目标"，
 * 因为源几何只有运行时才知道）⇒ 宿主交 `proteus_layout_shared_element`，几何数学在内核。
 */
export interface SharedElementSpec {
  name: string
  durationMs: number
  fadeIn: boolean
  /** 源 = 系统坐标矩形（跨页面/跨稳态；由调用方注入） */
  fromRect?: { x: number; y: number; w: number; h: number }
  /** 源 = 同树节点 id（同页面共享元素） */
  fromNodeId?: number
}

export const list = {
  /**
   * ★★**列表项增删让位**（Morpheus §5 的招牌能力）
   *
   * 【为什么这一条最值钱】传统 FLIP 要**前后各读一次几何**（跨边界查询，VDOM 框架里很贵）；
   *   而本仓几何本来就在 Rust 内核 ⇒ 两次快照都是内部读，**零跨边界、零 JS**。
   *   配合 0.08ms 全量重排，"列表增删时其他项平滑让位"几乎白送。
   *
   * 用法（一句话）：
   * ```ts
   * const spec = presets.list.shift()          // 默认 300ms easeOut、无交错
   * engine.flipCapture()                        // 变更前记快照
   * applyListMutation()                         // 增删数据 → 布局变
   * engine.flipStart(spec)                      // 启动补间
   * ```
   */
  shift(opts: { durationMs?: number; curve?: CurveName; staggerMs?: number } = {}): ListShiftSpec {
    return {
      name: 'listShift',
      durationMs: opts.durationMs ?? 300,
      curve: opts.curve ?? 'easeOut',
      staggerMs: opts.staggerMs ?? 0,
    }
  },
} as const

export const element = {
  /** **淡入**（透明度 0 → 1；可加轻微上移，避免"平淡地出现"） */
  fadeIn(opts: { durationMs?: number; risePx?: number; delayMs?: number } = {}): ElementSpec {
    const dur = opts.durationMs ?? 240
    const rise = opts.risePx ?? 0
    const decls: AnimDecl[] = [
      { kind: 'opacity', from: 0, to: 1, curve: 'easeOut', durationMs: dur, delayMs: opts.delayMs },
    ]
    if (rise > 0) {
      decls.push({ kind: 'translateY', from: rise, to: 0, curve: 'easeOut', durationMs: dur, delayMs: opts.delayMs })
    }
    return { name: 'fadeIn', decls, durationMs: dur }
  },

  /**
   * **按压反馈**（松手弹回：`from` 是按下时的缩放，弹回 1）
   *
   * ★**诚实边界（引擎能力决定形态）**：内核对同 (节点,属性) 是**替换**语义 ⇒
   *   "按下 → 弹回"**两段序列**在一个批次里表达不了（第二条会替换第一条）。
   *   ⇒ 本预设只做**弹回段**；按下段由调用方在 `pressStart` 时单独启动
   *   （或直接用 `spring` 从按下值弹回——这也是最常用的用法）。
   *   ★序列编排（sequence）是已知缺口，见 README「未做」一节。
   */
  pressRelease(opts: { fromScale?: number } = {}): ElementSpec {
    const sc = opts.fromScale ?? 0.96
    return {
      name: 'pressRelease',
      decls: [{ kind: 'scale', from: sc, to: 1, spring: easing.snappy }],
      durationMs: 400,
    }
  },

  /**
   * ★★**按压反馈（两段序列）**——按下后回弹，**一条动画**表达完整序列（MA6 起）
   *
   * 【这条预设是"序列编排"的存在理由】此前只能做"弹回段"（`pressRelease`），
   *   因为内核对同 (节点,属性) 是替换语义、两条 scale 会互相覆盖；
   *   MA6 的 `keyframes` 让"下压 → 回弹"收敛在**一条**动画里，且提交平台路径时仍是**一条**
   *   `CAKeyframeAnimation`（不额外增加提交次数）。
   */
  press(opts: { fromScale?: number; downMs?: number; upMs?: number; downCurve?: CurveName; upCurve?: CurveName } = {}): ElementSpec {
    const sc = opts.fromScale ?? 0.94
    const downMs = opts.downMs ?? 90
    const upMs = opts.upMs ?? 260
    return {
      name: 'pressSequence',
      decls: [
        {
          kind: 'scale',
          from: 1,
          to: 1,
          keyframes: [
            { to: sc, durationMs: downMs, curve: opts.downCurve ?? 'easeOut' },
            { to: 1, durationMs: upMs, curve: opts.upCurve ?? 'springApprox' },
          ],
        },
      ],
      durationMs: downMs + upMs,
    }
  },

  /**
   * **抖动（错误提示）**——水平往复三段，末段回到起点
   *
   * ★为什么"末段必须回 0"：抖动是**扰动**，不是位移；末段不回 0 会让元素永久偏移
   *   （这是"看起来对、实际错位"的典型）。预设已保证末段 `to: 0`。
   */
  shake(opts: { amplitude?: number; durationMs?: number } = {}): ElementSpec {
    const amp = opts.amplitude ?? 10
    const dur = opts.durationMs ?? 360
    const seg = dur / 3
    return {
      name: 'shake',
      decls: [
        {
          kind: 'translateX',
          from: 0,
          to: 0,
          keyframes: [
            { to: -amp, durationMs: seg, curve: 'easeOut' },
            { to: amp, durationMs: seg, curve: 'easeInOut' },
            { to: 0, durationMs: seg, curve: 'easeOut' },
          ],
        },
      ],
      durationMs: dur,
    }
  },

  /**
   * ★★**共享元素**（跨元素/跨页面飞行）——Morpheus §6.1 清单最后一项
   *
   * 【与 `sharedElementFlyIn` 的本质差别】那个是"**在落点上**做缩放+淡入"（不需要源几何）；
   *   本条是**真·共享元素**：从**源矩形**飞到目标位置再归位——需要"源"的稳态几何。
   *
   * 【源有两种，覆盖两种场景】
   *   - `fromNodeId`：**同树节点**（同页面内的共享元素，如列表项 → 扩展卡）；
   *   - `fromRect`：**系统坐标矩形**（跨页面/跨稳态，如"上一页的缩略图位置"——
   *     该几何由调用方注入：静态布局（tab/宫格/固定 header）可在**编译期**算出、随指令一起下发，
   *     只有真正运行期才知道的才由宿主上报）。
   *
   * 【几何数学在内核，本预设只是"声明"】编译产物带 `shared: {sourceRect | sourceNodeId}`，
   *   由宿主交 `proteus_layout_shared_element` 处理（中心差 + 宽度比 + 缓动都在内核）。
   *
   * ★诚实边界（见 README「未做」）：内核只有**等比** scale ⇒ 以宽度比为准，
   *   源/目标宽高比不一致时高度按目标比例推出。
   */
  sharedElement(opts: { fromRect?: { x: number; y: number; w: number; h: number }; fromNodeId?: number; durationMs?: number; fadeIn?: boolean } = {}): SharedElementSpec {
    if (!opts.fromRect && opts.fromNodeId === undefined) {
      throw new Error('sharedElement 需要源：给 fromRect（系统坐标）或 fromNodeId（同树节点）')
    }
    if (opts.fromRect && opts.fromNodeId !== undefined) {
      throw new Error('sharedElement 的源只能给一个：fromRect 与 fromNodeId 二选一')
    }
    return {
      name: 'sharedElement',
      durationMs: opts.durationMs ?? 400,
      fadeIn: opts.fadeIn !== false,
      ...(opts.fromRect ? { fromRect: opts.fromRect } : { fromNodeId: opts.fromNodeId! }),
    }
  },

  /** **共享元素飞入**（在同树落点上做缩放+淡入——不需要源几何的简化形态） */
  sharedElementFlyIn(opts: { fromScale?: number; durationMs?: number } = {}): ElementSpec {
    const dur = opts.durationMs ?? 400
    const sc = opts.fromScale ?? 0.4
    return {
      name: 'sharedElementFlyIn',
      decls: [
        { kind: 'scale', from: sc, to: 1, spring: easing.smooth },
        { kind: 'opacity', from: 0, to: 1, curve: 'easeOut', durationMs: dur },
      ],
      durationMs: dur,
    }
  },
} as const

/* ────────────────────── 滚动联动预设（MA5：吸顶 / 视差 / 渐显） ────────────────────── */

/** 滚动联动预设（一组"随滚动位置变化"的声明；窗口单位 = 滚动位置 px） */
export interface ScrollSpec {
  name: string
  decls: AnimDecl[]
  /** 名义窗口（供调用方做布局/调试参考；真正的窗口在每条 decl 的 `scroll` 里） */
  window: { from: number; to: number }
}

/**
 * ★★**滚动联动**（MA5）——"滚动位置 → 动画进度"的预设
 *
 * 【驱动通路（滚动过程零 JS）】宿主滚动回调 → `anim_seek_scroll(scroll)` → 内核
 *   一次算完所有窗口动画并写字段 → 宿主把 `updates` 当帧刷层。
 *   JS 与曲线数学都不在链路上（换算在内核，见 `AnimEngine::seek_scroll`）。
 *
 * 【为什么窗口语义（而非"滚动百分比"）】视差/吸顶的阈值都是**像素位置**（"滚过 120px 后标题吸住"），
 *   与视口高度无关；用百分比会让不同机型的联动区间不一致。
 */
export const scroll = {
  /**
   * **吸顶**（滚过 `pinAt` 后头部固定：用反向位移抵消继续滚动）
   *
   * ★实现说明：本引擎只写**合成属性**（translate/opacity）⇒ 吸顶表达为
   *   `translateY: 0 → -(scrollSpan)` 的窗口动画，配合布局让位实现"钉住"观感；
   *   真·改变定位（position: sticky）属布局属性，不在本引擎属性面上（编译期会拦）。
   */
  sticky(opts: { pinAt?: number; span?: number; nodeIdHint?: string } = {}): ScrollSpec {
    const pinAt = opts.pinAt ?? 80
    const span = opts.span ?? 120
    return {
      name: 'scrollSticky',
      decls: [{ kind: 'translateY', from: 0, to: -span, curve: 'linear', scroll: { from: pinAt, to: pinAt + span } }],
      window: { from: pinAt, to: pinAt + span },
    }
  },

  /**
   * **视差**（背景层随滚动反向慢移；`factor` 0..1 = 慢移比例）
   *
   * `factor=0.4` ⇒ 滚过 100px 时背景只上移 40px（相对前景的"景深感"）。
   */
  parallax(opts: { factor?: number; from?: number; to?: number } = {}): ScrollSpec {
    const factor = opts.factor ?? 0.4
    const from = opts.from ?? 0
    const to = opts.to ?? 400
    return {
      name: 'scrollParallax',
      decls: [
        {
          kind: 'translateY',
          from: 0,
          to: -(to - from) * factor,
          curve: 'linear',
          scroll: { from, to },
        },
      ],
      window: { from, to },
    }
  },

  /**
   * **渐显**（滚入 `from..to` 区间内透明度 0 → 1；可叠加轻微上移）
   *
   * ★`from/to` 通常取"元素进入视口"的滚动位置区间（由布局计算给出，预设不猜）。
   */
  fadeIn(opts: { from: number; to: number; risePx?: number }): ScrollSpec {
    const rise = opts.risePx ?? 0
    const decls: AnimDecl[] = [
      { kind: 'opacity', from: 0, to: 1, curve: 'easeOut', scroll: { from: opts.from, to: opts.to } },
    ]
    if (rise > 0) {
      decls.push({ kind: 'translateY', from: rise, to: 0, curve: 'easeOut', scroll: { from: opts.from, to: opts.to } })
    }
    return { name: 'scrollFadeIn', decls, window: { from: opts.from, to: opts.to } }
  },
} as const

/** 全部预设（单一入口——便于官网/AI 说明书枚举） */
export const presets = { route, list, element, easing, scroll, choreograph } as const
