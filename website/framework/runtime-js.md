---
title: JavaScript 支持情况与运行环境
order: 14
group: 运行期
---

# JavaScript 支持情况与运行环境

小程序逻辑层是**独立 JS 运行时**：没有 DOM/BOM，模块系统与浏览器不同。业务代码要跑在两端，需要知道边界在哪。

## 产物口径：ES5 安全

编译器生成的所有 JS 产物规避 `??` / `?.` / 数组解构 / 对象展开（显式 null 检查三元、索引循环 `Object.keys`、直接属性赋值）。

> 为什么：微信开发者工具把页面 JS 转 ES5 时依赖 babel helper 模块，helper 不在包内会报错；真机预览直接报语法错误（决策 #32/#36 实证）。产物由 grep 扫描保证零残留。

**对业务的含义**：你写的 TS/ESNext 源码经编译转换，但**函数体内的复杂语法**（as 断言/箭头参数标注/非空断言）要守[组件开发纪律](/docs/framework/components-develop)——编译器 MVP 限制逐条登记在规则清单。

## 无 DOM / 无 BOM

- **禁止** `document.*` / `window.*`（组件审计 no-platform-api 硬卡口；探测走 `globalThis` 可选链）
- DOM 操作 = 视图层的事，由渲染后端完成
- BOM 类信息（屏幕/窗口）走平台能力 Hook（useScreen 等），不读全局

## 模块化

| 形态 | 支持 | 产物 |
|---|---|---|
| 相对路径 import | ✅ 编译为共享模块 + require 转换 | `_proteus/<module>.js` 独立产物 |
| npm 纯逻辑包 | ✅ 打进共享模块（无 DOM 依赖） | 同上 |
| 依赖 DOM/BOM 的包 | ❌ 逻辑层无法运行 | — |

> 无法解析的 import 编译期显式警告（反黑盒：不再静默剥离）。

## 全局对象

| 对象 | 来源 | 用途 |
|---|---|---|
| `getApp()` | 宿主 | 应用实例（provide 注册表挂载点） |
| `getCurrentPages()` | 宿主 | 页面栈（provide 命名空间解析） |
| `wx` | 平台 | 经 `@proteus-vue/api` 桥归一，业务零直调（CMP007 api-check 门禁） |

## 下一步

- [网络](/docs/framework/network)
