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
import { ref } from 'vue'

const name = ref('')
const bio = ref('')
const agree = ref(false)
// 注意：ref 不加泛型标注（编译期静态求值仅支持字面量，泛型标注会解析失败）
const status = ref('a')
const html = ref('<h1 style="color:#1a7af8">rich-text 富文本</h1>')
const count = ref(0)

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

    <!-- :class 对象语法 → 三元拼接；:style 对象语法 → prop:{{expr}} -->
    <p :class="{ tip: true, 'tip-on': agree }" :style="{ color: agree ? '#16a34a' : '#888' }">
      已勾选：{{ agree }}
    </p>

    <!-- v-if / v-else-if / v-else 条件链 -->
    <p v-if="status === 'a'">状态：A</p>
    <p v-else-if="status === 'b'">状态：B</p>
    <p v-else>状态：C</p>

    <!-- 事件修饰符 .stop → catchtap（阻止冒泡：点按钮只加一次，点空白区加一次） -->
    <div class="box" @click="bump">
      <button @click.stop="bump">点我（.stop 不冒泡）</button>
      <p>点击次数：{{ count }}</p>
    </div>

    <!-- v-html → rich-text nodes -->
    <div class="html-box" v-html="html"></div>
  </div>
</template>

<style>
.forms {
  padding: 24px;
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
