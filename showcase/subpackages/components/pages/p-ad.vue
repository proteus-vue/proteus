<!-- showcase/subpackages/components/pages/p-ad.vue —— p-ad 广告位 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-ad.md ← gen-content.mjs ← packages/components/p-ad/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PAd, PText, PView } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  banner: "<p-ad unit-id=\"adunit-xxxx\" ad-type=\"banner\" />",
  video: "<p-ad unit-id=\"adunit-xxxx\" ad-type=\"video\" :ad-intervals=\"30\" />",
  theme: "<p-ad unit-id=\"adunit-xxxx\" ad-theme=\"black\" />",
  slot: "<p-ad><p-view>自建广告内容</p-view></p-ad>",
})

const apiRows = ref([
  [
    "unitId",
    "广告单元 id（对齐 unit-id；MP 平台后台创建）",
    "String"
  ],
  [
    "adIntervals",
    "广告自动刷新的间隔秒数（最小 30，对齐 ad-intervals）",
    "Number"
  ],
  [
    "adType",
    "广告类型（对齐 ad-type：banner / video / grid 等）",
    "String"
  ],
  [
    "adTheme",
    "广告主题（对齐 ad-theme：white / black，2.8.0+）",
    "String"
  ],
  [
    "height",
    "占位高度 px（Web 占位容器）",
    "Number"
  ],
  [
    "placeholderText",
    "Web 占位文案",
    "String"
  ]
])
const eventRows = ref([
  [
    "load",
    "加载完成",
    "e"
  ],
  [
    "error",
    "加载/执行失败",
    "e"
  ],
  [
    "close",
    "关闭",
    "e"
  ]
])
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
    "skyline（WebView 降级） · 原生控件映射 → <ad>（L1 原语）"
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
  <page-shell title="p-ad 广告位" subtitle="页面外壳 · 广告容器（Web 占位 / MP 原生）">
    <demo-block index="01" title="Banner 广告" desc="unit-id 为必填；Web 端显示占位（无广告联盟标准）" :has-output="false" :code="codes.banner">
      <template #demo>
        <p-ad unit-id="adunit-demo-banner" ad-type="banner" />
      </template>
    </demo-block>

    <demo-block index="02" title="视频广告与刷新间隔" desc="ad-type=video；ad-intervals ≥30 秒自动刷新" :has-output="false" :code="codes.video">
      <template #demo>
        <p-ad unit-id="adunit-demo-video" ad-type="video" :ad-intervals="30" />
      </template>
    </demo-block>

    <demo-block index="03" title="主题" desc="ad-theme=black 深色主题（★官方 ad-theme）" :has-output="false" :code="codes.theme">
      <template #demo>
        <p-ad unit-id="adunit-demo-theme" ad-theme="black" />
      </template>
    </demo-block>

    <demo-block index="04" title="自建广告（插槽）" desc="Web 端可用默认插槽替换占位，接入宿主自建广告桥" :has-output="true" :code="codes.slot">
      <template #demo>
        <p-ad>
  <p-view class="custom-ad"><p-text>自建广告位（插槽内容）</p-text></p-view>
</p-ad>
      </template>
      <template #output>
        <p-text class="out">插槽生效：占位文案被替换为自建内容</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.custom-ad { padding: var(--sp-4); background: linear-gradient(135deg, #f0ecff, #e6f7ff); border-radius: 6px; text-align: center; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>
