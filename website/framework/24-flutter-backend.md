---
title: Flutter 后端
order: 17
group: 渲染层
---

# Flutter 后端

FlutterBackend 是「语义收敛 → Flutter 渲染语义」的映射层（G-27 B5 spike）。同一棵语义 IR，Flutter 后端产出的是 **widget 树**：`layout.grid` 不再是 div，而是 `GridView`；`ui.button` 是 `FilledButton`；`shell.page` 是 `Scaffold`。

> **后端消费 `IRNode.semantic`，不是标签字符串。**
> `SEMANTIC_FLUTTER_MAP` 52 行语义映射 + `WIDGET_MAP` 兼容层——与 compiler 的 TAG_MAP 同哲学：语义收敛，后端决定怎么做。

## toWidgetTree：语义 → widget

`createFlutterBackend()` 的 `createElement` 按 `semantic` 查映射表；`toWidgetTree` 把句柄树序列化为纯 widget 树（spike 断言 / Embedder 桥输入）：

| 语义 | Flutter widget |
|---|---|
| `layout.box` | Container |
| `layout.stack` | Flex |
| `layout.grid` | GridView |
| `layout.fluid` | Wrap |
| `layout.safe` | SafeArea |
| `ui.text` | Text |
| `ui.button` | FilledButton |
| `ui.image` | Image |
| `ui.input` | TextField |
| `ui.list` | ListView |
| `shell.page` | Scaffold |
| `shell.modal` | showDialog |
| `ui.rich-text` | RichText |
| `ui.avatar` | CircleAvatar |
| `ui.canvas` | CustomPaint |
| `engineering.animate` | AnimationController |

另有兼容层 `WIDGET_MAP`，把未带 `semantic` 的旧标签（兼容层 / 历史 p-* 标签）也接进来：

| 兼容层标签 | Flutter widget |
|---|---|
| `view` | Container |
| `text` | Text |
| `button` | FilledButton |
| `input` / `textarea` | TextField |
| `scroll-view` | SingleChildScrollView |
| `switch` / `slider` / `icon` | Switch / Slider / Icon |
| `progress` | LinearProgressIndicator |
| `p-grid` / `p-stack` / `p-split` | Wrap / Flex / Row |

`mapWidgetType` 对未映射标签**透传**——自定义 widget 名直通，不被拦截。

## 一个真实的端到端例子

与仓库测试同源（`tests/dispatcher.test.ts`），`ir` 为 `shell.page > layout.grid > layout.box > (ui.text | ui.button)`：

```ts
import { createFlutterBackend, renderIRTree, toWidgetTree } from '@proteus-vue/render-backend'

const root = renderIRTree(createFlutterBackend(), ir)
const widget = toWidgetTree(root as never)
// 字段节选（完整含 id/props/text/children）：
// { widget: 'Scaffold', children: [{ widget: 'GridView', children: [
//   { widget: 'Container', children: [{ widget: 'Text', text: '商品 A' }] },
//   { widget: 'Container', children: [{ widget: 'FilledButton' }] }] }] }
```

同一份 IR 也渲染给 Headless：两引擎的 nodeOps 调用 trace 逐条一致，语义指纹相同（`['shell.page', 'layout.grid', 'layout.box', 'ui.text', 'layout.box', 'ui.button']`）——H-03「渲染驱动与引擎无关」的机器证据。两个引擎各自映射到自己的控件语言：

| 语义 | Headless | Flutter |
|---|---|---|
| `shell.page` | page | Scaffold |
| `layout.grid` | grid | GridView |
| `ui.text` | text | Text |
| `ui.button` | button | FilledButton |

## 与 Flutter 工程的关系（诚实边界）

当前代码只到 **widget 描述树**（`FlutterWidgetDescriptor`：widget 名 + props + children），不是真机渲染。要真跑起来还差一个宿主桥，如实分级：

- ✅ **已落地**：52 行语义 → widget 映射、nodeOps 树操作、`toWidgetTree` 序列化、conformance 快照门禁中的 flutter 列（`GridView` / `Text` / `FilledButton`…与参考表一致）。
- 📋 **待宿主工程**：Embedder C ABI 桥——`FlutterEngineRun` + `FlutterRendererConfig`（make_current / fbo_callback / present），把描述树投递给真实 Flutter 引擎。`toWidgetTree` 的产物就是这座桥的输入。

`capabilities` 里声明 `layout: 'yoga'`（Flutter 自带布局）、`glass: 'L3'`（Skia/Impeller）、`animation: 'native'`、`textureSharing: true`（Texture / PlatformView 混合）描述的是**接入后的目标能力**——在 Embedder 桥落地之前，请把它们当作路线图而非现状。

## conformance 门禁里的 flutter 列

widget 映射不是「写了就算」——它是 G-31 组件快照门禁的一列，控件 readback 与参考表逐节点比对：

```ts
import { createFlutterBackend, renderComponentSnapshot, createControlReader } from '@proteus-vue/render-backend'
import { checkComponentSnapshot } from '@proteus-vue/component-ir'

const backend = createFlutterBackend()
const snap = renderComponentSnapshot(backend, ir, createControlReader('flutter'))
// snap.children[0].control === 'GridView'（ir 沿用上例：page > grid）
checkComponentSnapshot('flutter', snap) // 错映射直接红
```

仓库门禁（`tests/component-conformance.test.ts`）覆盖 6 后端 × L1 fixtures——flutter 与 native、vue-dom、headless 同在被验之列。详见[一致性验证](/docs/framework/29-conformance)。

## 下一步

- [渲染后端](/docs/framework/23-render-backend)：SPI 契约与切换全景
- [Headless 后端与语义快照](/docs/framework/25-headless-backend)：先在内存树里验证同一份 IR
- [一致性验证](/docs/framework/29-conformance)：flutter 列的快照门禁
