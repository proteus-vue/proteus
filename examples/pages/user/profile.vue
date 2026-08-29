<!-- examples/pages/user/profile.vue —— 个人资料（halfScreen 半屏路由目标页）
     类型提示全链路示例：route 块的 params 声明路由参数类型（生成 RouteParamsByName） -->
<route>
{
  "meta": {
    "title": "个人资料",
    "requiresAuth": true
  },
  "params": {
    "id": "string",
    "from": "string",
    "kw": "string"
  }
}
</route>
<script setup lang="ts">
</script>

<template>
  <div class="profile">
    <h2>个人资料</h2>
  </div>
</template>

<style>
/* 半屏页透明背景暂移除：真机报 applyAnimatedStyle can not find corresponding nodes，隔离测试用 */
.profile {
  text-align: center;
  padding: 24px 0;
}
</style>
