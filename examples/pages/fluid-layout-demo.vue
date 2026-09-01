<!-- examples/pages/fluid-layout-demo.vue —— ★G-22 柔性布局演示（fluid-layout-plan B1-B3）
     声明一次语义布局，框架自动适配任意屏幕：
     · p-grid    只声明每列最小宽度，列数自动（320→1 / 768→4 / 1440→8）
     · p-stack   方向 + 间距 + 智能换行
     · p-fit     内在尺寸（内容驱动，不超过容器 maxRatio）
     · p-fluid   流式尺寸（clamp 生成——B1 纯算法已落地，指令编译/运行时接入后续批次）
     ★MP 产物安全：无泛型/类型标注/interface -->
<script setup lang="ts">
import { ref } from 'vue'
import { PGrid, PStack, PFit } from '@proteus-vue/components'

const cards = ref([{ id: 1, title: '网格卡片' }])
const tags = ref([{ id: 1, label: '标签' }])

// 展开更多演示数据（方法体内循环——MP 编译器支持）
function expand(): void {
  const arr = []
  for (let i = 1; i <= 12; i++) arr.push({ id: i, title: '卡片 ' + i })
  cards.value = arr
  const t = []
  for (let i = 1; i <= 8; i++) t.push({ id: i, label: '标签 ' + i })
  tags.value = t
}
</script>

<template>
  <div class="fluid">
    <h2>柔性布局（Fluid Layout）</h2>
    <p class="sub">
      声明式语义布局：<code>p-grid</code> 只声明每列最小宽度（160px）——320px→1 列、768px→4 列、1440px→8 列，框架自动求解。
    </p>

    <button class="btn" @click="expand">展开 12 卡片 + 8 标签</button>

    <!-- ★B2 自适应网格：列数自动（resize 浏览器窗口实时变化） -->
    <p-grid :min-col-width="160" :gap="12" class="demo-grid">
      <div v-for="c in cards" :key="c.id" class="cell">
        <p class="cell-title">{{ c.title }}</p>
      </div>
    </p-grid>

    <!-- ★B3 弹性栈：横向 + 换行（空间不足自动折行） -->
    <p-stack direction="row" :wrap="true" :gap="8" class="demo-stack">
      <span v-for="t in tags" :key="t.id" class="tag">{{ t.label }}</span>
    </p-stack>

    <!-- ★B3 内在尺寸：宽度由内容决定，不超过容器 80% -->
    <div class="fit-box">
      <p-fit :max-ratio="0.8" class="fit-chip">内容驱动宽度（fit-content · 最大 80%）</p-fit>
    </div>

    <!-- ★B1 算法预览（纯函数已落地，指令接入后续） -->
    <pre class="pre">clamp(20px, calc(15.77px + 1.1268vw), 32px)  ← p-fluid="font-size(20,32)" 编译产物</pre>
  </div>
</template>

<style scoped>
.fluid {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px 16px;
}
.sub {
  color: #666;
  line-height: 1.7;
}
code {
  background: #f2f3f5;
  border-radius: 3px;
  padding: 0 4px;
}
.btn {
  border: 1px solid #07c160;
  color: #07c160;
  background: #fff;
  border-radius: 4px;
  padding: 6px 14px;
  cursor: pointer;
  margin: 8px 0 16px;
}
.demo-grid {
  margin-bottom: 20px;
}
.cell {
  background: #e8f7ee;
  border-radius: 8px;
  padding: 16px;
  text-align: center;
  min-height: 64px;
  box-sizing: border-box;
}
.cell-title {
  margin: 0;
  color: #07c160;
  font-weight: 600;
}
.demo-stack {
  margin-bottom: 20px;
}
.tag {
  background: #f0f2f5;
  border-radius: 12px;
  padding: 4px 12px;
  font-size: 12px;
}
.fit-box {
  background: #f8f9fa;
  border: 1px dashed #ccc;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}
.fit-chip {
  background: #1d6fb8;
  color: #fff;
  border-radius: 6px;
  padding: 8px 12px;
}
.pre {
  background: #f8f9fa;
  border-radius: 6px;
  padding: 8px;
  font-size: 11px;
  overflow: auto;
  white-space: pre-wrap;
}
</style>
