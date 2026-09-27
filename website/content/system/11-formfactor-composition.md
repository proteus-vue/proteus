---
title: 一套内容槽，七种形态
order: 11
group: 柔性系统
---

# 一套内容槽，七种形态

> 前面十篇讲的是**框架怎么求解**；这一篇是**业务怎么写**。答案是：写**一份语义内容槽**，形态相关的一切都由框架推导——业务里没有 `if (form === 'car')`、没有断点、没有能力判断。

## 分水岭：换形态，不是缩放形态

| | 响应式布局 | 柔性系统 |
|---|---|---|
| 适配基准 | 视口宽度 | **形态**（输入 + 观看距离 + 能力集） |
| 变化范围 | 同一套布局的尺寸缩放 | **换布局拓扑、换导航、换能力集、换视觉语言** |
| 业务代码 | 断点分支 / `if (isTV)` | **零形态分支**（只声明内容） |

## 业务侧长什么样

演示页的完整内容槽实现（[`website/src/components/fluid-product/index.vue`](/multi-device)，全文零形态判断）：

```vue
<template>
  <!-- 一行接形态：拓扑 / 视觉语言 / 能力 / 密度 / 缩放 / 热区 全自动 -->
  <p-formfactor :declared="form" :posture="posture ?? ''" :width="width"
                :degraded-hint="t.degraded" :drive-hint="t.drive">
    <!-- 侧栏：仅声明 sidebar 的形态渲染（平板 / PC） -->
    <template #rail>…</template>

    <template #media><div class="fp-cover">🎧</div></template>

    <template #heading>
      <strong>{{ product.name }}</strong>
      <span>{{ product.desc }}</span>
    </template>

    <template #price><strong>¥{{ product.price }}</strong></template>

    <!-- 多规格：车机声明 fallback → 框架渲染降级条，业务无感 -->
    <template #sku>
      <span v-for="s in skus" :key="s" :class="{ on: picked === s }" @click="picked = s">{{ s }}</span>
    </template>

    <template #actions><button>▶ 立即购买</button><button>＋ 收藏</button></template>

    <!-- 推荐：TV/车机自动转横向焦点海报流 -->
    <template #recommend>…</template>

    <!-- 底部 Tab：仅声明 tabs 的形态渲染 -->
    <template #tabbar>…</template>
  </p-formfactor>
</template>
```

八个槽位（`rail` / `media` / `heading` / `price` / `sku` / `actions` / `recommend` / `tabbar`）是**语义槽**：框架按形态画像决定每个槽渲染成什么结构、放在哪、要不要渲染。

## 同一份内容，七种结果

| 形态 | 拓扑结构 | 导航 | 能力取舍（本例） | 视觉 |
|---|---|---|---|---|
| 手表 | 一屏一意（媒体/推荐不渲染） | 页栈 | 描述收起、标题限 2 行、双按钮并排 | 暗色 AMOLED |
| 手机 | 单列 + Tab | bottom-tabs | 全部能力可用 | 浅色 |
| 折叠屏 | 展开态双窗格 · 半开横长条/竖方形 | side-tabs | SKU 可用；半开收起描述与次操作（带理由） | 浅色 |
| 平板 | 侧栏 + 分栏 | rail | + 多列推荐 | 浅色 |
| PC | 侧栏 + 三列 + 悬停 | side-nav | + hover / 键盘焦点环 | 浅色 |
| 车机 | 驾驶舱（媒体｜信息 / 操作｜瓦片） | focus-tree | SKU → **降级条**、推荐只留 3 项、大热区 76dp | 暗色舱 |
| TV | 英雄区 + 横向海报流 | focus-row | 无高密度信息、媒体 ×2.6、3px 焦点环 | 暗色沉浸 |

**同一份模板**在七种形态下产出上述七种结果——这就是「柔性系统」与「响应式布局」的分水岭。

## 可验证：演示页 + 机器门禁

[多端同屏](/multi-device) 是可交互的验收场（`?device=` / `?posture=` 可分享）：

- 左栏展示**正在执行的同一份源码**（`?raw` 直读，语法高亮）
- 中栏七端真渲染（设备帧居中完整，非截图）
- 右栏形态推导 + **14 项能力三态**（含降级路径标注）

背后的机器门禁（真 Chromium，非人工目测）：

| 门禁 | 判据 |
|---|---|
| 双视口 × 七形态几何 | 零重叠、零越界、零裁切；一屏形态（watch/car/tv）内容不溢出 |
| 媒体内容遮挡 | 叠加拓扑下主视觉不得压住可交互项 |
| 主标签可读性 | 一屏形态的标题/价格/瓦片名不得被省略号截断 |
| 构图平衡 | 车机信息组须与媒体面板垂直居中（容差 10px） |
| 能力对账 | `data-pf-caps` 摘要与画像声明逐项一致 |
| 同会话切换 | 点切换器（非冷启动）逐形态仍全部通过 |

```bash
pnpm test:e2e:website   # 本地跑同一套几何门禁
```

> 这些判据都是**用户实测缺陷驱动**建立的：窄舞台重叠 → 双视口；物理量当绝对 px → 设备尺度换算；只查容器不查内容 → Range 内容盒 + 子项纵向；只查重叠不查构图 → 构图平衡。每条都做过**破坏性验证**（回退修复必红）。

## 诚实边界

- 演示内容是**电商商品页**一种场景；其他内容形态（列表详情、仪表盘、海报墙）需要各自的语义槽组合——框架提供机制，不提供万能模板。
- 车机形态只呈现前 3 个推荐项（第 4+ 项显式不渲染）：驾驶中翻找选项是分心源，属**刻意的能力取舍**，非缺陷。
- 演示页的 `?device=` 是宿主声明——真实 App 里形态来自端 profile（浏览器无法自动识别 watch/car/tv，见[形态画像](/docs/system/06-form-profiles)）。

## 下一步

- [多端同屏演示](/multi-device)：亲手切七种形态
- [p-formfactor API](/docs/component/p-formfactor)：props / 插槽 / 实现要点
- [形态画像](/docs/system/06-form-profiles)：回到上层——那张驱动一切的 SSOT 表
