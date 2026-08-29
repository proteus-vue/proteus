<!-- examples/pages/forms.vue —— 表单与指令能力演示页
     覆盖编译器能力矩阵：v-model（input/textarea）/ :class 对象语法 / :style 对象语法 /
     v-if-v-else-if-v-else 条件链 / 事件修饰符 .stop → catchtap / v-html → rich-text / ref 写入 -->
<route>
{
  "meta": {
    "title": "表单与指令"
  }
}
</route>
<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const name = ref('')
const bio = ref('')
const agree = ref(false)
// 注意：ref 不加泛型标注（编译期静态求值仅支持字面量，泛型标注会解析失败）
const status = ref('a')
const html = ref('<h1 style="color:#1a7af8">rich-text 富文本</h1>')
const count = ref(0)
// computed 读路径（v0.3）：MP 端编译为 data 派生字段（onLoad 初始化 + count 写入时合并重算）
const double = computed(() => count.value * 2)
// watch（v0.3）：MP 端编译为 proteusWatchCount（count 写入 setData 后自动调用）
const watchLog = ref('')
watch(count, (n, o) => {
  watchLog.value = `watch: ${o} → ${n}`
})

function bump() {
  count.value++
}
</script>

<template>
  <div class="forms">
    <h2>表单与指令</h2>

    <!-- v-model：input / textarea（编译为 value + bindinput="proteusOnXxxInput"） -->
    <input v-model="name" placeholder="输入昵称" class="field" />
    <textarea v-model="bio" placeholder="输入简介" class="field" />

    <!-- :class 数组语法（v0.3）+ :style 对象语法 → prop:{{expr}} -->
    <p :class="['tip', { 'tip-on': agree }]" :style="{ color: agree ? '#16a34a' : '#888' }">
      已勾选：{{ agree }}
    </p>

    <!-- v-if / v-else-if / v-else 条件链 -->
    <p v-if="status === 'a'">状态：A</p>
    <p v-else-if="status === 'b'">状态：B</p>
    <p v-else>状态：C</p>

    <!-- 事件修饰符 .stop → catchtap（阻止冒泡：点按钮只加一次，点空白区加一次） -->
    <div class="box" @click="bump">
      <button @click.stop="bump">点我（.stop 不冒泡）</button>
      <p>点击次数：{{ count }}（双倍：{{ double }}）</p>
      <p class="watch-log">{{ watchLog }}</p>
    </div>

    <!-- v-show → hidden 属性（v0.3）：元素始终渲染，仅切换 display -->
    <p v-show="agree" class="tip">v-show：已勾选时才显示本行（hidden="{{!agree}}"）</p>

    <!-- v-html → rich-text nodes -->
    <div class="html-box" v-html="html"></div>
  </div>
</template>

<style scoped lang="scss">
// CSS 预处理器（v0.3 尾）：lang=scss → 插件 preprocessStyle 钩子编译为 css 后进 WXSS；Web 端 Vite 原生处理
$brand: #1a7af8;

.forms {
  padding: 24px;

  .watch-log {
    color: $brand;
    font-size: 12px;
  }
}
.field {
  display: block;
  width: 100%;
  margin: 8px 0;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 8px;
}
.tip {
  font-size: 13px;
}
.tip-on {
  font-weight: 600;
}
.box {
  padding: 12px;
  background: #f5f6f7;
  border-radius: 8px;
  margin: 12px 0;
}
.html-box {
  padding: 12px;
  border: 1px dashed #ddd;
  border-radius: 8px;
}
</style>
