<script setup lang="ts">
// ══════════════════════════════════════════════════════════════════════════════
// 柔性系统演示内容 —— 同一份「语义内容」，交给 <p-formfactor> 按设备形态自动编排
//
// ★这个文件里**没有任何形态判断**（没有 if (form === 'car')、没有断点槽、没有能力判断）——
//   业务只声明内容槽（media/heading/price/sku/actions/recommend/rail/tabbar），
//   框架据形态画像自动决定：布局拓扑 / 导航形态 / 视觉语言 / 能力槽取舍 / 密度 / 缩放 / 热区。
//   这正是「柔性系统」与「响应式布局」的分水岭。
//
// 形态由宿主声明（演示页逐个声明）；真实 App 里来自端 profile。
// ══════════════════════════════════════════════════════════════════════════════
import { ref } from 'vue'
import type { DeviceForm } from '@proteus-vue/fluid'
import { computed } from 'vue'
import { locale } from '../../i18n'

const isEn = computed(() => locale.value === 'en')

const props = defineProps<{
  form: DeviceForm
  width: number
  height: number
}>()

// 纯业务状态（与形态无关）
const product = {
  name: '无线降噪耳机 Pro',
  price: 1299,
  desc: '40h 续航 · 自适应降噪 · 空间音频 · Hi-Res 认证',
}
const skus = ['曜石黑', '月光白', '雾霾蓝']
const picked = ref('曜石黑')
const counted = ref(1)
const recs = [
  { ic: '🎵', name: '替换耳罩', price: 39 },
  { ic: '🔌', name: '音频线', price: 59 },
  { ic: '🎒', name: '收纳包', price: 99 },
  { ic: '🔋', name: '充电底座', price: 199 },
  { ic: '📦', name: '旅行套装', price: 299 },
]
</script>

<template>
  <!-- ★框架组件：一行接形态，其余全自动（拓扑 / 视觉语言 / 能力 / 密度 / 缩放 / 热区） -->
  <p-formfactor :declared="form" :width="width" :height="height">
    <!-- 侧栏（仅声明 sidebar 的形态渲染：平板 / PC） -->
    <template #rail>
      <span class="fp-brand">🎧 云端商城</span>
      <span class="fp-rail-item on"><i class="fp-rail-ic">🏠</i>{{ isEn ? 'Home' : '首页' }}</span>
      <span class="fp-rail-item"><i class="fp-rail-ic">🎵</i>{{ isEn ? 'Audio' : '音频' }}</span>
      <span class="fp-rail-item"><i class="fp-rail-ic">📦</i>{{ isEn ? 'Orders' : '订单' }}</span>
      <span class="fp-rail-item"><i class="fp-rail-ic">⚙️</i>{{ isEn ? 'Settings' : '设置' }}</span>
    </template>

    <!-- 主视觉 -->
    <template #media>
      <div class="fp-cover">🎧</div>
    </template>

    <!-- 标题与描述 -->
    <template #heading>
      <strong class="fp-name">{{ product.name }}</strong>
      <span class="fp-desc">{{ product.desc }}</span>
    </template>

    <!-- 价格（暗色形态由框架换成暖橙强调色） -->
    <template #price>
      <strong class="fp-price">¥{{ product.price }}</strong>
    </template>

    <!-- 多规格（★车机形态声明不支持 skuMulti → 框架自动不渲染，业务无感） -->
    <template #sku>
      <span v-for="s in skus" :key="s" class="fp-sku" :class="{ on: picked === s }" @click="picked = s">{{ s }}</span>
    </template>

    <!-- 主操作（遥控/旋钮形态框架自动放大热区 + 加焦点环；车机只留 2 个大热区） -->
    <template #actions>
      <button class="fp-primary" @click="counted++">▶ 立即购买</button>
      <button class="fp-ghost">＋ 收藏</button>
    </template>

    <!-- 推荐（★TV/车机形态框架自动转横向焦点海报流） -->
    <template #recommend>
      <div v-for="r in recs" :key="r.name" class="pf-rec-card fp-rec">
        <span class="fp-rec-ic">{{ r.ic }}</span>
        <span class="fp-rec-name">{{ r.name }}</span>
        <span class="fp-rec-pt">¥{{ r.price }}</span>
      </div>
    </template>

    <!-- 底部 Tab（★仅声明 tabs 的形态渲染：手机 / 折叠屏） -->
    <template #tabbar>
      <span class="on">首页</span><span>发现</span><span>购物车</span><span>我的</span>
    </template>
  </p-formfactor>
</template>

<style scoped>
/* 演示内容样式（★与形态无关——形态引起的排列/配色差异全在 p-formfactor 内） */
.fp-brand { font-weight: 800; margin-bottom: 8px; font-size: calc(var(--pf-font) * 1.05); }
.fp-rail-item {
  display: flex;
  align-items: center;
  gap: calc(var(--pf-u) * 0.5);
  min-height: calc(var(--pf-u) * 3.2);
  padding: calc(var(--pf-u) * 0.5) calc(var(--pf-u) * 0.8);
  border-radius: calc(var(--pf-radius) * 0.8);
  color: var(--pf-dim, #666);
  cursor: pointer;
}
.fp-rail-ic { font-style: normal; font-size: calc(var(--pf-font) * 1.05); }
.fp-rail-item.on { background: color-mix(in srgb, var(--pf-brand, #7c5cff) 16%, transparent); color: var(--pf-brand, #7c5cff); font-weight: 700; }

.fp-cover {
  width: 100%;
  height: 100%;
  aspect-ratio: var(--pf-media-ar, 4 / 3);
  border-radius: var(--pf-radius, 10px);
  background: linear-gradient(135deg, rgba(124, 92, 255, 0.22), rgba(171, 155, 255, 0.08));
  display: grid;
  place-items: center;
  font-size: calc(var(--pf-font) * 2.4);
  min-height: 90px;
}
.fp-name { display: block; font-size: calc(var(--pf-font) * 1.45); font-weight: 800; color: var(--pf-text, #17171f); }
.fp-desc { display: block; color: var(--pf-dim, #777); font-size: calc(var(--pf-font) * 1.05); margin-top: 4px; line-height: 1.5; }
.fp-price { display: block; font-size: calc(var(--pf-font) * 1.6); font-weight: 800; color: var(--pf-accent, #7c5cff); }

.pf-sku { display: flex; flex-wrap: wrap; gap: 8px; }
.fp-sku {
  flex: 0 0 auto;
  white-space: nowrap;
  padding: calc(var(--pf-u) * 0.5) calc(var(--pf-u) * 0.8);
  border: 1px solid color-mix(in srgb, var(--pf-text, #17171f) 18%, transparent);
  border-radius: var(--pf-radius, 8px);
  background: var(--pf-surface, #fff);
  color: var(--pf-text, #17171f);
  font-size: calc(var(--pf-font) * 1.05);
  cursor: pointer;
}
.fp-sku.on { border-color: var(--pf-brand, #7c5cff); color: var(--pf-brand, #7c5cff); font-weight: 700; }

.pf-actions { display: flex; gap: var(--pf-gap); flex-wrap: wrap; }
.fp-primary {
  flex: 1 1 auto;
  padding: calc(var(--pf-u) * 0.7) calc(var(--pf-u) * 1.1);
  border: none;
  border-radius: var(--pf-radius, 9px);
  background: var(--pf-brand, #7c5cff);
  color: #fff;
  font-size: calc(var(--pf-font) * 1.05);
  font-weight: 800;
  cursor: pointer;
}
.fp-ghost {
  flex: 0 0 auto;
  padding: calc(var(--pf-u) * 0.7) calc(var(--pf-u) * 1.1);
  border: 1px solid var(--pf-brand, #7c5cff);
  border-radius: var(--pf-radius, 9px);
  background: transparent;
  color: var(--pf-brand, #7c5cff);
  font-size: calc(var(--pf-font) * 1.05);
  font-weight: 700;
  cursor: pointer;
}

.fp-rec {
  background: var(--pf-surface, #fff);
  border: 1px solid color-mix(in srgb, var(--pf-text, #17171f) 12%, transparent);
  border-radius: var(--pf-radius, 10px);
  padding: calc(var(--pf-u) * 0.75);
  display: flex;
  flex-direction: column;
  gap: calc(var(--pf-gap) * 0.9);
  align-items: center;
}
.fp-rec-ic { font-size: calc(var(--pf-font) * 1.9); }
.fp-rec-name { font-size: calc(var(--pf-font) * 0.85); color: var(--pf-dim, #555); }
.fp-rec-pt { font-size: calc(var(--pf-font) * 0.95); font-weight: 800; color: var(--pf-accent, #7c5cff); }
</style>
