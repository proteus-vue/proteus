// packages/compiler/src/platform-macros.ts —— 平台编译期宏（条件显隐的编译期方案）
//
// 背景：Proteus 不提供 uni-app 式 `#ifdef` 预处理指令（那是非标准 DSL）。取而代之：
//   用**标准 Vue 表达式** + 构建期常量宏——编译时静态求值 → 死分支整块消除（产物纯净）。
//
// 用法（页面/组件内，标准 Vue 条件渲染，零新语法）：
//   <p-button v-if="__MP__" open-type="contact">客服</p-button>
//   <view v-if="__IOS__">仅 iOS</view>
//   <view v-if="__NATIVE__">任一端原生（iOS/Android/鸿蒙）</view>
//   <view v-if="__TARGET__ === 'android'">仅 Android</view>
//
// ★两级平台模型（与 platform-variant 同源）：具体平台 web|mp|ios|android|harmony + 族 web|mp|native。
//   `__NATIVE__` 为族宏（ios/android/harmony 任一为 true）——写一次覆盖三端原生。
//
// ★为什么宏放在编译器里做替换（而非只靠 vite define）：MP 的 .vue 走本仓库自定义编译器
//   `compileVueSfc`，**绕过** vite define 插件（define 只覆盖走 vite/esbuild 的 .ts 模块与
//   Web 端 .vue）。故 MP 端需在编译器入口对 template/script 源码做宏替换。

import type { VariantPlatform } from './platform-variant'

export type { VariantPlatform }

/** 宏目标平台（= 变体解析目标；具体平台或族） */
export type PlatformTarget = VariantPlatform

interface MacroSet {
  /** __MP__ / __WEB__ / __NATIVE__ */
  mp: string
  web: string
  native: string
  /** __IOS__ / __ANDROID__ / __HARMONY__ */
  ios: string
  android: string
  harmony: string
  /** __TARGET__ 字符串字面量 */
  target: string
}

const T = (o: Partial<MacroSet>): MacroSet => ({
  mp: 'false', web: 'false', native: 'false', ios: 'false', android: 'false', harmony: 'false',
  target: "'web'", ...o,
})

const MACRO_VALUES: Record<VariantPlatform, MacroSet> = {
  web: T({ web: 'true', target: "'web'" }),
  mp: T({ mp: 'true', target: "'mp'" }),
  ios: T({ native: 'true', ios: 'true', target: "'ios'" }),
  android: T({ native: 'true', android: 'true', target: "'android'" }),
  harmony: T({ native: 'true', harmony: 'true', target: "'harmony'" }),
  native: T({ native: 'true', target: "'native'" }),
}

const IDENT_TO_KEY: Record<string, keyof MacroSet> = {
  __MP__: 'mp',
  __WEB__: 'web',
  __NATIVE__: 'native',
  __IOS__: 'ios',
  __ANDROID__: 'android',
  __HARMONY__: 'harmony',
  __TARGET__: 'target',
}

/** 单标识符替换（命中宏 → 该平台字面量；否则原样） */
function macroValue(ident: string, v: MacroSet): string | undefined {
  const key = IDENT_TO_KEY[ident]
  return key ? v[key] : undefined
}

/**
 * 平台宏替换：`__MP__`/`__WEB__`/`__NATIVE__`/`__IOS__`/`__ANDROID__`/`__HARMONY__`/`__TARGET__`
 * → 该平台字面量。
 *
 * ★两种模式（踩坑后确立，2026-09-13）：
 *   - `'template'`：**原始**标识符替换（word-boundary）。模板里 `v-if="__MP__"` 的标识符位于
 *     HTML 属性引号内、但语义是表达式——必须替换，故不做字符串跳过。
 *   - `'code'`：跳过字符串字面量与注释（脚本模式）。否则**代码示例字符串**（如
 *     `codes.x = '<p-button v-if="__MP__">'`）会被误改并破坏引号结构（实测事故）。
 */
export function applyPlatformMacros(source: string, platform: PlatformTarget, mode: 'template' | 'code' = 'template'): string {
  const v = MACRO_VALUES[platform] ?? MACRO_VALUES.web
  if (mode === 'template') {
    return source
      .replace(/\b__MP__\b/g, v.mp)
      .replace(/\b__WEB__\b/g, v.web)
      .replace(/\b__NATIVE__\b/g, v.native)
      .replace(/\b__IOS__\b/g, v.ios)
      .replace(/\b__ANDROID__\b/g, v.android)
      .replace(/\b__HARMONY__\b/g, v.harmony)
      .replace(/\b__TARGET__\b/g, v.target)
  }
  // code 模式：逐字符扫描，跳过字符串字面量与注释
  let out = ''
  let i = 0
  const n = source.length
  while (i < n) {
    const ch = source[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      out += ch
      i++
      while (i < n) {
        if (source[i] === '\\' && i + 1 < n) {
          out += source[i] + source[i + 1]
          i += 2
          continue
        }
        out += source[i]
        const done = source[i] === quote
        i++
        if (done) break
      }
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') out += source[i++]
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      out += '/*'
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) out += source[i++]
      if (i < n) { out += '*/'; i += 2 }
      continue
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i
      while (j < n && /[\w$]/.test(source[j])) j++
      const ident = source.slice(i, j)
      out += macroValue(ident, v) ?? ident
      i = j
      continue
    }
    out += ch
    i++
  }
  return out
}

/** 对整个 .vue 源码做宏替换：`<script>` 块用 code 模式（跳过字符串），其余（template 等）用 template 模式。
 *  Web 端的 vue 前置插件用（在 @vitejs/plugin-vue 解析前替换源码）。 */
export function applyPlatformMacrosInSfc(source: string, platform: PlatformTarget): string {
  const parts: string[] = []
  const re = /<script\b[^>]*>[\s\S]*?<\/script>/gi
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    parts.push(applyPlatformMacros(source.slice(last, m.index), platform, 'template'))
    parts.push(applyPlatformMacros(m[0], platform, 'code'))
    last = m.index + m[0].length
  }
  parts.push(applyPlatformMacros(source.slice(last), platform, 'template'))
  return parts.join('')
}

/** 供构建配置（vite define / esbuild define）复用的宏定义表 */
export function platformDefines(platform: PlatformTarget): Record<string, string> {
  const v = MACRO_VALUES[platform] ?? MACRO_VALUES.web
  return {
    __MP__: v.mp,
    __WEB__: v.web,
    __NATIVE__: v.native,
    __IOS__: v.ios,
    __ANDROID__: v.android,
    __HARMONY__: v.harmony,
    __TARGET__: v.target,
  }
}
