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
import { ref } from 'vue'
import type { PageOnLoad } from '@proteus/router/types'
import { onLoad } from '@proteus/runtime'

// 类型提示全链路：onLoad 参数自动匹配本路由声明的 params（{ id?, from?, kw? }）
// MP 端：编译产物注入路由参数 + 回调执行；Web 端：no-op 兼容（参数在路由层处理）
const id = ref('')

onLoad((options: PageOnLoad<'user-profile'>) => {
  // 注意：不用 ?? 运算符（真机不支持，决策 #36），显式 null 检查
  id.value = options.id === undefined || options.id === null ? '' : options.id
})
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
