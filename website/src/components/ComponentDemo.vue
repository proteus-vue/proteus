<script setup lang="ts">
// website/src/components/ComponentDemo.vue —— 组件详情页嵌入 showcase 真交互演示
// 数据链：组件详情 slug（p-button）= showcase 路由（/showcase/subpackages/components/pages/p-button）。
// showcase 以 PROTEUS_BASE=/showcase/ 子路径部署（pages.yml 构建 → website/dist/showcase）。
//   · HEAD 预检：showcase 未部署/未构建（本地 dev）→ 诚实占位，不出破框
//   · 同源 iframe → 加载后量 contentDocument 真实高 + ResizeObserver 跟随（演示块展开/收起）
//   · ★加载体验（2026-09-26 反馈「点开白屏一段时间」）：iframe 挂载到 showcase 应用首帧绘制
//     之间有一段网络+启动空窗——骨架屏**垫在 iframe 底下**（iframe 初始透明，应用绘制后
//     自然盖住骨架，零闪烁）；painted 以「#app 有子节点」判定（有界 rAF 轮询，同源可读）；
//     收起/展开改 v-show（已加载的 iframe 保活，二次展开零等待）
//   · 「新窗口打开」直达 showcase 页（可交互完整版）
import { computed, onBeforeUnmount, ref, watch } from 'vue'
// ★D-2 dogfooding（2026-09-26）：HTTP 预检走能力原语 useFetch（能力桥按端选择执行面），
//   页面零裸 fetch——与「页面不裸写平台 API」纪律一致；缺桥/网络失败 → CapResult.ok=false（诚实降级）
import { createCapabilityHooks } from '@proteus-vue/api'
import { locale } from '../i18n'

const props = defineProps<{ dir: string }>()

const isEn = computed(() => locale.value === 'en')
const src = computed(() => `/showcase/subpackages/components/pages/${props.dir}`)
const checked = ref(false) // HEAD 预检完成
const available = ref(false) // 演示页存在
const loaded = ref(false) // iframe onLoad
const painted = ref(false) // showcase 应用首帧已绘制（撤骨架）
const height = ref(560)
const open = ref(true)
const frame = ref<HTMLIFrameElement | null>(null)
let ro: ResizeObserver | undefined
let paintRaf = 0

// 预检（演示页存在性）：失败 = 演示未部署/未构建（本地 dev），占位降级
const caps = createCapabilityHooks()
caps.useFetch<string>(src.value).then((r) => {
  available.value = r.ok
  checked.value = true
})

function measure() {
  try {
    const doc = frame.value?.contentDocument
    if (!doc?.body) return
    const h = Math.max(doc.body.scrollHeight, doc.documentElement?.scrollHeight ?? 0)
    if (h > 240) height.value = Math.min(h + 16, 2600)
  } catch {
    /* 非同源（不应发生）→ 保持当前高度 */
  }
}

/** 等内部应用真正挂载（#app 有子节点）再撤骨架——load 事件早于异步路由块渲染 */
function waitPainted(attempt = 0) {
  try {
    const app = frame.value?.contentDocument?.querySelector('#app')
    if (app && app.children.length > 0) {
      painted.value = true
      measure()
      return
    }
  } catch {
    painted.value = true // 读取失败（异常态）→ 兜底撤骨架，不无限等
    return
  }
  if (attempt < 60) paintRaf = requestAnimationFrame(() => waitPainted(attempt + 1))
  else painted.value = true
}

watch(loaded, (v) => {
  if (!v) return
  waitPainted()
  try {
    const doc = frame.value?.contentDocument
    if (doc?.body && typeof ResizeObserver !== 'undefined') {
      ro?.disconnect()
      ro = new ResizeObserver(measure)
      ro.observe(doc.body)
    }
  } catch {
    /* 忽略——固定高兜底 */
  }
})

onBeforeUnmount(() => {
  ro?.disconnect()
  if (paintRaf) cancelAnimationFrame(paintRaf)
})

const title = computed(() => (isEn.value ? 'Live demo (real compiled output · interactive)' : '在线演示（真实编译产物 · 可交互）'))
const collapseLabel = computed(() => (open.value ? (isEn.value ? 'Collapse' : '收起') : isEn.value ? 'Expand demo' : '展开演示'))
const openTabLabel = computed(() => (isEn.value ? 'Open in new tab ↗' : '新窗口打开 ↗'))
const loadingLabel = computed(() => (isEn.value ? 'Loading live demo…' : '正在加载在线演示…'))
</script>

<template>
  <div v-if="!checked" class="cd cd--pending">
    <span class="cd-pending-text">{{ isEn ? 'Checking live demo…' : '正在检查在线演示…' }}</span>
  </div>
  <div v-else-if="available" class="cd">
    <header class="cd-head">
      <span class="cd-badge">● LIVE</span>
      <span class="cd-title">{{ title }}</span>
      <span class="cd-actions">
        <button type="button" class="cd-btn" @click="open = !open">{{ collapseLabel }}</button>
        <a class="cd-btn cd-btn--brand" :href="src" target="_blank" rel="noopener">{{ openTabLabel }}</a>
      </span>
    </header>
    <div v-show="open" class="cd-stage" :style="{ height: `${height}px` }">
      <!-- 骨架垫底：iframe 初始透明 → 应用首帧绘制后自然盖住（无白屏无闪烁） -->
      <div v-if="!painted" class="cd-skel" aria-hidden="true">
        <span class="cd-skel-bar cd-skel-bar--title" />
        <span class="cd-skel-bar cd-skel-bar--block" />
        <span class="cd-skel-bar cd-skel-bar--block cd-skel-bar--short" />
        <span class="cd-skel-hint">{{ loadingLabel }}</span>
      </div>
      <iframe
        ref="frame"
        class="cd-frame"
        :src="src"
        :title="`Live demo: ${dir}`"
        loading="lazy"
        @load="loaded = true"
      />
    </div>
  </div>
  <div v-else class="cd cd--missing">
    <span class="cd-pending-text">
      {{ isEn
        ? 'Live demo not deployed (showcase sub-site build missing) — docs & API tables remain source-of-truth.'
        : '在线演示未部署（showcase 子站构建缺失）——文档与 API 表仍为源码 SSOT。' }}
    </span>
  </div>
</template>

<style scoped>
.cd {
  margin: 4px 0 22px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
}
.cd-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  background: var(--panel2);
  border-bottom: 1px solid var(--line);
}
.cd-badge {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.6px;
  color: var(--ok, #3ddc97);
}
.cd-title {
  flex: 1;
  font-size: 12.5px;
  color: var(--muted);
}
.cd-actions { display: flex; gap: 8px; }
.cd-btn {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--muted);
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 11px;
  cursor: pointer;
  text-decoration: none;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.cd-btn:hover { color: var(--ink); border-color: rgba(124, 92, 255, 0.5); }
.cd-btn--brand { color: var(--brand-ink); border-color: rgba(124, 92, 255, 0.45); }
.cd-stage { position: relative; transition: height 0.2s ease; }
.cd-frame {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent; /* 骨架从底下透出，应用绘制后覆盖 */
}
/* 骨架（浅色系——与 showcase 演示页最终观感一致）：微光扫过 + 轻提示 */
.cd-skel {
  position: absolute;
  inset: 0;
  background: #f7f8fa;
  overflow: hidden;
}
.cd-skel::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, transparent 32%, rgba(124, 92, 255, 0.1) 50%, transparent 68%);
  animation: cd-skel-sweep 1.4s ease-in-out infinite;
}
@keyframes cd-skel-sweep {
  from { transform: translateX(-100%); }
  to { transform: translateX(100%); }
}
.cd-skel-bar {
  position: absolute;
  left: 34px;
  display: block;
  border-radius: 8px;
  background: #dfe3ee;
}
.cd-skel-bar--title { top: 42px; width: 180px; height: 26px; }
.cd-skel-bar--block { top: 100px; width: 62%; height: 96px; }
.cd-skel-bar--short { top: 212px; width: 40%; height: 64px; }
.cd-skel-hint {
  position: absolute;
  left: 34px;
  bottom: 22px;
  font-size: 12px;
  color: #878ea1;
}
.cd--pending,
.cd--missing {
  padding: 14px;
  border-style: dashed;
}
.cd-pending-text {
  font-size: 12px;
  color: var(--dim);
}
</style>
