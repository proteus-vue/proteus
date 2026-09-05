// website/src/router.ts —— 官网路由（vue-router）
// ★dogfooding 诚实边界：@proteus-vue/router 的路由模型面向「编译期页面表 + 按端 codegen（已接线 Web / 小程序）」
//   （gen-routes 页面路由 / 小程序页面栈）；官网为纯 Web SPA + 动态文档段（/docs/:slug），
//   本批用 vue-router 承载——该差距正是 website-plan §14 预期的「写官网回填 Router plan」信号，
//   替换列入 B4+ 评估（W-1 dogfooding 的可审计缺口）。
// ★#390ii 文档四区：指南 /docs/:slug · 组件 /docs/component/:slug · 能力 /docs/capability/:slug · 柔性系统 /docs/system/:slug
import { createRouter, createWebHistory } from 'vue-router'
import Home from './pages/Home.vue'
import DocsPage from './pages/DocsPage.vue'
import Playground from './pages/Playground.vue'
import MultiDevice from './pages/MultiDevice.vue'

export const router = createRouter({
  // ★GitHub Pages 子路径部署：base 跟随 vite（import.meta.env.BASE_URL——Vercel 根路径 = '/' 行为不变）
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: Home },
    { path: '/playground', name: 'playground', component: Playground },
    { path: '/multi-device', name: 'multidev', component: MultiDevice },
    { path: '/docs', redirect: '/docs/01-intro' },
    { path: '/docs/:slug', name: 'guide', component: DocsPage },
    { path: '/docs/component/:slug', name: 'doc-component', component: DocsPage },
    { path: '/docs/capability/:slug', name: 'doc-capability', component: DocsPage },
    { path: '/docs/system/:slug', name: 'doc-system', component: DocsPage },
    { path: '/docs/primitives/:slug', name: 'doc-primitives', component: DocsPage },
    { path: '/docs/framework/:slug', name: 'doc-framework', component: DocsPage },
    { path: '/docs/plugin/:slug', name: 'doc-plugin', component: DocsPage },
    { path: '/docs/reference/:slug', name: 'doc-reference', component: DocsPage },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  // ★切页自动回顶——侧边栏/上下篇点击后从新页顶部阅读；后退/前进保留浏览器原位
  scrollBehavior(_to, _from, savedPosition) {
    return savedPosition ?? { top: 0 }
  },
})
