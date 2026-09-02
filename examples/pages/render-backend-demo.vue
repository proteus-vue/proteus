<!-- examples/pages/render-backend-demo.vue —— ★G-27 可视化验证：换 flag 切渲染后端（M1 退出标准）
     同一份 C-IR 组件树 → 各 ProteusRenderBackend 渲染产出实时对比：
       vue-dom（真实 DOM 预览 + 控件快照）/ headless（内存树序列化）/ native-*（原生控件名树）/
       flutter（widget 树）/ hybrid（区域级切后端路由 trace）
     展示「语义收敛 + 后端实现」：同一个 layout.grid 语义 → div.proteus-grid / UICollectionView /
       GridLayoutManager / Grid / GridView / grid —— 可插拔肉眼可见 -->
<route>
  { "title": "渲染后端可插拔" }
</route>
<template>
  <div class="page">
    <p-heading :level="1">渲染后端可插拔（G-27）</p-heading>
    <p-text class="desc">同一份 C-IR 组件树 → 换 flag 切渲染后端——「语义收敛 + 后端实现」肉眼可见</p-text>

    <section class="block">
      <p-heading :level="2">① 选择后端（flag）</p-heading>
      <div class="flag-row">
        <button v-for="b in backendIds" :key="b" class="flag-btn" :class="{ on: backend === b }" @click="onPick(b)">
          {{ b }}
        </button>
      </div>
      <p-text class="hint">{{ backendHint }}</p-text>
    </section>

    <section class="block">
      <p-heading :level="2">② 来源：同一份 C-IR 树</p-heading>
      <pre class="ir-tree" data-testid="rb-ir">{{ irPretty }}</pre>
    </section>

    <section class="block">
      <p-heading :level="2">③ 渲染产出</p-heading>
      <div class="stage">
        <p-text class="stage-label">vue-dom 真实 DOM（后端内联渲染）：</p-text>
        <div ref="domStage" class="dom-stage" data-testid="rb-dom" />
      </div>
      <p-text class="stage-label">各端控件快照（renderComponentSnapshot readback）：</p-text>
      <pre class="snap-tree" data-testid="rb-snap">{{ snapText }}</pre>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { PHeading, PText } from '@proteus-vue/components'
import {
  createVueDomBackend,
  createHeadlessBackend,
  createNativeBackend,
  createFlutterBackend,
  createHybridRenderer,
  toPlainTree,
  toWidgetTree,
  renderComponentSnapshot,
  createControlReader,
} from '@proteus-vue/render-backend'
import type { HeadlessNode, IRNode, ProteusRenderBackend } from '@proteus-vue/render-backend'

// —— 固定 C-IR 树（同一份来源——G-29.1/语义收敛验证锚点） ——
const ir: IRNode = {
  type: 'p-grid',
  semantic: 'layout.grid',
  props: { minColWidth: 140, maxCols: 3 },
  children: [
    { type: 'p-box', semantic: 'layout.box', props: { variant: 'card' }, children: [{ type: 'p-text', semantic: 'ui.text', props: {}, children: [] }] },
    { type: 'p-box', semantic: 'layout.box', props: {}, children: [{ type: 'p-button', semantic: 'ui.button', props: { variant: 'primary' }, children: [] }] },
    { type: 'p-media', semantic: 'ui.media', props: { kind: 'video' }, children: [] },
  ],
}
const irPretty = JSON.stringify(ir, null, 2)

const backendIds = ['vue-dom', 'headless', 'native-ios', 'native-android', 'native-harmony', 'flutter', 'hybrid'] as const
const backend = ref<(typeof backendIds)[number]>('vue-dom')

const backendHint = ref('')
const hintMap: Record<string, string> = {
  'vue-dom': '真实 DOM（浏览器像素）——createRenderer(nodeOps) 即零成本后端',
  headless: '内存节点树（SSR/测试/AI 无设备回归）——toPlainTree 序列化',
  'native-ios': '原生控件名树（UIKit 基准）——UILabel/UIButton/UICollectionView…（宿主 adapter 后接）',
  'native-android': '原生控件名树（Jetpack）——TextView/Button/GridLayoutManager…（宿主 adapter 后接）',
  'native-harmony': '原生控件名树（ArkUI）——Text/Button/Grid…（宿主 adapter 后接）',
  flutter: 'Flutter widget 树（spike）——Container/Text/FilledButton/GridView…（Embedder 宿主后接）',
  hybrid: '混合渲染（B6）：视频区 native + 其余 vue-dom——区域级切后端 + 路由 trace',
}

const domStage = ref<HTMLElement | null>(null)
const snapText = ref('')
let liveDom: unknown = null

function onPick(b: (typeof backendIds)[number]): void {
  backend.value = b
  render()
}

function render(): void {
  const b = backend.value
  // ① 快照（各端 readback——语义收敛验证）+ ② 真实 DOM（vue-dom 时）
  if (b === 'vue-dom') {
    const vue = createVueDomBackend(document)
    const snap = renderComponentSnapshot(vue, ir, createControlReader('vue-dom'))
    snapText.value = formatTree(snap as never)
    mountDom(vue)
  } else if (b === 'headless') {
    const h = createHeadlessBackend()
    const root = renderToRoot(h, ir)
    snapText.value = JSON.stringify(toPlainTree(root as HeadlessNode), null, 2)
    clearDom()
  } else if (b.startsWith('native-')) {
    const platform = b.split('-')[1] as 'ios' | 'android' | 'harmony'
    const n = createNativeBackend(undefined, platform)
    const snap = renderComponentSnapshot(n, ir, createControlReader(b))
    snapText.value = formatTree(snap as never)
    clearDom()
  } else if (b === 'flutter') {
    const f = createFlutterBackend()
    const root = renderToRoot(f, ir)
    snapText.value = JSON.stringify(toWidgetTree(root as never), null, 2)
    clearDom()
  } else {
    // hybrid：区域级切后端（ui.media → native-ios）+ 纹理共享广播 + DevTools 路由 trace
    const hybrid = createHybridRenderer({
      defaultBackend: createVueDomBackend(document),
      regions: [{ name: 'media', match: (n) => n.semantic === 'ui.media', backend: createNativeBackend(undefined, 'ios') }],
    })
    // ① 全树 createElement——路由决策留痕（★不跨后端 insert：原生子树由宿主按几何覆盖挂载，B6 混合语义）
    const walkCreate = (n: IRNode): void => {
      hybrid.createElement(n)
      for (const c of n.children) walkCreate(c)
    }
    walkCreate(ir)
    const lines: string[] = []
    lines.push('区域路由 trace（createElement 必留痕——semantic → 后端决策）：')
    for (const t of hybrid.traces()) lines.push(`  ${t.type} [${t.semantic}] → ${t.backendId}（${t.region}）`)
    // ② 纹理共享广播：media 原生节点 → 全局纹理 id（textureSharing 后端接收）
    if (hybrid.registerExternalTexture) hybrid.registerExternalTexture('media-1', { id: 'media-1', width: 320, height: 180 })
    lines.push('纹理共享广播：registerExternalTexture(media-1) → textureSharing 后端接收（native-ios/flutter）')
    // ③ media 子树原生快照（同一语义 ui.media → AVPlayerView——readback 可见原生控件）
    const mediaNode = ir.children.find((c) => c.semantic === 'ui.media')
    if (mediaNode) {
      const mediaNative = createNativeBackend(undefined, 'ios')
      const snap = renderComponentSnapshot(mediaNative, mediaNode as IRNode, createControlReader('native-ios'))
      lines.push('media 子树原生快照（native-ios readback）：')
      lines.push(formatTree(snap as never).trimEnd())
    }
    snapText.value = lines.join('\n')
    // ④ 默认后端（vue-dom）真实 DOM：media 槽位以「原生覆盖层」占位（宿主后接挂载）
    mountDom(createVueDomBackend(document), ir, true)
  }
}

/** 后端 nodeOps 渲染 C-IR 子树 → 根句柄（递归铺满全部层级——供 toPlainTree/toWidgetTree 序列化） */
function renderToRoot(backend: { createElement(n: IRNode): unknown; insert(c: unknown, p: unknown): void }, node: IRNode): unknown {
  const root = backend.createElement(node)
  for (const c of node.children) {
    const child = renderToRoot(backend, c as IRNode)
    backend.insert(child, root)
  }
  return root
}

/** vue-dom 真实 DOM 挂载（把语义树铺进舞台容器——像素可见；mediaOverlay 时 ui.media 槽位降为原生覆盖层占位） */
function mountDom(vue: ProteusRenderBackend, tree: IRNode = ir, mediaOverlay = false): void {
  if (typeof document === 'undefined' || !domStage.value) return
  domStage.value.innerHTML = ''
  const place = (node: IRNode): HTMLElement => {
    if (mediaOverlay && node.semantic === 'ui.media') {
      // ★跨后端挂载由宿主按几何覆盖完成（纹理/PlatformView 语义）——此处以占位说明代替非法 DOM 挂载
      const ph = document.createElement('div')
      ph.className = 'media-overlay'
      ph.textContent = '🎬 ui.media → native-ios（AVPlayerView）· 原生覆盖层宿主后接'
      return ph
    }
    const el = vue.createElement(node) as HTMLElement
    for (const c of node.children) {
      const child = place(c)
      vue.insert(child, el)
      if (c.semantic === 'ui.text') vue.setText(child, '你好 Proteus')
      if (c.semantic === 'ui.button') vue.setText(child, '点击')
    }
    return el
  }
  liveDom = place(tree)
  domStage.value.appendChild(liveDom as HTMLElement)
}

function clearDom(): void {
  if (domStage.value) domStage.value.innerHTML = ''
  liveDom = null
}

/** 快照树格式化（semantic + control readback 扁平树） */
function formatTree(snap: { type: string; semantic?: string; control?: string; children?: unknown[] } | undefined, depth = 0): string {
  if (!snap) return '（空）'
  const indent = '  '.repeat(depth)
  let line = `${indent}${snap.type}`
  if (snap.semantic) line += `  [${snap.semantic}]`
  if (snap.control) line += `  → ${snap.control}`
  let out = line + '\n'
  for (const c of (snap.children ?? []) as never[]) out += formatTree(c as never, depth + 1)
  return out
}

onMounted(() => {
  onPick('vue-dom')
})
onBeforeUnmount(() => {
  clearDom()
})
</script>

<style scoped>
.page {
  padding: 16px;
  text-align: left;
}
.desc {
  color: #888;
}
.block {
  margin: 16px 0;
}
.flag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.flag-btn {
  padding: 6px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.flag-btn.on {
  background: #1a7af8;
  color: #fff;
  border-color: #1a7af8;
}
.hint {
  color: #666;
  font-size: 13px;
  margin-top: 8px;
}
.ir-tree,
.snap-tree {
  background: #f6f8fa;
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 10px;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre;
}
.stage-label {
  display: block;
  color: #555;
  font-size: 13px;
  margin: 8px 0 4px;
}
.media-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed #e06;
  border-radius: 8px;
  padding: 10px;
  font-size: 12px;
  color: #e06;
  background: rgba(224, 0, 102, 0.05);
}
.dom-stage {
  border: 1px dashed #1a7af8;
  border-radius: 8px;
  padding: 12px;
  min-height: 60px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  background: rgba(26, 122, 248, 0.04);
}
</style>