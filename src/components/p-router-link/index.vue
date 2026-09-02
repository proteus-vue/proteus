<!-- src/components/p-router-link/index.vue —— E18 声明式导航（engineering.router-link）
     to：导航目标（路由名或路径——createRouterEngineering.push({ name|path }) 语义，E11）
     replace：替换当前页（E12 语义）
     switchTab：切 Tab 页（E14 语义）
     行为：点击 emit('navigate', { to, replace, switchTab })——父级用 createRouterEngineering（#320）响应；
           组件零平台依赖（不 import router、不碰 wx/document——审计合规）；web role="link" 可访问性
     MP：@click → bindtap；对齐 p-radio defineEmits + emit 既有链路 -->
<template>
  <div class="p-router-link" role="link" @click="onClick">
    <slot />
  </div>
</template>

<script setup lang="ts">
// 对象形式 defineProps（编译器静态提取；MP 安全）
const props = defineProps({
  /** 导航目标（路由名或路径）——createRouterEngineering.push({ name: to | path: to }) */
  to: { type: String, default: '' },
  /** 替换当前页（E12 语义——push({...to, replace:true})） */
  replace: { type: Boolean, default: false },
  /** 切 Tab 页（E14 语义——push({...to, switchTab:true})） */
  switchTab: { type: Boolean, default: false },
})

const emit = defineEmits(['navigate'])

/** 点击 → 语义导航载荷（父级 createRouterEngineering 响应） */
function onClick(): void {
  emit('navigate', { to: props.to, replace: props.replace, switchTab: props.switchTab })
}
</script>

<style scoped>
.p-router-link {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  text-decoration: none;
  user-select: none;
}
</style>