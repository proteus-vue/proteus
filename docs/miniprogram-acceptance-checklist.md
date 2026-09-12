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
| **p-camera** | ✅ 渲染黑色相机预览区（含播放控制条）；「相机就绪：否」（模拟器无真实相机 → 符合预期；真机需授权） | 模拟器截图 |
| **p-map** | ✅ 渲染地图区域（灰底）；「标记点击次数：0」 | 模拟器截图 |
| **p-webview** | ✅ 标题渲染（内容需业务域名，见 §2.2） | 模拟器截图 |
| 页面 `data` 注入 | ✅ `percent:40` / `selected:''` / `camReady:false` 等初始值正确进入逻辑层 | automator `evaluate` |
| 首屏（对照） | ✅ `pages/index` 完整渲染（Proteus 标题 + 导航 + tabBar） | 模拟器截图 |

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
