// src/compiler/index.ts
// 编译引擎公开 API —— 未来独立包 @proteus-vue/compiler 的入口
// 约束：本模块及同目录文件不得 import vite / proteus.config，选项全部入参
import { parse as sfcParse } from '@vue/compiler-sfc'
// ★GP3-b1（2026-10-03）：Global 层共享状态模块路径（插件按此产出通道；契约单一来源）
import { GLOBAL_LAYER_STATE_MODULE } from '@proteus-vue/contracts'
import { transformTemplateToWxml } from './template'
import { transformScriptToPage } from './script'
import { transformStyleToWxss, BASE_SEMANTIC_WXSS } from './style'
import { assertValidResult, CompilerError } from './validate'
// ★LY1（2026-10-02）：页面层级语义校验（四层语义 + 跨容器强制——规范 §3.5/§4.1）
import { validateLayerUsage } from './layer-safety'
// ★★★GP2-b/c/d（2026-10-03）：三层挂载硬约束（C1 声明位置 / C2 全局层节点上限 / C3 禁路由动作）
import { validateMountLayerUsage } from './template'
// ★SC2（2026-10-02）：可停靠滚动容器的声明面校验（封闭集 + 五条硬约束——方案 §6.2/§6.3）
import { validateScrollUsage } from './scroll-safety'
import { createTrace } from './trace'
// ★卡 C4：编译期漏点计数器（只归纳既有诊断与规则 ID，不新增判断——见其文件头）
import { GapCounter } from './gap-counter'
import { buildCompileIR, emptyScriptIR } from './ir/build'
import type { CompileOptions, CompileResult } from './types'
import { extractSfcMacros, renameModelVarsInWxml } from './sfc-macros'
import { applyPlatformMacros } from './platform-macros'
// ★平台编译期宏（条件显隐）：供构建配置（vite define / esbuild define）复用同一取值表
export { applyPlatformMacros, applyPlatformMacrosInSfc, platformDefines } from './platform-macros'
// ★平台变体解析（工程架构基础层）：业务代码/组件/静态资源/路由 四层共用的解析规则
export {
  VARIANT_PLATFORMS, VARIANT_SUFFIXES, CONCRETE_PLATFORMS,
  normalizePlatform, platformFamily, platformFromBuildTarget, variantSuffixes,
  splitVariant, variantCandidates, resolvePlatformVariant, resolvePlatformVariantWithExts,
  isForeignVariant, pickVariant, effectiveVariants, mapPublicAssetVariants,
} from './platform-variant'
export type { VariantPlatform, ConcretePlatform, PlatformFamily } from './platform-variant'
export type { PlatformTarget } from './platform-macros'

/** djb2 哈希 → scoped 属性名（稳定：同文件同 scopeId；零依赖纯函数） */
export function scopedIdFrom(filename: string): string {
  let hash = 5381
  for (let i = 0; i < filename.length; i++) {
    hash = ((hash << 5) + hash + filename.charCodeAt(i)) >>> 0
  }
  return `data-v-${hash.toString(16).slice(0, 6)}`
}

export type {
  CompileOptions,
  CompileResult,
  Renderer,
  StyleTransformOptions,
  TemplateTransformOptions,
  TemplateTransformResult,
  ScriptTransformOptions,
  ScriptTransformResult,
  CompileIR,
  TemplateIR,
  ScriptIR,
} from './types'

export { transformTemplateToWxml } from './template'
// ★GP2-b/c/d（2026-10-03）：三层挂载硬约束校验（C1/C2/C3——供门禁/工具独立消费）
export { validateMountLayerUsage } from './template'
export { transformScriptToPage } from './script'
export { transformStyleToWxss } from './style'
export { validateJs, validateWxml, validateWxmlPlatform, scanWxmlPlatformIssues, validateMpJsPlatform, scanMpUnsafeEs5, assertValidResult, CompilerError } from './validate'
export type { WxmlPlatformIssue } from './validate'

// ★G-22 柔性布局（fluid-layout-plan B1）：clamp 生成 / 断点推导 / 网格列数（Web/Skyline 编译期用）
export { generateClamp, linearFluid, deriveBreakpoints, calcColumns, gridTemplate, parseFluidExpr, DEFAULT_VIEWPORT_RANGE, DEFAULT_BREAKPOINT_RATIOS } from './fluid-layout'
export type { Breakpoint, ViewportRange, FluidGroup } from './fluid-layout'

// ★#505 CompileIR 构建（M1 骨架搬迁：TemplateTransformResult → TemplateIR 投影）
export { buildTemplateIR, buildCompileIR } from './ir/build'

// AI-native 透明定位：编译规则注册表（每条规则一份 AI 说明书）
export { listTransformRules, getTransformRule, formatTransformRule, formatTransformCatalog, executeRule } from './transforms/registry'
export type { TransformRule, TransformPhase, RuleStatus, RuleContext, RuleApplier } from './transforms/types'
export type { TransformRuleOverrides } from './types'
// ★★2026-09-08 立项：Vue 全能力基准线 SSOT（proteus-compiler-vue-align-plan）
export { VUE_COMPAT_MATRIX, VUE_COMPAT_UNKNOWN, vueCompatStatus, vueCompatLevel } from './vue-compat'
export type { VueCompatEntry, VueCompatStatus, VueCompatGroup } from './vue-compat'
// ★★2026-09-08 架构定调：宏语义权威源 = @vue/compiler-sfc compileScript（不手造）；见 sfc-macros.ts
// eslint-disable-next-line import/no-named-as-default
export { extractSfcMacros } from './sfc-macros'
// ★Vapor for Proteus IR（V2）：编译期响应式转换——响应式源识别 / 依赖分析 / 订阅表 / 分层判定
export {
  scanReactiveSources,
  analyzeExprDeps,
  analyzeAstDeps,
  collectTemplateBindings,
  normalizePropKey,
  buildVaporSubscriptions,
  slotKindOf,
  buildLayoutTemplate,
  parseStaticStyle,
  parsePaintDeclAttr,
  isPaintDeclAttr,
  compileEvents,
} from './vapor'
export type {
  ReactiveSource,
  SourceKind,
  SourceScanResult,
  ExprDeps,
  TemplateBindingRef,
  SubscriptionTable,
  SourceSubscription,
  SlotSubscription,
  EvaluatorSpec,
  VaporBuildOptions,
  VaporBuildResult,
  VaporDiagnostic,
  VueCompatDeps,
  LayoutTemplate,
  LayoutNode,
  ListTemplate,
  EventBinding,
  HandlerAction,
  EventHandlers,
  EventCompileResult,
} from './vapor'
export type { SfcMacros, MacroModelRef } from './sfc-macros'

// 阶段二：决策 trace（explainTransform 输出源码触发的全部转换规则）
export { explainTransform, formatTransformTrace } from './explain'
export type { ExplainOptions, ExplainResult } from './explain'
export { createTrace, lineAt } from './trace'
export type { TransformTrace, TransformTraceEvent } from './trace'
// ★卡 C4：编译期漏点计数器（三类 severity + 报告；记录不阻断）
export { GapCounter, formatGapReport } from './gap-counter'
export type { PrimitiveGapRecord, GapSeverity } from './gap-counter'

/** 整包编译：标准 Vue SFC 源码 → { wxml, js, wxss }（.json 由路由生成器负责） */
export function compileVueSfc(source: string, options: CompileOptions = {}): CompileResult {
  const { descriptor } = sfcParse(source, { filename: options.filename ?? 'anonymous.vue' })
  const styleOpts = {
    px2rpx: options.px2rpx ?? true,
    rpxRatio: options.rpxRatio ?? 2,
    rules: options.rules,
    // ★平台化薄接缝：MP 渲染引擎下钻（缺省 undefined → 沿现行为；'webview' 关 Skyline-only 特判）
    renderer: options.renderer,
  }

  // scoped CSS（★2026-08 用户决策：默认 scoped）：非 <style global> 的 style 块即作用域化（类名后缀拼接）
  //   <style>（无标记）按 scoped 处理 + 编译期警告；<style global>（Proteus 扩展）显式全局（不作用域化）
  //   MVP 简化：scoped 组与 global 组分开转换输出（global 在前，可被 scoped 覆盖）
  //   ★平台变体（2026-09-13）：<style src="./theme.css"> 经 loadStyleSrc 钩子加载（适配层按平台解析
  //     变体 theme.<platform>.css）；此前 src 被**静默忽略**（样式丢失且无提示）——现加载失败显式告警。
  const styleLoadWarnings: string[] = []
  const styleSource = (s: (typeof descriptor.styles)[number]): string => {
    const src = (s as { src?: string }).src
    if (!src) return s.content
    const loaded = options.loadStyleSrc?.(src, options.filename ?? 'anonymous.vue')
    if (loaded == null) {
      styleLoadWarnings.push(`<style src="${src}"> 未能加载（无 loadStyleSrc 钩子或文件不存在）——该样式块已跳过`)
      return ''
    }
    return loaded
  }
  const globalStyles = descriptor.styles.filter((s) => s.attrs?.global !== undefined)
  const scopedStyles = descriptor.styles.filter((s) => s.attrs?.global === undefined)
  const hasScoped = scopedStyles.length > 0
  const scopeId = hasScoped ? scopedIdFrom(options.filename ?? 'anonymous.vue') : undefined
  // 决策 trace（阶段二）：三阶段共用一条链路，产物侧可据此反查规则（★底线循环 ②）
  const tplTrace = createTrace('template')
  // ★平台编译期宏（条件显隐）：__MP__/__WEB__/__TARGET__ → 该平台字面量。
  //   template 用「模板模式」（原始替换——`v-if="__MP__"` 的标识符在属性引号内但语义是表达式）；
  //   script 用「code 模式」（跳过字符串/注释——避免误改代码示例字符串，见 platform-macros.ts）。
  //   MP 的 .vue 走本编译器（绕过 vite define），故替换必须在此处做；随后模板阶段静态裁剪死分支。
  const platform = options.platform ?? 'mp'
  const tpl = applyPlatformMacros(descriptor.template?.content ?? '', platform, 'template')
  // ★★LY1（2026-10-02 · 页面层级规范 §3.5/§4.1）：层级语义的**编译期硬校验**。
  //   与 style-safety 的 zIndex=FORBIDDEN 是**两道互补闸门**：
  //   · style-safety 拦"写在 style 里的 z-index"（属性级）；
  //   · 本校验拦"层级语义本身不合法"（裸 z-index / 非法层名 / Mask 单独用 /
  //     Popout·Mask 不在根容器 / 声明框架保留层）——这些在属性级看不出来。
  //   ★**error 不是 warning**（规范 §3.5 与 §12.2 明确：禁止裸 z-index 是编译期报错）——
  //     开放数值会毁掉收敛体系（与"不开放任意原生调用"同理）。
  const layerViolations = validateLayerUsage(tpl)
  if (layerViolations.length > 0) {
    const f = options.filename ?? 'anonymous.vue'
    const detail = layerViolations
      .map((v) => `  [${v.code}] ${v.message}${v.line ? `（第 ${v.line} 行）` : ''}\n        规则：${v.rule}\n        修法：${v.hint}`)
      .join('\n')
    throw new CompilerError(f, `页面层级语义校验失败（${layerViolations.length} 条）\n${detail}`)
  }
  // ★★SC2（2026-10-02 · 可停靠滚动容器方案 §6.2）：声明面硬校验。
  //   · `SC004`（overscroll.mode='system'）是**警告级**——方案 §3.4 明确"警告 + 登记允许差异清单"，
  //     不阻断构建（它是有意的取舍，不是错误）；
  //   · 其余（SC001 档位 / SC002 协商必填 / SC003 initial / SC005 逃生口）为 **error 级**——
  //     开放这些会让跨端行为发散（与"禁止裸 z-index"同理）。
  const scrollViolations = validateScrollUsage(tpl)
  const scrollErrors = scrollViolations.filter((v) => v.code !== 'SC004')
  // ★警告级（SC004）：先收集，稍后并入 `warnings` 汇总（此时 tplResult 尚未创建）——
  //   GapCounter 会自动归类（本仓"不静默"纪律）
  const scrollWarnings = scrollViolations
    .filter((x) => x.code === 'SC004')
    .map((v) => `[${v.code}] ${v.message}（修法：${v.hint}）`)
  if (scrollErrors.length > 0) {
    const f = options.filename ?? 'anonymous.vue'
    const detail = scrollErrors
      .map((v) => `  [${v.code}] ${v.message}${v.line ? `（第 ${v.line} 行）` : ''}\n        规则：${v.rule}\n        修法：${v.hint}`)
      .join('\n')
    throw new CompilerError(f, `可停靠滚动容器声明校验失败（${scrollErrors.length} 条）\n${detail}`)
  }
  const setup = applyPlatformMacros(descriptor.scriptSetup?.content ?? descriptor.script?.content ?? '', platform, 'code')
  // ★15-page-scroll-container 批次2：页面滚动 API 桥接——检测页面声明的滚动生命周期（传给 template 绑定 scroll-view 事件）
  const pageScrollHooks = {
    hasOnPageScroll: /onPageScroll\s*\(/.test(setup),
    hasOnReachBottom: /onReachBottom\s*\(/.test(setup),
    hasOnPullDownRefresh: /onPullDownRefresh\s*\(/.test(setup),
    hasPageScrollTo: /wx\.pageScrollTo\s*\(/.test(setup),
  }
  const tplResult = transformTemplateToWxml(tpl, {
    ...styleOpts,
    filename: options.filename,
    annotateLines: options.annotateLines,
    scopeId,
    isComponent: options.isComponent,
    autoScrollContainer: options.autoScrollContainer,
    pageScrollHooks,
    // ★G-22 柔性布局：p-fluid 编译期 clamp 生成参数
    fluidLayout: options.fluidLayout,
    trace: tplTrace,
  })
  // ★★2026-09-08 架构定调：宏语义权威源 = @vue/compiler-sfc compileScript（不手造）——defineModel 经它展开
  //   _useModel(__props, name)；用其 modelRefs 驱动模板 var 改名 + 脚本 .value 读写（对齐 glass-easel 规范落地 IR）
  // ★★★GP2-b/c/d（2026-10-03）：三层挂载硬校验（**error 级**——C1 是"架构能力 vs 新逃生口"的分界）。
  //   只在**声明了**挂载层时触发（普通页面零开销、零行为变化）。
  const mountViolations = validateMountLayerUsage(tplResult, options.filename ?? 'anonymous.vue')
  if (mountViolations.length > 0) {
    const f = options.filename ?? 'anonymous.vue'
    const detail = mountViolations.map((v) => `  [${v.code}] ${v.message}\n        修法：${v.hint}`).join('\n')
    throw new CompilerError(f, `三层挂载校验失败（${mountViolations.length} 条）\n${detail}`)
  }
  const sfcMacros = extractSfcMacros(source, options.filename ?? 'anonymous.vue')
  const wxmlBase = sfcMacros.ok && sfcMacros.modelRefs.length ? renameModelVarsInWxml(tplResult.wxml, sfcMacros.modelRefs) : tplResult.wxml
  // ★★★GP3-b1（2026-10-03）：**页面侧 Global 层合并（wxml 前缀）**
  //   · 位置：Global 层内容置于页面 wxml **之前**（树序 = z-order ⇒ Global 在下、页面内容在上）
  //   · 仅页面（组件不注入——Global 层是页面级概念；App 壳自己也不注入自己）
  //   ★为什么在 model 变量改名之后：改名只服务**本文件**的宏（壳片段来自另一次编译），两者互不干扰。
  const glSnippet = options.globalLayer
  const mergeLayer = options.appShell !== true && options.isComponent !== true && glSnippet !== undefined
  const wxml = mergeLayer && glSnippet!.wxml.trim() ? `${glSnippet!.wxml}\n${wxmlBase}` : wxmlBase
  const scriptTrace = createTrace('script')
  const scriptResult = transformScriptToPage(setup, styleOpts, {
    file: options.filename,
    isComponent: options.isComponent,
    scopeId,
    vModelBindings: tplResult.vModelBindings,
    usesNavigate: tplResult.usesNavigate,
    // ★P2-4：v-model 转换修饰符（trim/number）随管线传给 script 侧
    vModelModifiers: tplResult.vModelModifiers,
    selfHandlers: tplResult.selfHandlers,
    onceHandlers: tplResult.onceHandlers,
    inlineHandlers: tplResult.inlineHandlers,
    debug: options.debug,
    rules: options.rules,
    transitions: tplResult.transitions,
    storeBindings: tplResult.storeBindings,
    templateRefs: tplResult.templateRefs,
    // ★2026-09-08 useTemplateRef/模板 ref 承接（ref="x" 收集名 → script 侧 useTemplateRef → this.<var>=selectComponent('#x')）
    templateRefNames: tplResult.templateRefNames,
    // ★#500 :style 动态标识符绑定 → 同名 computed 派生值自动序列化字符串
    styleBindings: tplResult.styleBindings,
    // ★2026-09-09 G-62 事件命中：带事件的静态 SVG 图形表（模板收集 → script 生成命中方法）
    svgHits: tplResult.svgHits,
    // ★2026-09-09 G-62 Canvas 通道：SVG 场景（模板收集 → script 注入 data）
    svgScenes: tplResult.svgScenes,
    // ★2026-09-09 G-62 P1：动态 SVG（模板收集 → script 生成 computed）
    dynamicSvgs: tplResult.dynamicSvgs,
    // ★#500 自定义组件 v-model 回写处理器
    vModelComponentHandlers: tplResult.vModelComponentHandlers,
    // ★2026-09-20（F-28/Bug E）：v-model + @input 同元素 → 合并处理器（script 生成方法）
    vModelMergedHandlers: tplResult.vModelMergedHandlers,
    semanticGrids: tplResult.semanticGrids,
    moduleImports: options.moduleImports,
    modelRefs: sfcMacros.ok ? sfcMacros.modelRefs : undefined,
    // ★2026-09-08 defineOptions 对齐：compileScript 权威语义（name/inheritAttrs）——transformScriptToPage 剥离 no-op + name 写组件字段
    defineOptions: sfcMacros.ok ? sfcMacros.defineOptions : undefined,
    // ★★★GP3-b1（2026-10-03）：App 壳模式 / 页面侧 Global 层注入（见 ScriptTransformOptions 注释）
    appShell: options.appShell,
    globalLayer: options.globalLayer,
    trace: scriptTrace,
  })

  const styleTrace = createTrace('style')
  // CSS 预处理器（v0.3 尾）：lang=scss/less 的 style 块先经 preprocessStyle 钩子转 css（适配层注入，编译器零依赖）
  const preprocess = (s: (typeof descriptor.styles)[number]): string =>
    styleSource(s) && s.lang && options.preprocessStyle ? options.preprocessStyle(s.lang, styleSource(s)) : styleSource(s)
  // ★默认 scoped（2026-08）：<style> 无标记按 scoped 处理 + 警告（每文件一条）
  if (!options.rules?.disabled?.includes('style/default-scoped')) {
    for (const s of scopedStyles) {
      if (!s.scoped) {
        const msg =
          `<style> 已按 scoped 处理（Proteus 默认局部作用域；Vue 标准 <style> 为全局，Web 端会泄漏到所有页面）——如需全局样式请改用 <style global>`
        tplResult.warnings.push(msg)
        console.warn(`[mp-transform] ${msg}`)
        break
      }
    }
  }
  // global 组（非作用域化，页面级）+ scoped 组（类名后缀），global 在前可被 scoped 覆盖
  const globalWxss = transformStyleToWxss(globalStyles.map(preprocess).join('\n'), {
    ...styleOpts,
    usesTransition: tplResult.usesTransition,
    trace: styleTrace,
  })
  const scopedWxss = transformStyleToWxss(scopedStyles.map(preprocess).join('\n'), {
    ...styleOpts,
    scopeId,
    usesTransition: tplResult.usesTransition,
    trace: styleTrace,
  })
  // ★2026-09-09 动画提升：SVG 整体变换 → CSS @keyframes（模板侧收集，此处追加）
  const animCss = (tplResult.animCss ?? []).join('\n')
  // ★★GP3-b1（2026-10-03）：**App 壳 wxss 去基础样式**——语义基础样式（`BASE_SEMANTIC_WXSS`）是
  //   **每个文件都会注入的常量**（页面自己也会注入一份）⇒ 壳片段的 wxss 里再带一份 = 每页多 ~1.8KB
  //   且**永远不可能命中**（壳片的类名带壳 scopeId，页面文档里没有这些元素）——纯死重量。
  //   ★剥离点必须在**分段处**（不是最终串前缀匹配）：globalWxss/scopedWxss 各自以基础样式打头，
  //     拼成 finalWxss 后只有第一段能前缀匹配（第二段藏在中间）——本仓实测首版就漏了 scoped 段。
  const stripBase = (css: string, base: string): string => {
    const b = base.trimEnd()
    if (!b || !css.startsWith(b)) return css
    return css.slice(b.length).replace(/^\n+/, '')
  }
  const scopedBase = options.appShell === true && scopeId ? transformStyleToWxss('', { ...styleOpts, scopeId }) : ''
  const wxss =
    options.appShell === true
      ? [stripBase(globalWxss, BASE_SEMANTIC_WXSS), stripBase(scopedWxss, scopedBase), animCss].filter(Boolean).join('\n')
      : [globalWxss, scopedWxss, animCss].filter(Boolean).join('\n')
  // ★15-page-scroll-container：页面自动包滚动容器后注入高度样式（100vh = Skyline 视口；
  //   scoped 转换后拼接 → .proteus-page-scroll 不参与 scope 后缀，匹配模板注入节点）
  const pageScrollCss = tplResult.pageScrollWrapped ? '\n.proteus-page-scroll { height: 100vh; }\n' : ''
  // ★GP3-b1：页面注入 Global 层时**并入壳样式**（置最前——页面样式可覆盖；scoped 后缀同源天然匹配）。
  //   ★并入时机在 `wxss` 之后：壳样式不经页面的 scoped 变换（它自己的编译已做过）——
  //   直接拼在 finalWxss 前部，避免二次后缀。
  const glCss = mergeLayer && glSnippet!.wxss.trim() ? `${glSnippet!.wxss}\n` : ''
  const finalWxss = `${glCss}${wxss}${pageScrollCss}`

  const warnings = [...tplResult.warnings, ...scriptResult.warnings, ...styleLoadWarnings, ...scrollWarnings]
  const trace = [...tplTrace.events, ...scriptTrace.events, ...styleTrace.events]

  // ★★卡 C4：**编译期漏点计数器**（记录不阻断——埋点清单 §2.1 明确要求）
  //
  // 【归属原则（关键）】计数器**不判断"是不是漏点"**——那由既有诊断（warnings）与
  //   结构化规则 ID（trace）决定；它只做**归类 + 计数**。⇒ 编译器新增诊断时，
  //   计数器自动纳入（若分类表未覆盖，报告会显式列进"未归类"，**不静默丢**）。
  const gapCounter = new GapCounter()
  const file = options.filename ?? 'anonymous.vue'
  for (const w of warnings) gapCounter.record(file, w)
  // 规则 ID 路径：同一批诊断若带了规则 ID（trace 事件），用它做更可靠的归类
  //   ★只为**已有对应 warning 的**规则补记（避免把"正常转换"（如 directive/v-bind）误当漏点）
  const warnedIds = new Set<string>()
  for (const ev of trace) {
    if (!ev.ruleId) continue
    // 规则 ID 与诊断文本同族时（如 svg-p2-unsupported / unknown-p-star），用它加固归类
    for (const w of warnings) {
      if (ruleIdMatchesWarning(ev.ruleId, w)) warnedIds.add(ev.ruleId)
    }
  }
  for (const id of warnedIds) gapCounter.record(file, `（规则 ${id}）`, { ruleId: id })

  const result: CompileResult = {
    wxml,
    js: scriptResult.js,
    wxss: finalWxss,
    warnings,
    trace,
    sourcemap: scriptResult.sourcemap,
    /** ★卡 C4：漏点记录（三类分列；空数组 = 本文件无漏点） */
    gaps: gapCounter.records,
  }

  // ★★★GP3-b1（2026-10-03）：App 壳 ⇒ 产出 **Global 层注入片段**（plugin 把它注入每个页面）。
  //
  // 【片段从哪来】**结构化件由 script 管线同源交出**（`scriptResult.appShell`——data 条目/方法行/
  //   init 行都是 codegen 当场用的那几件，不是从产物文本反解）；本处只做**组装**：
  //   wxml 取模板侧留存的 `global` 层内容（GP3-b1 新增的 mountLayerWxml），wxss 取本文件 wxss。
  //   ★为什么不用文本反解：反解 = 同一件事两份实现（改一处漏一处）——本仓已为这类分叉付过代价。
  //
  // 【诚实边界（不静默半支持）】page/overlay 层在 App 壳里**有内容**时：MP 端不由外壳提供
  //   （页面自成一 Page 层；Overlay 在页面/组件内声明）⇒ **可见警告**；`<global-layer>` 为空
  //   则不产片段（无 Global 层可注入）。
  if (tplResult.isAppShell) {
    result.isAppShell = true
    const shell = scriptResult.appShell
    const globalWxml = (tplResult.mountLayerWxml?.global ?? []).join('\n')
    for (const layer of ['page', 'overlay'] as const) {
      const content = (tplResult.mountLayerWxml?.[layer] ?? []).filter((s) => s.trim().length > 0)
      if (content.length > 0) {
        warnings.push(
          `App 壳的 <${layer}-layer> 含内容，但 MP 端该层不由 App 壳提供——已忽略：` +
            (layer === 'page'
              ? 'MP 端"页面即 Page 层"（每页产物自身就是 Page 层）；全局内容请放 <global-layer>'
              : 'Overlay 声明在页面/组件内（<teleport> → root-portal）；全局 Toast/弹窗走 GP4 的 Overlay 通道'),
        )
      }
    }
    if (!shell) {
      warnings.push('App 壳未产出结构化件（scriptResult.appShell 缺失）——Global 层注入跳过（页面照常构建）')
    } else if (globalWxml.trim().length === 0) {
      warnings.push('App 壳未声明 <global-layer> 内容——无 Global 层可注入（页面照常构建）')
    } else {
      // ★wxss 已在上面**分段剥离基础样式**（每页各带一份常量；壳片段再带 = 死重量）
      result.globalLayerSnippet = {
        wxml: globalWxml,
        wxss: finalWxss,
        data: shell.data,
        methods: shell.methods,
        initLines: shell.initLines,
        derivedInitLine: shell.derivedInitLine,
        stateModuleRel: GLOBAL_LAYER_STATE_MODULE,
        srcRel: options.filename ?? 'App.vue',
      }
    }
  }

  // 反黑盒：产物自校验，坏产物当场抛错并指明文件（绝不静默输出）
  assertValidResult(result, options.filename ?? 'anonymous.vue')
  // ★#505 M1：CompileIR 语义快照（旁路字段投影；不改变 wxml/js/wxss——产物逐字节等价）
  result.ir = buildCompileIR(tplResult)
  // ★#505 M4 ScriptIR 首条：script 语义声明（提取层结构化投影——codegen 出口不变；确定性缺省为空）
  result.ir.script = scriptResult.ir ?? emptyScriptIR()
  return result
}

/**
 * ★卡 C4：规则 ID 与诊断文本是否同族（用于给 warning 补上更可靠的规则归类）。
 *
 * 【为什么需要】诊断文本是中文散文（人读友好），规则 ID 是结构化标识（机器友好）。
 *   计数器归类时**规则 ID 更可靠**，但并非每条 warning 都能拿到 ID（warning 点在 push 时未带 ID）。
 *   ⇒ 这里做"同族判定"：取 ID 的**特征段**（以 `-`/`/` 切分后的末段），看它是否出现在诊断文本里。
 *     命中则该 warning 用 ID 路径归类（比关键词更准）。
 *   ★保守：只有明确同族才补记，避免把"正常转换"误判为漏点。
 */
function ruleIdMatchesWarning(ruleId: string, warning: string): boolean {
  const seg = ruleId.split(/[/-]/).filter(Boolean)
  if (!seg.length) return false
  const last = seg[seg.length - 1]!
  if (last.length < 3) return false
  return warning.includes(last)
}
