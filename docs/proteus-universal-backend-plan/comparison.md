# Comparison: 小程序 API 映射 vs 语义 IR

> 对外"降维打击"话术素材，建议同步进 `proteus-positioning-v3.md` FAQ。

---

## 1. 世界观对比

| | 传统框架（uni-app / Taro / Rax） | **Proteus** |
|--|----------------------------------|-------------|
| 核心思路 | **API 翻译**：小程序 API = 标准 | **语义收敛**：框架 IR = 标准 |
| "标准"归属 | **微信定义**的小程序 API | **Proteus 自己定义**的语义层 |
| 跨端方式 | 条件编译 `#ifdef` + 映射表 | **SPI + conformance test** |
| 新端扩展 | 重写映射表（量大、易漏） | **实现 ~15 方法 + 跑 test** |
| 缺失能力 | **运行时才发现**（崩溃/空返回） | **编译期 capabilities 报错** |
| API 风格 | 跟随微信（回调、无类型） | **框架定义（Promise、全类型）** |
| 版本绑定 | 跟着微信 API 版本走 | **框架独立演进** |
| 组合能力 | 开发者手写 ifdef | **语义层组合，`@conditional` 降级** |
| 端差异处理 | 隐藏 → 运行时爆炸 | **显式 Tier + 编译期裁剪** |
| 调试 | 翻译后代码，报错在原生层 | **IR 层校验，错误在语义层** |

---

## 2. 本质分水岭

**传统框架的隐含假设**：

> "小程序是未来，全平台向小程序靠拢。"

2018 年成立（微信一家独大）；2026 年已不成立：
- 鸿蒙来了，不认小程序 API
- 车机/手表/TV 来了，无"小程序"概念
- Flutter/Skia 来了，不认 Web 标准
- AI Agent 来了，需要操作 IR，不是 `wx.xxx`

**Proteus 的隐含假设**：

> "没有任何单一平台的 API 应成为标准；真正的标准是框架自己的语义 IR，各端来适配我。"

---

## 3. 代码对比：同一需求，两种世界观

### 3.1 调用相机

**传统（uni-app 风格）**：

```js
// API 形状由微信定，各端"尽力映射"
uni.chooseImage({
  count: 1,
  sizeType: ['original', 'compressed'],
  sourceType: ['album', 'camera'],
  success: (res) => { /* 回调 */ },
  fail: (err) => { /* 某端可能直接 fail */ }
})
```

**Proteus**：

```ts
// 语义接口由框架定（Promise + 类型安全）
const result = await native.pickPhoto({
  maxCount: 1,
  quality: 'high',
  source: 'album-or-camera'
})
// 某端不支持？编译期就告诉你，不是运行时崩
```

### 3.2 处理端差异

**传统**：

```js
// 开发者手写一堆 ifdef
// #ifdef MP-WEIXIN
wx.scanCode({ ... })
// #endif
// #ifdef APP-PLUS
plus.barcode.scan({ ... })
// #endif
// #ifdef H5
// 自己实现 WebRTC 版本...
// #endif
```

**Proteus**：

```vue
<!-- 语义层降级，Compiler 按端裁剪 -->
<p-conditional capability="scanQR">
  <template #default><p-button @click="scan">扫码</p-button></template>
  <template #fallback><p-input placeholder="手动输入" /></template>
</p-conditional>
```

---

## 4. 一句话总结

> **传统框架说："小程序是中心，大家来适配小程序。"**
>
> **Proteus 说："没有中心，只有语义；任何端只要实现 Backend，就是一等公民。"**

---

## 5. 对标定位（positioning 用）

建议在 `proteus-positioning-v3.md` §6 对标矩阵新增：

| 维度 | uni-app / Taro | Flutter | RN | **Proteus** |
|------|---------------|---------|-----|-------------|
| 跨端哲学 | 小程序 API 映射 | 自绘统一 | 原生映射 | **语义 IR + 任意 Backend** |
| "标准"归属 | 微信 | Flutter 自身 | RN 自身 | **框架语义层** |
| 新端成本 | 高（重写映射） | 中（Embedder） | 高（Native Module） | **低（~15 方法 + test）** |
| 端差异处理 | 运行时 | 编译期（部分） | 运行时 | **编译期 + Tier + 降级** |
| 任意端 | ✗（以小程序为中心） | △（需 Embedder） | △（需 Native Module） | **✓（形式化证明）** |
