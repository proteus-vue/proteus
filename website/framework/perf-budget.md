---
title: 体积预算
order: 38
group: 质量与兼容
---

# 体积预算

小程序主包体积是微信平台的硬约束（单包 2MB 上限），Proteus 用**构建期预算门禁**治理：`bundle-report.ts` 在 `build:mp` 尾部统计产物体积并对照预算。

## 预算机制

- **主包预算**：默认 1200KB（`config.budget.mainPackageKB`，工程实跑主包 < 1200KB）
- **strict 模式**：`budget.strict = true` 时超预算**构建失败**（默认警告）
- **分包监控**：各分包独立统计——微信单包 2MB 上限，超限 error 阻断
- **Top N 大文件**：报告结构化输出最大文件清单，定位体积来源

## 体积治理手段

| 手段 | 效果 |
|---|---|
| 分包（[分包与按需注入](/docs/framework/subpackages)） | 主包只留 tab/首屏路径 |
| 按需注入 lazyCodeLoading | 未访问页面代码不注入 |
| 共享模块去重 | 跨页共享逻辑收敛 `_proteus/<module>.js` 单份产物 |
| 组件按需 import（Web） | 未用组件不进 bundle |

## 实测口径

体积数字是**构建产物实测**（构建尾自动输出），非估算——符合 G-60.7 数字不粉饰纪律。主包历史实跑数据见 examples 构建（如 709KB < 1200KB 预算）。

## 下一步

- [一致性验证](/docs/framework/29-conformance)
