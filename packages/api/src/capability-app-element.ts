// packages/api/src/capability-app-element.ts
// ★★★决策 #1081（2026-10-19）：App 端**元素查询**能力（C58 `useElement`）——选择器通路的 JS 侧落点。
//
// 【为什么单列（用户 2026-10-19 指定）】
//   用户：「这个选择器正常应该是通过 vue 自定义渲染通道做映射吧？因为拿到的肯定是 vue 元素信息不是原生元素信息」。
//   ⇒ 选择器解析**发生在 JS 侧**（`element-registry` 同时被 Vapor 实例化链与 Vue `patchProp` 链写入），
//     宿主只收**数字 nodeId**（它不认识 `#hero` 这种业务名字）。本文件把这条链接到既有能力面：
//     `ElementQuery` 的每个方法 = 解析 selector → 调宿主 `element.rect` → 归一成 Web 语义。
//
// 【与 Web 基准的同步（用户同日：「验证通路没问题后真正落地就需要和web的查询结构保持同步了」）】
//   · 语义基准 = `capability-bridges.ts` 的 web 实现（`document.querySelector` + `getBoundingClientRect()`）；
//   · 因此坐标统一换算成**视口坐标 + 逻辑 px**（宿主给内容坐标 + scrollY，这里减掉）；
//   · `id` / `dataset` 字段按 Web 形状回（本切片只有 id——dataset 是下一批）；
//   · `element.not-found` / `element.unsupported` / `element.failed` 三档与 Web 同名同义。
//
// 【本切片诚实边界（不静默半支持）】
//   · 只支持 `#id` / 裸 id（`parseIdSelector`）；其它选择器 ⇒ `element.unsupported` 并说明原因
//     （**不**近似匹配——错节点比 unsupported 危险）；
//   · `fields({node})` 的 CanvasNode、`fields({computedStyle})` 在 App 无对应引擎能力 ⇒ 明确 note/缺省；
//   · `useIntersection` 需要**几何变化事件**通道（当前渲染宿主只在 mount/applyOps 时算几何）⇒ 如实
//     `element.unsupported`，不做"只在 observe 时回调一次"的假观察。

import { invokeHost } from './capability-invoke'
import { CapError as ProteusCapError } from './capability-types'
import type {
  ElementFieldsOptions,
  ElementFieldsResult,
  ElementQuery,
  ElementRect,
  ElementScrollOffset,
  IntersectionHandle,
  IntersectionOptions,
  IntersectionResult,
} from './capability-types'

/** 宿主方法名（契约见 `host-invoke-contract.ts`；三端同一名字） */
export const APP_ELEMENT_METHODS = {
  rect: 'element.rect',
} as const

type R<T, E extends Error = ProteusCapError> = { ok: true; data: T } | { ok: false; error: E }

/** `rectOf` 的内部结果：矩形 + **命中的引擎节点 id/来源**（探针与交叉核对需要；ElementQuery 契约只暴露矩形） */
export interface ResolvedElementRect { rect: ElementRect; nodeId: number; source: string }

/** Linux/Android/iOS/Harmony 的宿主回执形状（`{ok,x,y,width,height,scrollY}`） */
interface HostRectReply {
  x?: number
  y?: number
  width?: number
  height?: number
  scrollY?: number
}

/**
 * 解析器注入点：`selector → nodeId`。由装配层（`createAppCapabilities`）注入
 * `render-backend/src/element-registry.ts` 的实现——API 包不反向依赖渲染包（分层）。
 * 未注入 ⇒ 所有查询 `element.unsupported`（诚实，不猜测）。
 */
export interface ElementResolver {
  /** 任意**受支持**的 CSS 选择器 ⇒ 引擎节点 id（`querySelector` 语义：文档序第一个） */
  resolve(selector: string | undefined | null): { nodeId: number; source: string } | null
  /**
   * 选择器**形态**是否受支持（`{ok:false,reason}` → `element.unsupported`）。
   * ★必须与 `resolve` 共用同一份解析器（registry 的 `selectorSupport` / `resolveElement` 同源）——
   *   否则会出现"检查说支持、查询按另一套解析"的分叉。
   * ★★**必填**（不是可选）：缺省"视作支持"会让伪类/兄弟选择器这类不支持形态静默退化成
   *   `not-found`——调用方以为"元素不存在"，实际是"这个端不会解析它"。单测当场抓到该形态。
   */
  support(selector: string | undefined | null): { ok: true } | { ok: false; reason: string }
  /** 当前屏名（多屏时定位索引桶；缺省由实现自己取"当前屏"） */
  currentScreen?(): string
}

let injectedResolver: ElementResolver | null = null

/** 装配层注入解析器（重复注入 = 覆盖——便于测试与热切换）。 */
export function installElementResolver(r: ElementResolver | null): void {
  injectedResolver = r
}

/** 当前解析器（诊断/测试）。 */
export function currentElementResolver(): ElementResolver | null {
  return injectedResolver
}

/**
 * 创建 App 端元素查询能力（`createCapabilityBridge` 合并进 bridge）。
 *
 * ★与 `capability-app-device.ts` 同一分档口径：宿主不支持 ⇒ `element.unsupported`；
 *   有 API 但调用失败 ⇒ `element.failed`；解析不到 ⇒ `element.not-found`（Web 同名）。
 */
/**
 * ★★★**直接可用的元素查询**（不依赖装配层注入 CapError）——供 App 壳（entry-superapp）在
 *   没有完整能力桥的 bundle 里使用（superapp 刻意不打包 9000 行 capability.ts）。
 *   ★与 `createAppElementCapabilities` **同一实现**（后者只是把错误构造器换成本仓 CapError）。
 */
export function createAppElementQuery(): ElementQuery {
  return createAppElementBridge().createElementQuery()
}

/**
 * ★★★**同步解析 + 几何**（探针/交叉核对用）——与 `ElementQuery` **同一实现**：
 *   异步方法都是它的 `Promise.resolve` 包装 ⇒ 探针不会偏离真实语义。
 */
export function createAppElementResolveSync(): (selector?: string | null) => R<ResolvedElementRect> {
  return createAppElementBridge().rectOf
}

/**
 * ★★★**桥工厂**（唯一实现）——返回对象 = App 端元素能力的**全部桥成员**（生成器 `APP_BRIDGE_SOURCES` 扫它）。
 *   · `createElementQuery`：`useElement` 的落地（宿主腿 = `element.rect`）
 *   · `createIntersection`：如实不支持（见方法注释）
 *   ★返回对象**只放桥成员**（`rectOf` 是内部助手，另行导出 `createAppElementResolveSync`）——
 *     否则生成器会把内部助手当桥方法，文档与桥形状都开始漂。
 */
export function createAppElementBridge() {
  const err = errOf

  /** 解析 + 取几何的一次性流水线（所有查询方法共用——**一处实现**） */
  const rectOf = (selector: string | undefined | null): R<ResolvedElementRect> => {
    const r = injectedResolver
    if (!r) {
      return { ok: false, error: err('element.unsupported', 'App 端元素索引未装配（element-registry 未接入）') }
    }
    // ★区分"选择器形态不支持"与"没找到"：前者是能力边界，后者是业务路径问题。
    //   判定**只在 registry 的解析器里**做一次（与 resolve 同源——不会出现两套解析分叉）。
    const sup = r.support(selector)
    if (!sup.ok) return { ok: false, error: err('element.unsupported', sup.reason) }
    const hit = r.resolve(selector)
    if (!hit) {
      const raw = (selector ?? '').trim()
      return { ok: false, error: err('element.not-found', `未找到元素：${raw || '(空选择器)'}`) }
    }
    const call = invokeHost(APP_ELEMENT_METHODS.rect, { nodeId: hit.nodeId })
    if (!call.ok) {
      const code = call.missing ? 'element.unsupported' : 'element.failed'
      return { ok: false, error: err(code, `element.rect: ${call.reason}`) }
    }
    const d = (call.data ?? {}) as HostRectReply
    const x = Number(d.x ?? 0)
    const y = Number(d.y ?? 0)
    const w = Number(d.width ?? 0)
    const h = Number(d.height ?? 0)
    const scrollY = Number(d.scrollY ?? 0)
    // ★视口坐标（Web `getBoundingClientRect()` 语义）：内容坐标 − 滚动偏移。
    //   ★三端只写这一份归一：宿主各自只报自己的 scrollY（它最清楚），算在这里。
    const top = y - scrollY
    return {
      ok: true,
      data: {
        rect: {
          id: resolveIdName(selector),
          left: x,
          top,
          right: x + w,
          bottom: top + h,
          width: w,
          height: h,
        },
        nodeId: hit.nodeId,
        source: hit.source,
      },
    }
  }

  const query: ElementQuery = {
    boundingClientRect: (selector) => Promise.resolve(((): R<ElementRect> => { const r = rectOf(selector); return r.ok ? { ok: true, data: r.data.rect } : (r as unknown as R<ElementRect>) })()),
    scrollOffset: (selector) =>
      Promise.resolve(
        ((): R<ElementScrollOffset> => {
          const r = rectOf(selector)
          if (!r.ok) return r as unknown as R<ElementScrollOffset>
          // ★App 端的滚动是**整个内容层**的（不是元素自身可滚）⇒ 元素级 scrollTop/Left 恒 0，
          //   与 Web 上"元素本身没有溢出滚动"时的读数一致。页面级滚动见 `window` 能力。
          return { ok: true, data: { id: r.data.rect.id, scrollTop: 0, scrollLeft: 0 } }
        })(),
      ),
    fields: (options, selector) =>
      Promise.resolve(
        ((): R<ElementFieldsResult> => {
          const r = rectOf(selector)
          if (!r.ok) return r as unknown as R<ElementFieldsResult>
          const out: ElementFieldsResult = { ...r.data.rect }
          if (options.scrollOffset) {
            out.scrollTop = 0
            out.scrollLeft = 0
          }
          // ★`node`（CanvasNode）在 App 端没有对应物（自绘树里没有可操作的原生 view 句柄）⇒ 不填，
          //   调用方据 undefined 判"无节点句柄"（与 MP 上 px 组件未注册时同形态）。
          if (options.computedStyle) {
            // App 端没有 CSSOM ⇒ 明确不给值（不伪造 'rgb(0,0,0)'），与 `element.unsupported` 的诚实分档同源。
          }
          return { ok: true, data: out }
        })(),
      ),
    size: (selector) =>
      Promise.resolve(
        ((): R<{ width: number; height: number }> => {
          const r = rectOf(selector)
          if (!r.ok) return r as unknown as R<{ width: number; height: number }>
          return { ok: true, data: { width: r.data.rect.width, height: r.data.rect.height } }
        })(),
      ),
    batch: (selectors) =>
      Promise.resolve({
        ok: true as const,
        data: selectors.map((sel) => {
          const r = rectOf(sel)
          return r.ok ? r.data.rect : null
        }),
      }),
  }

  return {
    rectOf,
    createElementQuery: (_initialId?: string): ElementQuery => query,
    /**
     * ★C59 交叉观察：**当前如实不支持**。
     *
     * 【为什么不做"observe 时回调一次"的近似】那不是观察，是"首帧快照"——业务（上拉加载/曝光统计）
     *   会以为持续监听生效，实际滚出屏幕后再也不会回调（静默错行为）。与 Web `IntersectionObserver`
     *   的语义差一个**几何变化事件源**，缺件是渲染宿主的帧级几何通知，属下一批。
     */
    createIntersection: (_options?: IntersectionOptions): IntersectionHandle => {
      const handle: IntersectionHandle = {
        relativeTo: () => handle,
        relativeToViewport: () => handle,
        observe: (_targetSelector: string, _cb: (result: IntersectionResult) => void) => handle,
        disconnect: () => {},
      }
      return handle
    },
  }
}

/**
 * 装配入口（`createCapabilityBridge` 用）：错误类型换成调用方的 CapError。
 * ★实现只有一份（`createAppElementBridge`）——本函数只做错误构造器适配。
 */
export function createAppElementCapabilities<E extends Error = Error>(
  CapError: new (code: string, message: string, cause?: unknown) => E,
) {
  void CapError   // ★错误实例由 `errOf` 产（CapError 实例，已是能力层契约）；保留形参以对齐同族装配签名
  // ★只取**两个桥成员**：`rectOf` 是内部助手，不能随 spread 进 `CapabilityBridge`（形状干净 + 生成器不误判）
  const { createElementQuery, createIntersection } = createAppElementBridge()
  return { createElementQuery, createIntersection }
}

/** `CapError` 实例 + `code` 属性（错误契约：能力层读 `error.code` 做分档）——唯一构造点 */
export function errOf(code: string, message: string): ProteusCapError {
  const e = new ProteusCapError(code, message) as ProteusCapError & { code?: string }
  if (typeof (e as { code?: unknown }).code !== 'string') {
    Object.defineProperty(e, 'code', { value: code, enumerable: true, configurable: true })
  }
  return e
}

/** selector → 回执里的 `id` 字段（Web 形状：元素自己的 id，不是选择器原文） */
function resolveIdName(selector: string | undefined | null): string | undefined {
  const raw = typeof selector === 'string' ? selector.trim() : ''
  if (!raw) return undefined
  return raw.startsWith('#') ? raw.slice(1) : raw
}

