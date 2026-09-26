<script setup lang="ts">
// website/src/components/ComponentDemo.vue —— 组件详情页嵌入 showcase 真交互演示
// 数据链：组件详情 slug（p-button）= showcase 路由（/showcase/subpackages/components/pages/p-button）。
// showcase 以 PROTEUS_BASE=/showcase/ 子路径部署（pages.yml 构建 → website/dist/showcase）。
//   · HEAD 预检：showcase 未部署/未构建（本地 dev）→ 诚实占位，不出破框
//   · 同源 iframe → 加载后量 contentDocument 真实高 + ResizeObserver 跟随（演示块展开/收起）
//   · 「新窗口打开」直达 showcase 页（可交互完整版）
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ dir: string }>()

const src = computed(() => `/showcase/subpackages/components/pages/${props.dir}`)
const checked = ref(false) // HEAD 预检完成
const available = ref(false) // 演示页存在
const loaded = ref(false) // iframe onLoad
const height = ref(560)
const open = ref(true)
const frame = ref<HTMLIFrameElement | null>(null)
let ro: ResizeObserver | undefined

// HEAD 预检（目录存在性）：失败 = 演示未部署，占位降级
fetch(src.value, { method: 'HEAD' })
  .then((r) => {
    available.value = r.ok
  })
  .catch(() => {
    available.value = false
  })
  .finally(() => {
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

watch(loaded, (v) => {
  if (!v) return
  measure()
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

onBeforeUnmount(() => ro?.disconnect())
</script>

<template>
  <div v-if="!checked" class="cd cd--pending">
    <span class="cd-pending-text">正在检查在线演示…</span>
  </div>
  <div v-else-if="available && open" class="cd">
    <header class="cd-head">
      <span class="cd-badge">● LIVE</span>
      <span class="cd-title">在线演示（真实编译产物 · 可交互）</span>
      <span class="cd-actions">
        <button type="button" class="cd-btn" @click="open = false">收起</button>
        <a class="cd-btn cd-btn--brand" :href="src" target="_blank" rel="noopener">新窗口打开 ↗</a>
      </span>
    </header>
    <div class="cd-stage" :style="{ height: `${height}px` }">
      <iframe
        ref="frame"
        class="cd-frame"
        :src="src"
        :title="`组件演示：${dir}`"
        loading="lazy"
        @load="loaded = true"
      />
    </div>
  </div>
  <div v-else-if="available && !open" class="cd cd--closed">
    <header class="cd-head">
      <span class="cd-badge cd-badge--dim">LIVE</span>
      <span class="cd-title">在线演示（已收起）</span>
      <span class="cd-actions">
        <button type="button" class="cd-btn cd-btn--brand" @click="open = true">展开演示</button>
        <a class="cd-btn" :href="src" target="_blank" rel="noopener">新窗口打开 ↗</a>
      </span>
    </header>
  </div>
  <div v-else class="cd cd--missing">
    <span class="cd-pending-text">在线演示未部署（showcase 子站构建缺失）——文档与 API 表仍为源码 SSOT。</span>
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
.cd-badge--dim { color: var(--dim); }
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
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #f7f8fa;
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
