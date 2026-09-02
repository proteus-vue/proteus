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

    <section class="block">
      <p-heading :level="2">⑤ 手势原语（Gesture）</p-heading>
      <p-divider :inset="8" />
      <div class="row">
        <p-text class="label">p-draggable（可拖拽）：</p-text>
        <p-draggable :snap-to-grid="20" @drag="onDrag" @drop="onDrop">
          <div class="drag-zone">拖动我（吸附 20px 网格）</div>
        </p-draggable>
        <p-text class="hint">位置: {{ dragPos }}</p-text>
      </div>
      <div class="row">
        <p-text class="label">p-scrollable（可滚动+触底加载）：</p-text>
        <p-scrollable :height="140" :load-more="true" :loading="scrollLoading" @load-more="onLoadMore">
          <div v-for="i in scrollItems" :key="i" class="scroll-item">滚动加载项 {{ i }}</div>
        </p-scrollable>
      </div>
      <div class="row">
        <p-text class="label">v-gesture（指令）：</p-text>
        <div v-gesture:tap="onTapG" class="gesture-demo">{{ tapMsg }}</div>
      </div>
    </section>

    <section class="block">
      <p-heading :level="2">⑨ 桌面交互（G-24 B1：p-hover / p-shortcut / p-focus-trap / p-context-menu）</p-heading>
      <p-divider :inset="8" />
      <div class="row">
        <p-text class="label">v-p-hover（悬停 lift）：</p-text>
        <div v-p-hover="'lift'" class="hover-card">悬停我（lift 提升）</div>
      </div>
      <div class="row">
        <p-text class="label">v-p-shortcut（mod+s 保存）：</p-text>
        <p-button variant="primary" v-p-shortcut="shortcutSave" @click="onShortcutSave">保存 ⌘S/Ctrl+S（{{ shortcutCount }}）</p-button>
      </div>
      <div class="row">
        <p-text class="label">v-p-context-menu（右键菜单）：</p-text>
        <div v-p-context-menu="cardMenu" class="ctx-card">右键我（{{ ctxLog }}）</div>
      </div>
      <div class="row">
        <p-text class="label">v-p-focus-trap（焦点陷阱）：</p-text>
        <div v-p-focus-trap class="trap-dialog">
          <p-input :model-value="trapVal" placeholder="Tab 在框内循环" @update:model-value="onTrapInput" />
          <p-button size="small" @click="onTrap">确定</p-button>
        </div>
      </div>
    </section>

    <section class="block">
      <p-heading :level="2">⑩ 系统集成（G-24 B2：p-notify / p-permission / p-clipboard / p-deeplink）</p-heading>
      <p-divider :inset="8" />
      <p-text class="hint-text">权限清单（buildPermissionManifest——Compiler 期生成）：{{ manifest }}</p-text>
      <div class="row">
        <p-text class="label">p-notify + p-permission 门禁（先授权后发送）：</p-text>
        <p-button size="small" @click="onRequestNotify">请求通知权限（{{ notifyState }}）</p-button>
        <p-button variant="primary" size="small" v-p-permission="{ semantic: 'notification', onState: onNotifyState }" @click="onSendNotify">发送通知</p-button>
        <p-text class="val">{{ notifyResult }}</p-text>
      </div>
      <div class="row">
        <p-text class="label">p-clipboard（复制/读取——Clipboard API → 降级）：</p-text>
        <p-button size="small" @click="onCopy">复制</p-button>
        <p-button size="small" @click="onPaste">粘贴读取</p-button>
        <p-text class="val">{{ clipOut }}</p-text>
      </div>
      <div class="row">
        <p-text class="label">p-deeplink（parse + 参数化匹配）：</p-text>
        <p-button size="small" @click="onParseLink">解析 proteus://order/42?tab=detail</p-button>
        <p-text class="val">{{ linkOut }}</p-text>
      </div>
    </section>

    <section class="block">
      <p-heading :level="2">⑪ 导航结构（G-24 B3：p-master-detail / p-tabs / p-command / p-breadcrumb）</p-heading>
      <p-divider :inset="8" />
      <p-text class="hint-text">p-master-detail（UISplitViewController 三列——拖窗口看列形态变化，当前视口 {{ viewW }}px）：</p-text>
      <div class="row">
        <p-text class="label">列布局 {{ splitCols }}（detail={{ detailOpen ? '开' : '关' }}·inspector={{ inspectorOn ? '开' : '关' }}）：</p-text>
        <p-button size="small" @click="onSelectMaster">select（进 detail）</p-button>
        <p-button size="small" @click="onBackSplit">back（回 master）</p-button>
        <p-button size="small" @click="onToggleInspector">inspector 开关</p-button>
      </div>
      <div class="row">
        <p-text class="label">p-tabs（桌面标签——关闭激活迁移）：</p-text>
        <span v-for="t in demoTabs" :key="t.id" class="tab-chip" :class="{ on: t.id === demoActive }">{{ t.label }}<button v-if="t.closable !== false" class="tab-x" @click="onCloseTab(t.id)">×</button></span>
        <p-button size="small" @click="onTabOpen">+ 开新标签</p-button>
        <p-text class="val">{{ demoState }}</p-text>
      </div>
      <div class="row">
        <p-text class="label">p-command（⌘K 面板数据层——输入过滤 + ↑↓ 选择）：</p-text>
        <p-input :model-value="cmdQuery" placeholder="搜索命令（如 build / 新建）" @update:model-value="onCmdQuery" class="cmd-input" />
        <p-button size="small" @click="onCmdKey(-1)">↑</p-button>
        <p-button size="small" @click="onCmdKey(1)">↓</p-button>
        <p-button size="small" @click="onCmdPick">执行</p-button>
        <p-text class="val">{{ cmdOut || '输入查询过滤命令（title/keywords/分组）' }}</p-text>
      </div>
      <div class="row">
        <p-text class="label">p-breadcrumb（路由栈推导）：</p-text>
        <p-button size="small" @click="onBreadcrumb">推导 home/user/profile</p-button>
        <p-text class="val">{{ demoState2 || '—' }}</p-text>
      </div>
    </section>

    <section class="block">
      <p-heading :level="2">⑫ 生命周期/设备（G-24 B4：p-lifecycle / p-state-restoration / p-network-status / p-low-power）</p-heading>
      <p-divider :inset="8" />
      <p-text class="hint-text">p-lifecycle：页面相位 = {{ lifePhase }}（切换标签页/窗口实时更新）</p-text>
      <div class="row">
        <p-text class="label">p-network-status：</p-text>
        <p-button size="small" @click="onNetCheck">检测网络</p-button>
        <p-text class="val">{{ netOut }}</p-text>
      </div>
      <div class="row">
        <p-text class="label">p-low-power：</p-text>
        <p-button size="small" @click="onPowerCheck">检测电量</p-button>
        <p-text class="val">{{ powerOut }}</p-text>
      </div>
      <div class="row">
        <p-text class="label">p-state-restoration（刷新恢复）：</p-text>
        <p-button size="small" @click="onCaptureState">捕获当前状态</p-button>
        <p-button size="small" @click="onRestoreState">恢复</p-button>
        <p-text class="val">{{ restoreOut }}</p-text>
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
  PDraggable,
  PScrollable,
} from '@proteus-vue/components'

// —— G-24 B2 系统集成（p-notify / p-permission / p-clipboard / p-deeplink——Web 接线，MP 无 Notification/Clipboard 降级 Err） ——
import {
  sendNotification,
  requestNotifyPermission,
  copyText,
  pasteText,
  parseDeepLink,
  matchDeepLink,
  buildPermissionManifest,
  computeSplitLayout,
  applySplitNav,
  resolveTabAfterClose,
  filterCommands,
  moveCommandIndex,
  deriveBreadcrumb,
  createLifecycleTracker,
  detectNetwork,
  detectLowPower,
  captureState,
  restoreState,
} from '@proteus-vue/desktop'

const manifest = buildPermissionManifest(['notification', 'camera']).map((m) => m.semantic).join('、')
const notifyState = ref('—')
async function onRequestNotify(): Promise<void> {
  const s = await requestNotifyPermission()
  notifyState.value = s
}
function onNotifyState(s: string): void {
  notifyState.value = s
}
const notifyResult = ref('—')
function onSendNotify(): void {
  const r = sendNotification({ title: 'Proteus 演示', body: '系统通知（G-24 B2 p-notify）' })
  notifyResult.value = r.ok ? '已发送 ✅' : `Err: ${r.error ?? ''}`
}
const clipOut = ref('—')
async function onCopy(): Promise<void> {
  const r = await copyText(`Proteus 剪贴板演示 ${Date.now()}`)
  clipOut.value = r.ok ? '已复制 ✅' : `Err: ${r.error ?? ''}`
}
async function onPaste(): Promise<void> {
  const r = await pasteText()
  clipOut.value = r.ok ? `读到：${r.data}` : `Err: ${r.error ?? ''}`
}
const linkOut = ref('')
function onParseLink(): void {
  const dl = parseDeepLink('proteus://order/42?tab=detail')
  const m = matchDeepLink('proteus://order/:id', 'proteus://order/42')
  linkOut.value = `path=/${(dl?.path ?? []).join('/')}·query=${(dl?.query ?? {}).tab ?? ''}·id=${m.params.id ?? ''}`
}

// —— G-24 B3 导航结构（p-master-detail / p-tabs / p-command / p-breadcrumb——纯逻辑驱动，宽屏/桌面形态） ——
const viewW = ref(960)
let splitTimer = 0
function onResize(): void {
  // 拖窗口实时 reflow（节流 100ms）
  if (typeof window === 'undefined') return
  window.clearTimeout(splitTimer)
  splitTimer = window.setTimeout(() => {
    viewW.value = window.innerWidth
  }, 100)
}
if (typeof window !== 'undefined') window.addEventListener('resize', onResize)
const detailOpen = ref(true)
const inspectorOn = ref(true)
const splitCols = ref('')
function refreshSplit(): void {
  const l = computeSplitLayout({ width: viewW.value, detailOpen: detailOpen.value, inspector: inspectorOn.value })
  splitCols.value = `[${l.columns.join(' · ')}]`
}
function onSelectMaster(): void {
  const l = computeSplitLayout({ width: viewW.value, detailOpen: detailOpen.value, inspector: inspectorOn.value })
  const r = applySplitNav({ type: 'select' }, { layout: l, inspectorOn: inspectorOn.value })
  detailOpen.value = r.detailOpen
  inspectorOn.value = r.inspectorOn
  refreshSplit()
}
function onBackSplit(): void {
  const l = computeSplitLayout({ width: viewW.value, detailOpen: detailOpen.value, inspector: inspectorOn.value })
  const r = applySplitNav({ type: 'back' }, { layout: l, inspectorOn: inspectorOn.value })
  detailOpen.value = r.detailOpen
  inspectorOn.value = r.inspectorOn
  refreshSplit()
}
function onToggleInspector(): void {
  const l = computeSplitLayout({ width: viewW.value, detailOpen: detailOpen.value, inspector: inspectorOn.value })
  const r = applySplitNav({ type: 'toggleInspector' }, { layout: l, inspectorOn: inspectorOn.value })
  detailOpen.value = r.detailOpen
  inspectorOn.value = r.inspectorOn
  refreshSplit()
}

const demoOpen = ref(2)
const demoActive = ref('t1')
const demoState = ref('')
function onCloseTab(id: string): void {
  if (id === 't0') return // 首 tab 不可关（closable 语义演示）
  const r = resolveTabAfterClose(demoTabs.value, demoActive.value, id)
  demoTabs.value = r.tabs
  demoActive.value = r.activeId ?? ''
  demoState.value = `已关闭 ${id} → 激活 ${demoActive.value}`
}
function onTabOpen(): void {
  demoOpen.value += 1
  const id = `t${demoOpen.value}`
  demoTabs.value.push({ id, label: `标签 ${demoOpen.value}` })
  demoActive.value = id
}

const cmdQuery = ref('')
const cmdIdx = ref(0)
const cmdOut = ref('')
function onCmdQuery(v: string): void {
  cmdQuery.value = v
  cmdIdx.value = 0
}
function onCmdKey(dir: number): void {
  const list = filterCommands(cmdItems, cmdQuery.value)
  cmdIdx.value = moveCommandIndex(cmdIdx.value, dir as 1 | -1, list.items.length)
  cmdOut.value = list.items[cmdIdx.value] ? `选中：${list.items[cmdIdx.value].title}` : '无结果'
}
function onCmdPick(): void {
  const list = filterCommands(cmdItems, cmdQuery.value)
  const hit = list.items[cmdIdx.value]
  cmdOut.value = hit ? `执行：${hit.title}（${hit.group ?? ''}）` : '无结果'
}

const demoState2 = ref('')
function onBreadcrumb(): void {
  const c = deriveBreadcrumb(['home', 'user', 'profile'])
  demoState2.value = c.map((x) => x.label + (x.current ? '›' : '')).join(' / ')
}

refreshSplit()
// —— G-24 B4 生命周期/设备（p-lifecycle / p-state-restoration / p-network-status / p-low-power——纯逻辑驱动） ——
const lifePhase = ref('foreground')
let lifeTracker: { destroy(): void } | null = null
if (typeof document !== 'undefined') {
  lifeTracker = createLifecycleTracker({
    onPhase: (p: string) => {
      lifePhase.value = p
    },
  })
}
const netOut = ref('—')
function onNetCheck(): void {
  const i = detectNetwork()
  netOut.value = `online=${i.online} · kind=${i.kind}${i.effectiveType ? ` · ${i.effectiveType}` : ''}`
}
const powerOut = ref('—')
async function onPowerCheck(): Promise<void> {
  const p = await detectLowPower()
  powerOut.value = p.supported ? `lowPower=${p.lowPower} · charging=${p.charging} · ${Math.round(p.level * 100)}%` : 'Battery API 不可用（supported:false——诚实降级）'
}
const restoreOut = ref('—')
function onCaptureState(): void {
  const token = captureState('demo', 'view', { path: typeof location !== 'undefined' ? location.pathname : '', ts: Date.now() })
  restoreOut.value = `已捕获（token：${token.slice(0, 28)}…）`
}
function onRestoreState(): void {
  const s = restoreState<{ path?: string; ts?: number }>('demo', 'view')
  restoreOut.value = s ? `恢复：path=${s.path ?? ''}·ts=${s.ts ?? ''}` : '无恢复态（未捕获或非浏览器环境）'
}
void lifeTracker

const demoTabs = ref<Array<{ id: string; label: string; closable?: boolean }>>([
  { id: 't0', label: '首页', closable: false },
  { id: 't1', label: '用户管理' },
  { id: 't2', label: '订单详情' },
])
const cmdItems: Array<{ id: string; title: string; group?: string; keywords?: string[] }> = [
  { id: 'new', title: '新建页面', group: '页面', keywords: ['create', 'add'] },
  { id: 'gen', title: '生成路由', group: '页面' },
  { id: 'audit', title: '运行 audit 门禁', group: '构建', keywords: ['check'] },
  { id: 'mp', title: '构建小程序', group: '构建', keywords: ['build'] },
]

const shortcutCount = ref(0)
function onShortcutSave(): void {
  shortcutCount.value += 1
}
// ★MP 安全：对象字面量内不嵌带标注箭头（#310 惯例）——handler 用方法引用
const shortcutSave = { expr: 'mod+s:save', handler: onShortcutSave }
const ctxLog = ref('—')
function onMenuSelect(value: string | undefined): void {
  ctxLog.value = value ?? ''
}
const cardMenu = {
  items: [
    { label: '编辑', value: 'edit' },
    { label: '复制', value: 'copy' },
    { label: '删除', value: 'del', danger: true },
  ],
  onSelect: onMenuSelect,
}
const trapVal = ref('')
function onTrapInput(v: string): void {
  trapVal.value = v
}
function onTrap(): void {
  trapVal.value = '已确认'
}

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
const dragPos = ref('(0, 0)')
const scrollItems = ref(Array.from({ length: 10 }, (_, i) => i + 1))
const scrollLoading = ref(false)
const tapMsg = ref('点击我（v-gesture:tap）')

function onDrag(payload: { x: number; y: number }): void {
  dragPos.value = '(' + payload.x + ', ' + payload.y + ')'
}
function onDrop(_payload: { x: number; y: number }): void {
  dragPos.value = '放下 → ' + dragPos.value
}
function onLoadMore(): void {
  if (scrollLoading.value) return
  scrollLoading.value = true
  // 模拟异步加载
  setTimeout(() => {
    const len = scrollItems.value.length
    scrollItems.value.push(...Array.from({ length: 5 }, (_, i) => len + i + 1))
    scrollLoading.value = false
  }, 600)
}
function onTapG(e: { x: number; y: number; count: number }): void {
  tapMsg.value = 'tap@(' + e.x + ',' + e.y + ') 第' + e.count + '击'
}

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
/* ★⑪ 导航结构区块（G-24 B3） */
.tab-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  margin: 0 4px 4px 0;
  border: 1px solid #ebedf0;
  border-radius: 4px;
  font-size: 12px;
  background: #fff;
}
.tab-chip.on {
  border-color: #1a7af8;
  color: #1a7af8;
  background: rgba(26, 122, 248, 0.06);
}
.tab-x {
  border: none;
  background: transparent;
  color: #999;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 0 2px;
}
.cmd-input {
  width: 220px;
}
.hint-text {
  display: block;
  color: #888;
  font-size: 12px;
  margin: 6px 0;
}
</style>