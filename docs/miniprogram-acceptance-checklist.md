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
