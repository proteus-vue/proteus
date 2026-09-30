# 能力实现优先级表（NC0 交付物 —— 生成物，勿手改）

> **生成**：`node scripts/gen-capability-priority.mjs`（`--check` 接 verify/CI，漂移即红）
> **卡**：NC0「能力清单扫描」（`docs/Proteus_原生能力接入方案.md` §9）· **性质**：能力扩充优先级的**唯一事实源**
> **决策背景**：用户 2026-09-30 裁定本线为战略线（目标「业务代码 99% 不用手写原生插件」）

## 0. 三类事实源与口径（复现前提）

| 事实源 | 内容 | 口径 |
|---|---|---|
| ① 能力清单（SSOT） | 82 个 capability（`PRIMITIVE_CATALOG` kind=capability） | 域来自 `capabilityDomainOf`（与官网能力页分组同一事实源） |
| ② 需求证据 | 本仓消费侧语料（showcase / examples / website/src）Hook 调用点 | 只计 `useXxx(` 且 Xxx ∈ 82 名单；排除 node_modules / dist / scripts / tests / *.d.ts / generated |
| ③ 官方承接面 | 微信官方 API 清单（495 个）中该 Hook 承接的 covered 数 | `classifySpecApi` 反查 proteus 串（跨端对等标尺） |

**优先级算法（方案 §1.1）**：跨项目覆盖数 **优先于** 单项目频次；成本加权 S/M/L=1/3/8。

**★诚实边界（必读）**：
- 语料 = 本仓 **3 个自有工程**（非真实业务项目）⇒ 需求数字是**下界**；真实证据待接入超级应用后补齐（与《实战采集埋点清单》同一原则）；
- **成本等级机器不可算**——表中该列标 `⏳ 待人工估`，**不编造数字**；NC0 出口时人工按 S/M/L=1/3/8 填写；
- 「官方承接面」只统计 MP 官方 API（组件侧经 MP_MAPPING_MATRIX 另算）；**超清单能力**（如 webassembly，不在官方 301 清单）承接数为 0 属正常。

## 1. 汇总

- **能力总数**：82 · 语料出现过：**46** · 跨项目（≥2 工程）：**15**
- **有官方承接**：69 / 82（合计承接 covered API 301 / 495）
- **未登记分域**：0（应为 0——非 0 即新能力漏登记，见 `auditCapabilityDomains`）

## 2. 优先级表（按 跨项目覆盖 ↓ · 语料频次 ↓ · 官方承接 ↓）

| # | 优先信号 | 编号 | Hook | 域 | 跨项目 | 语料频次 | 官方承接 | 清单状态 | 成本（S/M/L=1/3/8） |
|---|---|---|---|---|---|---|---|---|---|
| 1 | ★★ | C1 | `useCamera()` | 媒体与扫码 | showcase+examples | 8 | 1 | implemented | ⏳ 待人工估 |
| 2 | ★★ | C15 | `useStorage()` | 存储与文件 | showcase+examples | 5 | 14 | planned | ⏳ 待人工估 |
| 3 | ★★ | C8 | `useNetwork()` | 设备与系统 | showcase+examples | 5 | 6 | planned | ⏳ 待人工估 |
| 4 | ★★ | C25 | `useBackground()` | 应用与生命周期 | showcase+examples | 5 | 5 | planned | ⏳ 待人工估 |
| 5 | ★★ | C9 | `useClipboard()` | 设备与系统 | showcase+examples | 5 | 4 | planned | ⏳ 待人工估 |
| 6 | ★★ | C35 | `useLog()` | 可观测与调试 | showcase+examples | 5 | 4 | planned | ⏳ 待人工估 |
| 7 | ★★ | C6 | `useVibrate()` | 设备与系统 | showcase+examples | 5 | 2 | planned | ⏳ 待人工估 |
| 8 | ★★ | C11 | `useDevice()` | 设备与系统 | showcase+examples | 4 | 14 | planned | ⏳ 待人工估 |
| 9 | ★★ | C23 | `useAppLifecycle()` | 应用与生命周期 | showcase+examples | 4 | 14 | planned | ⏳ 待人工估 |
| 10 | ★★ | C24 | `usePageLifecycle()` | 应用与生命周期 | showcase+examples | 4 | 12 | planned | ⏳ 待人工估 |
| 11 | ★★ | C14 | `useKeyboard()` | 设备与系统 | showcase+examples | 4 | 7 | planned | ⏳ 待人工估 |
| 12 | ★★ | C43 | `useFileSystem()` | 存储与文件 | showcase+examples | 4 | 6 | planned | ⏳ 待人工估 |
| 13 | ★★ | C38 | `useBiometric()` | 账号与支付 | showcase+examples | 4 | 3 | planned | ⏳ 待人工估 |
| 14 | ★★ | C66 | `usePerformance()` | 可观测与调试 | showcase+examples | 4 | 2 | planned | ⏳ 待人工估 |
| 15 | ★★ | C32 | `useCookie()` | 存储与文件 | showcase+examples | 4 | 0 | planned | ⏳ 待人工估 |
| 16 | ★ | C3 | `useLocation()` | 位置与地图 | showcase | 5 | 9 | implemented | ⏳ 待人工估 |
| 17 | ★ | C58 | `useElement()` | 设备与系统 | showcase | 4 | 4 | planned | ⏳ 待人工估 |
| 18 | ★ | C57 | `useCanvas()` | 媒体与扫码 | showcase | 4 | 3 | planned | ⏳ 待人工估 |
| 19 | ★ | C75 | `useNavigationGuard()` | 应用与生命周期 | showcase | 4 | 2 | planned | ⏳ 待人工估 |
| 20 | ★ | C10 | `useScreen()` | 设备与系统 | showcase | 3 | 7 | planned | ⏳ 待人工估 |
| 21 | ★ | C16 | `usePermission()` | 账号与支付 | showcase | 3 | 6 | planned | ⏳ 待人工估 |
| 22 | ★ | C7 | `useBattery()` | 设备与系统 | showcase | 3 | 4 | planned | ⏳ 待人工估 |
| 23 | ★ | C12 | `useOrientation()` | 设备与系统 | showcase | 3 | 2 | planned | ⏳ 待人工估 |
| 24 | ★ | C73 | `useIdle()` | 应用与生命周期 | showcase | 3 | 2 | planned | ⏳ 待人工估 |
| 25 | ★ | C30 | `useDownload()` | 网络与通信 | showcase | 3 | 1 | planned | ⏳ 待人工估 |
| 26 | ★ | C59 | `useIntersection()` | 设备与系统 | showcase | 3 | 1 | planned | ⏳ 待人工估 |
| 27 | ★ | C81 | `useDeviceCapability()` | 设备与系统 | showcase | 3 | 1 | planned | ⏳ 待人工估 |
| 28 | ★ | C60 | `useMediaQuery()` | 设备与系统 | showcase | 3 | 0 | planned | ⏳ 待人工估 |
| 29 | ★ | C26 | `useFetch()` | 网络与通信 | examples | 2 | 1 | planned | ⏳ 待人工估 |
| 30 | ★ | C36 | `useBluetooth()` | 网络与通信 | examples | 1 | 32 | planned | ⏳ 待人工估 |
| 31 | ★ | C5 | `useSensor()` | 设备与系统 | examples | 1 | 14 | planned | ⏳ 待人工估 |
| 32 | ★ | C27 | `useWebSocket()` | 网络与通信 | examples | 1 | 7 | planned | ⏳ 待人工估 |
| 33 | ★ | C37 | `useNFC()` | 网络与通信 | examples | 1 | 7 | planned | ⏳ 待人工估 |
| 34 | ★ | C47 | `useMiniProgram()` | 应用与生命周期 | examples | 1 | 3 | planned | ⏳ 待人工估 |
| 35 | ★ | C20 | `useCalendar()` | 通知与分享 | examples | 1 | 2 | planned | ⏳ 待人工估 |
| 36 | ★ | C34 | `useAnalytics()` | 可观测与调试 | examples | 1 | 2 | planned | ⏳ 待人工估 |
| 37 | ★ | C4 | `useMap()` | 位置与地图 | examples | 1 | 1 | planned | ⏳ 待人工估 |
| 38 | ★ | C17 | `useNotification()` | 通知与分享 | examples | 1 | 1 | planned | ⏳ 待人工估 |
| 39 | ★ | C19 | `useContact()` | 通知与分享 | examples | 1 | 1 | planned | ⏳ 待人工估 |
| 40 | ★ | C42 | `useQRCode()` | 媒体与扫码 | examples | 1 | 1 | implemented | ⏳ 待人工估 |
| 41 | ★ | C2 | `useMicrophone()` | 媒体与扫码 | examples | 1 | 0 | planned | ⏳ 待人工估 |
| 42 | ★ | C33 | `useAuth()` | 账号与支付 | examples | 1 | 0 | planned | ⏳ 待人工估 |
| 43 | ★ | C39 | `useFaceID()` | 账号与支付 | examples | 1 | 0 | planned | ⏳ 待人工估 |
| 44 | ★ | C44 | `useArchive()` | 存储与文件 | examples | 1 | 0 | planned | ⏳ 待人工估 |
| 45 | ★ | C45 | `useShortcut()` | 通知与分享 | examples | 1 | 0 | planned | ⏳ 待人工估 |
| 46 | ★ | C50 | `useExtension()` | 应用与生命周期 | examples | 1 | 0 | planned | ⏳ 待人工估 |
| 47 | △ | C55 | `useWifi()` | 网络与通信 | — | 0 | 12 | planned | ⏳ 待人工估 |
| 48 | △ | C78 | `useLocalService()` | 网络与通信 | — | 0 | 10 | planned | ⏳ 待人工估 |
| 49 | △ | C52 | `useAlbum()` | 媒体与扫码 | — | 0 | 7 | planned | ⏳ 待人工估 |
| 50 | △ | C77 | `useBeacon()` | 设备与系统 | — | 0 | 7 | planned | ⏳ 待人工估 |
| 51 | △ | C69 | `useSocket()` | 网络与通信 | — | 0 | 6 | planned | ⏳ 待人工估 |
| 52 | △ | C71 | `useScreenCapture()` | 设备与系统 | — | 0 | 6 | planned | ⏳ 待人工估 |
| 53 | △ | C70 | `useMediaProcessing()` | 媒体与扫码 | — | 0 | 5 | planned | ⏳ 待人工估 |
| 54 | △ | C28 | `useSocketTask()` | 网络与通信 | — | 0 | 4 | planned | ⏳ 待人工估 |
| 55 | △ | C62 | `useAudio()` | 媒体与扫码 | — | 0 | 4 | planned | ⏳ 待人工估 |
| 56 | △ | C65 | `usePrivacy()` | 账号与支付 | — | 0 | 4 | planned | ⏳ 待人工估 |
| 57 | △ | C67 | `usePreload()` | 应用与生命周期 | — | 0 | 4 | planned | ⏳ 待人工估 |
| 58 | △ | C79 | `useTranslation()` | 通知与分享 | — | 0 | 4 | planned | ⏳ 待人工估 |
| 59 | △ | C64 | `useAd()` | 通知与分享 | — | 0 | 3 | planned | ⏳ 待人工估 |
| 60 | △ | C13 | `useBrightness()` | 设备与系统 | — | 0 | 2 | planned | ⏳ 待人工估 |
| 61 | △ | C49 | `useLive()` | 媒体与扫码 | — | 0 | 2 | planned | ⏳ 待人工估 |
| 62 | △ | C68 | `useImageEdit()` | 媒体与扫码 | — | 0 | 2 | planned | ⏳ 待人工估 |
| 63 | △ | C76 | `useAR()` | 设备与系统 | — | 0 | 2 | planned | ⏳ 待人工估 |
| 64 | △ | C80 | `usePoster()` | 通知与分享 | — | 0 | 2 | planned | ⏳ 待人工估 |
| 65 | △ | C21 | `usePhoneCall()` | 通知与分享 | — | 0 | 1 | planned | ⏳ 待人工估 |
| 66 | △ | C22 | `useSMS()` | 通知与分享 | — | 0 | 1 | planned | ⏳ 待人工估 |
| 67 | △ | C29 | `useUpload()` | 网络与通信 | — | 0 | 1 | planned | ⏳ 待人工估 |
| 68 | △ | C40 | `usePayment()` | 账号与支付 | — | 0 | 1 | planned | ⏳ 待人工估 |
| 69 | △ | C41 | `useLogin()` | 账号与支付 | — | 0 | 1 | planned | ⏳ 待人工估 |
| 70 | △ | C51 | `useUpdate()` | 应用与生命周期 | — | 0 | 1 | planned | ⏳ 待人工估 |
| 71 | △ | C53 | `useWorker()` | 应用与生命周期 | — | 0 | 1 | planned | ⏳ 待人工估 |
| 72 | △ | C54 | `useAddress()` | 账号与支付 | — | 0 | 1 | planned | ⏳ 待人工估 |
| 73 | △ | C56 | `useWeRun()` | 设备与系统 | — | 0 | 1 | planned | ⏳ 待人工估 |
| 74 | △ | C61 | `useVideo()` | 媒体与扫码 | — | 0 | 1 | planned | ⏳ 待人工估 |
| 75 | △ | C63 | `useLivePusher()` | 媒体与扫码 | — | 0 | 1 | planned | ⏳ 待人工估 |
| 76 | △ | C72 | `useCacheManager()` | 设备与系统 | — | 0 | 1 | planned | ⏳ 待人工估 |
| 77 | △ | C74 | `useWindow()` | 应用与生命周期 | — | 0 | 1 | planned | ⏳ 待人工估 |
| 78 | · | C18 | `useShare()` | 通知与分享 | — | 0 | 0 | planned | ⏳ 待人工估 |
| 79 | · | C31 | `useDataChannel()` | 网络与通信 | — | 0 | 0 | planned | ⏳ 待人工估 |
| 80 | · | C46 | `useInAppPurchase()` | 账号与支付 | — | 0 | 0 | planned | ⏳ 待人工估 |
| 81 | · | C48 | `useEmbedded()` | 应用与生命周期 | — | 0 | 0 | planned | ⏳ 待人工估 |
| 82 | · | C82 | `useWebAssembly()` | 应用与生命周期 | — | 0 | 0 | planned | ⏳ 待人工估 |

> 优先信号：★★ = 跨项目覆盖（最高证据）· ★ = 单项目有真实调用 · △ = 仅官方承接面（无本仓调用，属完整性缺口）· · = 暂无双侧信号

## 3. 按域汇总

| 域 | 能力数 | 跨项目 | 语料用过 | 官方承接合计 |
|---|---|---|---|---|
| 网络与通信 | 11 | 0 | 5 | 81 |
| 设备与系统 | 19 | 5 | 13 | 85 |
| 存储与文件 | 4 | 3 | 4 | 20 |
| 位置与地图 | 2 | 0 | 2 | 10 |
| 媒体与扫码 | 11 | 1 | 4 | 27 |
| 账号与支付 | 9 | 1 | 4 | 16 |
| 通知与分享 | 10 | 0 | 4 | 15 |
| 应用与生命周期 | 13 | 3 | 7 | 45 |
| 可观测与调试 | 3 | 2 | 3 | 8 |

## 4. NC0 出口的剩余人工步骤

1. **成本列**：按实现面（wx 桥 + web 兜底 + 宿主原生落地的实际工作量）估 S/M/L；
2. **真实语料**：接入真实业务项目后重跑本脚本（口径不变），替换"本仓 3 工程"下界；
3. **挑批**：按 `跨项目数 × 1/成本权重` 排序取批次 → 进 NC2「内置能力扩充」。
