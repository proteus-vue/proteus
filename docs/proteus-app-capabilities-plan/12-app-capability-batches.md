# App 端能力批次计划（按 useFetch 标准分级）

> **由来**：用户问「是不是可以推下一批能力实现了？按照 useFetch 的标准」。
> 本文是**取证结论 + 排期**，不是宣言。所有数字可用文末命令复现。
> 决策：**#1207**

---

## 0. 先说结论（这句改变了排期）

**「按 useFetch 标准」能成批做的工作，几乎没有。**

`useFetch` 之所以能做成一条完整的主线（#1117→#1189→#1200→#1206，十几个决策），是因为
**底层平台栈三端本来就有**（Android OkHttp / iOS URLSession / 鸿蒙 RCP）——成本集中在
**接线 + 线格式 + 判据**，这三件事有共同形态，所以能"一批一批"推进。

剩下的 55 个真缺口**不是这个形状**：

| 分类 | 方法数 | 含义 | 能成批吗 |
|---|---|---|---|
| **A 零原生** | **2** | 三端宿主都已有底层能力，只差桥接线 | 能，但只有 2 个 |
| **B 需补原生（局部）** | **2** | 部分端有、部分端无 | 勉强（要分端收口） |
| **C 平台子系统** | **50** | 三端各写一套平台集成（权限/UI/回调模型） | **不能**——每项一个小项目 |

⇒ **正确的做法不是"开一批 55 个"，而是**：
1. **先把 A + B 的 4 个做完**（真实收益：`useStorage`/`useAuth`/`useLog`/`useCookie`/`useFileSystem` 5 个 hook 解锁）；
2. **C 类按"业务价值 × 平台成本"单项立项**，每项自带真机判据（交互类还要人工验收）；
3. **同时补齐"接线面"的既有欠账**（38 个 hook 桥已有但宿主可能 unsupported——见 §3）。

---

## 1. 取证口径（怎么得出上表）

### 1.1 缺口来自源码事实，不是手写清单

```bash
node scripts/capability-app-gap.mjs          # 55 真缺口 / 38 可接线 / 2 待核
node scripts/capability-app-feasibility.mjs  # 把 55 个按"底层栈是否已有"三分类
```

- `capability-app-gap.mjs`（既有）：hook 取值引用了哪些桥方法 → 这些方法在 App 桥里是否存在。
  口径与官网能力页共用同一抽取器 ⇒ 页面状态与清单不会分叉。
- `capability-app-feasibility.mjs`（**本单新增**）：对每个缺失方法，在 **三端宿主源码**里探"平台 API 标识符"
  是否出现 ⇒ A/B/C。

### 1.2 ★探针必须锚定平台标识符，不能用泛词

本工具**第一版用 `/map/`、`/live/`、`/push/`、`/translation/` 之类泛词**，结果把
`createMap` / `joinLiveRoom` / `createLivePusher` / `getTranslation` **全误判成"零原生可做"**——
因为那些词在渲染内核、注释、变量名里到处都有。

这与本仓反复记的教训同源：**正则命中注释/无关代码 ≠ 能力存在**（同族：#1191 J1/J2 的"正则命中注释"）。

⇒ 收紧后的口径：**只认平台 API 标识符**（`CookieManager`/`UIActivityViewController`/`logcat`/`fs.readBytes` 等）；
**没有可靠锚点的方法一律不设探针 ⇒ 归 C**（"未知"按"要写工程"对待）。
方向上也刻意不对称：**宁可把"其实能做"误归 C（需人工核），也不把"要大工程"误报成"一批能做"**。

### 1.3 机器读数（2026-10-23）

```
hook 96 个 · App 桥 46 个方法
✅ 可接线 38 · ❌ 真缺口 55 · ⚠️ 无桥依赖/待核 2（useFetchTask / dispose）

契约覆盖率：android 47/48（缺 dev.console）· ios 43/48（缺 dev.console）· harmony 18/48（缺 30）
```

---

## 2. 批次划分

### ★ 批 1（本单）：A + B 四项 —— 零/少量原生接线

| 方法 | 类 | 解锁 hook | 落点 |
|---|---|---|---|
| `getStorage` | B（Android/iOS 有 `fs.*`，鸿蒙无） | `useStorage` · `useAuth` | JS 侧适配 `fs.readBytes/writeBytes/remove`（**同步**——`invokeHost` 与宿主 `fs.*` 都是同步派发） |
| `log` | A | `useLog` | 三端已有 `logcat`/`NSLog`/`hilog` 通路 → 桥接线 |
| `getCookieJar` | A | `useCookie` | 三端已有 `CookieManager`/`HTTPCookieStorage`/`WebCookieManager` |
| `getFileSystem` | B | `useFileSystem` | 与 `getStorage` 同一底层，复用同一适配 |

**为什么先做这四项**：
- 它们是**基础能力**（存储/日志/cookie/文件），一旦缺就影响一大批业务；
- 成本集中在 **JS 桥 + 契约登记 + 判据**，与 useFetch 同形（可复用那套推进方式）；
- `getStorage` 是 55 项里**唯一影响 2 个 hook** 的方法。

**诚实边界（必须先写在前面）**：
- **鸿蒙没有 `fs.*`**（宿主未实现该方法）⇒ 鸿蒙端 `getStorage` 只能**如实 unsupported**，
  直到补上鸿蒙 `fs.*`（那是批 1.5，独立小单）。★不得用内存兜底冒充持久化。

### 批 1.5：鸿蒙 `fs.*`（补原生）

`fs.readBytes` / `fs.writeBytes` / `fs.remove` —— 鸿蒙宿主目前**完全没有**这三个方法
（Android/iOS 早已实现，且 `savePath` 落盘走的是 C++ 侧的 `SaveSession`，不是能力通道的 `fs.*`）。
鸿蒙侧有 `fileIo`（ArkTS `@kit.CoreFileKit`）⇒ 属"有平台能力、没接线"。
★这是**批 1 的前置**（若要求 `getStorage` 三端齐）。

### 批 2+：C 类 50 项，按业务价值单项立项

**不打包成"一批"**——每项含平台权限申请 + UI 交互 + 回调模型，三端各一套。
建议排序（业务价值 × 成本）：

1. **`share`**（`useShare`）——三端都有标准分享面板；Android `ACTION_SEND` / iOS `UIActivityViewController` / 鸿蒙 `shareService`
2. **`openDocument`**（`useOpenDocument`）——文件选择器
3. **`makePhoneCall`**（`usePhoneCall`）——`ACTION_DIAL` / `tel:`（只唤起拨号，不申请通话权限）
4. **`getPermission`**（`usePermission`）——权限查询（**它是很多 C 类的前置**）
5. **`getLocation`**（`useLocation`）——定位（权限 + 系统服务）
6. 其余按需（相机/相册/蓝牙/NFC/支付/扫码/日历/联系人…）

★**每项立项时必须先回答**：该端平台 API 是什么？权限模型？是否有 UI（需人工验收）？
⇒ 判据形态与 A/B 类不同（不能只看"方法存在"）。

---

## 3. 另一条独立的欠账：38 个"可接线"hook

`capability-app-gap` 报"38 个 hook 的桥方法都在"，但这**只说明桥方法存在**，
不代表宿主实现了（宿主未实现 ⇒ 运行时 `*.unsupported`）。

⇒ **这是与 A/B/C 平行的第二条线**：把 38 个逐个核对宿主实现，
把"其实宿主已实现、只是契约没登记"的补登记（#1121 的 `http.cancel` 就是这个形态：
宿主两侧都实现并真机验过，但没登记进契约 ⇒ 门禁看不见已做的能力）。

工具：`node scripts/check-host-invoke-contract.mjs`（现 android 47/48 · ios 43/48 · harmony 18/48）。

---

## 4. 验收标准（沿用 useFetch 那套，不打折）

每一项都必须齐四层 + 判据：

1. **宿主原生实现**（或"用既有方法组合"，须写明是哪种）；
2. **契约登记**（`packages/render-backend/src/host-invoke-contract.ts` 的 `HOST_CAPABILITY_METHODS`）；
3. **JS 桥**（`createAppCapabilities` 装配面）；
4. **Hook 可用**（`useXxx` 不再走 `*.unsupported`）；
5. **判据**：
   - 静态：契约覆盖率门禁（`check:host-invoke-contract`）
   - 行为：真机可观察（报告落盘即完成信号，零轮询）
   - **破坏性验证**：改坏 ⇒ 必红
   - ★**"能力存在" ≠ "行为正确"**：`bridge-impl-reality` 守空壳

---

## 5. 复现命令

```bash
# 缺口与三分类（本单新增后者）
node scripts/capability-app-gap.mjs
node scripts/capability-app-feasibility.mjs

# 契约覆盖率（三端）
node scripts/check-host-invoke-contract.mjs

# 反巨型化（capability-app.ts 已顶基线，新代码必须另开文件）
node scripts/check-file-size.mjs
```

---

## 6. 诚实边界

1. **A/B/C 是"底层栈是否已有线索"，不是"能直接做"**：线索存在不代表完整可用
   （权限、UI、回调模型可能仍要写）。工具用于**排除误判**，不提供"可做"背书。
2. **"桥方法存在" ≠ "宿主实现"**：§3 的第二条线就是专门处理这个的。
3. **C 类没有任何一项是"改几行就能通"的**——凡是把 C 类说成"一批能做完"的排期，都是错的。
4. 本文数字是 2026-10-23 的快照；`capability-app-feasibility.mjs` 可随时重算。
