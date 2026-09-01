// examples/main.ts —— Web 端入口（Web 原生、零转换：标准 Vue SPA + Pinia 多端适配工厂）
// ★pinia-plan M3：createWebPinia() 注入平台标记 + LocalStorage 持久化（player store 持久化声明自动生效）
// ★lifecycle-plan B1/B2：defineApp 阶段化启动（bootstrap → interactive，超时降级 + trace）
// ★devtools：一键接入（installProteusDevtools）——Vue DevTools 扩展（Timeline/Inspectors）+ 本地面板浮动窗口双通道
import { createApp } from 'vue'
import App from './App.vue'
import { createWebPinia, defineApp } from '@proteus-vue/runtime'
import { createApi } from '@proteus-vue/api'
// ★14-mp-first-semantics：小程序语义 Web 模拟层——注册 view/text/button/input/image 组件 + wx API（以小程序为标准）
import { installWebPlatform } from '@proteus-vue/web'
// 微信默认样式对齐层（button/input 等原生默认外观对齐小程序，双端视觉一致）
import '@proteus-vue/built-in-components/style.css'
// ★devtools：一键接入（TraceBus 单例 + Vue DevTools 插件 + store/组件追踪 + 本地面板挂载）
import { installProteusDevtools } from '@proteus-vue/devtools'
import '@proteus-vue/devtools/style.css'
import { getProteusTraceBus } from '@proteus-vue/devtools-runtime'
// ★vue-devtools-plan：App Config Inspector 数据源（config-demo 页面 init 后生效；未 init 时安全降级）
import { getConfig as getAppConfig, setConfig as setAppConfig } from '@proteus-vue/app-config'
// ★G-31 style-safety：运行时守卫（业务侧动态 :style 用 guard.patch 包裹 → Inspector 实时拦截记录）
import { createStyleGuard } from '@proteus-vue/style-safety'
import { routes } from './router/auto-routes'

// ★devtools：发射端同源——router/api/capability 共用 getProteusTraceBus 惰性单例
// ★enabled 在业务源码层控制：import.meta.env.DEV（vite 可靠注入：dev→true/build→false）|| __PROTEUS_DEBUG__（build 期 define 替换，PROTEUS_DEBUG=1 强制生产调试）
//   ⚠ 勿改用纯 __PROTEUS_DEBUG__ 运行时判断：vite 5.4 dev 模式 config.define 不替换源码（vite:define 跳过 dev），
//   无 import.meta.env.DEV 短路会导致 ReferenceError；build 产物两常量折叠 → setEnabled 调用 tree-shake 零开销
const traceBus = getProteusTraceBus()
if (import.meta.env.DEV || __PROTEUS_DEBUG__) traceBus.setEnabled(true)

// ★G-31 运行时 Validator：开发模式 loose（非法剔除+记录），生产 off 零开销
const styleGuard = createStyleGuard({ mode: 'loose' })

// ★api-plan B1：API 客户端初始化（lifecycle coreReady 阶段——业务零平台分支）
// ★devtools 打通：请求事件 → traceBus（面板 timeline/network 插件；bus 门控生产零开销）
const api = createApi({ baseURL: 'https://api.example.com', traceBus })

const emit = (source: 'lifecycle' | 'router' | 'api', phase: 'start' | 'end' | 'point', name: string): void => {
  traceBus.emit(source, phase, name)
}

// 阶段化启动：bootstrap 能力探测 → coreReady 核心服务 → navigationReady → interactive 可交互
// （Web 端零转换直跑；小程序端经编译期映射 App() 钩子）
defineApp({
  bootstrap(ctx) {
    emit('lifecycle', 'start', 'bootstrap')
    console.log('[lifecycle] bootstrap', ctx.platform)
  },
  async coreReady(ctx) {
    emit('lifecycle', 'end', 'bootstrap')
    emit('lifecycle', 'start', 'coreReady')
    // API 客户端就绪（真实业务在此做 token 刷新等）
    ctx.isMinimalMode === false && console.log('[lifecycle] coreReady api:', api !== undefined)
  },
  interactive() {
    emit('lifecycle', 'end', 'coreReady')
    emit('lifecycle', 'start', 'interactive')
    // ★小程序语义组件/API 注入（installWebPlatform：view/text/button/input/image + wx.*）
    const app = createApp(App)
    installWebPlatform(app)
    const pinia = createWebPinia()
    app.use(pinia).mount('#app')
    // ★devtools 一键接入：TraceBus 单例 + Vue DevTools（Timeline/Inspectors）+ store/组件追踪 + 本地面板浮动窗口
    installProteusDevtools(app, {
      pinia: pinia as never,
      getConfig: () => {
        try {
          return getAppConfig() as unknown as Record<string, unknown>
        } catch {
          return {}
        }
      },
      setConfig: (patch) => {
        try {
          setAppConfig(patch as never)
        } catch {
          // 未 initAppConfig：拒绝回写
        }
      },
      styleGuard,
      pages: { routes: routes.map((r) => ({ name: r.name, path: r.path, meta: r.meta, subPackage: r.subPackage })) },
      // ★远程查看（移动端/真机）：TraceBus → WS 上行 → 电脑浏览器 panel.html?ws=ws://host/proteus-panel 查看
      remote: true,
    })
    emit('lifecycle', 'end', 'interactive')
  },
}).run({ launchType: 'cold' })
