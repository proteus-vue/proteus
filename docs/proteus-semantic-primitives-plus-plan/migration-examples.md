# 语义优先迁移示例（Migration by Example）

> 配合 G-31 migration.md。本节给出 **逐场景对照**，证明「API 更好」而非「只是改名」。

---

## 1. 组件迁移

### 1.1 `<scroll-view>` → `<p-scroll>` / `<p-virtual-list>`

```html
<!-- 旧：小程序 -->
<scroll-view scroll-x scroll-with-animation enable-flex>
  <view wx:for="{{list}}" class="item">{{item}}</view>
</scroll-view>

<!-- 新：Proteus -->
<p-scroll axis="x" :paging="false">
  <p-stack direction="row">
    <p-box v-for="item in list" :key="item">{{ item }}</p-box>
  </p-stack>
</p-scroll>

<!-- 长列表：虚拟化 -->
<p-virtual-list :items="list" :item-size="'auto'">
  <template #default="{ item }">
    <p-box>{{ item }}</p-box>
  </template>
</p-virtual-list>
```

**改进**：
- `scroll-x` → `axis="x"`（约束：轴向）
- `scroll-with-animation` → 默认行为（Backend 自选动画）
- `enable-flex` → 消除（布局由 `<p-stack>` 表达）
- 新增虚拟化：`<p-virtual-list>` 内置，无需手动回收

### 1.2 `<swiper>` → `<p-stack snap loop>`

```html
<!-- 旧：小程序 -->
<swiper indicator-dots autoplay interval="3000">
  <swiper-item wx:for="{{banners}}"><image src="{{item}}"/></swiper-item>
</swiper>

<!-- 新：Proteus -->
<p-stack direction="row" snap="mandatory" :loop="true" :autoplay="3000">
  <p-box v-for="banner in banners" :key="banner">
    <p-image :src="banner" fit="cover" />
  </p-box>
</p-stack>
```

**改进**：`swiper` 不是语义——它是「一维排列 + 吸附 + 循环」的组合。Proteus 用布局原语表达，**swiper 被消灭**。

### 1.3 `<movable-view>` → `<p-draggable>`

```html
<!-- 旧 -->
<movable-area>
  <movable-view direction="all" inertia>...</movable-view>
</movable-area>

<!-- 新 -->
<p-scrollable>
  <p-draggable :axis="'both'" :inertia="true">...</p-draggable>
</p-scrollable>
```

### 1.4 `<picker>` → `<p-picker>` / `<p-select>`

```html
<!-- 旧 -->
<picker mode="date" value="{{date}}" start="2020-01-01" end="2030-12-31" bindchange="onChange">
  <view>{{date}}</view>
</picker>

<!-- 新 -->
<p-picker mode="date" v-model="date" :start="'2020-01-01'" :end="'2030-12-31'">
  <template #trigger>
    <p-box>{{ date }}</p-box>
  </template>
</p-picker>

<!-- 通用选择（非原生）→ useSelect -->
<p-select v-model="value" :options="options" multiple searchable />
```

**改进**：`mode` 区分「原生日期选择」vs「通用下拉」，后者无需原生弹层，Web 端也能用。

---

## 2. API 迁移

### 2.1 网络请求

```js
// 旧：小程序
wx.request({
  url: 'https://api.example.com/data',
  method: 'POST',
  data: { foo: 'bar' },
  success: (res) => { this.setData({ data: res.data }) },
  fail: (err) => { console.error(err) }
})

// 新：Proteus（Composition API + 响应式）
const { data, error, loading, execute } = useFetch('/data', {
  method: 'POST',
  data: { foo: 'bar' }
})

// 自动触发
await execute()

// 模板自动响应
// <p-text v-if="loading">加载中...</p-text>
// <p-text v-else-if="error">{{ error.message }}</p-text>
// <p-text v-else>{{ data }}</p-text>
```

**改进**：
- 回调 → `Promise<Result<T>>`
- `this.setData` → Vue 响应式（`data` ref 自动更新 DOM）
- 全局拦截器：`useFetch.global.beforeEach`
- 缓存/重试：`cache` / `retry` 选项

### 2.2 路由

```js
// 旧：小程序
wx.navigateTo({ url: '/pages/detail?id=1&name=foo' })

// 新：Proteus（类型安全 + 参数校验）
router.push({ name: 'detail', params: { id: 1, name: 'foo' } })

// 目标页
const { id, name } = usePageParam<{ id: number; name: string }>()
```

**改进**：
- URL 字符串 → 命名路由 + 参数对象
- 无类型 → 泛型参数校验
- 全局守卫：`router.beforeEach`

### 2.3 扫码

```js
// 旧：小程序
wx.scanCode({
  scanType: ['qrCode'],
  success: (res) => { console.log(res.result) },
  fail: () => {}
})

// 新：Proteus
const { scanQR } = useQRCode()
const result = await scanQR({ types: ['qr'] })
if (result.isOk()) {
  console.log(result.value)  // 类型：string
}
```

**改进**：
- 回调 → `Result<T>`
- `scanType` → `types`（更符合语义）
- 统一收敛：`useQRCode()`（生成/识别都在这里）

### 2.4 定位

```js
// 旧：小程序
wx.getLocation({
  type: 'gcj02',
  success: (res) => { console.log(res.latitude, res.longitude) }
})

// 新：Proteus
const { getCurrent } = useLocation()
const coords = await getCurrent({ type: 'gcj02' })
// coords: { latitude: number; longitude: number; accuracy: number }
```

### 2.5 分享

```js
// 旧：小程序（需在 Page 定义 onShareAppMessage）
Page({
  onShareAppMessage() {
    return { title: 'xxx', path: '/pages/index' }
  }
})

// 新：Proteus（Composition API，逻辑集中）
useShare().onShare(() => ({
  title: 'xxx',
  path: '/',
  query: { from: 'share' }
}))

// 主动分享
await useShare().share({ title: 'xxx', imageUrl: '...' })
```

**改进**：无需散落在 `Page` 选项，逻辑与组件共存。

### 2.6 本地存储

```js
// 旧：小程序（同步 API，无响应式）
wx.setStorageSync('token', 'abc')
const token = wx.getStorageSync('token')

// 新：Proteus（响应式，自动持久化）
const token = useStorage().use<string>('token', '')
token.value = 'abc'  // 自动持久化

// 或命令式
useStorage().set('token', 'abc')
```

**改进**：
- 同步 → 响应式（`Ref<string>`）
- 赋值即持久化，无需手动 `set`
- 支持 `secure` 存储区（iOS Keychain / Android Keystore）

---

## 3. 手势迁移

```html
<!-- 旧：小程序（事件名暴露平台细节） -->
<view bindtap="onTap" bindlongpress="onLong" bindswipe="onSwipe">...</view>

<!-- 新：Proteus（声明式约束） -->
<p-box
  v-gesture:tap="onTap"
  v-gesture:longpress="{ duration: 500 }"
  v-gesture:swipe="{ direction: 'left', threshold: 50 }"
>
  ...
</p-box>
```

**改进**：
- `bindtap` → `v-gesture:tap`（Vue 指令风格，统一前缀）
- `bindlongpress` → `v-gesture:longpress`（参数化）
- `bindswipe` → `v-gesture:swipe`（约束：方向 + 阈值）
- 复合手势：`useGesture({ recognizers: [...] })`

---

## 4. 生命周期迁移

```js
// 旧：小程序
App({
  onLaunch(options) { console.log(options) },
  onShow() {},
  onHide() {},
  onError(err) { console.error(err) }
})

Page({
  onLoad(query) { console.log(query) },
  onReady() {},
  onUnload() {}
})

// 新：Proteus（Composable，逻辑组合）
useAppLifecycle({
  onLaunch: (opts) => console.log(opts),
  onShow: () => {},
  onHide: () => {},
  onError: (err) => console.error(err)
})

usePageLifecycle({
  onLoad: (query) => console.log(query),
  onReady: () => {},
  onUnload: () => {}
})
```

**改进**：
- 选项对象 → 函数调用（可组合、可抽离）
- 逻辑复用：`usePageLifecycle` 可在任意 setup 调用

---

## 5. 私有能力收敛

```js
// 旧：小程序（微信私有 API 直接调用）
wx.requestWeChatPay({ ... })
wx.navigateToMiniProgram({ appId: '...' })

// 新：Proteus（收敛到 useMiniProgram）
const mp = useMiniProgram()
await mp.pay({ ... })           // 非小程序 Backend → Err
await mp.navigate({ appId: '...' })
```

**改进**：
- 显式标记平台私有，业务代码一眼可见「这段不可跨端」
- 非小程序 Backend 返回 `Err('miniprogram.only')`，可 `@conditional` 降级

---

## 6. codemod 规则（自动迁移）

`@proteus/compat-miniprogram` 提供 codemod：

```bash
proteus migrate:miniprogram ./src --dry-run
```

**转换规则**（部分）：

| 规则 | 转换 |
|------|------|
| `wx.request` → `useFetch` | AST 重写 + 回调转 await |
| `<scroll-view>` → `<p-scroll>` | 属性映射 + 子节点包裹 `<p-stack>` |
| `<swiper>` → `<p-stack snap loop>` | 结构转换 |
| `wx.navigateTo` → `router.push` | URL 参数解析为对象 |
| `bindtap` → `v-gesture:tap` | 事件名映射 |
| `wx.getStorageSync` → `useStorage().use` | 同步 → 响应式 |
| `App({...})` / `Page({...})` → `useXxxLifecycle` | 选项 → Composable |

**目标**：自动迁移 **70-90%**，剩余（私有能力、复杂逻辑）由 AI Agent（G-23）辅助。

---

## 7. 迁移前后对比（同一业务）

**小程序版**（约 120 行）：
```html
<!-- 页面 + 逻辑分散在 wxml/js/json/wxss 4 文件 -->
<view class="container">
  <scroll-view scroll-x>
    <view wx:for="{{banners}}" class="banner"><image src="{{item}}"/></view>
  </scroll-view>
  <view wx:for="{{list}}" class="item" bindtap="onItemTap">{{item.title}}</view>
</view>
```

```js
Page({
  data: { banners: [], list: [] },
  onLoad() {
    wx.request({
      url: '/api/home',
      success: (res) => this.setData({ banners: res.data.banners, list: res.data.list })
    })
  },
  onItemTap(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/detail?id=${id}` })
  }
})
```

**Proteus 版**（约 60 行，单文件）：
```vue
<script setup>
const { data, execute } = useFetch('/api/home')
await execute()

const onItemTap = (id) => router.push({ name: 'detail', params: { id } })
</script>

<template>
  <p-box class="container">
    <p-stack direction="row" snap="mandatory">
      <p-box v-for="banner in data.banners" :key="banner">
        <p-image :src="banner" fit="cover" />
      </p-box>
    </p-stack>
    <p-box v-for="item in data.list" :key="item" @click="onItemTap(item.id)">
      {{ item.title }}
    </p-box>
  </p-box>
</template>
```

**改进**：
- 4 文件 → 1 文件（SFC）
- 120 行 → 60 行（逻辑集中）
- 回调 → await
- URL 拼接 → 类型安全路由
- 响应式：`data` ref 自动驱动视图
