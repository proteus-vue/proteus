<!-- examples/pages/config-demo.vue —— proteus.config 规则覆盖演示页（★底线循环 ③）
     演示 proteus.config.ts 的 rules 段：改配置即改变编译行为，无需改框架代码 -->
<route>
{
  "meta": {
    "title": "配置演示"
  }
}
</route>
<script setup lang="ts">
import { ref } from 'vue'

const clicked = ref(0)

function bump() {
  clicked.value++
}
</script>

<template>
  <div class="config-demo">
    <h2>proteus.config rules</h2>
    <p class="sub">本页演示 <code>proteus.config.ts</code> 的规则覆盖：改配置 → 重新构建 → 产物即时变化</p>

    <!-- customTags 演示：config 里 customTags: { 'demo-box': 'view' } 已启用，
         此标签编译为 <view class="demo-box">；删除 config 中该键即回到"未注册标签原样输出" -->
    <demo-box class="demo-box">customTags：'demo-box' → view（config 启用）</demo-box>

    <button @click="bump">计数：{{ clicked }}</button>

    <div class="note">
      <p><b>试玩三个开关</b>（编辑 proteus.config.ts 的 rules 段后 <code>npm run build:mp</code>）：</p>
      <ul>
        <li><code>customTags</code>：新增标签映射（本页 demo-box）</li>
        <li><code>mapping</code>：改写映射（如 'tag/link-to-view': { a: 'text' }）</li>
        <li><code>disabled</code>：禁用规则（如 'directive/v-if'，v-if 将被忽略 + 编译期警告）</li>
      </ul>
    </div>
  </div>
</template>

<style>
.config-demo {
  padding: 24px;
  text-align: center;
}
.sub {
  color: #888;
  font-size: 13px;
}
.demo-box {
  display: block;
  padding: 16px;
  background: #eef4ff;
  border-radius: 8px;
  margin: 12px 0;
}
.note {
  margin-top: 20px;
  text-align: left;
  background: #f5f6f7;
  padding: 12px;
  border-radius: 8px;
  font-size: 13px;
}
.note code {
  background: #e6e8eb;
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 12px;
}
</style>
