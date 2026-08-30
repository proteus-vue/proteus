# 15 - 页面滚动容器自动包装（Skyline 页面本身不滚动）

> 状态：规划（2026-08 真机实测触发）
> 关联：Skyline 官方文档「滚动容器及其应用场景」——Skyline 滚动必须用 scroll-view（页面是固定视口的 flex 容器）

## 一、问题（真机实测）

mp-semantics-demo 加长列表后（20 区块，内容高约 4000px）：
1. **Skyline 模式**：页面内容**全部叠在一个屏幕内**、无法滚动——Skyline 页面是固定视口的 flex 容器（非滚动容器），内容溢出不滚动
2. **WebView 模式**：内容排布正常（不叠）但仍无法滚动——小程序页面滚动依赖滚动容器语义
3. **Web 端**：正常滚动（浏览器滚动）

**根因**：Skyline 页面本身不滚动——**滚动必须显式用 `<scroll-view>`**（官方滚动容器）。当前框架无自动处理——用户写普通页面（内容超高）无法滚动，违背透明编译承诺。

## 二、现状

- 示例手动包 `<p-scroll-view scroll-y class="msd-page">`（height: 100vh）——**验证可行**（双端一致：MP 原生 scroll-view / Web Vue 组件）
- 但**用户每次都要手动包**——框架应自动处理

## 三、方案：编译器页面模式自动包滚动容器

页面（非组件）模板编译时自动包一层滚动容器，用户无感：

```
源码：<view class="home">…</view>        （页面多根元素）
产物：<scroll-view scroll-y class="proteus-page-scroll">
        <view class="home">…</view>
      </scroll-view>
      + 页面 wxss 注入 .proteus-page-scroll { height: 100vh }
```

### ★页面滚动 API 兼容桥接（用户关切：onPageScroll/onReachBottom 等）

Skyline 页面不滚动后，**页面级滚动 API 全部依赖滚动容器**——自动包装必须桥接（否则静默失效，反黑盒）：

| 页面 API | 桥接目标（包装 scroll-view） | 实现层 |
|---|---|---|
| `onPageScroll(e)` 页面滚动回调 | `bindscroll`（载荷对齐 e.scrollTop/e.scrollLeft） | 编译期：页面 onPageScroll 方法 → scroll-view 绑定；载荷归一 |
| `onReachBottom()` 触底 | `bindscrolltolower` | 编译期绑定 + lower-threshold 默认 50 对齐页面语义 |
| `onPullDownRefresh()` 下拉刷新 | `refresher-enabled` + `bindrefresherrefresh` | 编译期：页面声明 onPullDownRefresh → 启用 refresher |
| `wx.pageScrollTo({ scrollTop })` | 滚动容器 `scroll-top` 属性（运行时查找当前页包装容器） | 运行时桥接（wx 模拟层/MP 原生 wrapper） |
| `createSelectorQuery().scrollOffset()` | 查询指向包装容器（id=proteus-page-scroll） | 运行时 |
| `onReachBottomDistance` 配置 | lower-threshold | 编译期配置 |

**桥接原则**：
- 仅自动包装的滚动容器桥接；**用户手动写 scroll-view/p-scroll-view** 时走原生 scroll-view 事件（不桥接）
- 页面同时声明 onPageScroll 且手动写了 scroll-view：警告（滚动源歧义，反黑盒）
- wx.pageScrollTo 的 Web 模拟层同步支持（滚动容器查找）

### 关键设计点

| 项 | 决策 |
|---|---|
| 包装时机 | template.ts 页面模式（非 isComponent）：顶层多元素 → 包 scroll-view；单元素 → 直接加 scroll-view 包裹（统一包） |
| 高度 | `height: 100vh`（Skyline 视口；tabBar 页面需考虑底部遮挡——后续验证 `100vh` 语义） |
| Skyline 性能 | 默认 list 模式；**长列表优化**（list-view 摊平）后续批次 |
| Web 端 | scroll-view 需进 proteus-* 改写白名单 + Web 模拟组件（overflow div）——当前 p-scroll-view 兜底 |
| 配置 | proteus.config 开关 `page.autoScrollContainer`（默认 true；false 关闭自动包装） |
| 冲突 | 页面已有 scroll-view/p-scroll-view 根 → 不重复包装（检测） |
| 影响 | 所有页面产物结构变化（golden/测试更新）；页面根样式（.home 等）在容器内不受影响 |

### 滚动容器与页面语义

- 包装容器**透明**：样式/事件不拦截（scroll-view 透传）；页面根元素（多根 → 容器内多子节点，Skyline 单子节点优化不适用但功能正常）
- `navigationStyle: custom` 页面：100vh = 视口（无导航栏）✓

## 四、批次

- **批次 1**：template.ts 页面模式自动包 scroll-view + 页面 wxss 高度注入 + 开关 + 测试 + golden 更新
- **批次 2**：**滚动 API 桥接**——onPageScroll/onReachBottom/onPullDownRefresh 编译期绑定 + wx.pageScrollTo 运行时桥接（MP + Web 模拟层）+ 歧义警告
- **批次 3**：Web 端 scroll-view 模拟组件（proteus-scroll-view：overflow div + scroll-y/x）+ 白名单改写 + 类型
- **批次 4**：tabBar/分包/半屏页等特殊场景验证（100vh 语义）+ 长列表 list-view 摊平优化提示 + examples 全页面验证 + 能力文档

## 五、风险与回退

- **布局影响**：包一层 scroll-view（display block/flex）——页面根样式兼容；100vh 在特殊页面（半屏/分包）需验证
- **性能**：Skyline 默认 list 模式（全量节点）——长列表后续 list-view/builder 优化（批次 3）
- **回退**：配置开关关闭；rules.disabled
- **WebView 兼容**：scroll-view 在 WebView 是标准滚动容器 ✓

## 六、验收

- [ ] 普通长页面（不手动包 scroll-view）Skyline 下可正常滚动
- [ ] Web 端滚动容器表现一致（scroll-view 内滚动）
- [ ] 短页面（内容一屏内）无副作用
- [ ] tabBar/分包/半屏页滚动正常
- [ ] 开关/规则可关
- [ ] 700+ 测试全绿 + 双端实测
