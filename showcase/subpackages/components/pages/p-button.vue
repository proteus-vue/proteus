<!-- showcase/pages/component-button.vue —— p-button 组件演示（官方形态样板）
     结构：组件说明 + 多用法演示块（真交互）+ API 表。
     全部演示均为实机渲染，输出区回显真实事件/状态。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PButton, PText, PView } from '@proteus-vue/components'

// ★代码片段放 data（不经 WXML 属性字面量——含 < > "。直接写 :code="'<p-button>" 会破坏 WXML 解析）
const codes = ref({
  basic: '<p-button @click="onBasicClick">点击我</p-button>',
  disabled: '<p-button :disabled="true">禁用按钮</p-button>',
  loading: '<p-button :loading="loading" @click="submit">提交</p-button>',
  throttle: '<p-button :throttle="800" @click="onClick">连点试试</p-button>',
  attrs: '<p-button size="mini">mini</p-button><p-button type="primary">primary</p-button><p-button type="warn">warn</p-button><p-button :plain="true">镂空</p-button>',
  themes: '<p-button theme="brand">品牌</p-button><p-button theme="success">成功</p-button><p-button theme="danger">危险</p-button><p-button theme="ghost">幽灵</p-button>',
  themeDynamic: '<p-button :theme="dynTheme" @click="cycleTheme">切换主题</p-button>',
  macro: '<p-button v-if="__MP__" open-type="contact">客服</p-button>\n<view v-if="__TARGET__ === \'web\'">仅 Web</view>',
  openType: '<p-button open-type="contact" @contact="onContact">客服</p-button>\n<p-button open-type="share" @share="onShare">分享</p-button>',
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
// ★平台宏演示：__MP__ 在构建期被替换为字面量 → 该常量反映当前构建目标（仅用于回显）
const isMpBuild = __MP__
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
  ['size', '按钮大小：default / mini（★官方对齐）', 'string'],
  ['type', '样式类型：default / primary / warn（★官方对齐）', 'string'],
  ['plain', '镂空（背景透明）（★官方对齐）', 'boolean'],
  ['disabled', '禁用态（禁交互 + 弱化视觉，MP 原生 disabled 透传）', 'boolean'],
  ['loading', '加载中状态（透传 MP 原生 loading，自动禁点击）', 'boolean'],
  ['form-type', 'form 内行为：submit / reset（★官方对齐）', 'string'],
  ['open-type', '微信开放能力：contact/share/getPhoneNumber/…（★官方对齐）', 'string'],
  ['hover-class', '按下样式类（none = 无点击态）（★官方对齐）', 'string'],
  ['hover-stop-propagation', '是否阻止祖先节点出现点击态（★官方对齐）', 'boolean'],
  ['hover-start-time', '按住多久出现点击态 ms（★官方对齐）', 'number'],
  ['hover-stay-time', '松开后点击态保留 ms（★官方对齐）', 'number'],
  ['lang', '返回用户信息的语言 zh_CN / zh_TW / en（contact 等有效）', 'string'],
  ['session-from', '会话来源（open-type=contact 有效）', 'string'],
  ['send-message-title', '会话内消息卡片标题（contact）', 'string'],
  ['send-message-path', '会话内消息卡片跳转路径（contact）', 'string'],
  ['send-message-img', '会话内消息卡片图片（contact）', 'string'],
  ['show-message-card', '是否显示会话内消息卡片（contact）', 'boolean'],
  ['app-parameter', '打开 APP 时传递的参数（launchApp）', 'string'],
  ['phone-number-no-quota-toast', '手机号额度用尽时是否展示提示（getPhoneNumber）', 'boolean'],
  ['need-show-entrance', '转发的文本消息是否带小程序入口', 'boolean'],
  ['entrance-path', '从消息入口打开小程序的路径', 'string'],
  ['throttle', '★框架扩展：点击节流间隔 ms，防重复触发（runtime 内置）', 'number'],
  ['theme', '★框架扩展：主题皮肤 brand / success / danger / ghost（编译器通道，运行时可变）', 'string'],
  ['ariaLabel', '无障碍标签（读屏器朗读文本）', 'string'],
  ['pid', '组件实例标识（调试/观测/测试定位）', 'string'],
])
const eventRows = ref([
  ['click', '点击事件（throttle 未拦截时触发）', '(e, {bubbles, composed})'],
  ['getuserinfo', 'open-type=getUserInfo（MP 原生；Web 降级同名事件）', 'event'],
  ['contact', 'open-type=contact（MP 原生 bind:contact；Web 降级同名）', 'event'],
  ['getphonenumber', 'open-type=getPhoneNumber（MP 原生；Web 降级同名）', 'event'],
  ['getrealtimephonenumber', 'open-type=getRealtimePhoneNumber（MP 原生；Web 降级同名）', 'event'],
  ['error', 'open-type 出错（MP 原生；Web 降级同名）', 'event'],
  ['opensetting', 'open-type=openSetting（MP 原生；Web 降级同名）', 'event'],
  ['launchapp', 'open-type=launchApp（MP 原生；Web 降级同名）', 'event'],
  ['chooseavatar', 'open-type=chooseAvatar（MP 原生；Web 降级同名）', 'event'],
  ['agreeprivacyauthorization', 'open-type=agreePrivacyAuthorization（MP 原生；Web 降级同名）', 'event'],
  ['createliveactivity', 'open-type=liveActivity，一次性订阅消息下发回调（MP 原生）', 'event'],
  ['share / feedback', '★Web-only 降级事件（MP 无事件，走原生能力直接生效）', 'event'],
])
const slotRows = ref([['default', '按钮文本内容', '—']])

</script>

<template>
  <page-shell title="p-button 按钮" subtitle="触发操作的按钮 · 双端同源码">
    <demo-block index="01" title="基础用法" :has-output="true" desc="默认按钮，点击触发 click 事件" :code="codes.basic">
      <template #demo>
        <p-button @click="onBasicClick">点击我</p-button>
      </template>
      <template #output>
        <p-text class="out">结果：点击次数 {{ count }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="禁用态" desc="disabled 禁用交互；MP 端透传原生 disabled" :code="codes.disabled">
      <template #demo>
        <view class="row">
          <p-button>可用按钮</p-button>
          <p-button :disabled="true">禁用按钮</p-button>
        </view>
      </template>
    </demo-block>

    <demo-block index="03" title="加载态" :has-output="true" desc="loading 期间自动禁用点击（透传 MP 原生 loading）" :code="codes.loading">
      <template #demo>
        <p-button :loading="loading" @click="onLoadingClick">提交</p-button>
      </template>
      <template #output>
        <p-text class="out">结果：状态 {{ loading ? '加载中…' : '就绪' }}</p-text>
      </template>
    </demo-block>

    <demo-block index="04" title="点击节流" :has-output="true" desc="throttle=800ms：间隔内的重复点击被忽略（防连点重复提交）" :code="codes.throttle">
      <template #demo>
        <p-button :throttle="800" @click="onThrottledClick">连点试试</p-button>
      </template>
      <template #output>
        <p-text class="out">结果：生效 {{ throttleCount }} 次 · 快速连点计数明显少于点击次数即节流生效</p-text>
      </template>
    </demo-block>

    <demo-block index="05" title="事件回显" :has-output="true" desc="click 事件的实时回显（弹起气泡 + 组合事件语义）">
      <template #demo>
        <p-button @click="onBasicClick">触发事件</p-button>
      </template>
      <template #output>
        <p-text class="out">结果：最后事件 {{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="06" title="官方属性对齐" desc="size / type / plain —— 对齐小程序原生 button 视觉变体" :code="codes.attrs">
      <template #demo>
        <view class="row">
          <p-button size="mini">mini</p-button>
          <p-button type="primary">primary</p-button>
          <p-button type="warn">warn</p-button>
          <p-button :plain="true">镂空</p-button>
        </view>
      </template>
    </demo-block>

    <demo-block index="07" title="主题皮肤（编译器通道）" desc="theme 属性 → 编译期落成组件根节点单类变体，样式在组件自身 scoped wxss 内定义（不跨组件边界 → 绕过小程序样式隔离）" :code="codes.themes">
      <template #demo>
        <view class="row">
          <p-button theme="brand">品牌</p-button>
          <p-button theme="success">成功</p-button>
          <p-button theme="danger">危险</p-button>
          <p-button theme="ghost">幽灵</p-button>
        </view>
      </template>
    </demo-block>

    <demo-block index="08" title="主题动态切换" :has-output="true" desc="theme 支持运行时变量（:theme 绑定）——点击循环切换，无需刷新页面" :code="codes.themeDynamic">
      <template #demo>
        <view class="row">
          <p-button :theme="dynTheme" @click="cycleTheme">切换主题</p-button>
        </view>
      </template>
      <template #output>
        <p-text class="out">当前主题：{{ dynTheme || '（框架缺省）' }}</p-text>
      </template>
    </demo-block>

    <demo-block index="09" title="平台条件显隐（编译期宏）" desc="标准 v-if + 构建期宏 __MP__/__WEB__/__TARGET__——编译期静态裁剪，死分支不进产物（替代 uni-app 的 #ifdef，零新语法）" :code="codes.macro">
      <template #demo>
        <view class="row">
          <!-- ★仅小程序：open-type 开放能力（Web 无对等，编译期整块消除） -->
          <p-button v-if="__MP__" open-type="contact" @contact="onContact">客服会话（仅小程序）</p-button>
          <p-button v-if="__WEB__" @click="onWebOnlyClick">Web 端占位</p-button>
          <view v-if="__TARGET__ === 'web'" class="macro-note">当前构建目标：Web</view>
          <view v-else class="macro-note">当前构建目标：小程序</view>
        </view>
      </template>
      <template #output>
        <p-text class="out">宏取值：__MP__ = {{ isMpBuild ? 'true' : 'false' }}</p-text>
      </template>
    </demo-block>

    <!-- ★open-type 契约：同一份源码、同一事件名（contact），两端都触发——
         MP 走原生 bind:contact；Web 走降级事件（同名）→ 无需条件编译即可双端统一处理。
         ★share 是 Web-only 降级（MP 无事件，原生直接拉分享面板）。 -->
    <demo-block index="10" title="open-type 双端事件契约" :has-output="true" desc="同一 @contact 两端都触发：MP 原生开放能力；Web 无对等 → 发同名降级事件（事件名与 MP 对齐，无需条件编译）" :code="codes.openType">
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
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
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
