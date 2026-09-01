<!-- examples/pages/fluid-system-demo.vue —— ★Fluid System 演示（fluid-system-plan S1：多形态设备语义布局）
     · p-split  自适应分栏：容器宽 < minSplitWidth → 堆叠；≥ → 并排（按容器而非视口——拖宽/拖窄窗口看变化）
     · p-zone   容器断点分区：sm/md/lg/xl 命名槽按容器断点渲染
     · 折叠屏/车机/平板的响应式意图声明
     ★MP 安全：无泛型/类型标注（MP 下无 ResizeObserver → p-split 恒堆叠、p-zone 恒 sm 槽） -->
<script setup lang="ts">
import { ref } from 'vue'
import { PSplit, PZone } from '@proteus-vue/components'

const cards = ref([{ id: 1, title: '分区卡片' }])
function expand(): void {
  const arr = []
  for (let i = 1; i <= 8; i++) arr.push({ id: i, title: '卡片 ' + i })
  cards.value = arr
}
</script>

<template>
  <div class="fluid-system">
    <h2>Fluid System · 多形态设备语义布局</h2>
    <p class="sub">
      响应式基准是<strong>容器</strong>而非视口——折叠屏/平板/车机/多窗口场景下，组件按自身容器宽度求解。
      拖动窗口或缩放容器看实时变化。
    </p>

    <button class="btn" @click="expand">展开 8 卡片</button>

    <!-- ★S1 p-split：窄容器堆叠 → 宽容器并排（aside + 主区） -->
    <p-split :min-split-width="640" :gap="16" class="demo-split">
      <template #aside>
        <div class="aside-box">
          <h3>侧栏（aside）</h3>
          <p class="hint">容器 &lt; 640px → 堆叠在顶部；≥ 640px → 并排左侧</p>
        </div>
      </template>
      <div class="main-box">
        <h3>主区</h3>
        <p class="hint">内容随容器宽度重排——平板横屏/车机分屏场景</p>
      </div>
    </p-split>

    <!-- ★S1 p-zone：容器断点渲染不同子布局（sm/md/lg/xl 命名槽） -->
    <p-zone :design-width="375" class="demo-zone">
      <template #sm>
        <div class="zone-box zone-sm">sm 布局：单列堆叠（容器 &lt; 188px）</div>
      </template>
      <template #md>
        <div class="zone-box zone-md">md 布局：两列（容器 ≥ 328px）</div>
      </template>
      <template #lg>
        <div class="zone-box zone-lg">lg 布局：三列（容器 ≥ 469px）</div>
      </template>
      <template #xl>
        <div class="zone-box zone-xl">xl 布局：四列（容器 ≥ 609px）</div>
      </template>
    </p-zone>

    <!-- 容器内网格（既有 G-22 p-grid 复用） -->
    <p-grid :min-col-width="140" :gap="10" class="demo-grid">
      <div v-for="c in cards" :key="c.id" class="cell">{{ c.title }}</div>
    </p-grid>
  </div>
</template>

<style scoped>
.fluid-system {
  max-width: 1000px;
  margin: 0 auto;
  padding: 24px 16px;
}
.sub {
  color: #666;
  line-height: 1.7;
}
.btn {
  border: 1px solid #1d6fb8;
  color: #1d6fb8;
  background: #fff;
  border-radius: 4px;
  padding: 6px 14px;
  cursor: pointer;
  margin: 8px 0 16px;
}
.demo-split {
  border: 1px dashed #ccc;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 20px;
  min-height: 120px;
}
.aside-box,
.main-box {
  border-radius: 8px;
  padding: 12px;
  flex: 1;
}
.aside-box {
  background: #eef4fb;
  border: 1px solid #d6e4f5;
}
.main-box {
  background: #e8f7ee;
  border: 1px solid #cdeeda;
}
.demo-zone {
  margin-bottom: 20px;
}
.zone-box {
  border-radius: 8px;
  padding: 12px;
  text-align: center;
  margin-bottom: 8px;
}
.zone-sm { background: #fff1f0; }
.zone-md { background: #fff7e6; }
.zone-lg { background: #f6ffed; }
.zone-xl { background: #e6f7ff; }
.demo-grid {
  margin-top: 8px;
}
.cell {
  background: #f0f2f5;
  border-radius: 6px;
  padding: 10px;
  text-align: center;
  font-size: 12px;
}
.hint {
  color: #999;
  font-size: 12px;
}
</style>
