// packages/compiler/src/sfc-macros.ts
// ★★2026-09-08 关键架构定调（用户拍板）：宏语义不由框架自造——框架始终吃 @vue/compiler-sfc 输出经过框架 IR，
//   再适配多端；小程序端不对齐自造语义，对齐 glass-easel 官方（docs/compiler-platform-alignment.md）落地到 IR。
//   本模块 = 用 @vue/compiler-sfc 的 compileScript 把 <script setup> 宏标准化展开，提取**权威语义元数据**
//   （bindings 分类 + props/emits 规约 + defineModel→useModel 引用），供 MP 转换器消费（替代手写正则抠宏）。
//   ★注意：compileScript 的 script.content 是 Vue 运行时代码（_useModel/_defineComponent/__props），不能直接当
//   MP 产物；我们只用它的**语义元数据**，再把 .value 读写 / props 访问 / emit 重写为 MP 形态（对齐 glass-easel）。
import { parse as sfcParse, compileScript } from '@vue/compiler-sfc'
import type { SFCDescriptor } from '@vue/compiler-sfc'
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface MacroModelRef {
  /** 源码里 defineModel 绑定的变量名（const m = defineModel() → m） */
  varName: string
  /** 对应 v-model prop 名（默认 'modelValue'，可 arg defineModel('title') → 'title'） */
  propName: string
}

export interface SfcMacros {
  /** compileScript 权威 bindings：name → 'props' | 'setup-ref' | 'setup-const' ...（Vue 官方语义分类） */
  bindings: Record<string, string>
  /** props 规约名集合（bindings 里标 'props' 的） */
  propNames: Set<string>
  /** defineModel 引用——const m = defineModel() 展开为 _useModel(__props, 'modelValue') 后提取 { varName: 变量名, propName } */
  modelRefs: MacroModelRef[]
  /** ★权威 emits（compileScript 展开的 emits 数组） */
  emits: string[]
  /** ★权威 props 元数据：name → { type, default? }（compileScript 权威展开，手写 extractProps 类型/默认值一致性校验基准） */
  propsMeta: Record<string, { type: string; default?: unknown }>
  /** 编译是否成功（失败返回空语义，调用方回退既有路径——不因 compileScript 抛错而崩编译） */
  ok: boolean
  /** 原因（ok=false 时） */
  error?: string
}

const EMPTY: SfcMacros = { bindings: {}, propNames: new Set(), modelRefs: [], emits: [], propsMeta: {}, ok: false }

/**
 * 用 @vue/compiler-sfc 的 compileScript 提取宏语义元数据（权威源）。
 * @param source 完整 SFC 源码（<script setup> 宏包裹在内）
 * @param filename 用于 id 生成（scopedId 不冲突）
 * @returns bindings 语义分类 + props 规约 + defineModel 模型引用；失败回退空（不抛，调用方走既有路径）
 */
export function extractSfcMacros(source: string, filename = 'anonymous.vue'): SfcMacros {
  try {
    const { descriptor } = sfcParse(source, { filename })
    if (!descriptor.scriptSetup) return EMPTY
    const script = compileScript(descriptor, { id: filename.replace(/[^\w]+/g, '-') }) as any
    const bindings = Object.fromEntries(Object.entries(script.bindings ?? {}).map(([k, v]) => [k, String((v as any)?.type ?? v)]))
    const propNames = new Set(Object.entries(bindings).filter(([, v]) => v === 'props').map(([k]) => k))
    // defineModel → _useModel(__props, 'name')：从展开体提取模型引用（name 缺省 'modelValue'）
    const modelRefs: MacroModelRef[] = []
    const content = script.content || ''
    const useModelRe = /const\s+([A-Za-z_$][\w$]*)\s*=\s*_useModel[^,]*,\s*(['"])([^'"]*)\2/g
    let mm: RegExpExecArray | null
    while ((mm = useModelRe.exec(content))) {
      modelRefs.push({ varName: mm[1], propName: mm[3] || 'modelValue' })
    }
    // ★权威 props=bindings 里标 'props' 的 prop 名集合（compileScript 分类——prop 名权威源；type/default 解析留扩展）
    // ★权威 emits（compileScript 展开 emits: ['x'] 简单 或 emits: _mergeModels(['x'], ['update:y']) 合并形态）
    const emits: string[] = []
    const emitsSeg = content.match(/emits:\s*[^\n]*?((?:['"][^'"]+['"]\s*,?\s*)+)/)?.[1]
    if (emitsSeg) for (const m of emitsSeg.matchAll(/['"]([^'"]+)['"]/g)) emits.push(m[1])
    // ★权威 props 元数据：props: { name: { type, default? } }（compileScript 权威展开，type/default 校验基准）
    const propsMeta: Record<string, { type: string; default?: unknown }> = {}
    const propsBody = content.match(/props:\s*(?:[^\n]*_mergeModels\(\s*)?\{([\s\S]*?)\n\s*\}/)?.[1]
    if (propsBody) {
      // ★注意：不能用 (['"]?)(name)\1 可选引号回溯——空引号时 \1 空串会导致当前项匹配失败（实测 0 命中）；name 直接捕获即可
      const re = /([A-Za-z_$][\w$]*)\s*:\s*\{\s*type:\s*(\w+)\s*(?:,\s*(?:required:\s*\w+|default:\s*([^,}\n]+)))?/g
      let pm: RegExpExecArray | null
      while ((pm = re.exec(propsBody))) propsMeta[pm[1]] = { type: pm[2], default: pm[3] !== undefined ? pm[3].trim() : undefined }
    }
    return { bindings, propNames, modelRefs, emits, propsMeta, ok: true }
  } catch (e) {
    return { ...EMPTY, error: (e as Error).message }
  }
}

/**
 * ★模板表达式 var 改名（defineModel 落地）：模板里 `{{ m }}` 读 data.m，但 model 的 prop 名是 'modelValue'（var m ≠ prop 名）——
 *   需把插值 `{{ }}` 内的独立标识符 <var> 改为 <propName>，否则读不到（空）。仅改 `{{ }}` 内，避免误伤类名/属性。
 * @param wxml 模板变换器产物（WXML 文本）
 * @param modelRefs var→prop 映射（extractSfcMacros 的 modelRefs）
 */
export function renameModelVarsInWxml(wxml: string, modelRefs: MacroModelRef[]): string {
  if (!modelRefs.length || !wxml.includes('{{')) return wxml
  let out = wxml
  for (const ref of modelRefs) {
    if (ref.varName === ref.propName) continue
    // 仅 `{{ ... }}` 区间内的独立标识符（前后非 \w/\s 绑定词）替换
    out = out.replace(/\{\{([\s\S]*?)\}\}/g, (m, expr: string) =>
      // ★注意 RegExp 构造字符串须双反斜杠（\\w → 引擎 \w），否则退化为字面 w/b 不匹配
      `{{${expr.replace(new RegExp(`(?<![.\\w])${ref.varName}\\b(?![\\w])`, 'g'), ref.propName)}}}`,
    )
  }
  return out
}
