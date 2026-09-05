---
title: 组件引用与注册
order: 16
group: 组件框架
---

# 组件引用与注册

p-* 组件在两端有不同的「接线」方式——但业务代码写法完全一致。

## Web 端：按需 import

```ts
// main.ts（或页面内）
import { PView, PGrid, PStack } from '@proteus-vue/components'
```

组件库 `@proteus-vue/components`（`src/components/index.ts`）聚合导出全部语义组件。**框架组件（p-*）Web 端按需 import**——没有全局注册的魔法，没有用到的组件不进 bundle。

## 小程序端：自动扫描与产物

小程序端无需手动注册，构建时自动完成：

1. **自动扫描**：plugin-vite 扫描组件目录，每个组件产出 `proteus/<tag>/index` 四件套（与应用组件 `/components/<tag>/` 隔离，框架组件带 `proteus/` 前缀）
2. **组件声明**：每个组件生成 `component.json`（usingComponents 由编译器自动写入页面 json）
3. **共享模块**：跨组件共享逻辑编译为独立产物 + require 转换（如 `_proteus/gesture.js`）

> 业务模板里直接写 `<p-grid>` 即可——引用、注册、产物路径全部由编译器处理。

## 组件聚合

`src/components/index.ts` 同时导出运行时扩展（`installFluidLayout` / fluid 指令 / 桌面指令工厂），供 `main.ts` 按需安装——组件库不只是模板组件，还包含指令与运行时扩展。

## 审计联动

组件聚合与目录结构受 `components:audit` 机器审计（见[组件化与语义命名](/docs/framework/components-model)），保证聚合导出与目录/语义映射不漂移。

## 下一步

- [组件生命周期与事件](/docs/framework/components-lifecycle)
