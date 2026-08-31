# @proteus-vue/web

Proteus 小程序语义 Web 模拟层（14-mp-first-semantics）——以小程序组件/API 为标准，Web 端完全对齐：模板写小程序标签（`view`/`text`/`button`/…）+ `wx.*` API 即双端可用。

## 导出

| API | 说明 |
|-----|------|
| `installWebPlatform(app)` | **聚合安装**：注册框架内置组件（`@proteus-vue/built-in-components` 的 `proteus-*`）+ `wx.*` API 模拟——main.ts 一行接入 |
| `wx` / `installWxApi()` | wx API 模拟层（`wx.request` / `wx.showToast` / `wx.getStorageSync` / `wx.navigateTo` / `wx.getSystemInfoSync` 等，内存实现 + 事件驱动） |
| `installBuiltInComponents` / `OPEN_TYPE_EVENTS` / `OPEN_TYPE_STATUS` / `BUILT_IN_TAGS` | 内置组件 re-export（向后兼容；新消费方建议直接 `@proteus-vue/built-in-components`） |
| `WebView` / `WebText` / `WebButton` / `WebInput` / `WebImage` / `WebScrollView` / `WebTextarea` / `WebSwitch` / `WebSlider` / `WebIcon` / `WebProgress` / `WebNavigator` / `WebPicker` | 内置组件实现 re-export |

## 使用

```ts
// main.ts —— 一行接入，双端语义一致
import { createApp } from 'vue'
import App from './App.vue'
import { installWebPlatform } from '@proteus-vue/web'
import '@proteus-vue/built-in-components/style.css' // 对齐小程序默认外观

const app = createApp(App)
installWebPlatform(app)
app.mount('#app')
```

```vue
<!-- 模板直接写小程序标签 -->
<template>
  <view class="card">
    <text>{{ title }}</text>
    <button @click="onTap">点击</button>
  </view>
</template>
```

```ts
// 业务直接使用 wx.*（过渡期）——收口后经 @proteus-vue/api PlatformAPI
wx.showToast({ title: '已保存' })
```

## 设计要点

- **以小程序为标准**：组件语义（属性/事件）与 wx API 行为对齐小程序实现，Web 端只是"模拟器"
- **拆包后**：内置组件本体在 `@proteus-vue/built-in-components`，本包保留 wx API 模拟 + 聚合安装 + 向后兼容 re-export
