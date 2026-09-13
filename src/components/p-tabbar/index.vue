<!-- src/components/p-tabbar/index.vue —— 底部标签栏（★G-32 B2：shell.tabbar S3）
     tabs（{key,label,badge?,icon?}[]）+ active 受控（v-model:active）+ select emit
     双端同源码：nav → view；item 字段经 computed 预计算为数据行（WXML 禁止函数调用 S38；dataset 传 key）。 -->
<template>
  <nav class="p-tabbar">
    <div
      v-for="row in rows"
      :key="row.key"
      class="p-tab"
      :class="{ 'p-tab-on': active == row.key }"
      :data-value="row.key"
      @click="onSelect"
    >
      <div class="p-tab-icon">
        <p-icon v-if="row.icon" :name="row.icon" :size="20" />
      </div>
      <div class="p-tab-label">{{ row.label }}</div>
      <div v-if="row.badge" class="p-tab-badge">{{ row.badge }}</div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import PIcon from '../p-icon/index.vue'

interface TabItem {
  key?: string | number
  label?: string
  badge?: string | number
  icon?: string
}

const props = defineProps({
  /** 标签项数组（{key,label,badge?,icon?}） */
  tabs: { type: Array as () => TabItem[], default: () => [] },
  /** 当前激活项 key */
  active: { type: [String, Number], default: '' },
})

const emit = defineEmits(['update:active', 'select'])

/** ★预计算数据行（WXML 不能调函数——key/label/icon/badge 在此算好） */
const rows = computed(() =>
  props.tabs.map((t) => {
    const key = String(t['key'] != null ? t['key'] : '')
    return {
      key,
      label: t.label != null ? t.label : '',
      icon: t.icon != null ? t.icon : '',
      badge: t.badge != null && t.badge !== '' ? String(t.badge) : '',
    }
  }),
)

function onSelect(e: unknown): void {
  const ev = e as { currentTarget?: { dataset?: { value?: unknown } } }
  const key = String(ev?.currentTarget?.dataset?.value ?? '')
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
