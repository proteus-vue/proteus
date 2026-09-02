<!-- examples/pages/semantic-primitives-demo.vue —— G-32 完整语义原语演示（★G-32 B2：布局 12 + UI 18 + Shell 落地）
     p-前缀语义组件 Web 端演示：布局（inline/spacer/divider/scroll/masonry/virtual-list）+
     UI（heading/icon/switch/slider）+ Shell（nav/tabbar/drawer） —— Playground 可用 -->
<route>
  { "title": "G-32 语义原语" }
</route>
<template>
  <div class="page">
    <p-heading :level="1">G-32 语义原语演示</p-heading>
    <p-text class="desc">128 原语 SSOT 已冻结——本页演示 B2 落地的 13 个新组件</p-text>

    <section class="block">
      <p-heading :level="2">① 布局原语（Layout）</p-heading>
      <p-divider :inset="8" />
      <div class="row">
        <p-text class="label">p-inline（行内容器）：</p-text>
        <p-inline :gap="8">
          <span class="chip">A</span>
          <span class="chip">B</span>
          <span class="chip">C</span>
        </p-inline>
      </div>
      <div class="row">
        <p-text class="label">p-spacer（弹性空白）：</p-text>
        <div class="flex-row">
          <span class="chip">左</span>
          <p-spacer />
          <span class="chip">右</span>
        </div>
      </div>
      <div class="row">
        <p-text class="label">p-divider（分隔线）：</p-text>
        <p-divider />
      </div>
      <div class="row">
        <p-text class="label">p-scroll（滚动容器）：</p-text>
        <p-scroll class="scroll-box" axis="y">
          <div v-for="i in 12" :key="i" class="scroll-item">滚动项 {{ i }}</div>
        </p-scroll>
      </div>
      <div class="row">
        <p-text class="label">p-masonry（瀑布流）：</p-text>
        <p-masonry :col-count="3" :gap="8">
          <div v-for="(h, i) in heights" :key="i" class="masonry-item" :style="{ height: h + 'px' }">卡 {{ i + 1 }}</div>
        </p-masonry>
      </div>
      <div class="row">
        <p-text class="label">p-virtual-list（虚拟列表）：</p-text>
        <p-virtual-list :items="virtualItems" :item-height="36" :height="120" />
      </div>
    </section>

    <section class="block">
      <p-heading :level="2">② UI 原语（UI）</p-heading>
      <p-divider :inset="8" />
      <div class="row">
        <p-heading :level="3">标题（level 1-6）</p-heading>
      </div>
      <div class="row">
        <p-icon name="success" :size="20" color="#07c160" />
        <p-icon name="info" :size="20" color="#576b95" />
        <p-icon name="warn" :size="20" color="#fa5151" />
        <p-icon name="star" :size="20" color="#ffc300" />
        <p-icon name="search" :size="20" :spin="true" />
      </div>
      <div class="row">
        <p-text class="label">p-switch（开关）：</p-text>
        <p-switch v-model="switchOn" />
        <p-text class="hint">: {{ switchOn ? '开' : '关' }}</p-text>
      </div>
      <div class="row">
        <p-text class="label">p-slider（滑块）：</p-text>
        <p-slider v-model="sliderVal" :min="0" :max="100" :step="5" />
        <p-text class="hint">: {{ sliderVal }}</p-text>
      </div>
    </section>

    <section class="block">
      <p-heading :level="2">③ Shell 原语（Shell）</p-heading>
      <p-divider :inset="8" />
      <div class="row">
        <p-text class="label">p-nav（导航栏）：</p-text>
        <p-nav title="语义导航栏">
          <template #left>
            <p-icon name="back" :size="18" />
          </template>
          <template #right>
            <p-icon name="more" :size="18" />
          </template>
        </p-nav>
      </div>
      <div class="row">
        <p-text class="label">p-tabbar（底部标签）：</p-text>
        <p-tabbar v-model:active="tabActive" :tabs="tabs" />
      </div>
      <div class="row">
        <p-text class="label">p-drawer（侧滑抽屉）：</p-text>
        <p-button variant="primary" @click="openDrawer">打开抽屉</p-button>
        <p-drawer v-model="drawerOpen" side="left" :width="240">
          <div class="drawer-inner">
            <p-heading :level="3">抽屉内容</p-heading>
            <p-text>从左侧滑出，点击遮罩关闭。</p-text>
          </div>
        </p-drawer>
      </div>
      <div class="row">
        <p-text class="label">p-segment（分段）：</p-text>
        <p-segment v-model:active="segVal" :options="segmentOptions" />
      </div>
      <div class="row">
        <p-text class="label">p-popover（气泡）：</p-text>
        <p-popover v-model="popoverOpen" placement="bottom">
          <template #trigger>
            <p-button variant="ghost" size="small">触发气泡</p-button>
          </template>
          <p-text>气泡内容——点击遮罩关闭。</p-text>
        </p-popover>
      </div>
      <div class="row">
        <p-text class="label">p-action-sheet（动作面板）：</p-text>
        <p-button variant="ghost" size="small" @click="sheetOpen = true">打开动作面板</p-button>
        <p-action-sheet v-model="sheetOpen" :actions="sheetActions" @select="onSheetSelect" />
        <p-text v-if="sheetResult" class="hint">{{ sheetResult }}</p-text>
      </div>
    </section>

    <section class="block">
      <p-heading :level="2">④ 视图/表单原语（UI）</p-heading>
      <p-divider :inset="8" />
      <div class="row">
        <p-text class="label">p-rich-text（富文本）：</p-text>
        <p-rich-text source="<b>加粗</b> 与 <u>下划线</u> 富文本演示" />
      </div>
      <div class="row">
        <p-text class="label">p-avatar（头像）：</p-text>
        <p-avatar shape="circle" :size="40" fallback="Proteus" />
        <p-avatar shape="square" :size="40" fallback="P" />
      </div>
      <div class="row">
        <p-text class="label">p-canvas（画布）：</p-text>
        <p-canvas :width="120" :height="60" :resolution="2" />
      </div>
      <div class="row">
        <p-text class="label">p-svg（矢量）：</p-text>
        <p-svg :size="24" color="#07c160" path="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
        <p-svg :size="24" color="#576b95" path="M12 21C7.03 21 3 16.97 3 12C3 7.03 7.03 3 12 3C16.97 3 21 7.03 21 12C21 16.97 16.97 21 12 21Z" />
      </div>
      <div class="row">
        <p-text class="label">p-select（选择器）：</p-text>
        <p-select v-model="selectVal" :options="selectOptions" placeholder="请选择城市" />
      </div>
      <div class="row">
        <p-text class="label">p-checkbox（多选）：</p-text>
        <p-checkbox v-model="cbA">选项 A</p-checkbox>
        <p-checkbox v-model="cbB">选项 B</p-checkbox>
      </div>
      <div class="row">
        <p-text class="label">p-radio（单选）：</p-text>
        <p-radio value="x" :group="radioVal" @update:group="onRadio('x')">方案 X</p-radio>
        <p-radio value="y" :group="radioVal" @update:group="onRadio('y')">方案 Y</p-radio>
      </div>
      <div class="row">
        <p-text class="label">p-picker（日期）：</p-text>
        <p-picker mode="date" v-model="dateVal" :min="'2026-01-01'" :max="'2026-12-31'" />
      </div>
      <div class="row">
        <p-text class="label">p-form（表单）：</p-text>
        <p-form :model="formModel" :rules="formRules" layout="vertical" @submit="onFormSubmit">
          <template #default="{ errors }">
            <p-input :value="formModel.name" placeholder="姓名" @input="onNameInput" />
            <p-text v-if="errors.name" class="form-error">{{ errors.name }}</p-text>
            <p-button variant="primary" @click="submitForm">提交</p-button>
            <p-text v-if="formTip" class="form-tip">{{ formTip }}</p-text>
          </template>
        </p-form>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  PHeading,
  PText,
  PIcon,
  PInline,
  PSpacer,
  PDivider,
  PScroll,
  PMasonry,
  PVirtualList,
  PSwitch,
  PSlider,
  PNav,
  PTabbar,
  PDrawer,
  PButton,
  PRichText,
  PAvatar,
  PCanvas,
  PSvg,
  PSelect,
  PCheckbox,
  PRadio,
  PPicker,
  PForm,
  PInput,
  PSegment,
  PPopover,
  PActionSheet,
} from '@proteus-vue/components'

const switchOn = ref(false)
const sliderVal = ref(40)
const drawerOpen = ref(false)
const tabActive = ref('home')
const selectVal = ref('')
const cbA = ref(false)
const cbB = ref(true)
const radioVal = ref('x')
const dateVal = ref('2026-09-02')
const segVal = ref('news')
const popoverOpen = ref(false)
const sheetOpen = ref(false)
const sheetResult = ref('')

function openDrawer(): void {
  drawerOpen.value = true
}
function onRadio(v: string): void {
  radioVal.value = v
}
const formModel = ref({ name: '' })
const formRules = {
  name: checkName,
}
const formTip = ref('')

// ★MP 安全：v-model 不支持点号路径（formModel.name）——用 :value + @input 方法更新
function onNameInput(payload: { value: string }): void {
  formModel.value.name = payload.value ?? ''
}

// ★MP 安全：校验器用 function 声明（对象字面量内箭头+类型标注+方法链会破坏 MP script 转换）
function checkName(value: string): string | null {
  if (!value || !value.trim()) return '姓名必填'
  return null
}

function submitForm(): void {
  formTip.value = '提交中…（校验在 p-form submit 统一触发）'
}
function onFormSubmit(payload: Record<string, unknown>): void {
  const errs = (payload.errors as Record<string, string>) ?? {}
  formTip.value = Object.keys(errs).length ? '校验失败：' + Object.keys(errs).join(',') : '提交成功：' + JSON.stringify(payload.model)
}

const heights = [60, 90, 48, 76, 110, 66, 84, 52]
const virtualItems = Array.from({ length: 50 }, (_, i) => ({ title: '虚拟项 ' + (i + 1) }))
const tabs = [
  { key: 'home', label: '首页', icon: 'home' },
  { key: 'mine', label: '我的', icon: 'user' },
  { key: 'more', label: '更多', icon: 'more', badge: '3' },
]
const selectOptions = [
  { value: 'beijing', label: '北京' },
  { value: 'shanghai', label: '上海' },
  { value: 'shenzhen', label: '深圳' },
  { value: 'hangzhou', label: '杭州' },
]
const segmentOptions = [
  { label: '资讯', value: 'news' },
  { label: '关注', value: 'follow' },
  { label: '热门', value: 'hot' },
]
const sheetActions = [
  { label: '分享', value: 'share' },
  { label: '复制链接', value: 'copy' },
  { label: '删除', value: 'delete', color: '#fa5151' },
]

function onSheetSelect(value: string): void {
  sheetResult.value = '选择：' + value
}
</script>

<style scoped>
.page {
  padding: 16px;
}
.desc {
  color: #969799;
  margin: 8px 0 16px;
}
.block {
  margin-bottom: 20px;
  padding: 12px;
  background: #f7f8fa;
  border-radius: 8px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0;
  flex-wrap: wrap;
}
.label {
  min-width: 120px;
  color: #646566;
}
.hint {
  color: #07c160;
}
.chip {
  padding: 4px 10px;
  background: #fff;
  border: 1px solid #ebedf0;
  border-radius: 4px;
  font-size: 13px;
}
.flex-row {
  display: flex;
  align-items: center;
  flex: 1;
}
.scroll-box {
  height: 120px;
  border: 1px solid #ebedf0;
  border-radius: 6px;
  padding: 4px;
  flex: 1;
}
.scroll-item {
  padding: 8px;
  border-bottom: 1px solid #f2f3f5;
  font-size: 13px;
}
.masonry-item {
  background: #fff;
  border: 1px solid #ebedf0;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #646566;
}
.drawer-inner {
  padding: 16px;
}
.form-error {
  color: #fa5151;
  font-size: 12px;
}
.form-tip {
  color: #07c160;
  font-size: 12px;
  margin-top: 4px;
}
</style>