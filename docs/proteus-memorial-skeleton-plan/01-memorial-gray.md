# 特殊纪念日一键置灰方案

- **所属层**：横切层（与 Glass、i18n、Security 并列）
- **执行位**：G-25（G-22 App Renderer 稳定后启动；Compiler + CLI 可并行 B1）
- **关联 plan**：`proteus-glass-plan`（滤镜管线复用）、`proteus-css-compat`（grayscale 属 ✅ 直映射）、`proteus-app-renderer-plan`（JSI 滤镜绑定）、`proteus-safe-area`（状态源同根）
- **核心定位**：**一行配置 / 一个开关，让 Web + 微信小程序 + App（iOS/Android/鸿蒙）在同一时刻进入统一的灰度悼念模式，且不破坏布局、不阻断交互、不泄漏到常态构建。**

---

## 1. 问题定义

特殊纪念日（国家公祭日、全国哀悼日、重大灾害纪念日）要求 App 在全站范围内临时切换为黑白灰度，诉求有三个特点：

1. **强时效性**：通常提前数小时到一天通知，要求"热切换"，不允许发版；
2. **全站一致性**：所有页面、弹窗、tabBar、导航栏、甚至启动页必须同步变灰，不允许局部遗漏；
3. **零业务侵入**：业务代码不为此写任何分支，日期到了自动生效，日期过了自动恢复。

业界常见痛点（这也是本方案要解决的目标）：

- **Web 端**：`html { filter: grayscale(100%) }` 一行即可，但 IE 不支持 filter、Firefox 需 SVG `feColorMatrix` 兜底；
- **微信小程序**：直接在 `page` 上设 `filter: grayscale(100%)` 会导致 **flex 布局失效、页面错位**，正确做法是把 filter 明确作用到具体标签/根容器，或用 `backdrop-filter` 遮罩层 + `pointer-events: none`；
- **iOS**：`CAFilter` 是私有 API，有审核被拒风险；`compositingFilter = saturationBlendMode` 覆盖层方案较稳但需 `userInteractionEnabled = NO`；
- **Android**：`setLayerType + ColorMatrix(setSaturation=0)` 硬件加速方案最稳，但 **WebView 页面、视频播放会出现视觉异常**，需走"全局默认 + 特殊容器选择性降级"；
- **鸿蒙**：ArkUI 原生提供 `.grayscale(1)` / `.saturate(0)`，最省心，但需挂在根容器且状态可响应。

> **关键洞察**：五端的"置灰能力"都存在，但**接口形态、坑点、生效层级完全不同**——这正是 Proteus「**统一语义 + 原生实现**」原则的用武之地。业务侧只声明"今天要悼念"，框架负责把这句声明翻译成五端各自的最优实现。

---

## 2. 设计原则（遵循 Architecture #10）

1. **单一语义源**：灰度状态只有一个事实源 `memorialMode: boolean | { dates: [], intensity: 0-1 }`，五端共用；
2. **编译期 / 启动期注入，运行期零成本**：常态构建**不含**悼念代码，避免一年用 1-3 天的代码常驻；
3. **不破坏布局、不阻断交互**：置灰层必须 `pointer-events: none`（Web/小程序）或不接收事件（原生覆盖层），且**绝不**直接挂到会触发重排的根上导致 flex 失效；
4. **尊重 CSS 兼容矩阵**：`grayscale()` 属 ✅ 直映射（Web/Skyline/鸿蒙原生支持，iOS/Android 走滤镜管线），本方案是它的最高阶封装，不新增禁止面；
5. **服务端可控 + 本地兜底**：支持远端配置（日期表 / 开关），离线时走本地日期规则。

---

## 3. 统一语义层设计

### 3.1 配置（单一事实源）

```ts
// app.config.ts
export default defineProteus({
  memorial: {
    // 内置日期表（本地兜底，无需联网）
    dates: ['04-04', '12-13'], // 清明节全国哀悼 / 南京大屠杀死难者国家公祭日
    // 灰度强度 0-1，1 = 完全灰度
    intensity: 1,
    // 作用范围
    scope: 'all', // 'all' | 'except-camera' | 'except-video'
    // 远端配置覆盖（优先级更高）
    remote: 'https://cdn.example.com/memorial.json',
    // 是否注入到启动页（App 端）
    includeSplash: true,
  },
})
```

远端 `memorial.json` 结构一致，支持动态开关、动态加日期，无需发版。

### 3.2 语义 API（业务侧零分支）

```vue
<!-- 业务代码里永远不需要写 v-if / :class -->
<template>
  <p-view> ... </p-view>
</template>
```

```ts
// 手动覆盖（如需，极少用）
import { useMemorial } from '@proteus-vue/runtime'
const { active, intensity } = useMemorial()
// active 为 true 时，框架自动在五端挂载灰度层
```

**业务代码零改动**是本方案的最低验收标准。

---

## 4. 五端映射（统一语义 → 原生实现）

| 端 | 语义 | 原生实现 | 生效层级 | 已知坑点 / 处理 |
|----|------|---------|---------|---------------|
| **Web** | `memorial:on` | `filter: grayscale(100%)` + SVG `feColorMatrix` 兜底 | `<html>` 根（不破坏布局） | IE 走 SVG filter URL |
| **Skyline** | 同上 | `filter: grayscale(1)` | 页面根容器 | 不用 `page` 直挂，避免 flex 异常 |
| **iOS** | 同上 | `window.layer.compositingFilter = saturationBlendMode` 覆盖层 | UIWindow | ❌ 禁 `CAFilter` 私有 API（审核风险） |
| **Android** | 同上 | `decorView.setLayerType(HARDWARE, ColorMatrix(0))` | Activity 根 decorView | WebView/视频需选择性排除 |
| **鸿蒙** | 同上 | `.grayscale(1)` / `.saturate(0)` | 根 Component | 挂 `@State` 可响应切换 |

### iOS 细节（规避审核风险）

```swift
// 覆盖层方案（非私有 API）
let cover = UIView(frame: window.bounds)
cover.backgroundColor = .lightGray
cover.isUserInteractionEnabled = false // 不阻断交互
cover.layer.compositingFilter = "saturationBlendMode"
cover.layer.zPosition = .greatestFiniteMagnitude
window.addSubview(cover)
// 关闭：cover.removeFromSuperview()
```

**禁止**使用 `CAFilter` / `window.layer.filters = [...]`，属私有 API。

### Android 细节（规避 WebView/视频异常）

```kotlin
// 全局默认（普通页面）
val paint = Paint().apply {
  colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(0f) })
}
window.decorView.setLayerType(View.LAYER_TYPE_HARDWARE, paint)

// 特殊容器（WebView / 视频）选择性排除
GrayManager.setLayerGrayType(nonProblematicView)
```

### 鸿蒙细节

```typescript
@Entry @Component
struct Root {
  @State gray = useMemorialState() // 桥接到统一状态源
  build() {
    Column() { /* ... */ }
      .width('100%').height('100%')
      .grayscale(this.gray ? 1 : 0)
  }
}
```

---

## 5. 编译期注入策略（运行期零成本）

常态构建**不含**悼念代码。灰度能力通过以下方式进入：

1. **Web**：构建期把灰度 CSS（含 SVG 兜底）+ 一段 `<script>` 注入 `index.html` `<head>`，日期命中即添加 `.proteus-memorial` class 到 `<html>`；
2. **Skyline**：Compiler 在 IR 层给页面根节点追加 `filter` 指令；
3. **App**：CLI 生成阶段把灰度模块编入原生包，启动时读取配置一次性挂载。

开关判定优先级：**远端配置 > 本地日期表 > 手动 API**。

---

## 6. 反例（纳入 `--strict-css`）

| 规则 | 说明 | 自动修复 |
|------|------|---------|
| `memorial/no-hardcode-filter` (CSS016) | 禁止业务手写 `filter: grayscale` | 引导用 `app.config.ts` 的 `memorial` |
| `memorial/no-page-filter` (CSS017) | 禁止在 Skyline/小程序 `page` 直挂 filter | 改为根容器 |
| `memorial/no-private-api` (RNT001) | iOS 禁 `CAFilter` / `window.layer.filters` | 改为覆盖层方案 |

---

## 7. 对标

| 方案 | 一键能力 | 五端统一 | 不发版热切换 | 布局安全 |
|------|---------|---------|------------|---------|
| 手工 CSS | ✅(仅 Web) | ❌ | ❌ | ⚠️ flex 风险 |
| uni-app | ⚠️ | ❌ App 需另写 | ⚠️ | ⚠️ |
| **Proteus** | ✅ | ✅ 单一语义源 | ✅ 远端 + 本地 | ✅ 覆盖层不破坏布局 |

---

## 8. 分批（详见 `11-batches.md`）

- **M1**：Web + Skyline 灰度注入（纯 Compiler + CSS，零依赖，最先上线验证）
- **M2**：iOS 覆盖层 + Android ColorMatrix（JSI 滤镜管线，复用 Glass 的滤镜基础设施）
- **M3**：鸿蒙 `.grayscale` + 状态桥接
- **M4**：远端配置 + 日期表 + CLI 注入
- **M5**：真机验收矩阵 + 回归防护

> **差异化卖点**：Glass plan 已沉淀滤镜管线，`<pg-memorial>` 可与 `<pg-glass>` 同层叠加——悼念日导航栏玻璃 + 全站灰度**一次声明、五端生效**，这是 uni-app / RN / Flutter 都不提供的组合能力。
