<!-- tests/types/components-template.types.vue
     内置组件模板标签类型断言（vue-tsc 检查，不运行）：
     正例 = 合法 props 用法（类型解析正确即通过）；
     负例 = 非法 props 用 @vue-expect-error 抑制——若 GlobalComponents 未注册，无错误产生，
           @vue-expect-error 变"未使用" → vue-tsc 报错 → verify 失败（防类型注册退化） -->
<template>
  <p-view :aria-label="'container'" class="box">
    <p-text>文本</p-text>
    <p-button :throttle="300" @click="onTap">按钮</p-button>
    <p-image :src="imgSrc" :lazy-load="true" mode="widthFix" @load="onLoad" />
    <p-list-view :items="rows" :item-height="44" :height="300" :virtual="true" />
    <p-input :value="name" placeholder="姓名" @input="onInput" />
    <p-popup :visible="show" position="bottom" @close="onClose">
      <p-text>弹层</p-text>
    </p-popup>
    <p-nav-bar title="标题" back @back="onBack" />
    <p-skeleton :visible="loading" :avatar="true" :lines="[90, 70]" />
    <!-- @vue-expect-error：p-image 的 src 应为 string——传 number 应报错（GlobalComponents 类型生效） -->
    <p-image :src="123" />
  </p-view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const imgSrc = ref('')
const rows = ref([{ title: '' }])
const name = ref('')
const show = ref(false)
const loading = ref(true)

function onTap(): void {}
function onLoad(): void {}
function onInput(e: { value: string }): void {
  name.value = e.value
}
function onClose(): void {
  show.value = false
}
function onBack(): void {}
</script>
