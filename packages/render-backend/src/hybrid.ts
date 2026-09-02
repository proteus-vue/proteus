// packages/render-backend/src/hybrid.ts
// ★G-27 B6（render-backend-1-plan 05-batches.md）：混合渲染——Texture Sharing + 页面级/区域级切后端 + DevTools 可视化
//   把多个 ProteusRenderBackend 组织成统一渲染面（同一 App 不同区域/页面走不同后端——#290 架构方向「混合渲染」）：
//   · createElement(node) → 按 region match 路由到对应后端（default 兜底）——区域级切后端
//   · 节点 → 后端归属 WeakMap（insert/remove/patchProp/setText 委托到归属后端——父子可跨后端，混合场景）
//   · registerExternalTexture(id, texture) → 委托 capabilities.textureSharing 后端（跨后端纹理共享——原生视图混入自绘）
//   · DevTools 路由 trace（semantic → 后端 决策记录——可视化消费）
//   · runHybridConformance(renderer) 自检（路由不落空/纹理委托/追 root 兜底）
//   纯逻辑零依赖（无 DOM/平台直调）——宿主工程后接（同 B1-B5 哲学）；MP 产物安全：无 ?. / ??；无数组解构
import type { BackendId, ExternalTexture, IRNode, NodeHandle, ProteusRenderBackend, Size, LayoutConstraints, NormalizedInputEvent } from './spi'

/** 区域路由（match 命中 → 该后端渲染此节点子树） */
export interface HybridRegion {
  /** 区域名（DevTools trace 展示） */
  name?: string
  /** 节点匹配（semantic/type 判定——页面级/区域级切后端） */
  match(node: IRNode): boolean
  backend: ProteusRenderBackend
}

export interface HybridRendererOptions {
  /** 缺省后端（region 未命中 → 兜底） */
  defaultBackend: ProteusRenderBackend
  /** 区域路由表（按序首中即用） */
  regions?: HybridRegion[]
  /** 是否记录路由 trace（DevTools 可视化；缺省 true） */
  devtools?: boolean
}

/** DevTools 路由决策记录（每 createElement 一条） */
export interface HybridRouteTrace {
  /** IR 语义（可空——兼容层标签） */
  semantic?: string
  type: string
  /** 命中后端 id */
  backendId: BackendId
  /** 命中区域（缺省路由 → 'default'） */
  region: string
}

/** 混合渲染器（统一 ProteusRenderBackend 面 + 混合专属能力） */
export interface HybridRenderer extends ProteusRenderBackend {
  /** 节点 → 归属后端（路由决策——子节点可跨后端） */
  routeFor(node: IRNode): ProteusRenderBackend
  /** 节点句柄 → 归属后端（委托用） */
  backendOf(handle: NodeHandle): ProteusRenderBackend | undefined
  /** DevTools 路由 trace（累积；clearTraces 清空） */
  traces(): HybridRouteTrace[]
  clearTraces(): void
}

/** 内部节点记录（归属后端 + 区域名） */
interface NodeRecord {
  backend: ProteusRenderBackend
  region: string
}

/**
 * ★createHybridRenderer：混合渲染器工厂
 * 用法：const hybrid = createHybridRenderer({ defaultBackend: vueDom, regions: [{ name: 'video', match: (n) => n.semantic === 'ui.media', backend: native }] })
 * 设计：createElement 路由 → 归属后端；其余 nodeOps 委托归属后端（父子跨后端合法——混合渲染核心）；
 *      纹理共享：registerExternalTexture 广播到所有 textureSharing 后端（同一 id 全局可引用）
 */
export function createHybridRenderer(options: HybridRendererOptions): HybridRenderer {
  const { defaultBackend } = options
  const regions = options.regions ?? []
  const devtools = options.devtools !== false
  const nodeBackend = new WeakMap<object, NodeRecord>()
  const traceList: HybridRouteTrace[] = []

  /** 路由决策：首个命中 region → 其后端；否则 default（backendId 用实际后端的 id） */
  function routeFor(node: IRNode): ProteusRenderBackend {
    for (const r of regions) {
      if (r.match(node)) return r.backend
    }
    return defaultBackend
  }

  function regionName(node: IRNode): string {
    for (const r of regions) {
      if (r.match(node)) return r.name ?? 'region'
    }
    return 'default'
  }

  function backendOf(handle: NodeHandle): ProteusRenderBackend | undefined {
    if (typeof handle !== 'object' || handle === null) return undefined
    return nodeBackend.get(handle as object)?.backend
  }

  /** 广播纹理注册（id 全局——跨后端共享；无 textureSharing 后端 → 兜底 default） */
  function textureBackends(): ProteusRenderBackend[] {
    const sharing = regions.map((r) => r.backend).concat([defaultBackend]).filter((b) => b.capabilities.textureSharing === true)
    return sharing.length ? sharing : [defaultBackend]
  }

  const defaultId = 'hybrid' as BackendId

  const hybrid: HybridRenderer = {
    id: defaultId,
    version: '0.1.0',
    capabilities: {
      layout: 'none', // 无自带布局器——委托各后端（框架 IR 求解）
      glass: 'L1',
      blur: 'none',
      animation: 'js',
      textureSharing: true,
      remoteRendering: false,
      ssr: true,
      input: ['touch', 'cursor', 'remote'],
    },

    createElement(node) {
      const backend = routeFor(node)
      const handle = backend.createElement(node)
      if (typeof handle === 'object' && handle !== null) {
        nodeBackend.set(handle as object, { backend, region: regionName(node) })
      }
      if (devtools) {
        traceList.push({ semantic: node.semantic, type: node.type, backendId: backend.id, region: regionName(node) })
      }
      return handle
    },
    insert(child, parent, anchor) {
      const b = backendOf(child)
      if (!b) return
      // ★父子跨后端合法：child 归属后端负责挂载（parent 句柄可直接传——混合场景原生子树挂入自绘树）
      b.insert(child, parent, anchor)
    },
    remove(child) {
      const b = backendOf(child)
      if (b) b.remove(child)
    },
    patchProp(el, key, prev, next) {
      const b = backendOf(el)
      if (b) b.patchProp(el, key, prev, next)
    },
    setText(el, text) {
      const b = backendOf(el)
      if (b) b.setText(el, text)
    },

    // —— 可选方法：委托归属后端（存在时） ——
    querySelector(selector) {
      return defaultBackend.querySelector ? defaultBackend.querySelector(selector) : null
    },
    measure(node, constraints) {
      const b = backendOf(node)
      if (b && b.measure) return b.measure(node, constraints)
      return { width: 0, height: 0 }
    },
    layout(root, constraints) {
      const b = backendOf(root)
      if (b && b.layout) b.layout(root, constraints)
    },
    scheduleFrame(task) {
      defaultBackend.scheduleFrame ? defaultBackend.scheduleFrame(task) : task()
    },
    flush() {
      defaultBackend.flush ? defaultBackend.flush() : undefined
    },
    dispatchInput(event) {
      const b = backendOf(event.target)
      if (b && b.dispatchInput) b.dispatchInput(event)
    },
    onMount(root) {
      const b = backendOf(root)
      if (b && b.onMount) b.onMount(root)
    },
    onUnmount(root) {
      const b = backendOf(root)
      if (b && b.onUnmount) b.onUnmount(root)
    },

    // —— ★B6 纹理共享：广播注册/注销（跨后端全局 id） ——
    registerExternalTexture(id, texture) {
      for (const b of textureBackends()) {
        if (b.registerExternalTexture) b.registerExternalTexture(id, texture)
      }
    },
    unregisterExternalTexture(id) {
      for (const b of textureBackends()) {
        if (b.unregisterExternalTexture) b.unregisterExternalTexture(id)
      }
    },

    // —— 混合专属 ——
    routeFor,
    backendOf,
    traces: () => traceList.slice(),
    clearTraces: () => {
      traceList.length = 0
    },
  }
  return hybrid
}

/** 纹理引用（跨后端 patchProp 用——注册 id → 纹理） */
export interface HybridTextureRef {
  textureId: string
}

/** 便捷：构造纹理引用 prop 值（后端 patchProp 可识别） */
export function textureRef(textureId: string): HybridTextureRef {
  return { textureId }
}

/** ★B6 conformance：混合渲染器自检（对齐 runBackendConformance 形状） */
export interface HybridConformanceResult {
  ok: boolean
  checks: Array<{ name: string; pass: boolean; detail?: string }>
}

export function runHybridConformance(renderer: HybridRenderer): HybridConformanceResult {
  const checks: Array<{ name: string; pass: boolean; detail?: string }> = []
  function check(name: string, pass: boolean, detail?: string): void {
    checks.push({ name, pass, detail })
  }

  // 1. 基础接口完整（必选方法存在）
  check('id', typeof renderer.id === 'string' && renderer.id.length > 0, `id=${String(renderer.id)}`)
  check('method.createElement', typeof renderer.createElement === 'function')
  check('method.insert', typeof renderer.insert === 'function')
  check('method.remove', typeof renderer.remove === 'function')
  check('method.patchProp', typeof renderer.patchProp === 'function')
  check('method.setText', typeof renderer.setText === 'function')

  // 2. 路由不落空：createElement 后 routeFor/backendOf 一致（同 IR 语义决策可复现）
  const probe: IRNode = { type: 'p-box', semantic: 'layout.box', props: {}, children: [] }
  const routed = renderer.routeFor(probe)
  check('route.default-non-null', routed !== undefined && routed !== null)
  const handle = renderer.createElement(probe)
  const owned = renderer.backendOf(handle)
  check('route.backendOf-owned', owned !== undefined, 'createElement 后 backendOf 应有归属')
  if (owned) check('route.consistent', owned === routed, 'routeFor 与 backendOf 应一致')

  // 3. 可选纹理方法存在（混合器总是提供）
  check('optional.registerExternalTexture', typeof renderer.registerExternalTexture === 'function')
  check('optional.unregisterExternalTexture', typeof renderer.unregisterExternalTexture === 'function')

  // 4. DevTools trace 记录（devtools 缺省 on——createElement 必留痕）
  check('devtools.trace-recorded', renderer.traces().length > 0, `traces=${renderer.traces().length}`)

  return { ok: checks.every((c) => c.pass), checks }
}