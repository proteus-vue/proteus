<!-- showcase/subpackages/components/pages/p-router-link.vue —— p-router-link 声明式导航演示
     覆盖：框架语义 to/replace/switchTab / 官方 navigator 属性（target/url/open-type/delta/app-id/path…）/
           按压反馈。★组件零平台依赖：点击 emit('navigate', payload)，由父级路由层响应。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PRouterLink, PText } from '@proteus-vue/components'

const lastEvent = ref('（点击链接观察 navigate 载荷）')
function onNavigate(payload: Record<string, unknown>) {
  const mode = payload.switchTab ? 'switchTab' : payload.replace ? 'replace' : 'push'
  lastEvent.value = `navigate → ${mode}(${JSON.stringify(payload.to || payload.path)}) · open-type=${payload.openType}`
}

const codes = ref({
  base: '<p-router-link to="home" @navigate="onNavigate">首页</p-router-link>',
  replace: '<p-router-link to="home" replace @navigate="onNavigate">replace 进入</p-router-link>',
  tab: '<p-router-link to="mine" switch-tab @navigate="onNavigate">switchTab</p-router-link>',
  official: '<p-router-link url="/pages/home" open-type="redirect" @navigate="onNavigate">官方 url 写法</p-router-link>',
})

const apiRows = ref([
  ['to', '导航目标（路由名或路径）——框架语义，优先于 url', 'string'],
  ['replace', '替换当前页（E12 语义）', 'boolean'],
  ['switchTab', '切 Tab 页（E14 语义）', 'boolean'],
  ['target', '跳转目标：self（默认）/ miniProgram（★官方 target）', 'string'],
  ['url', '跳转链接（★官方 url；to 缺省时回退）', 'string'],
  ['openType', '跳转方式：navigate/redirect/switchTab/reLaunch/navigateBack（★官方 open-type）', 'string'],
  ['delta', 'open-type=navigateBack 时回退层数（★官方 delta）', 'number'],
  ['appId', 'target=miniProgram 时的目标 appId（★官方 app-id）', 'string'],
  ['path', 'target=miniProgram 时的目标路径（★官方 path）', 'string'],
  ['extraData', 'target=miniProgram 时传递的参数（★官方 extra-data）', 'object'],
  ['version', '目标小程序版本：release/trial/develop（★官方 version）', 'string'],
  ['shortLink', '目标小程序短链（★官方 short-link）', 'string'],
  ['hoverClass', '按下样式类（★官方 hover-class；none 关闭）', 'string'],
  ['hoverStopPropagation', '阻止祖先按压态（★官方 hover-stop-propagation）', 'boolean'],
  ['hoverStartTime', '按住多久出现按压态 ms（★官方 hover-start-time）', 'number'],
  ['hoverStayTime', '松开后按压态保留 ms（★官方 hover-stay-time）', 'number'],
])
const eventRows = ref([
  ['navigate', '点击导航（裸载荷 { to, path, replace, switchTab, openType, target, delta, appId, extraData, version, shortLink }）', 'object'],
])
const slotRows = ref([['default', '链接内容', '—']])
</script>

<template>
  <page-shell title="p-router-link 声明式导航" subtitle="工程原语 · 语义导航链接（对齐官方 navigator）">
    <demo-block index="01" title="框架语义（to）" :has-output="true" desc="to 为路由名/路径；点击 emit('navigate', payload)" :code="codes.base">
      <template #demo>
        <view class="row">
          <p-router-link class="link" to="home" @navigate="onNavigate">首页</p-router-link>
          <p-router-link class="link" to="user" @navigate="onNavigate">个人中心</p-router-link>
        </view>
      </template>
      <template #output><p-text class="out">{{ lastEvent }}</p-text></template>
    </demo-block>

    <demo-block index="02" title="replace / switchTab" desc="replace 替换当前页；switch-tab 切 Tab" :code="codes.replace">
      <template #demo>
        <view class="row">
          <p-router-link class="link" to="home" replace @navigate="onNavigate">replace</p-router-link>
          <p-router-link class="link" to="mine" switch-tab @navigate="onNavigate">switchTab</p-router-link>
        </view>
      </template>
    </demo-block>

    <demo-block index="03" title="官方 url 写法" desc="不传 to 时回退官方 url；open-type 决定跳转方式" :code="codes.official">
      <template #demo>
        <p-router-link class="link" url="/pages/home" open-type="redirect" @navigate="onNavigate">官方 url + redirect</p-router-link>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
  </page-shell>
</template>

<style scoped>
.row { display: flex; flex-direction: row; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
.link { color: #1a7af8; padding: var(--sp-1) var(--sp-2); }
.out { display: block; font-size: 12.5px; color: #2f7a4d; word-break: break-all; }
</style>
