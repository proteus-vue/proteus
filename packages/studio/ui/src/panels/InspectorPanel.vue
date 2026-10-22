<script setup lang="ts">
import PanelShell from './PanelShell.vue'

// 【这一节刻意不接数据】元素拾取目前**没有数据源**（设备侧视图树 + 拾取通道未接）。
// 与其显示假盒模型，不如把"为什么没有"写清楚——这是本仓的既定纪律（不占位、不返假数据）。
// 决策 #1183：从"占位"改成"显式说明缺什么"，删掉含糊的 todo 语气。
</script>

<template>
  <PanelShell title="检查器（无数据源）">
    <div class="todo">
      元素拾取这一层<b>还没有数据源</b>，所以这里不显示盒模型 / 计算样式：
      <ul>
        <li>需要设备侧的视图树 + 元素拾取通道（未接）</li>
        <li>
          源码定位（G-54 <code>locateAssertion</code>）—— 仓库里没有「断言 id → 代码位置」注册表，
          <b>确认不存在，不是没找</b>
        </li>
      </ul>
    </div>
    <template #note>
      已经能查的是<b>能力影响面</b>（G-54 <code>affectedDevices</code>，决策 #1180）：<br />
      <code>proteus knowledge devices &lt;id&gt;</code> ⇒ 例如 <code>clipboard → skyline web</code>（不含 app，
      改它不必回归 App 端）。
    </template>
  </PanelShell>
</template>

<style scoped>
.todo{font-size:12px;color:var(--dim);line-height:1.7}
.todo b{color:#e6e8ee;font-weight:600}
.todo ul{margin:4px 0 0;padding-left:16px}
.todo li{margin:2px 0}
code{background:var(--panel2);border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:11px;color:#c3c9d4}
</style>
