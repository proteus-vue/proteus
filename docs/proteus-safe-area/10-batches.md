# 分批策略 M1-M5

> 执行位：G-23（Safe Area 主体，依赖 G-22 App Renderer / G-21 CSS Compat / Glass L3 随 G-22）

---

## 概览

| 批次 | 内容 | 依赖 | 里程碑 | 优先级 |
|------|------|------|--------|--------|
| **M1** | 语义定义 + iOS `safeAreaLayoutGuide` + `useSafeArea()` | App Renderer M1 (JSI 骨架) | 真机弹出正确避让的导航栏 | **P0** |
| **M2** | Android `WindowInsets` + 横屏/挖孔 | M1 | 双端真机验证 | P0 |
| **M3** | 鸿蒙 + Skyline + Web 映射 | M1 | 五端齐 | P1 |
| **M4** | 灵动岛玻璃融合 `p-safe-island-glass` + Glass L3 联动 | Glass M3 | 导航栏玻璃与岛融合 | P1 |
| **M5** | `--strict-css` CSS013-015 + 响应式更新 + CI 门禁 | Compiler B1 | CI 门禁闭环 | P1 |

**关键路径**：M1 → M2 → M4 → M5

---

## M1：iOS 骨架（P0，与 App Renderer M1 同期）

### 目标
真机能弹出正确避让灵动岛的导航栏。

### 交付物
- [ ] `p-safe` 语义定义（IR 节点）
- [ ] iOS `nodeOps.applySafeArea()` → `safeAreaLayoutGuide` 约束
- [ ] `useSafeArea()` 响应式（iOS `viewSafeAreaInsetsDidChange` → JSI → Vue）
- [ ] `<p-safe area="top">` 组件
- [ ] 硬编码数值扫描（CSS014 前置）

### Prompt 模板

```
实现 Proteus App Renderer 的 iOS 安全区避让：
- 在 nodeOps 新增 applySafeArea(node, { area, mode })
- 用 safeAreaLayoutGuide 做 AutoLayout 约束（**禁止硬编码 44/59/88**）
- 监听 viewSafeAreaInsetsDidChange，经 JSI 触发 JS 侧 reactive 更新
- 验证：iPhone 16 Pro 模拟器，导航栏不贴顶、灵动岛展开后自动下移
```

### 验收
iPhone 16 Pro 模拟器 + 真机：
- 收起态导航栏正确避让
- 展开计时器后导航栏自动下移，无闪烁

---

## M2：Android + 鸿蒙横屏（P0）

### 交付物
- [ ] Android `WindowInsets` + `DisplayCutout` 映射
- [ ] 横屏挖孔侧 → `p-safe-left/right`
- [ ] 鸿蒙 `getAvoidArea()` 映射
- [ ] `setDecorFitsSystemWindows(false)` 玻璃场景

### Prompt 模板

```
实现 Android 端安全区：
- ViewCompat.setOnApplyWindowInsetsListener 应用 systemBars + displayCutout insets
- 横屏时 displayCutout.boundingRects → p-safe-left/right
- 立即 requestApplyInsets 一次
- 验证：华为 Mate 挖孔屏真机
```

---

## M3：Web + Skyline（P1）

### 交付物
- [ ] Web `env()` + `viewport-fit=cover` 注入
- [ ] Skyline `getSystemInfo().safeArea` + 胶囊按钮避让
- [ ] Compiler 按 target 分支编译 `p-safe-*`

---

## M4：灵动岛玻璃融合（P1，依赖 Glass M3）

### 交付物
- [ ] `p-safe-island-glass` 语义
- [ ] iOS `UIGlassEffect.containerRelativeAnchor` 包含岛区
- [ ] 降级策略（无玻璃 API → 普通避让）
- [ ] 状态栏深浅色 `status-bar-style`

### Prompt 模板

```
实现灵动岛玻璃融合：
- p-safe-island mode=glass-blend 时，设置 UIGlassEffect 的 containerRelativeAnchor
  为包含灵动岛的 rect（用 safeAreaInsets 计算）
- 灵动岛展开/收起时系统自动跟随，无需手动监听宽度
- 降级：无 UIGlassEffect → 普通半透明 + p-safe-top
- 验证：iPhone 16 Pro，玻璃与岛融合无锯齿
```

---

## M5：CSS 规则 + CI（P1，依赖 Compiler B1）

### 交付物
- [ ] CSS013/014/015 规则
- [ ] 自动修复（CSS014 → `p-safe-*`）
- [ ] `--safe-area-report` CLI
- [ ] CI 门禁（构建期零硬编码魔法数字）
- [ ] 快照测试 + 回归基准

---

## 依赖关系图

```
G-01 (Types 地基)
    ↓
G-22 M1 (JSI 骨架)  ←  M1 (iOS 安全区)  ┐
    ↓                                    ├→ M4 (玻璃融合) → M5 (CI)
Glass L3（随 G-22）─────────────────────┘
    ↓
G-21 CSS Compat B1 ───────────────────────→ M5 (strict-css)
    ↓
G-23 (五端映射) ← M2/M3
```

**M1 可与 App Renderer M1 同期启动**——安全区是导航栏的前置依赖，越早验证越好。

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| iOS `containerRelativeAnchor` API 不稳定 | 降级为手动计算 rect + 监听变化 |
| Android 挖孔 API 厂商差异 | `WindowInsetsCompat` 兼容层 + 真机矩阵 |
| Skyline `env()` 支持不全 | JS 运行期兜底（`getSystemInfo`） |
| 灵动岛宽度变化监听 | **不监听宽度**，靠 `safeAreaInsets` 自动跟随 |

---

## 下一步

M1 是纯逻辑 + JSI 绑定，零业务依赖，**可与 G-01 地基三联同期启动**，作为验证"JSI 直调能解决实际问题"的第一个实战场景。
