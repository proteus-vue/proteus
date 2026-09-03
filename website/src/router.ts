// website/src/router.ts —— 官网路由（vue-router）
// ★dogfooding 诚实边界：@proteus-vue/router 的路由模型面向「编译期页面表 + 双端工程」
//   （gen-routes 页面路由 / 小程序页面栈）；官网为纯 Web SPA + 动态文档段（/docs/:slug），
//   本批用 vue-router 承载——该差距正是 website-plan §14 预期的「写官网回填 Router plan」信号，
//   替换列入 B4+ 评估（W-1 dogfooding 的可审计缺口）。
import { createRouter, createWebHistory } from 'vue-router'
import Home from './pages/Home.vue'
import Guide from './pages/Guide.vue'
import Playground from './pages/Playground.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: Home },
    { path: '/playground', name: 'playground', component: Playground },
    { path: '/docs', redirect: '/docs/intro' },
    { path: '/docs/:slug', name: 'guide', component: Guide },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
