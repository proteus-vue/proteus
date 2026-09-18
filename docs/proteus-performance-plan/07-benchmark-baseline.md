# 性能对标基线与基准测试

> 对齐：`02-strategy.md` §5、`proteus-app-renderer-plan/10-audit-performance.md`

---

## 1. 对标矩阵（修订版，含性能上限拔高后）

| 维度 | uni-app 传统 | RN 新架构 | Lynx | **Proteus (优化后)** |
|------|-------------|-----------|------|---------------------|
| 调用通道 | Bridge 异步 | JSI 同步 | PrimJS 双线程 | JSI 同步 ✅ |
| 首帧 | 800-1500ms | 400-600ms | **120-200ms** | **<200ms** ✅ |
| 启动引擎 | WebView | Hermes | PrimJS | V8/JSC (预热) |
| 手势/动画 | 30fps | Reanimated | MTS | **Worklet** ✅ |
| Layout | WebView CSS | Yoga (C++) | Lynx Engine | **平台原生 binding** |
| AOT | ❌ | ❌ | ✅ 二进制 | **✅ IR AOT** |
| 包体积 | 大 | 中 | **小 (210KB)** | 中 (Vue+V8) |
| **三端同源** | △ | ❌ | △ | **✅** |
| **Glass L3** | ❌ | 手搓 | 社区少 | **p-glass preset** ✅ |

**结论**：Proteus 在**启动性能**追平 Lynx，在**三端同源 + Glass L3** 维度领先。

---

## 2. 真机基准测试方法

### 2.1 测试矩阵

| 设备档位 | iOS | Android | 鸿蒙 |
|---------|-----|---------|------|
| 高端 | iPhone 15+ | Snapdragon 8 Gen3 | Mate 60+ |
| 中端 | iPhone 12 | Snapdragon 7 | nova 系列 |
| 低端 | iPhone SE | 入门机 | 畅享系列 |

### 2.2 测量指标

```ts
// packages/devtools/src/performance.ts
export interface PerfMetrics {
  startup_ms: number         // 冷启动到首帧
  tti_ms: number             // 可交互时间
  fps_scroll: number         // 长列表滚动帧率
  jsi_p99_ms: number         // JSI 调用 P99
  memory_mb: number          // 内存峰值
  bundle_kb: number          // 产物体积
}
```

### 2.3 自动化

```bash
# CI 真机矩阵 (对齐 Testing plan)
proteus bench --device=iphone15 --scenario=home-scroll
proteus bench --device=pixel8 --scenario=startup
# 结果上传对比基线, 回归 >5% 阻断
```

---

## 3. 基准场景

| 场景 | 描述 | 关键指标 |
|------|------|---------|
| **Startup Cold** | 杀进程后冷启动到首帧 | startup_ms |
| **List 1000** | 1000 条列表滚动 | fps_scroll |
| **Glass Scroll** | Glass 背景 + 滚动 | fps + 内存 |
| **Navigation** | 页面跳转 | 过渡帧率 |
| **Worklet Pan** | 手势拖拽 | 跟手延迟 |

---

## 4. 性能预算（G-30 目标）

| 指标 | 当前 | 目标 | 对标 (Lynx) |
|------|------|------|------------|
| 冷启动首帧 | ~400ms | **<200ms** | 120-200ms ✅ |
| TTI | ~600ms | **<300ms** | ~250ms ✅ |
| 长列表 fps | 30-45 | **≥58** | 59.8 ✅ |
| JSI P99 | <2ms | **<0.5ms** | <0.3ms ⚠️ 接近 |
| 内存峰值 | ~80MB | **<60MB** | 28MB ⚠️ 差距 |

**诚实边界**：内存基线因 Vue+V8 大于 Lynx (PrimJS)，**明确不做内存追平**，只保证不劣化。

---

## 5. 回归防护

- 每个 PR 跑 `proteus bench --baseline`
- 结果入库 (InfluxDB/Grafana)，可视化趋势
- 回归 >5% → 阻断合并

对齐 `proteus-architecture` 铁律 + CI 门禁。
