---
title: 桌面端原语
order: 14
group: 布局与组件
---

# 桌面端原语

桌面交互（悬停、快捷键、右键、焦点、权限、光晕）在 Proteus 里是 **G-24 语义原语的指令形态**：`v-p-*` 指令来自 `@proteus-vue/desktop`，纯逻辑与 DOM 接线分层、全部可单测。输入形态是语义的一部分（G-25 三维断点的输入维：touch / cursor / remote）——你写语义，端自决降级，**禁止手写 `if (isDesktop)`**（PRIM001）。

> **桌面语义 = 指令；触端不是砍功能，是语义映射。**
> 悬停在鼠标上是 hover 效果，在触屏上降级 tap 高亮；光晕在触屏 / 减动效环境静默不启用。业务代码一份，没有平台分支。

## 安装：一行注册全部指令

```ts
// website/src/main.ts（官网真实接线）
import { createDesktopDirectives } from '@proteus-vue/desktop'

for (const [name, dir] of Object.entries(createDesktopDirectives())) {
  app.directive(name, dir)
}
```

注册六个指令：`v-p-hover` / `v-p-shortcut` / `v-p-focus-trap` / `v-p-context-menu` / `v-p-permission` / `v-p-cursor-glow`。小程序端不注册指令——桌面交互无对等，天然降级。

## v-p-hover：悬停态

值是预设名，命中后给元素加 `p-hover-<preset>` 类（过渡动画由页面 CSS 定义）：

| 预设 | 效果 |
|---|---|
| `brighten`（缺省） | 提亮 |
| `lift` | 抬升 |
| `underline` | 下划线 |
| `none` | 关闭 |

官网支柱卡全卡覆盖（首页真实用法）：

```vue
<p-view v-for="(p, i) in pillars" :key="p.no" v-p-hover class="pillar-card">…</p-view>
```

指针判定内建：`mouse` / `pen` 可悬停；`touch` 降级为 tap 高亮——不需要你写一行判断。

## v-p-shortcut：快捷键

表达式 `快捷键:语义id`，`mod` 自动遵循平台惯例（Mac → ⌘，其余 → Ctrl），并自动把 `⌘S` / `Ctrl+S` 写进元素 `title` 作菜单栏提示：

```vue
<button v-p-shortcut="{ expr: 'mod+s:save', handler: (id) => save() }">保存</button>
```

## v-p-context-menu：右键菜单

右键弹出菜单：防溢出定位（屏幕边缘自动翻转），点击 / `Escape` / 失焦即销毁：

```vue
<p-view v-p-context-menu="{ items: [{ label: '编辑', value: 'edit' }], onSelect: (v) => edit(v) }">
  …
</p-view>
```

## 焦点管理：v-p-focus-trap 与 d-pad

**弹窗焦点陷阱**：Tab 循环 + Shift+Tab 反向 + 打开时聚焦首项 + 关闭后恢复先前焦点（弹窗无障碍硬要求）：

```vue
<p-view v-p-focus-trap>…弹窗内容…</p-view>
```

**车机 / TV 方向键导航**不用新指令——`p-sidebar` 已内建：Arrow 键在导航项间移动焦点（side-rail 态上下、展开态左右），d-pad 语义零业务代码。

## v-p-permission：权限门禁

点击拦截式门禁：已授权放行业务 `@click`；未授权同步拦截并请求授权，授权成功后自动重放点击（业务 handler 恰好执行一次）：

```vue
<button v-p-permission="{ semantic: 'notification', onState: (s) => (state = s) }">发送通知</button>
```

`semantic` 取权限语义名：`notification` / `camera` / `microphone` / `geolocation` / `clipboard`。

## v-p-cursor-glow：指针跟随光晕

宿主级一层（挂页面根即可）：双光斑 radial-gradient（主紫 + 副青）以 lerp 插值跟随指针——AI 科技感的指针环境反馈。官网全局配置：

```vue
<p-page v-p-cursor-glow="cursorGlowOptions" class="site">…</p-page>
```

```ts
// website/src/App.vue 真实配置
const cursorGlowOptions = {
  size: 520,                         // 光晕主径 px
  color: 'rgba(124, 92, 255, 0.13)', // 主色（Proteus brand 紫）
  accent: 'rgba(0, 224, 198, 0.09)', // 副色光斑（brand2 青）
  lerp: 0.14,                        // 插值系数：小 = 拖尾感强，1 = 立即贴合
}
```

| 参数 | 默认值 | 说明 |
|---|---|---|
| `size` | `460` | 光晕主径 px（副光斑为主径的 60%） |
| `color` | `rgba(124, 92, 255, 0.14)` | 主光斑颜色（建议 rgba 含透明度） |
| `accent` | `rgba(0, 224, 198, 0.10)` | 副光斑颜色 |
| `lerp` | `0.12` | 跟随插值系数 0-1 |
| `opacity` | `1` | 不透明度 |

## 哪些端生效

| 环境 | 行为 |
|---|---|
| 桌面 Web（mouse / pen） | ✅ 六指令全部生效 |
| 触屏（`pointer: coarse`） | 光晕不启用；hover 降级 tap 高亮——静默降级 |
| `prefers-reduced-motion` | 光晕不启用（减动效优先） |
| 小程序（逻辑层无 DOM） | 指令不注册、编译剥离——天然降级 |
| 车机 / TV（遥控器） | 焦点语义生效：`p-sidebar` d-pad + `v-p-focus-trap` |

降级是**静默**的：`createCursorGlow` 在不支持环境直接返回 `null`，调用方零分支。对比 PRIM001 反例——`if (isDesktop) { 绑鼠标事件 } else { … }` 的平台分支在这里没有生存空间。

## 下一步

- [液态玻璃](/docs/15-liquid-glass)：玻璃质感与桌面光晕是官网氛围层组合
- [柔性布局](/docs/06-fluid-layout)：布局维度的自适应（本篇是输入维度）
- [容器与宿主](/docs/24-containers-hosts)：桌面多窗口容器形态
