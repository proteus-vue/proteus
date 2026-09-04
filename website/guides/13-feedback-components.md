---
title: 反馈与动效：p-segment / p-toast / p-animate
order: 13
group: 布局与组件
---

# 反馈与动效：p-segment / p-toast / p-animate

反馈组件只声明「什么时候出现什么」，形态由各端原生承接；动效是**纯 CSS 声明语义**——Web 原生 CSS animation，Skyline 同样支持 animation，双端同源码，不引入 JS 动画引擎。本篇三个组件都在官网 Playground 里真实使用（Tab 切换 / 复制反馈 / LIVE 脉冲）。

> **动效的跨端写法只有一种：声明预设，不写帧。**
> `p-animate` 的 keyframes 预设编译为全局 `@keyframes p-animate-*`，时长 / 次数 / 延迟走内联 style——业务零帧代码，两端一致。

## p-segment：分段控制器

受控组件：`options` + `active`（`v-model:active`），点选项同时 emit `update:active` 与 `select`。

| prop | 类型 / 默认 | 说明 |
|---|---|---|
| `options` | Array，`[]` | `[{ label, value? }]`——value 缺省取 label |
| `active` | String / Number，`''` | 当前激活项 value |

| 事件 | 载荷 | 说明 |
|---|---|---|
| `update:active` | value 字符串 | `v-model:active` 绑定 |
| `select` | value 字符串 | 点击即发（与 v-model 解耦监听） |

官网 Playground 的 Tab 切换（替代手写 Tab 按钮）：

```vue
<p-segment
  :options="TABS.map((t) => ({ label: t, value: t }))"
  :active="activeTab"
  @update:active="activeTab = $event"
/>
```

主题走 CSS 变量钩子（默认值即浅色原样，暗色主题只需注变量，零破坏）：

```css
--seg-bg: #f2f3f5;         /* 容器底 */
--seg-item-color: #646566; /* 未选中文字 */
--seg-on-bg: #fff;         /* 选中底 */
--seg-on-color: #323233;   /* 选中文字 */
```

## p-toast：轻提示

| prop | 类型 / 默认 | 说明 |
|---|---|---|
| `visible` | Boolean，`false` | 显示开关（受控） |
| `text` | String，`''` | 提示文案 |
| `duration` | Number，`2000` | 自动关闭毫秒数；`0` = 不自动关 |
| `position` | String，`'center'` | `center` / `top` / `bottom` |

事件只有一个 `close`：duration 到点组件自动 emit，父级把 `visible` 置回 false。行为细节：透明遮罩层挡误触；面板固定定位（top 64px / 垂直居中 / bottom 120px），250ms 淡入；卸载时清理定时器。

复制分享链接的真实反馈（官网 Playground）：

```vue
<p-toast
  :visible="toastVisible"
  text="分享链接已复制——在另一浏览器打开可复现"
  position="bottom"
  @close="toastVisible = false"
/>
```

```ts
function copyShareLink(): void {
  void navigator.clipboard?.writeText(url)
  toastVisible.value = true // duration 到点自动 close
}
```

## p-animate：动画原语

| prop | 类型 / 默认 | 说明 |
|---|---|---|
| `keyframes` | String，`'fade'` | 预设名：`fade` / `bounce` / `pulse` / `shake` / `zoom-in` / `spin` |
| `duration` | Number，`600` | 时长 ms |
| `loop` | Boolean，`true` | 循环播放（装饰动画缺省 true；false 播一次） |
| `delay` | Number，`0` | 延迟 ms |

官网 LIVE 徽标脉冲（fade 循环 = 标准 live 指示器）：

```vue
<span class="live-badge">
  <p-animate v-if="motionOk" keyframes="fade" :duration="1400" class="live-pulse">
    <span class="live-dot" />
  </p-animate>
  <span v-else class="live-dot" />
  LIVE
</span>
```

reduced-motion 静态化的官方范式是**页面侧分支**：组件本身未内建 `matchMedia` 探测（保持零平台 API、MP 安全），由消费方判定一次并切换：

```ts
const motionOk = !(typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches)
```

内建降级的对照（同族能力已内建的场景）：`p-sidebar` 监听 drive-mode / `prefers-reduced-motion` 自动加 `p-sidebar-no-motion` 禁用动效；`v-p-cursor-glow` 命中 reduced-motion / 触屏直接不启用。`p-animate` 自身的全局 reduced-motion 静态化属规划项（🟡 待内建），当前按上方页面侧范式承接。

## 选型速查

| 场景 | 用谁 |
|---|---|
| 视图内切换（Tab / 视图分段） | `p-segment`（受控 + 主题变量） |
| 操作结果轻反馈 | `p-toast`（自动关 + position） |
| 装饰动效（呼吸 / 脉冲 / 入场） | `p-animate`（预设 keyframes） |
| 显隐转场 | `p-transition`（过渡预设） |
| 页面级动效开关 | 页面 `no-motion` 类 + `p-sidebar` 动效门范式 |

## 下一步

- [桌面端原语](/docs/14-desktop-primitives)：v-p-cursor-glow 与桌面交互指令
- [液态玻璃](/docs/15-liquid-glass)：pg-glass 质感与玻璃语义单入口
- [语义组件总览](/docs/11-components-overview)：回到组件全景图
