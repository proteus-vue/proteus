// packages/compiler/src/ir/build.ts
// ★#505 CompileIR 构建（草案 docs/compiler-ir-contract-draft.md M1 骨架搬迁）
// 职责：把 TemplateTransformResult 的 14 个旁路字段投影为结构化的 TemplateIR 声明——
//   M1 阶段「同数据两形态」：codegen 仍消费旧旁路字段（产物逐字节等价），
//   IR 形态先行建立并附在 CompileResult.ir，供 M2 试点 / M3 conformance 消费。
// 约束：本模块纯函数、不改变任何既有输出；不臆造旁路字段之外的新语义。
import type { CompileIR, ScriptIR, TemplateIR, TemplateTransformResult } from '../types'

/**
 * 投影 TemplateTransformResult → TemplateIR（14 旁路字段 1:1 结构化）。
 * 可选项缺省按「未出现 = 空集合/false」归一，保证 IR 快照确定性。
 */
export function buildTemplateIR(tpl: TemplateTransformResult): TemplateIR {
  return {
    vModelTargets: tpl.vModelBindings ?? [],
    vModelComponentHandlers: tpl.vModelComponentHandlers ?? [],
    eventWrappers: {
      self: tpl.selfHandlers ?? [],
      once: tpl.onceHandlers ?? [],
    },
    inlineHandlers: tpl.inlineHandlers ?? [],
    transitions: tpl.transitions ?? [],
    styleBindings: (tpl.styleBindings ?? []).map((target) => ({ target, valueKind: 'string-only' as const })),
    templateRefs: tpl.templateRefs ?? [],
    storeBindings: tpl.storeBindings ?? [],
    semanticGrids: tpl.semanticGrids ?? [],
    capabilities: {
      navigate: tpl.usesNavigate ?? false,
      transition: tpl.usesTransition ?? false,
      scrollContainer: tpl.pageScrollWrapped ?? false,
    },
  }
}

/**
 * 组装 CompileIR 容器。
 * M1：script 段留空（ScriptIR 类型已落地，内容随 M4 逐条迁入——script 侧当前无结构化旁路字段）。
 * version 与 TemplateIR 演进同步 bump（见 compiler-types.ts CompileIR.version）。
 */
export function buildCompileIR(tpl: TemplateTransformResult): CompileIR {
  return {
    version: 1,
    template: buildTemplateIR(tpl),
  }
}

/** ScriptIR 占位（M4 迁入前不产出内容；保留导出以免类型成为死代码） */
export function emptyScriptIR(): ScriptIR {
  return {}
}
