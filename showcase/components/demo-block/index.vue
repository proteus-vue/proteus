<!-- showcase/components/demo-block/index.vue —— 演示块（官方组件文档标准单元）
     ★★根节点与容器用原生 <view>/<text>：类名留在元素上，scoped 样式生效。
     不要用 <p-view class="...">——类名经 root-class 进组件内部，父 wxss 受样式隔离够不到（真机实测失效）。 -->
<script setup lang="ts">
import { ref } from 'vue'

defineProps({
  /** 序号（如 '01'——形成文档节奏） */
  index: { type: String, default: '' },
  title: { type: String, default: '' },
  desc: { type: String, default: '' },
  /** 代码片段（默认展开，可折叠） */
  code: { type: String, default: '' },
  /** 是否有输出内容（控制输出容器显隐——MP 无 :empty，须显式声明） */
  hasOutput: { type: Boolean, default: false },
})

const showCode = ref(true)
function toggleCode() {
  showCode.value = !showCode.value
}
</script>

<template>
  <!-- ★根节点原生 <view>（类名 db 留在元素上 → scoped 卡片样式生效） -->
  <view class="db">
    <view class="db-head">
      <text v-if="index" class="db-idx">{{ index }}</text>
      <view class="db-headmain">
        <text class="db-title">{{ title }}</text>
        <text v-if="desc" class="db-desc">{{ desc }}</text>
      </view>
    </view>

    <view class="db-stage">
      <slot name="demo" />
    </view>

    <view v-if="hasOutput" class="db-outwrap">
      <slot name="output" />
    </view>

    <view v-if="code" class="db-codewrap">
      <view class="db-codehead" @click="toggleCode">
        <view class="db-dots">
          <view class="db-dot db-dot-r" />
          <view class="db-dot db-dot-y" />
          <view class="db-dot db-dot-g" />
        </view>
        <text class="db-codetag">Vue</text>
        <text class="db-codetoggle">{{ showCode ? '收起' : '展开' }}</text>
      </view>
      <view v-if="showCode" class="db-code">
        <text class="db-code-t">{{ code }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.db {
  display: block;
  background: var(--sp-surface);
  border: 1px solid var(--sp-line);
  border-radius: var(--sp-radius-lg);
  padding: var(--sp-4);
  margin-bottom: var(--sp-4);
  box-shadow: 0 1px 3px rgba(28, 27, 34, 0.04);
}
.db-head { display: flex; flex-direction: row; align-items: flex-start; gap: var(--sp-3); }
.db-idx {
  display: block;
  flex-shrink: 0;
  min-width: 26px;
  height: 26px;
  line-height: 26px;
  text-align: center;
  border-radius: 8px;
  background: var(--sp-brand-soft-2);
  color: var(--sp-brand-ink);
  font-size: 12px;
  font-weight: 800;
  font-family: var(--sp-mono);
}
.db-headmain { flex: 1; min-width: 0; display: block; }
.db-title { display: block; font-size: 16px; font-weight: 700; color: var(--sp-text); line-height: 1.4; }
.db-desc { display: block; font-size: 12.5px; color: var(--sp-text-3); margin-top: 3px; line-height: 1.65; }

.db-stage {
  display: block;
  margin-top: var(--sp-3);
  padding: var(--sp-5) var(--sp-4);
  background: #faf9ff;
  border: 1px solid #ece8ff;
  border-radius: var(--sp-radius-md);
}
.db-outwrap { display: block; margin-top: var(--sp-3); }

.db-codewrap { display: block; margin-top: var(--sp-3); border-radius: var(--sp-radius-md); overflow: hidden; background: #1b1a22; }
.db-codehead {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--sp-2);
  padding: 9px var(--sp-3);
  background: #232230;
  border-bottom: 1px solid #2f2e3d;
}
.db-dots { display: flex; flex-direction: row; gap: 5px; flex-shrink: 0; }
.db-dot { width: 9px; height: 9px; border-radius: 50%; display: block; }
.db-dot-r { background: #ff5f57; }
.db-dot-y { background: #febc2e; }
.db-dot-g { background: #28c840; }
.db-codetag { display: block; flex: 1; font-size: 11px; font-family: var(--sp-mono); color: #8b8a9a; }
.db-codetoggle { display: block; font-size: 11px; color: var(--sp-brand-ink); font-weight: 600; }
.db-code { display: block; padding: var(--sp-3); }
.db-code-t {
  display: block;
  font-family: var(--sp-mono);
  font-size: 12px;
  line-height: 1.75;
  color: #d7d6e0;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
