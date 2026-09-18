<!-- showcase/components/catalog-list/index.vue —— 分组目录（官网式信息架构的展示单元）
     用于「组件库」「原生能力」tab：按语义域分组，列出全部条目；
     已有详情页的条目可点击进入（route 非空），未备的标「规划中」（诚实反映进度）。
     ★★根节点与容器用原生 <view>/<text>（类名留在元素上，scoped 样式生效——见 tokens.css 铁律）。 -->
<script setup lang="ts">
import type { CatalogGroup } from '../../data/catalog'

defineProps({
  groups: { type: Array as () => CatalogGroup[], default: () => [] },
  /** 概述副标题（如「6 域 · 72 个语义组件」） */
  summary: { type: String, default: '' },
})
</script>

<template>
  <view class="cat">
    <text v-if="summary" class="cat-sum">{{ summary }}</text>

    <view class="cat-group" v-for="g in groups" :key="g.name">
      <view class="cat-head">
        <text class="cat-name">{{ g.name }}</text>
        <text class="cat-n">{{ g.items.length }}</text>
      </view>
      <text v-if="g.desc" class="cat-desc">{{ g.desc }}</text>

      <view class="cat-items">
        <view v-for="it in g.items" :key="it.name" class="cat-row">
          <a v-if="it.route" class="cat-item" :href="it.route">
            <view class="cat-item-main">
              <text class="cat-item-name">{{ it.name }}</text>
              <text class="cat-item-desc">{{ it.desc }}</text>
            </view>
            <text class="cat-chev">›</text>
          </a>
          <view v-else class="cat-item is-plan">
            <view class="cat-item-main">
              <text class="cat-item-name is-dim">{{ it.name }}</text>
              <text class="cat-item-desc">{{ it.desc }}</text>
            </view>
            <text class="cat-badge">规划中</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.cat { display: block; }
.cat-sum { display: block; font-size: 12.5px; color: var(--sp-text-3); margin-bottom: var(--sp-4); }

.cat-group {
  display: block;
  background: var(--sp-surface);
  border: 1px solid var(--sp-line);
  border-radius: var(--sp-radius-lg);
  padding: var(--sp-4);
  margin-bottom: var(--sp-3);
  box-shadow: var(--sp-shadow-sm);
}
.cat-head { display: flex; flex-direction: row; align-items: center; gap: var(--sp-2); }
.cat-name { display: block; font-size: 16px; font-weight: 700; color: var(--sp-text); }
.cat-n {
  display: block;
  font-size: 11px;
  font-weight: 700;
  font-family: var(--sp-mono);
  color: var(--sp-brand-ink);
  background: var(--sp-brand-soft);
  border-radius: 999px;
  padding: 1px 9px;
}
.cat-desc { display: block; font-size: 12px; color: var(--sp-text-3); margin-top: 3px; line-height: 1.6; }

.cat-items { display: block; margin-top: var(--sp-3); }
.cat-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--sp-3);
  padding: 11px 12px;
  border-radius: var(--sp-radius-md);
  margin-bottom: 4px;
  background: var(--sp-surface-2);
  text-decoration: none;
}
.cat-item.is-plan { background: transparent; }
.cat-item-main { flex: 1; min-width: 0; display: block; }
.cat-item-name {
  display: block;
  font-family: var(--sp-mono);
  font-size: 13.5px;
  font-weight: 700;
  color: var(--sp-brand-ink);
}
.cat-item-name.is-dim { color: var(--sp-text-2); }
.cat-item-desc { display: block; font-size: 12px; color: var(--sp-text-3); margin-top: 2px; line-height: 1.55; }
.cat-chev { display: block; flex-shrink: 0; font-size: 18px; color: var(--sp-text-3); }
.cat-badge {
  display: block;
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--sp-text-3);
  background: var(--sp-surface-2);
  border-radius: 999px;
  padding: 2px 8px;
}
</style>
