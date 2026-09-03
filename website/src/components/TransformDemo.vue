<script setup lang="ts">
// website/src/components/TransformDemo.vue —— 实时 Transform 演示（01-home.md §3「全站最核心的交互」）
// ★透明编译可交互化（W-4 证明先于宣称）：左侧写标准 Vue SFC，右侧实时出
//   Skyline（wxml）/ IR（CompilerIR JSON——G-29 NodeBackend 真实中间表示）/ Web（零转换=源码）/ WXSS / Trace
// ★B4 复用：首页内嵌 + /playground 全功能页共用本组件（compact 控制形态）
import { computed, ref, watch } from 'vue'
import { compileLive, DEMO_SOURCE } from '../playground/compile'
// ★IR Tab：G-29 NodeBackend 真实 CompilerIR（./node 子路径——浏览器安全单入口，index 全量含 fs 仅 node 侧）
import { createNodeCompilerBackend } from '@proteus-vue/compiler-backend/node'
import { decodeSource, encodeSource, playgroundUrl } from '../playground/share'

const props = defineProps({
  /** 紧凑模式（首页内嵌：编辑器矮一点、隐藏分享按钮） */
  compact: { type: Boolean, default: false },
  /** 外部注入初始源码（Playground 分享链接恢复用） */
  initialSource: { type: String, default: '' },
})

const backend = createNodeCompilerBackend()

const source = ref(props.initialSource || DEMO_SOURCE)

const TABS = ['Skyline', 'IR', 'Web', 'WXSS', 'Trace'] as const
const activeTab = ref<(typeof TABS)[number]>('Skyline')

const compiled = ref(compileLive(source.value))
/** CompilerIR JSON（G-29 NodeBackend——真实中间表示，非示意图） */
const irJson = ref('')

function run(src: string): void {
  compiled.value = compileLive(src)
  try {
    const ir = backend.compile({ source: src, filename: 'playground.vue' })
    irJson.value = JSON.stringify(ir, null, 2)
  } catch (e) {
    irJson.value = String(e instanceof Error ? e.message : e)
  }
}
run(source.value)

let timer: ReturnType<typeof setTimeout> | undefined
watch(source, (src) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    run(src)
    // 分享链接随编辑同步（replaceState 不产生历史记录——可复制即复现）
    if (!props.compact) history.replaceState(null, '', playgroundUrl(location.origin, location.pathname, src))
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

const traceByPhase = computed(() => {
  const map = new Map<string, typeof compiled.value.trace>()
  for (const e of compiled.value.trace) {
    if (!map.has(e.phase)) map.set(e.phase, [])
    ;(map.get(e.phase) as typeof compiled.value.trace).push(e)
  }
  return [...map.entries()]
})

function copyShareLink(): void {
  const url = playgroundUrl(location.origin, location.pathname, source.value)
  void navigator.clipboard?.writeText(url)
}
</script>

<template>
  <p-view class="demo-root">
    <p-view class="pg-grid">
      <!-- 编辑器：标准 Vue SFC -->
      <p-view class="pg-pane">
        <p-view class="pane-head">
          <p-text class="pane-label">playground.vue（标准 Vue SFC，无平台 DSL）</p-text>
          <button v-if="!compact" class="pane-btn" @click="copyShareLink">复制分享链接</button>
          <button class="pane-btn" @click="source = DEMO_SOURCE">重置示例</button>
        </p-view>
        <textarea v-model="source" class="editor" spellcheck="false" />
        <p-text class="pg-meta">
          {{ compiled.error ? '✗ ' + compiled.error : '实时编译 · 触发规则 ' + compiled.trace.length + ' 条' }}
        </p-text>
      </p-view>

      <!-- 产物 / IR / Trace -->
      <p-view class="pg-pane">
        <p-view class="pane-head">
          <button
            v-for="t in TABS"
            :key="t"
            class="tab-btn"
            :class="{ active: activeTab === t }"
            @click="activeTab = t"
          >{{ t }}</button>
        </p-view>
        <pre v-if="activeTab === 'Trace'" class="output trace-view"><code><template v-for="[phase, evts] in traceByPhase" :key="phase"><span class="trace-phase">{{ phase }}</span><template v-for="e in evts" :key="e.ruleId + e.line"><span class="trace-line">  <span class="trace-rule">{{ e.ruleId }}</span><span v-if="e.line" class="trace-dim"> :{{ e.line }}</span></span><span v-if="e.before" class="trace-dim">    {{ e.before }} → {{ e.after }}</span></template></template></code></pre>
        <pre v-else class="output"><code>{{ output || '（空）' }}</code></pre>
        <p-text v-if="compiled.warnings.length && activeTab !== 'Trace'" class="pg-warn">
          {{ compiled.warnings.join(' · ') }}
        </p-text>
      </p-view>
    </p-view>
  </p-view>
</template>

<style>
.demo-root { width: 100%; }
.pg-grid {
  display: grid;
  /* ★柔性网格（W-6）：双栏自适应，窄容器自动堆叠——零 @media */
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
  gap: 16px;
  align-items: stretch;
}
.pg-pane {
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.pane-head {
  display: flex;
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
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.pane-btn:hover { border-color: var(--brand2); }
.tab-btn {
  color: var(--muted);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
}
.tab-btn.active { color: var(--brand); border-bottom-color: var(--brand); }
.editor {
  flex: 1;
  min-height: 420px;
  background: var(--panel);
  color: var(--ink);
  border: none;
  outline: none;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.7;
  padding: 14px 16px;
  white-space: pre;
}
.output {
  flex: 1;
  min-height: 420px;
  margin: 0;
  padding: 14px 16px;
  overflow: auto;
  color: var(--ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
}
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
.pg-meta { color: var(--dim); font-size: 12px; padding: 8px 14px; border-top: 1px solid var(--line); margin: 0; }
.pg-warn { color: #ffb454; font-size: 12px; padding: 0 14px 10px; margin: 0; }
</style>
