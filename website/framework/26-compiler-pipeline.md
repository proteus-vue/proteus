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
