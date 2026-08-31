# Proteus 应用级能力解决方案

> 全局主题切换 · 动态字体缩放 · 缓存分层管理  
> 配套文档：`proteus-app-renderer-plan` / `proteus-css-compat` / `proteus-memory-plan` / `proteus-design-principle`

---

## 0. 问题定义：三个"单端都有、跨端全无"的痛点

### 0.1 现状：每家框架都只解决了一半

| 能力 | uni-app x | React Native | Flutter | HarmonyOS | **Proteus** |
|------|-----------|--------------|---------|-----------|-------------|
| 全局主题 | `theme.json` + `@变量` + 三套 theme 概念 | Context + `useColorScheme` + `StyleSheet.create` | `ThemeData` + `Theme.of` | — | **语义 token + 响应式 + 原生映射** |
| 字体缩放 | 跟随系统，无应用级 API | `allowFontScaling`(反模式) | `MediaQuery.textScaler` | `setFontScale` / `UIAppearance` | **应用级覆盖 + 跟随系统双模式** |
| 缓存分层 | `uni.setStorage`(单层) | AsyncStorage(社区) | — | — | **L0/L1/L2/L3 四层 + 字节预算** |

### 0.2 各方案的具体缺陷（这是 Proteus 的机会）

**① uni-app x 主题：配置地狱**
- 需在各平台节点（`app-plus`/`h5`/`mp-weixin`）**分别写 `darkmode:true` + `themeLocation`**
- `theme.json` 加载失败**控制台完全静默**，不报错
- pages.json 能用 `@变量` 的字段**极少**（仅 navBar/tabBar 等几个）
- App.vue 的 `onLaunch` + `onShow` **都要手动读 storage** 防闪屏，且 `@变量` 更新依赖根 class 切换
- `osTheme`/`hostTheme`/`appTheme` 三概念在不同平台支持度不同，开发者需先"明确需求"才能选做法

**② RN 主题：性能靠手动优化**
- `StyleSheet.create` 每次 render 重建 → 必须用 `useMemo` 包一层，否则全树重渲
- 社区方案 `react-native-dark` 用 `$dark` 字段 + `useDynamicDarkModeStyles()` 手动订阅
- **没有编译期优化**，全靠开发者自觉

**③ Flutter：只覆盖 Flutter 端**，且与 Web/小程序无关

**④ 鸿蒙：API 最完整但孤岛**
- `UIAppearance` 提供 `setDarkMode` / `getDarkMode` / `setFontScale`(0-5) / `setFontWeightScale`
- `UIContext.isFollowingSystemFontScale()` / `getMaxFontScale()`
- **但这些 API 只有鸿蒙有**，iOS/Android/Web 机制完全不同，无统一抽象

**⑤ 缓存：几乎全交给开发者**
- uni-app `uni.setStorage`、RN `AsyncStorage`/MMKV、Web `localStorage` —— **都是单层 KV**
- 没有自动的：内存→磁盘→网络的层级、字节预算、LRU、TTL、冷启动时序、跨端一致性

### 0.3 Proteus 的核心判断

> **这三个能力的共同特征：单端都有现成 API，但"跨五端 + 响应式 + 高性能 + 不卡 + 不漏内存"组合起来，没有任何框架做过统一收敛。**

Proteus 的解法**不是自研**（自绘主题引擎、自研缓存），而是**定义统一语义，映射到各端最强原生实现** —— 完全继承 Architecture 原则 #10。

---

## 1. 设计原则（继承原则 #10）

1. **语义统一，实现各端最优**：框架定义 `theme token` / `font scale` / `cache layer` 语义，各端用原生 API 实现
2. **响应式一等公民**：主题/字体变化**精确追踪到用到的节点**，不重渲整树（对齐 Vue Proxy 细粒度，优于 RN 的 useMemo 手动优化）
3. **零业务样板**：开发者不写 Provider、不写 useMemo、不写 storage 读写
4. **不阻断首帧**：主题/字体状态在 IFR 静态首帧阶段就已确定，无闪屏
5. **无障碍优先**：字体缩放默认跟随系统，应用级覆盖是**加分项而非替代**

---

## 2. 能力一：全局主题切换

### 2.1 统一语义模型

```typescript
// app.config.ts —— 单一事实源
export default defineApp({
  theme: {
    // 语义 token（业务层只引用 token，不写色值）
    tokens: {
      color: {
        primary: { light: '#007AFF', dark: '#0A84FF' },
        background: { light: '#FFFFFF', dark: '#1C1C1E' },
        text: { light: '#000000', dark: '#FFFFFF' },
      },
      spacing: { sm: 8, md: 16, lg: 24 },  // 无需分主题
    },
    // 三档来源，优先级: app > system-follow
    source: 'system',  // 'light' | 'dark' | 'system'
  },
})
```

### 2.2 业务层用法（零样板）

```vue
<!-- 写法 1：class 绑定 token（推荐，编译期优化） -->
<p-view class="card" :class="$theme.card">

<!-- 写法 2：内联语义色（运行时响应式） -->
<p-text style="color: var(--color-text)">标题</p-text>

<!-- 写法 3：命令式切换（调用原生 API） -->
<button @click="$proteus.theme.set('dark')">切深色</button>
```

**对比竞品**：uni-app 要写 `:class="themeClass"` + 手动读 storage；RN 要写 Provider + useMemo；Flutter 要 `Theme.of(context)`。**Proteus 全部自动。**

### 2.3 五端原生映射

| 语义 | Web | Skyline | iOS | Android | 鸿蒙 |
|------|-----|---------|-----|---------|------|
| `source: 'system'` | `prefers-color-scheme` | `wx.onThemeChange` | `UITraitCollection` + `overrideUserInterfaceStyle` | `UiModeManager` / `AppCompatDelegate` | `UIAppearance.setDarkMode` |
| token 应用 | CSS 变量 + `:root[data-theme]` | WXSS 变量 + page `theme` | `traitCollection` + `setOverrideUserInterfaceStyle` | `DayNight` 资源限定符 / `AppCompatDelegate.setDefaultNightMode` | `$r('app.color.primary')` 资源 |
| 实时监听 | `matchMedia` listener | `wx.onThemeChange` | `traitCollectionDidChange` | `onConfigurationChanged` | `UIAppearance` 回调 |
| 持久化 | `localStorage` | `wx.setStorage` | `UserDefaults` | `SharedPreferences`/DataStore | `Preferences` |

**关键**：iOS 用 `overrideUserInterfaceStyle`（iOS 13+，非私有 API），Android 用官方 `DayNight` 主题，**鸿蒙直接用 `UIAppearance`** —— 各端都用**系统级 API**，框架不自己画颜色。

### 2.4 性能：编译期优化（Proteus 差异化）

- **静态 token 引用**（`:class="$theme.card"`）→ Compiler 构建期生成**主题样式表**，运行时只切换根节点的 `data-theme` / `overrideUserInterfaceStyle` → **O(1) 全局切换**
- **动态 token**（`var(--color-primary)`）→ Vue Proxy 追踪，**精确到单个节点** patch，不重渲整树
- **对比 RN**：RN 需 `useMemo` 手动优化，忘写就全树重渲；**Proteus 编译期 + Proxy 双保险**

### 2.5 反例（明确禁止）

- ❌ 硬编码色值 `#000`/`#FFF`（CSS016 已覆盖）
- ❌ 用 `:root { @media prefers-color-scheme }` 期望五端生效（Skyline/原生无此语义）
- ❌ 业务层直接读 storage 判断主题（交给框架）

---

## 3. 能力二：动态字体缩放

### 3.1 语义模型

```typescript
// app.config.ts
export default defineApp({
  font: {
    scale: 1.0,          // 应用级覆盖（0.8 ~ 1.5）
    followSystem: true,   // 是否跟随系统
    base: 16,             // 设计稿基准（px）
  },
})
```

### 3.2 统一缩放链路

```
系统字体变更（iOS Dynamic Type / Android sp / 鸿蒙 fontScale）
        ↓ 各端原生监听
Proteus FontBus（统一事件总线）
        ↓ 计算最终 scale = clamp(followSystem ? systemScale : 1, 0.8, 1.5) * appScale
精确追踪到用 `font-size` 的节点
        ↓ Vue Proxy patch
各端原生文本控件重排（UILabel / TextView / Text）
```

### 3.3 五端原生实现

| 端 | 系统能力 | Proteus 映射 |
|----|---------|-------------|
| **iOS** | `UIFont.preferredFont(forTextStyle:)` + `adjustsFontForContentSizeCategory` + `UIFontMetrics`(自定义字体) + `UIContentSizeCategory.didChangeNotification` | `UIFontMetrics.scaledFont` + 监听 trait/通知 → 重排 |
| **Android** | `sp` 单位 + `TextView.setTextSize` + `FontScale` 配置变更 | 一律用 `sp`；动态变更走 `Configuration.fontScale` + `recreate()`/`Activity#onConfigurationChanged` |
| **鸿蒙** | `UIAppearance.setFontScale(0-5)` + `UIContext.isFollowingSystemFontScale()` + `getMaxFontScale()` | **直接调 `UIAppearance`**（API 最完整） |
| **Web** | `prefers-color-scheme` 无关，`rem` + `:root { font-size }` | 改 `:root` font-size，全部 `rem` 联动 |
| **Skyline** | WXSS 无 sp，靠 JS 计算 | JS 计算后设 CSS 变量 `--font-scale` |

**关键洞察**：iOS 自定义字体**必须**用 `UIFontMetrics.scaledFont(for:relativeTo:)`，否则 Dynamic Type 失效 —— **这是用原生 API 的细节，Proteus 封装掉**。

### 3.4 无障碍：Large Content Viewer

- iOS：`UILargeContentViewerInteraction`（长按放大）+ `showsLargeContentViewer`
- Android：`LargeContentViewer` 库（支持 iOS/Android）
- **Proteus**：`<p-text large-content>` 语义组件，自动挂载原生交互

### 3.5 性能与边界

- **精确追踪**：只有用了 `font-size` 的节点会 patch（Vue Proxy），列表项不受影响
- **布局约束**：框架 lint 警告**固定高度容器包裹可缩放文本**（防截断，对齐无障碍最佳实践）
- **上限 clamp**：`scale ∈ [0.8, 1.5]`，超范围不崩溃，降级到边界值
- **对比 RN**：`Text.defaultProps.allowFontScaling = false` 是**反模式**（accessibility anti-pattern），Proteus 默认开启且无法全局关闭

---

## 4. 能力三：缓存分层管理

### 4.1 四层模型

```
L0  内存热层 (MemoryCache)        —— WeakRef + LRU，进程内，O(1) 读取
L1  内存冷层 (InMemoryCold)       —— StrongRef 小池，跨组件复用
L2  磁盘层 (DiskCache)            —— MMKV/SQLite/IndexedDB/files，持久化
L3  网络层 (Network)              —— 首次/过期回源 + ETag/Last-Modified
```

### 4.2 统一 API

```typescript
// 业务层：只声明"我要什么"，不关心在哪一层
const user = await $proteus.cache.get('user:123', {
  fetcher: () => api.getUser(123),  // L3 回源
  ttl: 5 * 60_000,                  // 5 分钟
  layer: ['L0', 'L2'],              // 可选：指定层级（默认全链路）
  bytes: 1024 * 50,                 // 单条字节上限
})

// 写
await $proteus.cache.set('user:123', data, { ttl: 300_000 })

// 订阅失效
$proteus.cache.on('evict', (key) => { ... })
```

### 4.3 各层原生实现

| 层 | Web | Skyline | iOS | Android | 鸿蒙 |
|----|-----|---------|-----|---------|------|
| **L0 内存** | `Map` + WeakRef | `wx.getStorage`(内存) | `NSCache` | `LruCache` | `HashMap` + `SoftReference` |
| **L2 磁盘** | IndexedDB / localStorage | `wx.setStorage`(上限 10MB) | `NSPersistentContainer`/文件 | **MMKV** / DataStore | `Preferences` / 文件 |
| **序列化** | JSON | JSON | `Codable`(二进制) | `Parcelable`/MMKV 二进制 | `protobuf`/`json` |

**关键选择**：
- **Android 用 MMKV**（腾讯开源，性能远超 SharedPreferences，支持跨进程）—— 这正是 uni-app 生态常用的方案，Proteus 直接整合
- **iOS 用 `NSCache`**（自动响应内存警告）+ `Codable` 二进制序列化（比 JSON 快、体积小）
- **Web/Skyline 受限于运行环境**，用 IndexedDB / `wx.setStorage`

### 4.4 字节预算 + 淘汰策略（对接 Memory Plan）

```
总预算（按设备分级）:
  低端: L0 ≤ 4MB,  L2 ≤ 20MB
  中端: L0 ≤ 8MB,  L2 ≤ 50MB
  高端: L0 ≤ 16MB, L2 ≤ 100MB

淘汰:
  L0 满 → LRU 淘汰到 L1，再满 → 丢弃（不写盘，避免主线程阻塞）
  L2 满 → 按 TTL + 访问时间淘汰
  启动时 → 检查 L2 总量，超预算则异步清理（不阻塞首帧）
```

**对接 Memory Plan 的 `Budget` + `Resource` 模型**：缓存条目实现 `Disposable`，Owner Epoch 过期时自动释放。

### 4.5 冷启动优化（对接 IFR）

- **关键数据预暖**：`app.config.ts` 声明 `cache.preheat: ['user:me', 'config:app']` → AOT 阶段生成预取指令 → 首帧后立即后台拉取
- **骨架屏期间**：缓存命中则骨架秒变真实内容（对接 `proteus-memorial-skeleton` 的 IFR 方案）

### 4.6 反例

- ❌ 业务直接 `wx.setStorage` / `localStorage.setItem`（绕过分层，无法做字节预算）
- ❌ 缓存整棵大对象（应拆 key，按需失效）
- ❌ 主线程做大量序列化（交给 Worker / `Codable` 异步）

---

## 5. 三者协同（Proteus 独有组合）

```vue
<!-- 悼念日 + 主题 + 字体 + 缓存 一次声明 -->
<pg-app
  :theme="memorialActive ? 'dark' : undefined"
  :font-scale="userPrefs.scale"
  :cache-policy="'balanced'"
>
  <p-view class="content" :class="$theme.card">
    <p-text font-size="16" large-content>内容</p-text>
  </p-view>
</pg-app>
```

**协同收益**：
- **主题 + 纪念日灰度**：`memorialActive` → `dark` + `grayscale(1)`（对接 Glass / Memorial）
- **字体 + 缓存**：用户字号偏好 `userPrefs.scale` 走 L2 持久化，跨端同步
- **全部对接 AOT + IFR**：首帧前状态已确定，无闪屏

**这是 uni-app / RN / Flutter 均不提供的组合能力** —— 它们最多解决单一能力，且各自为政。

---

## 6. 对标总结：为什么 Proteus 更优

| 维度 | uni-app x | RN | Flutter | **Proteus** |
|------|-----------|----|---------|-------------|
| 主题配置 | 多平台节点 + 静默失败 | Provider + useMemo | ThemeData | **单文件 + 编译期优化** |
| 字体缩放 | 仅跟随系统 | allowFontScaling(反模式) | MediaQuery | **应用级 + 系统级双模式** |
| 缓存 | 单层 storage | 社区库 | — | **四层 + 字节预算** |
| 响应式性能 | 根 class 切换 | useMemo 手动 | 树重建 | **Proxy 精确追踪 + 静态优化** |
| 无障碍 | 基础 | 需手动 | 内置 | **Large Content Viewer 封装** |
| 三端同源 | ✅(WebView) | ❌ | ❌ | **✅ Web+小程序+App** |

---

## 7. 执行位与分批（G-27 / G-28）

**G-27 Theme（P1）** · **G-27 FontScale（P1）** · **G-28 Cache（P1）**

三者**互相独立**，可与 G-25/G-26 并行启动。

| 批次 | 内容 | 依赖 |
|------|------|------|
| **M1** | Theme token + CSS 变量映射（Web/Skyline，纯逻辑零依赖） | — |
| **M1** | FontScale 语义 + Web `rem` 联动（纯逻辑零依赖） | — |
| **M1** | L0/L2 抽象接口 + 字节预算（纯逻辑零依赖） | Memory Plan |
| **M2** | iOS `overrideUserInterfaceStyle` + trait 监听 | App Renderer M2 |
| **M2** | Android DayNight + MMKV 集成 | App Renderer M2 |
| **M2** | iOS `UIFontMetrics` + Android sp 动态变更 | — |
| **M3** | 鸿蒙 `UIAppearance.setDarkMode/setFontScale`（**API 最完整，可最后做**） | App Renderer M3 |
| **M4** | FontBus 统一事件 + Large Content Viewer | — |
| **M5** | AOT 预取 + 冷启动缓存预暖（对接 IFR） | Performance B1 |

### Prompt 模板

```
实现 Proteus G-27 Theme 语义层：
1. 定义 ThemeToken 类型（color/spacing 分主题）+ ThemeSource = 'light'|'dark'|'system'
2. 实现 reactive store：source 变更 → 精确通知用到的节点（用 Vue Proxy/ref，不重渲整树）
3. Compiler transform：把 :class="$theme.x" 编译为静态主题样式表 + 根节点 data-theme 切换（O(1)）
4. 各端 binding：iOS overrideUserInterfaceStyle / Android AppCompatDelegate / 鸿蒙 UIAppearance.setDarkMode
5. 持久化：各端原生偏好存储，启动时同步读取（无闪屏）
6. 测试：色值不硬编码（CSS016）、token 引用可静态分析、切换性能 <16ms
```

---

## 8. 验收门槛（真机）

| 指标 | 门槛 |
|------|------|
| 主题切换耗时 | 全树 <16ms（60fps），静态 token O(1) |
| 字体缩放 | 跟随系统 + 应用级覆盖均生效，clamp [0.8,1.5] |
| 无障碍 | Dynamic Type 200% 缩放无截断，Large Content Viewer 可用 |
| 缓存命中（L0） | >95%，读取 <1ms |
| 缓存字节 | 启动时总量不超预算，超预算异步清理不阻塞首帧 |
| 内存 | 缓存淘汰后内存回落（LeakRegistry 验证，对接 Memory Plan） |
| 冷启动 | 关键缓存预暖，骨架→内容无闪烁 |

---

## 9. 边界与诚实声明

- **不虚构 MB 红线**：字节预算由设备分级 + 运行时特征检测决定（对齐 Memory Plan 原则）
- **Skyline/小程序受宿主限制**：`wx.setStorage` 上限 10MB、无原生字体缩放 API → 框架尽力而为，超出部分降级
- **iOS 私有 API 风险**：明确使用 `overrideUserInterfaceStyle`（**公开 API，iOS 13+**），不使用 `CAFilter` 等私有 API（已在 Glass/Memorial 文档中规避）
- **Android DayNight 需 AppCompatActivity**：Proteus 默认 Activity 继承，业务无需感知

---

## 10. 附录：与既有文档的关系

| 文档 | 关系 |
|------|------|
| `proteus-design-principle` (原则 #10) | **本方案是原则 #10 的最新应用**（语义 token/scale/layer → 五端原生） |
| `proteus-css-compat` | CSS016 已禁硬编码色值 → 对接 Theme token；`rem`/`font-size` 归字体缩放 |
| `proteus-memory-plan` | Cache 的 L0/L2 实现 `Disposable` + `Budget`，对接 Owner Epoch |
| `proteus-app-renderer-plan` (附录 A) | iOS/Android/鸿蒙 binding 沿用 NS-Vue 借鉴点 ⑧⑨ |
| `proteus-memorial-skeleton` | 纪念日灰度复用 Theme `dark` 档；缓存预暖对接 IFR/AOT |
| `proteus-glass-plan` | 主题色变更触发玻璃重绘（对接 `<pg-glass>`） |
| `proteus-safe-area` | 字体缩放不影响安全区避让（灵动岛） |
