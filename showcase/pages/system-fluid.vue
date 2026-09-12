<!-- showcase/pages/system-fluid.vue —— 柔性布局（真渲染 p-grid / p-stack / p-split） -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../components/page-shell/index.vue'
import { PText, PView } from '@proteus-vue/components'
import PGrid from '@proteus-vue/components/p-grid/index.vue'
import PStack from '@proteus-vue/components/p-stack/index.vue'
import PSplit from '@proteus-vue/components/p-split/index.vue'

const cols = ref([1, 2, 3, 4, 5, 6])
</script>

<template>
  <page-shell title="柔性布局" subtitle="G-22 自适应网格 / 弹性栈 / 分栏 · 真渲染">
    <p-text class="sec">p-grid（自适应列数：容器变窄自动折行）</p-text>
    <pgrid class="card" :min-col-width="96" :gap="10">
      <p-view class="cell" v-for="c in cols" :key="c">{{ c }}</p-view>
    </pgrid>

    <p-text class="sec">p-stack（弹性栈：横向 + 换行）</p-text>
    <pstack class="card" direction="row" :wrap="true" :gap="8">
      <p-view class="chip" v-for="c in cols" :key="c">项 {{ c }}</p-view>
    </pstack>

    <p-text class="sec">p-split（宽容器左右分栏，窄容器堆叠）</p-text>
    <psplit class="card" :min-split-width="560" :gap="12">
      <template #aside>
        <p-view class="pane aside">aside（侧栏）</p-view>
      </template>
      <p-view class="pane main">main（主区）</p-view>
    </psplit>

    <p-text class="note">调整 DevTools 模拟器宽度观察折行/分栏切换——零 @media，全部由容器查询驱动。</p-text>
  </page-shell>
</template>

<style scoped>
.sec { display: block; font-size: 14px; font-weight: 700; margin: var(--sp-4) 0 var(--sp-2); color: var(--sp-text); }
.card { background: var(--sp-surface); border: 1px solid var(--sp-line); border-radius: var(--sp-radius-lg); padding: var(--sp-3); box-shadow: var(--sp-shadow-sm); }
.cell {
  display: flex; flex-direction: row; align-items: center; justify-content: center;
  height: 56px; background: var(--sp-brand-soft); color: var(--sp-brand-ink);
  border-radius: var(--sp-radius-sm); font-weight: 700;
}
.chip { display: block; padding: 6px 12px; background: var(--sp-surface-2); border: 1px solid var(--sp-line); border-radius: var(--sp-radius-sm); font-size: 13px; }
.pane { display: flex; flex-direction: row; align-items: center; justify-content: center; border-radius: var(--sp-radius-sm); font-size: 13px; color: #fff; }
.aside { height: 72px; background: var(--sp-bk-flutter); }
.main { height: 72px; background: var(--sp-brand); }
.note { display: block; font-size: 12px; color: var(--sp-text-3); line-height: 1.6; margin-top: var(--sp-3); }
</style>
