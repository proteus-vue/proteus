<!-- packages/components/pg-glass-nav/index.vue —— ★★★悬浮玻璃导航（对齐 iOS App Store 悬浮玻璃 tab 栏 · 决策 #906）

   【是什么】一条**悬浮**在内容之上的**液态玻璃导航**：外层整条 = `<pg-glass preset="floating" interactive>`
   （dogfood 单入口铁律），按/拖玻璃条本身 ⇒ **上层玻璃表面流动**（`interactiveEffect="surface"`，对齐
   Apple `UIGlassEffect.isInteractive`）；激活项高亮为半透明玻璃胶囊。
   · 组件**不定位**（不写 position:fixed）：悬浮行为由消费方用自有类（如 `position: fixed; bottom: …`）
     或宿主 chrome 决定（Web overlay Tab 同理，见 tab-bar-spec 注释）。
   · 三端：App 端外层 `<pg-glass>` 由编译器折 `style.glass`（静态字面量 ⇒ 折入）；Web/MP 走组件 CSS。

   【props】items: {key,label,icon?}[] · active（受控）· radius（胶囊圆角，默认 22）
   【事件】update:active / select（同 p-tabbar 语义）
   （本项目多端编译：与 p-tabbar 同款"v-for 数据行预计算 + dataset 传值"，MP WXML 禁函数调用。） -->
<template>
  <view class="pg-glass-nav">
    <pg-glass
      class="pg-glass-nav__bar"
      preset="floating"
      :radius="radius"
      interactive
      interactive-effect="surface"
    >
      <view class="pg-glass-nav__inner">
        <!-- ★决策 #906 · App 边界：**不要 v-for 行内动态 `:class`**——App slot-runtime 对「v-for 行内的
             `:class` 对象」不支持（会当 list-item style 发错值 ⇒ 项渲染成黑块），故此处**静态类**；
             激活态由**页面内容区**体现（点击 → active 变 → 下方 pane 切换）。 -->
        <view
          v-for="row in items"
          :key="row.key"
          class="pg-glass-nav__item"
          :data-value="row.key"
          @click="onSelect"
        >
          <view class="pg-glass-nav__glyph">
            <p-icon v-if="row.icon" :name="row.icon" :size="22" />
          </view>
          <text class="pg-glass-nav__label">{{ row.label }}</text>
        </view>
      </view>
    </pg-glass>
  </view>
</template>

<script setup lang="ts">
import PgGlass from '../pg-glass/index.vue'
import PIcon from '../p-icon/index.vue'

interface NavItem {
  key?: string | number
  label?: string
  icon?: string
}

const props = defineProps({
  /** 导航项（{key,label,icon?}） */
  items: { type: Array as () => NavItem[], default: () => [] },
  /** 当前激活项 key（受控） */
  active: { type: [String, Number], default: '' },
  /** 玻璃条圆角 px（悬浮胶囊感：默认 22） */
  radius: { type: Number, default: 22 },
})

const emit = defineEmits(['update:active', 'select'])

// ★决策 #906：**直接 v-for `items`（不用 computed 预计算）**——App slot-runtime 不执行 `computed`
//   （页面数据由构建期快照；组件内 computed 不产 data）⇒ 用 computed 折 rows 会让**导航项在 App 端不渲染**
//   （真机实测：玻璃条在、图标/文案全无）。`items` 作为 prop 由父级下行，模板 `row.key/label/icon` 逐字段消费。

function onSelect(e: unknown): void {
  const ev = e as { currentTarget?: { dataset?: { value?: unknown } } }
  const key = String(ev?.currentTarget?.dataset?.value ?? '')
  emit('update:active', key)
  emit('select', key)
}
</script>

<style scoped>
.pg-glass-nav {
  /* ★不定位：悬浮由消费方类决定（组件保持"可放任意位置"）。 */
  width: 100%;
}
.pg-glass-nav__bar {
  /* 悬浮玻璃条本体：圆角胶囊 + 轻阴影（浮于内容之上的观感）。 */
  display: block;
  overflow: hidden;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.18);
}
.pg-glass-nav__inner {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-around;
  height: 60px;
  padding: 0 8px;
  box-sizing: border-box;
}
.pg-glass-nav__item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 48px;
  border-radius: 16px;
  color: var(--sa-text-3, #8a8f99);
  transition: background-color 0.18s ease-out, color 0.18s ease-out;
}
/* 激活项 = 半透明玻璃胶囊（对齐截图里高亮那个"流动"的胶囊）。 */
.pg-glass-nav__item--on {
  background: rgba(91, 91, 214, 0.16);
  color: var(--sa-brand, #5b5bd6);
}
.pg-glass-nav__glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 24px;
}
.pg-glass-nav__label {
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}
</style>
