<!-- showcase/subpackages/components/pages/p-share-element.vue —— p-share-element 共享元素转场演示
     覆盖：shuttle-key 配对 / animate 开关 / duration / easing-function / 手势返回 /
           shuttle-on-push|pop 方向控制 / rect-tween-type / 插槽承载内容。
     ★对齐官方 <share-element>（页面间共享元素）——engineering.share-element。
     ★诚实提示：本页在 Web 端为**普通容器**（无宿主共享元素转场）——真实飞行动画需在
       微信（Skyline）或原生端观察；Web 页内过渡请用 p-transition。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PShareElement, PText, PButton } from '@proteus-vue/components'

const lastEvent = ref('（切换开关观察属性生效）')
const animate = ref(true)
const duration = ref(300)

const codes = ref({
  base: '<p-share-element shuttle-key="cover"><p-image src="cover.png" /></p-share-element>',
  animate: '<p-share-element shuttle-key="cover" :animate="false">…</p-share-element>',
  duration: '<p-share-element shuttle-key="cover" :duration="600" easing-function="ease-in-out">…</p-share-element>',
  shuttle: '<p-share-element shuttle-key="cover" shuttle-on-push="cover" shuttle-on-pop="detail">…</p-share-element>',
})

const apiRows = ref([
  ['pid', '组件实例标识（调试/观测/测试定位）', 'string'],
  ['ariaLabel', '无障碍标签', 'string'],
  ['shuttleKey', '映射标记（页面内唯一；两页同名即同一飞跃物）★官方 key（Vue 保留属性故改名）', 'string'],
  ['animate', '是否进行动画（false → 仅位置对齐）★官方 transform（与 CSS transform 类型冲突故改名）', 'boolean'],
  ['duration', '动画时长 ms（★官方 duration）', 'number'],
  ['easingFunction', 'CSS 缓动函数（★官方 easing-function）', 'string'],
  ['transitionOnGesture', '手势返回时是否动画（★官方 transition-on-gesture）', 'boolean'],
  ['shuttleOnPush', 'push 阶段飞跃物（★官方 shuttle-on-push）', 'string'],
  ['shuttleOnPop', 'pop 阶段飞跃物（★官方 shuttle-on-pop）', 'string'],
  ['rectTweenType', '动画插值曲线（★官方 rect-tween-type）', 'string'],
])
const eventRows = ref([['—', '官方 worklet:onframe 为 worklet 回调（框架按事件语义处理，不计入属性）', '—']])
const slotRows = ref([['default', '共享的元素本体（图片/卡片等）', '—']])
</script>

<template>
  <page-shell title="p-share-element 共享元素转场" subtitle="工程 · 对齐官方 share-element">
    <demo-block index="01" title="基础（shuttle-key 配对）" desc="两页中 shuttle-key 相同的元素由宿主做跨页飞行动画" :code="codes.base">
      <template #demo>
        <view class="col">
          <p-share-element shuttle-key="cover" class="shuttle">
            <p-text class="body">封面（shuttle-key=&quot;cover&quot;）</p-text>
          </p-share-element>
          <p-text class="hint">↑ Web 端为普通容器；真机（Skyline/原生）可见飞行动画</p-text>
        </view>
      </template>
    </demo-block>

    <demo-block index="02" title="animate 开关" desc="animate=false → 仅位置对齐、无过渡" :code="codes.animate" :has-output="true">
      <template #demo>
        <view class="col">
          <p-button size="small" @tap="(animate = !animate, lastEvent = 'animate = ' + animate)">切换 animate（当前 {{ animate }}）</p-button>
          <p-share-element shuttle-key="cover" :animate="animate" class="shuttle">
            <p-text class="body">animate={{ animate }}</p-text>
          </p-share-element>
        </view>
      </template>
      <template #output><p-text class="out">{{ lastEvent }}</p-text></template>
    </demo-block>

    <demo-block index="03" title="时长与缓动" desc="duration / easing-function 控制飞行节奏" :code="codes.duration" :has-output="true">
      <template #demo>
        <view class="col">
          <p-button size="small" @tap="(duration = duration === 300 ? 600 : 300, lastEvent = 'duration = ' + duration + 'ms')">切换时长（当前 {{ duration }}ms）</p-button>
          <p-share-element shuttle-key="cover" :duration="duration" easing-function="ease-in-out" class="shuttle">
            <p-text class="body">{{ duration }}ms · ease-in-out</p-text>
          </p-share-element>
        </view>
      </template>
      <template #output><p-text class="out">{{ lastEvent }}</p-text></template>
    </demo-block>

    <demo-block index="04" title="方向控制（shuttle-on-push / shuttle-on-pop）" desc="分别指定 push 与 pop 阶段的飞跃物" :code="codes.shuttle">
      <template #demo>
        <p-share-element shuttle-key="cover" shuttle-on-push="cover" shuttle-on-pop="detail" class="shuttle">
          <p-text class="body">push→cover · pop→detail</p-text>
        </p-share-element>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
  </page-shell>
</template>

<style scoped>
.col { display: flex; flex-direction: column; gap: var(--sp-3); }
.shuttle {
  padding: 10px 12px;
  border: 1px dashed #c9ccd6;
  border-radius: 8px;
  background: #fafbfe;
}
.body { font-size: 13px; color: #1c1b22; }
.hint { font-size: 11.5px; color: #8a8fa0; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>
