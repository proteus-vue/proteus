/**
 * modKey.ts —— 修饰键（⌘ / Ctrl）**是否按住**的唯一状态源（决策 #1437）
 *
 * 【为什么单独抽一个文件】
 *   有三处都要读它：
 *     · `modPeek`      —— 按住时才出定义预览（下划线 + 卡片）；
 *     · `nav.typeHover` —— 按住时**不许**弹 quickinfo（否则 300ms 后它把预览卡盖掉，实测就是这个 bug）；
 *     · `diagLint.diagHover` —— 按住时也不许弹诊断提示。
 *   若让后两者直接 import `modPeek`，会形成 `nav ↔ modPeek` 的**循环 import**
 *   （modPeek 已引 nav 的 definitionAt/isReadonlyPath）。能跑，但依赖图脆弱。
 *   ⇒ 提成叶子模块：三者都依赖它，它谁也不依赖。
 */
import { readonly, ref } from 'vue'

const modHeld = ref(false)

/** 只读视图：给 `typeHover` / `diagHover` 判断"现在该不该弹提示" */
export const modHeldState = readonly(modHeld)

/** 写入口：只有 `modPeek` 在 keydown / keyup / blur 里调用 */
export function setModHeld(v: boolean): void {
  modHeld.value = v
}
