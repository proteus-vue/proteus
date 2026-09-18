# 02 · 全局主题切换：五端实现细则

## 1. 语义 token 规范

```typescript
interface ThemeTokens {
  color: Record<string, { light: string; dark: string }>
  spacing: Record<string, number>       // 无需分主题
  radius: Record<string, number>
  shadow: Record<string, ShadowSpec>    // 对接 p-shadow
}

interface ThemeConfig {
  tokens: ThemeTokens
  source: 'light' | 'dark' | 'system'  // 优先级：app > system
  persist?: boolean                      // 默认 true
}
```

## 2. Web 端

- **映射**：CSS 变量 `--color-{token}` + `:root[data-theme="dark"] { --color-primary: ... }`
- **静态优化**：Compiler 把 `:class="$theme.card"` 编译为 `.theme-dark .card { ... }`，运行时只切 `data-theme`
- **系统跟随**：`matchMedia('(prefers-color-scheme: dark)')` + `addEventListener('change', ...)`
- **持久化**：`localStorage.setItem('proteus:theme', source)`

## 3. Skyline（微信小程序）

- **关键坑点**：Skyline 无 `:root` 概念，`app.wxss` 的变量需通过 `page` 选择器；页面级 theme 需在 `page.json` 配置
- **映射**：WXSS 变量 `--color-{token}` + 根 `page` 节点 class 切换
- **系统跟随**：`wx.onThemeChange(({ theme }) => ...)`（基础库 2.21.3+）
- **持久化**：`wx.setStorageSync('theme', source)`
- **反例**：❌ 用 `:root { @media }` 期望生效（Skyline 不支持 media query 复杂场景，见 css-compat 06）

## 4. iOS

- **映射**：`UIViewController.overrideUserInterfaceStyle = .dark`（**公开 API，iOS 13+**，非私有）
- **系统跟随**：`traitCollection.userInterfaceStyle` + `traitCollectionDidChange(_:)`
- **关键**：设为 `.unspecified` 即跟随系统；窗口级设置覆盖全 App
- **资源**：Asset Catalog 用 `Any/Dark` 外观 → 自动切换图片（无需代码）
- **JSI binding**：`UIScreen.main.traitCollection` 读取 + `setOverrideUserInterfaceStyle`

## 5. Android

- **映射**：`AppCompatDelegate.setDefaultNightMode(MODE_NIGHT_YES/NO/FOLLOW_SYSTEM)`
- **资源限定符**：`res/values-night/colors.xml` + `res/values/colors.xml` → 系统自动选
- **关键**：需 `AppCompatActivity` 或 `ComponentActivity`（Proteus 默认继承）
- **自定义视图**：监听 `Configuration.uiMode` 变化 → 重绘
- **JSI binding**：通过 `androidx.appcompat.app.AppCompatDelegate` 静态方法

## 6. 鸿蒙

- **映射**：`UIAppearance.setDarkMode(DarkMode.ALWAYS_DARK)`（需 `ohos.permission.UPDATE_CONFIGURATION`）
- **读取**：`UIAppearance.getDarkMode()`（同步）
- **监听**：`UIAppearance` 回调（NAPI/ANI 双接口，功能一致）
- **资源**：`$r('app.color.primary')` + `resources/.../dark/color.json` 限定符

## 7. 统一事件总线 ThemeBus

```typescript
// 内部实现（业务不可见）
class ThemeBus {
  private source = ref<'light'|'dark'|'system'>('system')
  private systemTheme = ref<'light'|'dark'>('light')
  
  get resolved() { return this.source.value === 'system' 
    ? this.systemTheme.value : this.source.value }
  
  set(source: ThemeSource) {
    this.source.value = source
    this.persist()
    this.notify()  // 精确通知（Proxy 追踪）
  }
}
```

**精确追踪**：只有引用了 `$theme.x` 或 `var(--color-*)` 的节点会 patch，列表/其他组件不重渲。

## 8. 持久化策略

| 端 | 存储 | 启动时序 |
|----|------|---------|
| iOS | `UserDefaults` | `onLaunch` 同步读取，设置 window 后再 mount → 无闪屏 |
| Android | `DataStore`/`SharedPreferences` | `Application.onCreate` 读取，早于首 Activity |
| 鸿蒙 | `Preferences` | `UIAbility.onCreate` 读取 |
| Web | `localStorage` | 同步脚本在 `<script>` 内执行，先于 Vue mount |
| Skyline | `wx.getStorageSync` | App.onLaunch 同步读取 |

**关键**：所有端**同步读取**持久化主题 → 首帧即正确主题，无闪屏（对比 uni-app 需手动在 onLoad 设置"来不及"的问题）。

## 9. 验收

- [ ] 静态 token 切换 O(1)（切 `data-theme` / `overrideUserInterfaceStyle`）
- [ ] 动态 token 精确到节点（Vue DevTools 验证 patch 范围）
- [ ] 系统主题变更实时响应（各端原生监听）
- [ ] 重启后主题保持（持久化）
- [ ] 无硬编码色值（CSS016 校验通过）
- [ ] 骨架屏期间主题已应用（对接 IFR）
