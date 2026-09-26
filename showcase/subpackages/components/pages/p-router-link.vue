<!-- showcase/subpackages/components/pages/p-router-link.vue —— p-router-link 声明式导航 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-router-link.md ← gen-content.mjs ← packages/components/p-router-link/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PRouterLink, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  base: "<p-router-link to=\"home\" @navigate=\"onNavigate\">首页</p-router-link>",
  replace: "<p-router-link to=\"home\" replace @navigate=\"onNavigate\">replace 进入</p-router-link>",
  tab: "<p-router-link to=\"mine\" switch-tab @navigate=\"onNavigate\">switchTab</p-router-link>",
  official: "<p-router-link url=\"/pages/home\" open-type=\"redirect\" @navigate=\"onNavigate\">官方 url 写法</p-router-link>",
})

const lastEvent = ref('（点击链接观察 navigate 载荷）')
function onNavigate(payload: Record<string, unknown>) {
  const mode = payload.switchTab ? 'switchTab' : payload.replace ? 'replace' : 'push'
  lastEvent.value = `navigate → ${mode}(${JSON.stringify(payload.to || payload.path)}) · open-type=${payload.openType}`
}

const apiRows = ref([
  [
    "to",
    "导航目标（路由名或路径）——createRouterEngineering.push({ name: to \\",
    "path: to })"
  ],
  [
    "replace",
    "替换当前页（E12 语义——push({...to, replace:true})）",
    "Boolean"
  ],
  [
    "switchTab",
    "切 Tab 页（E14 语义——push({...to, switchTab:true})）",
    "Boolean"
  ],
  [
    "target",
    "跳转目标：self（当前小程序，默认）/ miniProgram（其它小程序）",
    "String"
  ],
  [
    "url",
    "跳转链接（url）",
    "String"
  ],
  [
    "openType",
    "跳转方式：navigate/redirect/switchTab/reLaunch/navigateBack/exit",
    "String"
  ],
  [
    "delta",
    "open-type=navigateBack 时回退层数",
    "Number"
  ],
  [
    "appId",
    "target=miniProgram 时的目标 appId",
    "String"
  ],
  [
    "path",
    "target=miniProgram 时的目标路径",
    "String"
  ],
  [
    "extraData",
    "target=miniProgram 时传递给目标小程序的参数（★default 不用函数——微信 properties.value 仅支持字面量）",
    "Object"
  ],
  [
    "version",
    "target=miniProgram 时目标小程序版本：release/trial/develop",
    "String"
  ],
  [
    "shortLink",
    "目标小程序短链（可不传 appId）",
    "String"
  ],
  [
    "hoverClass",
    "按下样式类（'none' 关闭按压态；缺省用框架默认类）",
    "String"
  ],
  [
    "hoverStopPropagation",
    "是否阻止祖先节点出现按压态",
    "Boolean"
  ],
  [
    "hoverStartTime",
    "按住多久出现按压态（ms）",
    "Number"
  ],
  [
    "hoverStayTime",
    "松开后按压态保留时间（ms）",
    "Number"
  ]
])
const eventRows = ref([
  [
    "navigate",
    "—",
    "—"
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
    "skyline（WebView 降级） · 原生控件映射 → <navigator>（L1 原语）"
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
  <page-shell title="p-router-link 声明式导航" subtitle="工程原语 · 语义导航链接（对齐官方 navigator）">
    <demo-block index="01" title="框架语义（to）" desc="to 为路由名/路径；点击 emit('navigate', payload)" :has-output="true" :code="codes.base">
      <template #demo>
        <view class="row">
  <p-router-link class="link" to="home" @navigate="onNavigate">首页</p-router-link>
  <p-router-link class="link" to="user" @navigate="onNavigate">个人中心</p-router-link>
</view>
      </template>
      <template #output>
        <p-text class="out">{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="replace / switchTab" desc="replace 替换当前页；switch-tab 切 Tab" :has-output="false" :code="codes.replace">
      <template #demo>
        <view class="row">
  <p-router-link class="link" to="home" replace @navigate="onNavigate">replace</p-router-link>
  <p-router-link class="link" to="mine" switch-tab @navigate="onNavigate">switchTab</p-router-link>
</view>
      </template>
    </demo-block>

    <demo-block index="03" title="官方 url 写法" desc="不传 to 时回退官方 url；open-type 决定跳转方式" :has-output="false" :code="codes.official">
      <template #demo>
        <p-router-link class="link" url="/pages/home" open-type="redirect" @navigate="onNavigate">官方 url + redirect</p-router-link>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.row { display: flex; flex-direction: row; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
.link { color: #1a7af8; padding: var(--sp-1) var(--sp-2); }
.out { display: block; font-size: 12.5px; color: #2f7a4d; word-break: break-all; }
</style>
