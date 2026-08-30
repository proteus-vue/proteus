<!-- examples/subpackages/order/pages/list.vue —— 分包示例页（订单列表）
     本页以 route-type="scaleDown" 进入后获得联动能力：被覆盖时自身下沉缩放（经典架构 A 页） -->
<route>
{
  "meta": {
    "title": "订单列表"
  }
}
</route>
<script setup lang="ts">
</script>

<template>
  <div class="order-list">
    <h2>订单列表（分包）</h2>
    <div class="links">
      <a href="/pages/showcase" route-type="scaleDown">转场演示（层叠缩放：本页下沉 + 演示页滑入）</a>
    </div>
  </div>
</template>

<style scoped>
.order-list {
  text-align: center;
  padding: 24px 0;
}
.links a {
  display: block;
  padding: 8px 0;
  color: #1a7af8;
}
</style>
