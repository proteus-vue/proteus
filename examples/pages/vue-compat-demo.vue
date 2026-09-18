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

    <!-- ⑨ reactivity-runtime（reactive/readonly 走运行时 @vue/reactivity 真 Proxy + setData 桥） -->
    <!-- ★2026-09-08 spke：isReactive(reactive)=true / isReadonly(readonly)=true；变更 reactive 触发 setData 桥刷新视图 -->
    <view class="card">
      <text class="card-title">⑨ reactivity-runtime（reactive / readonly 真 Proxy）</text>
      <view class="row">
        <view class="chip" @click="bumpReactive">bump reactive.count（变更 → setData 桥刷新）</view>
      </view>
      <text class="state-line">rs.name={{ rs.name }} · rs.count={{ rs.count }} · isReactive(rs)={{ rsIs }} · isReadonly(ro)={{ roIsReadonly }}</text>
    </view>

    <!-- ⑩ toRef / toRefs（运行时真 ref：逻辑层 .value 读写 + isRef=true） -->
    <!-- ★2026-09-08：xRef.value 逻辑层读写 trObj.x；isRef(toRef())=true；模板直接 {{ xRef }} 读 ref 对象（值需 .value，见矩阵 note） -->
    <view class="card">
      <text class="card-title">⑩ toRef / toRefs（运行时真 ref）</text>
      <view class="row">
        <view class="chip" @click="bumpToRef">bump xRef.value（逻辑层 toRef 读写）</view>
      </view>
      <text class="state-line">xRefVal={{ xRefVal }} · isRef(xRef)={{ xIsRef }} · isRef(yRefs.y)={{ yRefIsRef }}</text>
    </view>

    <!-- ⑪ markRaw / customRef（运行时真语义：markRaw 去代理 isReactive=false；customRef 用户工厂真 ref） -->
    <!-- ★2026-09-08：模板显示 data-backed 值（rawIsReactive / customVal / customIsRef）；customR.value 逻辑层读写经 bumpCustom 反映 -->
    <view class="card">
      <text class="card-title">⑪ markRaw / customRef（运行时真语义）</text>
      <view class="row">
        <view class="chip" @click="bumpCustom">bump customR.value（customRef 工厂 set→trigger）</view>
      </view>
      <text class="state-line">rawIsReactive={{ rawIsReactive }} · customVal={{ customVal }} · isRef(customR)={{ customIsRef }}</text>
    </view>

    <!-- ⑫ teleport → root-portal（Skyline 官方：子树脱离页面层叠——弹窗/弹层盖住一切；to 目标 MP 无对等已忽略） -->
    <!-- ★2026-09-08：点击显示弹层 → <teleport> 编译为 <root-portal>（脱离页面 fixed 层叠，弹层不受下层遮挡） -->
    <view class="card">
      <text class="card-title">⑫ teleport → root-portal（弹层层叠）</text>
      <view class="row">
        <view class="chip" @click="toggleOverlay">{{ overlayOn ? '关闭弹层' : '显示弹层' }}</view>
      </view>
      <text class="state-line">overlayOn={{ overlayOn }}</text>
      <teleport to="body">
        <view v-if="overlayOn" class="overlay-panel">
          <text>root-portal 弹层：脱离页面层叠（不被下层遮挡）</text>
        </view>
      </teleport>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, watch, provide, reactive, readonly, isReactive, isReadonly, toRef, toRefs, isRef, markRaw, customRef } from 'vue'
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

// ⑨ reactivity-runtime（reactive/readonly 走运行时 @vue/reactivity 真 Proxy + setData 桥）
//   isReactive(reactive obj)=true / isReadonly(readonly obj)=true；rs.count 变更经 effect 桥 setData 刷新视图
const rs = reactive({ name: 'Proteus', count: 0 })
const ro = readonly({ fixed: 1 })
const rsIs = isReactive(rs)
const roIsReadonly = isReadonly(ro)
function bumpReactive(): void {
  rs.count += 1
}

// ⑩ toRef / toRefs（运行时 @vue/reactivity 真 ref：逻辑层 .value 读写 + isRef=true）
//   模板只显示 data-backed 值（xRefVal / xIsRef）；xRef.value 逻辑层读写经 bumpToRef 反映到 xRefVal
const trObj = reactive({ x: 5, y: 7 })
const xRef = toRef(trObj, 'x')
const yRefs = toRefs(trObj)
const xIsRef = isRef(xRef)
const yRefIsRef = isRef(yRefs.y)
const xRefVal = ref(5)
function bumpToRef(): void {
  xRef.value += 1
  xRefVal.value = xRef.value
}

// ⑪ markRaw / customRef（运行时 @vue/reactivity：markRaw 去代理标记 + customRef 用户工厂真 ref）
const rawData = markRaw({ tag: 'RAW' })
const rawIsReactive = isReactive(rawData) // 应 false（markRaw 跳过代理）
// customRef 工厂：闭包存 val（getter 返回 val、setter 存新值 + trigger 触发依赖）——真 ref 语义
const customR = customRef((track, trigger) => {
  let val = 9
  return { get() { track(); return val }, set(v) { val = v; trigger() } }
})
const customIsRef = isRef(customR)
function bumpCustom(): void {
  customR.value = customR.value + 1
  customVal.value = customR.value
}
const customVal = ref(9)

// ⑫ teleport → root-portal（弹层脱离页面层叠）
const overlayOn = ref(false)
function toggleOverlay(): void {
  overlayOn.value = !overlayOn.value
}
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
