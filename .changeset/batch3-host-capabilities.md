---
'@proteus-vue/components': minor
'@proteus-vue/component-ir': minor
'@proteus-vue/plugin-vite': patch
---

端对齐批次 3（宿主能力）全部收口 + 标尺精度修复

- **批次 3 八组件对齐官方属性 100%**（+88 属性）：
  - `p-media`（video）6→47/47：播放控制 / 控件显隐族（show-*）/ 手势族 / 弹幕族 / 画中画族 /
    投屏·截屏·后台播放 / **DRM 族**（is-drm·provision-url·certificate-url·license-url）
  - `p-map` 7→29/29：缩放族 / 图层族（polyline·circles·polygons·include-points）/ 个性化 / 视角 / 交互族 / setting
  - `p-camera` 2→5/5：mode·resolution·frame-size（+ stop/scancode 事件）
  - `p-canvas` 0→3/3：官方 `type` **归一**为框架 `engine` + canvas-id·disable-scroll
  - `p-webview` 1/1：补 load 事件（跨端同名）
  - `p-ad` 3→4/4：ad-theme
  - `p-rich-text` 0→4/4：nodes·space·user-select·mode（source 保留为别名）
  - `p-draggable` 0→13/13：**能力真升级**——此前 MP 端仅 `capabilityWarnOnce('元素静态')` 静默降级
    （Web-only 实现），改为原生 `<movable-area>`+`<movable-view>` 双端同语义（含 area 侧 scale-area）
- **标尺精度修复（生成器）**：官方页把**子对象 schema**（map 的 marker/polyline/polygon/circle/control/
  position、rich-text 的 node/text 字段）与组件属性混在同页不同 h2 区块——全页扫描误计入清单
  （map 61→43、rich-text 8→4；官方属性总数 793→771），制造虚假缺口并诱导把端私有结构固化成框架语义
  （违反 G-31 铁律）。改为只采四类属性区块（通用属性/属性说明/Skyline 特有属性/WebView 特有属性）。
- **属性归一按 tag 限定**（`SEMANTIC_ALIAS_BY_TAG`）：同名不同义不进全局别名表
  （官方 `canvas.type`=渲染上下文 vs `button/scroll-view.type`=视觉模式；`movable-view.scale` 布尔 → `scaleEnabled`）。
- `@proteus-vue/plugin-vite`：`MP_ONLY_TAGS` 补宿主能力原生标签（rich-text/map/camera/canvas/ad/web-view），
  消除 Web 端死分支的 resolveComponent 告警。
