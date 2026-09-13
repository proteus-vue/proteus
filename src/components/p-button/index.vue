<!-- src/components/p-button/index.vue —— 按钮（★官方属性对齐：小程序 <button> API 全量映射）
     矩阵 01 §7：disabled/loading 原生映射 + throttle 防重复点击（runtime 内置）
     ★2026-09-13 官方属性对齐：补齐官方 <button> 的属性透传（size/type/plain/form-type/open-type/hover-*）
       与开放能力事件（getuserinfo/contact/getphonenumber/…）——此前只声明 5 个 props（覆盖 2/22）。
       Web 端 proteus-button 已实现同套 API（视觉变体 + open-type 降级），两端语义一致。 -->
<template>
  <button
    class="p-button"
    :class="{
      'is-loading': loading,
      'is-disabled': disabled,
      'p-theme--brand': theme === 'brand',
      'p-theme--success': theme === 'success',
      'p-theme--danger': theme === 'danger',
      'p-theme--ghost': theme === 'ghost',
    }"
    :size="size"
    :type="(type as any)"
    :plain="plain"
    :disabled="disabled || loading || undefined"
    :loading="loading || undefined"
    :form-type="formType"
    :open-type="openType"
    :hover-class="hoverClass || 'p-button--hover'"
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
  // ── ★主题皮肤（2026-09-13 编译器通道 POC）：theme 值经编译期落成根节点单类变体 ──
  /** 主题皮肤键：brand / success / danger / ghost（见 src/components/theme/registry.ts）。
   *  缺省 '' → 框架品牌蓝。变体样式定义在**本组件自己的 scoped wxss**，不跨组件边界。 */
  theme: { type: String, default: '' },
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
  /* ★margin:0（2026-09-13）：Web 模拟层 `.proteus-web-button` 的 margin-left/right:auto 是为**裸 button**
     模拟微信原生「居中 184px」而设；p-button 是 hug-content 的 inline-flex，不应继承该居中语义
     （用户实测：Web 镂空按钮被居中、MP 是居左）。此处显式归零（特异性高于模拟层；MP 端本就等价 0，两端一致）。
     ★★注意：CSS 注释内**禁止出现花括号**——编译器选择器重写用正则处理原始文本，注释里的 `{` 会
     让前面的声明被误并入选择器而丢失（本行原先写了 `.proteus-web-button { … }` 导致 display 等被吞）。 */
  margin: 0;
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
/* ★主题皮肤变体（2026-09-13 编译器通道）：
   1) 一律**单类选择器**——Skyline glass-easel 不支持复合类选择器 `.a.b`（真机实测），
      故不能写 `.p-button.p-theme--brand`；单类即可（变体与基类同特异性 → 源码顺序后者胜）。
   2) 变体只**重定义局部 CSS 变量**，不重复声明属性——基类已消费 --p-button-bg/color/border，
      换肤路径与既有的 page 级变量注入完全一致（缺省值不变）。
   3) 类名由模板 `:class` **字面量键**产生（编译期可静态后缀 scopeId）；★禁止在模板里
      `'p-theme--' + theme` 动态拼接——动态类名无法后缀 → MP 端选择器匹配不上（Web 正常）。
   色值与 src/components/theme/registry.ts 同源，一致性由 tests/component-theme.test.ts 锁定。 */
.p-theme--brand { --p-button-bg: #7c5cff; --p-button-color: #ffffff; }
.p-theme--success { --p-button-bg: #22b573; --p-button-color: #ffffff; }
.p-theme--danger { --p-button-bg: #ef4d4d; --p-button-color: #ffffff; }
.p-theme--ghost { --p-button-bg: transparent; --p-button-color: #7c5cff; --p-button-border: 1px solid #7c5cff; }
</style>

<!-- ★按下态（小程序专用；必须 global + 单类选择器）：
     ① 为什么 global：`hover-class` 的类名由**平台**在按下时加到组件根节点，**不经** Vue 编译期
        `:class` 处理 → 不会得到 scopeId 后缀；scoped 版 `.p-button--hover-data-v-x` 永远匹配不上。
     ② 为什么单类：Skyline glass-easel 不支持复合类选择器 `.a.b`（真机实测）→ 不能写
        `.p-button--hover.p-theme--brand`。
     ③ 为什么用**叠加层**而非 background-color：微信原生默认 button-hover 是
        `background-color:#dedede` 或按 type 替换色值（基础库实测 `.button-hover[type=primary]{
        background-color:#179b16}`）——**替换**背景会把彩色按钮（brand/success/danger/自定义
        --p-button-bg）按下瞬间打成灰。叠加层保留基色相、只压暗一档，对任意主题色自动成立，
        无需每个 theme 再写一条。（Web 端同款语义见 packages/built-in-components/src/style.css
        的 `.proteus-web-button--hover`，那边用 background-image 渐变叠加。）
     ④ ★为什么用 box-shadow（而非 background-image）+ !important（两次踩坑，2026-09-13）：
        编译器把 global 组输出在 scoped 组**之前**（`packages/compiler/src/index.ts`「global 在前
        可被 scoped 覆盖」）。基类 scoped 规则 `.p-button-data-v-x { background: var(--p-button-bg) }`
        用的是 **`background` 简写**——后者在源码顺序上更靠后，且简写会把 `background-image` 重置为
        `none` → 若叠加层用 background-image 会被**静默吃掉**（用户实测「时好时坏」的真因）。
        改用 `box-shadow`（基类不设该属性，不受 background 简写影响）+ `!important`（与顺序/特异性
        彻底解耦）。box-shadow 的 inset 大扩散会沿 border-radius 裁切，视觉等价于整块压暗一层。 -->
<style global>
.p-button--hover {
  box-shadow: inset 0 0 0 9999px rgba(0, 0, 0, 0.12) !important;
}
</style>
