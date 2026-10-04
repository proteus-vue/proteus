<!-- src/pages/index.vue —— 首页（TabBar 页面示例，覆盖核心映射：ref/v-if/v-for/:src/事件/ref 写入） -->
<script setup lang="ts">
import { ref } from 'vue'
import { PSafe } from '@proteus-vue/components'
// ★devtools 打通：SPA 导航走框架 router 单例（pushState + TraceBus 事件 → devtools route 回溯/守卫徽章）
import { router } from '../router'

const title = ref('Proteus')
const items = ref(['Web', 'Mini Program'])
const show = ref(true)
const count = ref(0)

function handleTap() {
  // Web 端：Vue 真实响应式更新；MP 端：编译器重写为 this.setData({ count: ... })
  count.value++
}

function go(name: 'forms' | 'config-demo' | 'user') {
  router.push({ name })
}
</script>

<template>
  <div class="home">
    <!-- ★状态栏安全区：app 为 navigationStyle:custom（无原生导航栏）→ 页面须自行避让 -->
    <p-safe area="top" :fallback="50" />
    <h1>{{ title }}</h1>
    <p v-if="show">One Vue source. Every form.</p>
    <p class="tapped-count">tapped {{ count }} times</p>
    <div v-for="(item, idx) in items" :key="idx" class="item">{{ idx }}. {{ item }}</div>
    <button @click="handleTap">tap</button>
    <div class="links">
      <a class="link" href="/pages/forms">表单与指令</a>
      <a class="link" href="/pages/config-demo">配置演示</a>
      <a class="link" href="/pages/components-demo">组件演示</a>
      <a class="link" href="/pages/mp-semantics-demo">小程序语义（MP 组件/API）</a>
      <a class="link" href="/pages/platform-api-demo">PlatformAPI 收口</a>
      <a class="link" href="/pages/fluid-layout-demo">柔性布局（Fluid）</a>
      <a class="link" href="/pages/fluid-system-demo">Fluid System（折叠屏/车机）</a>
      <a class="link" href="/pages/semantic-primitives-demo">G-32 语义原语（B2）</a>
      <a class="link" href="/pages/vmodel-mp-test">v-model MP 复测（G12）</a>
      <a class="link" href="/pages/render-backend-demo">渲染后端可插拔（G-27）</a>
      <a class="link" href="/pages/glass-demo">液态玻璃（G-07）</a>
      <a class="link" href="/pages/docs-engine-demo">文档引擎（md 编译渲染）</a>
      <a class="link" href="/pages/devtools-open-api-demo">开放 API 演示（第三方面板）</a>
      <a class="link" href="/pages/builtin-components-demo">内置组件</a>
      <a class="link" href="/pages/native-components-demo">原生能力组件（camera/map/ad）</a>
      <a class="link" href="/pages/i18n-demo">国际化</a>
      <a class="link" href="/pages/provide-inject-demo">注入演示</a>
      <a class="link" href="/pages/virtual-list-demo">虚拟列表</a>
      <a class="link" href="/pages/pinia-demo">状态管理</a>
      <a class="link" href="/pages/user/index">用户中心</a>
      <a class="link" href="/pages/user/profile">个人资料</a>
      <a class="link" href="/subpackages/order/pages/list">订单列表</a>
    </div>

    <!-- ★G-62 SVG→Skyline 专项验证入口（2026-09-09）：按能力分层，便于真机逐个复测 -->
    <div class="svg-links">
      <h3>SVG → Skyline 专项</h3>
      <p class="nest-tip">静态/动态 SVG、use 展开、文字提升、事件命中、动画（CSS/canvas）</p>
      <a class="link svg-star" href="/pages/svg-showcase-demo">★ SVG 能力综合演示（炫丽效果）</a>
      <a class="link svg-star" href="/pages/svg-skeleton-demo">★ SVG 骨骼动画（嵌套变换复合 / 层级运动学）</a>
      <a class="link" href="/subpackages/svg-lab/pages/svg-hit-test">① SVG 事件命中 + 文字提升</a>
      <a class="link" href="/subpackages/svg-lab/pages/svg-anim-probe">② SVG 动画（CSS 转译）</a>
      <a class="link" href="/subpackages/svg-lab/pages/svg-canvas-test">③ SVG 动画（Canvas 通道·形状变化）</a>
      <a class="link" href="/subpackages/svg-lab/pages/svg-p2-spike">④ SVG 特性支持矩阵（实测对照）</a>
      <a class="link" href="/subpackages/svg-lab/pages/image-spike">⑤ SVG → image data-URI 验证</a>
      <a class="link" href="/subpackages/svg-lab/pages/svg-canvas-probe">⑥ Canvas 能力探针（性能/API）</a>
      <a class="link" href="/subpackages/svg-lab/pages/svg-spike">⑦ Canvas node 通道探针</a>
    </div>
    <div class="router-links">
      <button class="link" @click="go('forms')">router.push → 表单与指令</button>
      <button class="link" @click="go('config-demo')">router.push → 配置演示</button>
    </div>
    <!-- ★路由嵌套演示：嵌套链 首页 → 用户中心(user) → 个人资料(user-profile, parent: user)——
         连续点击后在 devtools route 视图查看两层嵌套导航记录（a 链接补发 + push 完整链路） -->
    <div class="nest-demo">
      <h3>路由嵌套演示</h3>
      <p class="nest-tip">嵌套链：首页 → 用户中心 → 个人资料（user-profile 的 parent 是 user）</p>
      <a class="link" href="/pages/user/index">① 进入用户中心（a 链接·嵌套入口）</a>
      <button class="link" @click="go('user')">② router.push → 用户中心（push 路径）</button>
      <p class="nest-tip">进入用户中心后点「个人资料」→ route 面板连续两条嵌套记录</p>
    </div>

    <!-- ★text-overflow:ellipsis 演示（批次 16）：单行超出容器宽 ⇒ 行尾省略号（三端一致，Web 基准） -->
    <div class="trunc-demo">
      <h3>文本截断（text-overflow: ellipsis）</h3>
      <div class="trunc-row">这是一段很长的列表项文本，超过容器宽度时应在行尾以省略号结尾，而不是换行或溢出容器</div>
    </div>

    <!-- ★border-radius:50% 演示（批次 18）：正方盒 + 50% 圆角 = 精确圆（头像/圆点，Web 基准） -->
    <div class="circle-demo">
      <div class="avatar">A</div>
      <div class="dot"></div>
    </div>

    <!-- ★min/max 百分比演示（批次 19）：子声明 width:300px 但 max-width:100% ⇒ 钳到父宽（不溢出，Web 基准） -->
    <div class="clamp-demo">
      <div class="clamp-child">max-width:100% ⇒ 不溢出父容器</div>
    </div>

    <!-- ★letter-spacing 演示（批次 20）：字距 4px（Web 基准，三端一致） -->
    <div class="spacing-demo">LETTER SPACING 字距</div>

    <!-- ★rpx 演示（批次 21）：240rpx = 120px（小程序 750 设计单位，跨端一致） -->
    <div class="rpx-demo">rpx 240 → 120px</div>

    <!-- ★calc 常量折叠演示（批次 22）：calc(20px * 1.5) = 30px 间距（设计令牌算术） -->
    <div class="calc-demo">calc(20×1.5) → 30px</div>

    <!-- ★color-mix 常量折叠演示（批次 23）：品牌色 20% + 透明 = 淡色底（令牌着色） -->
    <div class="mix-demo">color-mix 20% 品牌色</div>

    <!-- ★aspect-ratio 演示（批次 24）：宽 160 + aspect-ratio 16/9 ⇒ 高 90（媒体卡） -->
    <div class="ar-demo">aspect-ratio 16/9</div>

    <!-- ★visibility 演示（批次 25）：hidden 仍占位（保留布局）但不绘制；子 visible 覆盖 -->
    <div class="vis-demo">
      <div class="vis-hidden">visibility:hidden（占位不显示）</div>
      <div class="vis-child">父hidden</div>
    </div>

    <!-- ★两值 gap 演示（批次 31）：gap: 4px 20px（行 4 / 列 20） -->
    <div class="gap-demo">
      <div class="gap-cell">A</div>
      <div class="gap-cell">B</div>
      <div class="gap-cell">C</div>
    </div>

    <!-- ★pointer-events 演示（批次 32）：覆盖层 none ⇒ 命中穿透到底层（仍占位绘制） -->
    <div class="pe-demo">
      <div class="pe-under">底层可点</div>
      <div class="pe-over">覆盖层（pointer-events:none）</div>
    </div>

    <!-- ★CSS 渐变演示（批次 33）：background: linear-gradient（免手写 fill-gradient JSON） -->
    <div class="grad-demo">linear-gradient 135°</div>

    <!-- ★逐角圆角演示（批次 34）：border-radius: 12px 12px 0 0（上圆下方卡片） -->
    <div class="corner-demo">逐角圆角 12 12 0 0</div>

    <!-- ★text-decoration 演示（批次 35）：下划线 / 删除线（文本装饰，可继承） -->
    <div class="deco-demo">
      <span class="deco-u">underline 下划线</span>
      <span class="deco-s">line-through 删除线</span>
    </div>

    <!-- ★font-family 演示（批次 36）：等宽字体（字体角色 monospace） -->
    <div class="mono-demo">font-family: monospace</div>
  </div>
</template>

<style scoped>
.svg-links {
  margin-top: 32px;
  padding-top: 16px;
  border-top: 1px dashed #ddd;
}
.svg-star {
  font-weight: 700;
  color: #7c3aed;
}
.svg-links h3 {
  font-size: 16px;
  margin-bottom: 8px;
}
.home {
  text-align: center;
  padding: 48px 0;
}
.item {
  padding: 4px 0;
}
.links {
  margin-top: 24px;
}
.links .link {
  display: block;
  padding: 8px 0;
  color: #1a7af8;
}
/* ★路由嵌套演示区块（route 面板回溯演示入口） */
.nest-demo {
  margin: 20px auto;
  max-width: 360px;
  padding: 12px 16px;
  border: 1px dashed #1a7af8;
  border-radius: 8px;
  text-align: center;
}
.nest-demo h3 {
  margin: 0 0 6px;
  font-size: 15px;
}
.nest-tip {
  margin: 4px 0;
  font-size: 12px;
  color: #888;
}
.nest-demo .link {
  display: block;
  padding: 6px 0;
  color: #1a7af8;
}
/* ★text-overflow:ellipsis 演示（批次 16）——受约束宽度容器 + 单行截断 */
.trunc-demo {
  margin: 20px auto;
  max-width: 300px;
  padding: 12px 16px;
  border: 1px dashed #ddd;
  border-radius: 8px;
}
.trunc-demo h3 {
  margin: 0 0 6px;
  font-size: 15px;
}
.trunc-row {
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
  color: #666;
  font-size: 13px;
}
/* ★border-radius:50% 演示（批次 18）——正方盒 + 50% = 精确圆 */
.circle-demo {
  display: flex;
  gap: 12px;
  justify-content: center;
  align-items: center;
  margin: 16px auto;
}
.avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background-color: #1a7af8;
  color: #ffffff;
  font-size: 20px;
  text-align: center;
}
.dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background-color: #07c160;
}
/* ★min/max 百分比演示（批次 19）——子宽 300px 但 max-width:100% 被钳到父宽 */
.clamp-demo {
  width: 240px;
  margin: 16px auto;
  padding: 8px;
  background-color: #f5f6f7;
  border-radius: 6px;
}
.clamp-child {
  width: 300px;
  max-width: 100%;
  background-color: #e3e6eb;
  border-radius: 4px;
  padding: 6px;
  color: #666;
  font-size: 12px;
  text-align: center;
}
/* ★letter-spacing 演示（批次 20） */
.spacing-demo {
  margin: 16px auto;
  letter-spacing: 4px;
  color: #1a7af8;
  font-size: 14px;
  text-align: center;
}
/* ★rpx 演示（批次 21）——240rpx→120px / 48rpx→24px / 24rpx→12px */
.rpx-demo {
  width: 240rpx;
  height: 48rpx;
  margin: 16px auto;
  background-color: #e3e6eb;
  border-radius: 8rpx;
  color: #666;
  font-size: 24rpx;
  text-align: center;
}
/* ★calc 常量折叠演示（批次 22）——calc(20px * 1.5)=30px / calc(4px + 20px)=24px */
.calc-demo {
  width: calc(20px * 1.5);
  height: calc(4px + 20px);
  margin: 16px auto;
  background-color: #e8f0ff;
  border-radius: calc(3px * 2);
  color: #1a7af8;
  font-size: 12px;
  text-align: center;
}
/* ★color-mix 常量折叠演示（批次 23）——品牌色 20% + 透明 */
.mix-demo {
  width: 200px;
  height: 24px;
  margin: 16px auto;
  background-color: color-mix(in srgb, #1a7af8 20%, transparent);
  border: 1px solid color-mix(in srgb, #1a7af8 40%, transparent);
  border-radius: 6px;
  color: #1a7af8;
  font-size: 12px;
  text-align: center;
}
/* ★aspect-ratio 演示（批次 24）——宽 160 + 16/9 ⇒ 高 90 */
.ar-demo {
  width: 160px;
  aspect-ratio: 16 / 9;
  margin: 16px auto;
  background-color: #f5f6f7;
  border-radius: 4px;
  color: #888;
  font-size: 12px;
  text-align: center;
}
/* ★visibility 演示（批次 25）——hidden 仍占位、不绘制 */
.vis-demo {
  margin: 16px auto;
}
.vis-hidden {
  height: 24px;
  background-color: #ff6b9d;
  visibility: hidden;
  font-size: 12px;
  text-align: center;
}
.vis-child {
  height: 24px;
  color: #888;
  font-size: 12px;
  text-align: center;
}
/* ★两值 gap 演示（批次 31）——gap: 4px 20px（列间距 20） */
.gap-demo {
  display: flex;
  flex-direction: row;
  gap: 4px 20px;
  justify-content: center;
  margin: 16px auto;
}
.gap-cell {
  width: 32px;
  height: 24px;
  background-color: #e8f0ff;
  border-radius: 4px;
  color: #1a7af8;
  font-size: 12px;
  text-align: center;
}
/* ★pointer-events 演示（批次 32）——覆盖层 none ⇒ 穿透 */
.pe-demo {
  position: relative;
  width: 200px;
  height: 40px;
  margin: 16px auto;
}
.pe-under {
  position: absolute;
  top: 0;
  left: 0;
  width: 200px;
  height: 40px;
  background-color: #e8f7ee;
  border-radius: 4px;
  color: #07c160;
  font-size: 12px;
  text-align: center;
}
.pe-over {
  position: absolute;
  top: 0;
  left: 0;
  width: 200px;
  height: 40px;
  background-color: color-mix(in srgb, #7c3aed 15%, transparent);
  border-radius: 4px;
  pointer-events: none;
  color: #7c3aed;
  font-size: 12px;
  text-align: center;
}
/* ★CSS 渐变演示（批次 33）——linear-gradient 折进引擎 fillGradient 通道 */
.grad-demo {
  width: 240px;
  height: 48px;
  margin: 16px auto;
  background: linear-gradient(135deg, #1a7af8, #7c5cff);
  border-radius: 8px;
  color: #ffffff;
  font-size: 12px;
  text-align: center;
}
/* ★逐角圆角演示（批次 34）——上两角圆、下两角直 */
.corner-demo {
  width: 200px;
  height: 44px;
  margin: 16px auto;
  background-color: #f5f6f7;
  border-radius: 12px 12px 0 0;
  color: #888;
  font-size: 12px;
  text-align: center;
}
/* ★text-decoration 演示（批次 35） */
.deco-demo {
  margin: 16px auto;
  text-align: center;
}
.deco-u {
  text-decoration: underline;
  color: #1a7af8;
  font-size: 13px;
}
.deco-s {
  text-decoration: line-through;
  color: #888;
  font-size: 13px;
}
/* ★font-family 演示（批次 36）——等宽角色 */
.mono-demo {
  margin: 12px auto;
  font-family: 'SF Mono', Consolas, monospace;
  color: #333;
  font-size: 13px;
  text-align: center;
}
</style>
