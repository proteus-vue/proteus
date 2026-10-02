# Proteus 主流框架路由调研与启示

> **调研日期**：2026-10-02
> **调研范围**：uni-app（DCloud）、Taro（京东）、React Native + React Navigation、Flutter（Navigator 1.0 / 2.0 + go_router）、Next.js App Router（含 Pages Router 对比）、Nuxt 3、Vue Router 与微信原生小程序、鸿蒙 ArkUI（router vs Navigation / NavPathStack）。
> **方法论说明**：
> 1. 事实来源以**官方文档**为主（逐页 WebFetch 抓取正文），社区证据统一取自 **GitHub 官方 REST API**（`/search/issues`）返回的 issue 元数据（标题/状态/reaction 数）；本机无 `gh` CLI。
> 2. 搜索引擎（DuckDuckGo/Bing/Mojeek/SearXNG）在本环境全部触发人机验证、403 或结果污染，**未采信任何搜索摘要**；因此凡官方文档抓取不到的表述，一律标注「未核实」。
> 3. 微信官方 API 文档（`developers.weixin.qq.com/miniprogram/dev/api/...`）为前端渲染，多次抓取（含代理）均无法取到正文；微信官方《页面路由》指南正文**可**抓取（已引用），但其中**不含**「十层」数字。该数字的官方来源见 Taro 文档（下文注明）。
> 4. 版本锚点：Next.js 文档版本 16.3.8（页面 frontmatter）；go_router 18.0.2（pub.dev 列表）；鸿蒙 `router` 自 API 18 废弃；Taro RN 路由包依赖 `@react-navigation/*` 6.x（package.json 实测）；其余页面未标注版本。
> 5. 术语：本文中「配置式」= 路由表写在配置文件/对象里；「文件约定式」= 目录/文件名即路由；「代码声明式」= 以组件树或路由对象数组在代码中声明。

---

## 一、结论摘要表

| 框架 | 路由定义形态 | 最大优点 | 最大痛点 |
|---|---|---|---|
| **uni-app** | **配置式**：`pages.json` 的 `pages` 数组，第一项即首页 | 一套配置多端编译；分包 + 预下载 + 条件启动页 | 层级限制只写「有」不给数字；tabBar/参数限制多（switchTab 不能带参）；H5 刷新后页面栈消失 |
| **Taro** | **配置式**：`app.config.ts` 的 `pages` 数组 + 页面 `*.config.ts`（有编译时类型宏） | `defineAppConfig`/`definePageConfig` 提供类型提示；H5 可切换 react-router/vue-router | 直接沿用小程序语义，H5/RN 行为有偏差（H5 `navigateTo` 带参报错等社区 issue）；页面栈上限 10 层（见 §2.2 来源说明） |
| **React Navigation** | **代码声明式**：JSX 组件树（`Screen`）+ 参数对象 | 原生 stack/tab/drawer 全套；平台手势与安卓返回键默认接管 | 参数必须可序列化（否则告警且破坏深链/持久化）；`navigate` vs `push` 语义易混；手势与滚动冲突（iOS/Android 均有 issue） |
| **Flutter** | **命令式**（`Navigator.push`）与**声明式**（Router 2.0 / go_router 路由表）并存 | Router 2.0「整栈替换」，深链不叠页；`StatefulShellRoute` 每 tab 独立栈保状态 | 官方明确「命名路由多数应用不推荐」；`PopScope` 与手势返回回调不一致（issues 高热度，含 go_router 组合） |
| **Next.js App Router** | **文件约定式**：`app/` 目录 + `page/layout/loading/error/...` 特殊文件 | layout 保状态、不重渲染；拦截路由 + 并行路由（可分享的 modal） | 跨多个 root layout 整页刷新；并行路由未匹配时硬导航 404；layout 读不到 searchParams/pathname |
| **Nuxt 3** | **文件约定式**：`pages/` 目录 + 页面内 `definePageMeta` 宏 | 约定式 + 同文件元信息 + `typedPages` + 全局/页面 middleware 分层 | 布局切换时页面转场失效；页面必须单根元素；`typedPages` 仍是实验特性 |
| **Vue Router**（对照） | **代码声明式**：`createRouter({ routes })` 路由表 | 标准 History 语义、命名路由、生态成熟 | 浏览器历史没有「栈上限/栈语义」概念；`params` 配 `path` 会被静默忽略；小程序端无法复用该模型 |
| **微信原生小程序**（对照） | **配置式**：`app.json` 的 `pages` 数组 | 原生栈语义（推入/替换/重启动）+ tabBar 常驻内存 | 页面栈上限（生态文档为 10 层，微信官方正文未给数字）；URL 传参只能字符串且有长度限制；返回语义三来源不一致 |
| **鸿蒙 ArkUI** | **组件式 + 代码栈**（`Navigation` + `NavPathStack`）；或 `@ohos.router`（API 18 起废弃） | `NavPathStack` 栈原语完整（popToName/popToIndex/moveToTop/removeByName）；系统路由表支持动态加载与跨包 | `router` 全量废弃迁移成本；官方文档未承诺栈深度上限；拦截器/深链语义需自行补 |

---

## 二、逐框架 7 问

### 2.1 uni-app（DCloud）

1. **路由定义形态**：**配置式**。`pages.json` 是「全局配置，决定页面文件的路径、窗口样式、原生的导航栏、底部的原生 tabbar 等」；`pages` 数组「第一项为应用入口页（即首页）」。分包用 `subPackages`（页面路径相对分包 root），`preloadRule` 定义分包预下载，`condition`「仅开发期间生效，用于模拟直达页面的场景」。tabBar「只能配置最少 2 个、最多 5 个 tab」。
2. **参数传递**：URL query 字符串，目标页 `onLoad(options)` 收到对象；`onLoad` 参数「来自上一页面的数据（一个 Object）」。**明确限制**：「url 有长度限制，太长的字符串会传递失败」，官方建议改用「窗体通信或全局变量」，并注意特殊字符编码。**未查到**具体长度数值。
3. **导航 API 语义**：`uni.navigateTo` 保留当前页入栈（「不能无限制跳转新页面」「页面跳转路径有层级限制」）；`uni.redirectTo` 关闭当前页再开新页；`uni.reLaunch` 关闭所有页面再开（H5 下「之前页面栈会销毁，但是无法清空浏览器之前的历史记录」）；`uni.switchTab` 关闭其他非 tabBar 页（**「路径后不能带参数」**）；`uni.navigateBack` 接受 `delta`（默认 1），「如果 delta 大于现有页面数，则返回到首页」。跳 tabBar 页只能 `switchTab`。
4. **已知痛点**：
   - **层数限制无数字**：官方只写「层级限制」「不能无限制跳转新页面」，未给具体层数（微信端实际受小程序平台限制，见 §2.7）。
   - **H5 栈丢失**：官方注明「H5 端页面刷新之后页面栈会消失」；社区 issue #3806：手动改 URL 返回后，`onShow` 里同步获取的页面栈不正确（closed）。
   - **返回拦截各端不一致**：`onBackPress` 仅 app/H5/支付宝小程序可用，`from` 取 `backbutton`（左上角按钮与安卓返回键）或 `navigateBack`；官方警告「**onBackPress 上不可使用 async，会导致无法阻止默认返回**」「**iOS 端侧滑返回不会触发 onBackPress**」。
   - **自定义导航栏代价**：`navigationStyle: custom` 后「非 H5 端，手机顶部状态栏区域会被页面内容覆盖」，且「前端导航盖不住原生组件（video/map/textarea 等）」，官方直说小程序下「没有太好的方案」。
   - **tabBar 页生命周期特殊**：tab 切换「页面全部出栈，只留下新的 Tab 页面」，tab 页只触发 `onShow/onHide`，不重走 `onLoad`。
   - **H5 路由兜底困难**：issue #5933（open）希望将未注册在 `pages.json` 的 H5 路由统一拦截到 404；#1537（closed）H5 无法监听左上角返回；#4869（closed）history 模式 webview 调 `history.back()` 白屏。
5. **亮点**：一套配置多端；分包 + `preloadRule`；`condition` 开发期直达页便于调试；`switchTab` 语义显式区分 tab 与普通页。
6. **跨端一致性**：不一致点明确——H5 刷新丢栈；reLaunch 清不掉浏览器历史；自定义窗口动画为 App 独有（小程序不支持）；`tabBar.position: top` 仅微信支持；分包能力仅微信/QQ/百度/支付宝/抖音/快手；tabBar 中按钮仅偶数项生效。
7. **对 Proteus**：见 §3 第 4 条。

**来源**：<https://uniapp.dcloud.net.cn/collocation/pages.html>、<https://uniapp.dcloud.net.cn/api/router.html>、<https://uniapp.dcloud.net.cn/tutorial/page.html>、GitHub issues #5933/#3806/#4869/#1537（uni-app 仓库）、#5786。

---

### 2.2 Taro（京东）

1. **路由定义形态**：**配置式**。改全局配置的 `pages` 属性即可声明页面；`pages` 是必填 String Array，「数组的第一项代表小程序的初始页面（首页）」，「文件名不需要写文件后缀」；`entryPagePath` 可覆盖首页，但「不支持带页面路径参数」。分包 `subPackages`，「H5 和 RN 会把 subPackages 合入 pages」。页面级窗口配置写在页面 `*.config.ts`；v3.4+ 提供编译时宏 `defineAppConfig` / `definePageConfig`「以获得类型提示和自动补全」；`definePageConfig` 定义的配置对象**不能使用变量**，且 `app.config.js`「不支持多端文件的形式」。
2. **参数传递**：URL query（`path?key=value&key2=value2`），目标页用 `Taro.getCurrentInstance().router.params` 读取；官方建议初始化时保存实例。另有 `events` 参数：「页面间通信接口，用于监听被打开页面发送到当前页面的数据」（即小程序 EventChannel）。
3. **导航 API 语义**：`navigateTo`「保留当前页面」；`redirectTo` 在当前页打开（替换）；`switchTab`「跳转到 tabBar 页面，并关闭其他所有非 tabBar 页面」且「路径后不能带参数」；`reLaunch`「关闭所有页面，打开到应用内的某个页面」，URL「路径后可以带参数」；`navigateBack` 的 `delta`「如果大于现有页面数，则返回到首页」；H5 差异：「若入参 delta 大于现有页面数时，返回应用打开的第一个页面（如果想要返回首页请使用 reLaunch）」。
4. **已知痛点**：
   - **10 层栈上限**：Taro 官方 `navigateTo` 文档原文——「**小程序中页面栈最多十层。**」（这是本轮抓取中该数字的唯一官方文档来源；微信官方《页面路由》指南正文未见此数字，未核实）。
   - **H5 与小程序语义分叉**：`navigateTo` 文档注明「H5: 未针对 tabbar 页面做限制处理」；issue #16895：H5 用 `Taro.navigateTo` 带 `?参数` 报页面不存在，而微信小程序正常（open）。
   - **分包/独立分包跳转问题**：#14972（webpack5 prebundle 下跳独立分包报错白屏）、#19501（lazyCodeLoading 下从独立分包返回后页面无响应）、#13962（webview 内 `wx.miniProgram.navigateTo` 无效）均为 open。
   - **Skyline 路由配置耦合**：#18879（open）Skyline 下 `navigateTo` 配 `routeType` 跳转黑屏。
   - **H5 路由模式陷阱**：`h5.router.mode` 默认 `'hash'`；`'multi'` MPA 模式下官方警告「TabBar 会多次加载，且不支持路由动画」；`customRoutes` 会使原路由失效。
   - **RN 端复用第三方栈**：`@tarojs/router-rn` 的 dependencies 实测为 `@react-navigation/native ^6.1.17`、`native-stack ^6.3.29`、`bottom-tabs ^6.5.20`、`react-native-screens ~3.29.0`、`react-native-gesture-handler ~2.14.0`——即 RN 端语义 = React Navigation 语义，与小程序的「页面栈」并非同物。
5. **亮点**：编译时类型宏（`defineAppConfig`/`definePageConfig`）；H5 端可配置 hash/browser/MPA 与 basename、customRoutes；`entryPagePath` 显式指定启动页；一套 `pages` 多端编译。
6. **跨端一致性**：官方明说需用 `process.env.TARO_ENV` 做条件编译；H5 与 RN 不支持大量小程序专有 window 配置；`subPackages` 在 H5/RN 被拍平；tabBar 限制在 H5 不生效。**同一 API 名在多端不是同一语义**（尤其 tabBar 与 delta 越界行为）。
7. **对 Proteus**：见 §3 第 6 条。

**来源**：<https://docs.taro.zone/docs/router>、<https://docs.taro.zone/docs/app-config>、<https://docs.taro.zone/docs/apis/route/navigateTo>、<https://docs.taro.zone/docs/apis/route/navigateBack>、<https://docs.taro.zone/docs/apis/route/switchTab>、<https://docs.taro.zone/docs/apis/route/reLaunch>、<https://docs.taro.zone/docs/page-config>、<https://docs.taro.zone/docs/config-detail>、<https://raw.githubusercontent.com/NervJS/taro/main/packages/taro-router-rn/package.json>、GitHub issues #16895/#14972/#19501/#13962/#18879。

---

### 2.3 React Native + React Navigation

1. **路由定义形态**：**代码声明式**。导航器由 JSX 组件树声明（`createNativeStackNavigator` / bottom-tabs / drawer + `Screen`），当前文档同时支持动态与静态配置；路由名即字符串，导航参数是随调用的对象。
2. **参数传递**：`navigation.navigate('RouteName', { ...params })`，目标页读 `route.params`。官方建议「**We recommend that the params you pass are JSON-serializable**」，理由是状态持久化与深链契约；深链配置下「**By default, all params are treated as strings**」，官方明说无法自动把 `'2020-01-01'` 转成时间戳类型，需要自定义 `parse`/`stringify`。`initialParams` 会在无参跳转时兜底并与传入参数浅合并；`setParams` 是合并更新。保留字段：`screen`、`params`、`initial`、`state` 不可用作自定义参数名。
3. **导航 API 语义**：`navigate`「pushes a new route ... if you're not already on that route」「if you're already there, it does nothing」；`push`「adds another route regardless of the existing navigation history」；`goBack`、`popTo(screen)`、`popToTop()`、`replace`、`reset`、`setParams`。**Android 返回键/返回手势由库自动触发 `goBack()`**。Tab 容器用 `backBehavior` 定义「返回」落点：`firstRoute`（默认）/`initialRoute`/`order`/`history`/`fullHistory`/`none`。
4. **已知痛点**：
   - **不可序列化参数**：troubleshooting 文档原文告警「Non-serializable values were found in the navigation state」，会「break other functionality such state persistence, deep linking, web support etc.」；官方「We don't generally recommend passing functions in params」。
   - **手势返回冲突**：issue #7132（closed）「ScrollViews conflict with the swipe back gesture on iOS」——斜向滑动常被 ScrollView 抢走；#10889（open）Android 开启 `gestureEnabled` 后横向滚动被阻塞、整屏任意位置左滑都可能触发返回；#11564（open）iOS JS Stack 侧滑返回时打出无监听者的警告。
   - **深链冷启动/返回栈**：#1477（closed）深链进入的页面返回不到预期历史；官方 deep-linking 文档承认 **deferred deep linking**「React Navigation does not handle this natively」（需服务端归因，建议第三方）。
   - **`navigate` 的隐式「就地去重」**：已在目标路由上时 `navigate` 什么都不做——初学者常把它当 `push` 用而困惑。
   - **嵌套导航器动作不落地**：「The action 'NAVIGATE' was not handled by any navigator」；`goBack` 无效时应先 `canGoBack()`。
   - **Options 不更新**：配置写错导航器层级时 header/tabBar 选项静默失效。
5. **亮点**：`createNativeStackNavigator` 基于 iOS `UINavigationController` 与 Android `Fragment`，「animations and gestures are handled by the platform, resulting in smoother transitions and better performance compared to the JavaScript-based Stack Navigator」；`freezeOnBlur` 冻结非活跃屏重渲染；drawer 的 `drawerType` 默认「slide on iOS and front on other platforms」；底部 tab 默认懒加载（「Routes are lazily initialized」）且再点已聚焦 tab 内的 stack 会执行 `popToTop`。
6. **跨端一致性**：`gestureEnabled` 只支持 iOS；`fullScreenGestureEnabled` 只 iOS；`headerTitleAlign`「Not supported on iOS. It's always center on iOS and cannot be changed」；drawer 手势「not supported on Web」；`animation` 选项 Android/iOS 有效而 `slide_from_right` 在 iOS 回退默认动画。原生栈依赖 `react-native-screens`，其 bug 归口也在该库。
7. **对 Proteus**：见 §3 第 1、3、5 条。

**来源**：<https://reactnavigation.org/docs/navigating>、<https://reactnavigation.org/docs/params>、<https://reactnavigation.org/docs/native-stack-navigator>、<https://reactnavigation.org/docs/deep-linking>、<https://reactnavigation.org/docs/configuring-links>、<https://reactnavigation.org/docs/bottom-tab-navigator>、<https://reactnavigation.org/docs/drawer-navigator>、<https://reactnavigation.org/docs/troubleshooting>、GitHub issues #7132/#10889/#11564/#1477。

---

### 2.4 Flutter（Navigator 1.0 / 2.0 / go_router）

1. **路由定义形态**：两代并存。1.0 为**命令式**（`Navigator.push(MaterialPageRoute(...))`，`MaterialApp.routes` 命名路由）；2.0 为**声明式**（`Router` + `RouteInformationParser` + `RouterDelegate`，页面栈由 `Navigator.pages` 的 `Page` 列表描述），实践中以 **go_router 的路由表**（声明式配置）为主。go_router 自述「A declarative router for Flutter based on Navigation 2」，支持模板语法 `user/:id`。
2. **参数传递**：路径参数（`user/:id`）与 query 参数走 URL 模板；对象参数走 `state.extra`（源码注释仅一句「An extra object to pass along with the navigation.」）。**官方 doc 明确**：「**The extra data will go through serialization when it is stored in the browser.** Consider a codec for complex data.」社区问题集中在 extra：redirect 后 `extra` 为 null（#146616，open）、`go_router_builder` 强转 `state.extra` 抛类型异常（#106121，open）、子路由 extra 被父路由覆盖（#156410）。
3. **导航 API 语义**：`Navigator.push/pop`（1.0）；go_router 中 `context.go` 是「**replace the current stack of screens**」，`context.push` 才「push a screen onto the Navigator's history stack」，`context.pop(result)` 可返回值（`await context.push<bool>()`）。go_router 文档还警告命令式导航「is known to cause issues with the browser history」，并提供 `Router.neglect` 关闭历史写入。页面型路由与无页路由（对话框）：**page-backed 才可深链**；「When a page-backed Route is removed from the Navigator, all of the pageless routes after it are also removed.」
4. **已知痛点**：
   - **命名路由官方不推荐**：原文「**We don't recommend using named routes for most applications. Instead, use go_router (or another routing package) or use Navigator with MaterialPageRoute.**」其限制：「the behavior is always the same and can't be customized. When a new deep link is received by the platform, Flutter pushes a new Route onto the Navigator regardless of where the user currently is.」且不支持浏览器前进按钮。
   - **冷启动双阶段（iOS）**：官方行为表——iOS 未启动时 Navigator 先拿 `initialRoute`("/")，稍后再收 `pushRoute`；Android 未启动直接以 `initialRoute` 带深链路径进入。**热启动**下 Navigator 收 `pushRoute`，会把深链页面**叠加**在现有栈上（可能重复）；只有 Router 能「replace the current set of pages when a new deep link is opened」。
   - **返回拦截与手势不一致**：go_router 文档确认「**GoRouter and other Router-based APIs are not compatible with the WillPopScope widget.**」；issue #138624（open，92 reactions）「PopScope does not invoke onPopInvoked for iOS back gesture when canPop set to false」；#138737（open，133 reactions）PopScope 与 GoRouter 不兼容、回调经常不触发；#138614（open，246 reactions）呼吁保留 WillPopScope 以支持异步确认框。
   - **状态恢复≠持久化**：go_router 状态恢复文档强调「State restoration does not refer to general purpose state persistence」，`ShellRoute`/`StatefulShellRoute` 必须提供带 `restorationId` 的 `pageBuilder` 才能恢复。
5. **亮点**：`StatefulShellRoute`「creates separate Navigators for each of its nested branches（parallel navigation trees）」，每个 branch 保有自己的导航栈与历史，`StatefulNavigationShell.goBranch(index:)` 切分支，`indexedStack` 默认无动画但可换容器；go_router 提供 `redirect`（按应用状态改路）、`errorBuilder`、类型化路由（Type-safe routes 主题专章）；`PopScope`/`NavigatorPopHandler` 提供预测性返回接入（虽有上述缺陷）。
6. **跨端一致性**：正是 Flutter 的深链行为按平台分叉的重灾区——iOS/Android 冷启动行为不同（上表）；Web 默认 `/#/path` fragment 模式，可配 URL strategy；Router 与浏览器 History API 打通（「Apps using the Router class integrate with the browser History API」），命名路由则不支持前进键。
7. **对 Proteus**：见 §3 第 2、5 条。

**来源**：<https://docs.flutter.dev/ui/navigation>、<https://docs.flutter.dev/ui/navigation/deep-linking>、<https://pub.dev/packages/go_router>、<https://pub.dev/documentation/go_router/latest/go_router/StatefulShellRoute-class.html>、<https://raw.githubusercontent.com/flutter/packages/main/packages/go_router/doc/navigation.md>、<https://raw.githubusercontent.com/flutter/packages/main/packages/go_router/doc/state-restoration.md>、<https://raw.githubusercontent.com/flutter/packages/main/packages/go_router/lib/src/state.dart>、GitHub issues #138614/#138737/#138624/#146616/#106121/#156410。

---

### 2.5 Next.js App Router（含 Pages Router 对比）

1. **路由定义形态**：**文件约定式**。「Next.js uses file-system based routing」——`app/` 下文件夹即 URL 段，特殊文件承载 UI：`page`（页面）、`layout`（共享布局）、`loading`、`error`、`not-found`、`default`、`template`、`global-error`、`route`。动态段 `[slug]`、捕获全部 `[...slug]`、可选捕获全部 `[[...slug]]`（`/shop/[[...slug]]` 同时匹配 `/shop` 与 `/shop/a/b`，`params.slug` 类型为 `string[] | undefined`）。**Pages Router 对比**：同样是文件约定（`pages/about.js` → `/about`，`pages/posts/[id].js`），但无嵌套 layout 约定——布局靠 `_app.js` 全局包裹或 **per-page `getLayout` 模式**（`Component.getLayout ?? ((page) => page)`）手工实现，实践中生态转而依赖 `useRouter().events` 与手写守卫。
2. **参数传递**：Server Component 里 `params`/`searchParams` 均为 **Promise**（v15 起；v14 及以前同步），须 `await` 或 React `use()`；Client Component 可用 `useParams`/`useSearchParams`。类型由生成的 `PageProps<'/blog/[slug]'>`/`LayoutProps<'/dashboard'>` 全局助手提供，「Types are generated during next dev, next build or next typegen」。动态段类型固定为 `string | string[] | undefined`，因为「Users can enter any URL into the address bar」——需要运行时校验收窄（官方给 `assertValidLocale` + `notFound()` 范式）。Pages Router 对应 `useRouter().query`（混合了 path 参数与 query，且首次渲染为空，需 `isReady` 判断——此细节本轮未逐字核验）。
3. **导航 API 语义**：`<Link href>` 客户端软导航（视口内自动预取；静态路由全量预取，动态路由跳过或仅预取加载壳）、`router.push/back/refresh`；原生 `window.history.pushState/replaceState` 与 Next 路由集成。跨多个 root layout 的导航会「cause a full page load」。
4. **已知痛点**：
   - **layout 不重渲染带来的信息盲区**：官方 caveats 原文「Layouts do not rerender on navigation, so they cannot access search params which would otherwise become stale.」「Layouts do not re-render on navigation, so they do not access pathname」「Layouts do not have access to the route segments below itself」——布局顶栏想高亮当前项必须下沉到 Client Component 用 hook。
   - **loading.js 覆盖不到 layout 的取数**：「it cannot show a fallback for uncached or runtime data access in the layout itself」，未启用 Cache Components 时导航会阻塞到 layout 渲染完。
   - **error.js 边界缺口**：官方原文「It does not wrap the layout.js or template.js above it in the same segment. To handle errors in the root layout, use global-error.js.」且错误边界不捕获事件处理器/异步回调中的错误。注意：Next 16.3 文档中 `retry()` 已是稳定 prop（v16.3.0 起），旧文常写 `reset`。
   - **并行路由 / 拦截路由的组合坑**：并行路由未匹配时硬导航「render a default.js file for the unmatched slots, or 404 if default.js doesn't exist」；拦截路由「`(..)` convention is based on route segments, not the file-system」，与 route groups 组合大量踩坑——issue #53170（closed，56 reactions）「Intercepting routes don't work with route groups」、#54173（closed）`revalidatePath` 对 parallel/intercepting modal 失效、#53188（closed）query 参数 + 软/硬导航组合失效、#51414（closed）动态路由 + 拦截失效。
   - **样式/状态被「整页」重置**：跨 root layout 导航是整页刷新；`global-error` 不带全局样式（主题切换类名不会生效）。
   - **路由组冲突**：不同组解析到同一 URL（`(marketing)/about` 与 `(shop)/about`）「would both resolve to /about and cause an error」。
5. **亮点**：嵌套 layout 且「On navigation, layouts preserve state, remain interactive, and do not rerender」；拦截路由让 modal「shareable through a URL / preserving context when refreshed / closing on backwards navigation」；并行路由把多个 slot（`@team`/`@analytics`）同屏独立流式渲染，各自独立 loading/error；`loading.tsx` 把页面自动包进 `<Suspense>` 实现流式导航；路由类型由构建期生成（PageProps/LayoutProps）。
6. **跨端一致性**：Next 只跑 Web，但有「软/硬」两态：软导航保留 layout 与状态、硬刷新丢客户端状态（并行路由靠 `default.js` 补位）；这与小程序「页面卸载」的语义完全不同，是「约定式路由」在本任务中的主要参照面。
7. **对 Proteus**：见 §3 第 1、3 条。

**来源**：<https://nextjs.org/docs/app/getting-started/layouts-and-pages>、<https://nextjs.org/docs/app/api-reference/file-conventions/layout>、<https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes>、<https://nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes>、<https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes>、<https://nextjs.org/docs/app/api-reference/file-conventions/route-groups>、<https://nextjs.org/docs/app/api-reference/file-conventions/error>、<https://nextjs.org/docs/app/getting-started/error-handling>、<https://nextjs.org/docs/app/getting-started/linking-and-navigating>、<https://nextjs.org/docs/pages/building-your-application/routing/pages-and-layouts>、GitHub issues #53170/#54173/#53188/#51414。

---

### 2.6 Nuxt 3

1. **路由定义形态**：**文件约定式**。「Every Vue file inside the `pages/` directory creates a corresponding URL (or route)」——`posts/[id].vue` → `/posts/:id`；`[[slug]].vue` 为可选参数（同时匹配 `/` 与 `/test`）；`[...slug].vue` 捕获全部（`/hello/world` → `slug: ["hello","world"]`）；`parent.vue` + `parent/child.vue` 形成嵌套路由，需在父组件放 `<NuxtPage>`；`name@view.vue` 命名视图。页面级元信息用 `definePageMeta`（同文件宏）。
2. **参数传递**：动态段经 `route.params`（`useRoute()`）读取；query 走 `route.query`；类型由 `typedPages`（实验）提供——`experimental.typedPages: true`「Enable the new experimental typed router using unplugin-vue-router」，可对 `navigateTo`/`<NuxtLink>`/`router.push()` 类型化，并支持 `useRoute('route-name')` 的 typed params。
3. **导航 API 语义**：`navigateTo('/path')`（可 server 302/301）、`<NuxtLink>`（渲染 `<a>`，视口内自动预取，水合后 JS 导航）、`useRouter().push`；守卫用 `defineNuxtRouteMiddleware`——「redirect or route cancellation is handled by returning a value」，`return abortNavigation()` 中止、`abortNavigation(error)` 报错、`return navigateTo('/login')` 改道。全局 middleware 放 `app/middleware/*.global.ts`，官方定义「run on every route change」；执行顺序「Global first, then page-defined middleware in array order」，全局按文件名字母序。SSR 首屏「will be executed both when the page is rendered and then again on the client」；middleware「does not run for server routes」。
4. **已知痛点**：
   - **转场与布局切换互斥**：官方原文——布局变化时「the page transition you set here will not run.」（页面切换同时换布局，则页面转场不执行，需用 layout transition）；`<NuxtPage :transition>` 上设的转场「cannot be overridden with definePageMeta」。
   - **页面必须单根**：「Pages **must have a single root element** to allow route transitions between pages. HTML comments are considered elements as well.」
   - **宏约束**：`definePageMeta`「compiled away so you cannot reference it within your component」「Make sure not to reference any reactive data or functions that cause side effects」；`validate` 返回假值即 404（可返回 `status/statusText`）。
   - **参数校验靠手写**：`validate` 是唯一内建的路由级校验入口；typedPages 仍实验，「按 pnpm 配置需 hoist unplugin-vue-router」。
   - **父子路由优先级**：「Named parent routes will take priority over nested dynamic routes.」命名父路由会截胡动态子路由——易踩。
   - **View Transitions 仍实验**：官方 Known Issues「View Transitions completely freeze DOM updates whilst they are taking place」。
5. **亮点**：约定式路由 + 同文件 `definePageMeta` 收拢 meta；`typedPages` 让 `navigateTo`/`NuxtLink`/`useRoute` 全链路类型化；middleware 三档（匿名/具名/全局）+ `abortNavigation`/`navigateTo` 返回值式守卫（比 vue-router 的 `next()` 更函数式）；`NuxtLink` 自动预取；`route.meta` 合并嵌套 meta。
6. **跨端一致性**：Nuxt 主战场是 Web（SSR/静态/边缘），核心不一致点是「服务端首屏会跑一遍 middleware、客户端再跑一遍」——这是「一套代码多端执行」的典型案例：拿不到 DOM/客户端态的服务端分支必须显式跳过。
7. **对 Proteus**：见 §3 第 6 条。

**来源**：<https://nuxt.com/docs/3.x/getting-started/routing>、<https://nuxt.com/docs/3.x/api/utils/define-page-meta>、<https://nuxt.com/docs/3.x/api/utils/define-nuxt-route-middleware>、<https://nuxt.com/docs/3.x/getting-started/transitions>、<https://nuxt.com/docs/3.x/guide/going-further/experimental-features>、<https://raw.githubusercontent.com/nuxt/nuxt/main/docs/2.directory-structure/1.app/1.middleware.md>、<https://raw.githubusercontent.com/nuxt/nuxt/main/docs/2.directory-structure/1.app/1.pages.md>。

---

### 2.7 Vue Router 与微信原生小程序（对照基准）

**Vue Router**（Web 标准栈模型）：
1. **定义形态**：**代码声明式**路由表（`createRouter({ routes })`），`name` 命名路由。
2. **参数传递**：`params` 与 `query` 严格区分。官方 caveat 原文：「**params are ignored if a path is provided, which is not the case for query**」——`router.push({ path: '/user', params: { username } })` 会静默丢掉 params；命名路由才会编码 path 参数。「Params should be string or number (arrays allowed for repeatable params); other types get stringified.」
3. **导航语义**：`push` 入历史栈；`replace`「navigates without pushing a new history entry」；`go(n)` 同 `window.history.go(n)`，「fails silently if there aren't that many records」；**没有页面栈上限、没有 tabBar、没有卸载/保活语义**——一切由浏览器历史 + 组件生命周期决定。
4. **痛点**：路径参数与 query 的互斥规则反直觉；非字符串参数被静默 stringify；没有内建的路由级「校验/404」语义；对移动端返回手势无感知。
5. **亮点**：命名路由 + 类型化（社区生态）、`replace` 语义干净、守卫体系成熟。
6. **跨端一致性**：不同 history 模式（hash/web history/abstract）行为一致——这是它被 Taro H5/RN 复用为路由层的原因。

**微信原生小程序**（小程序平台事实基准）：
1. **定义形态**：**配置式**，`app.json` 的 `pages`，第一项为初始页面。
2. **参数传递**：页面路径后带 query 字符串，`onLoad(options)` 取；跨页通信另有 EventChannel（`events`）。长度限制：uni-app 文档原文「url 有长度限制，太长的字符串会传递失败」，**具体数值未查到**。
3. **导航语义**（官方《页面路由》原文）：`navigateTo`「打开一个新的页面，并将其推入页面栈」，目标「必须为非 tabBar 页面」；`redirectTo`「将页面栈当前的栈顶页面替换为一个新的页面」，旧页「被弹出并销毁」；`navigateBack` 至少保留一个页面，「如果页面栈中当前只有一个页面，navigateBack 调用请求将失败（无论指定的 delta 是多少）」；`switchTab`「切换到指定的 tab 页面」，目标必须为 tabBar 页，非 tabBar 页被销毁，原 tab 页变成「悬垂页面」；`reLaunch`「销毁当前所有的页面，并载入一个新页面」，且「**并不等于小程序重启**」（AppService 与 JS 全局不被重置）。tabBar 页面首次创建后成为「悬垂页面」常驻，切回仅 `onShow`。
4. **痛点**：
   - **10 层栈上限**：Taro 官方文档原文「小程序中页面栈最多十层。」（微信官方正文未给数字，标注为生态文档来源）；uni-app 只说「层级限制」。
   - **返回语义三来源**：导航栏返回键 / 安卓物理返回 / 代码 `navigateBack` 行为需分别处理（uni-app `onBackPress` 的 `from` 字段即为此设计），且 iOS 侧滑不触发 `onBackPress`。
   - **tabBar 与普通页互斥**：`navigateTo`/`redirectTo` 不能跳 tabBar，`switchTab` 不能带参数、不能从 tabBar 页入普通页栈——两套跳转规则并存。
   - **状态语义**：`reLaunch` 不等于重启；hidden 页（悬垂）何时销毁「以不确定的顺序逐个被销毁」。
5. **亮点**：栈语义显式且简单；tabBar 常驻 + 悬垂页模型对「多 tab 反复切换」性能友好。
6. **跨端一致性**：同一套 API 在微信/支付宝/百度等平台对返回拦截、`from` 字段、原生组件覆盖规则的支持度均不同（uni-app 官方支持表列出差异）。
7. **对 Proteus**：见 §3 第 4、6 条。

**来源**：<https://router.vuejs.org/guide/essentials/navigation.html>、<https://developers.weixin.qq.com/miniprogram/dev/framework/app-service/route.html>、<https://docs.taro.zone/docs/apis/route/navigateTo>（10 层）、<https://uniapp.dcloud.net.cn/api/router.html>、<https://uniapp.dcloud.net.cn/tutorial/page.html>。

---

### 2.8 鸿蒙 ArkUI（能查到的部分）

1. **定义形态**：两代并存。旧代 `@ohos.router`（全局路由，`pushUrl/replaceUrl/back/clear/getParams/...`）；新代 **`Navigation` 组件 + `NavPathStack` 代码栈**（每个 `NavDestination` 承载一个页面）；另有**系统路由表**（`router_map.json`，API 12+）实现动态路由。
2. **参数传递**：`NavPathStack.pushPath(info: NavPathInfo, ...)` / `pushPathByName(name, param)` 携带 `param`（对象）；`pop(result)`/`popToName(name, result)` 可回传结果。官方文档**未给参数序列化限制的说明（未查到）**。
3. **导航语义**：`pushPath`/`pushDestination`（返回 Promise）、`replacePath`/`replacePathByName`、`pop`/`popToName`/`popToIndex`、`moveToTop`/`moveIndexToTop`、「`removeByName`/`removeByIndexes`」、`clear`、`getAllPathName`。系统路由表模式下「跳转前无需 import 页面文件，页面按需动态加载」「系统会自动完成路由模块的动态加载、页面组件构建，并完成路由跳转」。
4. **已知痛点**：`@ohos.router` 官方 API 参考中大多数接口标注「**从 API version 18 开始废弃**」（`pushUrl`/`replaceUrl`/`pushNamedRoute`/`back`/`clear`/`getParams` 等），推荐改用 `UIContext` 实例的 Router 接口；官方同时明确「**推荐使用组件导航（Navigation）**」；系统路由表「支持模拟器但不支持预览器」；路由调用「需等待页面渲染完成（不可在 onInit/onReady 中调用）」。**栈深度上限：官方文档未写（`size()` 取值范围 [0, +∞)），未查到**。
5. **亮点**：`NavPathStack` 栈操作原语最完整（按名/按下标 pop、move、remove）；系统路由表 = 编译期解耦 + 运行时按需加载（与 Proteus 的「编译期生成路由表」思路同构）；`pushDestination` 返回 Promise 便于处理失败。
6. **跨端一致性**：鸿蒙单端（手机/平板/PC），其多端指设备形态；本轮抓取文档未涉及跨 OS 路由一致性问题（未查到）。
7. **对 Proteus**：见 §3 第 3 条。

**来源**：<https://raw.githubusercontent.com/openharmony/docs/master/zh-cn/application-dev/reference/apis-arkui/js-apis-router.md>、<https://raw.githubusercontent.com/openharmony/docs/master/zh-cn/application-dev/ui/arkts-navigation-introduction.md>、<https://raw.githubusercontent.com/openharmony/docs/master/zh-cn/application-dev/ui/arkts-navigation-cross-package.md>、<https://raw.githubusercontent.com/openharmony/docs/master/zh-cn/application-dev/reference/apis-arkui/arkui-ts/ts-basic-components-navigation.md>。

---

## 三、对 Proteus 的启示（可执行结论）

> 前提：Proteus 现状为「编译期静态生成路由表（`scripts/gen-routes.ts` + `<route>` 块 meta）+ 运行时禁止动态注册页面 + 两端同一套路由配置（Skyline routeType / App 自研）」。以下对照该现状。

1. **【抄】把「容器保状态、页面不重建」变成显式运行时语义**（来源：Next.js「On navigation, layouts preserve state, remain interactive, and do not rerender」+ RN tab 的 `detachInactiveScreens`/`freezeOnBlur`）——Proteus 的 tabBar 页常驻与嵌套路由应在 `auto-routes.ts` 产物上显式标注「保留/冻结/卸载」三态，并加 golden 测试钉住，而不是依赖平台默认行为。
2. **【抄】路由 API 拆分「声明式定位（整栈替换）」与「命令式 push（叠栈）」**（来源：go_router `context.go` 替换栈 / `context.push` 叠栈 / `context.pop(result)` 回传；对比 RN `navigate` 的隐式「已在栈上就不动」歧义）——Proteus 统一 API 建议双通道命名（如 `router.go` vs `router.push`），并禁止 `navigate` 式隐式去重。
3. **【抄】补全栈操作原语 + 未匹配路由硬语义**（来源：鸿蒙 `NavPathStack.popToName/popToIndex/moveToTop/removeByName`；Next.js 并行路由「no default.js → 404」）——在现有 `navigateTo/redirectTo/switchTab/reLaunch` 之上补 `popTo(name/path)`、`replaceAt(index)`、`removeByName`，并明确「路由表未命中 = 404 页」而非静默失败。
4. **【避】参数通道必须分层且「可序列化 / 不可序列化」分开建模**（来源：小程序 URL 长度限制 + EventChannel；RN「params 必须 JSON-serializable」；go_router「extra goes through serialization when stored in browser」）——Proteus 的路由参数（写 URL/状态、可深链可恢复）与会话对象（EventChannel/extra 语义、明确标注深链或重启后丢失）在类型系统上是两种东西，后者不得混入路由记录。
5. **【避】返回意图收敛成单一可拦截模型**（来源：uni-app「iOS 侧滑返回不触发 onBackPress」「onBackPress 不可 async」；Flutter #138624/#138737：`PopScope` 在 iOS 手势 + go_router 下回调不触发；RN backBehavior 六档枚举）——Proteus 应把系统返回键、iOS 侧滑、导航栏返回、代码返回统一为「返回意图」事件，并保证异步拦截（确认弹窗）在全部入口生效；同时为手势返回提供显式开关（对齐 RN `gestureEnabled`、微信 `disableSwipeBack` 的做法）。
6. **【超越】用「编译期路由表 + 运行时可恢复状态」超越小程序模型**（来源：鸿蒙系统路由表「无需 import、按需动态加载」；Next.js 类型化 `PageProps`；Nuxt `typedPages`；小程序 10 层上限与 URL 传参限制）——Proteus 已具备编译期路由表与 `<route>` 参数类型声明（`"params": { "id": "string" }`），下一步应把「参数拼错 = 编译错误」「路由不存在 = 编译错误」「状态恢复所需的序列化契约由生成器校验」三件事做成默认能力，并把「无 10 层上限」（App/Skyline 复用引擎，设计方案 §3.4）作为与小程序生态对标的明确卖点验证并写进验收。

---

## 附：未核实 / 未查到清单（如实记录）

| 项目 | 状态 |
|---|---|
| 微信官方文档中「页面栈最多十层」原文 | 未直接核验（官方 API 页前端渲染抓不到；官方《页面路由》指南正文无该数字）；数字依据 Taro 官方文档 |
| uni-app `navigateTo` 具体层数上限数值 | 未查到（官方只说「层级限制」） |
| 小程序 URL/query 参数具体长度上限数值 | 未查到（uni-app 只说「有长度限制」，无数字） |
| React Navigation 文档标注的版本号 | 未从抓取正文核验（站点当前主版本通常记为 7.x） |
| Taro RN 端 `navigateTo` 的具体映射实现细节 | 未从文档核验；仅核验 `@tarojs/router-rn` 依赖 `@react-navigation/*` 6.x |
| 鸿蒙 NavPathStack 最大栈深度 | 官方文档未写（size 取值 [0, +∞)），未查到 |
| 鸿蒙路由拦截器 / 应用间深链 | 抓取到的文档未覆盖（未查到） |
| Next.js v15 之前 Client 端 `useRouter().query` 首次渲染为空需 `isReady` 的细节 | 未逐字核验（本轮未抓取该页） |
| uni-app `onBackPress` 返回 `true` 阻止默认返回的原文 | 抓取页只给「不可使用 async，会导致无法阻止默认返回」；`return true` 写法未逐字核验 |
