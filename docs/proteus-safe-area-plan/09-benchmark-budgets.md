# 性能预算与验收矩阵

> 归入 Performance plan（G-30）+ App Renderer（G-22）

---

## 1. 性能预算

安全区方案的运行时开销应**趋近于零**（遵循原则 #10：编译期固化优先）：

| 指标 | 预算 | 说明 |
|------|------|------|
| 安全区初始化耗时 | < 2ms | 首次读取 insets |
| 灵动岛展开/收起重排 | < 16ms（1 帧） | `safeAreaInsets` 变化 → patch |
| `useSafeArea()` 响应式更新 | < 1ms | reactive set |
| 产物体积增量 | < 3KB（gzipped） | 五端共享语义层 |
| 内存：SafeAreaProvider | < 1KB | 单例，不随页面增长 |

---

## 2. 真机验收矩阵

### 2.1 iOS（灵动岛主场）

| 设备 | 状态 | 验证点 |
|------|------|--------|
| iPhone 16 Pro | 灵动岛收起 | 导航栏不贴顶，玻璃融合无锯齿 |
| iPhone 16 Pro | 计时器展开 | 导航栏自动下移，无闪烁 |
| iPhone 16 Pro | 来电满宽 | 内容不叠岛 |
| iPhone 16 Pro | 横屏（灵动岛左） | `p-safe-island` → left |
| iPhone 15 | 刘海（无岛） | `island = 0`，降级正常 |
| iPad Pro | 无灵动岛 | `island = 0`，不崩溃 |

### 2.2 Android

| 设备 | 验证点 |
|------|--------|
| 华为 Mate（挖孔屏） | `p-safe-top` 避让挖孔 |
| 小米（居中挖孔） | 竖屏避让 |
| 横屏挖孔侧 | `p-safe-left/right` |
| 全屏玻璃场景 | `setDecorFitsSystemWindows(false)` |

### 2.3 鸿蒙

| 设备 | 验证点 |
|------|--------|
| 华为 Mate 60（挖孔） | `getAvoidArea(TYPE_CUTOUT)` |
| 避让变化 | `avoidAreaChange` → 响应式更新 |

### 2.4 Web

| 浏览器 | 验证点 |
|--------|--------|
| iPhone Safari | `env()` 生效（刘海机） |
| Chrome 桌面 | `env()` = 0，不崩溃 |
| 横屏 | `env()` 更新 |

### 2.5 Skyline（微信小程序）

| 环境 | 验证点 |
|------|--------|
| iOS 基础库 8.0.49+ | `env()` 支持 |
| 旧版本 | 降级 JS 计算 |
| 胶囊按钮 | 自定义导航栏避让 |

---

## 3. 回归防护

### 3.1 快照测试

```bash
proteus test --snapshot safe-area
# 产出五端安全区 insets 快照
```

### 3.2 基准场景

| 场景 | 基线 | 门禁 |
|------|------|------|
| 导航栏首帧（含灵动岛避让） | < 16ms | P95 < 33ms |
| 灵动岛展开重排 | < 16ms | P95 < 33ms |
| 横屏旋转 | < 50ms | P95 < 100ms |

### 3.3 CI 矩阵

```yaml
# consistency.yml
strategy:
  matrix:
    platform: [ios, android, harmony, web, skyline]
    device: [iphone16pro, mate60, ipad, desktop, miniprogram]
```

---

## 4. 内存验证（对齐 Memory plan）

- [ ] 页面销毁后 SafeAreaProvider 监听器**全部 disposer**（无泄漏）
- [ ] `useSafeArea().onChange` 注册的回调在 `onUnmounted` 自动清理
- [ ] 单例 SafeAreaProvider 不随页面数量增长
- [ ] iOS `viewSafeAreaInsetsDidChange` 回调无陈旧引用（Owner Epoch）

---

## 5. 验收标准（一句话）

> iPhone 16 Pro 灵动岛收起/展开/满宽三态，导航栏内容不叠岛、玻璃融合无锯齿；Android/鸿蒙挖孔避让；Web/Skyline `env()` 正常；灵动岛变化 1 帧内重排完成；无内存泄漏。

---

## 6. 对照竞品（诚实边界）

| 框架 | 灵动岛融合 | 响应式更新 | 玻璃联动 |
|------|-----------|-----------|---------|
| uni-app | ❌ 手动 | 手动 | ❌ |
| uni-app x (uvue) | ❌ | `getWindowInfo` | ❌ |
| RN | ⚠️ `useSafeAreaInsets` | 手动 | ⚠️ |
| Flutter | ⚠️ `SafeArea` | `MediaQuery` | ❌ |
| NativeScript | ⚠️ `iosSafeArea` | 事件 | ❌ |
| **Proteus** | ✅ `p-safe-island-glass` | ✅ 自动响应式 | ✅ Glass L3 联动 |

**差异化**：Proteus 是唯一把「安全区 + 灵动岛 + 玻璃融合」三者声明式收敛的框架。
