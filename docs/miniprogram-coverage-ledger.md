# 小程序官方能力覆盖台账（权威标尺）

> **起因**：用户「现在组件和能力都对齐小程序全覆盖了吗？」→ 实测发现「100% 覆盖」是**自证**的
> （门禁由手写矩阵 `MP_MAPPING_MATRIX` 驱动，矩阵不登记则永不红；且已两次抓到幽灵引用）。
> **本台账**：以**官方清单**为标尺（`docs/generated/miniprogram-official-spec.json`），逐项分类，
> 让缺口**自动现形**。生成器 `scripts/gen-mp-spec.mjs`；分类器 `packages/component-ir/src/mp-spec-coverage.ts`；
> 门禁 `proteus audit coverage`。

---

## 1. 标尺来源（官方，非我方手写）

| 维度 | 官方来源 | 项数 |
|---|---|---|
| 组件 | [官方组件索引页](https://developers.weixin.qq.com/miniprogram/dev/component/)（页面内全部 `/component/<tag>.html` 链接） | **84** |
| API | 官方类型定义 `miniprogram-api-typings`（`interface Wx` 方法名） | **298** |
| **合计** | | **382** |

> 快照由 `node scripts/gen-mp-spec.mjs` 生成（幂等）；`--check` 比对漂移（防快照与官方脱节）。

## 2. 覆盖分类（五态）

| 态 | 含义 | 计数 |
|---|---|---|
| ✅ **covered** | 有可运行等价（组件/语义/Hook；含改名承接：`batchGetStorageSync`→`useStorage`） | **249** |
| 📋 **planned** | L2 已声明待落地（诚实登记，**非已实现**） | **10** |
| ⬛ **private** | 平台私有（微信独占——支付/交通卡/视频号/VoIP/人脸核身/营销…）；收敛 `useMiniProgram` / 宿主桥 | **106** |
| ➖ **na** | 不适用（废弃 API / 构建期语义 / 被语义原语「消灭」的形态） | **17** |
| ❌ **gap** | 未归类（**必须为 0**——漏登记即 CI 红） | **0** |

> **口径**：`分类完整率 = (total−gap)/total = 100%`（官方项全部进了某个箱子）——**这不是「全实现」**。
> **诚实指标**：`真·落地率 = covered / (covered+planned) = 249/259 = 96%`（可落地项中已可用的比例）。

## 2-b. 已按标尺补齐的批次

| 批次 | 内容 | 效果 |
|---|---|---|
| **C65** | **隐私协议 `usePrivacy`**（`getPrivacySetting`/`openPrivacyContract`/`requirePrivacyAuthorize`/`onNeedPrivacyAuthorization`）——PIPL + 微信隐私合规刚需 | covered 199→203 · 落地率 77→78% |
| **D** | **性能 `usePerformance`**（`getPerformance`/`reportPerformance`）· **预加载 `usePreload`**（`preloadAssets`/`preloadSkylineView`/`preloadWebview`/`preDownloadSubpackage`）· **图像编辑 `useImageEdit`**（`cropImage`/`editImage`）——通用能力，无资质门槛 | covered 203→211 · 落地率 78→81% |
| **E** | **网络底层 `useSocket`**（`createUDPSocket`/`createTCPSocket`——UDP bind/connect/send/message + TCP connect/write/message）· **媒体高级 `useMediaProcessing`**（`createMediaContainer`/`createVideoDecoder`/`createMediaAudioPlayer`——轨道合成/解码取帧/多音源混音）；web 浏览器不支持裸 socket + 无标准媒体合成 → Err | covered 211→216 · 落地率 81→83% |
| **F** | **录屏/截屏 `useScreenCapture`**·**缓存管理 `useCacheManager`**·**空闲调度 `useIdle`**·**窗口 `useWindow`**·**导航拦截 `useNavigationGuard`**（12 个官方 API）；web：空闲走 requestIdleCallback、导航走 beforeunload，其余 Err | covered 216→228 · 落地率 83→88% |
| **G** | **AR/XR `useAR`**·**iBeacon `useBeacon`**·**局域网 mDNS `useLocalService`**·**翻译 `useTranslation`**·**海报 `usePoster`**·**设备探测 `useDeviceCapability`**（12 个官方 API）；web：AR 无对等→Err、HEVC 走 MediaSource，其余空订阅 | covered 228→249 · 落地率 88→96% |

> 标尺的价值证明：缺口不再是「人记得登记才可见」——它把 5 个隐私 API 直接列进 planned，驱动补齐后归 covered。

## 3. 缺口清单（planned 60 项 → 约 20 个能力域）

去重后（on/off 事件合成一个能力）**待落地能力域**：

| 能力域 | 官方 API | 优先级 |
|---|---|---|
| **网络底层** | `createUDPSocket` / `createTCPSocket` | 高（通用） |
| **媒体高级** | `createMediaContainer` / `createMediaAudioPlayer` / `createVideoDecoder` | 高（通用） |
| **图像编辑** | `cropImage` / `editImage` | 高（通用） |
| **性能** | `getPerformance` / `reportPerformance` | 高（可观测） |
| **隐私协议** | `getPrivacySetting` / `openPrivacyContract` / `requirePrivacyAuthorize` / `onNeedPrivacyAuthorization` | 高（合规刚需） |
| **预加载** | `preloadAssets` / `preloadSkylineView` / `preloadWebview` / `preDownloadSubpackage` | 中 |
| **录屏/画中画** | `getScreenRecordingState` / `onScreenRecordingStateChanged` / `onUserCaptureScreen` / `checkIsPictureInPictureActive` | 中 |
| **缓存管理** | `createCacheManager` | 中 |
| **空闲调度** | `requestIdleCallback` / `cancelIdleCallback` | 中 |
| **窗口** | `setWindowSize` | 中 |
| **导航拦截** | `enableAlertBeforeUnload` / `disableAlertBeforeUnload` | 中 |
| **AR/XR** | `createVKSession` / `isVKSupport` | 低（Skyline AR） |
| **iBeacon** | `onBeaconServiceChange` / `onBeaconUpdate` | 低 |
| **局域网服务** | `onLocalServiceFound/Lost/ResolveFail/DiscoveryStop` | 低 |
| **分享海报** | `onGeneratePoster` | 低 |
| **翻译** | `onUserTriggerTranslation` / `onUserOffTranslation` | 低 |
| **设备探测** | `checkDeviceSupportHevc` | 低 |
| **组件** | `keyboard-accessory` / `selection` | 低 |

> **组件侧**另有 8 项 planned 来自矩阵「L2 规划」行：`camera`/`map`/`web-view`/`ad`/`cover-view`/`cover-image`/`share-element`/`aria-component`（需原生渲染或宿主能力）。
> **注意**：上一轮 C4 补的 `useCanvas` 等已计入 covered；`checkbox-group`/`radio-group`/`picker-view-column` 归 **na**（语义消灭为子项/属性）；Skyline 手势处理器归 **covered**（gesture.* 承接）。

## 4. 门禁（可失败证明）

`proteus audit coverage` 现包含：

1. **spec 归类完整**：任一官方项未归类（gap>0）→ CI 红；
2. **棘轮预算**：`covered < 199` 或 `gap > 0` → CI 红（覆盖不得回退）；
3. 引用一致性（幽灵引用）+ 闭环一致性（catalog↔enum↔tag↔render-map）；
4. 测试 `tests/mp-spec-coverage.test.ts`：破坏性验证——注入官方新项/丢覆盖 → 门禁必红。

## 5. 诚实边界

- 分类是**人工声明**（规则 + 显式集合），不是自动证明；但它杜绝了「漏登记即 100%」的自证——每个官方项强制落入某箱子。
- `covered` 含「改名承接」，不保证**逐参数/逐事件**与官方等价（如 `useStorage` 承接 sync/async 全套，但 API 形态不同）。
- 官方清单快照为**时点**（typings 5.2.3 + 组件索引页当日）；官方新增 API 会先体现为 gap → CI 逼归类。
- `private` 的判定含主观（是否值得跨端）——收敛到 `useMiniProgram` 诚实降级，非「不做」。

---
_生成器 `scripts/gen-mp-spec.mjs` · 分类器 `packages/component-ir/src/mp-spec-coverage.ts` · 门禁 `proteus audit coverage` · 台账更新日期 2026-09-12_
