# 组件 / API 文档颗粒度对齐台账

> **起因**：用户「对比小程序文档检查我们的内容颗粒度是否都已对齐，深度检查，重点是组件和 API」→「官网文档和实际能力全部和小程序覆盖的对齐」。
> **审计日期**：2026-09-11（三路并行深审 + 逐条验证）。**SSOT**：`website/scripts/gen-content.mjs`（生成器）+ `src/components/p-*/index.vue`（组件源）+ `packages/api/src/capability.ts`（能力源）+ `packages/component-ir/src/audit.ts`（覆盖度矩阵）。

---

## 1. 现状与缺口（实测）

### 组件页（63）—— 差距最大
| 小程序文档要素 | 我方现状 |
|---|---|
| 属性表（类型/默认值/必填/说明） | ✅ 有（但列序不同、40% 属性靠跨组件通用兜底、无逐属性详解） |
| 事件表（说明 + 回调参数） | 🟡 有汇总表；**`update:*` 全丢**（13 事件 / 8 页整段消失）；无载荷列 |
| **插槽** | ❌ **0 页**（40/63 组件有 slot，8 具名 + 1 作用域） |
| 示例代码 | ❌ 硬编码空壳（`<p-xxx :firstProp="…">`） |
| 逐属性/逐事件详解 | ❌ 0 页（能力页有逐方法详解） |

### 能力页（50）—— 详细化已做，仍有 bug
| 项 | 现状 |
|---|---|
| 逐方法详解 / 类型引用 | ✅ 有（但类型引用**只展一层**） |
| 错误码 | 🔴 源码 98 唯一 code → 页面仅 61 行；**network/orientation/device/auth 四页 0 行** |
| 扩展接口（useCameraContext 等） | 🟡 有签名+返回结构，**无参数表** |
| 参数/属性「默认值」列 | ❌ 无（微信必有） |

### 覆盖度门禁（假门禁）
- `audit.ts` 的 `MP_MAPPING_MATRIX` 是**手写常量**，`auditMiniprogramCoverage` 只统计写进去的行有无 `missing` → **永远 pass、不可失败**。
- 矩阵引用**不存在**的 primitive（`p-overlay/p-progress/p-label/p-camera/p-map/p-webview`、`capability.toast/capability.media/capability.element` 等，catalog/schema/组件目录 0 命中）却标 ok/compat。
- 真实覆盖：**微信内置组件 48** → ✅22 / 🟡17 / ❌9（矩阵漏 13 个真实组件）；**API 大组** → ✅26 / 🟡3 / ❌15。
- ~~文档声称的 `scripts/miniprogram-official-spec.json` + `coverage-audit.ts` **不存在**。~~ → ★2026-09-12 **已落地权威标尺**：`scripts/gen-mp-spec.mjs` → `docs/generated/miniprogram-official-spec.json`（官方组件 84 + 官方 API 298）+ `packages/component-ir/src/mp-spec-coverage.ts` 分类器 + `proteus audit coverage` spec 门禁。详见 `docs/miniprogram-coverage-ledger.md`。

---

## 2. 批次计划

| 批 | 范围 | 内容 | 状态 |
|----|------|------|------|
| **A** | 生成器正确性 bug | ① parseEmits 支持 `:` → 恢复 `update:*`；② 组件页「插槽」段；③ 事件「载荷」列；④ 错误码补全（bridgeBodies per-method union + 扫 helper + throw）；⑤ 类型引用递归；⑥ 扩展接口参数表；⑦ 参数/属性「默认值」列 | ✅ 已提交 ea984e56 |
| **B** | 组件页详细化 | 逐属性详解 + 逐事件详解 + 真实示例（对齐能力页详细度；含源 JSDoc 补全） | ✅ 已提交 73dfa43c |
| **C1** | 覆盖度门禁重做 | 幽灵行一致性校验（引用必须真实存在）+ landed/planned 两维（区分「有等价」与「真缺」） | ✅ 已提交 627af8ea |
| **C2** | 新增缺失组件 | ✅ 批 1：**p-progress / p-label / p-page-container**（对齐小程序 `<progress>`/`<label>`/`<page-container>`——全端真实落地：schema+primitives+map+六后端渲染表+Rust 表+导出+d.ts+MP 编译测试）。⬜ 批 2：能力入口组件 p-camera/p-map/p-webview/p-ad（需原生渲染，诚实标 L2） | 🟡 批 1 落地 |
| **C3** | 新增缺失 API | ✅ 批 1：**C52 useAlbum** + **C53 useWorker**（修矩阵 `saveImageToPhotosAlbum→pick-photo` 语义错标）。✅ 批 2：**C54 useAddress**（wx.chooseAddress）+ **C55 useWifi**（wx.getConnectedWifi/getWifiList/connectWifi）+ **C56 useWeRun**（wx.getWeRunData）。⬜ 批 3：卡券/发票/解密/AI/数据预拉取/周期性更新（需类目资质，按需驱动） | 🟡 批 1+2 落地 |
| **C4** | 组件实例 API | ✅ **C57 useCanvas**（canvas 组件实例——CanvasContext 2D 全量 42 方法 + node(type=2d) + toTempFilePath/toDataURL + OffscreenCanvas）· **C58 useElement**（SelectorQuery——boundingClientRect/scrollOffset/fields/size/batch）· **C59 useIntersection**（IntersectionObserver——relativeTo/relativeToViewport/observe/disconnect）· **C60 useMediaQuery**（MediaQueryObserver——宽高/方向条件）· **C61 useVideo**（VideoContext——播放控制/倍速/全屏/弹幕）· **C62 useAudio**（InnerAudioContext——播放/进度/音量/循环）· **C63 useLivePusher**（LivePusherContext——推流/切换/截图/SEI）· **C64 useAd**（RewardedVideoAd/InterstitialAd/BannerAd）。★修矩阵幽灵引用 `useElement`/`useIntersection`/`useMedia`（此前只声明未实现）；web 端标准 API 承接（HTMLCanvasElement/HTMLVideoElement/Audio/matchMedia/IntersectionObserver），无标准的（推流/广告）诚实降级 | ✅ 已落地 |
| **D** | 批量补齐（标尺驱动） | ✅ **C66 usePerformance**（性能——getEntries/getEntriesByName/createObserver/setBufferSize/report；web performance API 承接条目读取，report 无对等后端 → Err）· **C67 usePreload**（预加载——assets/skylineView/webview/subpackage + 进度；web 无标准 → Err）· **C68 useImageEdit**（图像编辑——crop 按比例/edit；web 无微信编辑 UI → Err）。覆盖 covered 203→**211** · 落地率 78→**81%** | ✅ 已落地 |
| **E** | 批量补齐（标尺驱动） | ✅ **C69 useSocket**（网络底层——UDP bind/connect/send/write/onMessage + TCP connect/write/onMessage/close；web 浏览器不支持裸 socket → throw）· **C70 useMediaProcessing**（媒体高级——MediaContainer 轨道合成/导出 · VideoDecoder 解码取帧 · MediaAudioPlayer 多音源混音；web container/audioPlayer throw，VideoDecoder 走 WebCodecs 诚实降级）。覆盖 covered 211→**216** · 落地率 81→**83%** | ✅ 已落地 |
| **F** | 批量补齐（标尺驱动） | ✅ **C71 useScreenCapture**（录屏/截屏——getRecordingState/onRecordingStateChange/onUserCapture/isPictureInPictureActive）· **C72 useCacheManager**（请求缓存——addRules/start/stop/deleteCache/clearCaches/事件；web → throw）· **C73 useIdle**（空闲调度——request/cancel；web requestIdleCallback + setTimeout 兜底）· **C74 useWindow**（setSize；web → Err）· **C75 useNavigationGuard**（enable/disable；web beforeunload）。覆盖 covered 216→**228** · 落地率 83→**88%** | ✅ 已落地 |
| **G** | 批量补齐（标尺驱动） | ✅ **C76 useAR**（AR/XR——createSession/state/start/stop/on/requestAnimationFrame/getVKFrame + isSupported；web → Err）· **C77 useBeacon**（iBeacon——onServiceChange/onUpdate）· **C78 useLocalService**（mDNS——onFound/onLost/onResolveFail/onDiscoveryStop）· **C79 useTranslation**（onTrigger/onOff）· **C80 usePoster**（onGenerate）· **C81 useDeviceCapability**（supportsHevc；web MediaSource）。覆盖 covered 228→**249** · 落地率 88→**96%**（剩余 planned 10 项均为组件侧） | ✅ 已落地 |
| **H** | 组件侧补齐（标尺驱动） | ✅ **p-selection**（`ui.selection`——局部文本选区：selectionchange 事件载荷归一 + Web document.getSelection；对齐小程序 `<selection>`）· **p-keyboard-accessory**（`shell.keyboard-accessory`——键盘上方工具栏：Web visualViewport 驱动 + MP 原生承接；对齐小程序 `<keyboard-accessory>`）。全端一致性接线（schema/tag/catalog/map 六端/Rust/vue-dom/native×3/flutter/headless/导出/d.ts）。覆盖 covered 249→**251** · 落地率 96→**97%** · 组件 66→**68** · implemented 48→**50** | ✅ 已落地 |
| **C5** | 权威标尺 + 隐私合规 | ✅ **权威标尺**（`scripts/gen-mp-spec.mjs` → 官方清单快照 84 组件 + 298 API；`mp-spec-coverage.ts` 五态分类器；`proteus audit coverage` spec 门禁 + 棘轮）——修「手写矩阵自证 100%」根因；台账 `docs/miniprogram-coverage-ledger.md`（真实落地率 78%）。✅ **C65 usePrivacy**（隐私协议——getPrivacySetting/openPrivacyContract/requirePrivacyAuthorize/onNeedPrivacyAuthorization，PIPL+微信隐私合规刚需；web 缺省 Err）。⬜ 剩余 planned 56 项（网络底层 UDP/TCP · 媒体高级 MediaContainer/VideoDecoder · 图像编辑 · 性能 · 预加载 · 录屏 · AR…）按标尺驱动分批 | ✅ 标尺+C65 落地 |

---

## 3. 诚实边界

- **C2/C3 部分需类目资质**（支付扩展/卡券/发票/广告/AI）——不做纯覆盖式铺开，按需驱动；**C4 广告（useAd）已按「能力面就绪 + web 诚实降级」处理**（wx 侧真实接入，web 侧创建即 Err）。
- **C4 组件实例**：`useCanvas.createContext()` 走 wx 旧版 `createCanvasContext`（方法名对齐官方）；`node()` 走 SelectorQuery `fields({node:true})`（`<canvas type="2d">`）；web 端由标准 DOM API 适配（非完全等价的绘制语义，如 `setFontSize` 在 web 为 font 串改写）。
- **微信内置组件 48** 中部分为 Skyline 专属（`grid-view/list-view/sticky-*/double-tap-gesture/root-portal/snapshot/page-meta`），Proteus 侧已有等价能力（`p-grid/p-list-view/p-animate`）或有意不支持——C1 门禁须区分「有等价能力」与「真缺」。
- 覆盖度以**微信官方文档为准**（非我方手写矩阵）。
