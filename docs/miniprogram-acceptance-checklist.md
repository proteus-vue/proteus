# 小程序真机验收清单（官方能力对齐 · 2026-09-12）

> **背景**：官方能力对齐已达 **255/256 = 99%**（权威标尺 `proteus audit coverage`），但「已落地」此前仅到
> 「有代码 + 有测试」——**未经微信开发者工具/真机运行验证**。本文档是这一层的验收清单与执行指引。
>
> **执行前提**：安装微信开发者工具（本机当前未安装）→ 导入 `examples/dist/mp-weixin`（需真实 AppID + 基础库 ≥2.29.2）。
> 构建：`pnpm run build:mp`。

---

## 1. 已验证（产物层，无需真机）✅

以下已用脚本/编译门禁核实（本清单附带的自动化证据）：

| 项 | 证据 |
|---|---|
| 9 个新增组件 MP 产物四件套齐（wxml/js/json/wxss） | `p-progress`/`p-label`/`p-page-container`/`p-selection`/`p-keyboard-accessory`/`p-camera`/`p-webview`/`p-ad`/`p-map` |
| 平台原生标签正确落产物（含 v-if 双分支） | p-camera `<camera wx:if>`+`<video wx:else>`；p-map `<map>`；p-webview `<web-view>`；p-ad `<ad wx:if>`+`<view wx:else>` |
| 组件注册（页面 `usingComponents`） | `builtin-components-demo`（progress/label/selection）+ `native-components-demo`（camera/map/webview/ad/keyboard-accessory） |
| 组件声明正确 | 各组件 `index.json` = `{component:true, componentFramework:glass-easel, styleIsolation:apply-shared}` |
| 主包体积预算 | 1153 KB < 1200 KB 预算（微信上限 2MB） |
| 编译零错误 + 全量测试绿 | `vue-tsc` 0 error；vitest 3045/3045 |

## 1.5 真机（Skyline 模拟器）实测结果 ✅ 2026-09-12

**环境**：微信开发者工具 2.02.2609082 Nightly（`/Volumes/data1/work/office-applications/wechatwebdevtools.app`）·
已登录（appid `wx33bc04a52024def7`）· 渲染模式 **Skyline** · 模拟器 iPhone 12/13 Pro。

| 页 / 组件 | 实测结果 | 证据 |
|---|---|---|
| **p-progress** | ✅ **线性 40%（蓝）+ success 100%（绿）+ 环形 60%（conic-gradient）全部正确渲染**，百分比文案正确 | 模拟器截图 |
| **p-label** | ✅ 渲染「p-label 关联控件」+ 关联输入框 | 模拟器截图 |
| **p-selection** | ✅ 渲染说明文字 + 「选区：（未选中）」 | 模拟器截图 |
| **p-camera** | ❌ **初测误判为"渲染正常"（实际渲染的是 `<video>`！）** → 🟢 **修复后复验正确**：渲染 `<camera>`（「相机初始化失败」= camera 的 @error 回调） | 见下方「★实测抓出的严重 bug」 |
| **p-map** | ❌ 初测"白板" → 🟢 修复后**渲染真实腾讯地图**（天安门/人民大会堂地标 + 标记 + 版权条「©2026 Tencent」） | 模拟器截图 |
| **p-webview** | ❌ 初测"白板"（空 iframe 容器）→ 🟢 修复后**远程官网 `https://proteus-vue.cn` 完整渲染**（Proteus 首页 hero + 代码块） | 模拟器截图 |
| 页面 `data` 注入 | ✅ `percent:40` / `selected:''` / `camReady:false` 等初始值正确进入逻辑层 | automator `evaluate` |
| 首屏（对照） | ✅ `pages/index` 完整渲染（Proteus 标题 + 导航 + tabBar） | 模拟器截图 |

### ★实测抓出的严重 bug（用户真机观察驱动，已修复）

**用户反馈**：「p-camera 看着像个视频组件？还有音量和亮度调节，p-map 和 p-webview 都是白板」——**观察完全正确**。

- **根因**：平台条件组件（camera/map/webview/ad）用 `v-if="isMp"` 双分支，但 `const isMp = isMpRuntime()`
  是**函数调用** → 编译器归 runtimeInit → 产物写 **实例属性** `this.isMp`（模板只能读 `data`）→
  `wx:if` 恒 false → **MP 端永远渲染 Web 分支**（`<video>` / 空 iframe 容器 / 空占位）——
  用户看到的"视频+音量/亮度手势"正是 `<video>` 默认行为，"白板"正是空宿主容器。
- **修复**：改 `computed(() => isMpRuntime())` → 产物 `ready(){ setData({isMp:...}) }`（首帧前写入 data）。
- **真机复验**：p-camera 现渲染 `<camera>`（error 回调证明）；p-map/webview 正确。
- **回归锁**：tests/component-b6 +4（锁「isMp 进 data、非裸实例属性」；原测试只查 wxml 漏了 js 侧）。
- **教训**：★平台条件组件的模板绑定变量**必须进 data**（编译器警告「实例属性：模板绑定不支持」不可忽略）；
  wxml 断言不足以覆盖此类 bug，须**同时断言 js 产物**。详见 memory 续七十六。

### ★本批验证顺带抓出的框架 bug（2026-09-12，均已修 + 回归锁）

1. **scoped `:class` 三元把比较操作数误后缀**（`packages/compiler/src/template.ts`）：`formatClassBinding`
   对表达式内**所有**字符串字面量加 scope 后缀 → `mode === 'local' ? 'a' : ''` 中判断值 `'local'`
   被改成 `'local-data-v-x'`（条件永不成立）、空串 `''` 被改成 `'-data-v-x'` → **真机 :class 全部失效**。
   修法：新增 `suffixClassLiterals`，跳过比较操作数（前有 `=!<>`）与空串。回归锁 `tests/mp-transform.test.ts`。
2. **`resolveSharedModule` 从插件位置解析框架包**（`packages/plugin-vite/src/plugin.ts`）：pnpm 严格链接下
   `@proteus-vue/{api,runtime,desktop,capabilities,app-config,shared}`（应用声明、非 plugin 依赖）解析失败
   → 返回 null → **这些 `_proteus/*.js` 从不产出**，而页面产物却 `require` 它们（clean build 时 `pages/pinia-demo`、
   `pages/vue-compat-demo` onLoad 崩溃）。修法：新增 `resolveFrom`（真实构建传 `projectRoot`，经
   `createRequire(projectRoot)` 解析）。回归锁 `tests/plugin.test.ts`。**注：此前 stale dist 掩盖了此问题，
   是本次 clean build 才暴露。**
3. **配置字段 `page` 未登记**：`page.webviewPages` 在类型 schema 已存在，但 CLI `KNOWN_FIELDS` 白名单与
   `CONFIG_FIELD_LAYERS` 归属表漏登记 → `config:check` 报「未知字段 page」。已补两处（`page: 'compiler'`）。

### ★p-webview 平台限制实测（2026-09-12，第二批）

**用户诉求**：「webview 应该能加载本地网页吧？做一个加载本地网页 + 加载框架官网 proteus-vue.cn 远程网页，更有说服力」。

**实测结论（诚实边界）**：
1. ✅ **远程官网 `https://proteus-vue.cn` 在 `<web-view>` 内完整渲染**（模拟器截图取证：Proteus 首页 hero/代码块）。
   —— 需 DevTools 勾选「不校验合法域名、web-view（业务域名）」。真机需在微信后台配**业务域名**。
2. ❌ **小程序 `<web-view>` 不支持加载小程序包内的本地 HTML**（平台限制，非框架缺陷）。逐一排除验证：

   | 尝试的 src 形态 | 结果 |
   |---|---|
   | `/webview-local.html`（包根绝对路径） | 空白 |
   | `webview-local.html`（相对路径） | 空白 |
   | `../webview-local.html`（相对页面路径） | 空白 |
   | `data:text/html;base64,...`（内联 data URI） | 空白 |
   | **raw `<web-view>`（绕过 p-webview 组件，直接写原生标签）** | **空白**（证明与组件实现无关） |
   | `https://proteus-vue.cn/`（远程） | ✅ 正常渲染 |

   官方文档对 `src` 仅写「webview 指向网页的链接……其它网页需登录小程序管理后台配置业务域名」，
   未提供本地文件协议支持。**结论：微信 `<web-view>` 的 src 必须是可配置业务域名的 https 网页地址。**

**框架响应（诚实降级，不留白）**：
- `p-webview` MP 端增加 `srcIsUrl` 门控（`/^https?:\/\//`）：**src 为绝对 URL → 原生 `<web-view>`；
  否则走诚实占位**（`<view>` + 提示文案「web-view 仅支持 https 业务域名内的网页；小程序包内本地 HTML
  不受平台支持（Web 端可加载）」）。
- **Web 端不受此限**：`<iframe>` 可加载本地相对路径（`/webview-local.html` 经构建复制到 `dist/web/`，
  preview 服务返回 200 + 内容确证）。
- 演示页 `native-components-demo` 用**分段控件二选一**（本地网页 / 远程官网）——既符合「一页仅一个
  `<web-view>`」的官方硬约束，又同时演示「同一份源码、同一个 `src` 属性，两端各自最优解」的跨端语义。

### 实测发现（真实、非框架缺陷）

1. **★IDE 自动化 API 在该 nightly 版大面积失效**（`getPageMetaByWebviewId ... null`、`page.$()`/`$$()` 对**首页**也返回空、`pageScrollTo` 超时）——**对照实验证明与我们的产物无关**（连已知正常的首页 `view`/`text` 都查不到）。故本轮真机验证以**模拟器截图视觉确证**为准。
2. **`<camera>`/`<map>` 原生组件吞滚动**：`native-components-demo` 页滚动位移极小（原生组件覆盖区不传导手势，与既有 `p-svg-canvas`「原生组件吞触摸」同类）。→ 该页后续验证建议**分区展示**（缩短单页）或改用 `<scroll-view>` 包裹原生组件区。
3. **`<video>` Skyline 调试限制**：DevTools 报「暂未支持 Skyline 下的 video 组件调试，请先到真机预览」——p-camera 的 Web 分支（`<video>`）在 Skyline 下由 `<camera>` 分支接管（v-if），**不影响 MP 端**；但该提示印证了「Web 分支不该进 MP」的设计正确性。

> **结论**：**新增组件的 MP 真机渲染已确证**（Skyline 模拟器）；交互（按钮点击/选区）与需宿主能力项（真机相机/地图/广告）**待真机进一步确认**——交互验证受 IDE 该版本自动化 API 缺陷阻塞，非框架问题。

## 2. 待真机确认（需微信开发者工具/真机）

### 2.1 新增组件渲染与交互（页：`builtin-components-demo`）

| 组件 | 验证点 | 预期 |
|---|---|---|
| `p-progress` | 线性/环形渲染 + 百分比文案 | 线性条随 percent 变化；环形 conic-gradient 环；`status=success` 变绿 |
| `p-label` | 点击 label 聚焦关联 input | 点「p-label 关联控件」→ 输入框获得焦点 |
| `p-selection` | 长按选中文字 → selectionchange | 下方「选区」显示选中字符串；未选中显示「（未选中）」 |
| `p-keyboard-accessory`（2.2） | 输入框聚焦 → 键盘上方工具栏 | 真机（非模拟器）键盘弹起时显示「工具 A / 工具 B」 |

### 2.2 原生/宿主能力组件（页：`native-components-demo`）

| 组件 | 验证点 | 前提/预期 |
|---|---|---|
| `p-camera` | 相机预览 + `initdone` 回调 | 首次弹相机授权；预览出现 → 「相机就绪：是」 |
| `p-map` | 地图渲染 + 标记 + `markertap` | 北京坐标地图；点标记 → 「标记点击次数」+1 |
| `p-webview` | 内嵌网页 | ⚠ **需微信后台配置业务域名**；DevTools 可勾选「不校验合法域名」验证 |
| `p-ad` | 广告位 | ⚠ **需真实 adUnitId**（后台创建）；示例 id 真机/模拟器不展示广告属**预期**，但 `load`/`error` 事件应可见 |
| `p-keyboard-accessory` | 同 2.1 | 真机键盘弹起可见 |

### 2.3 新增能力 Hook（真机调用）

| Hook | 真机验证点 |
|---|---|
| `useCanvas` | Canvas 2D 绘制 + `canvasToTempFilePath` 导出 |
| `useElement` / `useIntersection` / `useMediaQuery` | SelectorQuery 几何 / 交叉观察 / 媒体查询回调 |
| `useVideo` / `useAudio` / `useLivePusher` | 媒体组件实例控制（播放/暂停/进度） |
| `useSocket`（UDP/TCP） | **需真机**（模拟器不支持裸 socket）；UDP send/receive 往返 |
| `useCameraContext` / `useRecorder` | 拍照 / 录音往返 |
| `usePerformance` / `usePreload` | 性能条目读取 / 预加载（workers 分包） |
| `useScreenCapture` | 录屏状态查询（`getScreenRecordingState`） |
| `useAR`（VKSession） | **需真机** + iOS 基础库 ≥2.22.0（v2 算法） |
| `useBeacon` / `useLocalService`（mDNS） | **需真机**（模拟器无 iBeacon/mDNS） |
| `usePrivacy` | 隐私协议授权流程（`getPrivacySetting`/`requirePrivacyAuthorize`） |
| `useIdle` / `useWindow`（setWindowSize 仅 PC）/ `useNavigationGuard` | 空闲调度 / 卸载拦截确认弹窗 |
| `useAd` | 激励视频/插屏/横幅（需真实广告单元） |

## 3. 已知诚实边界（非缺陷，真机可见）

- **`cover-view`/`cover-image`**：Skyline 同层渲染后**冗余**（官方原文「建议使用 view 替代」）→ 归 `na`，用 `layout.box`/`ui.image` 承接。
- **`checkbox-group`/`radio-group`/`picker-view-column`**：语义**消灭为子项/属性**（`p-checkbox`/`p-radio` 分组、`p-picker` 多列）→ 归 `na`。
- **`aria-component`**：是 ARIA 属性**文档页**（非组件标签），aria-* 属性两端原生支持 → 归 `na`。
- **`share-element`**（唯一 planned）：需**宿主分享转场流**（微信客户端分享卡片打开动画），框架无法自实现等价物。
- **p-ad / p-webview 真机限制**：广告需后台广告单元；web-view 需业务域名——**属平台配置前置**，非框架缺陷。

## 4. 偏差记录表（真机执行时填写）

| 页/组件 | 真机表现 | 预期 | 结论 | 备注 |
|---|---|---|---|---|
| | | | ⬜通过 / ⬜偏差 | |

> 发现偏差 → 记录复现路径 + 截图 + 设备/基础库版本 → 归入 `docs/capability-component-granularity.md` 或新批次。

---
_生成日期 2026-09-12 · 权威标尺 `proteus audit coverage`（255/256 已落地，1 planned）· 构建 `pnpm run build:mp`_
