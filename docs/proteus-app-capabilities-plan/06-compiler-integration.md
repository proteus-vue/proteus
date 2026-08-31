# 06 · Compiler 集成与性能优化

## 1. Theme 编译期优化（关键差异化）

### 静态 token 分析

```vue
<!-- 源码 -->
<p-view :class="$theme.card">
<p-text :style="{ color: $theme.tokens.color.text }">
```

```typescript
// Compiler 分析阶段：识别静态引用 → 生成主题样式表
function analyzeThemeRefs(sfc: SFC): ThemeStyleSheet {
  // 遍历模板，收集 $theme.x 引用
  // 区分：静态（编译期确定 key）vs 动态（运行时计算）
}

// 产物（构建期生成）
const __theme_static = {
  card: { light: 'theme-light_card', dark: 'theme-dark_card' },
}
```

**产物**：
```css
/* 自动生成 theme.css */
:root { --color-primary: #007AFF; --color-text: #000; }
:root[data-theme="dark"] { --color-primary: #0A84FF; --color-text: #FFF; }
.theme-light_card { background: var(--color-background); }
.theme-dark_card { background: var(--color-background); }
```

**运行时**：只需切换根节点 `data-theme` → **O(1) 全局切换**（对比 RN useMemo 手动优化）。

### 动态 token 追踪

```typescript
// $theme.tokens.color.text → 编译为响应式 ref 访问
// Vue Proxy 精确追踪 → 只 patch 用到的节点
setup() {
  const color = computed(() => themeBus.tokens.color.text[themeBus.resolved.value])
  return { color }  // <p-text :style="{ color }">
}
```

## 2. FontScale 编译期优化

```css
/* 自动生成 font.css */
:root { --font-scale: 1; --font-base: 16px; }
.body { font-size: calc(var(--font-base) * var(--font-scale)); }
.title { font-size: calc(24px * var(--font-scale)); }
```

**所有字号用 `calc(base * var(--font-scale))`** → 改一个 CSS 变量，全树联动，**无需重渲**。

**对比 RN**：RN 改字号需重建 StyleSheet（useMemo 手动），Proteus **纯 CSS 变量，GPU 合成层处理，不进 JS 线程**。

## 3. Cache 编译期优化

### 预取指令生成

```typescript
// app.config.ts
export default defineApp({
  cache: { preheat: ['user:me', 'config:app'] },
})
```

```typescript
// Compiler 生成 AOT 预取清单（对接 Performance AOT）
const __cache_preheat = [
  { key: 'user:me', fetcher: _f0, ttl: 300000, layer: ['L0', 'L2'] },
  { key: 'config:app', fetcher: _f1, ttl: 3600000 },
]

// 首帧后自动执行（对接 IFR）
requestIdleCallback(() => preheat(__cache_preheat))
```

### 键名静态分析

Compiler 检查 `cache.set/get` 的 key 是否符合 `前缀:版本:标识` 规范（lint CACHE002）。

## 4. TraceBus 集成（对接 DevTools）

```typescript
// --trace-transform 输出
[proteus:theme] static tokens: 12, dynamic refs: 3
[proteus:theme] generated theme.css (2.3KB)
[proteus:font] scale range: [0.8, 1.5], clamp: enabled
[proteus:cache] preheat keys: 2, estimated bytes: 12KB
[proteus:cache] layer budget (mid): L0=8MB, L2=50MB
```

对接 `--trace-transform`（见 `proteus-app-renderer-plan` 09）。

## 5. CLI 开关

```bash
proteus build --strict-theme     # 禁止硬编码色值（CSS016）
proteus build --strict-font      # 禁止 px 做字号（FONT002）
proteus build --cache-report     # 输出缓存预算报告
proteus dev --watch-theme        # 主题热更新（HMR）
```

## 6. 性能预算

| 指标 | 预算 |
|------|------|
| 主题样式表 (theme.css) | <5KB（gzip） |
| 字体样式表 (font.css) | <2KB |
| 主题切换主线程耗时 | <16ms（60fps） |
| 字体缩放 patch 节点数 | 仅用到的节点（精确追踪） |
| 缓存预取（L3→L2） | 首帧后 idle 执行，不阻塞 |
| 冷启动缓存命中 | 关键数据 100% 命中（preheat） |

## 7. 对齐既有架构

- **IR 骨架**：Theme/Font/Cache 语义 → Compiler IR → 各端 Renderer（对接 App Renderer 03）
- **AOT**：预取清单 + 主题样式表 → AOT 产物（对接 Performance 03）
- **IFR**：首帧前状态已确定（theme source / font scale 同步读取）→ 无闪屏
- **CSS 兼容矩阵**：`var(--color-*)` = ✅ 直映射；`rem` = ✅；硬编码色值 = ❌（CSS016）
