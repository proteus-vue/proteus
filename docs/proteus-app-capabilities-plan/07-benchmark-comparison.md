# 07 · 对标竞品：为何 Proteus 更优

## 1. 主题切换对标

| 维度 | uni-app x | RN | Flutter | **Proteus** |
|------|-----------|----|---------|-------------|
| 配置位置 | `manifest.json` 各平台节点 + `theme.json` | 第三方库 / 手写 Context | `ThemeData` | **单 `app.config.ts`** |
| 多套概念 | `osTheme`/`hostTheme`/`appTheme` | — | — | **单一 `source`** |
| 加载失败 | **控制台静默** | — | — | **构建期校验 + 报错** |
| 可用字段 | 仅 navBar/tabBar 等几个 | 全部自定义 | 全部 | **全部 token** |
| 响应式 | 根 class 切换（全树） | useMemo 手动 | `Theme.of` 树查找 | **Proxy 精确追踪 + 静态优化** |
| 原生映射 | 各端各做 | 无（JS 侧） | 自绘 | **五端系统级 API** |
| 防闪屏 | 手动 onLoad（"来不及"） | — | — | **同步读取 + IFR** |

**uni-app x 痛点实录**（来自官方文档与社区反馈）：
- theme.json 路径配错 → **无任何报错提示**
- pages.json `@变量` 可用字段极少
- App.vue 需同时在 `onLaunch` + `onShow` 读 storage
- 某些平台页面早于 onLoad → 设置样式"来不及"

**Proteus 解法**：构建期生成主题样式表 + 运行时精确追踪 → **开发者不写任何样板**。

## 2. 字体缩放对标

| 维度 | uni-app x | RN | Flutter | **Proteus** |
|------|-----------|----|---------|-------------|
| 系统跟随 | ✅（仅跟随） | `allowFontScaling` | `MediaQuery.textScaler` | **✅ + 应用级覆盖** |
| 应用级覆盖 | ❌ 无 API | 需第三方 | 需 MediaQuery 包裹 | **内置 `font.scale`** |
| 自定义字体缩放 | — | — | `TextStyle` | **iOS `UIFontMetrics` 封装** |
| 无障碍 | 基础 | 常被全局关闭（反模式） | 内置 | **Large Content Viewer + 禁止全局关闭** |
| 五端统一 | ✅(WebView) | ❌ | ❌ | **✅ Web+小程序+App** |

**关键差异**：
- **RN**：`Text.defaultProps.allowFontScaling = false` 是公认的 accessibility anti-pattern
- **鸿蒙**：`UIAppearance.setFontScale` API 最完整，但**只有鸿蒙有** → Proteus 把它抽象为统一语义
- **Proteus**：应用级覆盖 + 系统级跟随双模式，**且 clamps 防崩溃**

## 3. 缓存分层对标

| 维度 | uni-app | RN | Flutter | **Proteus** |
|------|---------|----|---------|-------------|
| 分层 | 单层 `setStorage` | 社区库（MMKV 等） | — | **L0/L1/L2/L3 四层** |
| 字节预算 | ❌ | ❌ | — | **✅ 设备分级** |
| 淘汰策略 | 手动 | 手动 | — | **LRU + TTL 自动** |
| 序列化 | JSON | 依赖库 | — | **二进制（Codable/MMKV）** |
| 冷启动预暖 | ❌ | ❌ | — | **✅ AOT + IFR** |
| 内存对接 | ❌ | ❌ | — | **✅ Owner Epoch / LeakRegistry** |

**Proteus 独有**：缓存对接 Memory Plan 的 `Disposable` + `Budget` + `LeakRegistry` → **缓存淘汰能触发内存回落验证**。

## 4. 组合能力（Proteus 独有）

> **主题 + 字体 + 缓存 + 纪念日 + 骨架屏 + Glass + 安全区** —— 六个能力声明式组合，五端同源。

uni-app / RN / Flutter **最多解决单一能力，且各自为政**（主题用 Context、字体靠系统、缓存靠社区）。

**这是 Proteus 相对所有竞品的真正差异化**：不是某个单点更强，而是**整套应用级能力声明式收敛 + 五端原生实现**。
