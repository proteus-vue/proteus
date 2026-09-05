---
title: 样式转换
order: 6
group: 编译期
---

# 样式转换

`<style>` 由 `transformStyleToWxss` 处理：**仅小程序端编译期生效**，Web 端永不转换（Vite 原生处理标准 CSS）。

## px → rpx

CSS 中的数值 px 按 `rpxRatio`（默认 2）转 rpx：

```css
/* before */        /* after（小程序端） */
padding: 48px;  →   padding: 96rpx;
```

- rpx 是小程序的屏幕等比单位（750 设计稿基准），跨端 CSS 一致性在编译期吸收（决策 #9）
- Web 端保持标准 CSS——同一份样式声明两端各自以原生方式生效
- 可通过 `proteus.config.ts` 的 `style` 段配置

## 选择器重写

小程序 WXSS 的选择器能力弱于 CSS，编译器做对应重写（类选择器归一、标签选择器映射），保证一份样式在小程序端命中预期节点。

## 与柔性布局的关系

px→rpx 解决的是**单位等比**；柔性布局（`v-p-fluid` / p-grid auto-fill）解决的是**结构自适应**——后者才是 Proteus 的布局主张，样式转换只是兼容层。详见柔性系统分区。

## 下一步

- [路由生成](/docs/framework/compile-routes)
