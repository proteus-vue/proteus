// website/scripts/lib/cap-usage/index.mjs
// ★★★决策 #1088（2026-10-19）：能力页「用法」示例的**单一 SSOT**（中英同源）——装配入口。
//
// 【为什么（承接 #1087 的欠账）】此前有**两份手写示例表**：
//   · 中文：`gen-content.mjs` 内联的 `USAGE_EXAMPLES`（43 条，覆盖广）
//   · 英文：`gen-content-en.mjs` 的 `CAP_USAGE_EN`（17 条）+ 派生模板兜底
//   ⇒ **同一条能力的中英示例是两份手写的代码**，必然漂移（#1087 实测：英文侧 29 条同步句柄
//     的示例把 `await` 放在句柄上、还把参数名当值，而中文侧一直是对的）。
//   ⇒ 收口成**一份**：每条 = `{ zh, en }`，**代码骨架逐行相同**，只有注释/文案不同。
//
// 【结构（★按域分片——《严禁大文件巨型化》硬上限 1000 行）】
//   shared.mjs          原语：`U(zh, en)` + `skeletonOf(lines)`
//   cap-usage-network.mjs  网络与通信 6 条
//   cap-usage-device.mjs   设备与系统 9 条
//   cap-usage-media.mjs    媒体与引擎 8 条
//   cap-usage-app.mjs      应用/页面/商业化 21 条
//   本文件：装配 `CAP_USAGE` + `usageOf()` + `assertUsageParity()`
//
// 【★写示例时必守（判据在 assertUsageParity + tests/capability-usage-ssot.test.ts）】
//   ① **同步句柄**（返回 `CapResult<X>`）：`const h = useXxx()` —— **不要 `await`**；
//      句柄的方法才返回 `Promise<CapResult<T>>`（该 await 的是**方法调用**）。
//   ② **异步 Hook**（返回 `Promise<CapResult<T>>`）：`const res = await useXxx(...)`。
//   ③ **实参必须是可运行的字面量**（`useVideo('my-video')`），不能是参数名（`useVideo(id)`）。
//   ④ 中英两段的**代码骨架逐行相同**（注释/字符串内容可不同）。
//
// 【诚实边界】示例的**语义质量**（是否展示最典型用法）机器判不出来——本模块只保证
//   "形状可运行 + 中英同源 + 不误导同步/异步"；内容质量仍需人审。
import { PART as NETWORK } from './cap-usage-network.mjs'
import { PART as DEVICE } from './cap-usage-device.mjs'
import { PART as MEDIA } from './cap-usage-media.mjs'
import { PART as APP } from './cap-usage-app.mjs'
import { skeletonOf } from './shared.mjs'

/** 能力页「用法」示例全集（键 = hook 名，与 `PRIMITIVE_CATALOG.capability[].api` 对应） */
export const CAP_USAGE = { ...NETWORK, ...DEVICE, ...MEDIA, ...APP }

/**
 * 取某 hook 的示例（按语言）。
 * @returns 行数组；未登记 ⇒ `null`（调用方走派生模板 `direct` / `generic`）
 */
export function usageOf(hook, lang = 'zh') {
  const e = CAP_USAGE[hook]
  if (!e) return null
  return lang === 'en' ? e.en : e.zh
}

/**
 * ★自检：中英两段的**代码骨架**必须逐行对应（注释/文案可不同）。
 * 能抓住"只改了一边代码"的漂移（如中文改成 `useXxx('a')` 而英文还是 `useXxx()`）。
 */
export function assertUsageParity() {
  const bad = []
  for (const [hook, e] of Object.entries(CAP_USAGE)) {
    const zh = skeletonOf(e.zh)
    const en = skeletonOf(e.en)
    if (zh.length !== en.length) { bad.push(`${hook}: 行数 ${zh.length} vs ${en.length}`); continue }
    for (let i = 0; i < zh.length; i++) {
      if (zh[i] !== en[i]) bad.push(`${hook} 第 ${i + 1} 行骨架不同：zh=\`${zh[i]}\` en=\`${en[i]}\``)
    }
  }
  if (bad.length) throw new Error('[cap-usage] 中英示例代码结构漂移：\n' + bad.join('\n'))
}
