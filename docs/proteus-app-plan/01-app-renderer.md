# 01 · App 端 Vue 自定义渲染器（M-App）

## 目标

`@proteus-vue/renderer-app`——用 Vue 官方 `createRenderer` 定义原生 host config，**标准 Vue SFC 直接运行**于 iOS/Android 原生视图。

## 1. 包结构

```
packages/renderer-app/
├── src/
│   ├── index.ts          # createAppRenderer（createRenderer 包装 + 平台注入）
│   ├── host/
│   │   ├── view.ts       # view 原生视图 host（iOS UIView / Android View）
│   │   ├── text.ts       # text 原生视图 host
│   │   ├── props.ts      # 样式/属性映射（rpx → dp？样式系统对齐 Web/MP）
│   │   └── events.ts     # 事件桥（Vue 事件 → 原生手势/触摸）
│   ├── router-adapter.ts # 路由适配（router-plan routeType → 原生导航栈）
│   └── bridge.ts         # 原生能力桥（capabilities app adapter 注册）
├── platforms/
│   ├── ios/              # iOS 原生工程骨架（Swift/ObjC 视图容器）
│   └── android/          # Android 原生工程骨架（Kotlin 视图容器）
└── package.json
```

## 2. createRenderer host config（核心）

```ts
import { createRenderer } from '@vue/runtime-core'
import type { RendererOptions } from '@vue/runtime-core'

const hostConfig: RendererOptions<NativeNode, NativeElement> = {
  // ★view 容器：iOS UIView / Android View（原生层级树）
  createElement(type, _props, _root, _stack) {
    return createNativeView(type) // view → 原生视图容器
  },
  // ★text：原生文本节点
  createText(text) {
    return createNativeText(text)
  },
  // ★属性/样式同步（Web style → 原生布局属性；对齐 Web/MP 视觉）
  patchProp(el, key, _prev, next) {
    applyProp(el, key, next)
  },
  // ★事件桥（@click → 原生手势；对齐 EVENT_MAP 语义）
  createComment() { return createNativeComment() },
  setText(node, text) { node.setText(text) },
  insert(child, parent, anchor) { parent.insertNative(child, anchor) },
  remove(child) { child.removeFromParent() },
  setElementText(el, text) { el.setChildren([text]) },
  parentNode(node) { return node.parent },
  nextSibling() { return null }, // 原生扁平布局（对齐虚拟列表切片思想）
  querySelector() { return null },
  setScopeId() {},
  cloneNode() { return null },
  insertStaticContent() { return [] },
}
export const renderer = createRenderer(hostConfig)
```

## 3. 样式系统（★三端视觉一致的关键）

| 来源 | Web/MP | App |
|------|--------|-----|
| 像素 | px | dp（rpx 设计稿 → dp 换算，对齐 rpxRatio） |
| 布局 | CSS flex | 原生 flexbox 引擎（Yoga / flexbox-layout） |
| 语义类 | proteus-* 基础样式 | 原生样式表（h1-h6/p/a 对齐） |

## 4. 路由/状态桥

- **router app adapter**：复用 `createRouter` API（守卫/参数/routeType）→ 原生导航栈（UINavigationController / Fragment 栈）；routeType 转场 → 原生转场动画
- **Pinia 同步**：App 侧 Pinia 原生（Vue 运行时天然可用）——无需桥，原生视图渲染时读响应式 state

## 5. 能力桥（复用 platform-plan）

- capabilities 描述文件 `adapters.app`：原生能力实现（登录/分享/生物识别/支付）
- `CapabilityRegistry`（B2 已交付）解析 app adapter —— 三端（web/skyline/app）同契约

## 6. 批次（详见 09-execution-batches.md B1-B5）

1. **B1 renderer 骨架**：createRenderer + 最小 host（view/text/事件）+ 空原生工程
2. **B2 host 完整**：props/样式/事件/diff + iOS/Android 视图实现
3. **B3 路由/状态桥**：router app adapter + routeType 原生转场
4. **B4 capabilities app adapter**：原生能力桥
5. **B5 demo**：同一份示例代码 iOS/Android 跑通

## 7. 验收

- [ ] 最小 SFC（view/text/事件/样式）在 iOS + Android 原生渲染
- [ ] 路由守卫/参数/routeType 在 App 端可用
- [ ] capability 三端契约（web/skyline/app）完整
- [ ] 与 Web/MP 视觉一致（布局/字体/间距对齐）
