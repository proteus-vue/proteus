<!-- examples/pages/user/index.vue —— 用户中心（非 tab 页）
     自定义路由（半屏/转场）必须从非 tab 页发起（微信平台约束，真机确诊），故演示链接放在本页 -->
<script setup lang="ts">
</script>

<template>
  <div class="user">
    <h2>用户中心</h2>
    <p>（自定义路由需从非 tab 页发起）</p>
    <div class="links">
      <a class="link" href="/pages/showcase" route-type="scaleDown">转场演示（缩放-综合能力）</a>
      <a class="link" href="/subpackages/order/pages/list" route-type="scaleDown">订单列表（缩放进入）</a>
      <a class="link" href="/pages/user/profile" route-type="halfScreen">个人资料（半屏-自定义）</a>
      <a class="link" href="/pages/user/profile" route-type="slideUp">个人资料（slideUp 自定义）</a>
      <a class="link" href="/pages/user/profile" route-type="wx://bottom-sheet">个人资料（半屏-微信预设）</a>
    </div>
  </div>
</template>

<style scoped>
.user {
  text-align: center;
  padding: 24px 0;
}
.links .link {
  display: block;
  padding: 8px 0;
  color: #1a7af8;
}
</style>
