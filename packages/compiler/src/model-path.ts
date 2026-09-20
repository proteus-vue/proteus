// packages/compiler/src/model-path.ts
// ★v-model 绑定路径工具（2026-09-20 修外部实战报告 F-27 / Bug D）
//
// 背景：`v-model` 的 MP 改写此前把绑定表达式**当简单标识符**处理：
//   · handler 名 `proteusOn${capitalize(model)}Input` → `v-model="f.title"` 得到 `proteusOnF.titleInput`（带 `.`，非法方法名）
//   · setData 键 `${name}: e.detail.value` → `{ f.title: ... }`（非法对象键）
//   → 产物非法 JS：`Unexpected token '.'`（`arr[0]` 同理 `Unexpected token '['`）。
//   而 `v-model="obj.prop"` 是 Vue 表单最常见写法（外部工程 8 处命中、整页构建失败），
//   且**长期存在**（beta.9 同样复现），此前被 Bug A/B/C 遮挡未暴露。
//
// 本模块提供两个纯函数（template 侧与 script 侧**共用**，保证 handler 名两端一致）：
//   · modelHandlerSuffix(model) —— 路径 → 合法标识符片段（`f.title` → `FTitle`，`arr[0]` → `Arr0`）
//   · setDataEntry(model, valueExpr) —— 路径 → setData 条目文本（路径键按小程序语法加引号）

/** 路径 → 合法标识符片段（各段首字母大写并拼接；非标识符字符丢弃后按段切分） */
export function modelHandlerSuffix(model: string): string {
  const raw = String(model ?? '').trim()
  if (!raw) return ''
  // 按 `.` 与 `[...]` 切段：f.title → ['f','title']；arr[0] → ['arr','0']；a.b[1].c → ['a','b','1','c']
  const segs = raw
    .replace(/\[([^\]]*)\]/g, '.$1')
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean)
  const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')
  return segs.map(cap).join('')
}

/** 绑定表达式是否为**简单标识符**（无路径）——简单标识符可走原来的简洁产物，路径才需要特殊处理 */
export function isSimpleModel(model: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(String(model ?? '').trim())
}

/**
 * setData 条目文本。
 * · 简单标识符 → `name: expr`（与原产物一致，保持向后兼容）
 * · 路径 → `'a.b': expr` / `'arr[0]': expr`（**键加引号**；小程序 setData 支持路径键写入嵌套字段）
 */
export function setDataEntry(model: string, valueExpr: string): string {
  const m = String(model ?? '').trim()
  if (isSimpleModel(m)) return `${m}: ${valueExpr}`
  return `'${m}': ${valueExpr}`
}

/** v-model（原生/input 形态）的 handler 名——template 与 script 两侧共用 */
export function inputModelHandler(model: string): string {
  return `proteusOn${modelHandlerSuffix(model)}Input`
}

/** v-model（组件形态，回写目标）的 handler 名——同上 */
export function componentModelHandler(model: string): string {
  return `proteusUpdate${modelHandlerSuffix(model)}Model`
}
