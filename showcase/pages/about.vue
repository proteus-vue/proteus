<!-- showcase/pages/about.vue —— 关于 Proteus（定位 / 架构 / 设计原则） -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../components/page-shell/index.vue'
import BrandCube from '../components/brand-cube/index.vue'

const principles = ref([
  { n: '#1', t: '单一事实源', d: 'SFC + 路由表 + Design Token 收敛为唯一来源' },
  { n: '#2', t: '语义收敛', d: '业务代码只与语义层对话，平台差异下沉为后端' },
  { n: '#3', t: '编译期优先', d: '能编译期发现的问题绝不留到运行时' },
  { n: '#4', t: '可插拔后端', d: '渲染底座 / 编译器 / 宿主容器 / 执行载体皆可替换' },
  { n: '#5', t: '诚实边界', d: '平台不支持的显式降级，不伪造等价' },
])

const layers = ref([
  { name: '业务源码层', d: '标准 Vue SFC —— 开发者唯一需要写的', color: 'var(--sp-bk-vue)' },
  { name: '语义内核层', d: '语义原语 + CompilerIR + 能力 Hook', color: 'var(--sp-brand)' },
  { name: '后端实现层', d: '渲染后端 / 编译后端 / 原生后端 / 执行载体', color: 'var(--sp-bk-skia)' },
  { name: '宿主平台层', d: '小程序 / Web / iOS / Android / Flutter / 鸿蒙', color: 'var(--sp-bk-mp)' },
])
</script>

<template>
  <page-shell title="关于 Proteus" subtitle="语义收敛的跨端应用框架">
    <p-view class="intro">
      <brand-cube :size="52" />
      <p-text class="intro-slogan">One semantic model. Any render engine. Zero native glue.</p-text>
      <p-text class="intro-desc">一套语义内核，任意渲染引擎，任意原生能力。业务代码只和语义层对话——渲染底座、编译器、宿主容器、执行载体全部可插拔。</p-text>
    </p-view>

    <p-text class="section">四层架构</p-text>
    <p-view class="layer" v-for="(l, i) in layers" :key="l.name">
      <p-view class="l-bar" :style="'background:' + l.color" />
      <p-view class="l-main">
        <p-text class="l-name">{{ i + 1 }} · {{ l.name }}</p-text>
        <p-text class="l-desc">{{ l.d }}</p-text>
      </p-view>
    </p-view>

    <p-text class="section">设计原则</p-text>
    <p-view class="prin" v-for="p in principles" :key="p.n">
      <p-text class="prin-n">{{ p.n }}</p-text>
      <p-view class="prin-main">
        <p-text class="prin-t">{{ p.t }}</p-text>
        <p-text class="prin-d">{{ p.d }}</p-text>
      </p-view>
    </p-view>
  </page-shell>
</template>

<style scoped>
.intro {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  background: var(--sp-surface);
  border: 1px solid var(--sp-line);
  border-radius: var(--sp-radius-lg);
  padding: var(--sp-6) var(--sp-4);
  box-shadow: var(--sp-shadow-sm);
}
.intro-slogan {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--sp-brand-ink);
  margin: var(--sp-3) 0 0;
}
.intro-desc {
  display: block;
  font-size: 13px;
  color: var(--sp-text-2);
  line-height: 1.7;
  margin: var(--sp-2) 0 0;
  text-align: left;
}
.section {
  display: block;
  font-size: 16px;
  font-weight: 700;
  margin: var(--sp-5) 0 var(--sp-3);
  color: var(--sp-text);
}
.layer {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--sp-3);
  background: var(--sp-surface);
  border: 1px solid var(--sp-line);
  border-radius: var(--sp-radius-md);
  padding: var(--sp-3) var(--sp-4);
  margin-bottom: var(--sp-2);
}
.l-bar { width: 4px; height: 34px; border-radius: 2px; flex-shrink: 0; }
.l-main { flex: 1; min-width: 0; display: block; }
.l-name { display: block; font-size: 14px; font-weight: 600; color: var(--sp-text); }
.l-desc { display: block; font-size: 12px; color: var(--sp-text-3); margin-top: 2px; }
.prin {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: var(--sp-3);
  background: var(--sp-surface);
  border: 1px solid var(--sp-line);
  border-radius: var(--sp-radius-md);
  padding: var(--sp-3) var(--sp-4);
  margin-bottom: var(--sp-2);
}
.prin-n {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--sp-brand-ink);
  background: var(--sp-brand-soft);
  border-radius: var(--sp-radius-sm);
  padding: 2px 7px;
}
.prin-main { flex: 1; min-width: 0; display: block; }
.prin-t { display: block; font-size: 14px; font-weight: 600; color: var(--sp-text); }
.prin-d { display: block; font-size: 12px; color: var(--sp-text-3); margin-top: 2px; line-height: 1.6; }
</style>
