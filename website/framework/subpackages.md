---
title: 分包与按需注入
order: 32
group: 基础能力
---

# 分包与按需注入

小程序包体积是硬约束——分包与按需注入都由**编译期**自动处理，业务只做声明。

## 分包：配置即生效

`proteus.config.ts` 声明分包（name + root），gen-routes 各分包**独立扫描 + 树推导，跨分包不嵌套**：

```ts
// proteus.config.ts
subPackages: [{ root: 'subpackages/order', name: 'order' }],
```

- 页面照常写在分包目录下，`<route>` 块可选——路由归入所属分包
- **分包依赖自动生成**：模块 chunk / name 与分包基名匹配 → `dependencies` + `preloadRule` 写入 app.json
- 产物：`dist/mp-weixin/subpackages/order/`（与主包隔离）

## 按需注入：lazyCodeLoading

Skyline 开关开启时，gen-routes 自动写入：

- `app.json` 的 `lazyCodeLoading: "requiredComponents"`——未访问页面代码不注入
- 各页 `page.json` 的 `"renderer": "skyline"` + `requiredComponents`（Skyline 渲染前提，微信平台校验）

## 共享模块与体积

- 跨页共享逻辑编译为 `_proteus/<module>.js` 独立产物 + require 转换（module-plan B0）
- bundle-report 在构建尾输出体积清单（主包预算 1200KB 硬卡在 CI）
- 体积治理详见[体积预算](/docs/framework/perf-budget)

## 下一步

- [质量与兼容](/docs/framework/29-conformance)
