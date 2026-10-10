<!-- src/pages/index.vue —— 首页（路由页面：编译期由 gen-routes 扫描注册，写入 router/auto-routes.ts）

     设计基准：与仓库 css-conformance（全端对齐验收项目）同一套写法——
       · 原始标签（div / h1 / p / button），不依赖内置组件；
       · 跨端一致性靠：静态 class（编译期折叠到各端节点）+ 设计令牌
         （src/styles/global.css 的 :root，App 端编译期展开）+ 满宽页根。
     » 本文件就是「一份标准 Vue 源码 → 多端真实渲染」的最小样例，可直接改成你的页面。 -->
<route>
{
  "meta": {
    "title": "首页",
    "isTab": true
  }
}
</route>

<script setup lang="ts">
import { ref } from 'vue'

// 唯一的动态状态：交互演示的计数。
// ★点击实时更新（App 端：内联动作 `@click="count++"` 与方法引用 `@click="handleTap"` 都支持；
//   见 packages/compiler/src/vapor/events.ts——方法体在编译期降级为动作表）。
const count = ref(0)
</script>

<template>
  <div class="page">
    <!-- ① 品牌区 -->
    <div class="hero">
      <div class="badge">PROTEUS</div>
      <h1 class="hero-title">一次编写，多端运行</h1>
      <p class="hero-sub">一份标准 Vue 源码，编译到小程序与 App 全端。</p>
    </div>

    <!-- ② 关键数字 -->
    <div class="stats">
      <div class="stat">
        <div class="stat-value">5</div>
        <div class="stat-label">目标端</div>
      </div>
      <div class="stat">
        <div class="stat-value">1</div>
        <div class="stat-label">份源码</div>
      </div>
      <div class="stat">
        <div class="stat-value">0</div>
        <div class="stat-label">条件编译</div>
      </div>
    </div>

    <!-- ③ 交互演示（验证响应式多端一致） -->
    <h2 class="section-title">交互演示</h2>
    <div class="card">
      <p class="card-desc">点一下，计数实时更新 —— 同一份逻辑在 Web / 小程序 / App 表现一致。</p>
      <button class="btn" @click="count++">点我 +1</button>
      <div class="counter">已点击 {{ count }} 次</div>
    </div>

    <!-- ④ 下一步 -->
    <h2 class="section-title">下一步</h2>
    <div class="card step">
      <div class="step-title">配置目标端</div>
      <p class="step-desc">在 proteus.config.ts 里设置小程序 AppID 与 App 包名。</p>
    </div>
    <div class="card step">
      <div class="step-title">换成你的界面</div>
      <p class="step-desc">本页就是普通 Vue SFC —— 直接改 template 与 style 即可。</p>
    </div>
    <div class="card step">
      <div class="step-title">构建到各端</div>
      <p class="step-desc">npm run build:mp / build:android / build:ios / build:harmony。</p>
    </div>
  </div>
</template>

<style>
/* 页面级样式：静态 class + 设计令牌（var(--x) 指向 global.css 的 :root）。
   编译期折叠到各端节点（App 端 var() 展开为具体值）——四端一致。
   不使用 :hover / 伪类等 App 端尚不支持的选择器。
   ↓↓↓ 换成你的品牌色 / 主题：改 src/styles/global.css 的 :root 即可。 */

.hero {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 8px 0 4px;
}

.badge {
  display: block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--brand);
  background-color: var(--brand-soft);
  border-radius: 6px;
  padding: 4px 8px;
}

.hero-title {
  display: block;
  font-size: 28px;
  font-weight: 800;
  line-height: 1.3;
  color: var(--text);
  margin: 14px 0 0;
}

.hero-sub {
  display: block;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-2);
  margin: 8px 0 0;
}

.stats {
  display: flex;
  flex-direction: row;
  gap: 12px;
  margin-top: 20px;
}

.stat {
  flex: 1;
  background-color: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px 8px;
}

.stat-value {
  display: block;
  font-size: 24px;
  font-weight: 800;
  color: var(--brand);
  text-align: center;
}

.stat-label {
  display: block;
  font-size: 12px;
  color: var(--text-3);
  text-align: center;
  margin-top: 4px;
}

.card-desc {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-2);
  margin: 0 0 12px;
}

.btn {
  display: block;
  font-size: 16px;
  font-weight: 600;
  color: #ffffff;
  background-color: var(--brand);
  border-radius: 12px;
  padding: 13px 20px;
  text-align: center;
  width: 100%;
}

.counter {
  font-size: 13px;
  color: var(--text-3);
  text-align: center;
  margin-top: 12px;
}

.step {
  margin-bottom: 10px;
}

.step-title {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.step-desc {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-2);
  margin: 4px 0 0;
}
</style>
