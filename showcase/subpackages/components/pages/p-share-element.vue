<!-- showcase/subpackages/components/pages/p-share-element.vue —— p-share-element 共享元素转场 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-share-element.md ← gen-content.mjs ← packages/components/p-share-element/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PButton, PShareElement, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  base: "<p-share-element shuttle-key=\"cover\"><p-image src=\"cover.png\" /></p-share-element>",
  animate: "<p-share-element shuttle-key=\"cover\" :animate=\"false\">…</p-share-element>",
  duration: "<p-share-element shuttle-key=\"cover\" :duration=\"600\" easing-function=\"ease-in-out\">…</p-share-element>",
  shuttle: "<p-share-element shuttle-key=\"cover\" shuttle-on-push=\"cover\" shuttle-on-pop=\"detail\">…</p-share-element>",
})

const lastEvent = ref('（切换开关观察属性生效）')
const animate = ref(true)
const duration = ref(300)

const apiRows = ref([
  [
    "pid",
    "组件实例标识（调试/观测/测试定位用——D-2 dogfooding 契约）",
    "String"
  ],
  [
    "ariaLabel",
    "无障碍标签（读屏器朗读文本）",
    "String"
  ],
  [
    "shuttleKey",
    "映射标记：页面内唯一；两页同名即「同一个飞跃物」（★官方 key——Vue 保留属性故改名）",
    "String"
  ],
  [
    "animate",
    "是否进行动画（false → 仅位置对齐、无过渡）。★官方名 transform 与 <view> 的 CSS transform",
    "Boolean"
  ],
  [
    "duration",
    "动画时长（毫秒）",
    "Number"
  ],
  [
    "easingFunction",
    "CSS 缓动函数（如 ease / cubic-bezier(...)）",
    "String"
  ],
  [
    "transitionOnGesture",
    "手势返回时是否进行动画",
    "Boolean"
  ],
  [
    "shuttleOnPush",
    "指定 push 阶段的飞跃物（旧页 → 新页方向控制）",
    "String"
  ],
  [
    "shuttleOnPop",
    "指定 pop 阶段的飞跃物（新页 → 旧页方向控制）",
    "String"
  ],
  [
    "rectTweenType",
    "动画插值曲线（rect 几何插值类型）",
    "String"
  ]
])
const eventRows = ref([])
const slotRows = ref([
  [
    "default",
    "默认插槽（组件主内容）",
    "—"
  ]
])
const compatRows = ref([
  [
    "Web SPA",
    "✅",
    "vue-dom · 双端同源码编译目标（编译期映射 + 事件归一）"
  ],
  [
    "微信小程序",
    "✅",
    "skyline（WebView 降级） · 原生控件映射 → <share-element>（L1 原语）"
  ],
  [
    "Headless（SSR / 测试）",
    "✅",
    "headless · IR 渲染测试档（工具端）"
  ],
  [
    "iOS 原生",
    "🟡",
    "native-ios（UIKit） · 端原型映射——组件级接线未开始"
  ],
  [
    "Android 原生",
    "🟡",
    "native-android（Jetpack） · 端原型映射——组件级接线未开始"
  ],
  [
    "鸿蒙",
    "🟡",
    "native-harmony（ArkUI） · 端原型映射——组件级接线未开始"
  ],
  [
    "Flutter 混合",
    "🟡",
    "flutter · widget 级映射——组件级未验证"
  ],
  [
    "快应用",
    "⬜",
    "快应用引擎（待定） · 端未开始"
  ]
])
</script>

<template>
  <page-shell title="p-share-element 共享元素转场" subtitle="工程 · 对齐官方 share-element">
    <demo-block index="01" title="基础（shuttle-key 配对）" desc="两页中 shuttle-key 相同的元素由宿主做跨页飞行动画" :has-output="false" :code="codes.base">
      <template #demo>
        <view class="col">
  <p-share-element shuttle-key="cover" class="shuttle">
    <p-text class="body">封面（shuttle-key=&quot;cover&quot;）</p-text>
  </p-share-element>
  <p-text class="hint">↑ Web 端为普通容器；真机（Skyline/原生）可见飞行动画</p-text>
</view>
      </template>
    </demo-block>

    <demo-block index="02" title="animate 开关" desc="animate=false → 仅位置对齐、无过渡" :has-output="true" :code="codes.animate">
      <template #demo>
        <view class="col">
  <p-button size="small" @tap="(animate = !animate, lastEvent = 'animate = ' + animate)">切换 animate（当前 {{ animate }}）</p-button>
  <p-share-element shuttle-key="cover" :animate="animate" class="shuttle">
    <p-text class="body">animate={{ animate }}</p-text>
  </p-share-element>
</view>
      </template>
      <template #output>
        <p-text class="out">{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="03" title="时长与缓动" desc="duration / easing-function 控制飞行节奏" :has-output="true" :code="codes.duration">
      <template #demo>
        <view class="col">
  <p-button size="small" @tap="(duration = duration === 300 ? 600 : 300, lastEvent = 'duration = ' + duration + 'ms')">切换时长（当前 {{ duration }}ms）</p-button>
  <p-share-element shuttle-key="cover" :duration="duration" easing-function="ease-in-out" class="shuttle">
    <p-text class="body">{{ duration }}ms · ease-in-out</p-text>
  </p-share-element>
</view>
      </template>
      <template #output>
        <p-text class="out">{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="04" title="方向控制（shuttle-on-push / shuttle-on-pop）" desc="分别指定 push 与 pop 阶段的飞跃物" :has-output="false" :code="codes.shuttle">
      <template #demo>
        <p-share-element shuttle-key="cover" shuttle-on-push="cover" shuttle-on-pop="detail" class="shuttle">
  <p-text class="body">push→cover · pop→detail</p-text>
</p-share-element>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.col { display: flex; flex-direction: column; gap: var(--sp-3); }
.shuttle {
  padding: 10px 12px;
  border: 1px dashed #c9ccd6;
  border-radius: 8px;
  background: #fafbfe;
}
.body { font-size: 13px; color: #1c1b22; }
.hint { font-size: 11.5px; color: #8a8fa0; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>
