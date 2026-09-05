---
title: 第三方组件分发
order: 24
group: 自定义组件
---

# 第三方组件分发

组件写好了，怎么给别的工程用？按使用方是「Proteus 工程」还是「存量小程序」两条路径。

## 路径 1：Proteus 工程（workspace / npm）

1. 组件库打包：参照 `src/components` 的聚合模式——目录约定 + `index.ts` 聚合导出 + esbuild bundle（`build-packages.mjs` 自动构建）
2. 消费方 `npm install`（或 workspace 链接 dist）→ `import { PBadge } from '你的组件库'`
3. **小程序端自动接线**：plugin-vite 扫描组件目录 → `proteus/<tag>/index` 四件套 + 页面 `usingComponents` 自动写入

## 路径 2：存量小程序（渐进迁移）

存量工程不引入 Proteus 框架也能用编译产物：

- `proteus migrate mp`（G-31 B6 codemod）：旧小程序页面 → Proteus 语义写法
- 兼容层 `@proteus-vue/compat-miniprogram`：`wx.*` 桥 + 自动标签替换（view→p-box 等 12 组 1:1）+ 手工项标注

## 诚实边界

- **组件库内禁用平台 API**——审计不通过的分发组件不承诺双端行为
- props 透传依赖编译器静态提取——动态拼接的 prop 名不支持
- 分发的组件样式同样受默认 scoped 约束（触达宿主 slot 子元素需 `<style global>`）

## 与插件系统的关系

组件库是「源码级复用」（编译期打进产物）；[插件 API](/docs/plugin/host) 是「运行时复用」（WASM 沙箱 + capability 授权）。给 Studio 写面板扩展走插件；给业务工程沉淀 UI 资产走组件库。

## 下一步

- [组件单元测试](/docs/framework/components-test)
