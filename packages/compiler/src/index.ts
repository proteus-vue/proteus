// src/compiler/index.ts
// 编译引擎公开 API —— 未来独立包 @proteus-vue/compiler 的入口
// 约束：本模块及同目录文件不得 import vite / proteus.config，选项全部入参
import { parse as sfcParse } from '@vue/compiler-sfc'
import { transformTemplateToWxml } from './template'
import { transformScriptToPage } from './script'
import { transformStyleToWxss } from './style'
import { assertValidResult, CompilerError } from './validate'
import { createTrace } from './trace'
import { buildCompileIR, emptyScriptIR } from './ir/build'
import type { CompileOptions, CompileResult } from './types'
import { extractSfcMacros, renameModelVarsInWxml } from './sfc-macros'

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
export type { SfcMacros, MacroModelRef } from './sfc-macros'

// 阶段二：决策 trace（explainTransform 输出源码触发的全部转换规则）
export { explainTransform, formatTransformTrace } from './explain'
export type { ExplainOptions, ExplainResult } from './explain'
export { createTrace, lineAt } from './trace'
export type { TransformTrace, TransformTraceEvent } from './trace'

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
  const globalStyles = descriptor.styles.filter((s) => s.attrs?.global !== undefined)
  const scopedStyles = descriptor.styles.filter((s) => s.attrs?.global === undefined)
  const hasScoped = scopedStyles.length > 0
  const scopeId = hasScoped ? scopedIdFrom(options.filename ?? 'anonymous.vue') : undefined
  // 决策 trace（阶段二）：三阶段共用一条链路，产物侧可据此反查规则（★底线循环 ②）
  const tplTrace = createTrace('template')
  const tpl = descriptor.template?.content ?? ''
  const setup = descriptor.scriptSetup?.content ?? descriptor.script?.content ?? ''
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
  const sfcMacros = extractSfcMacros(source, options.filename ?? 'anonymous.vue')
  const wxml = sfcMacros.ok && sfcMacros.modelRefs.length ? renameModelVarsInWxml(tplResult.wxml, sfcMacros.modelRefs) : tplResult.wxml
  const scriptTrace = createTrace('script')
  const scriptResult = transformScriptToPage(setup, styleOpts, {
    file: options.filename,
    isComponent: options.isComponent,
    vModelBindings: tplResult.vModelBindings,
    usesNavigate: tplResult.usesNavigate,
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
    semanticGrids: tplResult.semanticGrids,
    moduleImports: options.moduleImports,
    modelRefs: sfcMacros.ok ? sfcMacros.modelRefs : undefined,
    // ★2026-09-08 defineOptions 对齐：compileScript 权威语义（name/inheritAttrs）——transformScriptToPage 剥离 no-op + name 写组件字段
    defineOptions: sfcMacros.ok ? sfcMacros.defineOptions : undefined,
    trace: scriptTrace,
  })

  const styleTrace = createTrace('style')
  // CSS 预处理器（v0.3 尾）：lang=scss/less 的 style 块先经 preprocessStyle 钩子转 css（适配层注入，编译器零依赖）
  const preprocess = (s: (typeof descriptor.styles)[number]): string =>
    s.lang && options.preprocessStyle ? options.preprocessStyle(s.lang, s.content) : s.content
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
  const wxss = [globalWxss, scopedWxss, animCss].filter(Boolean).join('\n')
  // ★15-page-scroll-container：页面自动包滚动容器后注入高度样式（100vh = Skyline 视口；
  //   scoped 转换后拼接 → .proteus-page-scroll 不参与 scope 后缀，匹配模板注入节点）
  const pageScrollCss = tplResult.pageScrollWrapped ? '\n.proteus-page-scroll { height: 100vh; }\n' : ''
  const finalWxss = `${wxss}${pageScrollCss}`

  const result: CompileResult = {
    wxml,
    js: scriptResult.js,
    wxss: finalWxss,
    warnings: [...tplResult.warnings, ...scriptResult.warnings],
    trace: [...tplTrace.events, ...scriptTrace.events, ...styleTrace.events],
    sourcemap: scriptResult.sourcemap,
  }

  // 反黑盒：产物自校验，坏产物当场抛错并指明文件（绝不静默输出）
  assertValidResult(result, options.filename ?? 'anonymous.vue')
  // ★#505 M1：CompileIR 语义快照（旁路字段投影；不改变 wxml/js/wxss——产物逐字节等价）
  result.ir = buildCompileIR(tplResult)
  // ★#505 M4 ScriptIR 首条：script 语义声明（提取层结构化投影——codegen 出口不变；确定性缺省为空）
  result.ir.script = scriptResult.ir ?? emptyScriptIR()
  return result
}
