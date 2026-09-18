<!-- src/components/p-router-link/index.vue —— E18 声明式导航（engineering.router-link）
     to：导航目标（路由名或路径——createRouterEngineering.push({ name|path }) 语义，E11）
     replace：替换当前页（E12 语义）
     switchTab：切 Tab 页（E14 语义）
     行为：点击 emit('navigate', { to, replace, switchTab })——父级用 createRouterEngineering（#320）响应；
           组件零平台依赖（不 import router、不碰 wx/document——审计合规）；web role="link" 可访问性
     MP：@click → bindtap；对齐 p-radio defineEmits + emit 既有链路
     ★2026-09-14 Web 修复：根节点由 `<div>` 改 **`<view>`**（Web 插件改写 proteus-view——hover-* 按压反馈
       经模拟层生效；MP 端同为 view，产物不变）。 -->
<template>
  <view
    class="p-router-link"
    role="link"
    :hover-class="hoverClass === 'none' ? 'none' : (hoverClass || 'p-router-link--hover')"
    :hover-stop-propagation="hoverStopPropagation"
    :hover-start-time="hoverStartTime"
    :hover-stay-time="hoverStayTime"
    @click="onClick"
  >
    <slot />
  </view>
</template>

<script setup lang="ts">
// 对象形式 defineProps（编译器静态提取；MP 安全）
const props = defineProps({
  /** 导航目标（路由名或路径）——createRouterEngineering.push({ name: to | path: to }) */
  to: { type: String, default: '' },
  /** 替换当前页（E12 语义——push({...to, replace:true})） */
  replace: { type: Boolean, default: false },
  /** 切 Tab 页（E14 语义——push({...to, switchTab:true})） */
  switchTab: { type: Boolean, default: false },
  // ── ★官方 <navigator> 属性（2026-09-14 对齐） ──
  /** 跳转目标：self（当前小程序，默认）/ miniProgram（其它小程序） */
  target: { type: String, default: 'self' },
  /** 跳转链接（url） */
  url: { type: String, default: '' },
  /** 跳转方式：navigate/redirect/switchTab/reLaunch/navigateBack/exit */
  openType: { type: String, default: 'navigate' },
  /** open-type=navigateBack 时回退层数 */
  delta: { type: Number, default: 1 },
  /** target=miniProgram 时的目标 appId */
  appId: { type: String, default: '' },
  /** target=miniProgram 时的目标路径 */
  path: { type: String, default: '' },
  /** target=miniProgram 时传递给目标小程序的参数（★default 不用函数——微信 properties.value 仅支持字面量） */
  extraData: { type: Object, default: null },
  /** target=miniProgram 时目标小程序版本：release/trial/develop */
  version: { type: String, default: 'release' },
  /** 目标小程序短链（可不传 appId） */
  shortLink: { type: String, default: '' },
  /** 按下样式类（'none' 关闭按压态；缺省用框架默认类） */
  hoverClass: { type: String, default: '' },
  /** 是否阻止祖先节点出现按压态 */
  hoverStopPropagation: { type: Boolean, default: false },
  /** 按住多久出现按压态（ms） */
  hoverStartTime: { type: Number, default: 50 },
  /** 松开后按压态保留时间（ms） */
  hoverStayTime: { type: Number, default: 400 },
})

const emit = defineEmits(['navigate'])

/** 点击 → 语义导航载荷（父级 createRouterEngineering 响应）。
 *  优先用框架语义 to；缺失时回退官方 url，使官方写法 `<p-router-link url="/pages/a">` 亦可用。 */
function onClick(): void {
  const dest = props.to || props.url
  emit('navigate', {
    to: dest,
    path: props.path,
    replace: props.replace || props.openType === 'redirect',
    switchTab: props.switchTab || props.openType === 'switchTab',
    openType: props.openType,
    target: props.target,
    delta: props.delta,
    appId: props.appId,
    extraData: props.extraData,
    version: props.version,
    shortLink: props.shortLink,
  })
}
</script>

<style scoped>
.p-router-link {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  text-decoration: none;
  user-select: none;
}
</style>

<!-- ★按压态（global + 单类——hover-class 由平台加到根节点，不经 Vue 编译期 :class，无 scopeId 后缀） -->
<style global>
.p-router-link--hover {
  opacity: 0.7;
}
</style>
