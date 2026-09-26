<!-- showcase/subpackages/components/pages/p-button.vue —— p-button 按钮 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-button.md ← gen-content.mjs ← packages/components/p-button/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PButton, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<p-button @click=\"onBasicClick\">点击我</p-button>",
  disabled: "<p-button :disabled=\"true\">禁用按钮</p-button>",
  loading: "<p-button :loading=\"loading\" @click=\"submit\">提交</p-button>",
  throttle: "<p-button :throttle=\"800\" @click=\"onClick\">连点试试</p-button>",
  attrs: "<p-button size=\"mini\">mini</p-button><p-button type=\"primary\">primary</p-button><p-button type=\"warn\">warn</p-button><p-button :plain=\"true\">镂空</p-button>",
  themes: "<p-button theme=\"brand\">品牌</p-button><p-button theme=\"success\">成功</p-button><p-button theme=\"danger\">危险</p-button><p-button theme=\"ghost\">幽灵</p-button>",
  themeDynamic: "<p-button :theme=\"dynTheme\" @click=\"cycleTheme\">切换主题</p-button>",
  macro: "<p-button v-if=\"mpMacro\" open-type=\"contact\">客服</p-button>\n<view v-if=\"__TARGET__ === 'web'\">仅 Web</view>",
  openType: "<p-button open-type=\"contact\" @contact=\"onContact\">客服</p-button>\n<p-button open-type=\"share\" @share=\"onShare\">分享</p-button>",
})

// 演示状态
const count = ref(0)
const loading = ref(false)
const lastEvent = ref('（暂无）')
const throttleCount = ref(0)
// ★主题皮肤（编译器通道）：theme 值 → 组件根节点单类变体，样式定义在组件自身 scoped wxss
const THEME_KEYS = ['', 'brand', 'success', 'danger', 'ghost']
const dynTheme = ref('brand')
const themeIdx = ref(1)
function cycleTheme() {
  themeIdx.value = (themeIdx.value + 1) % THEME_KEYS.length
  dynTheme.value = THEME_KEYS[themeIdx.value]
}
// ★平台宏演示：这些宏在构建期被替换为字面量 → 反映当前构建目标。
// ★模板里用宏必须**经 setup 绑定**（2026-09-24 类型检查暴露）：Vue 模板只解析 setup 返回值，
//   裸全局宏在模板里会被当作「组件实例属性」查询 → vue-tsc 报
//   「Property '__MP__' does not exist」（脚本区用同一宏却正常）。
//   故先读到具名常量，模板引用具名常量（宏替换仍由编译器完成）。
const mpMacro: boolean = __MP__
const webMacro: boolean = __WEB__
const targetMacro: string = __TARGET__
const isMpBuild = mpMacro
// open-type 双端事件回显
const openTypeLog = ref('（点击上面按钮）')
function onOpenTypeContact() {
  openTypeLog.value = 'contact 触发 ✓（MP 原生 / Web 降级同名）'
}
function onOpenTypeShare() {
  openTypeLog.value = 'share 触发 ✓（Web-only 降级；MP 走原生分享面板）'
}
function onContact(e: unknown) {
  lastEvent.value = 'contact 事件（开放能力）'
}
function onWebOnlyClick() {
  lastEvent.value = 'Web-only 按钮点击'
}

// 演示 1：基础点击
function onBasicClick() {
  count.value++
  lastEvent.value = `click @ ${Date.now() % 100000}`
}
// 演示 2：加载态（点击后 1.2s 恢复）
function onLoadingClick() {
  loading.value = true
  lastEvent.value = 'loading 开始'
  setTimeout(() => {
    loading.value = false
    lastEvent.value = 'loading 结束'
  }, 1200)
}
// 演示 4：节流（throttle=800ms 内重复点击被忽略）
function onThrottledClick() {
  throttleCount.value++
}

const apiRows = ref([
  [
    "pid",
    "组件实例标识（调试/观测/测试定位用——D-2 dogfooding 契约）",
    "String"
  ],
  [
    "disabled",
    "禁用态（禁交互 + 弱化视觉；MP 原生 disabled 透传）",
    "Boolean"
  ],
  [
    "ariaLabel",
    "无障碍标签（读屏器朗读文本）",
    "String"
  ],
  [
    "loading",
    "加载中状态",
    "Boolean"
  ],
  [
    "throttle",
    "点击节流间隔（ms，防重复触发——runtime 内置）",
    "Number"
  ],
  [
    "size",
    "按钮大小：default / mini",
    "String"
  ],
  [
    "type",
    "样式类型：default（白）/ primary（绿）/ warn（红）",
    "String"
  ],
  [
    "plain",
    "是否镂空（背景透明）",
    "Boolean"
  ],
  [
    "formType",
    "form 内行为：submit / reset",
    "String"
  ],
  [
    "openType",
    "微信开放能力（contact/share/getPhoneNumber/openSetting/launchApp/chooseAvatar/…）",
    "String"
  ],
  [
    "hoverClass",
    "按下样式类：缺省（''）→ 用微信原生 button-hover 默认点击反馈（★勿传空串覆盖）；",
    "String"
  ],
  [
    "theme",
    "主题皮肤键：brand / success / danger / ghost（见 src/components/theme/registry.ts）。",
    "String"
  ],
  [
    "hoverStopPropagation",
    "是否阻止祖先节点出现点击态",
    "Boolean"
  ],
  [
    "hoverStartTime",
    "按住多久出现点击态（ms）",
    "Number"
  ],
  [
    "hoverStayTime",
    "松开后点击态保留时间（ms）",
    "Number"
  ],
  [
    "lang",
    "返回用户信息的语言：zh_CN / zh_TW / en",
    "String"
  ],
  [
    "sessionFrom",
    "会话来源（open-type=contact 有效）",
    "String"
  ],
  [
    "sendMessageTitle",
    "会话内消息卡片标题（contact）",
    "String"
  ],
  [
    "sendMessagePath",
    "会话内消息卡片跳转路径（contact）",
    "String"
  ],
  [
    "sendMessageImg",
    "会话内消息卡片图片（contact）",
    "String"
  ],
  [
    "appParameter",
    "打开 APP 时传递的参数（launchApp）",
    "String"
  ],
  [
    "showMessageCard",
    "是否显示会话内消息卡片（contact）",
    "Boolean"
  ],
  [
    "phoneNumberNoQuotaToast",
    "手机号额度用尽时是否展示提示（getPhoneNumber）",
    "Boolean"
  ],
  [
    "needShowEntrance",
    "转发的文本消息是否带小程序入口",
    "Boolean"
  ],
  [
    "entrancePath",
    "从消息入口打开小程序的路径",
    "String"
  ]
])
const eventRows = ref([
  [
    "click",
    "点击/轻触（throttle 节流后触发）",
    "e, { bubbles: true, composed: true }"
  ],
  [
    "getuserinfo",
    "—",
    "—"
  ],
  [
    "contact",
    "—",
    "—"
  ],
  [
    "getphonenumber",
    "—",
    "—"
  ],
  [
    "getrealtimephonenumber",
    "—",
    "—"
  ],
  [
    "error",
    "加载/执行失败",
    "—"
  ],
  [
    "opensetting",
    "—",
    "—"
  ],
  [
    "launchapp",
    "—",
    "—"
  ],
  [
    "chooseavatar",
    "—",
    "—"
  ],
  [
    "agreeprivacyauthorization",
    "—",
    "—"
  ],
  [
    "createliveactivity",
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
    "skyline（WebView 降级） · 原生控件映射 → <button>（L1 原语）"
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
  <page-shell title="p-button 按钮" subtitle="触发操作的按钮 · 双端同源码">
    <demo-block index="01" title="基础用法" desc="默认按钮，点击触发 click 事件" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-button @click="onBasicClick">点击我</p-button>
      </template>
      <template #output>
        <p-text class="out">结果：点击次数 {{ count }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="禁用态" desc="disabled 禁用交互；MP 端透传原生 disabled" :has-output="false" :code="codes.disabled">
      <template #demo>
        <view class="row">
  <p-button>可用按钮</p-button>
  <p-button :disabled="true">禁用按钮</p-button>
</view>
      </template>
    </demo-block>

    <demo-block index="03" title="加载态" desc="loading 期间自动禁用点击（透传 MP 原生 loading）" :has-output="true" :code="codes.loading">
      <template #demo>
        <p-button :loading="loading" @click="onLoadingClick">提交</p-button>
      </template>
      <template #output>
        <p-text class="out">结果：状态 {{ loading ? '加载中…' : '就绪' }}</p-text>
      </template>
    </demo-block>

    <demo-block index="04" title="点击节流" desc="throttle=800ms：间隔内的重复点击被忽略（防连点重复提交）" :has-output="true" :code="codes.throttle">
      <template #demo>
        <p-button :throttle="800" @click="onThrottledClick">连点试试</p-button>
      </template>
      <template #output>
        <p-text class="out">结果：生效 {{ throttleCount }} 次 · 快速连点计数明显少于点击次数即节流生效</p-text>
      </template>
    </demo-block>

    <demo-block index="05" title="事件回显" desc="click 事件的实时回显（弹起气泡 + 组合事件语义）" :has-output="true">
      <template #demo>
        <p-button @click="onBasicClick">触发事件</p-button>
      </template>
      <template #output>
        <p-text class="out">结果：最后事件 {{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="06" title="官方属性对齐" desc="size / type / plain —— 对齐小程序原生 button 视觉变体" :has-output="false" :code="codes.attrs">
      <template #demo>
        <view class="row">
  <p-button size="mini">mini</p-button>
  <p-button type="primary">primary</p-button>
  <p-button type="warn">warn</p-button>
  <p-button :plain="true">镂空</p-button>
</view>
      </template>
    </demo-block>

    <demo-block index="07" title="主题皮肤（编译器通道）" desc="theme 属性 → 编译期落成组件根节点单类变体，样式在组件自身 scoped wxss 内定义（不跨组件边界 → 绕过小程序样式隔离）" :has-output="false" :code="codes.themes">
      <template #demo>
        <view class="row">
  <p-button theme="brand">品牌</p-button>
  <p-button theme="success">成功</p-button>
  <p-button theme="danger">危险</p-button>
  <p-button theme="ghost">幽灵</p-button>
</view>
      </template>
    </demo-block>

    <demo-block index="08" title="主题动态切换" desc="theme 支持运行时变量（:theme 绑定）——点击循环切换，无需刷新页面" :has-output="true" :code="codes.themeDynamic">
      <template #demo>
        <view class="row">
  <p-button :theme="dynTheme" @click="cycleTheme">切换主题</p-button>
</view>
      </template>
      <template #output>
        <p-text class="out">当前主题：{{ dynTheme || '（框架缺省）' }}</p-text>
      </template>
    </demo-block>

    <demo-block index="09" title="平台条件显隐（编译期宏）" desc="标准 v-if + 构建期宏 __MP__/__WEB__/__TARGET__——编译期静态裁剪，死分支不进产物（替代 uni-app 的 #ifdef，零新语法）" :has-output="false" :code="codes.macro">
      <template #demo>
        <view class="row">
  <!-- ★仅小程序：open-type 开放能力（Web 无对等，编译期整块消除） -->
  <p-button v-if="mpMacro" open-type="contact" @contact="onContact">客服会话（仅小程序）</p-button>
  <p-button v-if="webMacro" @click="onWebOnlyClick">Web 端占位</p-button>
  <view v-if="targetMacro === 'web'" class="macro-note">当前构建目标：Web</view>
  <view v-else class="macro-note">当前构建目标：小程序</view>
</view>
      </template>
    </demo-block>

    <demo-block index="10" title="open-type 双端事件契约" desc="同一 @contact 两端都触发：MP 原生开放能力；Web 无对等 → 发同名降级事件（事件名与 MP 对齐，无需条件编译）" :has-output="true" :code="codes.openType">
      <template #demo>
        <view class="row">
  <p-button open-type="contact" @contact="onOpenTypeContact">客服会话（@contact）</p-button>
  <p-button open-type="share" @share="onOpenTypeShare">分享（@share，Web 降级）</p-button>
</view>
      </template>
      <template #output>
        <p-text class="out">结果：{{ openTypeLog }}</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
/* ★align-items:center（2026-09-13）：裸 flex 默认 align-items:stretch 会把矮按钮（mini）**拉伸**到
   与最高按钮同高——Web 端实测 mini 被拉到 37px，而小程序端保持自然高 32px → 用户看到「两端尺寸差别大」。
   显式 center 让各按钮保持自身高度（两端一致）。 */
.row { display: flex; flex-direction: row; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
.out {
  display: block;
  background: #f2fbf5;
  border: 1px solid #d6f0e0;
  border-radius: var(--sp-radius-sm);
  padding: var(--sp-2) var(--sp-3);
  font-size: 12.5px;
  color: #2f7a4d;
  font-weight: 600;
}
.macro-note {
  display: block;
  font-size: 12px;
  color: var(--sp-text-3);
  padding: var(--sp-2) 0;
}
</style>
