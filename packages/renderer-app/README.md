# @proteus-vue/renderer-app

Proteus App 渲染器（app-plan B1 核心）：Vue 官方 `createRenderer` 自定义 host config——标准 Vue SFC 的 App 原生运行时通道（与 Web/MP 编译期通道并列）。

## 用法（B1 核心验证）

```ts
import { createAppRenderer, createMockAdapter } from '@proteus-vue/renderer-app'
import { h } from 'vue'

const adapter = createMockAdapter()
const renderer = createAppRenderer(adapter)
const app = renderer.createApp({ render: () => h('view', { class: 'box' }, [h('text', null, 'hello')]) })
app.mount(adapter.root)

adapter.root.children // [{ tag: 'view', props: { class: 'box' }, children: [{ text: 'hello' }] }]
```

## 架构

```
业务代码（标准 Vue SFC）
├── Web/MP → 编译期通道（现有）
└── App    → @proteus-vue/renderer-app（运行时通道）
              ├── NativeAdapter 接口（原生节点抽象：view/text/事件/样式）
              ├── createAppHostConfig → Vue createRenderer（官方 diff 引擎）
              └── v0.6 正式形态：iOS UIView / Android View 实现 NativeAdapter
```

## 状态（app-plan v2）

- **B1 ✅（本仓）**：NativeAdapter + host config + mock adapter——渲染/更新/卸载接线可单测（无需真机）
- **B2-B5 ⏸ v0.6 正式启动**：原生视图实现（rpx→dp 样式/事件桥）、router app adapter、capabilities app adapter、双端 demo（需 npm 发布 + 原生工程）
- **B6 ⏸**：Vapor 双模式（@vue/vapor 实验版后续）

见 `docs/proteus-app-plan/03-landing-evaluation.md`
