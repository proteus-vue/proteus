<!-- src/components/p-button/index.vue —— 按钮（★官方属性对齐：小程序 <button> API 全量映射）
     矩阵 01 §7：disabled/loading 原生映射 + throttle 防重复点击（runtime 内置）
     ★2026-09-13 官方属性对齐：补齐官方 <button> 的属性透传（size/type/plain/form-type/open-type/hover-*）
       与开放能力事件（getuserinfo/contact/getphonenumber/…）——此前只声明 5 个 props（覆盖 2/22）。
       Web 端 proteus-button 已实现同套 API（视觉变体 + open-type 降级），两端语义一致。 -->
<template>
  <button
    class="p-button"
    :class="{ 'is-loading': loading, 'is-disabled': disabled }"
    :size="size"
    :type="(type as any)"
    :plain="plain"
    :disabled="disabled || loading || undefined"
    :loading="loading || undefined"
    :form-type="formType"
    :open-type="openType"
    :hover-class="hoverClass || undefined"
    :hover-stop-propagation="hoverStopPropagation"
    :hover-start-time="hoverStartTime"
    :hover-stay-time="hoverStayTime"
    :lang="lang"
    :session-from="sessionFrom"
    :send-message-title="sendMessageTitle"
    :send-message-path="sendMessagePath"
    :send-message-img="sendMessageImg"
    :app-parameter="appParameter"
    :show-message-card="showMessageCard"
    :phone-number-no-quota-toast="phoneNumberNoQuotaToast"
    :need-show-entrance="needShowEntrance"
    :entrance-path="entrancePath"
    :aria-label="ariaLabel"
    @click="onClick"
    @getuserinfo="onOpenEvent('getuserinfo', $event)"
    @contact="onOpenEvent('contact', $event)"
    @getphonenumber="onOpenEvent('getphonenumber', $event)"
    @getrealtimephonenumber="onOpenEvent('getrealtimephonenumber', $event)"
    @error="onOpenEvent('error', $event)"
    @opensetting="onOpenEvent('opensetting', $event)"
    @launchapp="onOpenEvent('launchapp', $event)"
    @chooseavatar="onOpenEvent('chooseavatar', $event)"
    @agreeprivacyauthorization="onOpenEvent('agreeprivacyauthorization', $event)"
    @createliveactivity="onOpenEvent('createliveactivity', $event)"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  throttle: { type: Number, default: 0 }, // 防重复点击间隔 ms（0 = 不节流）
  // ── ★官方 <button> 属性（2026-09-13 对齐，与 Web proteus-button 同套语义） ──
  /** 按钮大小：default / mini */
  size: { type: String, default: '' },
  /** 样式类型：default（白）/ primary（绿）/ warn（红） */
  type: { type: String, default: '' },
  /** 是否镂空（背景透明） */
  plain: { type: Boolean, default: false },
  /** form 内行为：submit / reset */
  formType: { type: String, default: '' },
  /** 微信开放能力（contact/share/getPhoneNumber/openSetting/launchApp/chooseAvatar/…） */
  openType: { type: String, default: '' },
  /** 按下样式类：缺省（''）→ 用微信原生 button-hover 默认点击反馈（★勿传空串覆盖）；
   *  'none' → 关闭点击态；其它值 → 自定义类名 */
  hoverClass: { type: String, default: '' },
  /** 是否阻止祖先节点出现点击态 */
  hoverStopPropagation: { type: Boolean, default: false },
  /** 按住多久出现点击态（ms） */
  hoverStartTime: { type: Number, default: 20 },
  /** 松开后点击态保留时间（ms） */
  hoverStayTime: { type: Number, default: 70 },
  // ── 开放能力配套参数（open-type=contact / launchApp 等，2026-09-13 对齐官方全量） ──
  /** 返回用户信息的语言：zh_CN / zh_TW / en */
  lang: { type: String, default: '' },
  /** 会话来源（open-type=contact 有效） */
  sessionFrom: { type: String, default: '' },
  /** 会话内消息卡片标题（contact） */
  sendMessageTitle: { type: String, default: '' },
  /** 会话内消息卡片跳转路径（contact） */
  sendMessagePath: { type: String, default: '' },
  /** 会话内消息卡片图片（contact） */
  sendMessageImg: { type: String, default: '' },
  /** 打开 APP 时传递的参数（launchApp） */
  appParameter: { type: String, default: '' },
  /** 是否显示会话内消息卡片（contact） */
  showMessageCard: { type: Boolean, default: false },
  /** 手机号额度用尽时是否展示提示（getPhoneNumber） */
  phoneNumberNoQuotaToast: { type: Boolean, default: true },
  /** 转发的文本消息是否带小程序入口 */
  needShowEntrance: { type: Boolean, default: false },
  /** 从消息入口打开小程序的路径 */
  entrancePath: { type: String, default: '' },
})

// 开放能力事件（对齐官方 bind:* —— Web 端 proteus-button 同名事件降级）
const emit = defineEmits(['click', 'getuserinfo', 'contact', 'getphonenumber', 'getrealtimephonenumber', 'error', 'opensetting', 'launchapp', 'chooseavatar', 'agreeprivacyauthorization', 'createliveactivity'])

const lastClick = ref(0)
function onClick(e: unknown) {
  if (props.disabled || props.loading) return
  if (props.throttle > 0) {
    const now = Date.now()
    if (now - lastClick.value < props.throttle) return
    lastClick.value = now
  }
  // 兼容 Vue 与微信事件签名：第三参补冒泡选项（供跨组件边界父级 bind:click 接收）
  emit('click', e, { bubbles: true, composed: true })
}
function onOpenEvent(name: 'getuserinfo' | 'contact' | 'getphonenumber' | 'getrealtimephonenumber' | 'error' | 'opensetting' | 'launchapp' | 'chooseavatar' | 'agreeprivacyauthorization' | 'createliveactivity', e: unknown) {
  emit(name, e)
}
</script>

<style scoped>
.p-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  /* ★主题化（2026-09-12）：颜色经 CSS 变量注入——宿主可设 --p-button-bg/--p-button-color 换肤
     （CSS 变量天然继承：在祖先容器设一次即作用于其内全部按钮），缺省保持框架品牌蓝 */
  background: var(--p-button-bg, #1a7af8);
  color: var(--p-button-color, #fff);
  border: var(--p-button-border, none);
  border-radius: var(--p-button-radius, 6px);
  padding: 8px 20px;
  font-size: 14px;
  line-height: 1.5;
}
/* 微信原生 button::after 边框线（WebView 模式默认样式）清除；Skyline 无此默认，规则被忽略也无害 */
.p-button::after {
  border: none;
}
.p-button.is-loading {
  opacity: 0.7;
}
/* ★禁用态视觉弱化（2026-09-12 真机 bug 修复）：此前 disabled 只透传原生属性（禁交互），
   但**无任何视觉区分** → 用户看不出按钮已禁用（真机实测：禁用按钮与可用按钮外观完全一致）。
   经变量派生的弱化：降饱和 + 灰底 + 禁用光标，双端一致。 */
.p-button.is-disabled {
  background: var(--p-button-disabled-bg, #e8e8ef);
  color: var(--p-button-disabled-color, #a5a3b3);
  opacity: 1;
}
</style>
