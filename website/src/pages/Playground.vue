<script setup lang="ts">
// website/src/pages/Playground.vue —— Website B3：Playground 内核
// ★透明编译可交互化（W-4 证明先于宣称）：左侧写标准 Vue SFC，右侧实时出小程序产物 +
//   决策 trace（哪一行触发了哪条规则）+ 69 条规则 AI 说明书目录——"编译器对 AI 与人都是透明的"
// ★W-6 柔性框架优先：双栏布局 = 柔性网格（auto-fit/minmax），排版 v-p-fluid，零 @media
// ★诚实边界：编辑器 MVP 用 textarea（Monaco 随 B4 评估）；编译在主线程（小文档 <10ms，
//   Worker 隔离随大文档场景评估）；产物 .json 由路由生成器负责（Playground 展示三件套）
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { compileLive, DEMO_SOURCE } from '../playground/compile'
import { decodeSource, encodeSource, playgroundUrl } from '../playground/share'

const route = useRoute()

// 初始源码：分享链接 ?code= 优先（可复现），否则内置演示
const initial = typeof route.query.code === 'string' ? decodeSource(route.query.code) : DEMO_SOURCE
const source = ref(initial)

const TABS = ['WXML', 'JS', 'WXSS', 'Trace', '规则目录'] as const
const activeTab = ref<(typeof TABS)[number]>('WXML')

const result = ref(compileLive(source.value))
const compiling = ref(false)

let timer: ReturnType<typeof setTimeout> | undefined
watch(source, (src) => {
  compiling.value = true
  clearTimeout(timer)
  timer = setTimeout(() => {
    result.value = compileLive(src)
    compiling.value = false
    // 分享链接随编辑同步（replaceState 不产生历史记录——可复制即复现）
    const url = playgroundUrl(location.origin, location.pathname, src)
    history.replaceState(null, '', url)
  }, 200)
})

const output = computed(() => {
  switch (activeTab.value) {
    case 'WXML': return result.value.wxml
    case 'JS': return result.value.js
    case 'WXSS': return result.value.wxss
    default: return ''
  }
})

const traceByPhase = computed(() => {
  const map = new Map<string, typeof result.value.trace>()
  for (const e of result.value.trace) {
    if (!map.has(e.phase)) map.set(e.phase, [])
    ;(map.get(e.phase) as typeof result.value.trace).push(e)
  }
  return [...map.entries()]
})

function copyShareLink(): void {
  const url = playgroundUrl(location.origin, location.pathname, source.value)
  void navigator.clipboard?.writeText(url)
}
</script>

<template>
  <div class="playground">
    <header v-p-fluid="'padding(28, 48)'" class="pg-head">
      <span class="eyebrow">◆ Playground · 透明编译</span>
      <h1 v-p-fluid="'font-size(22, 36)'" class="pg-title">左边写标准 Vue，右边看编译器在想什么</h1>
      <p class="pg-sub">
        浏览器内实时编译（同一套 @proteus-vue/compiler，与本地 build 同源）：
        产物、决策 trace（哪一行触发了哪条规则）、{{ result.ruleCount }} 条规则的 AI 说明书全部可查——拒绝黑盒。
      </p>
    </header>

    <div class="pg-grid">
      <!-- 编辑器 -->
      <section class="pg-pane">
        <div class="pane-head">
          <span class="pane-label">playground.vue（标准 Vue SFC，无平台 DSL）</span>
          <button class="pane-btn" @click="copyShareLink">复制分享链接</button>
          <button class="pane-btn" @click="source = DEMO_SOURCE">重置示例</button>
        </div>
        <textarea v-model="source" class="editor" spellcheck="false" />
        <p class="pg-meta">
          {{ compiling ? '编译中…' : '实时编译' }}
          <template v-if="result.error"> · <span class="pg-error">✗ {{ result.error }}</span></template>
          <template v-else> · 触发规则 {{ result.trace.length }} 条</template>
        </p>
      </section>

      <!-- 产物 / Trace / 规则 -->
      <section class="pg-pane">
        <div class="pane-head">
          <button
            v-for="t in TABS"
            :key="t"
            class="tab-btn"
            :class="{ active: activeTab === t }"
            @click="activeTab = t"
          >{{ t }}</button>
        </div>

        <pre v-if="activeTab === 'Trace'" class="output trace-view"><code><template v-for="[phase, evts] in traceByPhase" :key="phase"><span class="trace-phase">{{ phase }}</span><template v-for="e in evts" :key="e.ruleId + e.line"><span class="trace-line">  <span class="trace-rule">{{ e.ruleId }}</span><span v-if="e.line" class="trace-dim"> :{{ e.line }}</span></span><span v-if="e.before" class="trace-dim">    {{ e.before }} → {{ e.after }}</span></template></template></code></pre>

        <div v-else-if="activeTab === '规则目录'" class="rules-view">
          <p class="pg-dim">AI 说明书目录由编译器注册表导出（listTransformRules）——每条规则自带 what/why/when/example/verify，产物可反查源码。</p>
        </div>

        <pre v-else class="output"><code>{{ output || '（空）' }}</code></pre>

        <p v-if="result.warnings.length && activeTab !== 'Trace'" class="pg-warn">
          {{ result.warnings.join(' · ') }}
        </p>
      </section>
    </div>
  </div>
</template>

<style>
.pg-head { max-width: 1180px; }
.pg-title { color: var(--ink); margin: 14px 0 10px; }
.pg-sub { color: var(--muted); font-size: 14px; line-height: 1.7; max-width: 720px; margin: 0; }
.pg-grid {
  display: grid;
  /* ★柔性网格（W-6）：双栏自适应，窄容器自动堆叠——零 @media */
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
  gap: 16px;
  align-items: stretch;
  padding: 0 24px 48px;
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
.rules-view { padding: 14px 16px; }
.pg-dim { color: var(--dim); font-size: 13px; }
.pg-meta { color: var(--dim); font-size: 12px; padding: 8px 14px; border-top: 1px solid var(--line); margin: 0; }
.pg-error { color: var(--accent); }
.pg-warn { color: #ffb454; font-size: 12px; padding: 0 14px 10px; margin: 0; }
</style>
