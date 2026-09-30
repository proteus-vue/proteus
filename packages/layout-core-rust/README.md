# @proteus-vue/layout-core（Rust）

★★L1 排版布局核心（App 端高性能渲染）——Rust 实现，三端共享（Android JNI / iOS ObjC++ / 鸿蒙 NAPI）。

## 决策依据

**DCP-1 已定案：Rust + Taffy 0.14**（2026-09-29）
- 决策文档：[`docs/proteus-performance-plan/11-dcp1-layout-engine.md`](../../docs/proteus-performance-plan/11-dcp1-layout-engine.md)
- spike（可复跑）：[`spike/dcp1-layout-engine/`](../../spike/dcp1-layout-engine/)

定案理由：① Grid（Yoga 的 `YGDisplay` 枚举里没有 Grid）② 与 `proteus-cc-rust` 同栈（零 FFI）③ 上游活跃。

> ★**版本锁：必须 `taffy = "0.14"`，禁止降级到 0.13。**
> 0.13 在「深链 + auto 尺寸容器」下 measure 次数呈 `3×2^d−2` 指数爆炸（深度 12 达 12286 次），
> 0.14 为有界常数 13。该退化无法用工程手段绕过（`flex_basis` 仍指数、`min_size` 无效）。

## 出口条件（已达成）

**与真实浏览器逐像素对拍（容差 0.5dp）**：`cargo test`

```
conformance：比对 67 个节点，最大偏差 0.375dp（容差 0.5dp）
```

- golden 由 `tests/e2e-layout-core-pixel.test.ts` 跑**真实 Chromium** 时冻结
  （`tests/golden/browser-layout.json`：引擎就绪输入 + 浏览器实测输出）
- 因此**本 crate 的测试无需浏览器**即可回归；重新生成走 `pnpm run test:e2e:web`
- 基准是浏览器而非本仓 TS 实现——依据方案 §5.7「以浏览器作为布局真值基准」

## 模块（对齐方案 §5.1）

| 文件 | 对应模块 | 职责 |
|---|---|---|
| `style.rs` | `node/` | 引擎就绪样式（全数值，无 CSS 字符串）与边值/尺寸类型 |
| `node.rs` | `node/` | **扁平节点树**（父/子索引 + 绝对坐标叠加） |
| `engine.rs` | `layout/` | **`LayoutEngine` 抽象**（引擎原生 API 不得泄漏）+ 文本度量注入契约 |
| `taffy_engine.rs` | `layout/` | Taffy 后端（**唯一**允许出现 `taffy::` 的文件） |

尚未落地（诚实边界）：`flatten/` `materialize/` `paint-hint/` `recycle/` `render/`。

## 三条实测踩坑（都已写进代码注释，勿走回头路）

1. **`compute_layout_with_measure` 的回调必须走 `taffy::compute_leaf_layout`**（官方 `examples/measure.rs` 的写法）。
   它负责解析 style 尺寸、min/max 夹取、padding 换算；**只把「内容尺寸」那一步**交给我们的度量函数。
   若手写「回显 style.size」，`auto` 轴会被回显成 0 → **stretch 后的宽度被压成 0**
   （实测：column 容器内 auto 宽子项，浏览器 260 → 手写实现 0）。
2. **taffy 的 `location` 已含 `content_box_inset`（padding + border）偏移**，
   故叠加绝对坐标时**不要再加父 padding**（实测：三层嵌套用例所有子级坐标都比浏览器大 10dp = 父 padding）。
3. **布局边界 = 显式宽高 ∧ 有子级**。「有子级」不可省：叶子若被判为边界，
   脏传播会停在叶子自己，auto 尺寸的祖先会漏重排。

## 运行

```bash
# 构建产物统一落在 spike/target（★不写内置盘）
CARGO_TARGET_DIR=../../spike/target cargo test
```

## ★HA4：`proteus_layout_node_rect`（单节点绝对几何点查询）

供宿主放置**原生组件**（⑦ 号接口）用。为什么单独一个入口而不是复用 `rects_bin`：
后者返回**最近一次重排范围内**的矩形（V4 的性能设计），而原生 View 的摆放不能依赖
"它恰好在最近那次 scope 里" ⇒ 点查询总是拿得到（节点不存在/`display:none` ⇒ 明确报错，
不给 0 矩形）。
