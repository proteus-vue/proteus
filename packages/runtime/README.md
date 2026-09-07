# @proteus-vue/runtime

Proteus 运行时——setData 桥接（批量 + 深层 diff）/ 页面生命周期 / store 桥 / Pinia 多端工厂 / 应用生命周期编排 / app 骨架。

## 导出

| API | 说明 |
|-----|------|
| `createPage` / `createComponent` / `onLoad` / `onReady` / `onUnload` | 页面/组件生命周期（MP 编译期映射 `Page()`/`Component()`，Web 端对应 Vue 钩子） |
| `setDataBridge` | **setData 桥接**：批量合并 + 深层 diff（对齐小程序 setData 语义，Web 端模拟） |
| `createStore` / `connectPageStore` | 轻量 store 桥（页面数据 → 组件数据流） |
| `createWebPinia` / `createMpPinia` / `createAppPinia` / `createSsrPinia` | **Pinia 多端工厂**：平台标记注入 + 持久化（Web LocalStorage / MP storage / SSR 内存） |
| `createPersistedStatePlugin` / `persisted` / `createPersistence` | Pinia 持久化（社区兼容 + 自研轻量两层） |
| `registerProvide` / `readInject` / `subscribeProvide` / `provideCount` / `nextPageId` / `destroyPage` | 跨页面 provide/inject 通道 |
| `defineApp` / `LifecycleOrchestrator` / `PHASE_ORDER` | **应用生命周期编排**：`bootstrap → coreReady → navigationReady → interactive` 阶段化启动 + 超时降级 + trace（lifecycle-plan B1/B2） |
| `setDataBridge` 等 | 见上 |

## 子路径

| 子路径 | 说明 |
|--------|------|
| `@proteus-vue/runtime/style-safety` | 样式安全（平台样式差异防护） |

## 使用

```ts
import { createWebPinia, defineApp } from '@proteus-vue/runtime'
import { createApp } from 'vue'
import App from './App.vue'

defineApp({
  bootstrap(ctx) { console.log('[lifecycle] bootstrap', ctx.platform) },
  async coreReady(ctx) {
    // 核心服务就绪（API 客户端 / token 刷新）
  },
  interactive() {
    const app = createApp(App)
    app.use(createWebPinia()).mount('#app')
  },
}).run({ launchType: 'cold' })
```

小程序端 `main.mp.ts` 走极简模式（插件直出 `app.js`，骨架自动生成），详见 examples。

## 设计要点

- **setData 桥接**是双端数据一致性的核心：批量合并减少通信次数，深层 diff 只传变化路径
- Pinia 持久化声明式（`persisted`），平台差异收敛在工厂内部
