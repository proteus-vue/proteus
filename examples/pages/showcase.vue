<!-- examples/pages/showcase.vue —— 转场演示页（scaleDown 综合能力演示的目标页） -->
<route>
{
  "meta": {
    "title": "转场演示"
  }
}
</route>
<script setup lang="ts">
import { ref } from 'vue'

const cards = ref([
  { title: '缓出/缓入曲线', desc: '进入 easeOutCubic / 退出 easeInCubic（worklet 内联）' },
  { title: '遮罩 barrierColor', desc: 'rgba(0,0,0,0.8) + 点击关闭' },
  { title: '前后页联动', desc: 'handlePreviousPageAnimation 前页下沉缩放' },
  { title: '时长', desc: '400ms 进 / 360ms 退' },
  { title: '手势返回', desc: 'fullscreenDrag + 下滑 popGestureDirection' },
])
</script>

<template>
  <div class="showcase">
    <h2>缩放转场演示</h2>
    <p class="sub">进入时底部滑入 + 放大，前页下沉缩放联动</p>
    <div v-for="(card, idx) in cards" :key="idx" class="card">
      <h3>{{ card.title }}</h3>
      <p>{{ card.desc }}</p>
    </div>
    <div class="links">
      <a href="/pages/user/profile" route-type="scaleDown">→ 个人资料（层叠缩放：本页下沉 + 目标页滑入）</a>
    </div>
  </div>
</template>

<style>
.showcase {
  padding: 24px;
  text-align: center;
}
.sub {
  color: #888;
  font-size: 14px;
}
.card {
  background: #f5f6f7;
  border-radius: 12px;
  padding: 16px;
  margin: 12px 0;
  text-align: left;
}
.card h3 {
  margin: 0 0 4px;
  font-size: 16px;
}
.card p {
  margin: 0;
  color: #666;
  font-size: 13px;
}
.links {
  margin-top: 20px;
}
.links a {
  display: block;
  padding: 8px 0;
  color: #1a7af8;
}
</style>
