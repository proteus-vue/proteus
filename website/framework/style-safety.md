---
title: 样式运行时安全
order: 42
group: 质量与兼容
---

# 样式运行时安全

动态 `:style` 是运行时最后一道闸门——编译期规则管不到的**运行态动态值**（接口返回/用户输入拼进 style）可能直通原生渲染。`@proteus-vue/style-safety` 提供**三层防线 ③**（①②见 [样式转换](/docs/framework/compile-style) 与 `proteus style:check`）：

```
① 编译期静态检查（style:check STS001-006）——模板/静态样式
② 样式转换管线（px→rpx / 选择器重写）——编译产物
③ createStyleGuard（本页）——运行时动态 :style 最后闸门
```

## 白名单属性分类

动态 style 只允许声明过的属性，按值类型分四类：

| 分类 | 属性 | 值校验 |
|---|---|---|
| **Length 长度** | `width/height/min/max*`、`padding*`、`margin*`、`borderRadius`、`top/left/right/bottom`、`gap`、`fontSize/lineHeight/letterSpacing` | 有限数 / `px·rem·%` 字符串 / `auto` |
| **Color 颜色** | `color`、`backgroundColor`、`borderColor` | 字符串（hex/rgba/theme token——编译期已展开，运行时 string 兜底） |
| **Numeric 数值** | `opacity`（0-1 有限数）、`flex`、`zIndex`、`fontWeight` | 有限数 |
| **Transform** | `transform` | 仅 `translate/scale/rotate/skew` 函数 |

**`p-*` 语义组件属性放行**——组件内是安全路径（`prop.startsWith('p-')`）。

## ❌ 禁止属性（CSS 矩阵 ❌ 级）

| 属性 | 原因 |
|---|---|
| `display` / `float` / `position` / `overflow` | 绕过语义层直通原生——**必须用 p-\* 语义组件封装**（p-view/p-stack/p-page 等承载布局语义） |
| `backdropFilter` / `boxShadow` / `filter` | 各端能力差异大，走 pg-glass 等语义组件 |

## 降级语义（非法值永不进渲染管线）

`validateStyleValue` 对非法值返回 `{ ok: false, reason, fallback }`——`createStyleGuard.patch()` 剔除非法项并按**降级默认值**替换（`width/height/padding/margin/borderRadius → 0`、`opacity → 1`、`flex/zIndex/fontSize/lineHeight/gap → 0`、颜色 → 剔除继承）。

## createStyleGuard（模式）

| mode | 行为 | 适用 |
|---|---|---|
| `strict` | 非法剔除 + 记录 + **warn** | 开发期强校验 |
| `loose` | 非法剔除 + 记录（不 warn） | 开发默认（`__PROTEUS_DEBUG__` 时） |
| `off` | 原样放行——**零开销** | 生产默认 |

```ts
import { createStyleGuard } from '@proteus-vue/style-safety'

const guard = createStyleGuard({
  mode: 'loose',
  onReject: (r) => console.log('[style-safety]', r.reason), // 逐条推送
})
const safe = guard.patch({ width: dynamicW, opacity: 1.5, display: 'flex' })
// opacity 1.5 → 剔除 + fallback 1；display → 禁止剔除；width 合法保留
guard.records() // 拦截记录（环形 500）——DevTools style-safety Inspector 数据源
```

## 审计接线

- **运行时**：`createStyleGuard` 拦截记录是 DevTools style-safety 视图的数据源（[调试与可观测](/docs/framework/debugging)）
- **编译期**：`proteus style:check [dir] --platform`（STS001-006 静态规则 + `:style` 白名单推导）——见 [CLI](/docs/28-cli)

## 诚实边界

- transform 值校验为基础版四函数（组合变换矩阵校验留后续）；编译期已拦截的样式不重复运行时校验成本
- 未知属性在 loose/strict 语义：白名单外的未知属性**放行**（编译期已覆盖，运行时只兜已知风险属性）——strict 下可用 `FORBIDDEN_PROPS` 之外的显式配置收紧（后续批）

## 下一步

- [样式转换](/docs/framework/compile-style)：编译期两条规则
- [CLI 与工程命令](/docs/28-cli)：`style:check` 全参数
