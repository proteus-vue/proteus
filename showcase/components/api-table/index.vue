<!-- showcase/components/api-table/index.vue —— API 表（Props / Events / Slots）
     ★★根节点与容器用原生 <view>（类名留在元素上，scoped 样式生效——见 tokens.css 铁律）。 -->
<script setup lang="ts">

defineProps({
  title: { type: String, default: '' },
  /** 行数据：[名称, 说明, 类型] */
  rows: { type: Array as () => string[][], default: () => [] },
})
</script>

<template>
  <view class="api">
    <view class="api-head">
      <text class="api-title">{{ title }}</text>
      <text class="api-count">{{ rows.length }}</text>
    </view>
    <view class="api-list">
      <view class="api-row" v-for="(row, i) in rows" :key="i">
        <view class="api-line1">
          <text class="api-name">{{ row[0] }}</text>
          <text class="api-type">{{ row[2] }}</text>
        </view>
        <text class="api-desc">{{ row[1] }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.api {
  display: block;
  background: var(--sp-surface);
  border: 1px solid var(--sp-line);
  border-radius: var(--sp-radius-lg);
  padding: var(--sp-4);
  margin-bottom: var(--sp-3);
}
.api-head { display: flex; flex-direction: row; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-3); }
.api-title { display: block; font-size: 15px; font-weight: 700; color: var(--sp-text); }
.api-count {
  display: block;
  font-size: 11px;
  font-weight: 700;
  font-family: var(--sp-mono);
  color: var(--sp-text-3);
  background: var(--sp-surface-2);
  border-radius: 999px;
  padding: 1px 8px;
}
.api-list { display: block; }
.api-row { display: block; padding: var(--sp-3) 0; border-bottom: 1px solid var(--sp-line-soft); }
/* ★2026-09-13 真机修复（问题：属性名与类型「竖排 / 类型被挤出屏幕」）：
   Skyline 下 `flex: 1` 的 text 会**扩张撑满整行**，把右侧类型挤到屏幕外（MP 对照实验：flex:1 与
   flex:1+min-width:0 均溢出，仅 space-between+nowrap 正常）→ 改「两端对齐 + 名称不换行」。 */
.api-line1 { display: flex; flex-direction: row; align-items: center; gap: var(--sp-2); justify-content: space-between; }
.api-name {
  display: block;
  max-width: 62%; /* 名称过长截断省略，把空间让给类型（不撑满整行） */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--sp-mono);
  font-size: 13.5px;
  font-weight: 700;
  color: var(--sp-brand-ink);
}
.api-type {
  display: block;
  flex-shrink: 0;
  font-family: var(--sp-mono);
  font-size: 11px;
  font-weight: 600;
  color: #4a4756;
  background: #f0eefe;
  border: 1px solid #e2ddfb;
  border-radius: 999px;
  padding: 2px 10px;
}
.api-desc { display: block; font-size: 12.5px; color: var(--sp-text-2); margin-top: 4px; line-height: 1.65; }
</style>
