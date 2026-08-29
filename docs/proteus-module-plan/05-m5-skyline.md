# M5 Skyline 分包方案

## 痛点：小程序单文件 + 无模块系统

小程序产物是 WXML+JS+WXSS+JSON 四件套，**没有 ES Module**。跨模块引用靠：
- `require` 同步加载（主包/分包内）
- 全局注册（`getApp().xxx`）
- 事件总线

## 方案：分包 = 模块边界

利用微信小程序的 **subPackages** 机制，把每个业务模块映射为一个分包。

### 映射规则

| Module 契约 | Skyline 产物 |
|------|------|
| `name: 'trade'` | `subPackages: [{ root: 'trade', pages: [...] }]` |
| `dependencies` | 分包依赖声明（主包自动包含） |
| `chunk: 'trade'` | 分包名 = chunk 名（对齐 Router M7.1） |
| `preload: ['user']` | `preloadRule: { 'trade': { network: 'all', packages: ['user'] } }` |

### 自动生成 app.json

```json
{
  "pages": ["pages/index/index"],
  "subPackages": [
    {
      "root": "modules/user",
      "name": "user",
      "pages": ["pages/Profile", "pages/Settings"]
    },
    {
      "root": "modules/trade",
      "name": "trade",
      "pages": ["pages/OrderList", "pages/OrderDetail"],
      "independent": false,
      "dependencies": ["user"]
    }
  ],
  "preloadRule": {
    "modules/trade/*": {
      "network": "all",
      "packages": ["user"]
    }
  }
}
```

### 模块桶（Module Barrel）

每个分包根目录生成 `module.js` — 作为模块入口单例：

```js
// modules/trade/module.js
const { createTradeService } = require('./services/trade-service')
const { tradeStore } = require('./stores/trade-store')

module.exports = {
  name: 'trade',
  version: '1.2.0',
  services: { tradeService: createTradeService() },
  stores: { tradeStore },
  // 生命周期（对齐 M2）
  onInit() { ... },
  onDestroy() { ... },
}
```

### 运行时获取模块

```ts
// 编译期转换
const trade = await ms.getModule('trade')
// ↓ 转为
const trade = require('./modules/trade/module.js')
```

由于 `require` 同步且小程序缓存模块，**多次调用返回同一实例**（单例保证，对齐 M2）。

## 共享依赖去重

公共库（vue/runtime、pinia、公共工具）放 **主包 `common/`**，分包通过相对路径 `require('../../common/vue')` 引用 — 小程序 `require` 天然去重（同一路径只加载一次）。

`proteus audit module` 检测重复打包：若发现两个分包各自包含 vue → 报错提示移到 common。

## 限制与约束

- **分包不能引用其他分包的页面**（微信限制）→ 模块间只能通过 ModuleBoundary（事件/服务接口）
- **分包大小限制**（单个 ≤ 2MB，总 ≤ 20MB）→ M7 加体积监控
- **独立分包**（`independent: true`）不能依赖主包 → 仅用于完全独立的子应用

## 对齐 Router M7.1

Router 的 `chunk` 字段与 Module 的 `chunk` **必须一致**：

```ts
// Router: pages/trade/Detail.vue 的 <route>
{ chunk: 'trade' }
// Module: proteus-module.config.ts
{ name: 'trade', chunk: 'trade' }
// → 编译期校验：两者一致，否则报错
```

## 测试

- subPackages 生成验证（fixture → 实际 app.json diff）
- preloadRule 生成验证
- 模块桶单例验证（两次 require 同一对象）
- 跨分包引用检测（违反 → 报错）
- 体积超限检测
