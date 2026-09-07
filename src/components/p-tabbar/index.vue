<!-- src/components/p-tabbar/index.vue —— 底部标签栏（★G-32 B2：shell.tabbar S3）
     tabs（{key,label,badge?,icon?}[]）+ active 受控（v-model:active）+ select emit
     双端同源码：nav → view；item 字段经方法取（MP 安全：避免数组泛型 TS18046） -->
<template>
  <nav class="p-tabbar">
    <div
      v-for="t in tabs"
      :key="tabKey(t)"
      class="p-tab"
      :class="{ 'p-tab-on': tabKey(t) === String(active) }"
      @click="onSelect(t)"
    >
      <div class="p-tab-icon">
        <p-icon v-if="tabIcon(t)" :name="tabIcon(t)" :size="20" />
      </div>
      <div class="p-tab-label">{{ tabLabel(t) }}</div>
      <div v-if="tabBadge(t)" class="p-tab-badge">{{ tabBadge(t) }}</div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import PIcon from '../p-icon/index.vue'

const props = defineProps({
  /** 标签项数组（{key,label,badge?,icon?}） */
  tabs: { type: Array as () => unknown[], default: () => [] },
  /** 当前激活项 key */
  active: { type: [String, Number], default: '' },
})

const emit = defineEmits(['update:active', 'select'])

// ★MP 安全：字段访问走方法 + 方法体内 as 断言（MP 编译器剥方法体；避免模板内 unknown 直用）
function tabKey(item: unknown): string {
  const t = item as { key?: string | number }
  return String(t.key ?? '')
}
function tabLabel(item: unknown): string {
  const t = item as { label?: string }
  return t.label ?? ''
}
function tabIcon(item: unknown): string {
  const t = item as { icon?: string }
  return t.icon ?? ''
}
function tabBadge(item: unknown): string {
  const t = item as { badge?: string | number }
  return String(t.badge ?? '')
}

function onSelect(item: unknown): void {
  const t = item as { key?: string | number }
  const key = String(t.key ?? '')
  emit('update:active', key)
  emit('select', key)
}
</script>

<style scoped>
.p-tabbar {
  display: flex;
  height: 50px;
  background: var(--p-tabbar-bg, #ffffff);
  border-top: 1px solid var(--p-tabbar-border, #ebedf0);
}
.p-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: #646566;
  position: relative;
  font-size: 11px;
}
.p-tab-on {
  color: #07c160;
}
.p-tab-icon {
  height: 22px;
  display: flex;
  align-items: center;
}
.p-tab-badge {
  position: absolute;
  top: 4px;
  right: calc(50% - 18px);
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: #fa5151;
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}
</style>