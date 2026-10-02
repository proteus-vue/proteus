<!-- examples/pages/consistency-stress.vue
     ★★★六端一致性**压力测试**夹具（2026-10-02）——**一份标准 SFC 源码，六端渲染**。
     
     【为什么新增（上一版夹具的说服力缺口）】L4 像素观测的四元素夹具是**六端各自手写**的
       （小程序 wxml / Web html / Android Java / iOS Swift 各写一遍）——它只证明"各端系统管线
       对同一组声明画得接近"，**没有**证明"一份 SFC 源码 → 六端渲染一致"。
       本页补上后者：**编译/实例化这条真实链路**参与，而不是手写声明。
     
     【一份源，三条链】
       · Web / 小程序：Proteus 编译器（本文件 → Vue SPA / WXML）
       · iOS / Android：Vapor（编译器产 LayoutTemplate + 订阅表 → 端上实例化 → Rust 内核 → 自绘）
     
     【★★元素与样式形态 = 三链共同子集（两次实测收敛出的结论）】
       · **元素用 `view` / `text`**（小程序语义标签）——
         Web 端由 `installWebPlatform` 注册 `proteus-view`/`proteus-text` 渲染；
         MP 端原生；Vapor 端按 tag 解析（实测 `view`/`text` 两者皆可）。
       · **样式用内联 `style`**——
         ★实测①：`p-view` + 内联 style ⇒ Web 端不生效（p-view 根是 `<view>`，
           内联 style 不 fallthrough，渲染成默认主题的灰底淡蓝）；
         ★实测②：`class` + `<style scoped>` ⇒ Vapor 端拿不到样式
           （`buildLayoutTemplate` 只解析 style 属性与绘制声明属性，不解析 CSS 规则——输出 `style={}`）。
         ⇒ **内联 style 是唯一三链都吃的形态**（Vapor 的 `parseStaticStyle` 解析它，
           Web 端 `proteus-view` 原生渲染它，MP 端 WXSS 内联样式天然支持）。
       · 支持字段子集：width/height/margin/padding/flexDirection/alignItems/flexShrink/
         backgroundColor/color/fontSize/borderRadius（= `parseStaticStyle` 的闭集）。
       ★动态行宽用 `:style="'width:' + item.w + 'px'"`（Vapor 的订阅表支持 SET_STYLE 逐键下发）。
     
     【★尺寸 375×800（六端屏幕都放得下）】Web 390×844 CSS / iOS 402×874pt / Android 1200×2608@3
       / 小程序 640×1386 —— 375×800 全部内缩 ✓。
     
     【锚点】`#stress-anchor`（80×48 圆角块 · #2f6fed）——供六端截图**锚定归一**。 -->
<script setup lang="ts">
import { ref } from 'vue'

// ★10 行列表（每行 3 节点 + 1 文本 = 40 节点 + 页头 2 + 锚点 1 + 页脚 1 = 44 节点）
const list = ref([
  { id: 1, w: 40, title: 'row 1' },
  { id: 2, w: 52, title: 'row 2' },
  { id: 3, w: 64, title: 'row 3' },
  { id: 4, w: 76, title: 'row 4' },
  { id: 5, w: 88, title: 'row 5' },
  { id: 6, w: 40, title: 'row 6' },
  { id: 7, w: 52, title: 'row 7' },
  { id: 8, w: 64, title: 'row 8' },
  { id: 9, w: 76, title: 'row 9' },
  { id: 10, w: 88, title: 'row 10' },
])

const summary = ref('SFC stress · 6 targets')
</script>

<template>
  <!-- ★★flex 必须**显式声明**（2026-10-02 实测收敛出的共同子集约束之二）：
       本仓框架给 Skyline 注入 `rendererOptions.skyline.defaultDisplayBlock: true`（对齐 WebView 的
       block 默认；见 packages/types/src/config.ts 的注释与 gen-routes.ts 的默认值）⇒
       **本仓标准 = view 默认 block**，写 `flex-direction: row` 而不写 `display: flex` 不生效
       （Web 模拟层同为 block；Vapor 端 taffy 默认 flex 容器——三族默认值不同，显式声明才跨端一致）。 -->
  <view id="stress-root" style="width: 375px; height: 800px; display: flex; flex-direction: column; background-color: #14141c; padding-top: 60px; padding-left: 16px">
    <view id="stress-anchor" style="width: 80px; height: 48px; border-radius: 14px; background-color: #2f6fed; margin-bottom: 10px"></view>
    <text style="font-size: 18px; color: #ffffff; margin-bottom: 12px">Proteus SFC stress</text>
    <!-- ★chip：静态 style 承载形状/底色 + 动态 `:style` 承载宽度（**同元素两种写法**）——
         2026-10-02 实测修的编译器缺陷：两条 style 属性此前**不合并** ⇒ WXML 重复属性
         （微信只保留其一、布局静默损坏；`DuplicatedAttribute` 门禁拦在构建前）。
         修法：编译器合并为一条 `style="静态;动态"`（动态在后 ⇒ 同键时动态胜，与 Vue 优先级一致）。 -->
    <view v-for="item in list" :key="item.id" style="width: 343px; height: 52px; display: flex; flex-direction: row; align-items: center; margin-bottom: 6px; border-radius: 10px; background-color: #1b1b21">
      <view :style="'width:' + item.w + 'px'" style="height: 32px; flex-shrink: 0; border-radius: 16px; background-color: #6f4ae8; margin-left: 10px"></view>
      <text style="width: 128px; font-size: 14px; color: #ffffff; margin-left: 10px">{{ item.title }}</text>
      <view style="width: 24px; height: 24px; flex-shrink: 0; border-radius: 12px; background-color: #2f6fed; margin-left: 8px"></view>
    </view>
    <text style="font-size: 12px; color: #8b8b96; margin-top: 8px">{{ summary }}</text>
  </view>
</template>
