# 调研依据：uni-app / uni-app x 九类 OOM 根因

> 本文档为内存管理方案的设计依据。**结论：uni-app 的 OOM 是多条"结构型泄漏链"叠加，非单一 API 缺陷。**

---

## 摘要

uni-app 体系中的 OOM 并非由单一 API 导致，而是**页面/节点累积、双线程或双运行时副本、显式资源未释放、大对象峰值**共同作用的结果。Proteus 不能把各类规避经验拼接成"最佳实践清单"，而应建立四项基础设施：

1. 以可回收视图承载长列表，从组件模型上禁止全量节点假设
2. 为每个跨层、跨运行时资源设置明确所有者、引用方向和销毁点
3. 让 JSI/FFI 句柄、Native Handler、定时器、图片解码及 GPU 资源全部进入可观测的引用图
4. 建立"路由压栈 → 页面隐藏 → 页面销毁 → 弱引用回收 → Native 引用清零"的强制验收闭环

---

## 证据边界（重要）

**本研究能确定九类问题的触发机制、典型泄漏链和现有治理边界，但不能据此得出跨设备、跨版本的统一内存阈值。** 公开资料同时混有**编译期 OOM**（`JavaScript heap out of memory`，发生在开发机/CI 的 V8 编译进程）、**运行时 OOM**（发生在用户设备或运行时容器），三者必须分开分析——本方案只关注**运行时 OOM**。

**风险优先级**由"每次操作必然增长"和"无法自然回收"共同决定，而非只看单次峰值：

| 类别 | 风险性质 | 证据确定性 | 对 Proteus 的关键启示 |
|------|---------|-----------|---------------------|
| 1. 长列表 | 全量节点必然累积 | 高 | 回收必须成为组件不变量 |
| 2. WebView/页面栈 | 引擎和 DOM 重复，销毁不完整 | 高 | 页面销毁必须可验证 |
| 3. 图片 | 解码、缓存和原始数据峰值 | 高 | 设置全局预算及 LRU |
| 4. UTS/HMR | 新模块、旧状态与副作用残留 | 中 | 版本化模块与强制卸载 |
| 5. 双线程镜像 | 序列化或双份视图状态 | 高 | 避免每页面重复引擎 |
| 6. 全局泄漏 | 单例、监听、定时器累积 | 高 | 所有权和订阅登记 |
| 7. Skyline/WXS | Worklet 局部状态与线程迁移 | 高（架构）/中（峰值） | 隔离渲染线程状态 |
| 8. JSI/FFI | 跨运行时循环引用 | 高（类比）/中（uni 实证） | 句柄和 owner 可审计 |
| 9. 动画/GPU | 临时位图、Shader、Canvas | 中高 | 峰值预算与帧销毁 |

---

## 1. 长列表：全量 VNode 的必然累积

**核心**：内存增长 = 数据量 × 每项错误节点数，线性数据集被放大为更陡峭的曲线。

uni-app x 官方性能文档指出：列表项中的组件数量会放大 DOM 数量，每个 `list-item` 的 DOM 数 × item 总数 → 大量 DOM → 卡顿和崩溃。

- **vdom/Vue 传统 `v-for`**：为**所有**列表数据创建 VNode，即使节点未进视口
- **`uni-recycle-view`**：只创建有限 VNode 并循环复用，但仅适用于单 `for` 场景，**2.0 起要求 item 高度一致**
- **uni-app x 蒸汽模式 `list-view`/`waterflow`**：系统自动回收复用，官方称可处理 4000 行 / 20 万元素——但"20 万"是能力描述，**非统一内存测量值**

**三个累积维度**（必须分别治理）：
- **节点模型**：`v-for` 全量展开、每格嵌套多组件 → VNode/DOM/原生 View/Layer 同步增长
- **数据源**：分页接口不断 `push`、缓存完整数据集 → 响应式代理 + Watcher 持续存活
- **事件与闭包**：`() => this.handler(item)`、内联事件 → 回收池复用时仍保留旧引用

**关键**：仅 `bigList = null` **不能证明**列表组件、事件函数、原生 View 已销毁。

**Proteus 启示**：不能只提供单一 VirtualList，须区分**定高 / 动态高 / 瀑布流 / 富交互 cell**四种策略（详见 `05-recyclable-views.md`）。验收须同时看**内存曲线 + 节点数**。

---

## 2. WebView/页面栈：重复引擎 + 销毁依赖显式断链

**核心**：多页面成本不只来自业务对象，还来自**每页面重复的 JS 引擎、DOM、样式、框架运行时**。

- 微信官方：传统 WebView 模式下**每页面一个 WebView 实例 + 重复注入公共资源**；Skyline **多页面共享一个渲染引擎** → 页面内存明显降低
- uni-app 非 H5 端：逻辑层（JS）+ 视图层（WebView / nvue 原生渲染）分离
- **Android 官方**：仅将 WebView 从布局移除、或等 Activity 结束，**不足以保证释放**。完整销毁至少需：`stopLoading → clearHistory → removeFromParent → destroy() → ref = null`

**本质是"最后一个引用未被切断"**，常见路径：
- 全局路由 / dialog 队列持有页面
- WebView JS context 被 native bridge 强引用
- `plus.webview` 未在 `onUnload`/`onDestroy` 关闭
- `setInterval` / WebSocket / EventBus / `uni.$on` 指向旧页面
- Activity/Fragment 被静态集合或单例滞留

**Skyline 的两面性**：共享引擎降低每页成本，但**共享边界提高了泄漏影响**——一个长生命周期错误引用可影响多页面。共享池须用弱引用 / 引用计数 / 租约机制。

---

## 3. 图片：LRU ≠ 安全

**核心**：缓存策略只管淘汰顺序，**不管解码后像素总量**。

uni-app x 实现：Android = Fresco 2.5.0，iOS = SDWebImage 5.10.0（默认 7 天缓存），鸿蒙蒸汽模式 = imageknifepro（**内存缓存 256 个 / 磁盘 512 个，LRU**）。

⚠️ "256/512" 是**对象数配额，非 MB**。单张图分辨率、像素格式、透明通道可显著改变实际内存。HarmonyOS 官方明确：缓存上限过大 → 内存占用过高 → 影响稳定性。

**峰值 = 原始字节 + 解码像素 + 纹理/图层**叠加：
- 大图下载、base64、动图、未降采样的 `aspectFill`、列表快速滚动 → 大量 Bitmap/ImageBitmap 并发存活
- `lazy-load` 只控制可见性，**不限制并发解码**
- `will-change: transform` 等合成提示会增加合成资源

**Proteus 启示**：按**页面 + 全局两级**管理并发解码数、Bitmap 池；退出页面撤销未完成请求；长列表用低分辨率占位 + 分块解码；将第三方图片库配额**纳入整体字节预算**。

---

## 4. UTS / HMR：旧版本对象长期可达

UTS 组件生命周期（`NVBeforeLoad`/`NVLoad`/`NVBeforeUnload`/`NVUnloaded`/`unmounted`）提供了资源释放的**标准位置**，但仍是"开发者必须正确实现"的接口，不自动保证回收。

**HMR 特别危险**：新模块加载后，旧模块命名空间、闭包、全局 Map/WeakMap、单例服务、定时器、原生 View 上的 listener 可能仍被运行中的回调引用。模块系统通常只保证"新导入拿到新模块"，**不自动撤销旧模块环境**。

**Proteus 启示**：HMR 须可验证——每次热替换生成 `moduleVersion + ownerEpoch`，副作用进 `EffectRegistry` 按 epoch 撤销，原生侧持 `ownerEpoch`、旧 View 收到事件拒绝回调，CI 做"修改组件 → accept → 反复导航 → heap snapshot"回归。

**双线程镜像**：app-nvue 逻辑层/视图层分离，通信有损耗；**不自动等于"两端各持一份镜像"**，但 diff/patch、序列化缓冲、原生 View 树、样式节点、JS 响应式对象可能**同一时刻共同存活**扩大峰值。默认单向数据流 + 不可变更新包，禁止随意保存 `nativeView` 引用。

---

## 5. 全局状态 / 单例 / 事件总线：最常见的"放大器"

uni-app x 官方 Android 排查文档列举：static 持有 Activity/Context、全局集合持有 UI、Vue `data` 被全局引用、监听器未注销、文件/网络未关闭。

**事件系统的真正问题**：订阅关系**没有所有者**。典型反模式：
```js
onMounted(() => { bus.on('x', this.handle) })   // 缺对称 off
bus.on('x', () => this.doSomething())            // 匿名函数，无法 off
```
官方示例采用可注销的 `callbackId`（`onReady` 注册 / `onUnload` 注销）→ Proteus 应让 `subscribe` **返回 disposer，组件销毁时自动调用**。

**响应式双刃剑**：`reactive([])` 推入全局 store、list item 缓存进 Map、为每项加 Watcher → 对象沿全局根持续存活。uni-app x 甚至专门提醒 `UTSReactiveArray` 泄漏风险。

**动画/Timer/Promise 必须绑定 owner**：`setInterval`/`requestAnimationFrame`/未取消 `fetch`/Promise `.then`/worker 消息若捕获页面 `this` → 对象图无法收缩。帧作用域资源须在**帧末**释放。

---

## 6. 小程序双线程：把局部状态迁到渲染线程

Skyline 核心价值 = **取消每页面独立 WebView + 减少序列化**，而非消除双线程风险。它把问题从"多个完整页面引擎"转为"共享引擎中的渲染线程状态"。

**Worklet 新风险**：局部变量、闭包、动画上下文可能在**渲染线程中长期存在**。官方未公布 Worklet 内存上限/泄漏阈值。

**Proteus 约束**：
1. AppService 保存可序列化状态，渲染线程只保留当前帧最小状态
2. 禁止 Worklet 长期持有大对象、页面节点代理、闭包链
3. 页面 `onUnload` 注销 Worklet/手势/动画/IntersectionObserver
4. 跨线程传递用结构化克隆或受限 schema，**禁止透传 DOM/View 原生句柄**
5. 验证 Skyline/WebView 混跳时引擎切换的资源释放

---

## 7. JSI/FFI：调用越快，生命周期越容易被忽略（Proteus 特有风险）

**这是 Proteus App 端 JSI 直调路线的特有风险**——也是 NativeScript 已踩过的坑。

Bridge 序列化模型中数据经 JSON 拷贝，调用完成易切断关系。**JSI/HostObject/FFI 直接调用则允许 C++/Java/OC 同步持有 JS handle，也允许 JS 长期持有 Native 对象**——跨层对象不再依赖通信消息存活，而直接依赖彼此引用关系。

**NativeScript 官方模型（可直接类比）**：
- **Android**：V8 + ART/Dalvik **两个托管堆**；JS 对象是 Java 对象的代理。即使 JS 对象已不可达，只要 Java 对象仍持大量 Bitmap/String/Buffer 而 JS 堆无压力，V8 未必触发 GC → `OutOfMemoryError`
- 若生命周期管理不当，后果是**双向的**：既可能"回收过晚"（泄漏），也可能"回收过早"（`Attempt to use cleared object reference`）
- **iOS**：无 GC，靠引用计数；Block、Delegate、KVO、`WKScriptMessageHandler`、`JSValue` 保护都可能与 JS 闭包形成**双向存活链**；splice 可能将 JS 引用从弱引用改为强引用

**Proteus 三原则**（详见 `07-jsi-ffi-references.md`）：
| 引用方向 | 默认策略 | 禁止模式 |
|---------|---------|---------|
| JS → Native | 短生命周期本地句柄，调用完释放全局引用 | JS 全局 Map 长期持有 Native |
| Native → JS | WeakRef / 受保护回调 | Block/Listener 强引用 JS 页面闭包 |
| 双向资源 | owner 明确为 JS 或 Native 一侧 | A↔B 循环持有 |

---

## 8. 动画/GPU：帧循环持续创建临时资源

**核心**：不是某一张位图，而是**帧循环持续创建**。`shouldRasterize`、Shadow、filter、MSAA、Shader Program、图集若依赖"最后一次引用后回收"，低端机易形成峰值。

iOS `CALayer.shouldRasterize`：默认 `false`，启用后将 layer 渲染为位图（含阴影/filter），缩放时再生成额外位图——**只对静态复用场景划算**。

**三作用域**（详见 `02-four-layer-governance.md`）：
| 作用域 | 资源 | 释放时机 |
|-------|------|---------|
| 帧 | Path/临时 Gradient/Command Buffer/中间图 | 每帧结束 |
| 动画 | Reusable Cache/Shared Texture/Rasterized Layer | 动画取消或 owner 卸载 |
| 页面 | 静态背景/Shader Program/图集 | 页面销毁 |

---

## 数据来源

- [uni-recycle-view 插件文档](https://ext.dcloud.net.cn/plugin?id=17385)
- [uni-app 性能优化：逻辑层与视图层通信](https://uniapp.dcloud.net.cn/performance)
- [uni-app x App 性能优化](https://doc.dcloud.net.cn/uni-app-x/performance.html)
- [uni-app x image 组件文档（Android/iOS/鸿蒙实现）](https://zh.uniapp.dcloud.io/uni-app-x/component/image.html)
- [uni-app x Android 内存泄漏排查教程](https://doc.dcloud.net.cn/uni-app-x/tutorial/android-memoryleak.html)
- [UTS 组件生命周期文档](https://uniapp.dcloud.io/plugin/uts-component-compatible.html)
- [微信小程序运行时 / Skyline 渲染引擎](https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/skyline/introduction)
- [Android：Manage WebView Memory](https://developer.android.com/develop/ui/views/layout/webapps/manage-webview)
- [HarmonyOS ArkUI Image 多级缓存配置](https://developer.huawei.com/consumer/cn/forum/topic/0203203016629559770)
- [NativeScript Android Runtime Memory Management](https://v6.docs.nativescript.org/core-concepts/android-runtime/advanced-topics/memory-management)
- [NativeScript Memory Management（iOS Splice）](https://v6.docs.nativescript.org/core-concepts/memory-management)
- [Apple：CALayer.shouldRasterize](https://developer.apple.com/documentation/quartzcore/calayer/shouldrasterize)
- [MDN：Optimizing Canvas](https://developer.cdn.mozilla.net/id/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
