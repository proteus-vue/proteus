<script setup lang="ts">
// website/src/components/TransformDemo.vue —— 实时 Transform 演示（01-home.md §3「全站最核心的交互」）
// ★透明编译可交互化（W-4 证明先于宣称）：左侧写标准 Vue SFC，右侧实时出
//   Skyline（wxml）/ IR（CompilerIR JSON——G-29 NodeBackend 真实中间表示）/ Web（零转换=源码）/ WXSS / Trace
// ★B4 复用：首页内嵌 + /playground 全功能页共用本组件（compact 控制形态）
// ★#387 v3 面板构图：面板头（◆ 标题 + LIVE 徽标 + 提示）+ 输出面板接 docs 引擎语法色（highlight——与文档站同一套，非伪造）
// ★#388 Mini Playground v2（W-3 可切换性可视化——全部真实调用，零伪造）：
//   RENDER BACKEND × 6（renderIRTree 真跑五后端→各自真实输出树：DOM/内存树/Native 三平台描述树/Widget 树）
//   COMPILED BACKEND（Node 真实；Rust 诚实禁用——浏览器无 Rust 运行时）
//   DEVICE（预览框真实宽高 + G-25 formForWidth 档位真求解）
import { computed, ref, watch } from 'vue'
import { compileLive, DEMO_SOURCE, DEMO_SOURCE_EN } from '../playground/compile'
// ★IR Tab：G-29 NodeBackend 真实 CompilerIR（./node 子路径——浏览器安全单入口，index 全量含 fs 仅 node 侧）
import { createNodeCompilerBackend } from '@proteus-vue/compiler-backend/node'
// ★语法色（@proteus-vue/docs 公共导出：code → span.docs-tok-*，内容全转义防注入；样式见 style.css --syn-*）
import { highlight } from '@proteus-vue/docs'
// ★#388 后端切换（全部真实调用 @proteus-vue/render-backend 五官方后端）
import { RENDER_BACKENDS, COMPILE_BACKENDS, DEVICES, renderWithBackend, deviceForm, type TreeJsonNode } from '../playground/backends'
import { decodeSource, encodeSource, playgroundUrl } from '../playground/share'
import RenderBox from './RenderBox.vue'
// ★#477 Mini Playground chrome 双语
import { locale, t } from '../i18n'
// ★#445/#449 桌面原语（豁免回收）：剪贴板 copyText + 页面 URL 读写（location/history 收口）——env 省略回落真实全局，页面零裸平台 API
import { copyText, currentPageOrigin, currentPagePathname, replacePageUrl } from '@proteus-vue/desktop'
// ★#389 框架内置能力消费：p-segment（分段控件替代手写 Tab 按钮）+ p-toast（复制反馈）+ p-animate（LIVE 脉冲）——G-32 语义组件
const motionOk = !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)

const props = defineProps({
  /** 紧凑模式（首页内嵌：编辑器矮一点、隐藏分享按钮） */
  compact: { type: Boolean, default: false },
  /** 外部注入初始源码（Playground 分享链接恢复用） */
  initialSource: { type: String, default: '' },
  /** 面板头标题（v3 构图：◆ Mini Playground / Playground） */
  panelTitle: { type: String, default: 'Mini Playground' },
})

const backend = createNodeCompilerBackend()

function demoSource(): string {
  return locale.value === 'en' ? DEMO_SOURCE_EN : DEMO_SOURCE
}
const source = ref(props.initialSource || demoSource())
// ★#477 语言切换时，若编辑器仍是默认示例（未编辑）→ 跟随新语言；用户改过则保留
watch(locale, () => {
  if (props.initialSource) return
  if (source.value === DEMO_SOURCE || source.value === DEMO_SOURCE_EN) source.value = demoSource()
})

const TABS = ['Skyline', 'IR', 'Web', 'WXSS', 'Render', 'Trace'] as const
const activeTab = ref<(typeof TABS)[number]>('Skyline')

const isEn = computed(() => locale.value === 'en')
/** ★#477 Tab 说明英文层（中文见 TAB_INFO） */
const TAB_INFO_EN: Record<(typeof TABS)[number], string> = {
  Skyline: 'Mini-program output (WXML) — the standard Vue template after the compiler: v-if→wx:if, @tap→bind:tap, p-* semantic tags rendered directly',
  IR: 'CompilerIR intermediate representation — the compiler-internal semantic structure (render tree + C-IR semantic tree + bindings capability entries), the G-29 contract every render backend consumes',
  Web: 'Web output = the standard Vue SFC itself (zero transform) — the Web render backend consumes the same IR with no platform rewriting',
  WXSS: 'Mini-program style output — after scoped isolation + px→rpx + selector semanticization (.proteus-*)',
  Render: 'Render-backend output — the real view tree from feeding the same IR to the selected backend above (VueDom / Headless / Native × 3 / Flutter)',
  Trace: 'Compile decision chain — which rule transformed what and where: effective transformations highlighted, untouched ones folded (same source as CLI --trace-transform)',
}
function tabInfo(tab: (typeof TABS)[number]): string {
  return isEn.value ? TAB_INFO_EN[tab] : TAB_INFO[tab]
}
/** ★#477 渲染后端/编译后端/设备英文标签（中文在 backends.ts 数据层） */
const BACKEND_EN: Record<string, string> = {
  vuedom: 'VueDomBackend (Web)',
  headless: 'HeadlessBackend (in-memory tree)',
  'native-ios': 'NativeBackend · iOS (UIKit)',
  'native-android': 'NativeBackend · Android (Jetpack)',
  'native-harmony': 'NativeBackend · HarmonyOS (ArkUI)',
  flutter: 'FlutterBackend (Widget)',
}
const COMPILE_EN: Record<string, string> = { node: 'Node (TS)', rust: 'Rust (native · local CLI required)' }
const DEVICE_EN: Record<string, string> = { web: 'Web 1440', tablet: 'Tablet 834', phone: 'Phone 390', tv: 'Car 1280', watch: 'Watch 198' }
function backendLabel(r: { id: string; label: string }): string {
  return isEn.value ? (BACKEND_EN[r.id] ?? r.label) : r.label
}
function compileLabel(c: { id: string; label: string }): string {
  return isEn.value ? (COMPILE_EN[c.id] ?? c.label) : c.label
}
function deviceLabel(d: { id: string; label: string }): string {
  return isEn.value ? (DEVICE_EN[d.id] ?? d.label) : d.label
}

/** ★#388c 每个 Tab 的自解释说明（切换即读——透明编译的用户教育内建于 UI） */
const TAB_INFO: Record<(typeof TABS)[number], string> = {
  Skyline: '小程序端产物（WXML）——标准 Vue 模板经编译器转换后的 Skyline 语法：v-if→wx:if、@tap→bind:tap、p-* 语义标签直出',
  IR: 'CompilerIR 中间表示——编译器内部的语义结构（render 树 + C-IR 语义树 + bindings 能力入口），G-29 契约，一切渲染后端的共同输入',
  Web: 'Web 端产物 = 标准 Vue SFC 本身（零转换直跑）——Web 渲染后端消费同一份 IR，无需任何平台改写',
  WXSS: '小程序样式产物——scoped 隔离 + px→rpx + 选择器语义化（.proteus-*）后的样式表',
  Render: '渲染后端输出——同一份 IR 喂给上方 RENDER BACKEND 选中的后端（VueDom / Headless / Native × 3 / Flutter）的真实视图树',
  Trace: '编译决策链——每条转换规则在哪些行做了什么：有效转换高亮，原样保留折叠（与 CLI --trace-transform 同源）',
}

// ★#388 可切换状态（v3 四组 select）
const renderBackendId = ref('vuedom')
const device = ref(DEVICES[0]!)
const activeRenderBackend = computed(() => RENDER_BACKENDS.find((r) => r.id === renderBackendId.value) ?? RENDER_BACKENDS[0]!)

const compiled = ref(compileLive(source.value))
/** CompilerIR JSON（G-29 NodeBackend——真实中间表示，非示意图） */
const irJson = ref('')
/** ★#388 真实 CompilerIR（renderIRTree 的输入——同一棵 IR 喂给各渲染后端） */
const irRef = ref<ReturnType<typeof backend.compile> | null>(null)
/** ★#388 选中渲染后端的真实输出树（renderIRTree 真跑） */
const renderTree = ref<TreeJsonNode | null>(null)
const renderError = ref('')

function run(src: string): void {
  compiled.value = compileLive(src)
  try {
    const ir = backend.compile({ source: src, filename: 'playground.vue' })
    irJson.value = JSON.stringify(ir, null, 2)
    irRef.value = ir
    runRenderBackend()
  } catch (e) {
    irJson.value = String(e instanceof Error ? e.message : e)
    irRef.value = null
    renderTree.value = null
  }
}

/** ★#388 渲染后端真跑：renderIRTree(selected backend, ir.render.root) → 各后端真实输出树 */
function runRenderBackend(): void {
  renderError.value = ''
  const ir = irRef.value
  if (!ir) {
    renderTree.value = null
    return
  }
  try {
    const { tree } = renderWithBackend(ir.render.root as never, renderBackendId.value)
    renderTree.value = tree
  } catch (e) {
    renderTree.value = null
    renderError.value = String(e instanceof Error ? e.message : e)
  }
}

function onRenderBackendChange(): void {
  runRenderBackend()
}

watch([renderBackendId, device], () => runRenderBackend())

const renderTreeJson = computed(() => (renderTree.value ? JSON.stringify(renderTree.value, null, 2) : ''))
const renderJsonHtml = computed(() => highlight(renderTreeJson.value || '（空）', 'json'))

let timer: ReturnType<typeof setTimeout> | undefined
watch(source, (src) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    run(src)
    // 分享链接随编辑同步（desktop replacePageUrl = history.replaceState 收口——不产生历史记录，可复制即复现）
    if (!props.compact) replacePageUrl(playgroundUrl(currentPageOrigin(), currentPagePathname(), src))
  }, 200)
})

const output = computed(() => {
  switch (activeTab.value) {
    case 'Skyline': return compiled.value.wxml
    case 'Web': return source.value
    case 'WXSS': return compiled.value.wxss
    case 'IR': return irJson.value
    default: return ''
  }
})

/** 输出面板语言（IR=json / Skyline=html / WXSS=css / **Web=vue（Web 端产物=标准 SFC 本身，与左侧同构）**） */
const outputLang = computed(() => {
  switch (activeTab.value) {
    case 'IR': return 'json'
    case 'Skyline': return 'html'
    case 'WXSS': return 'css'
    case 'Web': return 'vue'
    default: return 'js'
  }
})
/** 高亮后的输出 HTML（highlight 内部已 escapeHtml——v-html 安全） */
const outputHtml = computed(() => highlight(output.value || '（空）', outputLang.value))

const traceByPhase = computed(() => {
  const map = new Map<string, typeof compiled.value.trace>()
  for (const e of compiled.value.trace) {
    if (!map.has(e.phase)) map.set(e.phase, [])
    ;(map.get(e.phase) as typeof compiled.value.trace).push(e)
  }
  return [...map.entries()]
})

// ★#388b Trace 分层：有实际改动的转换（before ≠ after）置顶高亮；原样保留的折叠为可展开分组——
//   透明 ≠ 嘈杂：打开 Trace 第一眼看到的是「编译器对我的代码做了什么手脚」
const traceChanged = computed(() =>
  compiled.value.trace.filter((e) => e.before != null && e.after != null && e.before !== e.after),
)
const traceUnchanged = computed(() =>
  compiled.value.trace.filter((e) => !(e.before != null && e.after != null && e.before !== e.after)),
)
const showUnchanged = ref(false)

function traceChangedClass(e: { before?: string; after?: string }): string {
  return e.before != null && e.after != null && e.before !== e.after ? 'is-changed' : 'is-same'
}

// ★#387 编辑器语法色（叠加法）：高亮 pre 垫底 + 文字透明 textarea 浮上——真实可编辑 + 真实语法色，
//   同源 docs 引擎 highlight（内部转义）；vue 语言不支持时自动退化为纯转义（仍可编辑）
const sourceHtml = computed(() => highlight(source.value + '\n', 'vue'))
const editorHlEl = ref<HTMLElement | null>(null)
const composing = ref(false)
/** ★#389 p-toast 可见态 */
const toastVisible = ref(false)
function syncEditorScroll(e: Event): void {
  const ta = e.target as HTMLTextAreaElement
  if (editorHlEl.value) {
    editorHlEl.value.scrollTop = ta.scrollTop
    editorHlEl.value.scrollLeft = ta.scrollLeft
  }
}

function copyShareLink(): void {
  const url = playgroundUrl(currentPageOrigin(), currentPagePathname(), source.value)
  void copyText(url) // desktop/p-clipboard 原语（Clipboard API + 降级）
  // ★#389 p-toast 反馈（框架内置轻提示）
  toastVisible.value = true
}

// 初次编译（含首跑渲染后端）
run(source.value)
</script>

<template>
  <p-view class="demo-root">
    <!-- ★#388 面板头（v3 构图：◆ 标题 + LIVE 徽标 + 提示） -->
    <p-stack direction="row" :gap="10" class="panel-head">
      <p-text class="panel-title">◆ {{ panelTitle }}</p-text>
      <span class="live-badge">
        <!-- ★#389 LIVE 脉冲 = p-animate（框架内置动画原语——fade 循环即标准 live 指示器；reduced-motion 静态） -->
        <p-animate v-if="motionOk" keyframes="fade" :duration="1400" class="live-pulse">
          <span class="live-dot" />
        </p-animate>
        <span v-else class="live-dot" />
        LIVE
      </span>
      <p-text class="panel-tip">{{ t('pd.tip') }}</p-text>
    </p-stack>
    <!-- ★#388 后端切换工具栏（v3 四组 select——全部真实调用，零伪造） -->
    <p-stack direction="row" :gap="12" wrap class="toolbar">
      <label class="tool-group">
        <span class="tool-label">RENDER BACKEND</span>
        <select v-model="renderBackendId" class="tool-select" :style="{ color: activeRenderBackend.color }">
          <option v-for="r in RENDER_BACKENDS" :key="r.id" :value="r.id">{{ backendLabel(r) }}</option>
        </select>
      </label>
      <label class="tool-group">
        <span class="tool-label">COMPILED BACKEND</span>
        <select class="tool-select" :value="'node'" :disabled="true">
          <option v-for="c in COMPILE_BACKENDS" :key="c.id" :value="c.id" :disabled="c.disabled">{{ compileLabel(c) }}</option>
        </select>
      </label>
      <label class="tool-group">
        <span class="tool-label">DEVICE</span>
        <select v-model="device" class="tool-select">
          <option v-for="d in DEVICES" :key="d.id" :value="d">{{ deviceLabel(d) }}</option>
        </select>
      </label>
      <label class="tool-group">
        <span class="tool-label">CAPABILITY</span>
        <span class="tool-static">{{ t('pd.seeCap') }}</span>
      </label>
    </p-stack>
    <p-split :min-split-width="880" :gap="16" class="pg-grid">
      <!-- 编辑器：标准 Vue SFC（★p-split 第一栏 = 具名插槽 #aside——#386 修复：此前两栏都在默认插槽，split 态从未生效） -->
      <template #aside>
        <p-view class="pg-pane">
          <p-view class="pane-head">
            <p-text class="pane-label">{{ t('pd.file') }}</p-text>
            <button v-if="!compact" class="pane-btn" @click="copyShareLink">{{ t('pd.copy') }}</button>
            <button class="pane-btn" @click="source = demoSource()">{{ t('pd.reset') }}</button>
          </p-view>
          <p-view class="editor-shell" :class="{ composing }">
            <!-- 高亮垫底（aria-hidden：仅供视觉，真实输入在 textarea） -->
            <pre ref="editorHlEl" class="editor-hl" aria-hidden="true"><code v-html="sourceHtml" /></pre>
            <!-- 真实输入层：文字透明 + caret 可见；IME 合成期切回纯文本（合成字透明会看不见） -->
            <textarea
              v-model="source"
              class="editor-input"
              spellcheck="false"
              wrap="off"
              @scroll="syncEditorScroll"
              @compositionstart="composing = true"
              @compositionend="composing = false"
            />
          </p-view>
          <p-text class="pg-meta">
            {{ compiled.error ? '✗ ' + compiled.error : t('pd.trace', { n: String(compiled.trace.length), m: String(traceChanged.length) }) }}
          </p-text>
        </p-view>
      </template>

      <!-- 产物 / IR / Trace -->
      <p-view class="pg-pane">
        <p-view class="pane-head">
          <!-- ★#389 手写 Tab 按钮 → p-segment 分段控件（G-32 shell.segment） -->
          <p-segment
            class="tab-segment"
            :options="TABS.map((t) => ({ label: t, value: t }))"
            :active="activeTab"
            @update:active="activeTab = $event as (typeof TABS)[number]"
          />
        </p-view>
        <!-- ★#388c Tab 自解释说明条（切换即读） -->
        <p-text class="tab-desc"><span class="tab-desc-key">{{ activeTab }}</span>{{ tabInfo(activeTab) }}</p-text>
        <!-- ★#388 Render Tab：选中渲染后端的真实输出（设备框预览 + 后端语义标签） -->
        <p-view v-if="activeTab === 'Render'" class="render-view">
          <p-view class="device-frame" :style="{ '--frame-w': device.width + 'px', '--frame-h': device.height + 'px' }">
            <p-view class="device-inner" :style="{ borderColor: activeRenderBackend.color }">
              <RenderBox v-if="renderTree" :node="renderTree" :color="activeRenderBackend.color" :root="true" />
              <p-text v-else-if="renderError" class="render-err">✗ {{ renderError }}</p-text>
              <p-text v-else class="render-err">（无输出）</p-text>
            </p-view>
          </p-view>
          <p-text class="render-meta">
            {{ activeRenderBackend.label }} · Profile3D {{ device.width }}×{{ device.height }} · F={{ deviceForm(device.width) }} ·
            输出树为 renderIRTree 真实产物，非示意图
          </p-text>
          <pre class="render-json"><code v-html="renderJsonHtml" /></pre>
        </p-view>
        <!-- Trace：结构化渲染（不变） -->
        <!-- ★#388b Trace 分层：有效转换置顶高亮；无变更折叠可展开；阶段分组头加强 -->
        <p-view v-else-if="activeTab === 'Trace'" class="trace-view2">
          <!-- 有效转换（before ≠ after）——编译器真正做了什么 -->
          <p-view class="trace-section">
            <p-text class="trace-section-title">✎ 有效转换 · {{ traceChanged.length }} 条</p-text>
            <p-text v-for="e in traceChanged" :key="e.ruleId + e.line + e.before" class="trace-line2 is-changed">
              <span class="trace-rule">{{ e.ruleId }}</span><span class="trace-loc" v-if="e.line"> :{{ e.line }}</span>
              <span class="trace-diff"><span class="trace-before">{{ e.before }}</span> → <span class="trace-after">{{ e.after }}</span></span>
            </p-text>
            <p-text v-if="!traceChanged.length" class="trace-empty">（本次编译无有效转换——源码已是小程序形态）</p-text>
          </p-view>
          <!-- 原样保留（折叠可展开） -->
          <p-view class="trace-section">
            <button class="trace-toggle" @click="showUnchanged = !showUnchanged">
              {{ showUnchanged ? '▾' : '▸' }} 原样保留 · {{ traceUnchanged.length }} 条（扫过但未改动）
            </button>
            <template v-if="showUnchanged">
              <p-text v-for="e in traceUnchanged" :key="e.ruleId + e.line + e.before" class="trace-line2 is-same">
                <span class="trace-rule">{{ e.ruleId }}</span><span class="trace-loc" v-if="e.line"> :{{ e.line }}</span>
                <span class="trace-diff trace-dim">{{ e.before || e.after }}</span>
              </p-text>
            </template>
          </p-view>
        </p-view>
        <!-- ★#387 语法色输出：highlight（docs 引擎同源，内部已转义） -->
        <pre v-else class="output"><code v-html="outputHtml" /></pre>
        <p-text v-if="compiled.warnings.length && activeTab !== 'Trace'" class="pg-warn">
          {{ compiled.warnings.join(' · ') }}
        </p-text>
      </p-view>
    </p-split>
    <!-- ★#389 p-toast：复制分享链接反馈（框架内置轻提示） -->
    <p-toast :visible="toastVisible" text="分享链接已复制——在另一浏览器打开可复现" position="bottom" @close="toastVisible = false" />
  </p-view>
</template>

<style scoped>
.demo-root { width: 100%; }
/* ★#387 面板头（v3 构图） */
.panel-head { align-items: center; margin-bottom: 12px; }
.panel-title { color: var(--ink); font-weight: 700; font-size: 13px; white-space: nowrap; }
.live-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ok);
  border: 1px solid rgba(61, 220, 151, 0.3);
  background: rgba(61, 220, 151, 0.12);
  border-radius: var(--radius-pill);
  font-size: 10px;
  letter-spacing: 1px;
  padding: 2px 8px;
  white-space: nowrap;
}
.live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); }
.live-pulse { display: inline-flex; align-items: center; }
.panel-tip { color: var(--dim); font-size: 11px; margin-left: auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* ★#388 后端切换工具栏（v3 四组 select） */
.toolbar { align-items: flex-end; margin-bottom: 12px; }
.tool-group { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.tool-label { color: var(--dim); font-size: 10px; letter-spacing: 1px; white-space: nowrap; }
.tool-select {
  background: var(--panel2);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 5px 8px;
  font-size: 12px;
  font-family: ui-monospace, Menlo, monospace;
  cursor: pointer;
  max-width: 240px;
}
.tool-select:disabled { color: var(--dim); cursor: not-allowed; }
.tool-static { color: var(--muted); font-size: 12px; padding: 5px 0; white-space: nowrap; }
/* ★#388 Render Tab（设备框 + 后端输出树可视化）；★#386e flex 收缩链三件套 + box-sizing 显式化——
   p-view 组件默认 content-box（Skyline 对齐），页面侧凡「width:100% + padding」组合必须显式 border-box，
   否则 padding 外扩击穿容器（.render-view 584>556 实测根因） */
.render-view.p-view { display: flex; flex-direction: column; gap: 10px; padding: var(--sp-14); width: 100%; max-width: 100%; min-width: 0; overflow: auto; box-sizing: border-box; }
.device-frame.p-view {
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: 8px;
  /* ★#386e 设备真实宽高 + 永不击穿容器：width: min(设备宽, 100%)——消除内联 width 与 max-width 的博弈 */
  width: min(var(--frame-w, 100%), 100%);
  height: min(var(--frame-h, 300px), 520px);
  min-width: 0;
  box-sizing: border-box;
  background: var(--bg);
  flex: none;
  overflow: auto;
}
.device-inner.p-view { width: 100%; max-width: 100%; min-width: 0; min-height: 240px; border: 1px dashed var(--line); border-radius: var(--radius-sm); padding: 6px; box-sizing: border-box; }
.render-meta { color: var(--muted); font-size: 11px; }
.render-json.p-view {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: var(--sp-10) var(--sp-12);
  margin: 0;
  color: var(--ink);
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11.5px;
  line-height: 1.6;
  overflow: auto;
  max-height: 220px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
.render-json :deep(.docs-tok-keyword) { color: var(--syn-kw); }
.render-json :deep(.docs-tok-string) { color: var(--syn-str); }
.render-json :deep(.docs-tok-number), .render-json :deep(.docs-tok-attr) { color: var(--syn-attr); }
.render-err { color: var(--warn); font-size: 12px; }
.pg-grid {
  /* ★#384：双栏布局归 p-split 原语（容器查询 stacked/split）——页面零布局代码
     ★#386：p-split 不带列样式（模式归原语、列宽归页面）——双栏等分 + 面板撑满高度在此声明 */
  align-items: stretch;
}
.pg-grid :deep(.p-split-aside),
.pg-grid :deep(.p-split-main) { flex: 1 1 0; min-width: 0; display: flex; }
.pg-grid :deep(.p-split-aside) .pg-pane,
.pg-grid :deep(.p-split-main) .pg-pane { flex: 1; }
.pg-pane {
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--panel);
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.pane-head {
  display: flex !important;
  flex-direction: row !important;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}
.pane-label { color: var(--muted); font-size: 12px; margin-right: auto; }
.pane-btn {
  color: var(--brand2);
  background: none;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: var(--sp-4) var(--sp-10);
  font-size: 12px;
  cursor: pointer;
}
.pane-btn:hover { border-color: var(--brand2); }
/* ★#389 Tab 按钮 → p-segment 分段控件：主题走组件变量钩子（--seg-*），布局归组件 */
.tab-segment {
  --seg-bg: var(--panel2);
  --seg-item-color: var(--muted);
  --seg-on-bg: var(--brand-soft);
  --seg-on-color: var(--brand);
}
.tab-segment :deep(.p-segment-item) { padding: 4px 12px; font-size: 12px; cursor: pointer; }
.tab-segment :deep(.p-segment-on) { font-weight: 600; }
/* ★#388c Tab 说明条（切换即读——透明编译的用户教育内建于 UI） */
.tab-desc {
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.6;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line);
  background: rgba(124, 92, 255, 0.04);
}
.tab-desc-key { color: var(--brand); font-weight: 700; margin-right: 8px; font-family: ui-monospace, Menlo, monospace; }
/* ★#387 编辑器 = 高亮 pre 垫底 + 透明 textarea 叠加（同一套字体/字号/行高/padding/white-space，逐像素对齐） */
.editor-shell { position: relative; flex: 1; min-height: 380px; background: var(--panel); }
.editor-hl,
.editor-input {
  position: absolute;
  inset: 0;
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.7;
  padding: var(--sp-14) var(--sp-16);
  white-space: pre;
  tab-size: 2;
  border: none;
}
.editor-hl {
  overflow: hidden;
  color: var(--ink);
  pointer-events: none;
}
.editor-input {
  overflow: auto;
  background: transparent;
  color: transparent;
  -webkit-text-fill-color: transparent;
  caret-color: var(--ink);
  resize: none;
  outline: none;
}
.editor-input::selection { background: rgba(124, 92, 255, 0.35); color: transparent; }
/* 语法色（docs 引擎 docs-tok-* —— 与 style.css --syn-* 同源） */
.editor-hl :deep(.docs-tok-keyword) { color: var(--syn-kw); }
.editor-hl :deep(.docs-tok-string) { color: var(--syn-str); }
.editor-hl :deep(.docs-tok-comment) { color: var(--syn-com); }
.editor-hl :deep(.docs-tok-tag) { color: var(--syn-tag); }
.editor-hl :deep(.docs-tok-number) { color: var(--syn-attr); }
/* IME 合成期：隐藏垫底、显示原生文本（合成中的拼音/候选若透明会不可见） */
.editor-shell.composing .editor-hl { opacity: 0; }
.editor-shell.composing .editor-input { color: var(--ink); -webkit-text-fill-color: initial; }
.output {
  flex: 1;
  min-height: 380px;
  max-width: 100%;
  margin: 0;
  padding: var(--sp-14) var(--sp-16);
  overflow: auto;
  color: var(--ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
}
/* ★#387 语法色（docs 引擎 docs-tok-* —— 与 style.css --syn-* 同源；#386b attr、#386c fn） */
.output :deep(.docs-tok-keyword),
.editor-hl :deep(.docs-tok-keyword) { color: var(--syn-kw); }
.output :deep(.docs-tok-string),
.editor-hl :deep(.docs-tok-string) { color: var(--syn-str); }
.output :deep(.docs-tok-comment),
.editor-hl :deep(.docs-tok-comment) { color: var(--syn-com); }
.output :deep(.docs-tok-tag),
.editor-hl :deep(.docs-tok-tag) { color: var(--syn-tag); }
.output :deep(.docs-tok-fn),
.editor-hl :deep(.docs-tok-fn) { color: var(--syn-fn); }
.output :deep(.docs-tok-number),
.output :deep(.docs-tok-attr),
.editor-hl :deep(.docs-tok-number),
.editor-hl :deep(.docs-tok-attr) { color: var(--syn-attr); }
.trace-phase {
  display: inline-block;
  color: var(--brand);
  border-bottom: 1px solid var(--brand);
  margin: 10px 0 4px;
  font-weight: 600;
}
.trace-line { display: block; }
.trace-rule { color: var(--brand2); }
.trace-dim { color: var(--dim); }
/* ★#388b Trace 分层样式：有效转换高亮 + 无变更折叠 */
.trace-view2 { display: flex; flex-direction: column; gap: 14px; padding: var(--sp-14) var(--sp-16); overflow: auto; }
.trace-section { display: flex; flex-direction: column; gap: 6px; }
.trace-section-title {
  color: var(--ink);
  font-weight: 700;
  font-size: 13px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 6px;
}
.trace-toggle {
  align-self: flex-start;
  background: var(--panel2);
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  padding: 3px 12px;
  font-size: 11px;
  cursor: pointer;
}
.trace-toggle:hover { color: var(--ink); border-color: var(--brand); }
.trace-line2 {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12px;
  border-radius: var(--radius-sm);
  padding: 4px 8px;
}
.trace-line2.is-changed { background: rgba(255, 180, 84, 0.08); border-left: 2px solid var(--warn); }
.trace-line2.is-same { color: var(--dim); }
.trace-loc { color: var(--dim); }
.trace-diff { color: var(--muted); overflow-wrap: anywhere; }
.trace-line2.is-changed .trace-before { color: var(--warn); text-decoration: line-through; text-decoration-color: rgba(255, 180, 84, 0.5); }
.trace-line2.is-changed .trace-after { color: var(--ok); }
.trace-empty { color: var(--dim); font-size: 12px; }
/* ★#386 对比度：meta/trace 说明提级 muted（12px 不用 dim） */
.pg-meta { color: var(--muted); font-size: 12px; padding: var(--sp-8) var(--sp-14); border-top: 1px solid var(--line); margin: 0; }
/* ★#386 警示色接 token（design-tokens color.warn） */
.pg-warn { color: var(--warn); font-size: 12px; padding: 0 var(--sp-14) 10px; margin: 0; }
</style>
