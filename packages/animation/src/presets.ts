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
import type { AnimDecl, CurveName, SpringConfig } from './types'

/* ────────────────────────── 手感预设（弹簧） ────────────────────────── */

/**
 * 弹簧预设（**与内核 `SpringParams::snappy/smooth` 同值**——跨语言契约）
 *
 * ★为什么钉在预设里而不是让开发者调参：手调 damping/stiffness/mass 是四个坑之一（§2）。
 * ★跨语言一致性：内核 `layout-core-rust/src/anim.rs` 的 `SpringParams::snappy()/smooth()`
 *   是**同一组数值**；两侧各有测试钉住（TS 侧 `presets.test.ts`，Rust 侧 `anim.rs` 单测）。
 */
export const easing = {
  /** 快速、微回弹（对齐 iOS `.snappy`） */
  snappy: { stiffness: 320, damping: 30, mass: 1 } as SpringConfig,
  /** 顺滑、几乎无回弹（对齐 iOS `.smooth`） */
  smooth: { stiffness: 180, damping: 26, mass: 1 } as SpringConfig,
} as const

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

  /** **共享元素飞入**（B1 benchmark 的核心环节；从起点矩形飞入到当前位置） */
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

/** 全部预设（单一入口——便于官网/AI 说明书枚举） */
export const presets = { route, list, element, easing } as const
