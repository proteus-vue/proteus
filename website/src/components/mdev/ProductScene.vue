<script setup lang="ts">
// mdev 场景：ProductDetail —— 一份语义数据，供六端同源呈现（真实 DOM 渲染）
// 内容与原型 flexible-multi-device.html 的 PRODUCT 对齐（语义不变、真实组件化）
const product = {
  name: 'Proteus Buds Pro',
  gallery: ['🎧', '🌈', '📦'],
  price: 1299,
  desc: '40h battery · adaptive noise cancelling · spatial audio · seamless multi-device switching.',
  skus: ['Obsidian', 'Moonlight', 'Mist Blue'],
  related: [
    { name: 'Carrying case', price: 99 },
    { name: 'Type-C cable', price: 59 },
    { name: 'Ear tips (S/M/L)', price: 39 },
    { name: 'Charging box', price: 299 },
  ],
}
</script>

<template>
  <p-view class="pd">
    <p-stack direction="row" :gap="8" wrap class="gallery">
      <p-text v-for="(g, i) in product.gallery" :key="i" class="gal">{{ g }}</p-text>
    </p-stack>
    <p-heading :level="1" class="name">{{ product.name }}</p-heading>
    <p-text class="price">¥ {{ product.price }}</p-text>
    <p-text class="desc">{{ product.desc }}</p-text>
    <p-stack direction="row" :gap="6" wrap class="skus">
      <p-text v-for="(s, i) in product.skus" :key="i" class="sku" :class="{ on: i === 0 }">{{ s }}</p-text>
    </p-stack>
    <p-grid :min-col-width="110" :gap="6" class="rel">
      <p-view v-for="(r, i) in product.related" :key="i" class="rel-card">
        <p-text class="rel-name">{{ r.name }}</p-text>
        <p-text class="rel-price">¥{{ r.price }}</p-text>
      </p-view>
    </p-grid>
  </p-view>
</template>

<style scoped>
.pd { padding: 10px 12px; display: flex; flex-direction: column; gap: 5px; }
.gallery { gap: 6px; }
.gal { font-size: 15px; background: #eef0f8; border-radius: 8px; padding: 2px 7px; }
.name { margin: 0; }
.price { color: #d9483b; font-weight: 700; font-size: 15px; }
.desc { font-size: 10.5px; color: #556; line-height: 1.55; }
.skus { margin-top: 2px; }
.sku {
  font-size: 10px;
  padding: 2px 8px;
  border: 1px solid #cdd3e8;
  border-radius: 999px;
  color: #445;
}
.sku.on { border-color: var(--brand); color: var(--brand); background: rgba(91, 140, 255, 0.08); }
.rel { margin-top: 4px; }
.rel-card { border: 1px solid #e3e6f2; border-radius: 8px; padding: 6px 8px; }
.rel-name { font-size: 10px; font-weight: 650; }
.rel-price { font-size: 10px; color: #778; }
</style>
