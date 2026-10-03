// tests/overlay-host-inject.test.ts —— ★★★GP4-b：Overlay 宿主「**表驱动**按需注入」回归锁
//
// 【要锁什么】注入机制在 GP4-b 重构为**表驱动**（`OVERLAY_HOSTS` 一行一个能力）——
//   本文件锁三件事：
//   ① **表完整性**：Toast / Loading 两行都在，且 **API 名不重叠**（重叠会互相误触发）
//   ② **按需**：用过哪个能力的 API 才注入哪个宿主（不用的不注入——与"组件按需输出"同哲学）
//   ③ **一次遍历判全部**：两个能力的需求在**同一次扫描**里分别判定（不是扫两遍）
//   ④ **★扫描器不自污染**：本模块自身的字面量不得被自己扫到（GP4-a 踩过的真坑）
//   ⑤ **手动优先**：某能力被手写宿主 ⇒ 只有**该能力**让位（另一能力不受影响——表驱动后的新判据）
//
// 【★为什么要单测⑤】GP4-a 时代只有 Toast 一个能力，"手动优先"是全局开关；表驱动后
//   必须是**按能力**的（否则用户为 Toast 写了个宿主，Loading 的注入也一起没了 ⇒ 静默不显示）。

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  detectOverlayUsage, injectOverlayHosts, overlayHostTag, OVERLAY_HOSTS,
} from '../packages/plugin-vite/src/page-overlay'

/** 造一个临时应用目录（隔离——不碰真实 examples） */
function fixture(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-overlay-'))
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
  }
  return dir
}
const cleanup = (dir: string): void => fs.rmSync(dir, { recursive: true, force: true })

/** 取表里的某能力 spec（失败即清晰报错） */
const specOf = (key: string): (typeof OVERLAY_HOSTS)[number] => {
  const s = OVERLAY_HOSTS.find((x) => x.key === key)
  if (!s) throw new Error(`OVERLAY_HOSTS 缺 ${key}`)
  return s
}

describe('★GP4-b ① 表完整性（唯一事实来源）', () => {
  it('Toast 与 Loading 均已登记（key/host 正确）', () => {
    expect(specOf('toast').host).toBe('p-toast-host')
    expect(specOf('loading').host).toBe('p-loading-host')
  })

  it('★API 名不重叠（重叠 ⇒ 一个能力的用法会误触发另一个的注入）', () => {
    const seen = new Map<string, string>()
    for (const spec of OVERLAY_HOSTS) {
      for (const api of spec.apis) {
        const prev = seen.get(api)
        expect(prev, `API ${api} 同时登记在 ${prev} 与 ${spec.key}`).toBeUndefined()
        seen.set(api, spec.key)
      }
    }
    expect(seen.size, '总 API 数 = 各能力之和（无重复）').toBe(OVERLAY_HOSTS.reduce((n, s) => n + s.apis.length, 0))
  })

  it('宿主标签由表派生（不是各处硬编码）', () => {
    expect(overlayHostTag(specOf('toast'))).toBe('<p-toast-host />')
    expect(overlayHostTag(specOf('loading'))).toBe('<p-loading-host />')
  })
})

describe('★GP4-b ②③ 按需 + 一次遍历判全部', () => {
  it('只用 Toast API ⇒ 只有 toast.used（loading 保持 false）', () => {
    const dir = fixture({
      'pages/a.vue': `<script setup>import { showToast } from '@proteus-vue/runtime'\nshowToast({ text: 'x' })\n</script>`,
    })
    const u = detectOverlayUsage(dir)
    expect(u.toast!.used).toBe(true)
    expect(u.loading!.used, 'loading 不该被误触发').toBe(false)
    cleanup(dir)
  })

  it('只用 Loading API ⇒ 只有 loading.used', () => {
    const dir = fixture({
      'pages/a.vue': `<script setup>import { showLoading } from '@proteus-vue/runtime'\nshowLoading({ text: 'x' })\n</script>`,
    })
    const u = detectOverlayUsage(dir)
    expect(u.loading!.used).toBe(true)
    expect(u.toast!.used).toBe(false)
    cleanup(dir)
  })

  it('两者都用 ⇒ 两者都 used（同一次扫描判定）', () => {
    const dir = fixture({
      'pages/a.vue': `<script setup>showToast({ text: 'x' }); showLoading({ id: 'y' })\n</script>`,
    })
    const u = detectOverlayUsage(dir)
    expect(u.toast!.used).toBe(true)
    expect(u.loading!.used).toBe(true)
    cleanup(dir)
  })

  it('★都写在**不同文件**里也能各自命中（拦截器里的 loading + 组件里的 toast）', () => {
    const dir = fixture({
      'utils/http.ts': `export function on401() { showLoading({ id: 'auth' }) }`,
      'components/x/index.vue': `<script setup>showToast({ text: 'x' })\n</script>`,
    })
    const u = detectOverlayUsage(dir)
    expect(u.loading!.used, '拦截器文件').toBe(true)
    expect(u.toast!.used, '组件文件').toBe(true)
    cleanup(dir)
  })

  it('都不用 ⇒ 两者皆 false（不用的应用零成本）', () => {
    const dir = fixture({ 'pages/a.vue': `<script setup>const x = 1\n</script>` })
    const u = detectOverlayUsage(dir)
    expect(u.toast!.used).toBe(false)
    expect(u.loading!.used).toBe(false)
    cleanup(dir)
  })
})

describe('★GP4-b ④ 扫描器不自污染（GP4-a 真坑的回归锁）', () => {
  it('★★扫描真实 examples：两能力的 manualHost 都必须 false（扫描器自身不产生误判）', () => {
    const u = detectOverlayUsage(path.resolve(__dirname, '..', 'examples'))
    expect(u.toast!.manualHost, '★examples 未手写宿主 ⇒ 不得误判（否则自动注入永不生效）').toBe(false)
    expect(u.loading!.manualHost, '★同上').toBe(false)
  })

  it('★★扫描仓库根（含本模块自身源码）——仍不得误判', () => {
    const u = detectOverlayUsage(path.resolve(__dirname, '..'))
    expect(u.toast!.manualHost, '★仓库根含扫描器源码（注释/正则提及宿主标签）⇒ 拼接串解耦必须生效').toBe(false)
    expect(u.loading!.manualHost, '★同上').toBe(false)
  })
})

describe('★GP4-b ⑤ 手动优先**按能力**（表驱动后的关键新判据）', () => {
  it('★手写 Toast 宿主 ⇒ 只 toast 让位，loading 照常注入', () => {
    const dir = fixture({
      'pages/a.vue': `<script setup>showToast({ text: 'x' }); showLoading({ id: 'y' })\n</script>`,
      'pages/b.vue': '<template><view><p-toast-host /></view></template>',
    })
    const u = detectOverlayUsage(dir)
    expect(u.toast!.manualHost, 'toast 让位').toBe(true)
    expect(u.loading!.manualHost, 'loading 不受影响（否则静默不显示）').toBe(false)
    cleanup(dir)
  })

  it('反方向：手写 Loading 宿主 ⇒ 只 loading 让位', () => {
    const dir = fixture({
      'pages/a.vue': `<script setup>showToast({ text: 'x' }); showLoading({ id: 'y' })\n</script>`,
      'pages/b.vue': '<template><view><p-loading-host /></view></template>',
    })
    const u = detectOverlayUsage(dir)
    expect(u.loading!.manualHost).toBe(true)
    expect(u.toast!.manualHost).toBe(false)
    cleanup(dir)
  })

  it('注释里提到宿主标签**不算**声明（剥注释——误判代价最坏：永不注入）', () => {
    const dir = fixture({
      'pages/a.vue': `<script setup>showToast({ text: 'x' })\n</script>`,
      'pages/b.vue': '<template>\n  <!-- 无需手写 <p-toast-host />，框架自动注入 -->\n  <view>hi</view>\n</template>',
    })
    expect(detectOverlayUsage(dir).toast!.manualHost, '注释 ≠ 声明').toBe(false)
    cleanup(dir)
  })
})

describe('★GP4-b 注入形态（多宿主一次注入）', () => {
  it('按 spec 列表注入：两个宿主各占一行（追加在末尾，零扰动）', () => {
    const out = injectOverlayHosts('<view>x</view>', [specOf('toast'), specOf('loading')])
    expect(out).toBe('<view>x</view>\n<p-toast-host />\n<p-loading-host />')
  })

  it('空列表 ⇒ 原样返回（无注入时零改动）', () => {
    expect(injectOverlayHosts('<view>x</view>', [])).toBe('<view>x</view>')
  })

  it('单宿主注入（只有 loading 用时）', () => {
    const out = injectOverlayHosts('<view>x</view>', [specOf('loading')])
    expect(out).toBe('<view>x</view>\n<p-loading-host />')
  })
})

describe('★GP4-b 组件闭环（注入的标签必须有本体 + 注册）', () => {
  it('两个宿主组件本体都存在', () => {
    const root = path.resolve(__dirname, '..')
    for (const spec of OVERLAY_HOSTS) {
      const impl = path.join(root, 'packages/components', spec.host, 'index.vue')
      expect(fs.existsSync(impl), `${spec.host} 本体存在`).toBe(true)
    }
  })

  it('区域遮罩组件存在（第三种范围——组件形态，不参与注入）', () => {
    expect(fs.existsSync(path.resolve(__dirname, '..', 'packages/components/p-loading-region/index.vue'))).toBe(true)
  })

  it('★三个新组件都已在框架注册表登记（index.ts 聚合 + global-components 双名）', () => {
    const root = path.resolve(__dirname, '..')
    const idx = fs.readFileSync(path.join(root, 'packages/components/index.ts'), 'utf-8')
    const dts = fs.readFileSync(path.join(root, 'packages/components/global-components.d.ts'), 'utf-8')
    for (const name of ['PToastHost', 'PLoadingHost', 'PLoadingRegion']) {
      expect(idx, `index.ts 含 ${name}`).toContain(name)
      expect(dts, `global-components 含 ${name}`).toContain(name + ':')
    }
  })

  it('★宿主命中契约：拦截挂**根容器**（Skyline 下遮罩元素自身不参与命中测试——p-drawer 实证）', () => {
    const host = fs.readFileSync(path.resolve(__dirname, '..', 'packages/components/p-loading-host/index.vue'), 'utf-8')
    // ★取标签要**按属性切窗**（不是按行/不是跨行贪婪正则）——本用例两版都踩过：
    //   跨行贪婪把别的 <view 吃进来（断言失准）；按行取又漏了多行属性的写法（属性各占一行）。
    //   ⇒ 以 `id="..."` 定位，再取它**之前最近的一个 `<`** 到之后最近的 `>` 作为该标签文本。
    const tagAt = (attrNeedle: string): string => {
      const i = host.indexOf(attrNeedle)
      if (i < 0) return ''
      const start = host.lastIndexOf('<', i)
      const end = host.indexOf('>', i)
      return start >= 0 && end > start ? host.slice(start, end + 1) : ''
    }
    const rootTag = tagAt('id="p-loading-host-root"')
    expect(rootTag.length, '根容器标签可取').toBeGreaterThan(0)
    expect(rootTag, '根容器带 @catchtap（拦截必须落可靠层——Skyline 事件落容器）').toContain('@catchtap')
    const maskTag = tagAt('class="p-loading-host__mask"')
    expect(maskTag.length, '遮罩层标签可取').toBeGreaterThan(0)
    expect(maskTag.includes('@tap') || maskTag.includes('@catchtap'), `遮罩层仅视觉（不绑事件）：${maskTag}`).toBe(false)
  })
})
