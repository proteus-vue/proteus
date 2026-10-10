// tests/teleport-overlay-zindex.test.ts —— ★★★回归锁：**body 追加的弹层必须落在 overlay 域**（2026-10-10）
//
// 【为什么必须有（本仓实测的静默回归）】GP3-a 三层挂载（`packages/web/src/mount-layers.ts`）给
//   `page` 挂载层 `z-index = mountLayerDomainOffset('page') = 1_000_000`（overlay=2_000_000）。
//   而**追加到 `<body>` 的弹层**（组件 `<teleport to="body">`、WeUI 平台层 `document.body.appendChild`）
//   **不受任何挂载层约束** ⇒ 裸 z-index 若仍取旧值（999 / 9990 / 99999 …），会被 page 层（1e6）**盖住**
//   （症状：弹层"看得见、点不到、关不掉"——真机/CI e2e 实测：p-drawer / p-popover / showModal）。
//
// 【正确约定（★既有先例，非本次新造）】`p-loading-host`(2000000) / `p-toast-host`(2000010) /
//   `p-auth-gate`(2000020) 早在本轮之前就用 **overlay 域**（注释写明"原 9999 < 页面层 1e6 ⇒ 被盖住"）。
//   本锁把这条约定**机器化**：所有"body 追加"的弹层 z-index ≥ `mountLayerDomainOffset('overlay')`。
//
// 【判据用**源码静态扫描**（零 DOM / 零设备，CI 即可拦）】——这是"接线不靠记忆"的落点：
//   未来新增/改回 body 弹层时，若 z-index 掉出 overlay 域，本锁当场红。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mountLayerDomainOffset, MOUNT_LAYER_DOMAIN } from '@proteus-vue/contracts'

const ROOT = path.resolve(__dirname, '..')
const OVERLAY_BASE = mountLayerDomainOffset('overlay') // = 2_000_000

/** 「body 追加的弹层」清单：`组件文件 → 其弹层根/浮起元素的选择器`（**必须 ≥ overlay 域**）。
 *  ★维护：新增用 `<teleport to="body">` 的组件、或 WeUI 平台层 `body.appendChild` 的浮层，登记于此。 */
const BODY_OVERLAYS: Array<{ file: string; selector: string }> = [
  { file: 'packages/components/p-drawer/index.vue', selector: '.p-drawer-root' },
  { file: 'packages/components/p-popover/index.vue', selector: '.p-popover-layer' },
  { file: 'packages/components/p-popover/index.vue', selector: '.p-popover-panel' },
  { file: 'packages/components/p-picker/index.vue', selector: '.p-picker-root' },
  { file: 'packages/components/p-loading-host/index.vue', selector: '.p-loading-host' },
  { file: 'packages/components/p-toast-host/index.vue', selector: '.p-toast-host' },
  { file: 'packages/components/p-auth-gate/index.vue', selector: '.p-auth-gate' },
  // WeUI 平台模拟层（`packages/web/src/wx.ts` → `document.body.appendChild`）
  { file: 'packages/built-in-components/src/style.css', selector: '.proteus-web-ui-mask' },
  { file: 'packages/built-in-components/src/style.css', selector: '.proteus-web-modal' },
  { file: 'packages/built-in-components/src/style.css', selector: '.proteus-web-toast' },
  { file: 'packages/built-in-components/src/style.css', selector: '.proteus-web-actionsheet' },
  { file: 'packages/built-in-components/src/style.css', selector: '.proteus-web-picker-sheet' },
  { file: 'packages/built-in-components/src/style.css', selector: '.proteus-web-image-menu-mask' },
]

/** 取 `selector { … }` 块里声明的 z-index（数值；无则 -1） */
function zIndexOf(src: string, selector: string): number {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(^|\\n)${esc}\\s*\\{([^}]*)\\}`, 'm').exec(src)
  if (!m) return -1
  const z = /z-index:\s*(\d+)/.exec(m[2]!)
  return z ? Number(z[1]) : -1
}

describe('★★★body 追加的弹层必须落在 overlay 域（防被 page 挂载层盖住）', () => {
  it(`overlay 域基线 = ${OVERLAY_BASE}（契约 mountLayerDomainOffset('overlay')；比 page 层高一个域宽）`, () => {
    expect(OVERLAY_BASE).toBeGreaterThan(mountLayerDomainOffset('page'))
    expect(OVERLAY_BASE).toBe(2 * MOUNT_LAYER_DOMAIN)
  })

  for (const { file, selector } of BODY_OVERLAYS) {
    it(`${file} 的 ${selector} z-index ≥ overlay 域`, () => {
      const abs = path.join(ROOT, file)
      expect(fs.existsSync(abs), `${file} 存在`).toBe(true)
      const z = zIndexOf(fs.readFileSync(abs, 'utf-8'), selector)
      expect(z, `${selector} 需有显式 z-index（找不到 ⇒ 选择器名变了？请同步本锁）`).toBeGreaterThanOrEqual(0)
      expect(
        z,
        `${selector} 的 z-index=${z} < overlay 域 ${OVERLAY_BASE} ⇒ 会被 page 挂载层(${mountLayerDomainOffset('page')})盖住（弹层看得见点不到）。` +
          `请取契约 \`mountLayerDomainOffset('overlay')\`（见 packages/web/src/mount-layers.ts 头注）`,
      ).toBeGreaterThanOrEqual(OVERLAY_BASE)
    })
  }
})
