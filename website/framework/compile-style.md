---
title: 样式转换
order: 8
group: 编译期
---

# 样式转换

`<style>` 由 `transformStyleToWxss` 处理：**仅小程序端编译期生效**，Web 端永不转换（Vite 原生处理标准 CSS）。管线四步：标签选择器重写 → px→rpx → Skyline 兼容警告 → scoped 类名后缀。

## 1. px → rpx

CSS 中的数值 px 按 `rpxRatio`（默认 2，即 375 设计稿）转 rpx：

```css
/* before */        /* after（小程序端） */
padding: 48px;  →   padding: 96rpx;
```

- rpx 是小程序的屏幕等比单位（750 设计稿基准），跨端 CSS 一致性在编译期吸收（决策 #9）
- Web 端保持标准 CSS——同一份样式声明两端各自以原生方式生效
- 配置：`proteus.config.ts` 的 `style.px2rpx`（开关）/ `style.rpxRatio`（比例）
- 规则 ID `style/px-to-rpx`（trace 可见：`48 处 px → 48 处 rpx（rpxRatio=2）`）

## 2. 选择器重写（两条规则）

小程序 WXSS 的选择器能力弱于 CSS，编译器做两类重写：

| 规则 ID | 触发条件 | 重写方式 |
|---|---|---|
| `style/selector-tag` | 选择器含 HTML 标签 | 映射为小程序标签（`div` → `view`——与模板标签映射一一对应，避免元素已映射而样式匹配不到） |
| `style/selector-semantic` | 选择器含 `h1-h6` / `p` / `a` | 映射为 `.proteus-*` 类选择器（避免同特异性覆盖） |

## 3. 语义基础样式注入

`h1-h6` / `p` / `a` 在 WXSS 无 UA 样式——编译器自动注入 `.proteus-h1~h6 / .proteus-p / .proteus-a` 基础 WXSS（注入在用户样式之前），规则 ID `style/semantic-base-wxss`。

`<transition>` 页面另注入过渡 keyframes（`proteus-fade-in` / `proteus-slide-up-*` / `proteus-scale-*`），规则 ID `transition/animation-wxss`，按需触发（仅页面使用了 transition 时）。

## 4. Skyline 不支持属性（编译期警告）

| 属性 | 处理 |
|---|---|
| `float` | 编译期警告（不阻断构建） |
| `position: fixed` | 编译期警告（不阻断构建） |

规则 ID `style/skyline-unsupported`——警告非错误，但 D-2/柔性布局审查会追。

## 5. scoped CSS → 类名后缀（Skyline 真机实测结论）

`<style scoped>` 的编译方式经历真机重构（0.3 → 2026-08）：

| 方案 | 结果 |
|---|---|
| 属性选择器 `[data-v-xxx]` | ❌ Skyline 不支持 |
| 复合类选择器 `.a.b` | ❌ Skyline glass-easel 不支持——真机实测：组件自己 wxss 匹配自己根节点都失效（p-button padding 消失）且**无警告** |
| **类名后缀**（现行） | ✅ `.box` → `.box-data-v-xxx`——单一类选择器是 Skyline 确定支持的唯一路径 |

后缀拼接细则：

- `.box` → `.box-data-v-x`；伪类后缀在类名后：`.box-data-v-x:hover`
- 后代选择器逐 token：`.box .title` → `.box-data-v-x .title-data-v-x`
- `@keyframes` 帧（`from` / `to` / `0%`）不处理
- 逗号选择器列表逐条处理；`:deep()` 去包装后统一后缀
- 属性选择器内容屏蔽（`[...]` 内可能含 `.`）；已带后缀的不重复追加

规则 ID `style/scoped-css`（仅 `<style scoped>` 且带 scopeId 时触发）。

## 规则覆盖

以上全部规则可在 `proteus.config.ts` 的 `rules.disabled` 中禁用（ID 见 `npx proteus rules`），或经 trace 观察每次编译实际触发项（[透明编译](/docs/28-cli)）。

## 与柔性布局的关系

px→rpx 解决的是**单位等比**；柔性布局（`v-p-fluid` / p-grid auto-fill）解决的是**结构自适应**——后者才是 Proteus 的布局主张，样式转换只是兼容层。详见柔性系统分区。

## 下一步

- [路由生成](/docs/framework/compile-routes)
- [模板转换](/docs/framework/compile-template)
