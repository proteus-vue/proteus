<!-- examples/pages/vue-compat-demo.vue —— ★Vue 能力对齐真机验收栏目页（2026-09-08）
     规范化逐个能力演示：每能力一个卡片（可观察状态 + 触发方法），供 tests/e2e-vue-compat.test.ts
     逐个真机断言（console 零错门禁 + 页 data/DOM）。能力都经 @vue/compiler-sfc 权威语义对齐 glass-easel。
     页面会被自动收录进路由（gen-routes 全页面收录），无需手动注册。 -->
<route>
  { "title": "Vue 能力对齐" }
</route>
<template>
  <view class="page">
    <text class="page-title">Vue 能力对齐</text>
    <text class="page-sub">逐能力真机验收（ref/computed/watch/v-model/指令/transition/provide·inject/defineModel）</text>

    <!-- ① ref + computed + watch -->
    <view class="card">
      <text class="card-title">① ref / computed / watch</text>
      <view class="row">
        <view class="chip" @click="bump">bump 一次（count++ → double 重算 + watch 记录）</view>
      </view>
      <text class="state-line">count={{ count }} · double={{ double }} · watchLog={{ watchLog || '（初始）' }}</text>
    </view>

    <!-- ② v-model（input） -->
    <view class="card">
      <text class="card-title">② v-model（input 双绑）</text>
      <input v-model="name" placeholder="输入名称" class="field" />
      <text class="state-line">name={{ name || '（空）' }}</text>
    </view>

    <!-- ③ v-if / v-else-if / v-else + v-show -->
    <view class="card">
      <text class="card-title">③ v-if 条件链 / v-show</text>
      <view class="row">
        <view class="chip" @click="toggleAgree">切换 agree</view>
      </view>
      <text v-if="agree" class="state-line">agree=true → 显示本行（v-if）</text>
      <text v-else class="state-line">agree=false → 显示本行（v-else）</text>
      <text v-show="agree" class="state-line">v-show：agree 为真才显示（hidden 切换）</text>
      <text class="state-line">status={{ status }}</text>
    </view>

    <!-- ④ v-for -->
    <view class="card">
      <text class="card-title">④ v-for</text>
      <text v-for="(it, i) in list" :key="i" class="state-line">第 {{ i }} 项：{{ it }}</text>
    </view>

    <!-- ⑤ v-html + :class / :style -->
    <view class="card">
      <text class="card-title">⑤ v-html / :class / :style</text>
      <view class="html-box" v-html="html" />
      <view class="chip" :class="{ 'tip-on': agree }" :style="{ color: agree ? '#16a34a' : '#888' }">
        :class/:style 联动（agree={{ agree }}）
      </view>
    </view>

    <!-- ⑥ transition -->
    <view class="card">
      <text class="card-title">⑥ transition（离开动画状态机）</text>
      <view class="row">
        <view class="chip" @click="toggleCard">{{ cardOn ? '隐藏卡片' : '显示卡片' }}</view>
      </view>
      <transition name="fade">
        <view v-if="cardOn" class="card-inner">过渡卡片：先播 fade 再移除</view>
      </transition>
    </view>

    <!-- ⑦ provide / inject（页面提供 → 组件消费） -->
    <view class="card">
      <text class="card-title">⑦ provide / inject</text>
      <inject-consumer />
      <view class="row">
        <view class="chip" @click="changeUser">切换 user（裸 ref 联动 → inject 组件自动刷新）</view>
      </view>
      <text class="state-line">user={{ user }} · theme={{ theme }}</text>
    </view>

    <!-- ⑧ defineModel（v-model 组件契约） -->
    <view class="card">
      <text class="card-title">⑧ defineModel（v-model 组件契约）</text>
      <model-demo v-model="modelDemo" />
      <text class="state-line">modelDemo={{ modelDemo || '（空）' }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, watch, provide } from 'vue'
// Web 端注册本文档组件；MP 端编译器忽略 import（标签走 usingComponents）
import InjectConsumer from '../components/inject-consumer/index.vue'
import ModelDemo from '../components/model-demo/index.vue'

// ① ref + computed + watch
const count = ref(0)
const double = computed(() => count.value * 2)
const watchLog = ref('')
watch(count, (n, o) => {
  watchLog.value = `watch: ${o} → ${n}`
})
function bump(): void {
  count.value++
}

// ② v-model
const name = ref('')

// ③ v-if / v-show
const agree = ref(false)
const status = ref('a')
function toggleAgree(): void {
  agree.value = !agree.value
}

// ④ v-for
const list = ref(['甲', '乙', '丙'])

// ⑤ v-html / :class / :style
const html = ref('<b style="color:#1a7af8">rich-text 富文本</b>')

// ⑥ transition
const cardOn = ref(true)
function toggleCard(): void {
  cardOn.value = !cardOn.value
}

// ⑦ provide / inject（页面顶层提供 → 组件消费；裸 ref 联动 + .value 快照）
const user = ref('proteus')
const theme = ref('dark')
provide('demo-user', user)
provide('demo-theme', theme.value)
function changeUser(): void {
  user.value = user.value === 'proteus' ? 'zeus' : 'proteus'
}

// ⑧ defineModel（受控 v-model：p-model-demo 经 defineModel 双绑回传）
const modelDemo = ref('')
</script>

<style scoped>
.page { padding: 24rpx; }
.page-title { display: block; font-size: 36rpx; font-weight: 700; margin-bottom: 8rpx; }
.page-sub { display: block; font-size: 24rpx; color: #888; margin-bottom: 24rpx; }
.card { background: #fff; border-radius: 16rpx; padding: 24rpx; margin-bottom: 24rpx; }
.card-title { display: block; font-size: 28rpx; font-weight: 600; margin-bottom: 16rpx; }
.row { display: flex; flex-direction: row; align-items: center; }
.chip { padding: 8rpx 16rpx; background: #eef; border-radius: 8rpx; margin-right: 12rpx; }
.state-line { display: block; font-size: 26rpx; margin-top: 12rpx; color: #07c160; }
.field { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 12px; font-size: 14px; width: 100%; box-sizing: border-box; }
.tip-on { background: #eaf7ea; }
.html-box { margin-bottom: 8rpx; }
.card-inner { padding: 16rpx; background: #f0f7ff; border-radius: 8rpx; }
</style>
