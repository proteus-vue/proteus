<!-- showcase/subpackages/components/pages/p-ad.vue —— p-ad 广告位演示
     覆盖：unit-id / ad-intervals / ad-type / ad-theme / 占位与插槽替换。
     ★诚实边界：Web 端无广告联盟标准实现（宿主需接自建广告桥）→ 恒为占位容器（明确标注，非伪装渲染）；
       MP 端原生 <ad> 承接真实广告（需在微信后台创建广告单元 id）。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PAd, PText, PView } from '@proteus-vue/components'

const codes = ref({
  banner: '<p-ad unit-id="adunit-xxxx" ad-type="banner" />',
  video: '<p-ad unit-id="adunit-xxxx" ad-type="video" :ad-intervals="30" />',
  theme: '<p-ad unit-id="adunit-xxxx" ad-theme="black" />',
  slot: '<p-ad><p-view>自建广告内容</p-view></p-ad>',
})

const apiRows = ref([
  ['unitId', '广告单元 id（★官方 unit-id；MP 后台创建，必填）', 'string'],
  ['adIntervals', '自动刷新间隔秒（★官方 ad-intervals，须 ≥30）', 'number'],
  ['adType', '广告类型 banner / video / grid（★官方 ad-type）', 'string'],
  ['adTheme', '广告主题 white / black（★官方 ad-theme，2.8.0+）', 'string'],
  ['height', 'Web 占位高度 px（框架扩展）', 'number'],
  ['placeholderText', 'Web 占位文案（框架扩展，诚实标注非真实广告）', 'string'],
])
const eventRows = ref([
  ['load', '广告加载成功（★官方 bind:load）', 'event'],
  ['error', '广告加载失败（★官方 bind:error，detail={errCode}）', 'event'],
  ['close', '广告关闭（★官方 bind:close）', 'event'],
])
const slotRows = ref([['default', 'Web 占位内容（宿主自建广告桥替换）', '—']])
</script>

<template>
  <page-shell title="p-ad 广告位" subtitle="页面外壳 · 广告容器（Web 占位 / MP 原生）">
    <demo-block index="01" title="Banner 广告" desc="unit-id 为必填；Web 端显示占位（无广告联盟标准）" :code="codes.banner">
      <template #demo>
        <p-ad unit-id="adunit-demo-banner" ad-type="banner" />
      </template>
    </demo-block>

    <demo-block index="02" title="视频广告与刷新间隔" desc="ad-type=video；ad-intervals ≥30 秒自动刷新" :code="codes.video">
      <template #demo>
        <p-ad unit-id="adunit-demo-video" ad-type="video" :ad-intervals="30" />
      </template>
    </demo-block>

    <demo-block index="03" title="主题" desc="ad-theme=black 深色主题（★官方 ad-theme）" :code="codes.theme">
      <template #demo>
        <p-ad unit-id="adunit-demo-theme" ad-theme="black" />
      </template>
    </demo-block>

    <demo-block index="04" title="自建广告（插槽）" :has-output="true"
      desc="Web 端可用默认插槽替换占位，接入宿主自建广告桥" :code="codes.slot">
      <template #demo>
        <p-ad>
          <p-view class="custom-ad"><p-text>自建广告位（插槽内容）</p-text></p-view>
        </p-ad>
      </template>
      <template #output><p-text class="out">插槽生效：占位文案被替换为自建内容</p-text></template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
  </page-shell>
</template>

<style scoped>
.custom-ad { padding: var(--sp-4); background: linear-gradient(135deg, #f0ecff, #e6f7ff); border-radius: 6px; text-align: center; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>
