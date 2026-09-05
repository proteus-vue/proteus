---
title: 编译管线总览
order: 5
group: 编译期
---

# 编译管线总览

小程序端编译管线（`@proteus-vue/compiler`，纯函数实现）把一份标准 Vue SFC 转为小程序四件套。Web 端**不走此管线**。

## 管线全景

```
page.vue
├── <template> ── transformTemplateToWxml ──► .wxml   标签 / 指令映射
├── <script>   ── transformScriptToPage ────► .js     Page() 构造器
├── <style>    ── transformStyleToWxss ─────► .wxss   px→rpx + 选择器重写
└── <route>    ── gen-routes ───────────────► .json   app.json / page.json
```

四条转换各自独立、可单独测试；每条规则带 AI 说明书（id / description / before / after / why）。

## 入口：compileVueSfc（真正的主编译函数）

Playground 与 CLI 共用同一入口 `compileVueSfc(source, options)`（浏览器可用——零 node 内置依赖）,流程：

1. **sfcParse**：`@vue/compiler-sfc` 解析出 descriptor（template / scriptSetup / styles / route 块）
2. **styleOpts 归一**：`px2rpx`（缺省 true）/ `rpxRatio`（缺省 2）/ rules 覆盖集
3. **样式分组**：`<style global>` 显式全局（不作用域化）；其余 style 块按 scoped 处理——**无标记的 `<style>` 也按 scoped + 编译期警告**（2026-08 用户决策：默认局部作用域，Vue 标准是全局，Web 端会泄漏到所有页面）
4. **模板转换**：transformTemplateToWxml——除标签/指令映射外还收集 `vModelBindings`（供 script 生成回写 handler）/ `selfHandlers`（.self 语义）/ `inlineHandlers`（内联表达式提升）/ `pageScrollWrapped`（自动包 scroll-view）/ p-fluid clamp 参数
5. **脚本转换**：transformScriptToPage——接收模板侧收集的联动信息（v-model 绑定名、导航使用、self/once/inline handler 名单）生成 Page 构造器
6. **样式转换**：global 组在前 + scoped 组（类名后缀）在后拼接；页面自动包滚动容器时追加 `.proteus-page-scroll { height: 100vh }`（不参与 scope 后缀）
7. **trace 三链合一**：template / script / style 各自 Trace 事件汇入决策链（`proteus explain` 反查）

页面滚动生命周期检测（`onPageScroll` / `onReachBottom` / `onPullDownRefresh` / `wx.pageScrollTo` 的存在性）在编译期扫描，决定是否注入滚动容器与事件桥。

## 编译期校验

IR 层做**编译期校验**，问题当场报错而不是上线后崩：

- p-* 标签必须语义命名（铁律 G-31.1）
- 属性必须声明降级行为（CMP006）
- 布局约束逻辑冲突（如 min-col-width × max-cols > 设计宽）当场报错

## 双编译后端语义等价

Node 与 Rust 两个编译后端对同一份 SFC 必须产出**语义等价**的 CompilerIR——IR Golden 门禁（81 个真实页面用例）强制，配置 `compiler.backend = 'rust'` 即开启双编译校验。

## 本组导航

- [模板转换](/docs/framework/compile-template)：标签与指令映射
- [脚本转换](/docs/framework/compile-script)：响应式重写为 setData
- [样式转换](/docs/framework/compile-style)：px→rpx 与选择器重写
- [路由生成](/docs/framework/compile-routes)：gen-routes 双端配置
- [编译规则与决策链](/docs/framework/compile-rules)：反黑盒与 explain
